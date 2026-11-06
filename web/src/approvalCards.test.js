import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cardStatus, minutesLeft, orderedCards } from './approvalCards.js'

test('waiting cards come first, newest first, then decided ones, latest first', () => {
  const cards = [
    { id: 'a', status: 'done', createdAt: 1, decidedAt: 5 },
    { id: 'b', status: 'open', createdAt: 2 },
    { id: 'c', status: 'declined', createdAt: 3, decidedAt: 9 },
    { id: 'd', status: 'approving', createdAt: 4 },
  ]
  assert.deepEqual(orderedCards(cards).map(card => card.id), ['d', 'b', 'c', 'a'])
  assert.deepEqual(orderedCards(null), [])
})

test('a card says how long it has left, never below zero', () => {
  assert.equal(minutesLeft({ expiresAt: 1000 + 90 }, 1000), 2)
  assert.equal(minutesLeft({ expiresAt: 900 }, 1000), 0)
})

test('a decided card says what happened', () => {
  assert.equal(cardStatus({ kind: 'merge', status: 'done', result: 'Merged pull request 39.' }), 'Merged pull request 39.')
  assert.equal(cardStatus({ kind: 'merge', status: 'failed', result: 'It has new commits since the card was made.' }), 'Not merged: It has new commits since the card was made.')
  assert.equal(cardStatus({ kind: 'choice', status: 'done', choice: 'Ship Friday' }), 'You chose: Ship Friday')
  assert.equal(cardStatus({ kind: 'merge', status: 'expired' }), 'Ran out of time')
})
