import type { EngineInterface, Register } from 'claude-code'

// Runs in every Claude Code session. One session at a time publishes the session
// list. Any session can answer a request, and an atomic mkdir decides which one does,
// so a request is never answered twice.
const PUBLISH_MS = 10_000
const BRIDGE_MS = 1_000
const LEASE_MS = 30_000
const ROSTER_MS = 30_000
const ROSTER_LIMIT = 40
const SESSION_TOOLS = 'ccd_session_mgmt'
const WINDOW_TOOLS = 'ccd_window'
const FOCUS_MS = 2_000
const ATTENTION_TOOL = 'mcp__agent-office__ask_for_attention'
const MAX_MESSAGE = 2000
const MAX_FILES = 10

type Listed = {
  sessionId: string
  title?: string
  cwd?: string
  prNumber?: number
  isRunning?: boolean
  lastActivityAt?: string
  link?: string
  startedBy?: string
  parentSessionId?: string
  group?: { name?: string } | null
}
type BridgeRequest = { action?: string; session?: string; before?: string }
type Person = { id: string; name: string; title: string; project: string; startedBy?: string }

let selfId = ''
let dataFolder = ''
let isBridging = false
let roster = ''

// A worktree belongs to the repo that holds it, not to its own folder.
function projectOf(session: Listed): string {
  if (session.group?.name) return session.group.name
  if (session.cwd?.includes('/scratch-workspaces/')) return 'No folder'
  const repo = (session.cwd ?? '').split('/.claude/worktrees/')[0] ?? ''

  return repo.split('/').filter(Boolean).pop() ?? 'Other'
}

function toRow(session: Listed) {
  return {
    id: session.sessionId,
    title: session.title ?? 'Untitled',
    project: projectOf(session),
    cwd: session.cwd,
    startedBy: session.startedBy ?? session.parentSessionId,
    prNumber: session.prNumber,
    isRunning: session.isRunning === true,
    lastActivityAt: session.lastActivityAt ?? '',
    link: session.link,
  }
}

function textOf(result: { content?: readonly unknown[]; isError?: boolean }): string {
  return (result.content ?? [])
    .map(block =>
      typeof block === 'object' && block !== null && 'text' in block ? String(block.text) : '',
    )
    .join('\n')
}

// The app's tools and the office use its local_ id, not the engine's session id.
async function appSessionId($: EngineInterface): Promise<string> {
  try {
    const own = await $.mcp.call(SESSION_TOOLS, 'get_session', { session_id: 'self' })
    if (!own.isError) return (JSON.parse(textOf(own)) as Listed).sessionId
  } catch {
    // Outside the desktop app there's no such tool.
  }

  return $.session.id()
}

// The app's tools can still be connecting when a session starts.
async function ensureSelf($: EngineInterface): Promise<void> {
  if (!selfId.startsWith('local_')) selfId = await appSessionId($)
}

async function holdsLease($: EngineInterface): Promise<boolean> {
  const path = `${dataFolder}/lease.json`
  let lease = { owner: '', at: 0 }
  try {
    lease = JSON.parse(await $.fs.read(path)) as typeof lease
  } catch {
    // No lease yet, so this session can take it.
  }
  if (lease.owner !== selfId && Date.now() - lease.at < LEASE_MS) return false
  await $.fs.write(path, JSON.stringify({ owner: selfId, at: Date.now() }))

  return true
}

async function publish($: EngineInterface): Promise<void> {
  try {
    await ensureSelf($)
    if (!selfId.startsWith('local_')) return
    if (!(await holdsLease($))) return
    const listed = await $.mcp.call(SESSION_TOOLS, 'list_sessions', { limit: 200 })
    if (listed.isError) return
    const people = (JSON.parse(textOf(listed)) as Listed[]).map(toRow)
    // The list leaves out the session asking, so add it back.
    const own = await $.mcp.call(SESSION_TOOLS, 'get_session', { session_id: 'self' })
    if (!own.isError) people.push(toRow(JSON.parse(textOf(own)) as Listed))
    await $.fs.write(
      `${dataFolder}/sessions.raw.json`,
      JSON.stringify({ updatedAt: new Date().toISOString(), people }),
    )
  } catch {
    // The page shows how old its data is, so it's visible if this keeps failing.
  }
}

async function answer(
  $: EngineInterface,
  request: BridgeRequest,
): Promise<{ status: string; text?: string; error?: string }> {
  try {
    const result =
      request.action === 'transcript'
        ? await $.mcp.call(SESSION_TOOLS, 'list_events', {
            session_id: request.session,
            limit: 300,
            ...(request.before ? { before_uuid: request.before } : {}),
          })
        : undefined
    if (!result) return { status: 'error', error: 'Unknown request.' }
    const text = textOf(result)

    return result.isError ? { status: 'error', error: text } : { status: 'ok', text }
  } catch (error) {
    return { status: 'error', error: error instanceof Error ? error.message : String(error) }
  }
}

