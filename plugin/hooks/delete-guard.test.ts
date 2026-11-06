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
  ['a pattern program after an assignment', 'x=1 /bin/r? -rf ~/.claude'],
  ['a variable program after an assignment', 'x=1 $y -rf ~/.claude'],
  ['an assignment before a program in a function body', 'f() { x=1 $y -rf ~/.claude; }; f'],
  ['a pattern program after several assignments', 'a=1 b=2 /bin/r? -rf ~/.claude'],
  ['a variable program after several assignments', 'a=1 b+=2 $y -rf ~/.claude'],
  ['a variable program after a double-quoted assignment', 'x="a b" $y -rf ~/.claude'],
  ['a pattern program after a single-quoted assignment', "x='a b' /bin/r? -rf ~/.claude"],
  ['a variable program after an assignment holding a separator', 'x="a;b" $y -rf ~/.claude'],
  ['a variable program after a redirection', '2>/dev/null $y -rf ~/.claude'],
  ['a variable program after an output redirection', '>/dev/null $y -rf ~/.claude'],
  ['a variable program after a closed input', '<&- $y -rf ~/.claude'],
  ['a pattern program after a redirection', '2>/dev/null /bin/r? -rf ~/.claude'],
  ['a variable program after an assignment and a redirection', 'x=1 >/dev/null $y -rf ~/.claude'],
  ['a variable program after a spaced redirection', '> /dev/null $y -rf ~/.claude'],
  ['eval of a variable program', 'eval "$y -rf ~/.claude"'],
  ['sh -c of a variable program', 'sh -c "$y -rf ~/.claude"'],
  ['bash -c of a variable program', 'bash -c "$y -rf ~/.claude"'],
  ['noglob with a variable program', 'noglob $y -rf ~/.claude'],
  ['nocorrect with a variable program', 'nocorrect $y -rf ~/.claude'],
  ['zsh - with a variable program', '- $y -rf ~/.claude'],
  ['stdbuf with a variable program', 'stdbuf -o0 $y -rf ~/.claude'],
  ['ionice with a variable program', 'ionice -c3 $y -rf ~/.claude'],
  ['a pattern program after repeat', 'repeat 1 /bin/r? -rf ~/.claude'],
  ['a variable program after repeat', 'repeat 1 $y -rf ~/.claude'],
  ['git clone --config', "git clone --config core.sshCommand='rm -rf ~/.claude #' git@github.com:a/b"],
  ['git clone -u', "git clone --no-local -u 'rm -rf ~/.claude;' /tmp/repo x"],
  ['gh repo clone passing flags to git', "gh repo clone a/b -- --config core.sshCommand='rm -rf ~/.claude #'"],
  ['a variable program after an assignment with an escaped blank', 'x=a\\ b $y -rf ~/.claude'],
  ['a variable program after an assignment from backticks', 'x=`echo a b` $y -rf ~/.claude'],
  ['a variable program after an assignment with a blank in ${}', 'x=${a:-b c} $y -rf ~/.claude'],
  ['a variable program after an assignment with an escaped quote', 'x="a\\"b c" $y -rf ~/.claude'],
  ['a delete hidden in a grep pattern that is then run', "grep -E 'x' f; sh -c 'rm -rf ~/.claude'"],
  ['python removing a file', `python3 -c "import os; os.remove('/Users/me/.claude/x')"`],
  ['python from a heredoc running a shell', "python3 - <<'EOF'\nimport subprocess\nsubprocess.run(['ls'])\nEOF"],
  ['node removing a folder', `node -e "require('fs').rmSync('/x', {recursive: true})"`],
  ['node removing through the promise api', `node -e "require('fs').promises.rm('/x', {recursive: true})"`],
  ['perl running a shell in backticks', "perl -e 'print `ls`'"],
  ['a delete held in a quoted assignment', 'RM="rm -rf"; $RM ~'],
  ['a whole delete held in an assignment', 'X="rm -rf $HOME"; $X'],
  ['rm and its flags held in two assignments', 'P=rm F=-rf; $P $F ~'],
  ['rm as a default value with flags in a variable', 'F=-rf; ${RM:-rm} $F ~'],
  ['an unlisted wrapper running /bin/rm', 'gtimeout 5 /bin/rm -rf ~'],
  ['taskpolicy running /bin/rm', 'taskpolicy -b /bin/rm -rf ~'],
  ['sandbox-exec running /bin/rm', 'sandbox-exec -n x /bin/rm -rf ~'],
  ['rsync --delete-after', 'rsync -a --delete-after empty/ ~/'],
  ['rsync --delete-excluded', 'rsync -a --delete-excluded /tmp/a/ ~/'],
  ['uv run python removing a folder', `uv run python -c "import shutil; shutil.rmtree('/Users/me/.claude')"`],
  ['poetry run python removing a folder', `poetry run python -c "import shutil; shutil.rmtree('/Users/me/.claude')"`],
  ['perl system without parentheses', `perl -e 'system "rm -rf ~"'`],
  ['ruby system without parentheses', `ruby -e 'system "rm -rf ~"'`],
  ['perl unlink of a pattern', `perl -e 'unlink glob "~/.claude/*"'`],
  ['node child_process exec', `node -e "require('child_process').exec('rm -rf ~')"`],
  ['php exec', `php -r 'exec("rm -rf ~");'`],
  ['awk piping into a shell', `awk 'BEGIN { print "rm -rf ~" | "sh" }'`],
  ['npx -c', "npx -c 'rm -rf ~'"],
  ['hyperfine running a delete', "hyperfine 'rm -rf /tmp/x'"],
  ['nix-shell --run', "nix-shell --run 'rm -rf ~'"],
  ['make with a delete in a variable', "make CMD='rm -rf ~'"],
  ['Rscript unlink', `Rscript -e 'unlink("~/.claude", recursive = TRUE)'`],
  ['GNU sed e command', "sed '1e rm -rf ~' f"],
  ['sed e flag on an addressed s', "sed '1s/^/rm -rf ~/e' f"],
  ['sed e flag on a pattern-addressed s', "sed '/x/s/.*/rm -rf ~/e' f"],
  ['sed e flag on a later s', "sed 'p;s/^.*$/rm -rf ~/e' f"],
  ['perl qx', "perl -e 'qx(rm -rf ~)'"],
  ['perl qx with braces', "perl -e 'qx{rm -rf ~}'"],
  ['ruby %x', "ruby -e '%x(rm -rf ~)'"],
  ['python asyncio subprocess shell', `python3 -c "import asyncio; asyncio.run(asyncio.create_subprocess_shell('rm -rf ~'))"`],
  ['python posix_spawn', `python3 -c "import os; os.posix_spawn('/bin/rm', ['rm', '-rf', '/x'], {})"`],
  ['git grep -O running a delete', `git grep -O"sh -c 'rm -rf ~'" x`],
  ['git grep --open-files-in-pager running a delete', `git grep --open-files-in-pager="rm -rf ~" x`],
  ['gh alias storing a delete', "gh alias set --shell wipe 'rm -rf ~'"],
  ['quinn-gh alias storing a delete', "~/.agent-office/quinn/quinn-gh alias set --shell wipe 'rm -rf ~'"],
  ['quinn-gh passing a delete after --', "~/.agent-office/quinn/quinn-gh repo clone a/b -- --config core.sshCommand='rm -rf ~'"],
  ['npm exec rimraf', 'npm exec -- rimraf ~'],
  ['sed with an e script attached to -e', "sed -e's/.*/rm -rf ~/e' f"],
  ['sed with an e command attached to -e after -n', "sed -n -e'1e rm -rf ~' f"],
  ['sed with an e script in --expression=', "sed --expression='s/.*/rm -rf ~/e' f"],
  ['sed e flag followed by w', "sed 's/.*/rm -rf ~/ew out' f"],
  ['sed e flag followed by a comment', "sed 's/.*/rm -rf ~/e # run' f"],
  ['sed with a spaced -e running a delete', "sed -e 's/.*/rm -rf ~/e' f"],
  ['sed with a spaced --expression running a delete', "sed --expression 's/.*/rm -rf ~/e' f"],
  ['sed -i with an attached -e running a delete', "sed -i -e's/.*/rm -rf ~/e' f"],
  ['sed with a script file beside delete text', "sed -f wipe.sed notes.txt && echo 'rm -rf ~'"],
  ['sed with an attached script file beside delete text', "sed -fwipe.sed notes.txt && echo 'rm -rf ~'"],
  ['sed with --file beside delete text', "sed --file=wipe.sed notes.txt && echo 'rm -rf ~'"],
  ['perl readpipe', `perl -e 'readpipe("rm -rf ~")'`],
  ['ruby Open3', `ruby -e 'require "open3"; Open3.capture2("rm -rf ~")'`],
  ['python os.spawnl', `python3 -c "import os; os.spawnl(os.P_WAIT, '/bin/rm', 'rm', '-rf', '/x')"`],
  ['node execa', `node -e "import('execa').then(m => m.execa('rm', ['-rf', '/x']))"`],
  ['deno Command', `deno eval "new Deno.Command('rm', { args: ['-rf', '/x'] }).outputSync()"`],
  ['awk getline from a command', `awk 'BEGIN { "rm -rf ~" | getline }'`],
  ['python rmtree held in a variable', `python3 -c "import shutil; f = shutil.rmtree; f('/x')"`],
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
  ['an assignment before make', 'X=1 make'],
  ['an assignment before make with a makefile', 'CC=clang make -j4 -f Makefile'],
  ['several assignments before make', 'a=1 b=2 make'],
  ['an assignment holding a pattern before node', 'DEBUG=* node app.js'],
  ['an assignment holding a path pattern before npm', 'FILES=src/*.ts npm test'],
  ['an assignment holding a question mark before make', 'X=a? make'],
  ['a quoted assignment before make', 'CFLAGS="-O2 -g" make -f Makefile'],
  ['a redirection before an ordinary program', '2>/dev/null curl "$URL" -fsSL'],
  ['a quoted assignment holding a pattern before npx', 'GLOB="src/**/*.ts" npx eslint -f json'],
  ['an assignment from a substitution before make', 'a=$(pwd) make -j4 -f Makefile'],
  ['an assignment extending PATH before make', 'PATH=$PATH:/x make -f Makefile'],
  ['an assignment before npm test with a passed flag', 'NODE_OPTIONS=--max-old-space-size=4096 npm test -- -f'],
  ['an assignment from a substitution before gh', 'TOKEN=$(cat t) gh pr view 30 -R a/b'],
  ['three assignments before python', 'a=1 b=2 c=3 python3 -m unittest -f'],
  ['repeat before make', 'repeat 3 make -f Makefile'],
  ['repeat before curl', 'repeat 3 curl -fsSL https://x/y'],
  ['a read-only search with patterns', 'cd /Users/houghton/code/agent-office && sed -n 160,200p server/server.py | grep -n -E "def |path|route|/sign|href|location" ; grep -n -E "\\"/(sign|face|passkey)[^\\"]*\\"" server/server.py | head -12'],
  ['a grep pattern naming rm', `grep -rn -e 'rm -rf "$D"' -e '-delete' plugin`],
  ['the review post that was refused, with its words', `cd /Users/houghton/code/agent-office/.claude/worktrees/quinn-desk-c1a072 && cat > /private/tmp/claude-501/-Users-houghton-code-agent-office--claude-worktrees-quinn-desk-c1a072/81ff4308-59db-424c-9ed2-b94a95942d9a/scratchpad/review35.json <<'EOF'
{
  "commit_id": "ec8c40b3b5819fb6dacd3f76abe0c7108b3feb84",
  "event": "COMMENT",
  "body": "<BODY 1: verdict summary> It refuses rm -rf and removes Face ID; set -e stays.",
  "comments": [
    {"path": "web/src/App.jsx", "line": 1118, "side": "RIGHT", "body": "<BODY 2: blocking finding> Remove the stale check."},
    {"path": "scripts/update.sh", "line": 38, "side": "RIGHT", "body": "<BODY 3: non-blocking finding>"}
  ]
}
EOF
~/.agent-office/quinn/quinn-gh api -X POST repos/justinhtn/office/pulls/35/reviews --input /private/tmp/claude-501/-Users-houghton-code-agent-office--claude-worktrees-quinn-desk-c1a072/81ff4308-59db-424c-9ed2-b94a95942d9a/scratchpad/review35.json --jq '.html_url'`],
  ['a review comment about deletes', `~/.agent-office/quinn/quinn-gh api repos/a/b/pulls/30/comments -f body='Blocking: rm -rf ~/.claude/projects/"$D" still passes, and so does find ~/.claude -delete.'`],
  ['a review comment from a heredoc', `~/.agent-office/quinn/quinn-gh pr comment 30 --body-file - <<'EOF'\nThe guard refuses rm -rf "$D" and x=1 $y -rf ~/.claude.\nEOF`],
  ['a commit message with patterns and pipes', `git commit -m "Refuse rm -rf /tmp/*|x and \\$(printf rm) -r"`],
  ['the python edit that was refused', `cd /Users/houghton/code/agent-office/.claude/worktrees/phone-split && python3 - <<'EOF'
def edit(p,pairs):
    s=open(p).read()
    for old,new in pairs:
        assert s.count(old)==1,(p,old)
        s=s.replace(old,new)
    open(p,'w').write(s)
edit('web/src/savedView.js',[
("// The split view, and which team is in each pane, are kept per device.\\n","// The split view, and which team is in each pane, are kept per device.\\n// isOn is null until the person turns split view on or off there, so the device's default applies until then.\\n// Layouts saved before that was recorded only hold the default, so they count as no choice.\\n"),
("    const isValid = layout && typeof layout.isOn === 'boolean' && (layout.panes === null","    const isValid = layout && (layout.panes === null"),
("    return isValid ? { isOn: layout.isOn, panes: layout.panes } : null","    return isValid ? { isOn: layout.choice === 'on' ? true : layout.choice === 'off' ? false : null, panes: layout.panes } : null"),
("    localStorage.setItem(SPLIT_SETTING, JSON.stringify(layout))","    localStorage.setItem(SPLIT_SETTING, JSON.stringify({ choice: layout.isOn === null ? null : layout.isOn ? 'on' : 'off', panes: layout.panes }))"),
])
edit('web/src/split.test.js',[
("""  assert.deepEqual(parseSplitLayout('{"isOn":true,"panes":["a",null,"b",null]}'), { isOn: true, panes: ['a', null, 'b', null] })
  assert.deepEqual(parseSplitLayout('{"isOn":false,"panes":null}'), { isOn: false, panes: null })
  assert.equal(parseSplitLayout('{"isOn":true,"panes":["a"]}'), null)
  assert.equal(parseSplitLayout('{"isOn":"yes","panes":null}'), null)
  assert.equal(parseSplitLayout('{"isOn":true,"panes":[1,2,3,4]}'), null)""","""  assert.deepEqual(parseSplitLayout('{"choice":"on","panes":["a",null,"b",null]}'), { isOn: true, panes: ['a', null, 'b', null] })
  assert.deepEqual(parseSplitLayout('{"choice":"off","panes":null}'), { isOn: false, panes: null })
  assert.deepEqual(parseSplitLayout('{"choice":null,"panes":null}'), { isOn: null, panes: null })
  assert.equal(parseSplitLayout('{"choice":"on","panes":["a"]}'), null)
  assert.equal(parseSplitLayout('{"choice":"on","panes":[1,2,3,4]}'), null)"""),
("test('a saved layout must be four team keys or empty panes', () => {","""test('a layout saved before choices were recorded keeps its panes but not its on or off', () => {
  assert.deepEqual(parseSplitLayout('{"isOn":false,"panes":["a",null,null,null]}'), { isOn: null, panes: ['a', null, null, null] })
  assert.deepEqual(parseSplitLayout('{"isOn":true,"panes":null}'), { isOn: null, panes: null })
})

test('a saved layout must be four team keys or empty panes', () => {"""),
])
edit('web/src/App.jsx',[
("""  // An iPad opens in split view until the person turns it off there.
  // Touch screens, the iPad and the phone, open in split view until the person turns it off there.
  const [splitLayout, setSplitLayout] = useState(() => readSplitLayout() ?? { isOn: isTouchDevice, panes: null })
  useEffect(() => writeSplitLayout(splitLayout), [splitLayout])
  const isSplit = splitLayout.isOn && !isShowing && active.length > 0""","""  // Touch screens, the iPad and the phone, open in split view until the person turns it off there.
  const [splitLayout, setSplitLayout] = useState(() => readSplitLayout() ?? { isOn: null, panes: null })
  useEffect(() => writeSplitLayout(splitLayout), [splitLayout])
  const isSplitOn = splitLayout.isOn ?? isTouchDevice
  const isSplit = isSplitOn && !isShowing && active.length > 0"""),
("  const toggleSplit = () => setSplitLayout(layout => ({ isOn: !layout.isOn, panes: layout.panes ?? firstPanes(teams) }))","  const toggleSplit = () => setSplitLayout(layout => ({ isOn: !isSplitOn, panes: layout.panes ?? firstPanes(teams) }))"),
("  // Picking someone shows their card, which lives in the panel.\\n  useEffect(() => { if (isPhone && selected) setIsPanelOpen(true) }, [isPhone, selected])\\n",""),
("""    setIsPresenting(false)
    const target = everyone.find(other => other.id === id)
    setSelected(id)""","""    setIsPresenting(false)
    const target = everyone.find(other => other.id === id)
    // On a phone their card lives in the folded panel, so every pick opens it, even of the person already picked.
    if (isPhone) setIsPanelOpen(true)
    setSelected(id)"""),
])
EOF
grep -n "isOn" web/src/App.jsx | sed -n '1,40p' | grep -iv "voice\\|isOn &&\\|!isOn\\|useVoices\\|isOn, \\|isOn)\\|speech\\|api(" | cut -c1-200; node --test web/src/*.test.js 2>&1 | grep -E "^# (pass|fail)"`],
  ['a python edit that names rm in its text', `python3 - <<'EOF'\nfrom pathlib import Path\np = Path('plugin/hooks/x.ts')\ns = p.read_text().replace("rm -rf build", "rm -rf /tmp/x/build")\np.write_text(s)  # no rm here, only text\nEOF`],
  ['a python one-liner that prints rm', `python3 -c "print('rm -rf is refused')"`],
  ['node reading a file that names rm', `node -e "console.log(require('fs').readFileSync('notes.txt', 'utf8').includes('rm -rf'))"`],
  ['a double-bracket test', '[[ -n "$x" ]] && echo ok'],
  ['a double-bracket test in an if', 'if [[ -f package.json ]]; then npm test; fi'],
  ['sed editing text that names rm', "sed -i '' 's/rm -rf build/rm -rf \\/tmp\\/build/' notes.txt"],
  ['curl posting text that names rm', `curl -s -d 'note=rm -rf is refused' https://example.test/x`],
  ['a python script that names system in a comment', `python3 -c "print('file system ok')  # rm"`],
  ['sed with -e', "sed -e 's/a/b/' notes.txt"],
  ['sed -i with -e', "sed -i -e 's/a/b/' notes.txt"],
  ['sed -i on macOS with -e and text naming rm', "sed -i '' -e 's/rm -rf build/rm -rf \\/tmp\\/build/' notes.txt"],
  ['sed with an attached -e', "sed -e's/a/b/' notes.txt"],
  ['sed with --expression=', "sed --expression='s/a/b/' notes.txt"],
  ['sed with a script file and no delete text', 'sed -f script.sed notes.txt'],
  ['sed replacing rm with trash', "sed -i '' 's/rm/trash/' notes.txt"],
  ['sed with a g flag on a word ending in e', "sed 's/a/bare/g' notes.txt"],
  ['sed with -e scripts beside text naming rm', "sed -e 's/x/y/' -e 's/rm -rf/z/' notes.txt"],
  ['git grep for a delete', "git grep -n 'rm -rf' -- plugin"],
  ['fetching a branch whose name says delete', 'B=$(gh pr view 36 --repo justinhtn/office --json headRefName --jq .headRefName); git fetch -q origin "$B"; git diff 7ed3d85 FETCH_HEAD -- plugin/hooks/delete-guard.ts plugin/hooks/delete-guard.test.ts | head -80'],
  ['python rewriting a file through a temporary file', `cp ~/.agent-office/names.json /tmp/names.json.bak && python3 - <<'EOF'\nimport json, os, tempfile\npath = os.path.expanduser('~/.agent-office/names.json')\nwith open(path) as f:\n    names = json.load(f)\nnames['local_x'] = 'June'\nfd, tmp = tempfile.mkstemp(dir=os.path.dirname(path))\nwith os.fdopen(fd, 'w') as f:\n    json.dump(names, f, indent=2)\nos.replace(tmp, path)\nEOF`],
  ['a case arm with several patterns', 'case $f in *.txt|*.log) echo hi;; esac'],
  ['a case arm with several patterns and a flag', 'case $f in *.txt|*.log) ls -f;; esac'],
  ['an assignment before npm test', 'NODE_ENV=test npm test'],
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

