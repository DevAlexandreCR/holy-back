import { Router } from 'express'
import { requireAuth } from '../auth/auth.middleware'
import { deleteAccount, getSettings, updatePreferredVersion, updateTimezone, updateWidgetFontSize } from './user.controller'

const router = Router()

router.use(requireAuth)
router.get('/settings', getSettings)
router.put('/settings/version', updatePreferredVersion)
router.put('/settings/timezone', updateTimezone)
router.put('/settings/widget-font-size', updateWidgetFontSize)
router.delete('/account', deleteAccount)

export default router
