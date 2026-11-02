import type { EngineInterface } from 'claude-code'

// A safety net for Bash commands, not a guarantee: a script file or another language can still delete anything.
type Word = { text: string; isDynamic: boolean; globAt: number }
type Target = { path: string; followsLast: boolean; shown: string }
type Judged = { refusal?: string; targets: Target[] }
type Place = { home: string; cwd: string | undefined; targets: Target[] }

const MAX_NESTING = 8
const SHELLS = new Set(['sh', 'bash', 'zsh', 'dash', 'ksh'])
const KEYWORDS = new Set(['if', 'then', 'do', 'else', 'elif', 'while', 'until', '!', '{', 'time'])
// Each wrapper runs the command after it, and these of its short flags take a value.
const WRAPPERS: Record<string, string> = {
  sudo: 'ugrpCDhTRt',
  doas: 'uC',
  command: '',
  builtin: '',
  exec: 'a',
  env: 'uCS',
  nohup: '',
  nice: 'n',
  ionice: 'cnp',
  timeout: 'ks',
  stdbuf: 'ioe',
  caffeinate: 'tw',
  xargs: 'IEJLPRSdnsa',
}
const POSITIONAL_FIRST = new Set(['timeout'])
const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*\+?=/
const ADVICE = 'Write the literal path, check it with ls, and prefer moving it to a trash folder (mv <path> ~/.Trash/) over deleting it.'

const isBlank = (c: string) => c === ' ' || c === '\t'

