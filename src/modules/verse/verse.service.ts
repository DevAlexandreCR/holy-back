import { PrismaClient, LibraryVerse, CachedVerseText, BibleVersion } from '@prisma/client'
import { BibleApiClient } from '../bible/bibleApiClient'
import { formatReference } from './libraryLoader.service'
import { convertBookToApiCode, getBookDisplayName } from '../bible/bookApiMapping'
import { config } from '../../config/env'

const prisma = new PrismaClient()
const bibleApiClient = new BibleApiClient(config.external.bibleApiBaseUrl)

// Threshold for switching to 50/50 strategy
const CACHE_THRESHOLD = 2000

interface DailyVerseResponse {
  reference: string
  text: string
  theme: string
  versionCode: string
  versionName: string
  source: 'cache' | 'api'
  libraryVerseId: number
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
  const userSettings = await prisma.userSettings.findUnique({
    where: { userId },
    include: { preferredVersion: true },
  })

  if (userSettings?.preferredVersion) {
    return userSettings.preferredVersion
  }

  // No preferred version and no fallback - user must select one
  const error: any = new Error('No Bible version selected. Please select a Bible version in settings.')
  error.code = 'NO_VERSION_SELECTED'
  error.statusCode = 400
  throw error
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

  // Try preferred themes first (70% of the time)
  if (preferredThemes && preferredThemes.length > 0 && Math.random() < 0.7) {
    const preferredOptions = await prisma.cachedVerseText.findMany({
      where: {
        ...baseWhere,
        libraryVerse: {
          theme: { in: preferredThemes },
        },
      },
      include: { libraryVerse: true },
    })

    if (preferredOptions.length > 0) {
      const randomIndex = Math.floor(Math.random() * preferredOptions.length)
      const selected = preferredOptions[randomIndex]
      console.log(`🎯 Found cached verse with preferred theme: ${selected.libraryVerse.theme}`)
      return {
        libraryVerse: selected.libraryVerse,
        cachedText: selected,
      }
    }
  }

  // Otherwise find any cached verse
  const cachedOptions = await prisma.cachedVerseText.findMany({
    where: baseWhere,
    include: { libraryVerse: true },
  })

  if (cachedOptions.length === 0) {
    return null
  }

  // Pick random cached verse
  const randomIndex = Math.floor(Math.random() * cachedOptions.length)
  const selected = cachedOptions[randomIndex]

  return {
    libraryVerse: selected.libraryVerse,
    cachedText: selected,
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

  // Get display name for the book
  const bookDisplayName = getBookDisplayName(libraryVerse.book)

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

/**
 * Get today's date in YYYY-MM-DD format (UTC)
 */
function getTodayDate(): string {
  const now = new Date()
  return now.toISOString().split('T')[0] // YYYY-MM-DD
}

/**
 * Check if user already received their verse today
 */
async function getTodaysVerseIfExists(
  userId: string
): Promise<UserVerseHistoryWithRelations | null> {
  const today = getTodayDate()

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
 * Main function: Get daily verse for user
 */
export async function getDailyVerseForUser(userId: string): Promise<DailyVerseResponse> {
  const today = getTodayDate()

  // 1. Resolve user's preferred version first
  const version = await resolveUserVersion(userId)

  // 0. Check if user already got their verse today
  const existingVerse = await getTodaysVerseIfExists(userId)

  if (existingVerse) {
    // Check if the existing verse is in the user's current preferred version
    if (existingVerse.versionId === version.id) {
      // Same version - return cached verse
      const cachedText = await findCachedVerseText(
        existingVerse.libraryVerseId,
        existingVerse.versionId
      )

      if (!cachedText) {
        throw new Error('Cached verse text not found for today\'s verse')
      }

      console.log(`♻️  Returning today's verse for user ${userId}: ${cachedText.reference}`)

      return {
        reference: cachedText.reference,
        text: cachedText.text,
        theme: existingVerse.libraryVerse.theme,
        versionCode: existingVerse.version.apiCode,
        versionName: existingVerse.version.name,
        source: 'cache',
        libraryVerseId: existingVerse.libraryVerse.id,
      }
    }

    // User changed their Bible version - get the same verse in the new version
    console.log(`🔄 User changed version from ${existingVerse.version.apiCode} to ${version.apiCode}, fetching same verse in new version...`)

    const libraryVerse = existingVerse.libraryVerse

    // Check if this verse already exists in the new version
    let cachedText = await findCachedVerseText(libraryVerse.id, version.id)

    if (!cachedText) {
      // Fetch from API and cache it
      console.log(`📡 Fetching ${libraryVerse.book} ${libraryVerse.chapter}:${libraryVerse.verseFrom} in ${version.apiCode}...`)
      const apiResult = await fetchVerseFromApi(libraryVerse, version)

      cachedText = await cacheVerseText(
        libraryVerse.id,
        version.id,
        apiResult.text,
        apiResult.reference
      )
    }

    // Update the user's verse history with the new version
    await prisma.userVerseHistory.update({
      where: { id: existingVerse.id },
      data: {
        versionId: version.id,
      },
    })

    console.log(`✅ Returned same verse in new version: ${cachedText.reference}`)

    return {
      reference: cachedText.reference,
      text: cachedText.text,
      theme: libraryVerse.theme,
      versionCode: version.apiCode,
      versionName: version.name,
      source: cachedText.id === existingVerse.id ? 'cache' : 'api',
      libraryVerseId: libraryVerse.id,
    }
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
    }
  }

  // 6. Mark as seen by user (for today)
  await markVerseAsSeen(userId, libraryVerse.id, version.id, today)

  // 7. Return formatted response
  return {
    reference,
    text: verseText,
    theme: libraryVerse.theme,
    versionCode: version.apiCode,
    versionName: version.name,
    source,
    libraryVerseId: libraryVerse.id,
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
