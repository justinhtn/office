export const token = document.querySelector('meta[name="office-token"]').content

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
export const listenToEdition = () => audioFrom('/api/newsroom/listen', {})
export const announce = (ids, isWelcome, playOnMac = false) => audioFrom('/api/announce', { ids, isWelcome, playOnMac })

export const withId = (path, id, extra = {}) =>
  `${path}?${new URLSearchParams({ id, ...extra })}`

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
