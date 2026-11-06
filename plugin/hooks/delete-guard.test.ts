import { expect, test } from 'claude-code/testing'

// Nothing here runs a command: the hook beneath the guard only records what would have reached the shell.
const HOME = '/Users/me'
const PROJECT = `${HOME}/code/app`
const LINKS: Record<string, string> = {
  '/tmp/links': `${HOME}/.claude/projects`,
  '/tmp/links/sub': `${HOME}/.claude/projects/sub`,
}

async function bash($: any, on: any, command: string, opts: { home?: string; cwd?: string } = {}) {
  const ran: string[] = []
  on('env.get', (_: unknown, e: { name: string }) => ({ value: e.name === 'HOME' ? (opts.home ?? HOME) : undefined }))
  on('session.cwd', () => ({ value: opts.cwd ?? PROJECT }))
  on('fs.stat', (_: unknown, e: { path: string }) => {
    const realPath = LINKS[e.path]
    if (!realPath) throw new Error('missing')

    return { value: { kind: 'dir', size: 0, mtimeMs: 0, isLink: true, realPath } }
  })
  on('tool.call', (_: unknown, e: { command: string }) => {
    ran.push(e.command)

    return { result: 'ran', text: 'ran' }
  })
  const answer = await $.tool.call({ tool: 'Bash', command })

  return { ran, deny: answer.deny as string | undefined }
}