// Commands the guard refused although nothing in them deletes a file: words in text, flags that only sound like a delete,
// and programs it can't vouch for that share a line with no delete at all.
const QUINN = '/Users/houghton/.agent-office/quinn/quinn-gh'
const FALSE_ALARMS: [string, string][] = [
  ['a review comment in -f body= about deleting old logs', `${QUINN} api -X POST repos/justinhtn/office/issues/40/comments -f body='Non-blocking: the cleanup deletes old log files with rm -rf "$LOG_DIR"/*.log; find /x -delete would be clearer. Asha'`],
  ['a review comment in a double-quoted -f body=', `${QUINN} api repos/justinhtn/office/issues/40/comments -f body="Blocking: rm -rf \\"\\$D\\" and unlink(path) still pass. Grace"`],
  ['quinn-gh kept in a variable', `Q=${QUINN}; $Q api -X POST repos/justinhtn/office/issues/40/comments -f body='The script deletes old log files with rm -rf; delete them by literal path. Asha'`],
  ['quinn-gh kept in a quoted variable', `Q="${QUINN}" && "$Q" pr comment 40 --body 'Remove the rm -rf of old logs. Grace'`],
  ['quinn-gh in a braced variable', `Q=${QUINN}\n\${Q} pr review 40 --comment --body 'unlink and rmtree are fine here. Asha'`],
  ['a body file whose path is in a variable', `F=/private/tmp/x/body.md; cat > "$F" <<'EOF'\nBlocking: rm -rf "$D" deletes old log files.\nEOF\n${QUINN} pr comment 40 --body-file "$F"`],
  ['a body file and quinn-gh both in variables', `Q=${QUINN}; F=/private/tmp/x/body.md; $Q api repos/justinhtn/office/pulls/40/reviews --input "$F" --jq .html_url`],
  ['a review from a heredoc piped to quinn-gh', `cat <<'EOF' | ${QUINN} api repos/justinhtn/office/pulls/40/reviews --input -\n{"body": "It still runs rm -rf ~/.claude/projects/$D. Verdict: not ready at abc123"}\nEOF`],
  ['a merge that keeps the branch, then the update script', 'gh pr merge 40 --repo justinhtn/office --squash --delete-branch=false && /Users/houghton/code/agent-office/scripts/update.sh'],
  ['a merge that deletes the branch, then the update script', 'gh pr merge 40 --squash --delete-branch && scripts/update.sh'],
  ['the update script beside a git push --delete', 'git push origin --delete old-branch && scripts/update.sh'],
  ['a branch named for deletes beside a script', 'git checkout -b fix-rm-guard && scripts/check.sh'],
  ['pushing a branch named delete-guard after the checks', 'scripts/check.sh && git push -u origin claude/delete-guard-false-alarms'],
  ['a worktree for a branch about rm', 'git worktree add ../rm-old-logs -b rm-old-logs && make -C ../rm-old-logs'],
  ['a search for unlink calls through awk', `grep -rn "unlink(" server | awk -F: '{print $1}' | sort -u`],
  ['a search for os.remove through python', `rg -n 'rmtree|os.remove\\(' server | python3 -c "import sys; print(len(sys.stdin.read().splitlines()))"`],
  ['a search for rm -rf counted by xargs', `grep -rln 'rm -rf' scripts | xargs wc -l`],
  ['a search for --delete paged through less', "grep -rn -- '--delete' scripts | less"],
  ['a python edit whose text names a delete', `python3 - <<'EOF'\np = 'plugin/hooks/x.test.ts'\ns = open(p).read().replace("  ['a prompt', \`claude -p 'rm -rf'\`],\\n", '')\nopen(p, 'w').write(s)\nEOF`],
  ['node printing a template literal', "node -e 'console.log(`${1 + 1} files`)'"],
  ['python reading JSON from gh beside a review post', `gh pr view 40 --json files | python3 -c "import json, sys; print(len(json.load(sys.stdin)['files']))" && ${QUINN} pr comment 40 --body 'It still runs rm -rf on old logs. Grace'`],
]

