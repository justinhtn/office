// Which team sits in each of the split view's four panes. A pane holds a team's key, or null when empty.
export const PANE_COUNT = 4

const urgency = team => {
  const members = team.members
  if (members.some(member => member.request)) return 0
  if (members.some(member => member.isRunning)) return 1
  if (members.some(member => member.isFinished)) return 2

  return 3
}

// The first time, panes fill with the teams that most need looking at, in office order otherwise.
export function busiestTeams(teams) {
  return teams.map((team, index) => ({ team, index })).sort((a, b) => urgency(a.team) - urgency(b.team) || a.index - b.index).map(({ team }) => team.lead.id)
}

export function firstPanes(teams) {
  const keys = busiestTeams(teams).slice(0, PANE_COUNT)

  return [...keys, ...Array(PANE_COUNT - keys.length).fill(null)]
}

// A team already on screen moves rather than showing twice, and whatever was in the pane takes its old place.
export function placeTeam(panes, key, index) {
  const next = [...panes], from = next.indexOf(key)
  if (from === index) return next
  if (from >= 0) next[from] = next[index]
  next[index] = key

  return next
}

export function clearPane(panes, index) {
  return panes.map((key, i) => (i === index ? null : key))
}

// A team that has broken up leaves its pane empty, and comes back if it reappears.
export function shownPanes(panes, teams) {
  return panes.map(key => teams.find(team => team.lead.id === key) ?? null)
}
