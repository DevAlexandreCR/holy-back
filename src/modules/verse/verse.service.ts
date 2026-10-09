import { PrismaClient, LibraryVerse, CachedVerseText, BibleVersion } from '@prisma/client'
import { BibleApiClient } from '../bible/bibleApiClient'
import { formatReference } from './libraryLoader.service'
import { convertBookToApiCode, getBookDisplayName } from '../bible/bookApiMapping'
import { config } from '../../config/env'
import { isVerseSaved } from './savedVerse.service'
import { ensureSettings } from '../user/userSettings.service'
import { AppError } from '../../common/errors'

const prisma = new PrismaClient()
const bibleApiClient = new BibleApiClient(config.external.bibleApiBaseUrl)

// Threshold for switching to 50/50 strategy
const CACHE_THRESHOLD = 2000
const DEFAULT_GUEST_VERSION_CODE = 'RVR1995'
const DEFAULT_GUEST_VERSION_NAME = 'Reina Valera 1995'

export interface DailyVerseResponse {
  reference: string
  text: string
  theme: string
  versionCode: string
  versionName: string
  source: 'cache' | 'api'
  libraryVerseId: number
  is_saved: boolean
}

export interface CachedVerseMatch {
  libraryVerse: LibraryVerse
  cachedText: CachedVerseText
  version: BibleVersion
}

interface UserVerseHistoryWithRelations {
  id: number
  userId: string
  libraryVerseId: number
  versionId: number
  date: string
  shownAt: Date
  liked: boolean
  likedAt: Date | null
  shared: boolean
  sharedAt: Date | null
  libraryVerse: LibraryVerse
  version: BibleVersion
}

/**
 * Get count of cached verses in database
 */
async function getCachedVerseCount(): Promise<number> {
  return await prisma.cachedVerseText.count()
}

/**
 * Determine if we should try cache first (50/50 when above threshold)
 */
function shouldTryCache(cachedCount: number): boolean {
  if (cachedCount < CACHE_THRESHOLD) {
    return false // Always use API when below threshold
  }
  return Math.random() < 0.5 // 50/50 when above threshold
}

/**
 * Resolve the user's preferred Bible version
 */
async function resolveUserVersion(userId: string): Promise<BibleVersion> {
  const settings = await ensureSettings(userId)
  if (settings.preferredVersionId) {
    const preferredVersion = await prisma.bibleVersion.findUnique({
      where: { id: settings.preferredVersionId },
    })
    if (preferredVersion) {
      return preferredVersion
    }
  }

  const fallback = await prisma.bibleVersion.findFirst({
    where: { isActive: true },
    orderBy: { id: 'asc' },
  })

  if (!fallback) {
    throw new Error('No active Bible versions available')
  }

  await prisma.userSettings.update({
    where: { userId },
    data: { preferredVersionId: fallback.id },
  })

  return fallback
}

async function resolveGuestVersion(): Promise<BibleVersion> {
  const byCode = await prisma.bibleVersion.findFirst({
    where: {
      apiCode: DEFAULT_GUEST_VERSION_CODE,
      isActive: true,
    },
  })

  if (byCode) {
    return byCode
  }

  const byName = await prisma.bibleVersion.findFirst({
    where: {
      name: { contains: DEFAULT_GUEST_VERSION_NAME },
      isActive: true,
    },
  })

  if (byName) {
    return byName
  }

  const fallback = await prisma.bibleVersion.findFirst({
    where: { isActive: true },
    orderBy: { id: 'asc' },
  })

  if (!fallback) {
    throw new Error('No active Bible versions available')
  }

  return fallback
}

/**
 * Get user's top preferred themes based on likes and shares
 */
async function getUserPreferredThemes(userId: string, limit: number = 5): Promise<string[]> {
  const preferences = await prisma.userThemePreference.findMany({
    where: { userId },
    orderBy: { score: 'desc' },
    take: limit,
    select: { theme: true },
  })

  return preferences.map(p => p.theme)
}

