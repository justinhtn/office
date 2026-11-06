import assert from 'node:assert/strict'
import test from 'node:test'
import { hasRoom, keepPlaces, onFloor, parseLayout, shownSlots } from './officeLayout.js'

// api.js reads the page's token when it loads, so it gets a stand-in page.
globalThis.document = { querySelector: () => ({ content: '' }) }
const { teamsOf } = await import('./api.js')

const NOW = Date.parse('2026-11-06T12:00:00Z')
const daysAgo = days => new Date(NOW - days * 86400000).toISOString()
const person = (id, teamId, days, extra = {}) => ({ id, name: id, project: teamId, teamId, teamLeadId: id, lastActivityAt: daysAgo(days), ...extra })
const names = list => list.map(one => one.id).sort()

test('a project team keeps everyone on the floor however long it has been quiet', () => {
  const cast = [person('leo', 'project:Clancy', 0), person('priya', 'project:Clancy', 7.5), person('hugo', 'project:Older projects', 50)]
  assert.deepEqual(names(onFloor(cast, NOW)), ['hugo', 'leo', 'priya'])
})

test('a team of two or more stays, and someone alone goes away after a week', () => {
  const cast = [person('zoe', 'tree:zoe', 20), person('nora', 'tree:zoe', 30), person('kofi', 'solo:kofi', 8), person('mina', 'solo:mina', 2)]
  assert.deepEqual(names(onFloor(cast, NOW)), ['mina', 'nora', 'zoe'])
})

test('someone alone who is busy or asking stays on the floor', () => {
  const cast = [person('a', 'solo:a', 30, { isRunning: true }), person('b', 'solo:b', 30, { request: { id: 'r' } }), person('c', 'solo:c', 30, { isAssistant: true })]
  assert.deepEqual(names(onFloor(cast, NOW)), ['a', 'b', 'c'])
})

test('every project gets a room, even with one quiet member, and anyone idle and alone does not', () => {
  const rooms = teamsOf([person('leo', 'project:Clancy', 3), person('mina', 'solo:mina', 1), person('nell', 'project:Newsroom', 1)]).filter(hasRoom)
  assert.deepEqual(rooms.map(team => team.lead.teamId).sort(), ['project:Clancy', 'project:Newsroom'])
})

test('a team that went quiet for a week still has a room, which is what put Clancy back', () => {
  const cast = [person('leo', 'project:Clancy', 0), person('priya', 'project:Clancy', 7.5)]
  assert.deepEqual(teamsOf(onFloor(cast, NOW)).filter(hasRoom).map(team => team.members.length), [2])
})

test('a newcomer takes a free place and nobody else moves', () => {
  assert.deepEqual(keepPlaces(['a', 'meeting', 'gone', 'b', 'lounge', 'office'], ['a', 'b', 'c']), ['a', 'meeting', 'c', 'b', 'lounge', 'office'])
  assert.deepEqual(keepPlaces(['a', 'meeting', 'lounge', 'office'], ['a', 'c']), ['a', 'meeting', 'lounge', 'office', 'c'])
})

test('a team that has gone keeps its place for when it comes back, but leaves no gap on the floor', () => {
  const slots = keepPlaces(['a', 'meeting', 'clancy', 'b', 'lounge', 'office'], ['a', 'b'])
  assert.deepEqual(slots, ['a', 'meeting', 'clancy', 'b', 'lounge', 'office'])
  assert.deepEqual(shownSlots(slots, ['a', 'b']), ['a', 'meeting', 'b', 'lounge', 'office'])
  assert.deepEqual(shownSlots(keepPlaces(slots, ['a', 'b', 'clancy']), ['a', 'b', 'clancy']), ['a', 'meeting', 'clancy', 'b', 'lounge', 'office'])
})

test('a stored layout is read only when it is well formed', () => {
  assert.deepEqual(parseLayout({ slots: ['a', 'meeting'], seats: { a: ['x'], bad: 'y' } }), { slots: ['a', 'meeting'], seats: { a: ['x'] } })
  for (const odd of [null, {}, { slots: 'a' }, { slots: [''] }, { slots: [3] }]) assert.equal(parseLayout(odd), null)
})
