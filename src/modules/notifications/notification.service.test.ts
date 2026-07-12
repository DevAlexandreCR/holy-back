import assert from 'node:assert/strict'
import test from 'node:test'
import {
  hasDailyFeaturedDevotional,
  hasEverHadAppSession,
  isDailyReminderAlreadySentToday,
  isDailyReminderDaySuppressedByCompletion,
  isDailyReminderHourDue,
  isDailyReminderPreferenceEnabled,
  isDailyReminderSuppressedByStreakRisk,
  isDailyReminderSuppressedByWinbackPause,
  isStreakMilestonePreferenceEnabled,
  isWinbackLocalWindowOpen,
  isWinbackPaused,
  isWinbackPreferenceEnabled,
  isWinbackSpacingSatisfied,
  isWinbackStepMonotonic,
  resolveWinbackStep,
  shouldSendStreakMilestonePush,
} from './notification.service'

const WINBACK_STEP_DAYS = [3, 7, 14] as const

// These predicates are the exact eligibility/suppression checks used inline by
// sendDailyReminderNotifications(). The sender itself is tightly coupled to
// Prisma (sequential queries with early-exit continues, mirroring the
// untested sendStreakRiskNotifications sibling), and this module has no
// existing Prisma-mocking test seam, so the checks are exercised here as the
// smallest extractable pure logic instead.

test('daily reminder happy path: matching local hour, enabled, no suppressions, daily featured resolved', () => {
  const localHour = 7
  const reminderHour = 7

  assert.equal(isDailyReminderHourDue({ localHour, reminderHour }), true)
  assert.equal(
    isDailyReminderPreferenceEnabled({
      dailyReminderNotificationsEnabled: true,
    }),
    true
  )
  assert.equal(isDailyReminderAlreadySentToday(0), false)
  assert.equal(
    isDailyReminderDaySuppressedByCompletion({
      lastCompletedDate: '2026-07-10',
      localToday: '2026-07-11',
    }),
    false
  )
  assert.equal(isDailyReminderSuppressedByStreakRisk(0), false)
  assert.equal(isDailyReminderSuppressedByWinbackPause(null), false)
  assert.equal(hasDailyFeaturedDevotional({ devotional: { id: 'dev-1' } }), true)
})

test('isDailyReminderHourDue only matches the user local hour equal to the configured reminder hour', () => {
  assert.equal(isDailyReminderHourDue({ localHour: 7, reminderHour: 7 }), true)
  assert.equal(isDailyReminderHourDue({ localHour: 8, reminderHour: 7 }), false)
  assert.equal(isDailyReminderHourDue({ localHour: 0, reminderHour: 7 }), false)
})

test('dedupe: no second send within the same user-local day', () => {
  assert.equal(isDailyReminderAlreadySentToday(0), false)
  assert.equal(isDailyReminderAlreadySentToday(1), true)
  assert.equal(isDailyReminderAlreadySentToday(3), true)
})

test('suppression: day already completed suppresses the reminder', () => {
  assert.equal(
    isDailyReminderDaySuppressedByCompletion({
      lastCompletedDate: '2026-07-11',
      localToday: '2026-07-11',
    }),
    true
  )
  assert.equal(
    isDailyReminderDaySuppressedByCompletion({
      lastCompletedDate: '2026-07-10',
      localToday: '2026-07-11',
    }),
    false
  )
  assert.equal(
    isDailyReminderDaySuppressedByCompletion({
      lastCompletedDate: null,
      localToday: '2026-07-11',
    }),
    false
  )
  assert.equal(
    isDailyReminderDaySuppressedByCompletion({
      lastCompletedDate: undefined,
      localToday: '2026-07-11',
    }),
    false
  )
})

test('suppression: STREAK_AT_RISK already sent today suppresses the reminder', () => {
  assert.equal(isDailyReminderSuppressedByStreakRisk(0), false)
  assert.equal(isDailyReminderSuppressedByStreakRisk(1), true)
})

test('suppression: win-back paused suppresses the reminder', () => {
  assert.equal(isDailyReminderSuppressedByWinbackPause(null), false)
  assert.equal(isDailyReminderSuppressedByWinbackPause(undefined), false)
  assert.equal(isDailyReminderSuppressedByWinbackPause(new Date('2026-07-01T00:00:00Z')), true)
})

test('suppression: preference disabled or missing suppresses the reminder', () => {
  assert.equal(
    isDailyReminderPreferenceEnabled({ dailyReminderNotificationsEnabled: true }),
    true
  )
  assert.equal(
    isDailyReminderPreferenceEnabled({ dailyReminderNotificationsEnabled: false }),
    false
  )
  assert.equal(isDailyReminderPreferenceEnabled(null), false)
  assert.equal(isDailyReminderPreferenceEnabled(undefined), false)
})

