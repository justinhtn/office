import { test } from 'node:test'
import assert from 'node:assert/strict'
import { KEEP_RUNS, STALE_MS, beat, mayBeat, settle } from './runs.js'

const NOW = 1_000_000
const run = (id, extra = {}) => ({ id, startedAt: NOW - 60000, beatAt: NOW - 1000, isHidden: false, isEnded: false, events: [], ...extra })
const current = run('new', { startedAt: NOW, beatAt: NOW })

test('a run that said goodbye is forgotten and not reported', () => {
  const { store, unclean } = settle({ old: run('old', { isEnded: true, beatAt: NOW - 600000 }) }, current, NOW)
  assert.deepEqual(unclean, [])
  assert.deepEqual(Object.keys(store), ['new'])
})

test('a run that stopped beating without a goodbye is reported once, with its last events', () => {
  const events = [{ t: 100, kind: 'page.load' }, { t: 9000, kind: 'avatar.textures.start', id: 'Male_Adult_01' }]
  const first = settle({ old: run('old', { beatAt: NOW - STALE_MS - 1, startedAt: NOW - 50000, events }) }, current, NOW)
  assert.equal(first.unclean.length, 1)
  const [end] = first.unclean
  assert.equal(end.previousRun, 'old')
  assert.equal(end.ranMs, 50000 - STALE_MS - 1)
  assert.equal(end.silentMs, STALE_MS + 1)
  assert.equal(end.wasHidden, false)
  assert.deepEqual(end.lastEvents, events)
  assert.deepEqual(settle(first.store, run('newer'), NOW + 5000).unclean, [])
})

test('this tab\'s last run loading again without a goodbye is reported at once, however recently it beat', () => {
  const { unclean } = settle({ crashed: run('crashed', { beatAt: NOW - 1500 }) }, current, NOW, 'crashed')
  assert.equal(unclean.length, 1)
  assert.equal(unclean[0].sameTab, true)
})

test('a suspended background tab reported as gone, waking up later, is not stored or reported again', () => {
  const { store } = settle({ asleep: run('asleep', { beatAt: 0, isHidden: true }) }, current, NOW)
  assert.equal(mayBeat(store, 'asleep'), false)
  assert.equal(mayBeat(store, 'new'), true)
  assert.ok(!settle(store, run('later'), NOW + 60000).unclean.some(end => end.previousRun === 'asleep'))
})

test('a crash loop never nests one report\'s last events inside the next', () => {
  const report = { t: 5, kind: 'run.unclean', previousRun: 'a', lastEvents: [{ t: 1, kind: 'fps' }] }
  const crashed = beat(run('b'), NOW - STALE_MS - 1, [report, { t: 9, kind: 'stall' }], 25)
  assert.equal('lastEvents' in crashed.events[0], false)
  const { unclean } = settle({ b: crashed }, current, NOW)
  assert.deepEqual(unclean[0].lastEvents.map(event => event.kind), ['run.unclean', 'stall'])
  assert.equal('lastEvents' in unclean[0].lastEvents[0], false)
})

test('the same tab loading again after a silent end is told apart, and so is a tab that was in the background', () => {
  const { unclean } = settle({ a: run('a', { beatAt: 0 }), b: run('b', { beatAt: 0, isHidden: true }) }, current, NOW, 'a')
  const byId = Object.fromEntries(unclean.map(end => [end.previousRun, end]))
  assert.equal(byId.a.sameTab, true)
  assert.equal(byId.a.wasHidden, false)
  assert.equal(byId.b.sameTab, false)
  assert.equal(byId.b.wasHidden, true)
})

test('another tab still beating is left alone', () => {
  const { store, unclean } = settle({ other: run('other', { beatAt: NOW - STALE_MS + 1 }) }, current, NOW)
  assert.deepEqual(unclean, [])
  assert.deepEqual(Object.keys(store).sort(), ['new', 'other'])
})

test('a run restored from the back-forward cache is live again, so its later silent end is still caught', () => {
  const restored = { ...run('back', { isEnded: true }), isEnded: false, beatAt: NOW - STALE_MS - 1 }
  assert.equal(settle({ back: restored }, current, NOW).unclean.length, 1)
})

test('storage that is missing or broken never stops the page', () => {
  for (const broken of [null, undefined, 'text', [1, 2], { x: null }, { y: 'run' }, { z: { id: 5 } }]) {
    const { store, unclean } = settle(broken, current, NOW)
    assert.deepEqual(unclean, [])
    assert.deepEqual(Object.keys(store), ['new'])
  }
})

test('only the newest few runs are kept', () => {
  const many = Object.fromEntries(Array.from({ length: 10 }, (_, i) => [`r${i}`, run(`r${i}`, { beatAt: NOW - 1000 + i })]))
  const { store } = settle(many, current, NOW)
  assert.equal(Object.keys(store).length, KEEP_RUNS)
  assert.ok(store.new)
})

test('a heartbeat keeps only the latest events', () => {
  const events = Array.from({ length: 40 }, (_, t) => ({ t, kind: 'fps' }))
  const next = beat(current, NOW + 3000, events, 25)
  assert.equal(next.beatAt, NOW + 3000)
  assert.equal(next.events.length, 25)
  assert.equal(next.events[0].t, 15)
  assert.equal(current.events.length, 0)
})
