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

async function audioFrom(path, body) {
  const response = await fetch(path, {
    method: 'POST',
    headers: { 'X-Office-Token': token, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error || 'No voice available')

  return URL.createObjectURL(await response.blob())
}

export const speak = (id, kind = 'words', playOnMac = false) => audioFrom('/api/speak', { id, kind, playOnMac })
export const announce = (ids, isWelcome, playOnMac = false) => audioFrom('/api/announce', { ids, isWelcome, playOnMac })

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

export function teamsOf(list) {
  const teams = new Map()
  list.forEach(person => {
    const key = person.teamId || person.id
    if (!teams.has(key)) teams.set(key, [])
    teams.get(key).push(person)
  })

  return [...teams.values()]
    .map(members => {
      // The lead may be on the Away list, so someone recent stands in.
      const recent = [...members].sort((a, b) => (b.lastActivityAt || '').localeCompare(a.lastActivityAt || ''))
      const lead = members.find(person => person.id === person.teamLeadId) || recent[0]

      return { lead, name: lead.teamName || lead.name, isIndependent: Boolean(lead.isIndependent), members: [lead, ...members.filter(person => person.id !== lead.id)] }
    })
    .sort((a, b) => (b.lead.lastActivityAt || '').localeCompare(a.lead.lastActivityAt || ''))
}
