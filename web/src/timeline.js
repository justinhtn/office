// A timeline of how the office starts and runs on this device, sent to the Mac in small batches so a slow phone, or one that
// crashed and reloaded, can be read there with scripts/client-log.py. Times are milliseconds since the page's navigation began.
// Only names of steps, times, sizes and counts are kept: never what anyone wrote, and never a link's query or the token.
import { takeBatch } from './batch.js'
import { beat, mayBeat, settle } from './runs.js'

const SEND_MS = 5000
const BEAT_MS = 3000
const SAMPLE_MS = 5000
// A frame sample is kept every so often even when nothing dipped, with memory, so there's a baseline to compare with.
const BASELINE_MS = 30000
const DIP = .7
const STALL_MS = 1000
const LONG_TASK_MS = 100
// A step that keeps repeating, such as a face that keeps failing, stops adding lines after this many in one run.
const MAX_PER_KIND = 100
// The page's regular samples and comings and goings are worth every line however long it stays open.
const UNCAPPED = new Set(['fps', 'visibility', 'pagehide', 'pageshow', 'freeze', 'resume'])
const MAX_QUEUE = 500
const MAX_BATCH = 150
// Under the server's 64 KB limit, with room for the token and the rest of the body.
const MAX_BATCH_BYTES = 56000
// Messages can quote what was being read, such as text JSON couldn't parse, so only their start is kept.
const MESSAGE_LENGTH = 80
const MAX_KEPT = 1000
const LAST_EVENTS = 25
const RUNS_KEY = 'office-runs'
const TAB_KEY = 'office-tab-run'

const kept = []
const unclean = []
let queue = []
let dropped = 0
let run = null
let token = ''
let frameSampler = null
const counts = new Map()
const done = new Set()
const now = () => Math.round(performance.now())

export function mark(kind, data = {}) {
  const count = (counts.get(kind) || 0) + 1
  counts.set(kind, count)
  if (count > MAX_PER_KIND && !UNCAPPED.has(kind)) { dropped++; return null }
  const event = { t: now(), kind, ...data }
  kept.push(event)
  if (kept.length > MAX_KEPT) kept.shift()
  queue.push(event)
  if (queue.length > MAX_QUEUE) { queue.shift(); dropped++ }

  return event
}

// For a step that should be noted only the first time, such as the first frame.
export function once(kind, data) {
  if (done.has(kind)) return
  done.add(kind)
  mark(kind, data)
}

// Notes when something started, and returns a function that notes how long it took.
export function timed(kind, data = {}) {
  const started = performance.now()
  mark(`${kind}.start`, data)

  return (more = {}) => mark(`${kind}.done`, { ...data, ms: Math.round(performance.now() - started), ...more })
}

// How big a fetched file was, from the browser's own timing of it. Cached files arrive with no transfer.
export function sizeOf(url) {
  try {
    const entry = performance.getEntriesByName(new URL(url, location.href).href).pop()
    if (!entry) return {}

    return { kb: Math.round((entry.encodedBodySize || entry.transferSize || 0) / 1024), ...(entry.transferSize === 0 ? { cached: true } : {}) }
  } catch {
    return {}
  }
}

