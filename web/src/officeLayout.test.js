import assert from 'node:assert/strict'
import test from 'node:test'
import { closedRooms, hasRoom, keepPlaces, onFloor, parseLayout, shownSlots } from './officeLayout.js'

// api.js reads the page's token when it loads, so it gets a stand-in page.
globalThis.document = { querySelector: () => ({ content: '' }) }
const { teamsOf } = await import('./api.js')

const NOW = Date.parse('2026-11-06T12:00:00Z')
const daysAgo = days => new Date(NOW - days * 86400000).toISOString()
const person = (id, teamId, days, extra = {}) => ({ id, name: id, project: teamId, teamId, teamLeadId: id, lastActivityAt: daysAgo(days), ...extra })
const names = list => list.map(one => one.id).sort()

test('every team stays on the floor however long it has been quiet, one member or many', () => {
  const cast = [person('leo', 'project:Clancy', 0), person('priya', 'project:Clancy', 7.5), person('hugo', 'project:Older projects', 50), person('zoe', 'tree:zoe', 20), person('nora', 'tree:zoe', 30), person('ada', 'tree:ada', 40)]
  assert.deepEqual(names(onFloor(cast, NOW)), ['ada', 'hugo', 'leo', 'nora', 'priya', 'zoe'])
})

test('someone alone goes away after a week unless busy, asking, or the assistant', () => {
  const cast = [person('kofi', 'solo:kofi', 8), person('mina', 'solo:mina', 2), person('a', 'solo:a', 30, { isRunning: true }), person('b', 'solo:b', 30, { request: { id: 'r' } }), person('c', 'solo:c', 30, { isAssistant: true })]
  assert.deepEqual(names(onFloor(cast, NOW)), ['a', 'b', 'c', 'mina'])
})

test('every team gets a room, even with one quiet member, and anyone idle and alone does not', () => {
  const rooms = teamsOf([person('leo', 'project:Clancy', 3), person('mina', 'solo:mina', 1), person('nell', 'project:Newsroom', 1), person('ada', 'tree:ada', 40)]).filter(hasRoom)
  assert.deepEqual(rooms.map(team => team.lead.teamId).sort(), ['project:Clancy', 'project:Newsroom', 'tree:ada'])
})

test('a team that went quiet for a week still has a room, which is what put Clancy back', () => {
  const cast = [person('leo', 'project:Clancy', 0), person('priya', 'project:Clancy', 7.5)]
  assert.deepEqual(teamsOf(onFloor(cast, NOW)).filter(hasRoom).map(team => team.members.length), [2])
})

test('a closed room leaves the floor, and nobody in it is counted away', () => {
  const cast = [person('leo', 'project:Clancy', 3), person('priya', 'project:Clancy', 9), person('sam', 'project:Legal RAG', 12)]
  const closed = { 'project:Clancy': daysAgo(1) }
  assert.deepEqual(names(onFloor(cast, NOW, closed)), ['sam'])
  assert.deepEqual([...closedRooms(cast, closed)], ['project:Clancy'])
})

test('a closed room comes back when someone in it works again', () => {
  const closed = { 'project:Clancy': daysAgo(1) }
  for (const leo of [person('leo', 'project:Clancy', 0.5), person('leo', 'project:Clancy', 3, { isRunning: true }), person('leo', 'project:Clancy', 3, { request: { id: 'r' } })]) {
    assert.deepEqual(names(onFloor([leo, person('priya', 'project:Clancy', 9)], NOW, closed)), ['leo', 'priya'])
  }
})

test('work finished before the room closed does not bring it back', () => {
  const closed = { 'project:Clancy': daysAgo(1) }
  assert.deepEqual(onFloor([person('leo', 'project:Clancy', 3, { isFinished: true })], NOW, closed), [])
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
