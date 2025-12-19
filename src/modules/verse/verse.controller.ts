import { Request, Response, NextFunction } from 'express'
import {
  getDailyVerseForUser,
  resetUserVerseHistory,
  likeVerse,
  shareVerse,
  getUserThemeStats,
} from './verse.service'

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
    const userId = req.user!.sub // From auth middleware

    const verse = await getDailyVerseForUser(userId)

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

    next(error)
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

    next(error)
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
    next(error)
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
    next(error)
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
