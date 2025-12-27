import { Router } from 'express'
import { requireAuth } from '../auth/auth.middleware'
import {
  getTodayVerse,
  getTodayVerseChapter,
  likeVerseHandler,
  shareVerseHandler,
  getThemePreferences,
  resetHistory,
  listSavedVersesHandler,
  saveVerseHandler,
  removeSavedVerseHandler,
  getSavedVerseChapter,
} from './verse.controller'

const router = Router()

// All verse endpoints require authentication
router.use(requireAuth)

router.get('/today/chapter', getTodayVerseChapter)
router.get('/today', getTodayVerse)
router.get('/saved', listSavedVersesHandler)
router.post('/:libraryVerseId/save', saveVerseHandler)
router.delete('/:libraryVerseId/save', removeSavedVerseHandler)
router.get('/:libraryVerseId/chapter', getSavedVerseChapter)
router.post('/:libraryVerseId/like', likeVerseHandler)
router.post('/:libraryVerseId/share', shareVerseHandler)
router.get('/preferences', getThemePreferences)
router.post('/history/reset', resetHistory)

export default router
