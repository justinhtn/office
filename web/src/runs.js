// Each page load is a run that keeps a heartbeat in the browser's storage and says goodbye when the page goes away.
// A run that stopped beating without a goodbye ended badly: iOS reloads a tab that ran out of memory without telling the page.

// A live page beats every few seconds, so one this quiet has stopped. Another tab of the office, still open, keeps beating.
export const STALE_MS = 15000
// Enough to tell a few tabs apart, small enough that storage stays tiny.
export const KEEP_RUNS = 4

// Settles the stored runs as a new one starts: the ones that ended without a goodbye are reported and forgotten,
// the ones that ended well are forgotten, and live ones in other tabs are kept.
export function settle(store, current, now, tabRunId = null) {
  const kept = {}
  const unclean = []
  Object.values(isObject(store) ? store : {}).forEach(run => {
    if (!isObject(run) || typeof run.id !== 'string' || run.id === current.id) return
    if (run.isEnded) return
    if (!(now - Number(run.beatAt || 0) < STALE_MS)) {
      unclean.push(uncleanEnd(run, now, tabRunId))
      return
    }
    kept[run.id] = run
  })
  kept[current.id] = current

  return { store: newest(kept), unclean: unclean.sort((a, b) => a.startedAt - b.startedAt) }
}

// What the next run says about one that ended without a goodbye.
export function uncleanEnd(run, now, tabRunId = null) {
  const startedAt = Number(run.startedAt) || 0, beatAt = Number(run.beatAt) || startedAt

  return {
    previousRun: run.id,
    startedAt,
    ranMs: Math.max(0, beatAt - startedAt),
    silentMs: Math.max(0, now - beatAt),
    // Hidden means iOS may simply have put a background tab away; visible means it died in front of the person.
    wasHidden: Boolean(run.isHidden),
    // The same tab loading again is the reload iOS does after a crash.
    sameTab: Boolean(tabRunId && tabRunId === run.id),
    lastEvents: Array.isArray(run.events) ? run.events : [],
  }
}

// The run with a new heartbeat, and only its latest events, since that's all the next run needs to tell what happened.
export function beat(run, now, events, keep) {
  return { ...run, beatAt: now, events: events.slice(-keep) }
}

function newest(runs) {
  const latest = Object.values(runs).sort((a, b) => Number(b.beatAt || 0) - Number(a.beatAt || 0)).slice(0, KEEP_RUNS)

  return Object.fromEntries(latest.map(run => [run.id, run]))
}

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}