// Text that may hold a link loses the link's query and fragment, where signatures and ids would be.
export function plain(text, limit = 200) {
  return String(text ?? '').replace(/([^\s'"?#]*)[?#][^\s'"]*/g, '$1').slice(0, limit)
}

// The room's renderer reports its frames here, counted cheaply in its loop, and read every few seconds.
export function sampleFramesWith(sampler) { frameSampler = sampler }

export const events = () => kept.slice()
export const uncleanEnds = () => unclean.slice()

export function startTimeline(pageToken) {
  if (run) return
  token = pageToken
  const wall = Date.now()
  run = { id: `${wall.toString(36)}-${Math.random().toString(36).slice(2, 10)}`, startedAt: wall, beatAt: wall, isHidden: document.hidden, isEnded: false, events: [] }
  try { performance.setResourceTimingBufferSize?.(2000) } catch {}
  mark('run.start', { ...deviceInfo(), navigation: navigationType(), hidden: document.hidden })
  findUncleanEnds()
  watchPage()
  watchErrors()
  watchStalls()
  setInterval(sample, SAMPLE_MS)
  setInterval(keepBeating, BEAT_MS)
  setInterval(() => send(false), SEND_MS)
  keepBeating()
}

function deviceInfo() {
  const standalone = Boolean(navigator.standalone) || Boolean(window.matchMedia?.('(display-mode: standalone)').matches)
  const connection = navigator.connection

  return {
    userAgent: navigator.userAgent,
    screen: `${screen.width}x${screen.height}`,
    viewport: `${innerWidth}x${innerHeight}`,
    pixelRatio: window.devicePixelRatio || 1,
    standalone,
    cores: navigator.hardwareConcurrency || null,
    ...(navigator.deviceMemory ? { deviceMemoryGb: navigator.deviceMemory } : {}),
    ...(connection?.effectiveType ? { connection: connection.effectiveType } : {}),
    // Only which switches are on, such as ?touch or ?perf, never their values.
    options: [...new URLSearchParams(location.search).keys()].slice(0, 10).join(','),
  }
}

function navigationType() {
  try { return performance.getEntriesByType('navigation')[0]?.type || '' } catch { return '' }
}

function readRuns() {
  try { return JSON.parse(localStorage.getItem(RUNS_KEY) || '{}') } catch { return {} }
}

function writeRuns(store) {
  try { localStorage.setItem(RUNS_KEY, JSON.stringify(store)) } catch {}
}

function findUncleanEnds() {
  let tabRunId = null
  try { tabRunId = sessionStorage.getItem(TAB_KEY); sessionStorage.setItem(TAB_KEY, run.id) } catch {}
  const settled = settle(readRuns(), run, Date.now(), tabRunId)
  writeRuns(settled.store)
  settled.unclean.forEach(end => {
    unclean.push(end)
    mark('run.unclean', end)
  })
}

function keepBeating() {
  if (!run || run.isEnded) return
  store(beat(run, Date.now(), kept, LAST_EVENTS))
}

function endRun(isEnded) {
  store({ ...beat(run, Date.now(), kept, LAST_EVENTS), isEnded })
}

function store(next) {
  run = next
  const runs = readRuns()
  // Another page already reported this one as gone while it was suspended, so it isn't stored to be reported twice.
  if (!mayBeat(runs, run.id)) return
  runs[run.id] = run
  writeRuns(runs)
}

function watchPage() {
  addEventListener('load', () => {
    const entry = performance.getEntriesByType?.('navigation')[0]
    const at = key => (entry && entry[key] ? Math.round(entry[key]) : null)
    mark('page.load', entry ? { responseEnd: at('responseEnd'), domInteractive: at('domInteractive'), domContentLoaded: at('domContentLoadedEventEnd'), kb: Math.round((entry.transferSize || 0) / 1024) } : {})
  })
  document.addEventListener('visibilitychange', () => {
    mark('visibility', { state: document.visibilityState })
    run.isHidden = document.hidden
    keepBeating()
    if (document.hidden) send(true)
  })
  addEventListener('pagehide', event => {
    mark('pagehide', { persisted: event.persisted })
    endRun(true)
    send(true)
  })
  addEventListener('pageshow', event => {
    if (!event.persisted) return
    mark('pageshow', { persisted: true })
    endRun(false)
  })
  document.addEventListener('freeze', () => { mark('freeze'); keepBeating(); send(true) })
  document.addEventListener('resume', () => mark('resume'))
  if ('PerformanceObserver' in window && PerformanceObserver.supportedEntryTypes?.includes('longtask')) {
    new PerformanceObserver(list => list.getEntries().forEach(entry => {
      if (entry.duration < LONG_TASK_MS) return
      mark('longtask', { ms: Math.round(entry.duration), startMs: Math.round(entry.startTime) })
    })).observe({ type: 'longtask', buffered: true })
  }
}

function watchErrors() {
  addEventListener('error', event => {
    const target = event.target
    // A file that failed to load reports on its element, not as a script error.
    if (target && target !== window && (target.src || target.href)) {
      mark('error.resource', { tag: target.tagName?.toLowerCase(), url: plain(target.src || target.href) })
      return
    }
    mark('error', { name: event.error?.name || null, message: plain(event.message, MESSAGE_LENGTH), file: plain(event.filename), line: event.lineno || null, column: event.colno || null })
  }, true)
  addEventListener('unhandledrejection', event => {
    const reason = event.reason
    mark('error.rejection', { name: reason?.name || null, message: plain(reason?.message ?? reason, MESSAGE_LENGTH) })
  })
}

// iOS Safari has no long task timings, so a timer that fires late stands in for one. Hidden pages are paused on purpose.
function watchStalls() {
  let last = performance.now()
  setInterval(() => {
    const at = performance.now(), late = at - last - STALL_MS
    last = at
    if (document.hidden || late < STALL_MS) return
    mark('stall', { ms: Math.round(late) })
  }, STALL_MS)
}

let lastSampleAt = performance.now()
let lastBaselineAt = 0
function sample() {
  const at = performance.now(), seconds = (at - lastSampleAt) / 1000
  lastSampleAt = at
  if (document.hidden || !frameSampler) return
  const frames = frameSampler()
  if (!frames.expected) return
  const fps = Math.round(frames.count / seconds * 10) / 10
  const isDip = fps < frames.expected * DIP
  if (!isDip && at - lastBaselineAt < BASELINE_MS) return
  lastBaselineAt = at
  mark(isDip ? 'fps.dip' : 'fps', { fps, expected: frames.expected, pace: frames.pace, ...frames.gpu, ...memory() })
}

function memory() {
  const heap = performance.memory
  return heap ? { heapMb: Math.round(heap.usedJSHeapSize / 1048576), heapLimitMb: Math.round(heap.jsHeapSizeLimit / 1048576) } : {}
}

async function send(isLeaving) {
  if (!queue.length || !token) return
  const taken = takeBatch(queue, MAX_BATCH, MAX_BATCH_BYTES)
  const batch = taken.batch
  queue = taken.rest
  dropped += taken.dropped
  const sentDropped = dropped
  const body = JSON.stringify({ token, run: run.id, dropped: sentDropped, events: batch })
  dropped = 0
  // The token goes in the body because a beacon can't carry headers, and the text type keeps the beacon a simple request.
  if (isLeaving && navigator.sendBeacon?.('/api/client-log', new Blob([body], { type: 'text/plain' }))) return
  try {
    const response = await fetch('/api/client-log', { method: 'POST', body, keepalive: body.length < 60000, headers: { 'Content-Type': 'text/plain' } })
    // A batch the server refused as bad or too big would be refused again, so it's counted as dropped rather than lost unnoticed.
    if (response.status === 400 || response.status === 413) dropped += sentDropped + batch.length
    else if (!response.ok) throw new Error('Not kept')
  } catch {
    // Kept for the next try, oldest first, so a dropped connection loses nothing.
    queue = [...batch, ...queue].slice(-MAX_QUEUE)
    dropped += sentDropped
  }
}
