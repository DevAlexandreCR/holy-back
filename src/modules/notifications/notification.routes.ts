import { Router } from 'express'
import { requireAuth } from '../auth/auth.middleware'
import {
  deleteDeviceTokenHandler,
  getNotificationPreferencesHandler,
  markNotificationOpenedHandler,
  registerDeviceTokenHandler,
  updateNotificationPreferencesHandler,
} from './notification.controller'

const router = Router()

router.post('/device-tokens/register', requireAuth, registerDeviceTokenHandler)
router.post('/device-tokens/delete', requireAuth, deleteDeviceTokenHandler)
router.get(
  '/users/me/notification-preferences',
  requireAuth,
  getNotificationPreferencesHandler
)
router.put(
  '/users/me/notification-preferences',
  requireAuth,
  updateNotificationPreferencesHandler
)
router.post('/notifications/open', requireAuth, markNotificationOpenedHandler)

export default router
