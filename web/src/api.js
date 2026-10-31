const token = document.querySelector('meta[name="office-token"]').content

export async function api(path, body) {
  const response = await fetch(path, {
    method: body ? 'POST' : 'GET',
    cache: 'no-store',
    headers: { 'X-Office-Token': token, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  })
  const data = await response.json().catch(() => ({}))
  // The token changes when the server restarts, so a page left open has to reload.
  if (response.status === 403 && data.error === 'Bad token.') window.location.reload()
  if (!response.ok) throw new Error(data.error || 'Request failed')

  return data
}

export const withId = (path, id, extra = {}) =>
  `${path}?${new URLSearchParams({ id, ...extra })}`

// The transcript's header says how far it reaches and how to page further back.
export function parseTranscriptHeader(text) {
  const counts = /showing (\d+) of (\d+) messages/.exec(text)
  const cursor = /before_uuid="([^"]+)"/.exec(text)

  return { total: counts ? Number(counts[2]) : null, cursor: cursor ? cursor[1] : null }
}

const SYSTEM_LABELS = {
  'side-sessions-event': 'Side sessions reported back',
  'task-notification': 'Background task update',
  'ci-monitor-event': 'CI update',
}

// Turns the app's plain-text transcript into chat messages.
export function parseTranscript(text) {
  const cleaned = text.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '')
  const parts = cleaned.split(/^\[(user|assistant|result)\] ?/m)
  const messages = []
  for (let i = 1; i < parts.length; i += 2) {
    const role = parts[i]
    let body = (parts[i + 1] || '').trim()
    if (!body) continue
    const peer = /<cross-session-message[^>]*from-name="([^"]*)"[^>]*>([\s\S]*?)<\/cross-session-message>/.exec(body)
    if (peer) {
      messages.push({ role: 'peer', from: peer[1], body: peer[2].trim() })
      continue
    }
    if (role === 'assistant' && /^\(called [^)]*\)$/.test(body)) {
      messages.push({ role: 'tool', body: body.slice(8, -1) })
      continue
    }
    const system = /^<(side-sessions-event|task-notification|ci-monitor-event)\b/.exec(body)
    if (role === 'user' && system) {
      messages.push({ role: 'tool', body: SYSTEM_LABELS[system[1]], isNote: true })
      continue
    }
    body = body
      .replace(/^\[Image: source:[^\]]*\]\s*/gm, '[Image]\n')
      .replace(/^\[Image: original [^\]]*\]\s*/gm, '')
      .trim()
    if (!body) continue
    messages.push({ role, body })
  }

  return messages
}

export function age(iso) {
  const then = Date.parse(iso)
  if (Number.isNaN(then)) return ''
  const minutes = Math.max(0, Math.round((Date.now() - then) / 60000))
  if (minutes < 60) return `${minutes}m`
  if (minutes < 1440) return `${Math.round(minutes / 60)}h`

  return `${Math.round(minutes / 1440)}d`
}

export function teamsOf(list, everyone) {
  const byId = Object.fromEntries(everyone.map(p => [p.id, p]))
  const leadOf = person => {
    let lead = person
    const seen = new Set([person.id])
    while (lead.startedBy && byId[lead.startedBy] && !seen.has(lead.startedBy)) {
      seen.add(lead.startedBy)
      lead = byId[lead.startedBy]
    }

    return lead
  }
  const teams = new Map()
  list.forEach(person => {
    const lead = leadOf(person)
    if (!teams.has(lead.id)) teams.set(lead.id, { lead, members: [] })
    teams.get(lead.id).members.push(person)
  })

  return [...teams.values()]
    .map(team => ({
      lead: team.lead,
      members: [team.lead, ...team.members.filter(person => person.id !== team.lead.id)],
    }))
    .sort((a, b) => (b.lead.lastActivityAt || '').localeCompare(a.lead.lastActivityAt || ''))
}
