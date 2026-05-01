import { Router } from 'express'
import { requireAuth } from '../auth/auth.middleware'
import {
  deleteDeviceTokenHandler,
  getNotificationPreferencesHandler,
  getNotificationInboxUnreadCountHandler,
  listNotificationInboxHandler,
  markNotificationInboxItemReadHandler,
  markNotificationInboxItemsReadHandler,
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
router.get('/notifications/inbox', requireAuth, listNotificationInboxHandler)
router.get(
  '/notifications/inbox/unread-count',
  requireAuth,
  getNotificationInboxUnreadCountHandler
)
router.post(
  '/notifications/inbox/read-all',
  requireAuth,
  markNotificationInboxItemsReadHandler
)
router.post(
  '/notifications/inbox/:id/read',
  requireAuth,
  markNotificationInboxItemReadHandler
)
router.post('/notifications/open', requireAuth, markNotificationOpenedHandler)

export default router
