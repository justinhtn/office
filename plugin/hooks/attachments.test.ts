import { expect, test } from 'claude-code/testing'

const REPLY = 'mcp__plugin_telegram_telegram__reply'
const HOME = '/Users/me'
const DATA = `${HOME}/.agent-office`
const PROJECT = `${HOME}/code/app`
const FILES: Record<string, { real?: string; text?: string; size?: number }> = {
  [`${PROJECT}/plot.png`]: {},
  [`${PROJECT}/.env`]: {},
  [`${PROJECT}/.git/config`]: {},
  [`${PROJECT}/notes.txt`]: { text: 'no key here' },
  [`${PROJECT}/leak.txt`]: { text: '-----BEGIN OPENSSH PRIVATE KEY-----' },
  [`${PROJECT}/big.bin`]: { size: 60 * 1024 * 1024 },
  [`${PROJECT}/big.log`]: { size: 5 * 1024 * 1024 },
  [`${PROJECT}/big.mp4`]: { size: 5 * 1024 * 1024 },
  [`${PROJECT}/to\u212Aen.json`]: { text: '{}' },
  [`${PROJECT}/\u017Fecrets/prod.yaml`]: { text: 'a: 1' },
  [`${PROJECT}/\uFF0Eenv`]: { text: 'a' },
  [`${PROJECT}/prod.env`]: { text: 'a' },
  [`${PROJECT}/.envrc`]: { text: 'a' },
  [`${PROJECT}/env.py`]: { text: 'import os' },
  [`${PROJECT}/vars.txt`]: { text: 'export STRIPE_API_KEY=abcdefghijklmnop' },
  [`${PROJECT}/db.txt`]: { text: 'DB_PASSWORD: hunter2hunter2' },
  [`${PROJECT}/url.txt`]: { text: 'DATABASE_URL=postgres://user:pass@host/db' },
  [`${HOME}/code/infra/secrets/prod/db.yaml`]: { text: 'a: 1' },
  [`${PROJECT}/.claude/worktrees/w/plot.png`]: {},
  [`${PROJECT}/link.txt`]: { real: `${HOME}/.ssh/config` },
  [`${PROJECT}/inside.txt`]: { real: `${PROJECT}/plot.png` },
  [`${PROJECT}/innocent.txt`]: { real: `${PROJECT}/.env` },
  [`${HOME}/other/plot.png`]: {},
  [`${HOME}/Documents/plot.png`]: {},
  [`${HOME}/.ssh/config`]: {},
}
const FOLDERS = [HOME, PROJECT, `${HOME}/code/infra/secrets/prod`, `${PROJECT}/.claude/worktrees/w`, `${HOME}/Documents`, `${HOME}/.agent-office/front-desk`, `${HOME}/scratch`]

// Stands for the engine, with Mia running in her folder and one real project in the office.
async function mia($: any, on: any, cwds = [PROJECT, `${PROJECT}/.claude/worktrees/w`, `${HOME}/code/infra/secrets/prod`, HOME, `${HOME}/Documents`, `${DATA}/front-desk`]) {
  const sent: unknown[] = []
  on('session.start', (_: unknown, e: { cwd: string }) => ({ cwd: e.cwd }))
  on('session.id', () => ({ value: 'local_mia' }))
  on('session.cwd', () => ({ value: `${DATA}/front-desk` }))
  on('env.get', (_: unknown, e: { name: string }) => ({ value: e.name === 'HOME' ? HOME : undefined }))
  on('fs.exists', () => ({ value: false }))
  on('fs.stat', (_: unknown, e: { path: string }) => {
    if (FOLDERS.includes(e.path)) return { value: { kind: 'dir', size: 0, mtimeMs: 0, realPath: e.path } }
    const file = FILES[e.path]
    if (!file) throw new Error('missing')

    return { value: { kind: 'file', size: file.size ?? 10, mtimeMs: 0, realPath: file.real ?? e.path } }
  })
  on('fs.read', (_: unknown, e: { path: string }) => {
    if (e.path.endsWith('people.json')) return { value: JSON.stringify({ people: cwds.map((cwd, i) => ({ id: `s${i}`, cwd })) }) }
    const text = FILES[e.path]?.text
    if (text === undefined || (FILES[e.path]?.size ?? 0) > 4 * 1024 * 1024) throw new Error('unreadable')

    return { value: text }
  })
  on('tool.register', () => ({ value: undefined }))
  on('command.register', () => ({ value: { command: 'office' } }))
  on('mcp.call', () => ({ value: { isError: true, content: [] } }))
  on('tool.call', (_: unknown, e: { files?: unknown }) => {
    sent.push(e.files)

    return { result: 'sent', text: 'sent' }
  })
  await $.session.start({ cwd: `${DATA}/front-desk`, surface: 'desktop', isInteractive: false })

  return sent
}