for (const [why, command] of FALSE_ALARMS) {
  test(`allows ${why}`, async ($, on) => {
    const { ran, deny } = await bash($, on, command)
    expect(deny).toBeUndefined()
    expect(ran).toEqual([command])
  })
}

// What the guard exists for, next to the false alarms above: each still has a real delete it can't vouch for.
const STILL_REFUSED: [string, string][] = [
  ['a merge beside a recursive delete of a variable', 'gh pr merge 40 --delete-branch=false && rm -rf "$D"'],
  ['the update script beside a literal delete', 'scripts/update.sh && rm -rf /tmp/guard-test/build'],
  ['a branch named for deletes beside a delete of ~/.claude', 'git checkout -b delete-x && rm -rf ~/.claude/projects'],
  ['rm kept in a variable', 'Q=/bin/rm; $Q -rf ~/.claude'],
  ['quinn-gh in a variable that is read again', `Q=${QUINN}; read Q; $Q -rf ~/.claude`],
  ['quinn-gh in a variable after a sourced script', `Q=${QUINN}; source x.sh; $Q -rf ~/.claude`],
  ['quinn-gh in a variable set only in a subshell', `(Q=${QUINN}); $Q -rf ~/.claude`],
  ['quinn-gh in a variable set after a condition', `false && Q=${QUINN}; $Q -rf ~/.claude`],
  ['a program in a variable given a delete', `Q=/usr/local/bin/runner; $Q 'rm -rf ~/.claude'`],
  ['a review post beside a delete', `${QUINN} pr comment 40 --body ok && rm -rf "$D"`],
  ['a search piped to python that reads code from it', `grep -rh 'shutil.rmtree' notes | python3`],
  ['text piped to a program that runs it', `echo 'rm -rf ~/.claude' | parallel`],
  ['an unknown program given a delete', `scripts/run.sh 'rm -rf ~/.claude'`],
  ['an unknown program with --delete', 'aws s3 sync s3://b ~/.claude --delete'],
  ['rmdir of a variable', 'rmdir "$D"'],
  ['shred of a pattern in ~/.claude', 'shred -u ~/.claude/projects/*/*.jsonl'],
  ['trash of ~/.claude', 'trash ~/.claude/projects'],
  ['trash of a relative folder', 'trash build'],
  ['xargs trash', 'cat list | xargs trash'],
  ['git clean', 'git clean -fdx'],
  ['git clean in another folder', 'git -C /tmp/guard-test clean -fd'],
  ['git worktree remove of a variable', 'git worktree remove --force "$W"'],
  ['git worktree remove of a relative path', 'git worktree remove ../other'],
  ['git worktree remove inside ~/.claude', 'git worktree remove ~/.claude/worktrees/x'],
  ['rclone sync', 'rclone sync /tmp/a remote:b'],
  ['rclone purge', 'rclone purge remote:b'],
  ['rsync --remove-source-files', 'rsync -a --remove-source-files ~/.claude/ /tmp/b/'],
  ['shred through sh -c', `sh -c 'shred -u ~/.claude/x'`],
  ['trash through sh -c', `sh -c 'trash ~/.claude'`],
  ['a script written then run by sh', `echo 'rm -rf ~/.claude' > /tmp/x.sh && sh /tmp/x.sh`],
  ['a script written then run directly', `printf 'rm -rf ~/.claude' > /tmp/x.sh; chmod +x /tmp/x.sh; /tmp/x.sh`],
  ['a script written by tee then run', `echo 'rm -rf ~/.claude' | tee /tmp/x.sh; bash /tmp/x.sh`],
  ['python code written then run', `cat > /tmp/x.py <<'EOF'\nimport shutil; shutil.rmtree('/Users/me/.claude')\nEOF\npython3 /tmp/x.py`],
  ['python code from a variable', `CODE='import os; os.remove("/Users/me/.claude/x")'; python3 -c "$CODE"`],
  ['an unknown program given a variable holding a delete', `X='rm -rf ~/.claude'; scripts/run.sh "$X"`],
  ['python code from an unquoted heredoc with a variable', `python3 - <<EOF\n$CODE\nEOF\nX='os.remove(1)'`],
  ['a delete exported for a program', `export CMD='rm -rf ~/.claude'; make run`],
  ['a script written by python then run', `python3 -c "open('/tmp/x.sh', 'w').write('rm -rf ~/.claude')"; sh /tmp/x.sh`],
  ['a script edited by sed -i then run', `sed -i '' 's/^/rm -rf ~\\/.claude/' /tmp/x.sh && /tmp/x.sh`],
  // From the first review of this change: each was refused before it and briefly allowed.
  ['python reading its code from /dev/stdin', `echo 'import shutil; shutil.rmtree("/Users/me/.claude")' | python3 /dev/stdin`],
  ['python reading its code from /dev/fd/0', `echo 'import shutil; shutil.rmtree("/Users/me/.claude")' | python3 /dev/fd/0`],
  ['python -c running what it reads', `echo 'import shutil; shutil.rmtree("/Users/me/.claude")' | python3 -c 'import sys; eval(compile(sys.stdin.read(), "x", "exec"))'`],
  ['sh -c sh reading a pipe', `echo 'rm -rf /Users/me/.claude' | sh -c sh`],
  ['bash -c sourcing /dev/stdin', `echo 'rm -rf /Users/me/.claude' | bash -c 'source /dev/stdin'`],
  ['xargs filling sh -c', `echo 'rm -rf /Users/me/.claude' | xargs -I{} sh -c {}`],
  ['xargs filling an eval', `printf 'rm -rf /Users/me/.claude' | xargs -0 sh -c 'eval "$1"' _`],
  ['a pipe into a subshell around a shell', `cat <<'EOF' | (true; sh)\nrm -rf /Users/me/.claude\nEOF`],
  ['a pipe into a group around a shell', `cat <<'EOF' | { true; sh; }\nrm -rf /Users/me/.claude\nEOF`],
  ['a heredoc fed to a group around a shell', `{ sh; } <<'EOF'\nrm -rf /Users/me/.claude\nEOF`],
  ['a heredoc fed to a subshell around a shell', `( sh ) <<'EOF'\nrm -rf /Users/me/.claude\nEOF`],
  ['a here-string fed to a group around a shell', `{ bash; } <<< 'rm -rf /Users/me/.claude'`],
  ['a heredoc fed to a loop around a shell', `while read -r l; do sh; done <<'EOF'\nrm -rf /Users/me/.claude\nEOF`],
  ['a script written by cp then run', `cp /dev/stdin /tmp/x.sh <<< 'rm -rf /Users/me/.claude'; sh /tmp/x.sh`],
  ['a script written by sort -o then run', `sort -o /tmp/x.sh <<< 'rm -rf /Users/me/.claude'; sh /tmp/x.sh`],
  ['a script written by sed w then run', `sed -n 'w /tmp/x.sh' <<< 'rm -rf /Users/me/.claude'; sh /tmp/x.sh`],
  ['a Makefile written then made', `cat > Makefile <<'EOF'\nall:\n\trm -rf /Users/me/.claude\nEOF\nmake`],
  ['git clean after -c', 'git -c color.ui=never clean -fdx'],
  ['git worktree remove after -c', 'git -c x=y worktree remove --force /Users/me/.claude/x'],
  ['git clean after --git-dir', 'git --git-dir /tmp/r/.git --work-tree /Users/me/.claude clean -fdx'],
  ['git clean with -n as its exclude pattern', 'git clean -fdx -e -n'],
  ['git clean with -n in an attached exclude pattern', 'git clean -fdxen'],
  ['git clean with -n after --', 'git clean -fdx -- -n'],
  ['rsync --del', 'rsync -a --del /tmp/empty/ /Users/me/.claude/'],
  ['rclone bisync', 'rclone bisync /tmp/empty /Users/me/.claude --resync'],
  ['sudo git clean', 'sudo git clean -fdx'],
  ['env git worktree remove', 'env git worktree remove --force /Users/me/.claude/x'],
  ['yarn node removing a folder', `yarn node -e "require('fs').rmSync('/Users/me/.claude', {recursive: true})"`],
  ['yarn rimraf', 'yarn rimraf /Users/me/.claude'],
  // From the second review: code given as an argument loading a file the line writes.
  ['python -c importing a module the line writes', `cp /dev/stdin evil.py <<< 'import shutil; shutil.rmtree("/Users/me/.claude")'; python3 -c 'import evil'`],
  ['node -e requiring a file the line writes', `cp /dev/stdin /tmp/x.js <<< 'require("fs").rmSync("/Users/me/.claude", { recursive: true })'; node -e 'require("/tmp/x.js")'`],
  ['ruby -e loading a file the line writes', `cat > /tmp/x.rb <<'EOF'\nrequire "fileutils"; FileUtils.rm_rf("/Users/me/.claude")\nEOF\nruby -e 'load "/tmp/x.rb"'`],
  ['perl -e requiring a file written by echo', `echo 'system("rm -rf /Users/me/.claude");' > /tmp/x.pl; perl -e 'require "/tmp/x.pl"'`],
  ['python -c running a module written by sort -o', `sort -o /tmp/m.py <<< 'import os; os.remove("/Users/me/.claude/x")'; python3 -c 'import runpy'`],
  // From the third review: writes that the read-only list missed, followed by code that loads what they wrote.
  ['sort -o attached to its file', `sort -o/tmp/evil.py <<< 'import shutil; shutil.rmtree("/Users/me/.claude")'; cd /tmp && python3 -c 'import evil'`],
  ['sort -o in a cluster', `sort -no/tmp/evil.py <<< 'import shutil; shutil.rmtree("/Users/me/.claude")'; cd /tmp && python3 -c 'import evil'`],
  ['sort with a shortened --output', `sort --outp=/tmp/evil.py <<< 'import shutil; shutil.rmtree("/Users/me/.claude")'; cd /tmp && python3 -c 'import evil'`],
  ['uniq writing its second operand', `uniq - /tmp/x.js <<< 'require("fs").rmSync("/Users/me/.claude", { recursive: true })'; node -e 'require("/tmp/x.js")'`],
  ['cat into a read-write redirection', `cat 1<>/tmp/x.js <<< 'require("fs").rmSync("/Users/me/.claude", { recursive: true })'; node -e 'require("/tmp/x.js")'`],
  ['less logging its input to a file', `less -o/tmp/evil.py <<< 'import shutil; shutil.rmtree("/Users/me/.claude")'; cd /tmp && python3 -c 'import evil'`],
  ['gh downloading with -O attached', `gh run download 1 -O/tmp/evil.py; echo 'shutil.rmtree' > /dev/null; cd /tmp && python3 -c 'import evil'`],
  // From the fourth review: an expansion that becomes a writing option or operand.
  ['sort -o from a variable', `O=-o/tmp/evil.py; sort $O <<< 'import shutil; shutil.rmtree("/Users/me/.claude")'; cd /tmp && python3 -c 'import evil'`],
  ['sort -o from a quoted variable', `sort "$O" <<< 'import shutil; shutil.rmtree("/Users/me/.claude")'; cd /tmp && python3 -c 'import evil'`],
  ['sort -o from a substitution', `sort $(printf -- -o/tmp/evil.py) <<< 'import shutil; shutil.rmtree("/Users/me/.claude")'; cd /tmp && python3 -c 'import evil'`],
  ['uniq operands from a variable', `uniq $FILES <<< 'require("fs").rmSync("/Users/me/.claude", { recursive: true })'; node -e 'require("/tmp/x.js")'`],
  ['gh -O from a substitution', `gh run download 1 $(echo -O/tmp/evil.py); echo 'shutil.rmtree' > /dev/null; cd /tmp && python3 -c 'import evil'`],
  // From the fifth review: a brace or pattern that becomes a writing option or operand.
  ['sort -o from a brace', `sort {-o,/tmp/evil.py} <<< 'import shutil; shutil.rmtree("/Users/me/.claude")'; cd /tmp && python3 -c 'import evil'`],
  ['uniq operands from a brace', `uniq {-,/tmp/x.js} <<< 'require("fs").rmSync("/Users/me/.claude", { recursive: true })'; node -e 'require("/tmp/x.js")'`],
  ['sort -o from a pattern', `sort -- * <<< 'import shutil; shutil.rmtree("/Users/me/.claude")'; cd /tmp && python3 -c 'import evil'`],
  ['uniq operands from a pattern', `uniq /tmp/in?.txt <<< 'require("fs").rmSync("/Users/me/.claude", { recursive: true })'; node -e 'require("/tmp/x.js")'`],
  ['gh -O from a brace', `gh run download 1 {-O,/tmp/evil.py}; echo 'shutil.rmtree' > /dev/null; cd /tmp && python3 -c 'import evil'`],
  ['perl backticks from a heredoc', `perl <<'EOF'\nprint \`rm -rf ~\`;\nEOF`],
]

