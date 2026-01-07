import { Request, Response, NextFunction } from 'express'
import {
  getDailyVerseForGuest,
  getDailyVerseForUser,
  resetUserVerseHistory,
  likeVerse,
  shareVerse,
  getUserThemeStats,
} from './verse.service'
import { getChapterForDailyVerse, getChapterForSavedVerse } from './chapter.service'
import { getSavedVerses, removeSavedVerse, saveVerseForUser } from './savedVerse.service'

/**
 * GET /verse/today
 * Returns today's personalized verse for the authenticated user
 */
export const getTodayVerse = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const userId = req.user?.sub
    const verse = userId
      ? await getDailyVerseForUser(userId)
      : await getDailyVerseForGuest()

    res.json({
      data: verse,
    })
  } catch (error: any) {
    console.error('Error fetching today verse:', error)

    // Handle specific error for no Bible version selected
    if (error.code === 'NO_VERSION_SELECTED') {
      return res.status(error.statusCode || 400).json({
        error: {
          message: error.message,
          code: error.code,
        },
      })
    }

    return next(error)
  }
}

/**
 * GET /verse/today/chapter
 * Returns the full chapter for today's verse in the user's preferred version
 */
export const getTodayVerseChapter = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const userId = req.user!.sub

    const chapter = await getChapterForDailyVerse(userId)

    res.json({
      data: chapter,
    })
  } catch (error: any) {
    console.error('Error fetching today verse chapter:', error)

    if (error.code === 'NO_VERSION_SELECTED') {
      return res.status(error.statusCode || 400).json({
        error: {
          message: error.message,
          code: error.code,
        },
      })
    }

    return next(error)
  }
}

/**
 * GET /verse/:libraryVerseId/chapter
 * Returns the full chapter for a saved verse in the version it was saved with
 */
export const getSavedVerseChapter = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const userId = req.user!.sub
    const libraryVerseId = parseInt(req.params.libraryVerseId, 10)

    if (Number.isNaN(libraryVerseId)) {
      return res.status(400).json({
        error: 'Invalid verse ID',
      })
    }

    const chapter = await getChapterForSavedVerse(userId, libraryVerseId)

    res.json({
      data: chapter,
    })
  } catch (error: any) {
    console.error('Error fetching saved verse chapter:', error)
    return next(error)
  }
}

/**
 * GET /widget/verse
 * Lightweight endpoint for widget consumption
 * Same logic as /verse/today
 */
export const getWidgetVerse = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const userId = req.user!.sub // From auth middleware

    const verse = await getDailyVerseForUser(userId)

    // Simplified response for widgets
    res.json({
      data: {
        reference: verse.reference,
        text: verse.text,
        version: verse.versionCode,
        is_saved: verse.is_saved,
      },
    })
  } catch (error: any) {
    console.error('Error fetching widget verse:', error)

    // Handle specific error for no Bible version selected
    if (error.code === 'NO_VERSION_SELECTED') {
      return res.status(error.statusCode || 400).json({
        error: {
          message: error.message,
          code: error.code,
        },
      })
    }

    return next(error)
  }
}

/**
 * POST /verse/:libraryVerseId/like
 * Mark a verse as liked by the user
 */
export const likeVerseHandler = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const userId = req.user!.sub
    const libraryVerseId = parseInt(req.params.libraryVerseId)

    if (isNaN(libraryVerseId)) {
      return res.status(400).json({
        error: 'Invalid verse ID',
      })
    }

    await likeVerse(userId, libraryVerseId)

    res.json({
      data: {
        message: 'Verse liked successfully',
        libraryVerseId,
      },
    })
  } catch (error) {
    console.error('Error liking verse:', error)
    return next(error)
  }
}

/**
 * POST /verse/:libraryVerseId/share
 * Mark a verse as shared by the user
 */
export const shareVerseHandler = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const userId = req.user!.sub
    const libraryVerseId = parseInt(req.params.libraryVerseId)

    if (isNaN(libraryVerseId)) {
      return res.status(400).json({
        error: 'Invalid verse ID',
      })
    }

    await shareVerse(userId, libraryVerseId)

    res.json({
      data: {
        message: 'Verse shared successfully',
        libraryVerseId,
      },
    })
  } catch (error) {
    console.error('Error sharing verse:', error)
    return next(error)
  }
}

/**
 * GET /verse/preferences
 * Get user's theme preferences and statistics
 */
export const getThemePreferences = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const userId = req.user!.sub

    const stats = await getUserThemeStats(userId)

    res.json({
      data: stats,
    })
  } catch (error) {
    console.error('Error fetching theme preferences:', error)
    next(error)
  }
}

/**
 * POST /verse/history/reset
 * Reset user's verse history (for testing or user preference)
 */
export const resetHistory = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const userId = req.user!.sub

    await resetUserVerseHistory(userId)

    res.json({
      data: {
        message: 'Verse history reset successfully',
      },
    })
  } catch (error) {
    console.error('Error resetting verse history:', error)
    next(error)
  }
}

/**
 * POST /verse/:libraryVerseId/save
 * Save a verse for the authenticated user
 */
export const saveVerseHandler = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const userId = req.user!.sub
    const libraryVerseId = parseInt(req.params.libraryVerseId, 10)

    if (Number.isNaN(libraryVerseId)) {
      return res.status(400).json({
        error: 'Invalid verse ID',
      })
    }

    console.log(`[saveVerse] user=${userId} libraryVerseId=${libraryVerseId}`)
    const saved = await saveVerseForUser(userId, libraryVerseId)

    return res.json({
      data: saved,
    })
  } catch (error) {
    console.error('Error saving verse:', error)
    return next(error)
  }
}

/**
 * DELETE /verse/:libraryVerseId/save
 * Remove a saved verse for the authenticated user
 */
export const removeSavedVerseHandler = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const userId = req.user!.sub
    const libraryVerseId = parseInt(req.params.libraryVerseId, 10)

    if (Number.isNaN(libraryVerseId)) {
      return res.status(400).json({
        error: 'Invalid verse ID',
      })
    }

    await removeSavedVerse(userId, libraryVerseId)

    return res.json({
      data: {
        library_verse_id: libraryVerseId,
        removed: true,
      },
    })
  } catch (error) {
    console.error('Error removing saved verse:', error)
    return next(error)
  }
}

/**
 * GET /verse/saved
 * List saved verses for the authenticated user
 */
export const listSavedVersesHandler = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const userId = req.user!.sub
    const cursorParam = req.query.cursor
    const limitParam = req.query.limit

    const cursor = typeof cursorParam === 'string' && cursorParam.length > 0
      ? parseInt(cursorParam, 10)
      : undefined
    const limit = typeof limitParam === 'string' && limitParam.length > 0
      ? parseInt(limitParam, 10)
      : undefined

    if (cursorParam && Number.isNaN(cursor)) {
      return res.status(400).json({
        error: 'Invalid cursor',
      })
    }

    if (limitParam && Number.isNaN(limit)) {
      return res.status(400).json({
        error: 'Invalid limit',
      })
    }

    const { items, nextCursor } = await getSavedVerses(userId, { cursor, limit })

    return res.json({
      data: {
        items,
        next_cursor: nextCursor ?? null,
      },
    })
  } catch (error) {
    console.error('Error listing saved verses:', error)
    return next(error)
  }
}
