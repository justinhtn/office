import type { EngineInterface } from 'claude-code'

// A safety net for Bash commands, not a guarantee: a script file or another language can still delete anything.
// It's an allow-list. A command that mentions a delete runs only if every part of it is something this can vouch for.
type Word = { text: string; isDynamic: boolean; globAt: number }
// A command's words, with its own source text, the heredocs and here-strings fed to it, whether a pipe feeds it,
// whether what's fed to it holds a variable or substitution, whether it runs inside a group, subshell or loop,
// which passes on whatever is fed to the group, and whether it sends its output to a file.
type Command = Word[] & { text: string; stdin: string; isPiped: boolean; isFedDynamic: boolean; isNested: boolean; writesFile: boolean }
// The whole command as sent, its commands, whether any of them is fed by a pipe, heredoc or here-string, and the
// spellings of the one office-review it trusts.
type Line = { text: string; commands: Command[]; isFed: boolean; trusted: string[] }
type Target = { path: string; shown: string; isRecursive: boolean }

const MAX_NESTING = 8
// Programs that may share a command with a delete, because they don't run their arguments.
const PLAIN_PROGRAMS = new Set(['cat', 'ls', 'echo', 'printf', 'grep', 'egrep', 'fgrep', 'rg', 'head', 'tail', 'wc', 'sort', 'uniq', 'cut', 'tr', 'tee', 'diff', 'stat', 'file', 'jq', 'pwd', 'date', 'basename', 'dirname', 'which', 'true', 'false', 'sleep', 'test', '[', '[[', 'mkdir', 'touch', 'cp', 'mv', 'cd', 'pushd', 'popd', 'git', 'gh', 'npm', 'pnpm', 'yarn', 'docker'])
// What these subcommands do with their arguments decides whether they can be vouched for.
const RUNS_ARGUMENTS = /^(exec|x|dlx|explore)$/
const PLAIN_GIT = /^(status|log|diff|show|add|commit|push|pull|fetch|branch|checkout|switch|merge|restore|reset|rm|mv|tag|stash|remote|rev-parse|ls-files|worktree|init|blame)$/
const PLAIN_GH = /^(pr|issue|api|run|repo|release|auth)$/
// Flags that make a listed program run another one, including npm's shell for scripts and an editor, browser or pager.
const RUNS_A_PROGRAM = /^--(pre|hostname-bin|compress-program|upload-pack|receive-pack|exec|script-shell|shell|editor|browser|pager)\b/
// Predicates of find whose value is only compared, so it may be a variable.
const FIND_VALUES = /^-(name|iname|path|ipath|regex|iregex|newer|size|mtime|mmin|type|maxdepth|mindepth|user|group|perm)$/
const PLAIN_DOCKER = /^(rm|rmi|ps|images|logs|stop)$/
const READERS = new Set(['cat', 'ls', 'grep', 'egrep', 'fgrep', 'rg', 'head', 'tail', 'wc', 'stat', 'file'])
const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*\+?=/
const ADVICE = 'Run the delete as its own command with the full literal path, starting with /. Check it with ls first, and prefer moving it to a trash folder (mv <path> ~/.Trash/) over deleting it.'