/**
 * Find a random unseen verse for the user from the library
 * Considers user preferences when available
 */
async function findUnseenLibraryVerse(
  userId: string,
  preferredThemes?: string[]
): Promise<LibraryVerse | null> {
  // Get all library verses the user has NOT seen
  const seenVerseIds = await prisma.userVerseHistory.findMany({
    where: { userId },
    select: { libraryVerseId: true },
  })

  const seenIds = seenVerseIds.map(h => h.libraryVerseId)

  // Base where clause for unseen verses
  const baseWhere: any = seenIds.length > 0 ? {
    id: { notIn: seenIds }
  } : {}

  // If user has preferences, try to find verse with preferred theme (70% of the time)
  if (preferredThemes && preferredThemes.length > 0 && Math.random() < 0.7) {
    const preferredCount = await prisma.libraryVerse.count({
      where: {
        ...baseWhere,
        theme: { in: preferredThemes },
      },
    })

    if (preferredCount > 0) {
      const randomOffset = Math.floor(Math.random() * preferredCount)
      const verse = await prisma.libraryVerse.findMany({
        where: {
          ...baseWhere,
          theme: { in: preferredThemes },
        },
        skip: randomOffset,
        take: 1,
      })

      if (verse[0]) {
        console.log(`🎯 Selected verse with preferred theme: ${verse[0].theme}`)
        return verse[0]
      }
    }
  }

  // Otherwise, pick from all unseen verses (30% of the time or when no preferences)
  const totalCount = await prisma.libraryVerse.count({
    where: baseWhere,
  })

  if (totalCount === 0) {
    return null // User has seen all verses
  }

  const randomOffset = Math.floor(Math.random() * totalCount)
  const verse = await prisma.libraryVerse.findMany({
    where: baseWhere,
    skip: randomOffset,
    take: 1,
  })

  console.log(`🎲 Selected random verse with theme: ${verse[0]?.theme}`)
  return verse[0] || null
}

/**
 * Find cached verse text for a library verse in a specific version
 */
async function findCachedVerseText(
  libraryVerseId: number,
  versionId: number
): Promise<CachedVerseText | null> {
  return await prisma.cachedVerseText.findUnique({
    where: {
      libraryVerseId_versionId: {
        libraryVerseId,
        versionId,
      },
    },
  })
}

/**
 * Try to find a cached verse for the user in their version
 * Only used when above threshold and 50% chance
 * Considers user's preferred themes
 */
async function tryFindCachedVerse(
  userId: string,
  versionId: number,
  preferredThemes?: string[]
): Promise<{ libraryVerse: LibraryVerse; cachedText: CachedVerseText } | null> {
  // Get all library verses the user has NOT seen
  const seenVerseIds = await prisma.userVerseHistory.findMany({
    where: { userId },
    select: { libraryVerseId: true },
  })

  const seenIds = seenVerseIds.map(h => h.libraryVerseId)

  // Base where clause
  const baseWhere: any = {
    versionId,
  }

  if (seenIds.length > 0) {
    baseWhere.libraryVerseId = { notIn: seenIds }
  }

  const pickRandom = async (
    where: any
  ): Promise<(CachedVerseText & { libraryVerse: LibraryVerse }) | null> => {
    const count = await prisma.cachedVerseText.count({ where })
    if (count === 0) {
      return null
    }

    const offset = Math.floor(Math.random() * count)
    const rows = await prisma.cachedVerseText.findMany({
      where,
      skip: offset,
      take: 1,
      orderBy: { id: 'asc' },
      include: { libraryVerse: true },
    })

    return rows[0] ?? null
  }

  // Try preferred themes first (70% of the time)
  if (preferredThemes && preferredThemes.length > 0 && Math.random() < 0.7) {
    const selected = await pickRandom({
      ...baseWhere,
      libraryVerse: {
        theme: { in: preferredThemes },
      },
    })

    if (selected) {
      console.log(`🎯 Found cached verse with preferred theme: ${selected.libraryVerse.theme}`)
      return {
        libraryVerse: selected.libraryVerse,
        cachedText: selected,
      }
    }
  }

  // Otherwise find any cached verse
  const selected = await pickRandom(baseWhere)

  if (!selected) {
    return null
  }

  return {
    libraryVerse: selected.libraryVerse,
    cachedText: selected,
  }
}