const REFUSED: [string, string][] = [
  ['the command that wiped the transcripts', 'rm -rf ~/.claude/projects/"$D"'],
  ['an unquoted variable', 'rm -rf $D'],
  ['a braced variable', 'rm -rf "${D}/build"'],
  ['a command substitution', 'rm -rf "$(pwd)/build"'],
  ['a backtick substitution', 'rm -rf `pwd`/build'],
  ['force alone with a variable', 'rm -f "$tmp"'],
  ['flags swapped', 'rm -fr "$D"'],
  ['capital R', 'rm -Rf "$D"'],
  ['separate flags', 'rm -r -f "$D"'],
  ['long flags', 'rm --recursive --force "$D"'],
  ['a shortened long flag', 'rm --rec "$D"'],
  ['flags after the path', 'rm "$D" -rf'],
  ['a path after --', 'rm -rf -- "$D"'],
  ['a full path to rm', '/bin/rm -rf "$D"'],
  ['a backslashed rm', '\\rm -rf "$D"'],
  ['a quoted rm', '"rm" -rf "$D"'],
  ['a split rm', 'r\\m -rf "$D"'],
  ['rm in capitals', 'RM -rf "$D"'],
  ['sudo', 'sudo rm -rf "$D"'],
  ['sudo with a value flag', 'sudo -u root rm -rf "$D"'],
  ['command', 'command rm -rf "$D"'],
  ['env and an assignment', 'FOO=1 env BAR=2 rm -rf "$D"'],
  ['timeout', 'timeout 5 rm -rf "$D"'],
  ['after &&', 'ls && rm -rf "$D"'],
  ['after ;', 'ls; rm -rf "$D"'],
  ['after ||', 'ls || rm -rf "$D"'],
  ['after a newline', 'ls\nrm -rf "$D"'],
  ['after a pipe', 'ls | rm -rf "$D"'],
  ['in the background', 'rm -rf "$D" &'],
  ['in a subshell', '(rm -rf "$D")'],
  ['in a group', '{ rm -rf "$D"; }'],
  ['in a loop', 'for f in a b; do rm -rf "$f"; done'],
  ['in an if', 'if true; then rm -rf "$D"; fi'],
  ['inside a substitution', 'echo "$(rm -rf "$D")"'],
  ['inside backticks', 'echo `rm -rf $D`'],
  ['through sh -c', `sh -c 'rm -rf "$D"'`],
  ['through bash -lc', 'bash -lc "rm -rf \\"\\$D\\""'],
  ['through eval', `eval 'rm -rf "$D"'`],
  ['fed to a shell', 'bash <<EOF\nrm -rf "$D"\nEOF'],
  ['a substitution in an unquoted heredoc', 'cat <<EOF\n`rm -rf "$D"`\nEOF'],
  ['xargs rm', 'cat list | xargs rm -rf'],
  ['xargs with its own flags', 'cat list | xargs -n 1 rm -f'],
  ['xargs with a placeholder', 'cat list | xargs -I {} rm -rf {}'],
  ['xargs through a shell', `cat list | xargs sh -c 'rm -rf "$0"'`],
  ['a dynamic rm', '$(which rm) -rf "$D"'],
  ['find -delete on a variable', 'find "$D" -delete'],
  ['find -delete on a substitution', 'find $(pwd)/x -name y -delete'],
  ['find -exec rm on a variable', 'find "$D" -exec rm -rf {} +'],
  ['find -exec with a variable inside', `find . -exec sh -c 'rm -rf "$1"' _ {} \\;`],
  ['~/.claude', 'rm -rf ~/.claude'],
  ['inside ~/.claude', 'rm -r ~/.claude/projects'],
  ['~/.claude by its full path', `rm -rf ${HOME}/.claude/projects`],
  ['~/.claude with a trailing slash', 'rm -rf ~/.claude/'],
  ['~/.claude in capitals', 'rm -rf ~/.CLAUDE/projects'],
  ['~/.claude through ..', `rm -rf ${PROJECT}/../../.claude/projects`],
  ['~/.claude relatively', 'rm -rf ../../.claude'],
  ['~/.claude after cd', 'cd ~/.claude && rm -rf projects'],
  ['everything in ~/.claude', 'cd ~/.claude && rm -rf *'],
  ['~/.agent-office', 'rm -rf ~/.agent-office'],
  ['inside ~/.agent-office', 'rm -rf ~/.agent-office/front-desk'],
  ['home', 'rm -rf ~'],
  ['home by its full path', `rm -rf ${HOME}`],
  ['everything in home', 'rm -rf ~/*'],
  ['a pattern that can match ~/.claude', 'rm -rf ~/.cla*'],
  ['a brace that names ~/.claude', 'rm -rf ~/{.claude,code}'],
  ['the root', 'rm -rf /'],
  ['everything in the root', 'rm -rf /*'],
  ['a top-level folder', 'rm -rf /Users'],
  ['another top-level folder', 'rm -rf /tmp/'],
  ['everything in a top-level folder', 'rm -rf /tmp/*'],
  ['this folder when it is home', 'cd ~ && rm -rf .'],
  ['a path after an unknown cd', 'cd "$D" && rm -rf build'],
  ['another account by tilde', 'rm -rf ~other/x'],
  ['find -delete on ~/.claude', 'find ~/.claude -name "*.jsonl" -delete'],
  ['find -exec rm on ~/.claude', 'find ~/.claude -exec rm -f {} +'],
  ['find -delete after cd', 'cd ~/.claude && find . -delete'],
  ['a link into ~/.claude', 'rm -rf /tmp/links/sub'],
  ['a followed link into ~/.claude', 'rm -rf /tmp/links/'],
  ['process substitution', 'cat <(rm -rf ~/.claude)'],
  ['process substitution for output', 'echo >(rm -rf "$D")'],
  ['a quote hidden by ${}', 'echo ${x:-"}"}; rm -rf ~/.claude # "'],
  ['a quote hidden by backticks', "echo `echo \\'x; rm -rf ~/.claude; echo \\'`"],
  ['a case inside a substitution', 'echo "$(case x in x) rm -rf ~/.claude;; esac)"'],
  ['arithmetic that looks like a heredoc', '((x=1<<2))\nrm -rf ~/.claude'],
  ['a brace around the whole path', 'rm -rf {~/.claude,x}'],
  ['a brace around a full path', `rm -rf {${HOME}/.claude,x}`],
  ['a brace after a tilde', 'rm -rf ~{,/.claude}'],
  ['a brace around the flags', 'rm {-rf,~/.claude}'],
  ['a brace around the command', `{rm,-rf,${HOME}/.claude}`],
  ['an ansi-quoted piece of rm', "r$'m' -rf ~/.claude"],
  ['an ansi-quoted escape of rm', "$'\\x72m' -rf ~/.claude"],
  ['an empty substitution inside rm', 'r$()m -rf ~/.claude'],
  ['an empty variable inside rm', 'r${x}m -rf ~/.claude'],
  ['rm named by a variable', 'R=rm; $R -rf ~/.claude'],
  ['ansi-quoted flags', "rm $'-rf' ~/.claude"],
  ['flags in a variable', 'F=-rf; rm $F ~/.claude'],
  ['a long sudo flag with a value', 'sudo --user root rm -rf ~/.claude'],
  ['clustered sudo flags', 'sudo -nu root rm -rf ~/.claude'],
  ['a long timeout flag', 'timeout --signal KILL 5 rm -rf ~/.claude'],
  ['clustered xargs flags', 'find . -print0 | xargs -0n 1 rm -rf'],
  ['env -S', "env -S 'rm -rf ~/.claude'"],
  ['a function keyword', 'function f { rm -rf ~/.claude; }; f'],
  ['coproc', 'coproc rm -rf ~/.claude'],
  ['trap', "trap 'rm -rf ~/.claude' EXIT"],
  ['time with a flag', 'time -p rm -rf ~/.claude'],
  ['gfind', 'gfind ~/.claude -delete'],
  ['noglob', 'noglob rm -rf ~/.claude'],
  ['nocorrect', 'nocorrect rm -rf ~/.claude'],
  ['a zsh =rm', '=rm -rf ~/.claude'],
  ['find running rm through nice', 'find ~/.claude -exec nice rm -rf {} +'],
  ['find running rm through sudo', 'find ~/.claude -exec sudo rm -f {} \\;'],
  ['find running rm through a shell', `find ~/.claude -exec sh -c 'rm -rf "{}"' \\;`],
  ['an ansi-quoted -delete', "find ~/.claude -$'delete'"],
  ['a here-string to a shell', "bash <<< 'rm -rf ~/.claude'"],
  ['a pipe into a shell', "echo 'rm -rf ~/.claude' | sh"],
  ['a quoted heredoc piped to a shell', "cat <<'EOF' | sh\nrm -rf ~/.claude\nEOF"],
  ['cd with --', 'cd -- ~/.claude && rm -rf projects'],
  ['a cd in a subshell', 'cd ~/.claude; (cd /tmp/x); rm -rf projects'],
  ['a cd in a substitution', 'cd ~/.claude; echo $(cd /tmp/x); rm -rf projects'],
  ['a cd that may fail', 'cd ~/.claude; cd /nonexistent/x; rm -rf projects'],
  ['a link made in the same command', 'ln -s ~/.claude /tmp/x/l; rm -rf /tmp/x/l/projects'],
  ['.. after a link', 'rm -rf /tmp/links/../projects'],
  ['force with a pattern in ~/.claude', 'rm -f ~/.claude/projects/*/*.jsonl'],
  ['plain rm with a pattern in ~/.claude', 'rm ~/.claude/projects/*/*'],
  ['plain xargs rm', 'find ~/.claude/projects -type f | xargs rm'],
  ['a heredoc end in ansi quotes', "cat <<$'EOF'\nx\nEOF\nrm -rf ~/.claude"],
  ['a heredoc end split over two lines', 'cat <<EOF\nx\nEO\\\nF\nrm -rf ~/.claude'],
  ['.. after a pattern', 'rm -rf n*/../../../.claude/projects'],
  ['.. after a pattern in an absolute path', 'rm -rf /tmp/guard/*/../../../Users/me/.claude'],
  ['trap with --', "trap -- 'rm -rf ~/.claude' EXIT"],
  ['eval with --', "eval -- 'rm -rf ~/.claude'"],
  ['bash -c with --', "bash -c -- 'rm -rf ~/.claude'"],
  ['eval of a variable', `C='rm -rf ~/.claude'; eval "$C"`],
  ['sh -c of a variable', `C='rm -rf ~/.claude'; sh -c "$C"`],
  ['source from a here-string', "source /dev/stdin <<< 'rm -rf ~/.claude'"],
  ['dot from a heredoc', ". /dev/stdin <<'EOF'\nrm -rf ~/.claude\nEOF"],
  ['tcsh -c', "tcsh -c 'rm -rf ~/.claude'"],
  ['csh -c', "csh -c 'rm -rf ~/.claude'"],
  ['a changed HOME', 'HOME=~/.claude; rm -rf ~/projects'],
  ['a changed CDPATH', 'CDPATH=~; cd .claude && rm -rf projects'],
  ['chdir', 'chdir ~/.claude && rm -rf projects'],
  ['env -C', 'env -C ~/.claude rm -rf projects'],
  ['a stored rm with another flag first', 'R=rm; $R -v -rf ~/.claude'],
  ['rm stored in an array', 'a=(rm -rf); "${a[@]}" ~/.claude'],
  ['rm stored with set', 'set -- rm -rf ~/.claude; "$@"'],
  ['arch', 'arch -arm64 rm -rf ~/.claude'],
  ['repeat', 'repeat 1 rm -rf ~/.claude'],
  ['env -S joined to its script', "env -S'rm -rf ~/.claude'"],
  ['a split rm in unreadable syntax', '((1)); r${y}m -rf ~/.claude'],
  ['find -delete through a launcher', 'arch -arm64 find ~/.claude -delete'],
  ['force with an earlier pattern', 'rm -f ~/.cla*/projects/*/*.jsonl'],
  ['plain rm with a pattern on a dot folder', 'rm ~/.*/projects/*/*'],
  ['force with a pattern above home', 'rm -f /Users/*/.claude/projects/*/*.jsonl'],
  ['a loop of plain rm', 'for f in ~/.claude/projects/*/*.jsonl; do rm "$f"; done'],
  ['a read loop of plain rm', `find ~/.claude/projects -name '*.jsonl' | while read f; do rm "$f"; done`],
  ['a loop from a pattern of plain rm', 'for f in ~/.cla*/projects/*; do rm "$f"; done'],
  ['a lowercase cdpath', 'cdpath=(~); cd .claude && rm -rf projects'],
  ['HOME as a loop variable', 'for HOME in ~/.claude; do rm -rf ~/projects; done'],
  ['HOME from read', 'read HOME < f; rm -rf ~/projects'],
  ['recursion alone in a split rm', 'r${y}m -r ~/.claude'],
  ['a split rm with its start in a variable', 'x=r; ${x}m -r ~/.claude'],
  ['a stored rm with quotes inside', "R=r''m; $R -r ~/.claude"],
  ['separate flags on a split rm in unreadable syntax', '((1)); r${y}m -r -f ~/.claude'],
  ['a launcher with -r alone', 'arch -arm64 rm -r ~/.claude'],
  ['a launcher with a forced pattern', 'arch -arm64 rm -f ~/.claude/projects/*/*'],
  ['a launcher running a shell', "arch -arm64 sh -c 'rm -rf ~/.claude'"],
  ['a launcher running find', 'arch -arm64 find ~/.claude -exec rm -f {} +'],
  ['a launcher running xargs', 'arch -arm64 xargs rm -rf'],
  ['npm exec', 'npm exec -- rm -rf ~/.claude'],
  ['conda run', 'conda run rm -rf ~/.claude'],
  ['a relative path', 'rm -rf build'],
  ['a relative path after a literal cd', 'cd /tmp/guard-test && rm -rf build'],
  ['a project .claude folder by relative path', 'rm -rf .claude/worktrees/w'],
  ['a tilde path', 'rm -rf ~/.claude-old'],
  ['a pattern in a project', 'rm -rf /Users/me/code/app/build/*'],
  ['a plain pattern', 'rm *.log'],
  ['force with a pattern in a temp folder', 'rm -f /tmp/*.log'],
  ['plain rm of a variable', 'rm "$f"'],
  ['find -delete on a relative root', `find . -name '*.pyc' -delete`],
  ['find -exec rm on a literal root', 'find /tmp/guard-test/build -exec rm -f {} +'],
  ['find -exec running another program beside a delete', 'find /tmp/guard-test -exec sed -i s/rm/x/ {} +'],
  ['a pattern naming rm with -r alone', '/bin/r? -r ~/.claude'],
  ['a brace naming rm with -r alone', '/bin/r{m,} -r ~/.claude'],
  ['a program from a substitution with -r alone', '$(printf r; printf m) -r ~/.claude'],
  ['rmtree in another language', `python3 -c "import shutil; shutil.rmtree('/x')"`],
  ['rsync --delete', 'rsync -a --delete /tmp/a/ /tmp/b/'],
  ['a variable program with a recursive flag', '$GREP -rn foo "$DIR"'],
  ['a variable program with a force flag', '"$TAR" -xf a.tar -C "$D"'],
  ['an unknown program beside a delete', 'rm -rf /tmp/guard-test/build && make'],
  ['a test beside a delete in control flow', 'if [ -d /tmp/x/y ]; then rm -rf /tmp/x/y; fi'],
  ['docker run with --rm', 'docker run --rm img'],
  ['git -c with a delete in an alias', "git -c alias.x='!rm -rf ~/.claude' x"],
  ['awk running a delete', `awk 'BEGIN { system("rm -rf x") }'`],
  ['python running a delete', `python3 -c "import os; os.system('rm -rf x')"`],
  ['an assignment beside a delete', 'X=1; rm -rf /tmp/guard-test/build'],
  ['a variable assembled into rm with -r', 'x=r; y=m; $x$y -r ~/.claude'],
  ['variables assembled without an assignment here', '$x$y -r ~/.claude'],
  ['a bare brace inside ${}', 'echo ${x:-{}; rm -rf ~/.claude; echo }'],
  ['a zsh flag inside ${}', 'echo ${(e)x}; rm -f y'],
  ['a NUL in ansi quotes', "rm -rf $'/Users/me/.claude\\0/x'"],
  ['a heredoc end with a blank in quotes', "cat <<'E F'\nbody\nE F\nrm -rf ~/.claude # '\nE"],
  ['a heredoc end of an escaped blank', 'cat <<\\ E\n E\nrm -rf ~/.claude\n'],
  ['git submodule foreach', "git submodule foreach 'rm -rf ~/.claude'"],
  ['git bisect run', 'git bisect run rm -rf ~/.claude'],
  ['git rebase --exec', "git rebase --exec 'rm -rf ~/.claude' HEAD~1"],
  ['git config alias', "git config alias.x '!rm -rf ~/.claude'; git x"],
  ['git fetch --upload-pack', "git fetch --upload-pack='rm -rf ~/.claude' origin"],
  ['rg --pre', 'rg --pre rm x ~/.claude/projects'],
  ['sort --compress-program', 'sort --compress-program=rm x'],
  ['npm exec after a flag', 'npm --yes exec -- rm -rf ~/.claude'],
  ['pnpm exec after a flag', 'pnpm --silent exec rm -rf ~/.claude'],
  ['find given -delete by substitution', 'find ~/.claude $(echo -delete)'],
  ['find given -delete after a predicate', 'find ~/.claude -name x $(echo -delete)'],
  ['find given -delete in pieces', 'find ~/.claude $(printf %s- delete)'],
  ['a pattern program with the flag later', '/bin/r? -v -r ~/.claude'],
  ['a variable program with the flag later', '$x$y -v -r ~/.claude'],
  ['sudo with a variable program', 'sudo $x$y -r ~/.claude'],
  ['a line continuation inside rm', 'r\\\nm -r ~/.claude'],
  ['a variable program with a path and force flag', '"$HOME/bin/tool" -f "$CFG"'],
  ['the same folder through the data volume', 'rm -rf /System/Volumes/Data/Users/me/.claude/projects'],
  ['a pattern program with no flags', '/bin/r? ~/.claude/projects/*/*.jsonl'],
  ['a substitution program with the flag later', "$(printf '\\162\\155') -v -r ~/.claude"],
  ['a pattern program after !', '! /bin/r? -rf ~/.claude'],
  ['a pattern program in a group', '{ /bin/r? -rf ~/.claude; }'],
  ['a pattern program after then', 'if true; then /bin/r? -rf ~/.claude; fi'],
  ['a variable program after !', "x=$(printf '\\x72m'); ! $x -rf ~/.claude"],
  ['a pattern program after do', 'while true; do /bin/r? -r ~/.claude; done'],
  ['a substitution program after !', '! $(printf r; printf m) -r ~/.claude'],
  ['a substitution program after then', 'if true; then $(printf r; printf m) -r ~/.claude; fi'],
  ['a pattern program in a function body', 'f() { /bin/r? -rf ~/.claude; }; f'],
  ['a pattern program in a function keyword body', 'function g { /bin/r? -rf ~/.claude; }; g'],
  ['a variable program in a function body', 'f() { $x -rf ~/.claude; }; f'],
  ['a pattern program in a case arm', 'case x in x) /bin/r? -rf ~/.claude;; esac'],
  ['a pattern program after coproc', 'coproc /bin/r? -rf ~/.claude'],
  ['git clone --config', "git clone --config core.sshCommand='rm -rf ~/.claude #' git@github.com:a/b"],
  ['git clone -u', "git clone --no-local -u 'rm -rf ~/.claude;' /tmp/repo x"],
  ['gh repo clone passing flags to git', "gh repo clone a/b -- --config core.sshCommand='rm -rf ~/.claude #'"],
  ['the app session folder', 'rm -rf ~/Library/Application\\ Support/Claude'],
]

