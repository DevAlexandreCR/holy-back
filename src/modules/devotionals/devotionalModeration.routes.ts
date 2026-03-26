import { Router } from 'express'
import { requireAuth } from '../auth/auth.middleware'
import {
  approveDevotionalReviewHandler,
  restrictDevotionalReviewHandler,
} from './devotional.controller'

const router = Router()

router.post('/devotionals/:id/approve', requireAuth, approveDevotionalReviewHandler)
router.post('/devotionals/:id/restrict', requireAuth, restrictDevotionalReviewHandler)

export default router
