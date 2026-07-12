import assert from 'node:assert/strict'
import test from 'node:test'
import { isStreakCompletedForLocalDay } from './devotionalEngagement.service'

test('isStreakCompletedForLocalDay: completed when last completed date matches local today', () => {
  assert.equal(
    isStreakCompletedForLocalDay({
      lastCompletedDate: '2026-07-11',
      localToday: '2026-07-11',
    }),
    true
  )
})

test('isStreakCompletedForLocalDay: not completed when last completed date is a previous day', () => {
  assert.equal(
    isStreakCompletedForLocalDay({
      lastCompletedDate: '2026-07-10',
      localToday: '2026-07-11',
    }),
    false
  )
})

test('isStreakCompletedForLocalDay: not completed when there is no streak row yet', () => {
  assert.equal(
    isStreakCompletedForLocalDay({
      lastCompletedDate: null,
      localToday: '2026-07-11',
    }),
    false
  )
  assert.equal(
    isStreakCompletedForLocalDay({
      lastCompletedDate: undefined,
      localToday: '2026-07-11',
    }),
    false
  )
})
