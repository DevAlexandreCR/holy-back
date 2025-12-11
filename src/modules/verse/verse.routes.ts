import { Router } from 'express';
import { requireAuth } from '../auth/auth.middleware';
import { getTodayVerse } from './verse.controller';

const router = Router();

router.use(requireAuth);
router.get('/today', getTodayVerse);

export default router;
