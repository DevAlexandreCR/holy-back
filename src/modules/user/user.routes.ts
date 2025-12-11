import { Router } from 'express';
import { requireAuth } from '../auth/auth.middleware';
import { getSettings, updatePreferredVersion, updateTimezone } from './user.controller';

const router = Router();

router.use(requireAuth);
router.get('/settings', getSettings);
router.put('/settings/version', updatePreferredVersion);
router.put('/settings/timezone', updateTimezone);

export default router;