for (const [why, command] of REFUSED) {
  test(`refuses ${why}`, async ($, on) => {
    const { ran, deny } = await bash($, on, command)
    expect(ran).toEqual([])
    expect(deny).toMatch(/trash folder/)
  })
}

const ALLOWED: [string, string][] = [
  ['a full literal path in a worktree', `rm -rf ${PROJECT}/.claude/worktrees/w/build`],
  ['several full literal paths', '/bin/rm -rf /tmp/guard-test/a /tmp/guard-test/b'],
  ['a full literal path with spaces', 'rm -rf "/tmp/guard test/old build"'],
  ['a full path with a similar name', `rm -rf ${HOME}/.claude-old`],
  ['a full path beside plain programs', 'ls /tmp/guard-test && rm -rf /tmp/guard-test/build && git status'],
  ['a test before a delete', '[ -d /tmp/guard-test/b ] && rm -rf /tmp/guard-test/b'],
  ['a redirect target', 'rm -rf /tmp/guard-test/build > "$log" 2>&1'],
  ['plain rm of a relative file', 'rm notes.txt'],
  ['force with a relative file', 'rm -f notes.txt'],
  ['one file in ~/.claude without recursion', 'rm -f ~/.claude/old.json'],
  ['single quotes that keep $ literal', "rm -f 'cost$D'"],
  ['find -delete on a full literal root', `find /tmp/guard-test -name '*.pyc' -delete`],
  ['find -delete with a variable name', 'find /tmp/guard-test -name "$pattern" -delete'],
  ['find searching for the word rm', `find ~/.claude -name '*.jsonl' -exec grep -l 'rm -rf' {} +`],
  ['find that deletes nothing', 'find "$D" -name x'],
  ['find reading ~/.claude', 'find ~/.claude -name "*.jsonl" -exec cat {} \\;'],
  ['listing ~/.claude', 'ls -la ~/.claude "$D"'],
  ['other programs with an rm command', 'docker rm -f "$c"; git rm -rf "$f"; npm run rm; npm rm -f left-pad'],
  ['a command that only mentions rm', `grep -rn 'rm -rf "$D"' .; echo 'rm -rf ~/.claude'`],
  ['a double-quoted mention', 'echo "rm -rf ~/.claude"'],
  ['a comment', 'ls # rm -rf "$D"'],
  ['a commit message', `git commit -m "$(cat <<'EOF'\nStop rm -rf "$D" and don't touch ~/.claude\nEOF\n)"`],
  ['a pull request body about deletes', `gh pr create --body "$(cat <<'EOF'\nUse \`rm -rf "$D"\` and ((x)) with <(y) in {a,b}\nEOF\n)"`],
  ['an unquoted heredoc without substitutions', 'cat <<EOF\nrm -rf ~/.claude\nEOF'],
  ['ansi quotes elsewhere', "printf $'a\\n'"],
  ['an unrelated broken quote', "echo don't"],
  ['an ordinary command', 'npm test && git status'],
  ['arithmetic without a delete', 'echo $((1+2))'],
  ['a case without a delete', 'case x in x) echo y;; esac'],
  ['a pipe into a shell without a delete', 'cat setup.sh | sh'],
  ['a variable program with other flags', '"$PY" -m pytest'],
  ['a variable program with no flags', '"$VENV/bin/python" x.py'],
  ['a recursive copy in unreadable syntax', '((1)); cp -r a b'],
  ['find with xargs and no delete', `find . -name '*.py' -print0 | xargs wc -l`],
  ['find piped to a program', `find . -name '*.py' -print | python3 x.py`],
  ['a compiler with a pattern', 'gcc *.c -fPIC -o x'],
  ['curl with a variable', 'curl "$URL" -fsSL -o y'],
  ['curl with a question mark', "curl 'https://x/y?a=1' -fsS"],
  ['tar with a variable folder', 'tar -C "$D" -xf a.tar'],
  ['pytest with rm-like flags', 'pytest tests/test_*.py -rf'],
  ['a url that says soft-delete', 'curl https://x/soft-delete'],
  ['a test of a file beside a program', '[ -f /tmp/a ] && make'],
  ['git with -C beside a delete', 'git -C /tmp/x status && rm -f notes.txt'],
  ['a test with ! and no delete', 'if ! [ -f /tmp/a ]; then echo /tmp/*.log -f; fi'],
  ['a substitution then a pattern argument', 'echo $(date) /tmp/*.log -f'],
  ['a group with an ordinary program', '{ curl "$URL" -fsSL; }'],
  ['gh pr create beside a delete', 'gh pr view 30 && rm -f notes.txt'],
  ['a program with an unrelated assignment', 'FOO=1 npm test'],
]

