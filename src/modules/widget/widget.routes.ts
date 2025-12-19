import { Router } from 'express'
import { requireAuth } from '../auth/auth.middleware'
import { getWidgetVerse } from '../verse/verse.controller'

const router = Router()

router.get('/verse', requireAuth, getWidgetVerse)

export default router
