import type { EngineInterface } from 'claude-code'

// A safety net for Bash commands, not a guarantee: a script file or another language can still delete anything.
type Word = { text: string; isDynamic: boolean; isSplit: boolean; hasBrace: boolean; globAt: number }
type Target = { path: string; shown: string; isRecursive: boolean }
type Judged = { refusal?: string; place: Place }
type Place = { home: string; cwds: string[]; isCwdKnown: boolean; isHomeKnown: boolean; hasNewLink: boolean; holdsDelete: boolean; targets: Target[] }

const MAX_NESTING = 8
const SHELLS = new Set(['sh', 'bash', 'zsh', 'dash', 'ksh', 'csh', 'tcsh', 'fish'])
const KEYWORDS = new Set(['if', 'then', 'do', 'else', 'elif', 'while', 'until', '!', '{'])
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
  time: '',
  coproc: '',
  noglob: '',
  nocorrect: '',
  watch: 'dn',
  parallel: 'jnS',
}
const POSITIONAL_FIRST = new Set(['timeout'])
// Finding these after a wrapper beats parsing every wrapper's flags, which differ between systems.
const RUNS_OTHERS = new Set(['rm', 'grm', 'find', 'gfind', 'eval', ...SHELLS])
const MAX_BRACE_WORDS = 256
// Programs with their own rm command or that only print the word. For any other, rm and delete flags among its arguments count as a delete.
const NOT_LAUNCHERS = new Set(['git', 'docker', 'podman', 'kubectl', 'helm', 'gh', 'npm', 'yarn', 'pnpm', 'cargo', 'brew', 'conda', 'pip', 'grep', 'egrep', 'fgrep', 'rg', 'ag', 'ack', 'sed', 'awk', 'cat', 'ls', 'echo', 'printf', 'man', 'which', 'type', 'test', '['])
// An assignment or set that stores rm, for a variable to run later.
const STORES_DELETE = /(=|\bset\s+--)[^;&|\n]*\bg?rm\b/i
const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*\+?=/
const ADVICE = 'Write the literal path, check it with ls, and prefer moving it to a trash folder (mv <path> ~/.Trash/) over deleting it.'

// The shell keeps its folder between Bash calls, so folders from earlier commands count too.
const earlierFolders = new Set<string>()
let isEarlierFolderKnown = true

const isBlank = (c: string) => c === ' ' || c === '\t'
const newWord = (text = ''): Word => ({ text, isDynamic: false, isSplit: false, hasBrace: false, globAt: -1 })
// Syntax this reader doesn't model. A command that also mentions a delete is refused, and any other runs.
const unsure = (what: string) => new Error(`can't read ${what}`)

function decodeAnsi(raw: string) {
  return raw.replace(/\\(x[0-9a-fA-F]{1,2}|u[0-9a-fA-F]{1,4}|U[0-9a-fA-F]{1,8}|[0-7]{1,3}|.)/gs, (_, code: string) => {
    if (/^[xuU]./.test(code)) return String.fromCodePoint(parseInt(code.slice(1), 16))
    if (/^[0-7]/.test(code)) return String.fromCodePoint(parseInt(code, 8))

    return code
  })
}

function expandBraces(text: string): string[] {
  const match = /^(.*?)\{([^{}]*,[^{}]*)\}(.*)$/s.exec(text)
  if (!match) return [text]
  const words = match[2].split(',').flatMap(part => expandBraces(match[1] + part + match[3]))
  if (words.length > MAX_BRACE_WORDS) throw unsure('a large brace expansion')

  return words
}

