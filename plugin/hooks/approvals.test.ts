import { expect, mock, test } from 'claude-code/testing'

const APPROVAL = 'mcp__agent-office__request_approval'
const HOME = '/Users/me'
const DATA = `${HOME}/.agent-office`
const REQUESTS = `${DATA}/approvals/requests`
const PEOPLE = {
  people: [
    { id: 'local_zoe', name: 'Zoe', title: 'agent office application', teamLeadId: 'local_zoe' },
    { id: 'local_jonah', name: 'Jonah', title: 'tests and CI', teamLeadId: 'local_zoe', startedBy: 'local_zoe' },
  ],
}

// Stands for the engine with one session running. outcome, when given, is what the office writes back to a request.
async function session($: any, on: any, { self = 'local_zoe', cwd = `${HOME}/code/app`, outcome }: { self?: string; cwd?: string; outcome?: Record<string, unknown> } = {}) {
  const files = new Map<string, string>([[`${DATA}/people.json`, JSON.stringify(PEOPLE)]])
  const registered: string[] = []
  const clock = mock.clock(on)
  mock.env(on, { HOME })
  on('session.start', (_: unknown, e: { cwd: string }) => ({ cwd: e.cwd }))
  on('session.id', () => ({ value: self }))
  on('session.cwd', () => ({ value: cwd }))
  on('fs.exists', (_: unknown, e: { path: string }) => ({ value: files.has(e.path) }))
  on('fs.read', (_: unknown, e: { path: string }) => {
    const text = files.get(e.path)
    if (text === undefined) throw new Error('missing')
    // The office answers a request as soon as it's written.
    if (outcome && e.path.startsWith(`${REQUESTS}/`)) return { value: JSON.stringify({ ...JSON.parse(text), ...outcome }) }

    return { value: text }
  })
  on('fs.write', (_: unknown, e: { path: string; text: string }) => {
    files.set(e.path, e.text)

    return { value: undefined }
  })
  on('fs.stat', () => {
    throw new Error('missing')
  })
  on('tool.check', () => ({ decision: 'allow' }))
  on('tool.register', (_: unknown, e: { name: string }) => {
    registered.push(e.name)

    return { value: undefined }
  })
  on('command.register', () => ({ value: { command: 'office' } }))
  on('mcp.call', () => ({ value: { isError: true, content: [] } }))
  await $.session.start({ cwd, surface: 'cli', isInteractive: false })
  await clock.settle()

  return { files, registered, clock }
}

const requestsIn = (files: Map<string, string>) => [...files].filter(([path]) => path.startsWith(`${REQUESTS}/`)).map(([, text]) => JSON.parse(text))

async function ask($: any, clock: any, input: Record<string, unknown>) {
  const answer = $.tool.call({ tool: APPROVAL, ...input })
  await clock.advance(8_000)

  return JSON.stringify(await answer)
}

test('a lead asks for a merge, and hears that the card is up', async ($, on) => {
  const { files, clock } = await session($, on, { outcome: { outcome: 'shown' } })
  expect(await ask($, clock, { kind: 'merge', pr: 39, summary: 'Ready.' })).toContain('The card is in the office now')
  expect(requestsIn(files)[0]).toMatchObject({ session: 'local_zoe', kind: 'merge', pr: 39, summary: 'Ready.' })
})

test("a lead hears why the office didn't make a card", async ($, on) => {
  const { clock } = await session($, on, { outcome: { outcome: 'refused', problem: "Pull request 39: It's a draft." } })
  expect(await ask($, clock, { kind: 'merge', pr: 39, summary: 'Ready.' })).toContain("No card was made: Pull request 39: It's a draft.")
})

test('if the office is slow, the lead is told a card may still come', async ($, on) => {
  const { clock } = await session($, on)
  expect(await ask($, clock, { kind: 'merge', pr: 39, summary: 'Ready.' })).toContain("hasn't checked it yet")
})

test('someone who leads no team can only ask their lead', async ($, on) => {
  const { files, clock } = await session($, on, { self: 'local_jonah' })
  expect(await ask($, clock, { kind: 'merge', pr: 39, summary: 'Ready.' })).toContain('Only a team lead')
  expect(requestsIn(files)).toEqual([])
})

test('Mia has no such tool, and the front desk refuses it', async ($, on) => {
  const { registered } = await session($, on, { cwd: `${DATA}/front-desk` })
  expect(registered).not.toContain('request_approval')
  expect((await $.tool.check({ tool: APPROVAL, input: {} })).decision).toBe('deny')
})

test('a lead has the tool', async ($, on) => {
  const { registered } = await session($, on)
  expect(registered).toContain('request_approval')
})