/**
 * Find any cached verse for a version, used when the external Bible API is
 * unavailable. Retries without the version filter if nothing is cached in
 * the requested version, so degraded mode still serves a verse when
 * possible. Returns null only when the cache has nothing at all.
 */
async function findAnyCachedVerse(params: {
  versionId: number
  excludeLibraryVerseIds?: number[]
  seed?: number
}): Promise<CachedVerseMatch | null> {
  const { versionId, excludeLibraryVerseIds, seed } = params

  const pick = async (where: any): Promise<CachedVerseMatch | null> => {
    const count = await prisma.cachedVerseText.count({ where })
    if (count === 0) {
      return null
    }

    const offset = seed !== undefined ? seed % count : Math.floor(Math.random() * count)

    const rows = await prisma.cachedVerseText.findMany({
      where,
      skip: offset,
      take: 1,
      orderBy: { id: 'asc' },
      include: { libraryVerse: true, version: true },
    })

    const row = rows[0]
    if (!row) {
      return null
    }

    return {
      libraryVerse: row.libraryVerse,
      cachedText: row,
      version: row.version,
    }
  }

  const excludeFilter =
    excludeLibraryVerseIds && excludeLibraryVerseIds.length > 0
      ? { libraryVerseId: { notIn: excludeLibraryVerseIds } }
      : {}

  const matchForVersion = await pick({ versionId, ...excludeFilter })
  if (matchForVersion) {
    return matchForVersion
  }

  return await pick(excludeFilter)
}

/**
 * Build the public verse response strictly from one resolved verse/cache
 * row, so identity fields are never mixed with a different pre-selected
 * verse or version.
 */
export function toDailyVerseResponse(
  match: CachedVerseMatch,
  isSaved: boolean,
  source: 'cache' | 'api'
): DailyVerseResponse {
  return {
    reference: match.cachedText.reference,
    text: match.cachedText.text,
    theme: match.libraryVerse.theme,
    versionCode: match.version.apiCode,
    versionName: match.version.name,
    source,
    libraryVerseId: match.libraryVerse.id,
    is_saved: isSaved,
  }
}

/**
 * Throws BIBLE_API_UNAVAILABLE (503) when nothing could be found in cache at
 * all, so callers degrade gracefully instead of surfacing a generic 500 (or
 * being mistaken for an auth failure).
 */
export function assertCacheAvailable(match: CachedVerseMatch | null): CachedVerseMatch {
  if (!match) {
    throw new AppError('Bible content temporarily unavailable', 'BIBLE_API_UNAVAILABLE', 503)
  }

  return match
}

type VersionChangeNewResult = { match: CachedVerseMatch; source: 'cache' | 'api' }

/**
 * Decides which version to serve when the user switched their preferred
 * Bible version. When the fetch/cache lookup for the new version failed
 * (newResult is null), keeps serving the old version and signals that user
 * history should NOT be updated, so the version switch is retried on the
 * user's next request.
 */
export function resolveVersionChangeOutcome(params: {
  oldMatch?: CachedVerseMatch
  newResult: VersionChangeNewResult | null
}): { match: CachedVerseMatch; source: 'cache' | 'api'; updateHistoryVersionId: boolean } {
  if (params.newResult) {
    return {
      match: params.newResult.match,
      source: params.newResult.source,
      updateHistoryVersionId: true,
    }
  }

  if (!params.oldMatch) {
    throw new Error('resolveVersionChangeOutcome requires oldMatch when newResult is null')
  }

  return {
    match: params.oldMatch,
    source: 'cache',
    updateHistoryVersionId: false,
  }
}

