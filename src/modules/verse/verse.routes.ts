import { Router } from 'express'
import { requireAuth } from '../auth/auth.middleware'
import {
  getTodayVerse,
  likeVerseHandler,
  shareVerseHandler,
  getThemePreferences,
  resetHistory
} from './verse.controller'

const router = Router()

// All verse endpoints require authentication
router.use(requireAuth)

router.get('/today', getTodayVerse)
router.post('/:libraryVerseId/like', likeVerseHandler)
router.post('/:libraryVerseId/share', shareVerseHandler)
router.get('/preferences', getThemePreferences)
router.post('/history/reset', resetHistory)

export default router