async function answerBridge($: EngineInterface): Promise<void> {
  if (isBridging) return
  isBridging = true
  try {
    await ensureSelf($)
    const folder = `${dataFolder}/bridge`
    if (!(await $.fs.exists(folder))) return
    for (const entry of await $.fs.list(folder)) {
      const match = /^req-([0-9a-f]{32})\.json$/.exec(entry.name)
      if (!match) continue
      const request = JSON.parse(await $.fs.read(`${folder}/${entry.name}`)) as BridgeRequest
      // The app's tools can't target the session calling them, so leave it to another.
      if (request.session === selfId) continue
      const claim = await $.process.run(['mkdir', `${folder}/claim-${match[1]}`])
      if (claim.exitCode !== 0) continue
      await $.fs.write(
        `${folder}/res-${match[1]}.json`,
        JSON.stringify(await answer($, request)),
      )
    }
  } catch {
    // The server times the request out and tells the person.
  } finally {
    isBridging = false
  }
}

// Tells the office which sessions are on screen, so those can speak to the person.
async function publishFocus($: EngineInterface): Promise<void> {
  try {
    const path = `${dataFolder}/focus.json`
    if (await $.fs.exists(path)) {
      const { at } = JSON.parse(await $.fs.read(path)) as { at: number }
      if (Date.now() - at < FOCUS_MS - 500) return
    }
    const layout = await $.mcp.call(WINDOW_TOOLS, 'get_window_layout', {})
    if (layout.isError) return
    const { main_window: main, popout_windows: popouts } = JSON.parse(textOf(layout)) as {
      main_window?: { panes?: { kind?: string; session_id?: string }[] }
      popout_windows?: { sessions?: { session_id?: string }[] }
    }
    const sessions = [
      ...(main?.panes ?? []).filter(pane => pane.kind === 'session').map(pane => pane.session_id),
      ...(popouts?.sessions ?? []).map(popout => popout.session_id),
    ]
    await $.fs.write(path, JSON.stringify({ sessions: [...new Set(sessions)], at: Date.now() }))
  } catch {
    // Without this the office falls back to whoever was last clicked there.
  }
}

// Holds no statuses, so it only changes when people do and keeps the prompt cache warm.
async function loadRoster($: EngineInterface): Promise<void> {
  try {
    const { people } = JSON.parse(await $.fs.read(`${dataFolder}/people.json`)) as { people: Person[] }
    const named = new Map(people.map(person => [person.id, person.name]))
    const lines = people.slice(0, ROSTER_LIMIT).map(person => {
      const lead = person.startedBy ? named.get(person.startedBy) : undefined

      return `- ${person.name}: "${person.title}" (${person.project}${lead ? `, reports to ${lead}` : ''}; session ${person.id})`
    })
    roster = lines.length
      ? [
          'The person may call their Claude Code sessions by these names, from their Agent Office workspace. A session started by another reports to it. The id is what session tools take.',
          ...lines,
        ].join('\n')
      : ''
  } catch {
    roster = ''
  }
}

async function raiseRequest(
  $: EngineInterface,
  input: { message?: unknown; show?: unknown },
): Promise<string> {
  await ensureSelf($)
  const message = String(input.message ?? '').trim().slice(0, MAX_MESSAGE)
  if (!message) throw new Error('A message is required.')
  const show = (Array.isArray(input.show) ? input.show : []).map(String).slice(0, MAX_FILES)
  const id = crypto.randomUUID()
  await $.fs.write(
    `${dataFolder}/requests/${id}.json`,
    JSON.stringify({ id, session: selfId, message, show, at: new Date().toISOString() }),
  )

  return "Your request is in the person's Needs you list. Their reply will arrive as a message. Carry on with anything that doesn't depend on it, or end your turn."
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    selfId = await appSessionId($)
    dataFolder = `${await $.env.get('HOME')}/.agent-office`
    await $.command.register({
      name: 'office',
      description: 'Show the address of your Agent Office workspace',
    })
    await $.tool.register({
      name: 'ask_for_attention',
      description:
        'Ask the person to look at something in their Agent Office workspace, when you need a decision or have something worth showing them. Not for routine progress.',
      inputSchema: {
        type: 'object',
        properties: {
          message: { type: 'string', description: 'What you need from them, in one or two plain sentences.' },
          show: {
            type: 'array',
            items: { type: 'string' },
            description: 'Optional file paths to show them, relative to your working directory.',
          },
        },
        required: ['message'],
      },
      isDeferred: false,
    })
    if (await $.fs.exists(`${dataFolder}/bridge`)) {
      void publish($)
      void loadRoster($)
      $.clock.every(PUBLISH_MS, () => void publish($))
      $.clock.every(BRIDGE_MS, () => void answerBridge($))
      $.clock.every(ROSTER_MS, () => void loadRoster($))
      $.clock.every(FOCUS_MS, () => void publishFocus($))
    }

    return next(e)
  })

  on('tool.call', { tool: ATTENTION_TOOL }, async ($, e) => {
    const input = e as unknown as { message?: unknown; show?: unknown }

    const text = await raiseRequest($, input)

    return { result: text, text }
  })

  on('command.run', { command: 'office' }, async () => ({
    text: 'Agent Office is at http://localhost:8794',
  }))

  on('prompt.compose', async (_$, e, next) => {
    const composed = await next(e)
    if (!roster) return composed

    return {
      sections: [
        ...composed.sections,
        { id: 'agent-office:roster', text: roster, scope: 'session' as const },
      ],
    }
  })
}
