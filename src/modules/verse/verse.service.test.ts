import assert from 'node:assert/strict'
import test from 'node:test'
import { BibleVersion, CachedVerseText, LibraryVerse } from '@prisma/client'
import { AppError } from '../../common/errors'
import {
  assertCacheAvailable,
  resolveVersionChangeOutcome,
  toDailyVerseResponse,
  type CachedVerseMatch,
} from './verse.service'

// verse.service's main entry points (getDailyVerseForGuest/getDailyVerseForUser)
// are tightly coupled to a module-level PrismaClient and to other modules'
// own Prisma clients (ensureSettings, isVerseSaved), with no existing
// Prisma-mocking test seam in this codebase (see notification.service.test.ts
// for the same tradeoff). These tests instead exercise the small pure
// decision helpers that encode the fallback-mode invariants: identity fields
// always come from a single resolved row, a failed version switch keeps the
// old version label, and an empty cache surfaces as a 503.

const now = new Date('2026-10-09T00:00:00.000Z')

const buildLibraryVerse = (params: {
  id: number
  theme?: string
  book?: string
}): LibraryVerse => ({
  id: params.id,
  book: params.book ?? 'Juan',
  chapter: 3,
  verseFrom: 16,
  verseTo: 16,
  theme: params.theme ?? 'Fe',
  referenceKey: `library-verse-${params.id}`,
  createdAt: now,
})

const buildBibleVersion = (params: {
  id: number
  apiCode?: string
  name?: string
}): BibleVersion => ({
  id: params.id,
  apiCode: params.apiCode ?? `VERSION_${params.id}`,
  name: params.name ?? `Version ${params.id}`,
  language: 'es',
  isActive: true,
  createdAt: now,
  updatedAt: now,
})

const buildCachedVerseText = (params: {
  id: number
  libraryVerseId: number
  versionId: number
  reference?: string
  text?: string
}): CachedVerseText => ({
  id: params.id,
  libraryVerseId: params.libraryVerseId,
  versionId: params.versionId,
  text: params.text ?? 'Porque de tal manera amo Dios al mundo...',
  reference: params.reference ?? 'Juan 3:16',
  apiMetadata: null,
  createdAt: now,
  updatedAt: now,
})

test('toDailyVerseResponse builds every identity field strictly from the single resolved row (guest fallback)', () => {
  const libraryVerse = buildLibraryVerse({ id: 42, theme: 'Fe' })
  const version = buildBibleVersion({ id: 7, apiCode: 'RVR1995', name: 'Reina Valera 1995' })
  const cachedText = buildCachedVerseText({
    id: 900,
    libraryVerseId: 42,
    versionId: 7,
    reference: 'Juan 3:16',
    text: 'Porque de tal manera amo Dios al mundo...',
  })

  const response = toDailyVerseResponse({ libraryVerse, cachedText, version }, false, 'cache')

  assert.deepEqual(response, {
    reference: 'Juan 3:16',
    text: 'Porque de tal manera amo Dios al mundo...',
    theme: 'Fe',
    versionCode: 'RVR1995',
    versionName: 'Reina Valera 1995',
    source: 'cache',
    libraryVerseId: 42,
    is_saved: false,
  })
})

test('toDailyVerseResponse labels the version the served text actually belongs to, even when it differs from the version that was originally requested (cross-version fallback)', () => {
  const requestedVersion = buildBibleVersion({ id: 1, apiCode: 'NTV', name: 'Nueva Traduccion Viviente' })
  const servedVersion = buildBibleVersion({ id: 2, apiCode: 'KJV', name: 'King James Version' })
  const libraryVerse = buildLibraryVerse({ id: 10, theme: 'Esperanza' })
  const cachedText = buildCachedVerseText({
    id: 500,
    libraryVerseId: 10,
    versionId: 2,
    reference: 'Psalm 23:1',
    text: 'The Lord is my shepherd',
  })

  const response = toDailyVerseResponse(
    { libraryVerse, cachedText, version: servedVersion },
    true,
    'cache'
  )

  assert.equal(response.versionCode, servedVersion.apiCode)
  assert.equal(response.versionName, servedVersion.name)
  assert.notEqual(response.versionCode, requestedVersion.apiCode)
  assert.equal(response.libraryVerseId, 10)
  assert.equal(response.is_saved, true)
})

test('resolveVersionChangeOutcome keeps the old version label and skips the history update when the new-version fetch fails', () => {
  const oldVersion = buildBibleVersion({ id: 1, apiCode: 'RV1960', name: 'Reina Valera 1960' })
  const libraryVerse = buildLibraryVerse({ id: 5, theme: 'Paz' })
  const oldCachedText = buildCachedVerseText({
    id: 10,
    libraryVerseId: 5,
    versionId: 1,
    reference: 'Filipenses 4:7',
    text: 'La paz de Dios, que sobrepasa todo entendimiento...',
  })

  const oldMatch: CachedVerseMatch = { libraryVerse, cachedText: oldCachedText, version: oldVersion }

  const outcome = resolveVersionChangeOutcome({ oldMatch, newResult: null })

  assert.equal(outcome.source, 'cache')
  assert.equal(outcome.updateHistoryVersionId, false)
  assert.equal(outcome.match.version.apiCode, 'RV1960')
  assert.equal(outcome.match.cachedText.id, 10)
})

test('resolveVersionChangeOutcome serves the new version and requests a history update when the new-version lookup succeeds', () => {
  const newVersion = buildBibleVersion({ id: 2, apiCode: 'NTV', name: 'Nueva Traduccion Viviente' })
  const libraryVerse = buildLibraryVerse({ id: 5, theme: 'Paz' })
  const newCachedText = buildCachedVerseText({
    id: 11,
    libraryVerseId: 5,
    versionId: 2,
    reference: 'Filipenses 4:7',
    text: 'The peace of God, which surpasses all understanding...',
  })

  const outcome = resolveVersionChangeOutcome({
    newResult: { match: { libraryVerse, cachedText: newCachedText, version: newVersion }, source: 'api' },
  })

  assert.equal(outcome.source, 'api')
  assert.equal(outcome.updateHistoryVersionId, true)
  assert.equal(outcome.match.version.apiCode, 'NTV')
  assert.equal(outcome.match.cachedText.id, 11)
})

test('resolveVersionChangeOutcome throws when neither an old nor a new match is available', () => {
  assert.throws(() => resolveVersionChangeOutcome({ newResult: null }))
})

test('assertCacheAvailable throws BIBLE_API_UNAVAILABLE (503) when the cache is completely empty', () => {
  assert.throws(
    () => assertCacheAvailable(null),
    (error: unknown) => {
      assert.ok(error instanceof AppError)
      assert.equal((error as AppError).code, 'BIBLE_API_UNAVAILABLE')
      assert.equal((error as AppError).statusCode, 503)
      return true
    }
  )
})

test('assertCacheAvailable returns the match unchanged when one was found', () => {
  const match: CachedVerseMatch = {
    libraryVerse: buildLibraryVerse({ id: 1 }),
    cachedText: buildCachedVerseText({ id: 1, libraryVerseId: 1, versionId: 1 }),
    version: buildBibleVersion({ id: 1 }),
  }

  assert.equal(assertCacheAvailable(match), match)
})
