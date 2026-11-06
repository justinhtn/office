import { test } from 'node:test'
import assert from 'node:assert/strict'
import { takeBatch } from './batch.js'

const event = (t, size = 0) => ({ t, kind: 'fps', pad: 'x'.repeat(size) })

test('a batch takes the oldest events up to the count', () => {
  const { batch, rest, dropped } = takeBatch([event(1), event(2), event(3)], 2, 10000)
  assert.deepEqual(batch.map(one => one.t), [1, 2])
  assert.deepEqual(rest.map(one => one.t), [3])
  assert.equal(dropped, 0)
})

test('a batch stops before it would pass the size, and the rest waits for the next one', () => {
  const queue = Array.from({ length: 10 }, (_, t) => event(t, 900))
  const { batch, rest } = takeBatch(queue, 150, 3000)
  assert.equal(batch.length, 3)
  assert.ok(JSON.stringify(batch).length <= 3000 + batch.length + 1)
  assert.equal(rest[0].t, 3)
})

test('an event too big for any batch is dropped and counted, so it never blocks the ones after it', () => {
  const { batch, rest, dropped } = takeBatch([event(1, 5000), event(2), event(3)], 150, 3000)
  assert.deepEqual(batch.map(one => one.t), [2, 3])
  assert.deepEqual(rest, [])
  assert.equal(dropped, 1)
})

test('an empty queue makes an empty batch', () => {
  assert.deepEqual(takeBatch([], 150, 3000), { batch: [], rest: [], dropped: 0 })
})