for (const [why, command] of STILL_REFUSED) {
  test(`still refuses ${why}`, async ($, on) => {
    const { ran, deny } = await bash($, on, command)
    expect(ran).toEqual([])
    expect(deny).toMatch(/trash folder/)
  })
}

for (const command of ['git clean -nd && scripts/update.sh', 'git clean -fdn', 'git clean --dry-run -e build']) {
  test(`a dry run of git clean deletes nothing: ${command}`, async ($, on) => {
    const { deny } = await bash($, on, command)
    expect(deny).toBeUndefined()
  })
}

test('git worktree remove of a full literal path is checked like rm -rf', async ($, on) => {
  const { deny } = await bash($, on, `git worktree remove ${PROJECT}/.claude/worktrees/w`)
  expect(deny).toBeUndefined()
})

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

// office-review is how reviewers post. It's trusted only when written out in full, and refused when built from
// variables or substitutions, whether or not the line deletes anything.
const REVIEW = `${HOME}/code/agent-office/scripts/office-review`
const REVIEW_ALLOWED: [string, string][] = [
  ['status', `${REVIEW} status 50`],
  ['a reply from a file', `${REVIEW} reply 50 4497497723 --file /private/tmp/x/reply.md`],
  ['a comment from a file named for deletes', `${REVIEW} comment 50 --file /private/tmp/x/rm-rf-old-logs.md`],
  ['a review from a file', `${REVIEW} review 50 --file /private/tmp/x/review.json`],
  ['a verdict', `${REVIEW} verdict 50 --not-ready --sha ${'a'.repeat(40)} --file /private/tmp/x/verdict.md`],
  ['the main checkout by its tilde path, from a worktree', 'cd /Users/me/code/agent-office/.claude/worktrees/w && ~/code/agent-office/scripts/office-review status 50'],
  ['delete words as its arguments, which it reads as data', `${REVIEW} status 'rm -rf ~'`],
  ['an editor from a variable opening it', '$EDITOR scripts/office-review'],
  ['a body written by a heredoc, then posted', `cat > /private/tmp/x/body.md <<'EOF'\nBlocking: rm -rf "$D" still passes. Grace\nEOF\n${REVIEW} comment 50 --file /private/tmp/x/body.md`],
  ['its help', `${REVIEW} --help`],
  ['a search that names it', 'grep -rn office-review CLAUDE.md scripts'],
]