test('null daily featured devotional case: nothing resolved means the user is skipped, nothing sent', () => {
  assert.equal(hasDailyFeaturedDevotional(null), false)
  assert.equal(hasDailyFeaturedDevotional(undefined), false)
  assert.equal(hasDailyFeaturedDevotional({ devotional: { id: 'dev-1' } }), true)
})

// shouldSendStreakMilestonePush is the exact gating decision consumed by
// sendStreakMilestoneNotification (post-commit push fired from
// devotional.service.ts's markReadComplete, driven by
// applyReadCompleteEngagement's milestoneReached signal in
// devotionalEngagement.service.ts). The sender itself is Prisma-coupled with
// no mocking seam here (same reasoning as the daily-reminder predicates
// above), so only this pure decision is unit-tested: the first-reach-vs-
// re-reach branch inside applyMilestoneReached (devotionalEngagement.service.ts)
// and the actual DB/FCM integration remain uncovered by unit tests.

test('milestone push fires once on first reach with preference enabled', () => {
  assert.equal(
    shouldSendStreakMilestonePush({
      isFirstReach: true,
      settings: { streakMilestoneNotificationsEnabled: true },
    }),
    true
  )
})

test('milestone push is suppressed on re-reach after a streak reset, even with preference enabled', () => {
  assert.equal(
    shouldSendStreakMilestonePush({
      isFirstReach: false,
      settings: { streakMilestoneNotificationsEnabled: true },
    }),
    false
  )
})

test('milestone push is suppressed when the preference is disabled, even on first reach', () => {
  assert.equal(
    shouldSendStreakMilestonePush({
      isFirstReach: true,
      settings: { streakMilestoneNotificationsEnabled: false },
    }),
    false
  )
})

test('milestone push is suppressed when settings are missing', () => {
  assert.equal(
    shouldSendStreakMilestonePush({ isFirstReach: true, settings: null }),
    false
  )
  assert.equal(
    shouldSendStreakMilestonePush({ isFirstReach: true, settings: undefined }),
    false
  )
})

test('isStreakMilestonePreferenceEnabled reads the streakMilestoneNotificationsEnabled toggle', () => {
  assert.equal(
    isStreakMilestonePreferenceEnabled({
      streakMilestoneNotificationsEnabled: true,
    }),
    true
  )
  assert.equal(
    isStreakMilestonePreferenceEnabled({
      streakMilestoneNotificationsEnabled: false,
    }),
    false
  )
  assert.equal(isStreakMilestonePreferenceEnabled(null), false)
  assert.equal(isStreakMilestonePreferenceEnabled(undefined), false)
})

// Win-back ladder predicates (task 5.3) are the exact eligibility/step logic
// used inline by sendWinbackNotifications() (task 5.1). Same reasoning as the
// daily-reminder predicates above: sendWinbackNotifications is Prisma-coupled
// with no mocking seam in this module, so only the extracted pure decisions
// are unit-tested here. The reset hook itself (recordAppSessionStarted in
// analytics.service.ts clearing UserWinbackState) is a single Prisma
// updateMany with no extractable pure logic; it is covered by the manual /
// integration verification pass (task 9.1), not by a unit test.

test('resolveWinbackStep: ladder progression by days since last session', () => {
  assert.equal(
    resolveWinbackStep({ daysSinceLastSession: 0, stepDays: WINBACK_STEP_DAYS }),
    null
  )
  assert.equal(
    resolveWinbackStep({ daysSinceLastSession: 2, stepDays: WINBACK_STEP_DAYS }),
    null
  )
  assert.equal(
    resolveWinbackStep({ daysSinceLastSession: 3, stepDays: WINBACK_STEP_DAYS }),
    3
  )
  assert.equal(
    resolveWinbackStep({ daysSinceLastSession: 6, stepDays: WINBACK_STEP_DAYS }),
    3
  )
  assert.equal(
    resolveWinbackStep({ daysSinceLastSession: 7, stepDays: WINBACK_STEP_DAYS }),
    7
  )
  assert.equal(
    resolveWinbackStep({ daysSinceLastSession: 13, stepDays: WINBACK_STEP_DAYS }),
    7
  )
  assert.equal(
    resolveWinbackStep({ daysSinceLastSession: 14, stepDays: WINBACK_STEP_DAYS }),
    14
  )
  assert.equal(
    resolveWinbackStep({ daysSinceLastSession: 30, stepDays: WINBACK_STEP_DAYS }),
    14
  )
})

