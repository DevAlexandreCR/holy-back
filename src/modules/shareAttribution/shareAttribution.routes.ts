import { Router } from 'express'
import { optionalAuth } from '../auth/auth.middleware'
import {
  shareAttributionAppOpenHandler,
  shareRedirectHandler,
} from './shareAttribution.controller'

const router = Router()

router.get('/s/:token', shareRedirectHandler)
router.post('/share-attribution/app-open', optionalAuth, shareAttributionAppOpenHandler)

export default router
