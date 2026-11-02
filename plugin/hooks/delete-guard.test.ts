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
]

for (const [why, command] of REFUSED) {
  test(`refuses ${why}`, async ($, on) => {
    const { ran, deny } = await bash($, on, command)
    expect(ran).toEqual([])
    expect(deny).toMatch(/trash folder/)
  })
}

const ALLOWED: [string, string][] = [
  ['a literal path in a worktree', `rm -rf ${PROJECT}/.claude/worktrees/w/build`],
  ['a relative literal path', 'rm -rf build dist'],
  ['a literal path with spaces', 'rm -rf "old build"'],
  ['a project .claude folder', 'rm -rf .claude/worktrees/w'],
  ['a pattern in a project', 'rm -rf build/*'],
  ['a pattern in this folder', 'rm -rf *.egg-info'],
  ['force with a literal file', 'rm -f notes.txt'],
  ['a temp folder', 'rm -rf /tmp/guard-test/build'],
  ['a literal path after cd', 'cd /tmp/guard-test && rm -rf build'],
  ['a literal name with a similar folder', 'rm -rf ~/.claude-old'],
  ['one file in ~/.claude without recursion', 'rm -f ~/.claude/old.json'],
  ['plain rm of a variable', 'rm "$f"'],
  ['a variable in plain xargs rm', 'cat list | xargs rm'],
  ['single quotes that keep $ literal', "rm -rf 'cost$D'"],
  ['find -delete with a literal root', `find . -name '*.pyc' -delete`],
  ['find -delete with a variable name', 'find build -name "$pattern" -delete'],
  ['find -exec on a literal root', 'find build -name x -exec rm -f {} +'],
  ['find reading ~/.claude', 'find ~/.claude -name "*.jsonl" -exec cat {} \\;'],
  ['find that deletes nothing', 'find "$D" -name x'],
  ['listing ~/.claude', 'ls -la ~/.claude "$D"'],
  ['other programs with an rm command', 'docker rm -f "$c"; git rm -rf "$f"; npm run rm'],
  ['a command that only mentions rm', `grep -rn 'rm -rf "$D"' .; echo 'rm -rf ~/.claude'`],
  ['a double-quoted mention', 'echo "rm -rf ~/.claude"'],
  ['a comment', 'ls # rm -rf "$D"'],
  ['a commit message', `git commit -m "$(cat <<'EOF'\nStop rm -rf "$D" and don't touch ~/.claude\nEOF\n)"`],
  ['an unquoted heredoc without substitutions', 'cat <<EOF\nrm -rf ~/.claude\nEOF'],
  ['a redirect target', 'rm -rf build > "$log" 2>&1'],
  ['an unrelated variable earlier', 'D=build; echo "$D"; rm -rf dist'],
  ['an unrelated broken quote', "echo don't"],
  ['an ordinary command', 'npm test && git status'],
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
  on('session.cwd', () => ({ value: PROJECT }))
  const ran = recordRuns(on)
  const answer = await $.tool.call({ tool: 'Bash', command: 'rm -rf build' })
  expect(ran).toEqual([])
  expect(answer.deny).toMatch(/couldn't read/)
})

test('a delete is refused when the check itself fails', async ($, on) => {
  on('env.get', () => {
    throw new Error('no environment')
  })
  const ran = recordRuns(on)
  const answer = await $.tool.call({ tool: 'Bash', command: 'rm -rf build' })
  expect(ran).toEqual([])
  expect(answer.deny).toMatch(/couldn't read/)
})

test('other commands still run when the check fails', async ($, on) => {
  on('env.get', () => {
    throw new Error('no environment')
  })
  const ran = recordRuns(on)
  await $.tool.call({ tool: 'Bash', command: 'git status' })
  expect(ran).toEqual(['git status'])
})
