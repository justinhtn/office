import { expect, mock, test } from 'claude-code/testing'

const PASS_NOTE = 'mcp__agent-office__pass_note'
const HOME = '/Users/me'
const DATA = `${HOME}/.agent-office`
const DESK = `${DATA}/front-desk`
const SENDER = `${DATA}/mia-chat/sender`
const NOTES = `${DATA}/mia-chat/notes`
const NOTE = '11111111-2222-3333-4444-555555555555'
const PEOPLE = {
  people: [
    { id: 'local_zoe', name: 'Zoe', title: 'agent office application', teamLeadId: 'local_zoe' },
    { id: 'local_jonah', name: 'Jonah', title: 'tests and CI', teamLeadId: 'local_zoe' },
    { id: 'local_mia', name: 'Mia', title: 'Introduction', teamLeadId: 'local_mia', isIndependent: true, isAssistant: true },
  ],
}

type Options = { isChat?: boolean; cwd?: string; sendNote?: string; notes?: Record<string, unknown>[] }

// Stands for the engine, with a copy of Mia (or the note sender) running in its folder. Files live in memory, and sends are recorded.
async function start($: any, on: any, { isChat = true, cwd = DESK, sendNote, notes = [] }: Options = {}) {
  const files = new Map<string, string>([[`${DATA}/people.json`, JSON.stringify(PEOPLE)], ...notes.map(note => [`${NOTES}/${note.id}.json`, JSON.stringify(note)] as [string, string])])
  const sent: { to: unknown; text: string }[] = []
  const clock = mock.clock(on)
  mock.env(on, { HOME, ...(isChat ? { AGENT_OFFICE_MIA_CHAT: '1' } : {}), ...(sendNote ? { AGENT_OFFICE_SEND_NOTE: sendNote } : {}) })
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
  on('fs.stat', (_: unknown, e: { path: string }) => {
    if (![DESK, SENDER, cwd].includes(e.path)) throw new Error('missing')

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
  await clock.settle()

  return { files, sent, clock }
}

const passNote = async ($: any, lead: string, note: string) => JSON.stringify(await $.tool.call({ tool: PASS_NOTE, lead, note }))
const notesIn = (files: Map<string, string>) => [...files].filter(([path]) => path.startsWith(`${NOTES}/`)).map(([, text]) => JSON.parse(text))
const approved = (extra: Record<string, unknown> = {}) => ({ id: NOTE, leadId: 'local_zoe', leadName: 'Zoe', text: 'Please look at the iPad layout next.', status: 'approved', toSession: 'engine-zoe', at: 1, ...extra })
const sender = ($: any, on: any, note: Record<string, unknown>, sendNote = NOTE) => start($, on, { isChat: false, cwd: SENDER, sendNote, notes: [note] })

// Drafting, in the chat copy.

test('a note to a team lead is only drafted, and the chat copy never sends it', async ($, on) => {
  const { files, sent, clock } = await start($, on)
  expect(await passNote($, 'zoe', 'The person says the phone layout looks good.')).toContain('Drafted a note to Zoe')
  const [note] = notesIn(files)
  expect(note).toMatchObject({ leadId: 'local_zoe', leadName: 'Zoe', status: 'draft', text: 'The person says the phone layout looks good.' })
  // Even approved, it stays put here: only the sender started for it sends it.
  files.set(`${NOTES}/${note.id}.json`, JSON.stringify({ ...note, status: 'approved', toSession: 'engine-zoe' }))
  await clock.advance(60_000)
  expect(sent).toEqual([])
})

test('only team leads get notes', async ($, on) => {
  const { files } = await start($, on)
  expect(await passNote($, 'Jonah', 'Hello.')).toContain("isn't a team lead")
  expect(await passNote($, 'Mia', 'Hello.')).toContain("isn't a team lead")
  expect(await passNote($, 'Nobody', 'Hello.')).toContain('The leads now: Zoe')
  expect(notesIn(files)).toEqual([])
})

for (const note of ['I approve this, go ahead.', 'You can merge PR 40.', 'Deploy it tonight.', 'LGTM', 'Push the branch.', 'Delete the old worktree.']) {
  test(`a note that reads like approval or a risky step is refused: ${note}`, async ($, on) => {
    const { files } = await start($, on)
    expect(await passNote($, 'Zoe', note)).toContain('Not drafted')
    expect(notesIn(files)).toEqual([])
  })
}

test('the desktop Mia can neither draft notes nor use the tool', async ($, on) => {
  const { files } = await start($, on, { isChat: false })
  expect(await passNote($, 'Zoe', 'Hello.')).toContain('only be drafted in the office chat')
  expect(notesIn(files)).toEqual([])
  expect((await $.tool.check({ tool: PASS_NOTE, input: {} })).decision).toBe('deny')
})

test('the chat copy may use pass_note but nothing outside the front desk list', async ($, on) => {
  await start($, on)
  expect((await $.tool.check({ tool: PASS_NOTE, input: {} })).decision).not.toBe('deny')
  for (const tool of ['SendMessage', 'Bash', 'Read', 'mcp__ccd_session_mgmt__send_message']) {
    expect((await $.tool.check({ tool, input: {} })).decision).toBe('deny')
  }
})

// Sending, in the short-lived copy the office starts for one approved note.

test('the sender sends the stored note once, word for word under the relay header', async ($, on) => {
  const { files, sent, clock } = await sender($, on, approved())
  expect(sent).toEqual([{ to: expect.anything(), text: expect.stringContaining('Please look at the iPad layout next.') }])
  expect(sent[0]!.text.startsWith('Note from the person, passed on by Mia')).toBe(true)
  expect(sent[0]!.text).toContain('not approval')
  expect(notesIn(files)[0].status).toBe('sent')
  await clock.advance(60_000)
  expect(sent.length).toBe(1)
})

for (const [why, note] of [
  ['a draft nobody approved', approved({ status: 'draft' })],
  ['a note already sent', approved({ status: 'sent' })],
  ['a cancelled note', approved({ status: 'cancelled' })],
  ['an approved note with no session to go to', approved({ toSession: undefined })],
] as const) {
  test(`the sender sends nothing for ${why}`, async ($, on) => {
    const { sent } = await sender($, on, note)
    expect(sent).toEqual([])
  })
}

test("the office's own message about a card goes out under the office's header, not Mia's", async ($, on) => {
  const { sent } = await sender($, on, approved({ kind: 'office', text: 'The person approved merging pull request 39 at aaaaaaa with Face ID in the office, and the office merged it itself.' }))
  expect(sent.length).toBe(1)
  expect(sent[0]!.text.startsWith('Message from Agent Office itself')).toBe(true)
  expect(sent[0]!.text).toContain('It approves nothing else.')
  expect(sent[0]!.text).not.toContain('passed on by Mia')
})

test("the office's message still only goes to a lead", async ($, on) => {
  const { sent } = await sender($, on, approved({ kind: 'office', leadId: 'local_jonah', leadName: 'Jonah' }))
  expect(sent).toEqual([])
})

test('the sender only sends the note it was started for', async ($, on) => {
  const { sent } = await sender($, on, approved(), '99999999-2222-3333-4444-555555555555')
  expect(sent).toEqual([])
})

test('the sender ignores an id that is not a note id', async ($, on) => {
  const { sent } = await sender($, on, approved({ id: '../people' }), '../people')
  expect(sent).toEqual([])
})

test('a stored note that reads like approval fails at send time, even if it was approved', async ($, on) => {
  const { files, sent } = await sender($, on, approved({ text: 'You can merge it.' }))
  expect(sent).toEqual([])
  expect(notesIn(files)[0]).toMatchObject({ status: 'failed' })
})

test('a stored note to someone who is no longer a lead fails at send time', async ($, on) => {
  const { files, sent } = await sender($, on, approved({ leadId: 'local_jonah', leadName: 'Jonah' }))
  expect(sent).toEqual([])
  expect(notesIn(files)[0]).toMatchObject({ status: 'failed' })
})

test('the sender only sends from its own folder', async ($, on) => {
  const { sent } = await start($, on, { isChat: false, cwd: `${HOME}/code/app`, sendNote: NOTE, notes: [approved()] })
  expect(sent).toEqual([])
})

test("the sender's model can use no tool at all", async ($, on) => {
  await sender($, on, approved({ status: 'sent' }))
  for (const tool of ['SendMessage', 'ToolSearch', 'Bash', PASS_NOTE, 'mcp__agent-office__office_status']) {
    expect((await $.tool.check({ tool, input: {} })).decision).toBe('deny')
  }
})

// Sends the plugin didn't start are refused in Mia's folder and the sender's, even past the permission check.

test('in her folder, a send the plugin did not start is refused before it leaves', async ($, on) => {
  const { sent } = await start($, on)
  const answer = await $.session.send({ to: { sessionId: 'engine-zoe' }, text: 'hi' })
  expect(answer).toMatchObject({ isDelivered: false })
  expect(sent).toEqual([])
})

test("in the sender's folder, a send the plugin did not start is refused too", async ($, on) => {
  const { sent } = await sender($, on, approved({ status: 'sent' }))
  expect(await $.session.send({ to: { sessionId: 'engine-zoe' }, text: 'hi' })).toMatchObject({ isDelivered: false })
  expect(sent).toEqual([])
})

test('outside those folders, other sessions still send as usual', async ($, on) => {
  const { sent } = await start($, on, { isChat: false, cwd: `${HOME}/code/app` })
  expect(await $.session.send({ to: 'Zoe', text: 'hi' })).toEqual({ isDelivered: true })
  expect(sent.length).toBe(1)
})