// Reads a command the way a shell splits it, so quoted text, heredocs and comments don't count as commands.
function lex(src: string, nesting = 0, isText = false): Word[][] {
  if (nesting > MAX_NESTING) throw new Error('nested too deeply')
  const out: Word[][] = []
  let i = 0

  const readBacktick = (word: Word) => {
    const start = i++
    let inner = ''
    while (src[i] !== '`') {
      if (i >= src.length) throw new Error('unclosed backtick')
      if (src[i] === '\\' && i + 1 < src.length) inner += src[++i]
      else inner += src[i]
      i++
    }
    i++
    out.push(...lex(inner, nesting + 1))
    word.text += src.slice(start, i)
    word.isDynamic = true
  }

  const readDollar = (word: Word, isQuoted: boolean) => {
    const start = i
    const after = src[i + 1] ?? ''
    if (after === '(') {
      i += 2
      run(')')
    } else if (after === '{') {
      let open = 1
      i += 2
      while (open > 0) {
        if (i >= src.length) throw new Error('unclosed ${')
        if (src[i] === '\\') i++
        else if (src[i] === '{') open++
        else if (src[i] === '}') open--
        i++
      }
      out.push(...lex(src.slice(start + 2, i - 1), nesting + 1, true))
    } else if (after === "'" && !isQuoted) {
      i += 2
      while (src[i] !== "'") {
        if (i >= src.length) throw new Error('unclosed quote')
        i += src[i] === '\\' ? 2 : 1
      }
      i++
    } else if (after === '"' && !isQuoted) {
      i++
      return
    } else if (/[A-Za-z_]/.test(after)) {
      i += 2
      while (/[A-Za-z0-9_]/.test(src[i] ?? '')) i++
    } else if (/[0-9@*#?$!-]/.test(after)) {
      i += 2
    } else {
      word.text += '$'
      i++
      return
    }
    word.text += src.slice(start, i)
    word.isDynamic = true
  }

  const readDouble = (word: Word, stopsAtQuote: boolean) => {
    while (true) {
      if (i >= src.length) {
        if (stopsAtQuote) throw new Error('unclosed quote')
        return
      }
      const c = src[i]
      if (c === '"' && stopsAtQuote) {
        i++
        return
      }
      if (c === '\\') {
        const after = src[i + 1] ?? ''
        if (after !== '\n') word.text += after && '$`"\\'.includes(after) ? after : `\\${after}`
        i += 2
      } else if (c === '$') readDollar(word, true)
      else if (c === '`') readBacktick(word)
      else {
        word.text += c
        i++
      }
    }
  }

  const run = (closer?: string) => {
    let cmd: Word[] = []
    let word: Word | undefined
    let skipsWord = false
    let parens = 0
    let heredocs: { end: string; stripsTabs: boolean; isQuoted: boolean; cmd: Word[] }[] = []
    const endWord = () => {
      if (word && !skipsWord) cmd.push(word)
      if (word) skipsWord = false
      word = undefined
    }
    const endCommand = () => {
      endWord()
      if (cmd.length) out.push(cmd)
      cmd = []
    }
    const current = () => (word ??= { text: '', isDynamic: false, globAt: -1 })
    const readBodies = () => {
      for (const doc of heredocs) {
        const lines: string[] = []
        while (i < src.length) {
          const stop = src.indexOf('\n', i)
          const line = src.slice(i, stop < 0 ? src.length : stop)
          i = stop < 0 ? src.length : stop + 1
          if ((doc.stripsTabs ? line.replace(/^\t+/, '') : line) === doc.end) break
          lines.push(line)
        }
        const body = lines.join('\n')
        // Text in an unquoted heredoc is a document, but its substitutions still run.
        if (doc.cmd.some(w => SHELLS.has(nameOf(w)))) out.push(...lex(body, nesting + 1))
        else if (!doc.isQuoted) out.push(...lex(body, nesting + 1, true))
      }
      heredocs = []
    }

    while (i < src.length) {
      const c = src[i]
      if (c === '\n') {
        endCommand()
        i++
        readBodies()
      } else if (isBlank(c) || c === '\r') {
        endWord()
        i++
      } else if (c === '#' && !word) {
        while (i < src.length && src[i] !== '\n') i++
      } else if (c === ')' && closer && parens === 0) {
        endCommand()
        i++
        return
      } else if (c === '(' || c === ')') {
        if (c === '(') parens++
        else if (parens > 0) parens--
        endCommand()
        i++
      } else if (c === '<' || c === '>' || (c === '&' && src[i + 1] === '>')) {
        // A redirect's target isn't an argument, and a file descriptor before it isn't either.
        if (word && /^[0-9]+$/.test(word.text) && !word.isDynamic) word = undefined
        endWord()
        if (src.startsWith('<<<', i)) {
          i += 3
          skipsWord = true
        } else if (src.startsWith('<<', i)) {
          i += 2
          const stripsTabs = src[i] === '-'
          if (stripsTabs) i++
          while (isBlank(src[i] ?? '')) i++
          let end = ''
          let isQuoted = false
          while (i < src.length && !/[\s;|&()<>]/.test(src[i])) {
            if (`'"\\`.includes(src[i])) isQuoted = true
            else end += src[i]
            i++
          }
          heredocs.push({ end, stripsTabs, isQuoted, cmd })
        } else {
          i += c === '&' ? 2 : 1
          while (src[i] === '>' || src[i] === '&' || src[i] === '|') i++
          skipsWord = true
        }
      } else if (c === ';' || c === '&' || c === '|') {
        endCommand()
        i++
      } else if (c === '\\') {
        if (src[i + 1] !== '\n' && i + 1 < src.length) current().text += src[i + 1]
        i += 2
      } else if (c === "'") {
        const stop = src.indexOf("'", i + 1)
        if (stop < 0) throw new Error('unclosed quote')
        current().text += src.slice(i + 1, stop)
        i = stop + 1
      } else if (c === '"') {
        i++
        readDouble(current(), true)
      } else if (c === '$') {
        readDollar(current(), false)
      } else if (c === '`') {
        readBacktick(current())
      } else {
        const w = current()
        if ('*?[{'.includes(c) && w.globAt < 0) w.globAt = w.text.length
        w.text += c
        i++
      }
    }
    if (closer) throw new Error('unclosed substitution')
    endCommand()
    readBodies()
  }

  if (isText) readDouble({ text: '', isDynamic: false, globAt: -1 }, false)
  else run()

  return out
}

function nameOf(word: Word) {
  if (word.isDynamic && /\b(g?rm)\b/i.test(word.text)) return 'rm'

  return (word.text.split('/').pop() ?? '').toLowerCase()
}

function normalize(path: string) {
  const parts: string[] = []
  for (const part of path.split('/')) {
    if (part === '..') parts.pop()
    else if (part && part !== '.') parts.push(part)
  }

  return `/${parts.join('/')}`
}

// macOS treats differently cased and composed spellings as the same file.
const fold = (path: string) => path.normalize('NFC').toLowerCase()

function protectedAs(path: string, home: string) {
  const p = fold(path)
  const h = fold(normalize(home))
  if (p === '/' || p.lastIndexOf('/') === 0) return 'a top-level folder'
  if (p === h || h.startsWith(`${p}/`)) return 'your home folder'
  for (const name of ['.claude', '.agent-office']) {
    if (p === `${h}/${name}` || p.startsWith(`${h}/${name}/`)) return `~/${name}`
  }

  return undefined
}

const notLiteral = (shown: string) =>
  `Agent Office blocked this delete because \`${shown}\` isn't a literal path. A variable or command that comes back empty can delete a whole parent folder. ${ADVICE}`

const tooBroad = (shown: string, what: string) =>
  `Agent Office blocked this recursive delete because \`${shown}\` reaches ${what}. ${ADVICE} If it really must go, ask the person to run it themselves.`

function absolute(path: string, place: Place) {
  if (path === '~' || path.startsWith('~/')) return place.home + path.slice(1)
  if (path.startsWith('~')) return undefined
  if (path.startsWith('/')) return path
  if (place.cwd === undefined) return undefined

  return `${place.cwd}/${path}`
}

function checkTarget(word: Word, place: Place) {
  const hasGlob = word.globAt >= 0
  // A pattern can match anything beside it, so judge the folder it starts from.
  const literal = hasGlob ? word.text.slice(0, word.text.lastIndexOf('/', word.globAt) + 1) : word.text
  const full = absolute(literal, place)
  if (full === undefined) return notLiteral(word.text)
  const path = normalize(full)
  const what = protectedAs(path, place.home)
  if (what) return tooBroad(word.text, what)
  place.targets.push({ path, followsLast: hasGlob || word.text.endsWith('/'), shown: word.text })

  return undefined
}

function checkRm(args: Word[], isFromPipe: boolean, place: Place) {
  const paths: Word[] = []
  let isRecursive = false
  let isForced = false
  let isPastFlags = false
  for (const arg of args) {
    if (isPastFlags || !arg.text.startsWith('-') || arg.text === '-') paths.push(arg)
    else if (arg.text === '--') isPastFlags = true
    else if (arg.text.startsWith('--')) {
      if ('--recursive'.startsWith(arg.text)) isRecursive = true
      if ('--force'.startsWith(arg.text)) isForced = true
    } else {
      if (/[rR]/.test(arg.text)) isRecursive = true
      if (arg.text.includes('f')) isForced = true
    }
  }
  if (!isRecursive && !isForced) return undefined
  if (isFromPipe) return notLiteral('xargs rm')
  const dynamic = paths.find(path => path.isDynamic)
  if (dynamic) return notLiteral(dynamic.text)
  if (!isRecursive) return undefined
  for (const path of paths) {
    const refusal = checkTarget(path, place)
    if (refusal) return refusal
  }

  return undefined
}

function checkFind(args: Word[], place: Place, nesting: number) {
  const roots: Word[] = []
  let at = 0
  for (; at < args.length; at++) {
    const text = args[at].text
    if (text === '-f' && args[at + 1]) roots.push(args[++at])
    else if (!/^-[HLPEXdsx]+$/.test(text)) break
  }
  for (; at < args.length && !/^(-|\(|!)/.test(args[at].text); at++) roots.push(args[at])

  let isDeleting = false
  for (; at < args.length; at++) {
    const text = args[at].text
    if (text === '-delete') isDeleting = true
    else if (/^-(exec|execdir|ok|okdir)$/.test(text)) {
      let stop = at + 1
      while (stop < args.length && args[stop].text !== ';' && args[stop].text !== '+') stop++
      const inner = args.slice(at + 1, stop).filter(w => w.text !== '{}')
      if (inner.some(w => nameOf(w) === 'rm')) isDeleting = true
      const refusal = checkCommand(inner, place, nesting)
      if (refusal) return refusal
      at = stop
    }
  }
  if (!isDeleting) return undefined
  if (!roots.length) roots.push({ text: '.', isDynamic: false, globAt: -1 })
  const dynamic = roots.find(root => root.isDynamic)
  if (dynamic) return notLiteral(dynamic.text)
  for (const root of roots) {
    const refusal = checkTarget(root, place)
    if (refusal) return refusal
  }

  return undefined
}

function followCd(args: Word[], place: Place) {
  const to = args.find(arg => !/^-[LPe@]+$/.test(arg.text))
  if (!to) place.cwd = place.home
  else if (to.isDynamic || to.globAt >= 0 || to.text === '-') place.cwd = undefined
  else {
    const full = absolute(to.text, place)
    place.cwd = full === undefined ? undefined : normalize(full)
  }
}

function checkCommand(given: Word[], place: Place, nesting: number): string | undefined {
  let words = given
  let isFromPipe = false
  while (words.length) {
    const first = nameOf(words[0])
    if (ASSIGNMENT.test(words[0].text) || KEYWORDS.has(first)) {
      words = words.slice(1)
      continue
    }
    const valueFlags = WRAPPERS[first]
    if (valueFlags === undefined) break
    if (first === 'xargs') isFromPipe = true
    let at = 1
    while (at < words.length && words[at].text.startsWith('-') && words[at].text.length > 1) {
      const flag = words[at].text
      if (flag === '--') {
        at++
        break
      }
      at += flag.length === 2 && valueFlags.includes(flag[1]) ? 2 : 1
    }
    if (POSITIONAL_FIRST.has(first)) at++
    words = words.slice(at)
  }
  if (!words.length) return undefined

  const name = nameOf(words[0])
  const args = words.slice(1)
  if (name === 'rm' || name === 'grm') return checkRm(args, isFromPipe, place)
  if (name === 'find') return checkFind(args, place, nesting)
  if (name === 'cd' || name === 'pushd') followCd(args, place)
  else if (name === 'popd') place.cwd = undefined
  else if (name === 'eval') return checkScript(args.map(arg => arg.text).join(' '), place, nesting + 1)
  else if (SHELLS.has(name)) {
    const at = args.findIndex(arg => /^-[A-Za-z]*c[A-Za-z]*$/.test(arg.text))
    if (at >= 0 && args[at + 1]) return checkScript(args[at + 1].text, place, nesting + 1)
  }

  return undefined
}

function checkScript(script: string, place: Place, nesting: number) {
  for (const words of lex(script, nesting)) {
    const refusal = checkCommand(words, place, nesting)
    if (refusal) return refusal
  }

  return undefined
}

function judge(command: string, home: string, cwd: string): Judged {
  const place: Place = { home, cwd, targets: [] }

  return { refusal: checkScript(command, place, 0), targets: place.targets }
}

// True if a command might delete something once quotes are out of the way, which decides what a failed check does.
export const mentionsDelete = (command: unknown) =>
  typeof command === 'string' && /\b(g?rm)\b|-delete\b/i.test(command.replace(/['"\\]/g, ''))

export const REFUSED_UNCHECKED = `Agent Office blocked this delete because its safety check couldn't read the command. ${ADVICE}`

// The reason to refuse a Bash command, or nothing if it may run. Throws if the command can't be read.
export async function refuseDelete($: EngineInterface, command: string): Promise<string | undefined> {
  const home = await $.env.get('HOME')
  if (!home) {
    if (mentionsDelete(command)) throw new Error('no home folder')

    return undefined
  }
  const { refusal, targets } = judge(command, home, await $.session.cwd())
  if (refusal) return refusal

  // Links can lead a harmless spelling somewhere protected, or make the home folder look like somewhere else.
  const real = async (path: string) => (await $.fs.stat(path, { resolve: true }).catch(() => undefined))?.realPath
  const homes = targets.length ? [home, (await real(home)) ?? home] : []
  for (const target of targets) {
    const cut = target.path.lastIndexOf('/')
    const folder = target.followsLast ? target.path : target.path.slice(0, cut) || '/'
    const landed = await real(folder)
    if (!landed) continue
    const path = normalize(target.followsLast ? landed : `${landed}/${target.path.slice(cut + 1)}`)
    for (const each of homes) {
      const what = protectedAs(path, each)
      if (what) return tooBroad(target.shown, what)
    }
  }

  return undefined
}