/**
 * Fetch verse text from Bible API
 */
async function fetchVerseFromApi(
  libraryVerse: LibraryVerse,
  version: BibleVersion
): Promise<{ text: string; reference: string }> {
  // Convert database book name to API book code
  const apiBookCode = convertBookToApiCode(libraryVerse.book)

  // Call the API with the verse range
  const apiResponse = await bibleApiClient.getVerses({
    versionCode: version.apiCode,
    book: apiBookCode,
    chapter: libraryVerse.chapter,
    fromVerse: libraryVerse.verseFrom,
    toVerse: libraryVerse.verseTo === libraryVerse.verseFrom ? undefined : libraryVerse.verseTo,
  })

  if (!apiResponse || apiResponse.length === 0) {
    throw new Error(
      `No verses returned from API for ${apiBookCode} ${libraryVerse.chapter}:${libraryVerse.verseFrom}`
    )
  }

  // Concatenate verse texts (the API uses 'verse' property for text)
  const text = apiResponse.map(v => v.verse?.trim() || '').filter(Boolean).join(' ')

  // Get display name for the book in the appropriate language
  const language = version.language === 'en' ? 'en' : 'es'
  const bookDisplayName = getBookDisplayName(libraryVerse.book, language)

  // Format reference
  const reference = formatReference(
    bookDisplayName,
    libraryVerse.chapter,
    libraryVerse.verseFrom,
    libraryVerse.verseTo
  )

  return { text, reference }
}

/**
 * Store fetched verse in cache
 */
async function cacheVerseText(
  libraryVerseId: number,
  versionId: number,
  text: string,
  reference: string,
  apiMetadata?: any
): Promise<CachedVerseText> {
  return await prisma.cachedVerseText.upsert({
    where: {
      libraryVerseId_versionId: {
        libraryVerseId,
        versionId,
      },
    },
    create: {
      libraryVerseId,
      versionId,
      text,
      reference,
      apiMetadata,
    },
    update: {
      text,
      reference,
      apiMetadata,
    },
  })
}

/**
 * Mark verse as seen by user (for today)
 */
async function markVerseAsSeen(
  userId: string,
  libraryVerseId: number,
  versionId: number,
  date: string
): Promise<void> {
  // First check if exists by libraryVerseId
  const existing = await prisma.userVerseHistory.findUnique({
    where: {
      userId_libraryVerseId: {
        userId,
        libraryVerseId,
      },
    },
  })

  if (existing) {
    // Update existing record with today's date
    await prisma.userVerseHistory.update({
      where: { id: existing.id },
      data: {
        date,
        shownAt: new Date(),
        versionId,
      },
    })
  } else {
    // Create new record
    await prisma.userVerseHistory.create({
      data: {
        userId,
        libraryVerseId,
        versionId,
        date,
      },
    })
  }
}

function hashString(value: string): number {
  let hash = 0
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash << 5) - hash + value.charCodeAt(i)
    hash |= 0
  }
  return Math.abs(hash)
}

async function getDeterministicLibraryVerseForDate(date: string): Promise<LibraryVerse> {
  const totalCount = await prisma.libraryVerse.count()
  if (totalCount === 0) {
    throw new Error('No library verses available')
  }

  const offset = hashString(date) % totalCount
  const verses = await prisma.libraryVerse.findMany({
    orderBy: { id: 'asc' },
    skip: offset,
    take: 1,
  })

  const verse = verses[0]
  if (!verse) {
    throw new Error('No library verse found for the selected date')
  }

  return verse
}

/**
 * Get today's date in YYYY-MM-DD format
 * @param timezone - User's timezone (e.g., 'America/Bogota', 'America/New_York')
 * If no timezone provided, uses UTC
 */