const send = ($: any, files?: unknown) => $.tool.call({ tool: REPLY, chat_id: '1', text: 'hi', files })

test('a plain reply and a project file go out', async ($, on) => {
  const sent = await mia($, on)
  await send($)
  await send($, [`${PROJECT}/plot.png`])
  await send($, [`${PROJECT}/notes.txt`])
  expect(sent).toEqual([undefined, [`${PROJECT}/plot.png`], [`${PROJECT}/notes.txt`]])
})

test('ordinary files that only look close to secrets go out', async ($, on) => {
  const sent = await mia($, on)
  await send($, [`${PROJECT}/env.py`])
  await send($, [`${PROJECT}/big.mp4`])
  await send($, [`${PROJECT}/.claude/worktrees/w/plot.png`])
  expect(sent).toEqual([[`${PROJECT}/env.py`], [`${PROJECT}/big.mp4`], [`${PROJECT}/.claude/worktrees/w/plot.png`]])
})

test('a link inside the project sends the file it really leads to', async ($, on) => {
  const sent = await mia($, on)
  await send($, [`${PROJECT}/inside.txt`])
  expect(sent).toEqual([[`${PROJECT}/plot.png`]])
})

for (const [why, file] of [
  ['outside every project', `${HOME}/other/plot.png`],
  ['in a folder too broad to be a project', `${HOME}/Documents/plot.png`],
  ['a link out of the project', `${PROJECT}/link.txt`],
  ['a link to a secret', `${PROJECT}/innocent.txt`],
  ['named like a secret', `${PROJECT}/.env`],
  ['in a secret folder', `${PROJECT}/.git/config`],
  ['holding a key', `${PROJECT}/leak.txt`],
  ['too big', `${PROJECT}/big.bin`],
  ['missing', `${PROJECT}/gone.txt`],
  ['too large to search', `${PROJECT}/big.log`],
  ['with a Kelvin sign spelling of token', `${PROJECT}/to\u212Aen.json`],
  ['with a long s spelling of secrets', `${PROJECT}/\u017Fecrets/prod.yaml`],
  ['with a fullwidth dot spelling of .env', `${PROJECT}/\uFF0Eenv`],
  ['named prod.env', `${PROJECT}/prod.env`],
  ['named .envrc', `${PROJECT}/.envrc`],
  ['holding a prefixed key', `${PROJECT}/vars.txt`],
  ['holding a prefixed password', `${PROJECT}/db.txt`],
  ['holding a password in a URL', `${PROJECT}/url.txt`],
  ['when the session itself runs in a secrets folder', `${HOME}/code/infra/secrets/prod/db.yaml`],
  ['a relative path', 'plot.png'],
] as const) {
  test(`refuses a file ${why}`, async ($, on) => {
    const sent = await mia($, on)
    const answer: any = await send($, [file])
    expect(sent).toEqual([])
    expect(JSON.stringify(answer)).toContain('Nothing was sent')
  })
}

test('one bad file stops the whole send', async ($, on) => {
  const sent = await mia($, on)
  await send($, [`${PROJECT}/plot.png`, `${PROJECT}/.env`])
  expect(sent).toEqual([])
})

test('files that are not a list are refused', async ($, on) => {
  const sent = await mia($, on)
  await send($, `${PROJECT}/plot.png`)
  expect(sent).toEqual([])
})