for (const [why, command] of ALLOWED) {
  test(`allows ${why}`, async ($, on) => {
    const { ran, deny } = await bash($, on, command)
    expect(deny).toBeUndefined()
    expect(ran).toEqual([command])
  })
}

test('a home folder deeper than usual still protects the folders above it', async ($, on) => {
  const { deny } = await bash($, on, 'rm -rf /srv/people', { home: '/srv/people/me' })
  expect(deny).toMatch(/home folder/)
})

test('a delete that cannot be read is refused', async ($, on) => {
  const { ran, deny } = await bash($, on, `rm -rf 'build`)
  expect(ran).toEqual([])
  expect(deny).toMatch(/couldn't read/)
})

test('relative deletes are refused whatever an earlier call did to the folder', async ($, on) => {
  await bash($, on, 'cd ~/.claude && echo $((1+1))')
  const rm = await $.tool.call({ tool: 'Bash', command: 'rm -rf projects' })
  expect(rm.deny).toMatch(/plain literal path/)
})

function recordRuns(on: any) {
  const ran: string[] = []
  on('tool.call', (_: unknown, e: { command: string }) => {
    ran.push(e.command)

    return { result: 'ran', text: 'ran' }
  })

  return ran
}

test('a delete is refused when the home folder is unknown', async ($, on) => {
  on('env.get', () => ({ value: undefined }))
  const ran = recordRuns(on)
  const answer = await $.tool.call({ tool: 'Bash', command: 'rm -rf /tmp/guard-test/build' })
  expect(ran).toEqual([])
  expect(answer.deny).toMatch(/couldn't read/)
})

test('a delete is refused when the check itself fails', async ($, on) => {
  on('env.get', () => {
    throw new Error('no environment')
  })
  const ran = recordRuns(on)
  const answer = await $.tool.call({ tool: 'Bash', command: 'rm -rf /tmp/guard-test/build' })
  expect(ran).toEqual([])
  expect(answer.deny).toMatch(/couldn't read/)
})

test('other commands never reach the check', async ($, on) => {
  on('env.get', () => {
    throw new Error('no environment')
  })
  const ran = recordRuns(on)
  await $.tool.call({ tool: 'Bash', command: 'git status' })
  expect(ran).toEqual(['git status'])
})
