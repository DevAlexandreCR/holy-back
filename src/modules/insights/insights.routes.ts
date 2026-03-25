import { Router } from 'express'
import { requireAuth } from '../auth/auth.middleware'
import {
  getDevotionalInsightDetailHandler,
  getInsightsOverviewHandler,
  listDevotionalInsightsHandler,
} from './insights.controller'

const router = Router()

router.get('/users/me/insights/overview', requireAuth, getInsightsOverviewHandler)
router.get(
  '/users/me/insights/devotionals',
  requireAuth,
  listDevotionalInsightsHandler
)
router.get(
  '/users/me/insights/devotionals/:id',
  requireAuth,
  getDevotionalInsightDetailHandler
)

export default router