test('isWinbackStepMonotonic blocks re-sending a step already sent this lapse', () => {
  assert.equal(isWinbackStepMonotonic({ lastStepSent: 0, step: 3 }), true)
  assert.equal(isWinbackStepMonotonic({ lastStepSent: 3, step: 3 }), false)
  assert.equal(isWinbackStepMonotonic({ lastStepSent: 3, step: 7 }), true)
  assert.equal(isWinbackStepMonotonic({ lastStepSent: 7, step: 3 }), false)
  assert.equal(isWinbackStepMonotonic({ lastStepSent: 14, step: 14 }), false)
})

test('isWinbackSpacingSatisfied enforces 48h between win-back sends', () => {
  const now = new Date('2026-07-11T15:00:00Z')

  assert.equal(
    isWinbackSpacingSatisfied({ lastSentAt: null, now, minHoursBetweenSends: 48 }),
    true
  )
  assert.equal(
    isWinbackSpacingSatisfied({
      lastSentAt: new Date('2026-07-10T00:00:00Z'),
      now,
      minHoursBetweenSends: 48,
    }),
    false
  )
  assert.equal(
    isWinbackSpacingSatisfied({
      lastSentAt: new Date('2026-07-09T14:00:00Z'),
      now,
      minHoursBetweenSends: 48,
    }),
    true
  )
})

test('isWinbackLocalWindowOpen: only local 12:00-20:00 is eligible', () => {
  assert.equal(
    isWinbackLocalWindowOpen({ localHour: 11, windowStartLocalHour: 12, windowEndLocalHour: 20 }),
    false
  )
  assert.equal(
    isWinbackLocalWindowOpen({ localHour: 12, windowStartLocalHour: 12, windowEndLocalHour: 20 }),
    true
  )
  assert.equal(
    isWinbackLocalWindowOpen({ localHour: 15, windowStartLocalHour: 12, windowEndLocalHour: 20 }),
    true
  )
  assert.equal(
    isWinbackLocalWindowOpen({ localHour: 19, windowStartLocalHour: 12, windowEndLocalHour: 20 }),
    true
  )
  assert.equal(
    isWinbackLocalWindowOpen({ localHour: 20, windowStartLocalHour: 12, windowEndLocalHour: 20 }),
    false
  )
  assert.equal(
    isWinbackLocalWindowOpen({ localHour: 22, windowStartLocalHour: 12, windowEndLocalHour: 20 }),
    false
  )
})

test('isWinbackPaused: pause latch suppresses further sends once set', () => {
  assert.equal(isWinbackPaused(null), false)
  assert.equal(isWinbackPaused(undefined), false)
  assert.equal(isWinbackPaused(new Date('2026-07-01T00:00:00Z')), true)
})

test('hasEverHadAppSession excludes never-activated registrations', () => {
  assert.equal(hasEverHadAppSession(null), false)
  assert.equal(hasEverHadAppSession(undefined), false)
  assert.equal(hasEverHadAppSession(new Date('2026-07-01T00:00:00Z')), true)
})

test('isWinbackPreferenceEnabled reads the winbackNotificationsEnabled toggle', () => {
  assert.equal(
    isWinbackPreferenceEnabled({ winbackNotificationsEnabled: true }),
    true
  )
  assert.equal(
    isWinbackPreferenceEnabled({ winbackNotificationsEnabled: false }),
    false
  )
  assert.equal(isWinbackPreferenceEnabled(null), false)
  assert.equal(isWinbackPreferenceEnabled(undefined), false)
})

test('null daily featured devotional skips the win-back user without advancing the ladder', () => {
  assert.equal(hasDailyFeaturedDevotional(null), false)
  assert.equal(hasDailyFeaturedDevotional(undefined), false)
  assert.equal(hasDailyFeaturedDevotional({ devotional: { id: 'dev-1' } }), true)
})

test('reset semantics: a cleared state (lastStepSent 0, pausedAt null) makes step 3 eligible again', () => {
  // Simulates the state produced by the recordAppSessionStarted reset hook
  // after a user who had progressed to step 7 and/or been paused returns.
  const resetState = { lastStepSent: 0, pausedAt: null as Date | null }

  assert.equal(isWinbackPaused(resetState.pausedAt), false)
  assert.equal(
    isWinbackStepMonotonic({ lastStepSent: resetState.lastStepSent, step: 3 }),
    true
  )
  assert.equal(
    resolveWinbackStep({ daysSinceLastSession: 3, stepDays: WINBACK_STEP_DAYS }),
    3
  )
})
