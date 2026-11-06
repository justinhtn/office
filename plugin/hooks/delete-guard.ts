import type { EngineInterface } from 'claude-code'

// A safety net for Bash commands, not a guarantee: a script file or another language can still delete anything.
// It's an allow-list. A command that mentions a delete runs only if every part of it is something this can vouch for.
type Word = { text: string; isDynamic: boolean; globAt: number }
// A command's words, with its own source text, the heredocs and here-strings fed to it, whether a pipe feeds it,
// whether what's fed to it holds a variable or substitution, and whether it writes a file.
type Command = Word[] & { text: string; stdin: string; isPiped: boolean; isFedDynamic: boolean; writesFile: boolean }
// The whole command as sent, and the parts of it that may write a file another part could run.
type Line = { text: string; writers: Command[] }
type Target = { path: string; shown: string }

const MAX_NESTING = 8
// Programs that may share a command with a delete, because they don't run their arguments.
const PLAIN_PROGRAMS = new Set(['cat', 'ls', 'echo', 'printf', 'grep', 'egrep', 'fgrep', 'rg', 'head', 'tail', 'wc', 'sort', 'uniq', 'cut', 'tr', 'tee', 'diff', 'stat', 'file', 'jq', 'pwd', 'date', 'basename', 'dirname', 'which', 'true', 'false', 'sleep', 'test', '[', '[[', 'mkdir', 'touch', 'cp', 'mv', 'cd', 'pushd', 'popd', 'git', 'gh', 'npm', 'pnpm', 'yarn', 'docker'])
// What these subcommands do with their arguments decides whether they can be vouched for.
const RUNS_ARGUMENTS = /^(exec|x|dlx|explore)$/
const PLAIN_GIT = /^(status|log|diff|show|add|commit|push|pull|fetch|branch|checkout|switch|merge|restore|reset|rm|mv|tag|stash|remote|rev-parse|ls-files|worktree|init|blame)$/
const PLAIN_GH = /^(pr|issue|api|run|repo|release|auth)$/
// Flags that make a listed program run another one.
const RUNS_A_PROGRAM = /^--(pre|hostname-bin|compress-program|upload-pack|receive-pack|exec)\b/
// Predicates of find whose value is only compared, so it may be a variable.
const FIND_VALUES = /^-(name|iname|path|ipath|regex|iregex|newer|size|mtime|mmin|type|maxdepth|mindepth|user|group|perm)$/
const PLAIN_DOCKER = /^(rm|rmi|ps|images|logs|stop)$/
const READERS = new Set(['cat', 'ls', 'grep', 'egrep', 'fgrep', 'rg', 'head', 'tail', 'wc', 'stat', 'file'])
const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*\+?=/
const ADVICE = 'Run the delete as its own command with the full literal path, starting with /. Check it with ls first, and prefer moving it to a trash folder (mv <path> ~/.Trash/) over deleting it.'