function getTodayDate(timezone?: string | null): string {
  const now = new Date()

  if (!timezone) {
    // Fallback to UTC if no timezone
    return now.toISOString().split('T')[0] // YYYY-MM-DD
  }

  try {
    // Use Intl.DateTimeFormat to get date in user's timezone
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    })

    const parts = formatter.formatToParts(now)
    const year = parts.find(p => p.type === 'year')?.value
    const month = parts.find(p => p.type === 'month')?.value
    const day = parts.find(p => p.type === 'day')?.value

    return `${year}-${month}-${day}` // YYYY-MM-DD
  } catch (error) {
    console.error(`⚠️  Invalid timezone '${timezone}', falling back to UTC:`, error)
    return now.toISOString().split('T')[0]
  }
}

/**
 * Check if user already received their verse today
 * Uses user's timezone to determine "today"
 */
async function getTodaysVerseIfExists(
  userId: string,
  timezone?: string | null
): Promise<UserVerseHistoryWithRelations | null> {
  const today = getTodayDate(timezone)

  const history = await prisma.userVerseHistory.findUnique({
    where: {
      userId_date: { userId, date: today },
    },
    include: {
      libraryVerse: true,
      version: true,
    },
  })

  return history
}

/**
 * Main function: Get daily verse for guest
 */
export async function getDailyVerseForGuest(): Promise<DailyVerseResponse> {
  const today = getTodayDate()
  const version = await resolveGuestVersion()
  const libraryVerse = await getDeterministicLibraryVerseForDate(today)

  try {
    let cachedText = await findCachedVerseText(libraryVerse.id, version.id)
    let source: 'cache' | 'api' = 'cache'

    if (!cachedText) {
      const apiResult = await fetchVerseFromApi(libraryVerse, version)
      cachedText = await cacheVerseText(
        libraryVerse.id,
        version.id,
        apiResult.text,
        apiResult.reference
      )
      source = 'api'
    }

    return {
      reference: cachedText.reference,
      text: cachedText.text,
      theme: libraryVerse.theme,
      versionCode: version.apiCode,
      versionName: version.name,
      source,
      libraryVerseId: libraryVerse.id,
      is_saved: false,
    }
  } catch (error) {
    console.warn('[Verse] Bible API unavailable, serving cached verse', {
      scope: 'guest',
      versionId: version.id,
      error: error instanceof Error ? error.message : error,
    })

    const fallback = assertCacheAvailable(
      await findAnyCachedVerse({ versionId: version.id, seed: hashString(today) })
    )

    return toDailyVerseResponse(fallback, false, 'cache')
  }
}

/**
 * Main function: Get daily verse for user
 */
