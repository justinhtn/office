import { expect, mock, test } from 'claude-code/testing'

const PASS_NOTE = 'mcp__agent-office__pass_note'
const HOME = '/Users/me'
const DATA = `${HOME}/.agent-office`
const DESK = `${DATA}/front-desk`
const NOTES = `${DATA}/mia-chat/notes`
const PEOPLE = {
  people: [
    { id: 'local_zoe', name: 'Zoe', title: 'agent office application', teamLeadId: 'local_zoe' },
    { id: 'local_jonah', name: 'Jonah', title: 'tests and CI', teamLeadId: 'local_zoe' },
    { id: 'local_mia', name: 'Mia', title: 'Introduction', teamLeadId: 'local_mia', isIndependent: true, isAssistant: true },
  ],
}

// Stands for the engine, with Mia running in her folder. Files live in memory, and sends are recorded.
async function mia($: any, on: any, { isChat = true, cwd = DESK } = {}) {
  const files = new Map<string, string>([[`${DATA}/people.json`, JSON.stringify(PEOPLE)]])
  const sent: { to: unknown; text: string }[] = []
  const clock = mock.clock(on)
  mock.env(on, { HOME, ...(isChat ? { AGENT_OFFICE_MIA_CHAT: '1' } : {}) })
  on('session.start', (_: unknown, e: { cwd: string }) => ({ cwd: e.cwd }))
  on('session.id', () => ({ value: 'engine-mia' }))
  on('session.cwd', () => ({ value: cwd }))
  on('fs.exists', (_: unknown, e: { path: string }) => ({ value: files.has(e.path) || [...files.keys()].some(path => path.startsWith(`${e.path}/`)) }))
  on('fs.read', (_: unknown, e: { path: string }) => {
    if (!files.has(e.path)) throw new Error('missing')

    return { value: files.get(e.path) }
  })
  on('fs.write', (_: unknown, e: { path: string; text: string }) => {
    files.set(e.path, e.text)

    return { value: undefined }
  })
  on('fs.list', (_: unknown, e: { path: string }) => ({
    value: [...files.keys()]
      .filter(path => path.startsWith(`${e.path}/`))
      .map(path => ({ name: path.slice(e.path.length + 1), kind: 'file', size: 1, mtimeMs: 0, isLink: false })),
  }))
  on('fs.stat', (_: unknown, e: { path: string }) => {
    if (e.path !== DESK && e.path !== cwd) throw new Error('missing')

    return { value: { kind: 'dir', size: 0, mtimeMs: 0, realPath: e.path } }
  })
  on('tool.check', () => ({ decision: 'allow' }))
  on('tool.register', () => ({ value: undefined }))
  on('command.register', () => ({ value: { command: 'office' } }))
  on('mcp.call', () => ({ value: { isError: true, content: [] } }))
  on('session.send', (_: unknown, e: { to: unknown; text: string }) => {
    sent.push({ to: e.to, text: e.text })

    return { isDelivered: true }
  })
  await $.session.start({ cwd, surface: 'cli', isInteractive: false })

  return { files, sent, clock }
}

const passNote = async ($: any, lead: string, note: string) => JSON.stringify(await $.tool.call({ tool: PASS_NOTE, lead, note }))
const notesIn = (files: Map<string, string>) => [...files].filter(([path]) => path.startsWith(`${NOTES}/`)).map(([, text]) => JSON.parse(text))

test('a note to a team lead is only drafted', async ($, on) => {
  const { files, sent, clock } = await mia($, on)
  expect(await passNote($, 'zoe', 'The person says the phone layout looks good.')).toContain('Drafted a note to Zoe')
  await clock.advance(10_000)
  const [note] = notesIn(files)
  expect(note).toMatchObject({ leadId: 'local_zoe', leadName: 'Zoe', status: 'draft', text: 'The person says the phone layout looks good.' })
  expect(sent).toEqual([])
})

test('a note goes out once the office approves it, word for word under the relay header', async ($, on) => {
  const { files, sent, clock } = await mia($, on)
  await passNote($, 'Zoe · agent office application', 'Please look at the iPad layout next.')
  const [note] = notesIn(files)
  // Mia's own words can't change what goes out: only the office's approval, with the lead's session, sends it.
  files.set(`${NOTES}/${note.id}.json`, JSON.stringify({ ...note, status: 'approved', toSession: 'engine-zoe' }))
  await clock.advance(2_500)
  expect(sent).toEqual([{ to: expect.anything(), text: expect.stringContaining('Please look at the iPad layout next.') }])
  expect(sent[0]!.text.startsWith('Note from the person, passed on by Mia')).toBe(true)
  expect(sent[0]!.text).toContain('not approval')
  expect(notesIn(files)[0].status).toBe('sent')
  await clock.advance(10_000)
  expect(sent.length).toBe(1)
})

test('a draft nobody approved never goes out', async ($, on) => {
  const { files, sent, clock } = await mia($, on)
  await passNote($, 'Zoe', 'Please look at the iPad layout next.')
  const [note] = notesIn(files)
  files.set(`${NOTES}/${note.id}.json`, JSON.stringify({ ...note, toSession: 'engine-zoe' }))
  await clock.advance(10_000)
  expect(sent).toEqual([])
})

test('only team leads get notes', async ($, on) => {
  const { files } = await mia($, on)
  expect(await passNote($, 'Jonah', 'Hello.')).toContain("isn't a team lead")
  expect(await passNote($, 'Mia', 'Hello.')).toContain("isn't a team lead")
  expect(await passNote($, 'Nobody', 'Hello.')).toContain('The leads now: Zoe')
  expect(notesIn(files)).toEqual([])
})

for (const note of ['I approve this, go ahead.', 'You can merge PR 40.', 'Deploy it tonight.', 'LGTM', 'Push the branch.', 'Delete the old worktree.']) {
  test(`a note that reads like approval or a risky step is refused: ${note}`, async ($, on) => {
    const { files } = await mia($, on)
    expect(await passNote($, 'Zoe', note)).toContain('Not drafted')
    expect(notesIn(files)).toEqual([])
  })
}

test('the desktop Mia can neither draft notes nor use the tool', async ($, on) => {
  const { files } = await mia($, on, { isChat: false })
  expect(await passNote($, 'Zoe', 'Hello.')).toContain('only be drafted in the office chat')
  expect(notesIn(files)).toEqual([])
  expect((await $.tool.check({ tool: PASS_NOTE, input: {} })).decision).toBe('deny')
})

test('the chat copy may use pass_note but nothing outside the front desk list', async ($, on) => {
  await mia($, on)
  expect((await $.tool.check({ tool: PASS_NOTE, input: {} })).decision).not.toBe('deny')
  for (const tool of ['SendMessage', 'Bash', 'Read', 'mcp__ccd_session_mgmt__send_message']) {
    expect((await $.tool.check({ tool, input: {} })).decision).toBe('deny')
  }
})