// Anything that could be a delete, once quotes are out of the way, including rm pieced together from variables.
// A pattern or variable counts only as the program itself, perhaps after assignments, redirections, a wrapper, !, { or a keyword, or inside a function body or case arm, but not a case pattern ending in ), followed anywhere on its line by a flag rm could use.
// rm counts as a word or a flag such as --rm, not inside a name like fix-rm-guard, and --delete-branch isn't a delete of files.
const MENTIONS_DELETE = /(?<![\w.]|[\w.]-)g?rm(?![\w.-])|(?<![\w.]|[\w.]-)trash(?![\w.-])|\bunlink\b|\brmtree\b|\brmdir\b|\bshred\b|\bsrm\b|(^|\s)--?delete(?!-branch)\b|--recursive|\br\$|\$\{[^}]*\}m\b|\)m\b|\bg?find\b[^;&|\n]*(\$\(|`)|\benv\b[^;&|\n]*\s-S|(^|[\n;&|()]|\s\{)\s*((!|\{|if|then|else|elif|do|while|until|coproc|repeat\s+\S+)\s+)*(([A-Za-z_]\w*\+?=\S*|\d*[<>]+&?\s*\S*)\s+)*(\$\(|`)[^\n]*\s(-[A-Za-z]*[rRf]|--rec)|(^|[\n;&|()]|\s\{)\s*((!|\{|if|then|else|elif|do|while|until|coproc|repeat\s+\S+)\s+)*(([A-Za-z_]\w*\+?=\S*|\d*[<>]+&?\s*\S*)\s+)*((sudo|doas|env|command|builtin|exec|eval|nohup|nice|time|timeout|xargs|arch|caffeinate|stdbuf|ionice|noglob|nocorrect|-|sh|bash|zsh|dash|ksh)\s+(\S+\s+)*?)?(?!\[\[?\s|[A-Za-z_]\w*\+?=|\S*\)(\s|$))\S*[?*[]\S*(\s|$)|(^|[\n;&|()]|\s\{)\s*((!|\{|if|then|else|elif|do|while|until|coproc|repeat\s+\S+)\s+)*(([A-Za-z_]\w*\+?=\S*|\d*[<>]+&?\s*\S*)\s+)*((sudo|doas|env|command|builtin|exec|eval|nohup|nice|time|timeout|xargs|arch|caffeinate|stdbuf|ionice|noglob|nocorrect|-|sh|bash|zsh|dash|ksh)\s+(\S+\s+)*?)?(?!\[\[?\s|\{\s|[A-Za-z_]\w*\+?=|\S*\)(\s|$))(\S*[?*[{$`]\S*)[^;&|\n]*\s(-[A-Za-z]*[rRf]|--rec)/i

const isBlank = (c: string) => c === ' ' || c === '\t'
const newWord = (text = ''): Word => ({ text, isDynamic: false, globAt: -1 })
const newCommand = (): Command =>
  Object.assign([] as Word[], { text: '', stdin: '', isPiped: false, isFedDynamic: false, writesFile: false })
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
    let heredocs: { end: string; stripsTabs: boolean; isQuoted: boolean; owner: Command }[] = []
    const endWord = () => {
      if (word && isHereString) {
        cmd.stdin += `${word.text}\n`
        cmd.isFedDynamic ||= word.isDynamic
      }
      // Writing to a file descriptor or /dev/null leaves nothing for another program to run.
      if (word && isOutput) cmd.writesFile ||= word.isDynamic || !/^([0-9]+|-|\/dev\/null)$/.test(word.text)
      if (word && !skipsWord) cmd.push(word)
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
        doc.owner.stdin += `${body}\n`
        doc.owner.isFedDynamic ||= !doc.isQuoted && /[$`]/.test(body)
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
          heredocs.push({ end, stripsTabs, isQuoted, owner: cmd })
        } else {
          isOutput = c !== '<'
          i += c === '&' ? 2 : 1
          while (src[i] === '>' || src[i] === '&' || src[i] === '|') i++
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

function protectedAs(path: string, home: string) {
  // On macOS this prefix reaches the same files, and resolving links doesn't remove it.
  const p = fold(path).replace(/^\/system\/volumes\/data(?=\/)/, '')
  const h = fold(normalize(home))
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
  `Agent Office blocked this recursive delete because \`${shown}\` reaches ${what}. ${ADVICE} If it really must go, ask the person to run it themselves.`

const notVouched = (shown: string) =>
  `Agent Office blocked this command because it mentions a delete and also uses \`${shown}\`, which the safety check can't vouch for. ${ADVICE}`

function checkTarget(word: Word, home: string, targets: Target[]) {
  if (!word.text.startsWith('/') || /(^|\/)\.\.?(\/|$)/.test(word.text)) return notLiteral(word.text)
  const what = protectedAs(normalize(word.text), home)
  if (what) return tooBroad(word.text, what)
  targets.push({ path: word.text, shown: word.text })

  return undefined
}

// Also for programs that take a folder whole, such as trash and git worktree remove, which count as recursive.
function checkRm(args: Word[], home: string, targets: Target[], isAlwaysRecursive = false) {
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
  // Without recursion, literal names can only remove the files they name.
  if (!isRecursive) return undefined
  for (const path of paths) {
    const refusal = checkTarget(path, home, targets)
    if (refusal) return refusal
  }

  return undefined
}

function checkFind(args: Word[], home: string, targets: Target[]) {
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
    const refusal = checkTarget(root, home, targets)
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
  if (name === 'sed' && args.map(sedScript).some(text => !text.startsWith('-') && SED_RUNS.test(text))) return 'sed with its e command'
  // A script read from a file can't be checked, so it's treated like one that runs a command.
  if (name === 'sed' && args.some(arg => /^(-[nEsrzi]*f|--file)/.test(arg.text))) return 'sed with a script file'
  if (name === 'docker' && !PLAIN_DOCKER.test(args[0]?.text ?? '')) return `docker ${args[0]?.text ?? ''}`

  return undefined
}

function checkCommand(words: Word[], home: string, targets: Target[]) {
  const [program, ...args] = words
  if (ASSIGNMENT.test(program.text)) return notVouched(program.text)
  if (program.isDynamic || (program.globAt >= 0 && !TESTS.has(program.text))) return notVouched(program.text)
  const name = nameOf(program)
  if (REMOVERS.test(name)) return checkRm(args, home, targets)
  if (name === 'trash') return checkRm(args, home, targets, true)
  if (name === 'find' || name === 'gfind') return checkFind(args, home, targets)
  if (!PLAIN_PROGRAMS.has(name)) return notVouched(program.text)
  const first = args[0]?.text ?? ''
  const runner = runsArguments(name, args)
  if (runner) return notVouched(runner)
  if (name === 'git') {
    const at = gitCommandAt(args)
    const command = args[at]
    if (!command || !PLAIN_GIT.test(command.text)) return notVouched(`git ${command?.text ?? ''}`)
    if (isWorktreeRemove(args, at)) return checkRm(args.slice(at + 2), home, targets, true)
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
// Flags that make a program it can't vouch for delete files, such as rsync's and aws s3 sync's.
const DELETE_FLAGS = /^--?delete|^--remove-source-files/
// A delete an assignment can hold for a variable to run later.
const VALUE_DELETES = /\bg?rm\b|\bunlink\b|\brmtree\b|\brmdir\b|\bshred\b|\bsrm\b|(^|\s)--?delete|\$'/
// Programs whose job is to delete the files they're given.
const REMOVERS = /^(g?rm|unlink|rmdir|shred|srm)$/
const RCLONE_DELETES = /^(sync|move|moveto|delete|deletefile|purge|rmdir|rmdirs|cleanup|dedupe)$/
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

// Where git's subcommand is: the first word that isn't a flag or the folder given to -C.
const gitCommandAt = (args: Word[]) => args.findIndex((arg, k) => !arg.text.startsWith('-') && args[k - 1]?.text !== '-C')
const isWorktreeRemove = (args: Word[], at: number) => args[at]?.text === 'worktree' && args[at + 1]?.text === 'remove'

// git clean and git worktree remove delete files. A dry run of git clean doesn't.
function gitDeletes(args: Word[]) {
  const at = gitCommandAt(args)
  if (args[at]?.text === 'clean') return !args.slice(at + 1).some(arg => /^(-[A-Za-z]*n[A-Za-z]*|--dry-run)$/.test(arg.text))

  return isWorktreeRemove(args, at)
}

// What a command could run as code: its own text and what a heredoc or here-string feeds it. That's the whole line when
// its code could come from elsewhere in it: down a pipe to a program that reads code from one, through a variable or
// substitution among its words or input, or from a file another part of the line writes.
function codeOf(words: Command, readsPipe: boolean, line: Line) {
  const isFromFile = line.writers.some(other => other !== words)
  const isElsewhere = (words.isPiped && readsPipe) || words.isFedDynamic || words.some(word => word.isDynamic) || isFromFile

  return isElsewhere ? line.text : `${words.text}\n${words.stdin}`
}

// A shell or language given only flags reads its code from its input.
const readsCodeFromInput = (words: Command, at: number) => words.slice(at + 1).every(arg => arg.text.startsWith('-'))

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
  // A shell or language started by another program, such as uv run python, is read as that shell or language.
  const launched = [name, ...args.map(nameOf)]
  const language = launched.findIndex(each => LANGUAGES.test(each))
  if (language >= 0) {
    const code = codeOf(words, readsCodeFromInput(words, at + language), line)
    if (CODE_DELETES.test(code) || (BACKTICK_LANGUAGES.test(launched[language]) && RUNS_BACKTICKS.test(code))) return true
  }
  const shell = launched.findIndex(each => SHELLS.test(each))
  if (shell >= 0 && textMentionsDelete(codeOf(words, readsCodeFromInput(words, at + shell), line))) return true
  if (LANGUAGES.test(name)) return false
  if (REMOVERS.test(name) || name === 'trash') return true
  if (/^g?find$/.test(name)) return findMayDelete(args)
  if (name === 'git' && gitDeletes(args)) return true
  if (name === 'rclone' && args.some(arg => RCLONE_DELETES.test(arg.text))) return true
  // A program named by a variable or pattern could be rm. A pattern with no arguments is a case label.
  if (program.isDynamic && args.some(arg => /^-[A-Za-z]*[rRf]|^--rec/.test(arg.text))) return true
  if (program.globAt >= 0 && !TESTS.has(program.text) && (args.length > 0 || /[{/]/.test(program.text))) return true
  // Programs that only read their arguments as data delete nothing however their arguments read, as with gh's --delete-branch.
  if (DATA_PROGRAMS.has(name) && !program.isDynamic && !runsArguments(name, args)) return false
  if (args.some(arg => DELETE_WORDS.has(nameOf(arg)) || DELETE_FLAGS.test(arg.text))) return true
  // The reader can't tell a case pattern's ) from the end of a substitution, so a case reads the whole line.
  if (runsArguments(name, args) || name === 'case') return textMentionsDelete(line.text)

  // Any other program could run the text it's given.
  return textMentionsDelete(codeOf(words, !READS_PIPE_AS_DATA.has(name), line))
}

// Whether any part of a command might delete. It's read whole if the reader can't split it.
function anyMentionDelete(commands: Command[] | undefined, command: string) {
  if (!commands) return textMentionsDelete(command)
  // Text in the line reaches a file through >, tee, sed -i or a language's own code.
  const writes = (words: Command) => {
    const names = words.map(nameOf)
    const editsInPlace = names.includes('sed') && words.some(word => /^(-[A-Za-z]*i|--in-place)/.test(word.text))

    return words.writesFile || editsInPlace || names.some(each => each === 'tee' || LANGUAGES.test(each))
  }
  const line = { text: command, writers: commands.filter(writes) }

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

// The reason to refuse a Bash command, or nothing if it may run. Throws if a command that mentions a delete can't be read.
export async function refuseDelete($: EngineInterface, command: string): Promise<string | undefined> {
  const commands = read(command)
  if (!anyMentionDelete(commands, command)) return undefined
  const home = await $.env.get('HOME')
  if (!home) throw unsure('a command with no home folder')
  const targets: Target[] = []
  for (const words of commands ?? lex(command)) {
    const refusal = checkCommand(words, home, targets)
    if (refusal) return refusal
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
      const what = protectedAs(path, each)
      if (what) return tooBroad(target.shown, what)
    }
  }

  return undefined
}