export async function getDailyVerseForUser(userId: string): Promise<DailyVerseResponse> {
  // 0. Get user's timezone from settings
  const userSettings = await prisma.userSettings.findUnique({
    where: { userId },
    select: { timezone: true },
  })

  const timezone = userSettings?.timezone
  const today = getTodayDate(timezone)

  // Log timezone info for debugging
  if (timezone) {
    console.log(`🌍 Using timezone '${timezone}' for user ${userId}, today is ${today}`)
  } else {
    console.log(`⚠️  No timezone set for user ${userId}, using UTC. Today is ${today}`)
  }

  // 1. Resolve user's preferred version first
  const version = await resolveUserVersion(userId)

  // 2. Check if user already got their verse today (in their timezone)
  const existingVerse = await getTodaysVerseIfExists(userId, timezone)

  if (existingVerse) {
    // Check if the existing verse is in the user's current preferred version
    if (existingVerse.versionId === version.id) {
      // Same version - return cached verse
      const cachedText = await findCachedVerseText(
        existingVerse.libraryVerseId,
        existingVerse.versionId
      )

      if (cachedText) {
        console.log(`♻️  Returning today's verse for user ${userId}: ${cachedText.reference}`)

        const isSaved = await isVerseSaved(userId, existingVerse.libraryVerseId)

        return toDailyVerseResponse(
          {
            libraryVerse: existingVerse.libraryVerse,
            cachedText,
            version: existingVerse.version,
          },
          isSaved,
          'cache'
        )
      }

      console.warn('[Verse] Bible API unavailable, serving cached verse', {
        scope: 'user-existing-cache-missing',
        userId,
        libraryVerseId: existingVerse.libraryVerseId,
        versionId: existingVerse.versionId,
      })

      const fallback = assertCacheAvailable(
        await findAnyCachedVerse({ versionId: version.id })
      )
      const isSaved = await isVerseSaved(userId, fallback.libraryVerse.id)

      return toDailyVerseResponse(fallback, isSaved, 'cache')
    }

    // User changed their Bible version - get the same verse in the new version
    console.log(`🔄 User changed version from ${existingVerse.version.apiCode} to ${version.apiCode}, fetching same verse in new version...`)

    const libraryVerse = existingVerse.libraryVerse

    // Check if this verse already exists in the new version
    const existingCacheForNewVersion = await findCachedVerseText(libraryVerse.id, version.id)

    let newResult: VersionChangeNewResult | null = null

    if (existingCacheForNewVersion) {
      newResult = {
        match: { libraryVerse, cachedText: existingCacheForNewVersion, version },
        source: 'cache',
      }
    } else {
      try {
        console.log(`📡 Fetching ${libraryVerse.book} ${libraryVerse.chapter}:${libraryVerse.verseFrom} in ${version.apiCode}...`)
        const apiResult = await fetchVerseFromApi(libraryVerse, version)
        const cachedText = await cacheVerseText(
          libraryVerse.id,
          version.id,
          apiResult.text,
          apiResult.reference
        )
        newResult = { match: { libraryVerse, cachedText, version }, source: 'api' }
      } catch (error) {
        console.warn('[Verse] Bible API unavailable, serving cached verse', {
          scope: 'user-version-change',
          userId,
          libraryVerseId: libraryVerse.id,
          targetVersionId: version.id,
          error: error instanceof Error ? error.message : error,
        })
        newResult = null
      }
    }

    let outcome: ReturnType<typeof resolveVersionChangeOutcome>

    if (newResult) {
      outcome = resolveVersionChangeOutcome({ newResult })
    } else {
      // Serve the verse in its OLD version and leave history untouched so the
      // version switch is retried on the user's next request.
      const oldCachedText = await findCachedVerseText(libraryVerse.id, existingVerse.versionId)
      const oldMatch: CachedVerseMatch = oldCachedText
        ? { libraryVerse, cachedText: oldCachedText, version: existingVerse.version }
        : assertCacheAvailable(await findAnyCachedVerse({ versionId: existingVerse.versionId }))

      outcome = resolveVersionChangeOutcome({ oldMatch, newResult: null })
    }

    if (outcome.updateHistoryVersionId) {
      await prisma.userVerseHistory.update({
        where: { id: existingVerse.id },
        data: {
          versionId: version.id,
        },
      })
    }

    console.log(
      outcome.updateHistoryVersionId
        ? `✅ Returned same verse in new version: ${outcome.match.cachedText.reference}`
        : `⏳ Kept verse in previous version, will retry version switch: ${outcome.match.cachedText.reference}`
    )

    const isSaved = await isVerseSaved(userId, libraryVerse.id)

    return toDailyVerseResponse(outcome.match, isSaved, outcome.source)
  }

  // User hasn't received their verse today - generate new one

  // 2. Get user's preferred themes (if any)
  const preferredThemes = await getUserPreferredThemes(userId)

  // 3. Get current cache count
  const cachedCount = await getCachedVerseCount()
  let useCacheFirst = shouldTryCache(cachedCount)

  let libraryVerse: LibraryVerse | undefined
  let verseText: string = ''
  let reference: string = ''
  let source: 'cache' | 'api' = 'api'

  // 4. Try cache first if strategy says so
  if (useCacheFirst) {
    const cached = await tryFindCachedVerse(userId, version.id, preferredThemes)

    if (cached) {
      libraryVerse = cached.libraryVerse
      verseText = cached.cachedText.text
      reference = cached.cachedText.reference
      source = 'cache'

      console.log(`📖 Serving cached verse: ${reference} for user ${userId}`)
    } else {
      // No cached verse available, fall through to API fetch
      console.log(`📡 No cached verse available, fetching from API...`)
      useCacheFirst = false // Continue to API fetch below
    }
  }

  let fallbackMatch: CachedVerseMatch | null = null

  // 5. If not using cache or cache failed, fetch from API
  if (!useCacheFirst || !libraryVerse) {
    // Find an unseen library verse (considers preferences)
    const unseenVerse = await findUnseenLibraryVerse(userId, preferredThemes)

    if (!unseenVerse) {
      // User has seen all verses - reset their history or show error
      throw new Error('User has seen all available verses. Consider resetting history.')
    }

    libraryVerse = unseenVerse

    // Check if this verse is already cached in user's version
    const existingCache = await findCachedVerseText(libraryVerse.id, version.id)

    if (existingCache) {
      verseText = existingCache.text
      reference = existingCache.reference
      source = 'cache'
      console.log(`📖 Found existing cache for ${reference}`)
    } else {
      try {
        // Fetch from API
        const apiResult = await fetchVerseFromApi(libraryVerse, version)
        verseText = apiResult.text
        reference = apiResult.reference
        source = 'api'

        // Store in cache
        await cacheVerseText(
          libraryVerse.id,
          version.id,
          verseText,
          reference
        )

        console.log(`📡 Fetched and cached: ${reference} (total cached: ${cachedCount + 1})`)
      } catch (error) {
        console.warn('[Verse] Bible API unavailable, serving cached verse', {
          scope: 'user-new-verse',
          userId,
          versionId: version.id,
          error: error instanceof Error ? error.message : error,
        })

        const cachedFallback = await tryFindCachedVerse(userId, version.id, preferredThemes)
        fallbackMatch = cachedFallback
          ? { libraryVerse: cachedFallback.libraryVerse, cachedText: cachedFallback.cachedText, version }
          : assertCacheAvailable(await findAnyCachedVerse({ versionId: version.id }))
      }
    }
  }

  if (fallbackMatch) {
    // The fallback verse may already have been shown to the user on a
    // different date. markVerseAsSeen keys on (userId, libraryVerseId), so
    // replaying it here overwrites that history row's date to today instead
    // of creating a duplicate - an accepted tradeoff so the verse stays
    // stable for the rest of the day while the Bible API is down.
    await markVerseAsSeen(
      userId,
      fallbackMatch.libraryVerse.id,
      fallbackMatch.cachedText.versionId,
      today
    )

    const isSaved = await isVerseSaved(userId, fallbackMatch.libraryVerse.id)

    return toDailyVerseResponse(fallbackMatch, isSaved, 'cache')
  }

  if (!libraryVerse) {
    throw new Error('Unable to resolve a verse for the user')
  }

  // 6. Mark as seen by user (for today)
  await markVerseAsSeen(userId, libraryVerse.id, version.id, today)

  // 7. Return formatted response
  const isSaved = await isVerseSaved(userId, libraryVerse.id)

  return {
    reference,
    text: verseText,
    theme: libraryVerse.theme,
    versionCode: version.apiCode,
    versionName: version.name,
    source,
    libraryVerseId: libraryVerse.id,
    is_saved: isSaved,
  }
}