for (const [why, command] of REVIEW_ALLOWED) {
  test(`office-review: allows ${why}`, async ($, on) => {
    const { ran, deny } = await bash($, on, command)
    expect(deny).toBeUndefined()
    expect(ran).toEqual([command])
  })
}

const REVIEW_REFUSED: [string, string][] = [
  ['a PR number from a variable', `${REVIEW} status "$PR"`],
  ['a file from a variable', `${REVIEW} comment 50 --file "$F"`],
  ['a sha from a substitution', `${REVIEW} verdict 50 --ready --sha $(git rev-parse HEAD) --file /tmp/x/v.md`],
  ['a file from backticks', `${REVIEW} comment 50 --file \`ls /tmp/x/*.md\``],
  ['a file from a pattern', `${REVIEW} comment 50 --file /tmp/x/*.md`],
  ['a subcommand from a brace', `${REVIEW} {comment,reply} 50 --file /tmp/x/b.md`],
  ['the program in a variable', `R=${REVIEW}; $R status 50`],
  ['the program from a substitution', '$(git rev-parse --show-toplevel)/scripts/office-review status 50'],
  ['the program from a variable path', '"$ROOT"/scripts/office-review status 50'],
  ['an unknown subcommand', `${REVIEW} post 50 --file /tmp/x/b.md`],
  ['no subcommand', REVIEW],
  ['unreadable syntax', `((1)); ${REVIEW} status 50`],
  ["a worktree's copy, which could be a pull request's version", 'cd /Users/me/code/agent-office/.claude/worktrees/w && scripts/office-review status 50'],
  ["a worktree's copy by its full path", `${HOME}/code/agent-office/.claude/worktrees/w/scripts/office-review status 50`],
  ['a planted copy given delete words', `/private/tmp/x/office-review status 'rm -rf ~'`],
  ['the program from a variable folder, given a subcommand', '"$DIR"/office-review verdict 50 --ready --sha x --file /tmp/x/v.md'],
]

for (const [why, command] of REVIEW_REFUSED) {
  test(`office-review: refuses ${why}`, async ($, on) => {
    const { ran, deny } = await bash($, on, command)
    expect(ran).toEqual([])
    expect(deny).toMatch(/office-review/)
  })
}
