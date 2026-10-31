import type { EngineInterface, Register } from 'claude-code'

// Runs in every Claude Code session. One session at a time publishes the session
// list. Any session can answer a request, and an atomic mkdir decides which one does,
// so a message is never sent twice.
const PUBLISH_MS = 10_000
const BRIDGE_MS = 1_000
const LEASE_MS = 30_000
const ROSTER_MS = 30_000
const ROSTER_LIMIT = 40
const SESSION_TOOLS = 'ccd_session_mgmt'

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
type BridgeRequest = { action?: string; session?: string; message?: string; before?: string }
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
        : request.action === 'send' && request.message
          ? await $.mcp.call(SESSION_TOOLS, 'send_message', {
              session_id: request.session,
              message: request.message,
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

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    selfId = await $.session.id()
    dataFolder = `${await $.env.get('HOME')}/.agent-office`
    await $.command.register({
      name: 'office',
      description: 'Show the address of your Agent Office workspace',
    })
    if (await $.fs.exists(`${dataFolder}/bridge`)) {
      void publish($)
      void loadRoster($)
      $.clock.every(PUBLISH_MS, () => void publish($))
      $.clock.every(BRIDGE_MS, () => void answerBridge($))
      $.clock.every(ROSTER_MS, () => void loadRoster($))
    }

    return next(e)
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