// Reads a command the way a shell splits it, so quoted text, heredocs and comments don't count as commands.
function lex(src: string, nesting = 0, isText = false): Word[][] {
  if (nesting > MAX_NESTING) throw new Error('nested too deeply')
  const out: Word[][] = []
  let i = 0

  const readBacktick = (word: Word, isQuoted: boolean) => {
    const start = i++
    let inner = ''
    while (src[i] !== '`') {
      if (i >= src.length) throw new Error('unclosed backtick')
      if (src[i] === '\\' && i + 1 < src.length) {
        if (!'$`\\'.includes(src[i + 1])) throw unsure('a backslash in backticks')
        inner += src[++i]
      } else inner += src[i]
      i++
    }
    i++
    out.push(...lex(inner, nesting + 1))
    word.text += src.slice(start, i)
    word.isDynamic = true
    if (!isQuoted) word.isSplit = true
  }

  const readDollar = (word: Word, isQuoted: boolean) => {
    const start = i
    const after = src[i + 1] ?? ''
    if (after === '(') {
      if (src[i + 2] === '(') throw unsure('arithmetic')
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
      const inner = src.slice(start + 2, i - 1)
      if (/['"]/.test(inner)) throw unsure('quotes inside ${}')
      out.push(...lex(inner, nesting + 1, true))
    } else if (after === "'" && !isQuoted) {
      i += 2
      while (src[i] !== "'") {
        if (i >= src.length) throw new Error('unclosed quote')
        i += src[i] === '\\' ? 2 : 1
      }
      word.text += decodeAnsi(src.slice(start + 2, i))
      i++
      return
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
    if (!isQuoted) word.isSplit = true
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
      else if (c === '`') readBacktick(word, true)
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
    let isPiped = false
    let heredocs: { end: string; stripsTabs: boolean; isQuoted: boolean; cmd: Word[] }[] = []
    const endWord = () => {
      if (word && !skipsWord) cmd.push(word)
      if (word) skipsWord = false
      word = undefined
    }
    const readsScript = (words: Word[]) =>
      words.some(w => SHELLS.has(nameOf(w))) && !words.some(w => /^-[A-Za-z]*c[A-Za-z]*$/.test(w.text))
    const endCommand = () => {
      endWord()
      skipsWord = false
      if (cmd[0]?.text === 'case') throw unsure('a case statement')
      if (isPiped && readsScript(cmd)) throw unsure('a script piped into a shell')
      if (cmd.length) out.push(cmd)
      cmd = []
      isPiped = false
    }
    const current = () => (word ??= newWord())
    const readBodies = () => {
      for (const doc of heredocs) {
        const lines: string[] = []
        let isEnded = false
        while (i < src.length) {
          const stop = src.indexOf('\n', i)
          const line = src.slice(i, stop < 0 ? src.length : stop)
          i = stop < 0 ? src.length : stop + 1
          if ((doc.stripsTabs ? line.replace(/^\t+/, '') : line) === doc.end) {
            isEnded = true
            break
          }
          lines.push(line)
        }
        if (!isEnded) throw unsure('a heredoc with no end')
        const body = lines.join('\n')
        if (!doc.isQuoted && body.includes('\\\n')) throw unsure('a continued line in a heredoc')
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
        if (c === '(' && src[i + 1] === '(') throw unsure('arithmetic')
        if (c === '(') parens++
        else if (parens > 0) parens--
        endCommand()
        i++
      } else if (c === '<' || c === '>' || (c === '&' && src[i + 1] === '>')) {
        // A redirect's target isn't an argument, and a file descriptor before it isn't either.
        if (word && /^[0-9]+$/.test(word.text) && !word.isDynamic) word = undefined
        endWord()
        if (src[i + 1] === '(') throw unsure('process substitution')
        if (src.startsWith('<<<', i)) {
          if (readsScript(cmd)) throw unsure('a script given to a shell')
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
            if ('$`'.includes(src[i])) throw unsure('a computed heredoc end')
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
        if (c === '|' && src[i + 1] !== '|') isPiped = true
        i += c === '|' && src[i + 1] === '|' ? 2 : 1
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
        readBacktick(current(), false)
      } else {
        const w = current()
        if ('*?[{'.includes(c) && w.globAt < 0) w.globAt = w.text.length
        if (c === '{') w.hasBrace = true
        w.text += c
        i++
      }
    }
    if (closer) throw new Error('unclosed substitution')
    endCommand()
    readBodies()
  }

  if (isText) readDouble(newWord(), false)
  else run()

  return out
}

function nameOf(word: Word) {
  if (word.isDynamic && /\b(g?rm)\b/i.test(word.text)) return 'rm'

  return (word.text.replace(/^=/, '').split('/').pop() ?? '').toLowerCase()
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
  for (const name of ['.claude', '.agent-office', 'Library/Application Support/Claude']) {
    const folder = fold(`${h}/${name}`)
    if (p === folder || p.startsWith(`${folder}/`)) return `~/${name}`
  }

  return undefined
}

// A non-recursive pattern can still empty the session data, but it can't take a whole folder tree.
const mattersFor = (what: string | undefined, isRecursive: boolean) => (isRecursive || what?.startsWith('~/') ? what : undefined)

const notLiteral = (shown: string) =>
  `Agent Office blocked this delete because \`${shown}\` isn't a literal path. A variable or command that comes back empty can delete a whole parent folder. ${ADVICE}`

const tooBroad = (shown: string, what: string) =>
  `Agent Office blocked this recursive delete because \`${shown}\` reaches ${what}. ${ADVICE} If it really must go, ask the person to run it themselves.`

// Every place a path might mean. A cd can fail or sit in a subshell, so each folder seen so far counts.
function absolutes(path: string, place: Place) {
  if (path === '~' || path.startsWith('~/')) return place.isHomeKnown ? [place.home + path.slice(1)] : undefined
  if (path.startsWith('~')) return undefined
  if (path.startsWith('/')) return [path]
  if (!place.isCwdKnown) return undefined

  return place.cwds.map(cwd => `${cwd}/${path}`)
}

function checkTarget(word: Word, place: Place, isRecursive = true) {
  const hasGlob = word.globAt >= 0
  // What a pattern matches decides where a .. after it lands.
  if (hasGlob && /(^|\/)\.\.(\/|$)/.test(word.text.slice(word.globAt))) return notLiteral(word.text)
  // A pattern can match anything beside it, so judge the folder it starts from.
  const literal = hasGlob ? word.text.slice(0, word.text.lastIndexOf('/', word.globAt) + 1) : word.text
  const fulls = absolutes(literal, place)
  if (!fulls || place.hasNewLink) return notLiteral(word.text)
  for (const full of fulls) {
    const what = mattersFor(protectedAs(normalize(full), place.home), isRecursive)
    if (what) return tooBroad(word.text, what)
    place.targets.push({ path: full, shown: word.text, isRecursive })
  }

  return undefined
}

function checkRm(args: Word[], isFromPipe: boolean, place: Place) {
  const paths: Word[] = []
  let isRecursive = false
  let isForced = false
  let isPastFlags = false
  const split = args.find(arg => arg.isSplit)
  if (split) return notLiteral(split.text)
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
  if (isFromPipe) return notLiteral('xargs rm')
  const dynamic = paths.find(path => path.isDynamic && (isRecursive || isForced || path.globAt >= 0))
  if (dynamic) return notLiteral(dynamic.text)
  for (const path of isRecursive ? paths : paths.filter(path => path.globAt >= 0)) {
    const refusal = checkTarget(path, place, isRecursive)
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
      const hasShell = inner.some(w => SHELLS.has(nameOf(w)))
      if (inner.some(w => /^g?rm$/.test(nameOf(w)) || (hasShell && mentionsDelete(w.text)))) isDeleting = true
      const refusal = checkCommand(inner, place, nesting)
      if (refusal) return refusal
      at = stop
    }
  }
  if (!isDeleting) return undefined
  if (!roots.length) roots.push(newWord('.'))
  const dynamic = roots.find(root => root.isDynamic)
  if (dynamic) return notLiteral(dynamic.text)
  for (const root of roots) {
    const refusal = checkTarget(root, place)
    if (refusal) return refusal
  }

  return undefined
}

function followCd(args: Word[], place: Place) {
  const to = args.find(arg => !/^(-[LPe@]+|--)$/.test(arg.text))
  const fulls = !to ? absolutes('~', place) : to.isDynamic || to.globAt >= 0 || to.text === '-' ? undefined : absolutes(to.text, place)
  if (fulls) place.cwds.push(...fulls.map(normalize))
  else place.isCwdKnown = false
}

function checkScriptWord(word: Word | undefined, place: Place, nesting: number) {
  if (!word) return undefined
  if (word.isDynamic) throw unsure('a script held in a variable')

  return checkScript(word.text, place, nesting + 1)
}

const hasDeleteFlags = (word: Word) => /^-[A-Za-z]*([rR][A-Za-z]*f|f[A-Za-z]*[rR])|^--recursive/.test(word.text)

function checkCommand(given: Word[], place: Place, nesting: number): string | undefined {
  let words = given.flatMap(word =>
    word.hasBrace && !word.isDynamic
      ? expandBraces(word.text).map(text => ({ ...word, text, globAt: text.search(/[*?[{]/) }))
      : [word],
  )
  let isFromPipe = false
  // These change where a ~ or a relative path leads.
  if (words.some(word => /^(HOME|CDPATH)\+?=/.test(word.text))) {
    place.isHomeKnown = false
    place.isCwdKnown = false
  }
  while (words.length) {
    const first = nameOf(words[0])
    if (ASSIGNMENT.test(words[0].text) || KEYWORDS.has(first)) {
      words = words.slice(1)
      continue
    }
    if (first === 'function') {
      words = words.slice(2)
      continue
    }
    const valueFlags = WRAPPERS[first]
    if (valueFlags === undefined) break
    if (first === 'xargs') isFromPipe = true
    if ((first === 'env' || first === 'sudo') && words.some(w => /^(-C|-D|--chdir)/.test(w.text))) place.isCwdKnown = false
    const split = first === 'env' ? words.findIndex(w => /^(-S|--split-string)/.test(w.text)) : -1
    if (split > 0) {
      const inline = words[split].text.replace(/^(-S|--split-string=?)/, '')
      return checkScriptWord(inline ? { ...words[split], text: inline } : words[split + 1], place, nesting)
    }
    const inner = words.findIndex((w, k) => k > 0 && RUNS_OTHERS.has(nameOf(w)))
    if (inner > 0) {
      words = words.slice(inner)
      continue
    }
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
  if (name === 'find' || name === 'gfind') return checkFind(args, place, nesting)
  // A program named by a variable can be rm, if rm was stored earlier or it's given rm's flags.
  if (words[0].isDynamic && (place.holdsDelete || args.some(hasDeleteFlags))) throw unsure('a program named by a variable')
  if (!NOT_LAUNCHERS.has(name) && !SHELLS.has(name)) {
    const rm = args.findIndex(arg => /^g?rm$/.test(nameOf(arg)))
    if (rm >= 0 && args.slice(rm + 1).some(hasDeleteFlags)) return checkRm(args.slice(rm + 1), isFromPipe, place)
    const find = args.findIndex(arg => /^g?find$/.test(nameOf(arg)))
    if (find >= 0 && args.slice(find + 1).some(arg => arg.text === '-delete')) return checkFind(args.slice(find + 1), place, nesting)
  }
  if (name === 'cd' || name === 'pushd' || name === 'chdir') followCd(args, place)
  else if (name === 'popd') place.isCwdKnown = false
  else if (name === 'ln') place.hasNewLink = true
  else if (name === 'trap') return checkScriptWord(args.find(arg => !arg.text.startsWith('-')), place, nesting)
  else if (name === 'eval') {
    const parts = args.filter(arg => arg.text !== '--')
    if (parts.some(arg => arg.isDynamic)) throw unsure('a script held in a variable')

    return checkScript(parts.map(arg => arg.text).join(' '), place, nesting + 1)
  } else if ((name === 'source' || name === '.') && args.some(arg => /^\/dev\/(stdin|fd)/.test(arg.text))) {
    throw unsure('a script read from stdin')
  }
  else if (SHELLS.has(name)) {
    const at = args.findIndex(arg => /^-[A-Za-z]*c[A-Za-z]*$/.test(arg.text))
    if (at >= 0) return checkScriptWord(args.slice(at + 1).find(arg => arg.text !== '--'), place, nesting)
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
  const place: Place = { home, cwds: [cwd, ...earlierFolders], isCwdKnown: isEarlierFolderKnown, isHomeKnown: true, hasNewLink: false, holdsDelete: STORES_DELETE.test(command), targets: [] }

  return { refusal: checkScript(command, place, 0), place }
}

// True if a command might delete something once quotes are out of the way, which decides what a failed check does.
export const mentionsDelete = (command: unknown) =>
  typeof command === 'string' && /\bg?rm\b|-delete\b|(^|\s)-[A-Za-z]*([rR][A-Za-z]*f|f[A-Za-z]*[rR])|--recursive/i.test(command.replace(/['"\\]/g, ''))

export const REFUSED_UNCHECKED = `Agent Office blocked this delete because its safety check couldn't read the command. ${ADVICE}`

// The reason to refuse a Bash command, or nothing if it may run. Throws if the command can't be read.
export async function refuseDelete($: EngineInterface, command: string): Promise<string | undefined> {
  const home = await $.env.get('HOME')
  if (!home) {
    if (mentionsDelete(command)) throw new Error('no home folder')

    return undefined
  }
  const cwd = await $.session.cwd()
  const { refusal, place } = judge(command, home, cwd)
  if (refusal) return refusal
  const { targets } = place

  // Links can lead a harmless spelling somewhere protected, or make the home folder look like somewhere else.
  const real = async (path: string) => (await $.fs.stat(path, { resolve: true }).catch(() => undefined))?.realPath
  const homes = targets.length ? [home, (await real(home)) ?? home] : []
  for (const target of targets) {
    // The system follows a link before it applies a .. after it, so resolve what comes before the first one.
    const dots = `${target.path}/`.indexOf('/../')
    const before = dots > 0 ? await real(target.path.slice(0, dots)) : undefined
    const written = before ? normalize(before + target.path.slice(dots)) : target.path
    const cut = written.lastIndexOf('/')
    const last = written.slice(cut + 1)
    const followsLast = ['', '.', '..'].includes(last) || target.shown.search(/[*?[{]/) >= 0
    const landed = await real(followsLast ? written : written.slice(0, cut) || '/')
    if (!landed && !before) continue
    const path = normalize(!landed ? written : followsLast ? landed : `${landed}/${last}`)
    for (const each of homes) {
      const what = mattersFor(protectedAs(path, each), target.isRecursive)
      if (what) return tooBroad(target.shown, what)
    }
  }
  for (const folder of place.cwds) if (folder !== cwd) earlierFolders.add(folder)
  if (!place.isCwdKnown) isEarlierFolderKnown = false

  return undefined
}
