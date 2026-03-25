import { Router } from 'express'
import { requireAuth } from '../auth/auth.middleware'
import {
  appSessionStartedHandler,
  rebuildDailyAggregatesHandler,
} from './analytics.controller'

const router = Router()

router.post('/analytics/app-session', requireAuth, appSessionStartedHandler)
router.post('/analytics/rebuild-daily-aggregates', requireAuth, rebuildDailyAggregatesHandler)

export default router