/**
 * Update theme preferences score
 * Called after user likes or shares a verse
 */
async function updateThemePreference(
  userId: string,
  theme: string,
  action: 'like' | 'share'
): Promise<void> {
  const weight = action === 'share' ? 2.0 : 1.0 // Shares are more valuable

  const existing = await prisma.userThemePreference.findUnique({
    where: {
      userId_theme: { userId, theme },
    },
  })

  if (existing) {
    const newLikeCount = action === 'like' ? existing.likeCount + 1 : existing.likeCount
    const newShareCount = action === 'share' ? existing.shareCount + 1 : existing.shareCount
    const newScore = (newLikeCount * 1.0) + (newShareCount * 2.0)

    await prisma.userThemePreference.update({
      where: { id: existing.id },
      data: {
        likeCount: newLikeCount,
        shareCount: newShareCount,
        score: newScore,
        lastInteraction: new Date(),
      },
    })
  } else {
    await prisma.userThemePreference.create({
      data: {
        userId,
        theme,
        likeCount: action === 'like' ? 1 : 0,
        shareCount: action === 'share' ? 1 : 0,
        score: weight,
      },
    })
  }

  console.log(`📊 Updated theme preference: ${theme} (${action}) for user ${userId}`)
}

/**
 * Mark a verse as liked by the user
 */