// Anything that could be a delete, once quotes are out of the way, including rm pieced together from variables.
// A pattern or variable counts only as the program itself, perhaps after assignments, redirections, a wrapper, !, { or a keyword, or inside a function body or case arm, but not a case pattern ending in ), followed anywhere on its line by a flag rm could use.
// rm counts as a word or a flag such as --rm, not inside a name like fix-rm-guard. --delete and rsync's --del count, but not
// as --delete-branch or after git or gh, where they delete a branch rather than files.
const MENTIONS_DELETE = /(?<![\w.]|[\w.]-)g?rm(?![\w.-])|(?<![\w.]|[\w.]-)trash(?![\w.-])|\bunlink\b|\brmtree\b|\brmdir\b|\bshred\b|\bsrm\b|(?<!\b(git|gh)\s[^;&|\n]*)(^|\s)--?del(ete)?(?!-branch)\b|--recursive|\br\$|\$\{[^}]*\}m\b|\)m\b|\bg?find\b[^;&|\n]*(\$\(|`)|\benv\b[^;&|\n]*\s-S|(^|[\n;&|()]|\s\{)\s*((!|\{|if|then|else|elif|do|while|until|coproc|repeat\s+\S+)\s+)*(([A-Za-z_]\w*\+?=\S*|\d*[<>]+&?\s*\S*)\s+)*(\$\(|`)[^\n]*\s(-[A-Za-z]*[rRf]|--rec)|(^|[\n;&|()]|\s\{)\s*((!|\{|if|then|else|elif|do|while|until|coproc|repeat\s+\S+)\s+)*(([A-Za-z_]\w*\+?=\S*|\d*[<>]+&?\s*\S*)\s+)*((sudo|doas|env|command|builtin|exec|eval|nohup|nice|time|timeout|xargs|arch|caffeinate|stdbuf|ionice|noglob|nocorrect|-|sh|bash|zsh|dash|ksh)\s+(\S+\s+)*?)?(?!\[\[?\s|[A-Za-z_]\w*\+?=|\S*\)(\s|$))\S*[?*[]\S*(\s|$)|(^|[\n;&|()]|\s\{)\s*((!|\{|if|then|else|elif|do|while|until|coproc|repeat\s+\S+)\s+)*(([A-Za-z_]\w*\+?=\S*|\d*[<>]+&?\s*\S*)\s+)*((sudo|doas|env|command|builtin|exec|eval|nohup|nice|time|timeout|xargs|arch|caffeinate|stdbuf|ionice|noglob|nocorrect|-|sh|bash|zsh|dash|ksh)\s+(\S+\s+)*?)?(?!\[\[?\s|\{\s|[A-Za-z_]\w*\+?=|\S*\)(\s|$))(\S*[?*[{$`]\S*)[^;&|\n]*\s(-[A-Za-z]*[rRf]|--rec)/i

const isBlank = (c: string) => c === ' ' || c === '\t'
const newWord = (text = ''): Word => ({ text, isDynamic: false, globAt: -1 })
const newCommand = (): Command =>
  Object.assign([] as Word[], { text: '', stdin: '', isPiped: false, isFedDynamic: false, isNested: false, writesFile: false })
// Syntax this reader doesn't model, which makes a command it was checking a refusal.
const unsure = (what: string) => new Error(`can't read ${what}`)

function decodeAnsi(raw: string) {
  return raw.replace(/\\(x[0-9a-fA-F]{1,2}|u[0-9a-fA-F]{1,4}|U[0-9a-fA-F]{1,8}|[0-7]{1,3}|.)/gs, (_, code: string) => {
    if (/^[xuU]./.test(code)) return String.fromCodePoint(parseInt(code.slice(1), 16))
    if (/^[0-7]/.test(code)) return String.fromCodePoint(parseInt(code, 8))

    return code
  })
}

// Splits a command the way a shell does, so quoted text, heredocs and comments don't count as commands.
function lex(src: string, nesting = 0, isText = false): Command[] {
  if (nesting > MAX_NESTING) throw unsure('deep nesting')
  const out: Command[] = []
  let i = 0

  const readBacktick = (word: Word) => {
    const start = i++
    let inner = ''
    while (src[i] !== '`') {
      if (i >= src.length) throw unsure('an unclosed backtick')
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
        if (i >= src.length) throw unsure('an unclosed ${')
        if (src[i] === '\\') i++
        else if (src[i] === '{') open++
        else if (src[i] === '}') open--
        i++
      }
      const inner = src.slice(start + 2, i - 1)
      if (/['"]/.test(inner)) throw unsure('quotes inside ${}')
      if (inner.replace(/\$\{/g, '').includes('{') || inner.startsWith('(')) throw unsure('a brace or flag inside ${}')
      out.push(...lex(inner, nesting + 1, true))
    } else if (after === "'" && !isQuoted) {
      i += 2
      while (src[i] !== "'") {
        if (i >= src.length) throw unsure('an unclosed quote')
        i += src[i] === '\\' ? 2 : 1
      }
      word.text += decodeAnsi(src.slice(start + 2, i))
      // What the program receives can differ from the decoded text, such as at a NUL.
      word.isDynamic = true
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
  }

  const readDouble = (word: Word, stopsAtQuote: boolean) => {
    while (true) {
      if (i >= src.length) {
        if (stopsAtQuote) throw unsure('an unclosed quote')
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
    let cmd = newCommand()
    let start = i
    let word: Word | undefined
    let skipsWord = false
    let isHereString = false
    let isOutput = false
    let parens = 0
    // Groups and loops opened by { and do, which only count before the program.
    let blocks = 0
    let heredocs: { end: string; stripsTabs: boolean; isQuoted: boolean; owners: Command[] }[] = []
    // Input given before any word is fed either to the program after it or, after a ) or }, to the group that ended,
    // so it's recorded on both the coming command and the last one before it.
    const fedCommands = () => (cmd.length ? [cmd] : [cmd, ...out.slice(-1)])
    const feed = (owners: Command[], text: string, isDynamic: boolean) => {
      for (const owner of owners) {
        owner.stdin += `${text}\n`
        owner.isFedDynamic ||= isDynamic
      }
    }
    const endWord = () => {
      if (word && isHereString) feed(fedCommands(), word.text, word.isDynamic)
      // Output to a file descriptor or /dev/null leaves nothing for another program to run.
      if (word && isOutput) {
        for (const owner of fedCommands()) owner.writesFile ||= word.isDynamic || !/^([0-9]+|-|\/dev\/null)$/.test(word.text)
      }
      if (word && !skipsWord) {
        if (!word.isDynamic && cmd.every(each => BEFORE_PROGRAM.has(each.text))) {
          if (word.text === '{' || word.text === 'do') blocks++
          else if ((word.text === '}' || word.text === 'done') && blocks > 0) blocks--
        }
        cmd.push(word)
        cmd.isNested ||= parens + blocks > 0
      }
      if (word) skipsWord = isHereString = isOutput = false
      word = undefined
    }
    const endCommand = () => {
      endWord()
      skipsWord = isHereString = isOutput = false
      if (cmd.length) {
        cmd.text = src.slice(start, i)
        out.push(cmd)
        cmd = newCommand()
      }
      start = i
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
        feed(doc.owners, body, !doc.isQuoted && /[$`]/.test(body))
        if (!doc.isQuoted && body.includes('\\\n')) throw unsure('a continued line in a heredoc')
        // Text in an unquoted heredoc is a document, but its substitutions still run.
        if (!doc.isQuoted) out.push(...lex(body, nesting + 1, true))
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
        // The command before a ) is still inside it.
        endCommand()
        if (c === '(') parens++
        else if (parens > 0) parens--
        i++
      } else if (c === '<' || c === '>' || (c === '&' && src[i + 1] === '>')) {
        // A redirect's target isn't an argument, and a file descriptor before it isn't either.
        if (word && /^[0-9]+$/.test(word.text) && !word.isDynamic) word = undefined
        endWord()
        if (src[i + 1] === '(') throw unsure('process substitution')
        if (src.startsWith('<<<', i)) {
          i += 3
          skipsWord = isHereString = true
        } else if (src.startsWith('<<', i)) {
          i += 2
          const stripsTabs = src[i] === '-'
          if (stripsTabs) i++
          while (isBlank(src[i] ?? '')) i++
          const startOfEnd = i
          let end = ''
          let isQuoted = false
          while (i < src.length && !/[\s;|&()<>]/.test(src[i])) {
            if ('$`'.includes(src[i])) throw unsure('a computed heredoc end')
            if (`'"\\`.includes(src[i])) isQuoted = true
            else end += src[i]
            i++
          }
          // A quoted end can hold blanks that this scan stops at, so accept only a plain name.
          if (isQuoted && !/^(['"]?)[\w.-]+\1$|^\\[\w.-]+$/.test(src.slice(startOfEnd, i))) throw unsure('an unusual heredoc end')
          heredocs.push({ end, stripsTabs, isQuoted, owners: fedCommands() })
        } else {
          const from = i
          i += c === '&' ? 2 : 1
          while (src[i] === '>' || src[i] === '&' || src[i] === '|') i++
          // Anything but plain input can write the file, including <> which opens it for both.
          isOutput = src.slice(from, i).includes('>')
          skipsWord = true
        }
      } else if (c === '|' && src[i + 1] !== '|') {
        endCommand()
        i += src[i + 1] === '&' ? 2 : 1
        cmd.isPiped = true
      } else if (c === ';' || c === '&' || c === '|') {
        endCommand()
        i += c === '|' ? 2 : 1
      } else if (c === '\\') {
        if (src[i + 1] !== '\n' && i + 1 < src.length) current().text += src[i + 1]
        i += 2
      } else if (c === "'") {
        const stop = src.indexOf("'", i + 1)
        if (stop < 0) throw unsure('an unclosed quote')
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
    if (closer) throw unsure('an unclosed substitution')
    endCommand()
    readBodies()
  }

  if (isText) readDouble(newWord(), false)
  else run()

  return out
}

const nameOf = (word: Word) => (word.text.split('/').pop() ?? '').toLowerCase()

function normalize(path: string) {
  return `/${path.split('/').filter(part => part && part !== '.').join('/')}`
}

// macOS treats differently cased and composed spellings as the same file.
const fold = (path: string) => path.normalize('NFC').toLowerCase()

// A path written out, with . and .. worked out, from the folder it's relative to.
function resolve(path: string, from: string) {
  const parts: string[] = []
  for (const part of (path.startsWith('/') ? path : `${from}/${path}`).split('/')) {
    if (part === '..') parts.pop()
    else if (part && part !== '.') parts.push(part)
  }

  return `/${parts.join('/')}`
}

// Where a delete runs: the home folder, the folder relative paths start from, or nothing when a cd made that unclear,
// and the session's own worktree, if it's in one. Every other session's worktree is off limits.
type Scope = { home: string; base: string | undefined; ownWorktree: string | undefined }
const WORKTREE = /^(.*\/\.claude\/worktrees\/[^/]+)(?:\/|$)/
const worktreeOf = (path: string) => WORKTREE.exec(fold(path))?.[1]

// Another session's worktree, for any delete. For a recursive one, also a folder that holds worktrees: a repo's .claude
// or .claude/worktrees, or the repo holding the session's own worktree, or anything above it.
function otherWorktree(p: string, scope: Scope, isRecursive: boolean) {
  const tree = WORKTREE.exec(p)?.[1]
  if (tree && tree !== scope.ownWorktree) return "another session's worktree"
  if (!isRecursive) return undefined
  if (/\/\.claude(\/worktrees)?$/.test(p)) return "every session's worktrees"
  const repo = scope.ownWorktree?.replace(/\/\.claude\/worktrees\/[^/]+$/, '')
  if (repo && (p === repo || repo.startsWith(`${p}/`))) return "every session's worktrees"

  return undefined
}

function protectedAs(path: string, scope: Scope, isRecursive = true) {
  // On macOS this prefix reaches the same files, and resolving links doesn't remove it.
  const p = fold(path).replace(/^\/system\/volumes\/data(?=\/)/, '')
  const worktrees = otherWorktree(p, scope, isRecursive)
  if (worktrees || !isRecursive) return worktrees
  const h = fold(normalize(scope.home))
  if (p === '/' || p.lastIndexOf('/') === 0) return 'a top-level folder'
  if (p === h || h.startsWith(`${p}/`)) return 'your home folder'
  for (const name of ['.claude', '.agent-office', 'Library/Application Support/Claude']) {
    const folder = fold(`${h}/${name}`)
    if (p === folder || p.startsWith(`${folder}/`)) return `~/${name}`
  }

  return undefined
}

const notLiteral = (shown: string) =>
  `Agent Office blocked this delete because \`${shown}\` isn't a plain literal path. A variable, pattern or relative path can reach a folder nobody meant to delete. ${ADVICE}`

const tooBroad = (shown: string, what: string) =>
  `Agent Office blocked this delete because \`${shown}\` reaches ${what}. ${ADVICE} If it really must go, ask the person to run it themselves.`

const notVouched = (shown: string) =>
  `Agent Office blocked this command because it mentions a delete and also uses \`${shown}\`, which the safety check can't vouch for. ${ADVICE}`

function checkTarget(word: Word, scope: Scope, targets: Target[]) {
  if (!word.text.startsWith('/') || /(^|\/)\.\.?(\/|$)/.test(word.text)) return notLiteral(word.text)
  const what = protectedAs(normalize(word.text), scope)
  if (what) return tooBroad(word.text, what)
  targets.push({ path: word.text, shown: word.text, isRecursive: true })

  return undefined
}

// A place the shell knows but the guard doesn't: the last or current folder, another account's home, or a place in the
// folder stack, as with ~-, ~+, ~user, +1 and -1. And .. goes up from wherever a link led, which reading the path
// can't tell, so it's unclear too.
const UNCLEAR_PLACE = /^(~(?!\/|$)|[+-]\d|-$)|(^|\/)\.\.(\/|$)/
const expandHome = (text: string, home: string) => text.replace(/^~(?=\/|$)/, home)

// A delete that isn't recursive can only remove what it names, so only another session's worktree is off limits.
// A relative name counts from the folder the line's cd commands lead to, and can't be checked after an unclear one.
function checkFile(word: Word, scope: Scope, targets: Target[]) {
  const text = expandHome(word.text, scope.home)
  if (UNCLEAR_PLACE.test(word.text) || (!text.startsWith('/') && !scope.base)) return notLiteral(word.text)
  const path = resolve(text, scope.base ?? '/')
  const what = protectedAs(path, scope, false)
  if (what) return tooBroad(word.text, what)
  targets.push({ path, shown: word.text, isRecursive: false })

  return undefined
}

// Also for programs that take a folder whole, such as trash and git worktree remove, which count as recursive.
function checkRm(args: Word[], scope: Scope, targets: Target[], isAlwaysRecursive = false) {
  const unclear = args.find(arg => arg.isDynamic || arg.globAt >= 0)
  if (unclear) return notLiteral(unclear.text)
  const paths: Word[] = []
  let isRecursive = isAlwaysRecursive
  let isPastFlags = false
  for (const arg of args) {
    if (isPastFlags || !arg.text.startsWith('-') || arg.text === '-') paths.push(arg)
    else if (arg.text === '--') isPastFlags = true
    else if (arg.text.startsWith('--')) isRecursive ||= '--recursive'.startsWith(arg.text)
    else isRecursive ||= /[rR]/.test(arg.text)
  }
  for (const path of paths) {
    const refusal = isRecursive ? checkTarget(path, scope, targets) : checkFile(path, scope, targets)
    if (refusal) return refusal
  }

  return undefined
}

function checkFind(args: Word[], scope: Scope, targets: Target[]) {
  let at = 0
  while (at < args.length && /^-[HLPEXdsx]+$/.test(args[at].text)) at++
  const roots: Word[] = []
  for (; at < args.length && !/^(-|\(|!)/.test(args[at].text); at++) roots.push(args[at])
  const unclear = roots.find(root => root.isDynamic)
  if (unclear) return notLiteral(unclear.text)

  let isDeleting = false
  for (; at < args.length; at++) {
    const text = args[at].text
    if (args[at].isDynamic) return notVouched(text)
    if (FIND_VALUES.test(text)) at++
    else if (text === '-delete') isDeleting = true
    else if (/^-(exec|execdir|ok|okdir)$/.test(text)) {
      const program = args[at + 1]
      if (!program || program.isDynamic || !READERS.has(nameOf(program))) return notVouched(`find ${text}`)
    }
  }
  if (!isDeleting) return undefined
  if (!roots.length) return notLiteral('.')
  for (const root of roots) {
    if (root.globAt >= 0) return notLiteral(root.text)
    const refusal = checkTarget(root, scope, targets)
    if (refusal) return refusal
  }

  return undefined
}

// Arguments that make a program run another program or text. Both steps read them the same way.
function runsArguments(name: string, args: Word[]) {
  const runner = args.find(arg => RUNS_A_PROGRAM.test(arg.text))
  if (runner) return `${name} ${runner.text}`
  if (name === 'git' && args.some(arg => GIT_RUNS_TEXT.test(arg.text))) return 'git with a command it runs'
  if (GH.test(name) && args.some(arg => arg.text === '--' || GH_RUNS_TEXT.test(arg.text))) return `${name} with a command it runs`
  if (['npm', 'pnpm', 'yarn'].includes(name) && args.some(arg => RUNS_ARGUMENTS.test(arg.text))) return `${name} exec`
  const yarnRuns = nameOf(args.find(arg => !arg.text.startsWith('-')) ?? newWord())
  const isYarnRunning = [YARN_RUNS, LANGUAGES, SHELLS].some(each => each.test(yarnRuns)) || DELETE_WORDS.has(yarnRuns)
  if (name === 'yarn' && isYarnRunning) return `yarn ${yarnRuns}`
  if (name === 'sed' && args.map(sedScript).some(text => !text.startsWith('-') && SED_RUNS.test(text))) return 'sed with its e command'
  // A script read from a file can't be checked, so it's treated like one that runs a command.
  if (name === 'sed' && args.some(arg => /^(-[nEsrzi]*f|--file)/.test(arg.text))) return 'sed with a script file'
  if (name === 'docker' && !PLAIN_DOCKER.test(args[0]?.text ?? '')) return `docker ${args[0]?.text ?? ''}`

  return undefined
}

// Follows a cd, pushd or popd, so relative names are read from where they lead. A cd to somewhere unclear leaves no base.
function followCd(words: Word[], scope: Scope) {
  const name = nameOf(words[0])
  if (!/^(cd|pushd|popd|chdir)$/.test(name)) return
  // Only -L, -P and -- are known flags. Any other flag, such as zsh's -q and -s, and a second word, as in zsh's
  // cd old new, which swaps old for new in the current path, leave the folder unclear.
  const targets: Word[] = []
  let isPastFlags = false
  let isKnown = true
  for (const word of words.slice(1)) {
    if (isPastFlags || !word.text.startsWith('-')) targets.push(word)
    else if (word.text === '--') isPastFlags = true
    else if (!/^-[LP]+$/.test(word.text)) isKnown = false
  }
  // A bare cd goes home. A bare pushd swaps the stack, and popd leaves for wherever the stack says.
  if (isKnown && !targets.length && /^(cd|chdir)$/.test(name)) {
    scope.base = normalize(scope.home)
    return
  }
  const target = targets.length === 1 && isKnown ? targets[0] : undefined
  const isClear = name !== 'popd' && target && !target.isDynamic && target.globAt < 0 && !UNCLEAR_PLACE.test(target.text)
  const text = isClear ? expandHome(target.text, scope.home) : ''
  scope.base = !isClear ? undefined : text.startsWith('/') ? resolve(text, '/') : scope.base && resolve(text, scope.base)
}

function checkCommand(words: Word[], scope: Scope, targets: Target[]) {
  const [program, ...args] = words
  if (ASSIGNMENT.test(program.text)) return notVouched(program.text)
  if (program.isDynamic || (program.globAt >= 0 && !TESTS.has(program.text))) return notVouched(program.text)
  const name = nameOf(program)
  if (REMOVERS.test(name)) return checkRm(args, scope, targets)
  if (name === 'trash') return checkRm(args, scope, targets, true)
  if (name === 'find' || name === 'gfind') return checkFind(args, scope, targets)
  if (!PLAIN_PROGRAMS.has(name)) return notVouched(program.text)
  const first = args[0]?.text ?? ''
  const runner = runsArguments(name, args)
  if (runner) return notVouched(runner)
  if (name === 'git') {
    const at = gitCommandAt(args)
    const command = args[at]
    if (!command || !PLAIN_GIT.test(command.text)) return notVouched(`git ${command?.text ?? ''}`)
    if (isWorktreeRemove(args, at)) return checkRm(args.slice(at + 2), scope, targets, true)
  }
  if (name === 'gh' && !PLAIN_GH.test(first)) return notVouched(`gh ${first}`)
  if (name === 'docker' && !PLAIN_DOCKER.test(first)) return notVouched(`docker ${first}`)

  return undefined
}

const withoutQuotes = (command: string) => command.replace(/\\\n|['"\\]/g, '')
// The same, but keeping each quoted value one word, so a quoted assignment can't make the program look like its second half.
const withQuotedWordsJoined = (command: string) =>
  withoutQuotes(command.replace(/(["'])(.*?)\1/gs, (_, quote: string, inner: string) => quote + inner.replace(/[\s;&|()<>]/g, '_') + quote))

// The whole command read as text, quotes and all. It's used wherever quoted text might be run.
const textMentionsDelete = (command: string) =>
  command.includes("$'") || MENTIONS_DELETE.test(withoutQuotes(command)) || MENTIONS_DELETE.test(withQuotedWordsJoined(command))

// Programs that only read their arguments as data, so delete words in quotes there don't count. Every other program
// is read as text, so an unlisted program that runs its arguments fails closed.
const DATA_PROGRAMS = new Set([...PLAIN_PROGRAMS, 'sed', 'curl', 'quinn-gh'])
const SHELLS = /^(sh|bash|zsh|dash|ksh|csh|tcsh|fish)$/
// Other languages are read for calls that delete or start a shell, so code that only names rm in its text runs.
const LANGUAGES = /^(python[\d.]*|pypy\d*|perl|ruby|node|deno|bun|php|lua|awk|gawk|mawk|nawk)$/
// Calls that need parentheses, and the ones Perl and Ruby make without them.
const CODE_DELETES =
  /\b(rmtree|remove|removedirs|unlinkSync|rmdir|rmdirSync|rm|rmSync|rm_rf|rm_r|rimraf|Popen|spawnSync|execSync|execFile|execFileSync|exec[lv]p?e?|shell_exec|passthru|proc_open)\s*\(|\b(system|exec|unlink|spawn|popen)\s*[("'`$@]|\bunlink\s+glob\b|\brmtree\b|\breadpipe\b|\bOpen3\b|\bos\.spawn|\bexeca\b|Deno\.(Command|run)\b|\|\s*getline\b|subprocess|\bchild_process\b|\bos\.exec|posix_spawnp?\s*\(|\|\s*"/
// GNU sed runs a shell with its e command, as an address's command or a flag of s.
const SED_RUNS = /(^|[\d$;}\s])e(\s|$)|[^\w\s\\][gpiImMw\d]*e[gpiImM\d]*(w.*|\s*#.*)?\s*(;|}|$)/m
// A script can be attached to its option, as in -e's/…/e' or --expression=….
const sedScript = (arg: Word) => arg.text.replace(/^(-[nEsrz]*e|--expression=)/, '')
// Keywords that come before the program without being one.
const BEFORE_PROGRAM = new Set(['!', '{', '}', 'if', 'then', 'else', 'elif', 'do', 'done', 'fi', 'while', 'until'])
const TESTS = new Set(['[', '[['])
const DELETE_WORDS = new Set(['rm', 'grm', 'unlink', 'rmdir', 'shred', 'srm', 'trash', 'rmtree', 'rimraf', '--recursive'])
// Flags that make a program it can't vouch for delete files, such as rsync's, including its --del, and aws s3 sync's.
const DELETE_FLAGS = /^--?del(ete)?\b|^--remove-source-files/
// A delete an assignment can hold for a variable to run later.
const VALUE_DELETES = /\bg?rm\b|\bunlink\b|\brmtree\b|\brmdir\b|\bshred\b|\bsrm\b|(^|\s)--?del(ete)?\b|\$'/
// Programs whose job is to delete the files they're given.
const REMOVERS = /^(g?rm|unlink|rmdir|shred|srm)$/
const RCLONE_DELETES = /^(sync|bisync|move|moveto|delete|deletefile|purge|rmdir|rmdirs|cleanup|dedupe)$/
// yarn runs a program it's given in place of one of its own commands, such as yarn node or yarn rimraf.
const YARN_RUNS = /^(node|exec|dlx)$/
// Programs outside the vouched list that read a pipe as data, never as code to run.
const READS_PIPE_AS_DATA = new Set(['xargs', 'less', 'more'])
// Perl, Ruby and PHP run a shell from backticks, qx and %x. In other languages a backtick is only text.
const BACKTICK_LANGUAGES = /^(perl|ruby|php)$/
const RUNS_BACKTICKS = /`|\bqx\s*[^\w\s]|%x\s*[^\w\s]/
// Words of git that make it run text it's given.
const GIT_RUNS_TEXT = /^(-c|--config.*|-u|config|submodule|bisect|rebase|filter-branch|difftool|clone|-O.*|--open-files-in-pager.*)$/
// quinn-gh is gh signed in as Asha, so it takes gh's rules.
const GH = /^(gh|quinn-gh)$/
const GH_RUNS_TEXT = /^(alias|extension)$/

// find deletes through -delete or a program it runs, and a substitution or a variable among its predicates could supply either.
function findMayDelete(args: Word[]) {
  let hasPredicates = false
  for (const [k, arg] of args.entries()) {
    if (/^-(delete|exec|execdir|ok|okdir)$/.test(arg.text) || /\$\(|`/.test(arg.text)) return true
    if (arg.isDynamic && hasPredicates && !FIND_VALUES.test(args[k - 1]?.text ?? '')) return true
    if (arg.text.startsWith('-')) hasPredicates = true
  }

  return false
}

// git's flags that take the next word as their value.
const GIT_VALUE_FLAGS = /^(-C|-c|--git-dir|--work-tree|--namespace|--exec-path|--super-prefix|--config-env|--list-cmds)$/
// Where git's subcommand is: the first word that isn't a flag or a flag's value.
const gitCommandAt = (args: Word[]) =>
  args.findIndex((arg, k) => !arg.text.startsWith('-') && !GIT_VALUE_FLAGS.test(args[k - 1]?.text ?? ''))
const isWorktreeRemove = (args: Word[], at: number) => args[at]?.text === 'worktree' && args[at + 1]?.text === 'remove'

// A dry run of git clean, read the way git does: an e in a cluster of flags takes the rest, or the next word, as a
// pattern to exclude, and nothing after -- is a flag.
function isDryRun(args: Word[]) {
  for (let k = 0; k < args.length; k++) {
    const text = args[k].text
    if (text === '--') return false
    if (text === '--dry-run') return true
    if (text === '--exclude') k++
    else if (/^-[A-Za-z]+$/.test(text)) {
      const at = text.indexOf('e')
      if ((at < 0 ? text : text.slice(0, at)).includes('n')) return true
      if (at === text.length - 1) k++
    }
  }

  return false
}

// git clean and git worktree remove delete files. A dry run of git clean doesn't.
function gitDeletes(args: Word[]) {
  const at = gitCommandAt(args)
  if (args[at]?.text === 'clean') return !isDryRun(args.slice(at + 1))

  return isWorktreeRemove(args, at)
}

// The flag after which each language takes its code as an argument, rather than from a file or its input.
const CODE_FLAGS: [RegExp, RegExp][] = [
  [/^(python[\d.]*|pypy\d*)$/, /^-[A-Za-z]*c$/],
  [/^perl$/, /^-[A-Za-z]*[eE]$/],
  [/^(ruby|lua)$/, /^-[A-Za-z]*e$/],
  [/^(node|bun)$/, /^(-[A-Za-z]*[ep]|--eval|--print)$/],
  [/^php$/, /^-[A-Za-z]*r$/],
  [/^deno$/, /^eval$/],
  [SHELLS, /^-[A-Za-z]*c[A-Za-z]*$/],
]

// awk takes its program as its first argument, unless it's given a file.
function takesCodeArgument(program: string, after: Word[]) {
  if (/^[gmn]?awk$/.test(program)) return !after.some(arg => /^(-f|--file)/.test(arg.text)) && after.some(arg => !arg.text.startsWith('-'))
  const flag = CODE_FLAGS.find(([name]) => name.test(program))?.[1]

  return !!flag && after.some(arg => flag.test(arg.text))
}

// Programs in front of a shell or language that fill in its arguments, so its code, from their input.
const FILLS_ARGUMENTS = /^(xargs|parallel)$/
// Code that runs what it reads, which matters when its input could come from elsewhere in the line.
const RUNS_ITS_INPUT = /\b(eval|compile|execfile|runpy|Function|instance_eval|class_eval|module_eval)\b|\/dev\/(stdin|fd)|\/proc\/self\/fd/

// Whether a command's input could come from the line: a pipe or heredoc fed to it, or to a group it's in.
const isFed = (words: Command, line: Line) => words.isPiped || words.stdin !== '' || (words.isNested && line.isFed)
const ownText = (words: Command) => `${words.text}\n${words.stdin}`
const hasDynamic = (words: Command) => words.isFedDynamic || words.some(word => word.isDynamic)

// Programs that only read and print, so they can't put code in a file that another part of the line runs.
const READ_ONLY = new Set(['cat', 'ls', 'echo', 'printf', 'grep', 'egrep', 'fgrep', 'rg', 'head', 'tail', 'wc', 'sort', 'uniq', 'cut', 'tr', 'diff', 'stat', 'jq', 'pwd', 'date', 'basename', 'dirname', 'which', 'true', 'false', 'test', '[', '[[', 'cd', 'gh', 'quinn-gh'])
// The options through which a read-only program writes a file: its short letters, and its long names, which getopt
// also accepts shortened, as in --outp=FILE.
const WRITING_OPTIONS: Record<string, { short: string; long: string[] }> = {
  sort: { short: 'o', long: ['output'] },
  gh: { short: 'OD', long: ['output', 'dir', 'clone'] },
  'quinn-gh': { short: 'OD', long: ['output', 'dir', 'clone'] },
}
// gh commands that write files: cloning, checking out, downloading, syncing, forking and installing.
const GH_WRITES = /^(clone|checkout|download|sync|fork|install|upgrade|archive)$/

// Whether any option writes a file, read as getopt reads them: a letter anywhere in a cluster of short flags, with or
// without its value attached, and a long name or any start of it, with or without =. Nothing after -- is an option.
function hasWritingOption(args: Word[], short: string, long: string[]) {
  for (const { text } of args) {
    if (text === '--') return false
    const name = text.startsWith('--') ? text.slice(2).split('=')[0] : ''
    if (name && long.some(each => each.startsWith(name))) return true
    if (/^-[^-]/.test(text) && [...text.slice(1)].some(letter => short.includes(letter))) return true
  }

  return false
}

// Whether a command only reads: a read-only program, or only assignments, with no output to a file.
function isReadOnly(words: Command) {
  const program = words.find(word => !ASSIGNMENT.test(word.text) && !BEFORE_PROGRAM.has(word.text))
  if (words.writesFile) return false
  if (!program) return true
  const name = nameOf(program)
  const args = words.slice(words.indexOf(program) + 1)
  if (program.isDynamic || !READ_ONLY.has(name)) return false
  // A variable or substitution could become a writing option or operand, quoted or not, as "$x" can be -oFILE, and so
  // could a brace or pattern, as {-o,evil.py} becomes two words and * can match a file named -oFILE.
  if ((name === 'uniq' || name in WRITING_OPTIONS) && args.some(arg => arg.isDynamic || arg.globAt >= 0)) return false
  // uniq writes its second operand, where - stands for its input.
  if (name === 'uniq' && args.filter(arg => arg.text === '-' || !arg.text.startsWith('-')).length > 1) return false
  if (GH.test(name) && args.some(arg => GH_WRITES.test(arg.text))) return false
  const options = WRITING_OPTIONS[name]

  return !options || !hasWritingOption(args, options.short, options.long)
}

// What a shell or language at `k` among the launched programs could run: its own text only when its code is plainly an
// argument that nothing in front of it fills and no variable supplies, and everything else in the line only reads, so
// that code can't load a file the line writes. A shell given input could read more code from it, such as sh -c sh, and
// so could a language whose code runs what it reads. Otherwise its code could come from a file or input that the rest
// of the line supplies, so it's the whole line.
function codeOf(words: Command, at: number, launched: string[], k: number, line: Line) {
  const isArgument = takesCodeArgument(launched[k], words.slice(at + k + 1)) && !hasDynamic(words)
  const isFilled = launched.slice(0, k).some(each => FILLS_ARGUMENTS.test(each))
  const isAmongReaders = line.commands.every(other => other === words || isReadOnly(other))
  const own = ownText(words)
  const readsInput = isFed(words, line) && (SHELLS.test(launched[k]) || RUNS_ITS_INPUT.test(own))

  return isArgument && !isFilled && isAmongReaders && !readsInput ? own : line.text
}

function wordsMentionDelete(words: Command, line: Line) {
  let at = 0
  while (at < words.length && (ASSIGNMENT.test(words[at].text) || BEFORE_PROGRAM.has(words[at].text))) {
    // A value can hold a delete for a variable to run later.
    if (ASSIGNMENT.test(words[at].text) && VALUE_DELETES.test(withoutQuotes(words[at].text.replace(ASSIGNMENT, '')))) return true
    at++
  }
  if (words[at]?.text === 'function') at += 2
  while (at < words.length && BEFORE_PROGRAM.has(words[at].text)) at++
  const program = words[at]
  if (!program) return false
  const args = words.slice(at + 1)
  const name = nameOf(program).replace(/^=/, '')
  // A shell, language or git started by another program, such as uv run python or sudo git, is read as that program.
  const launched = [name, ...args.map(nameOf)]
  const language = launched.findIndex(each => LANGUAGES.test(each))
  if (language >= 0) {
    const code = codeOf(words, at, launched, language, line)
    if (CODE_DELETES.test(code) || (BACKTICK_LANGUAGES.test(launched[language]) && RUNS_BACKTICKS.test(code))) return true
  }
  const shell = launched.findIndex(each => SHELLS.test(each))
  if (shell >= 0 && textMentionsDelete(codeOf(words, at, launched, shell, line))) return true
  if (LANGUAGES.test(name)) return false
  if (REMOVERS.test(name) || name === 'trash') return true
  if (/^g?find$/.test(name)) return findMayDelete(args)
  const git = launched.indexOf('git')
  if (git >= 0 && (git === 0 || !DATA_PROGRAMS.has(name)) && gitDeletes(args.slice(git))) return true
  if (name === 'rclone' && args.some(arg => RCLONE_DELETES.test(arg.text))) return true
  // A program named by a variable or pattern could be rm. A pattern with no arguments is a case label.
  if (program.isDynamic && args.some(arg => /^-[A-Za-z]*[rRf]|^--rec/.test(arg.text))) return true
  if (program.globAt >= 0 && !TESTS.has(program.text) && (args.length > 0 || /[{/]/.test(program.text))) return true
  // Programs that only read their arguments as data delete nothing however their arguments read, as with gh's --delete-branch.
  if (DATA_PROGRAMS.has(name) && !program.isDynamic && !runsArguments(name, args)) return false
  // The main checkout's office-review reads its arguments as data too. Any other copy could do anything with them.
  if (line.trusted.includes(program.text)) return false
  if (args.some(arg => DELETE_WORDS.has(nameOf(arg)) || DELETE_FLAGS.test(arg.text))) return true
  // A program that reads its input as data could still run its own arguments, as xargs does.
  if (READS_PIPE_AS_DATA.has(name) && !hasDynamic(words) && !runsArguments(name, args)) return textMentionsDelete(ownText(words))

  // Any other program could run text from anywhere in the line: its arguments, its input, or a file the line writes.
  return textMentionsDelete(line.text)
}

// Whether any part of a command might delete. It's read whole if the reader can't split it.
function anyMentionDelete(commands: Command[] | undefined, command: string, trusted: string[] = []) {
  if (!commands) return textMentionsDelete(command)
  const line = { text: command, commands, isFed: commands.some(words => words.isPiped || words.stdin !== ''), trusted }

  return commands.some(words => wordsMentionDelete(words, line))
}

// A program kept in a variable at the very start, as in Q=/path/quinn-gh; $Q api …, is read as that program. Only when
// nothing else can change the variable: its name appears nowhere else but in $Q or ${Q}, and nothing is sourced or evaluated.
const LEADING_PROGRAM = /^\s*([A-Za-z_]\w*)=(['"]?)([\w./~+-]+)\2[ \t]*(;|&&|\n)/
const RUNS_OTHER_CODE = /(^|[\s;&|(){}`])(source|\.|eval)(\s|$)/

function resolveLeadingProgram(commands: Command[], command: string) {
  const lead = LEADING_PROGRAM.exec(command)
  if (!lead) return
  const [whole, name, , value] = lead
  const rest = command.slice(whole.length)
  const uses = new RegExp(`\\$(\\{${name}\\}|${name}\\b)`, 'g')
  if (new RegExp(`\\b${name}\\b`).test(rest.replace(uses, '')) || RUNS_OTHER_CODE.test(rest)) return
  for (const words of commands) {
    if (words[0]?.isDynamic && (words[0].text === `$${name}` || words[0].text === `\${${name}}`)) words[0] = newWord(value)
  }
}

// Splits a command for both steps, or nothing if the reader can't.
function read(command: string) {
  try {
    const commands = lex(command)
    resolveLeadingProgram(commands, command)

    return commands
  } catch {
    return undefined
  }
}

// True if a command might delete something, which is what puts it under this check at all.
// Quoted text, heredoc bodies and patterns are arguments, so they count only where a program can run them.
export function mentionsDelete(command: unknown) {
  if (typeof command !== 'string') return false

  return anyMentionDelete(read(command), command)
}

export const REFUSED_UNCHECKED = `Agent Office blocked this delete because its safety check couldn't read the command. ${ADVICE}`

// office-review posts reviews through fixed subcommands and reads every body from a file. Only the main checkout's copy
// is trusted, since a worktree's copy could be a pull request's own version, and only as written out in full, so a
// variable, substitution or pattern that could build it or its arguments is refused, delete or not.
const OFFICE_REVIEW = 'code/agent-office/scripts/office-review'
const OFFICE_REVIEW_COMMANDS = /^(status|reply|comment|review|verdict|-h|--help)$/
const REVIEW_ADVICE = `Run it as ~/${OFFICE_REVIEW} <subcommand> with each argument written out, and put the body in a file passed with --file.`
const trustedReview = (home: string | undefined) => (home ? [`${normalize(home)}/${OFFICE_REVIEW}`, `~/${OFFICE_REVIEW}`] : [])

function refuseOfficeReview(commands: Command[] | undefined, command: string, home: string | undefined) {
  if (!/office-review/i.test(command)) return undefined
  if (!commands) return `Agent Office blocked this office-review command because its safety check couldn't read it. ${REVIEW_ADVICE}`
  for (const words of commands) {
    const at = words.findIndex(word => !ASSIGNMENT.test(word.text) && !BEFORE_PROGRAM.has(word.text))
    const held = words.slice(0, at < 0 ? words.length : at).find(word => /office-review/i.test(word.text))
    if (held) return `Agent Office blocked this office-review command because \`${held.text}\` keeps it in a variable. ${REVIEW_ADVICE}`
    const program = words[at]
    if (!program) continue
    const args = words.slice(at + 1)
    // A program from a variable could be office-review when it's named in its path or given one of its subcommands.
    const looksLikeReview = /office-review/i.test(program.text) || OFFICE_REVIEW_COMMANDS.test(args[0]?.text ?? '')
    if (program.isDynamic && looksLikeReview) {
      return `Agent Office blocked this command because \`${program.text}\` could be office-review built from a variable or substitution. ${REVIEW_ADVICE}`
    }
    if (program.isDynamic || nameOf(program) !== 'office-review') continue
    if (!trustedReview(home).includes(program.text)) {
      return `Agent Office blocked this office-review command because \`${program.text}\` isn't the main checkout's copy, which is the only one trusted to post as the review App. ${REVIEW_ADVICE}`
    }
    const unclear = args.find(arg => arg.isDynamic || arg.globAt >= 0)
    if (unclear) return `Agent Office blocked this office-review command because \`${unclear.text}\` isn't written out in full. ${REVIEW_ADVICE}`
    if (!OFFICE_REVIEW_COMMANDS.test(args[0]?.text ?? '')) {
      return `Agent Office blocked this office-review command because \`${args[0]?.text ?? ''}\` isn't one of its subcommands: status, reply, comment, review and verdict. ${REVIEW_ADVICE}`
    }
  }

  return undefined
}

// Settings that make a trusted tool run a program later, when the guard can't see what it runs: gh's browser for --web,
// its pager and editor, git's pager, editor, hooks, helpers, drivers, tools and aliases, and npm's shells and editor.
// It's defense in depth: the same settings can be written straight into .git/config, gh's config.yml or .npmrc.
const GH_PROGRAM_KEYS = /^(browser|pager|editor)$/i
const GIT_PROGRAM_KEYS =
  /^(core\.(pager|editor|sshcommand|fsmonitor|askpass|gitproxy|hookspath|alternaterefscommand)|pager\..+|sequence\.editor|diff\.external|(diff|merge)\..+\.(textconv|command|driver)|(mergetool|difftool)\..+\.(cmd|path)|trailer\..+\.(command|cmd)|filter\..+\.(clean|smudge|process)|credential\.(.+\.)?helper|gpg\.(.+\.)?program|alias\..+|remote\..+\.(uploadpack|receivepack|proxy)|(web|browser|man|instaweb|sendemail)\..+|uploadpack\..+|receive\..+|interactive\.difffilter|include\.path|includeif\..+\.path)$/i
const NPM_PROGRAM_KEYS = /^(script-shell|shell|editor|browser|git|viewer|node-gyp|yarn-?path)$/i
// git config's flags that take the next word as their value.
const GIT_CONFIG_VALUES = /^(-f|--file|--blob|--type|--default|--comment|--value|--url)$/
const STORED_ADVICE = "The safety check can't see what it would run later. Ask the person to change that setting themselves."

// The settings a command stores: the key of each config set it makes, and whether a variable or pattern hides one.
function storedSettings(words: Word[]) {
  const at = words.findIndex(word => !ASSIGNMENT.test(word.text) && !BEFORE_PROGRAM.has(word.text))
  const name = at < 0 ? '' : nameOf(words[at])
  const args = words.slice(at + 1)
  const positional = (from: Word[], values: RegExp) =>
    from.filter((word, k) => !word.text.startsWith('-') && !values.test(from[k - 1]?.text ?? ''))
  if (GH.test(name) && args[0]?.text === 'config' && args[1]?.text === 'set') {
    const [key] = positional(args.slice(2), /^(-h|--host)$/)

    return key ? [{ tool: name, key, keys: GH_PROGRAM_KEYS }] : []
  }
  // A shell alias, or one starting with !, runs its text through a shell whenever it's used.
  // An expansion read from a file or input, with alias import or alias set … -, could be one too.
  if (GH.test(name) && args[0]?.text === 'alias' && /^(set|import)$/.test(args[1]?.text ?? '')) {
    const isShell = args[1].text === 'import' || args.slice(2).some(arg => /^(-s|--shell|-)$/.test(arg.text) || arg.text.startsWith('!'))

    return isShell ? [{ tool: name, key: newWord('a shell alias'), keys: /./ }] : []
  }
  if (['npm', 'pnpm', 'yarn'].includes(name)) {
    const first = positional(args, /(?!)/)
    const isSet = first[0]?.text === 'set' || (first[0]?.text === 'config' && first[1]?.text === 'set')
    if (!isSet) return []
    // Each pair is key=value or key value, and one set can take several.
    const keys: Word[] = []
    const pairs = first.slice(first[0]?.text === 'set' ? 1 : 2)
    for (let k = 0; k < pairs.length; k++) {
      keys.push(Object.assign({}, pairs[k], { text: pairs[k].text.split('=')[0] }))
      if (!pairs[k].text.includes('=')) k++
    }

    return keys.map(key => ({ tool: name, key, keys: NPM_PROGRAM_KEYS }))
  }
  if (name === 'git') {
    const command = gitCommandAt(args)
    if (args[command]?.text !== 'config') return []
    const rest = args.slice(command + 1)
    const READS_OR_REMOVES = /^(--(get|get-all|get-regexp|get-urlmatch|list|unset|unset-all|remove-section|rename-section|show-origin|show-scope|edit)|-l|-e)$/
    if (rest.some(word => READS_OR_REMOVES.test(word.text))) return []
    const [first, ...others] = positional(rest, GIT_CONFIG_VALUES)
    const isNewForm = /^(set|get|list|unset|edit|rename-section|remove-section)$/.test(first?.text ?? '')
    const [key, value] = isNewForm ? (first.text === 'set' ? others : []) : [first, others[0]]
    if (!key || !value) return []
    // The repo's own hooks folder, which this repo's setup asks for, stores nothing new.
    if (/^core\.hookspath$/i.test(key.text) && value.text === '.githooks' && !value.isDynamic) return []

    return [{ tool: 'git', key, keys: GIT_PROGRAM_KEYS }]
  }

  return []
}

function refuseStoredProgram(commands: Command[] | undefined, command: string) {
  if (!commands) return /\b(gh|quinn-gh|git|npm|pnpm|yarn)\b[^;&|\n]*\b(config|set)\b/.test(command) ? `Agent Office blocked this command because its safety check couldn't read whether it stores a program for a tool to run. ${STORED_ADVICE}` : undefined
  for (const words of commands) {
    for (const { tool, key, keys } of storedSettings(words)) {
      if (key.isDynamic || key.globAt >= 0 || keys.test(key.text)) {
        return `Agent Office blocked this command because it sets \`${key.text}\`, which makes ${tool} run a program later. ${STORED_ADVICE}`
      }
    }
  }

  return undefined
}

// The reason to refuse a Bash command, or nothing if it may run. Throws if a command that mentions a delete can't be read.
export async function refuseDelete($: EngineInterface, command: string): Promise<string | undefined> {
  const commands = read(command)
  const stored = refuseStoredProgram(commands, command)
  if (stored) return stored
  const reviewHome = /office-review/i.test(command) ? await $.env.get('HOME') : undefined
  const review = refuseOfficeReview(commands, command, reviewHome)
  if (review) return review
  if (!anyMentionDelete(commands, command, trustedReview(reviewHome))) return undefined
  const home = await $.env.get('HOME')
  if (!home) throw unsure('a command with no home folder')
  // Without its folder, a session has no worktree of its own and no base for relative names.
  // The worktree a session owns comes from its root, which a shell cd doesn't move, so a cd into another session's
  // worktree can't make it look like its own. Relative names still count from where the shell is.
  const cwd = await Promise.resolve($.session.cwd()).catch(() => undefined)
  const root = await Promise.resolve($.session.root()).catch(() => undefined)
  const base = cwd ? normalize(cwd) : undefined
  const scope: Scope = { home, base, ownWorktree: root ? worktreeOf(normalize(root)) : undefined }
  const targets: Target[] = []
  for (const words of commands ?? lex(command)) {
    const refusal = checkCommand(words, scope, targets)
    if (refusal) return refusal
    followCd(words, scope)
  }

  // Links can lead a harmless spelling somewhere protected, or make the home folder look like somewhere else.
  const real = async (path: string) => (await $.fs.stat(path, { resolve: true }).catch(() => undefined))?.realPath
  const homes = targets.length ? [home, (await real(home)) ?? home] : []
  for (const target of targets) {
    const followsLast = target.path.endsWith('/')
    const cut = target.path.lastIndexOf('/')
    const landed = await real(followsLast ? target.path : target.path.slice(0, cut) || '/')
    if (!landed) continue
    const path = normalize(followsLast ? landed : `${landed}/${target.path.slice(cut + 1)}`)
    for (const each of homes) {
      const what = protectedAs(path, { ...scope, home: each }, target.isRecursive)
      if (what) return tooBroad(target.shown, what)
    }
  }

  return undefined
}