export async function likeVerse(userId: string, libraryVerseId: number): Promise<void> {
  // Get the verse to access its theme
  const libraryVerse = await prisma.libraryVerse.findUnique({
    where: { id: libraryVerseId },
  })

  if (!libraryVerse) {
    throw new Error('Library verse not found')
  }

  // Update history record
  const history = await prisma.userVerseHistory.findUnique({
    where: {
      userId_libraryVerseId: { userId, libraryVerseId },
    },
  })

  if (!history) {
    throw new Error('Verse history not found. User must see verse before liking.')
  }

  // Update like status
  await prisma.userVerseHistory.update({
    where: { id: history.id },
    data: {
      liked: true,
      likedAt: new Date(),
    },
  })

  // Update theme preference
  await updateThemePreference(userId, libraryVerse.theme, 'like')

  console.log(`👍 User ${userId} liked verse ${libraryVerseId} (theme: ${libraryVerse.theme})`)
}

/**
 * Mark a verse as shared by the user
 */
export async function shareVerse(userId: string, libraryVerseId: number): Promise<void> {
  // Get the verse to access its theme
  const libraryVerse = await prisma.libraryVerse.findUnique({
    where: { id: libraryVerseId },
  })

  if (!libraryVerse) {
    throw new Error('Library verse not found')
  }

  // Update history record
  const history = await prisma.userVerseHistory.findUnique({
    where: {
      userId_libraryVerseId: { userId, libraryVerseId },
    },
  })

  if (!history) {
    throw new Error('Verse history not found. User must see verse before sharing.')
  }

  // Update share status
  await prisma.userVerseHistory.update({
    where: { id: history.id },
    data: {
      shared: true,
      sharedAt: new Date(),
    },
  })

  // Update theme preference (shares count more)
  await updateThemePreference(userId, libraryVerse.theme, 'share')

  console.log(`🔗 User ${userId} shared verse ${libraryVerseId} (theme: ${libraryVerse.theme})`)
}

/**
 * Reset user's verse history (for testing or user request)
 */
export async function resetUserVerseHistory(userId: string): Promise<void> {
  await prisma.userVerseHistory.deleteMany({
    where: { userId },
  })
  console.log(`🔄 Reset verse history for user ${userId}`)
}

/**
 * Get user's theme preferences and statistics
 */
export async function getUserThemeStats(userId: string): Promise<any> {
  const preferences = await prisma.userThemePreference.findMany({
    where: { userId },
    orderBy: { score: 'desc' },
  })

  const totalLikes = await prisma.userVerseHistory.count({
    where: { userId, liked: true },
  })

  const totalShares = await prisma.userVerseHistory.count({
    where: { userId, shared: true },
  })

  return {
    topThemes: preferences.slice(0, 5),
    totalLikes,
    totalShares,
    totalThemes: preferences.length,
  }
}
