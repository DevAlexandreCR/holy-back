import { Router } from 'express';
import { forgot, login, me, register, reset, resetRedirect } from './auth.controller';
import { requireAuth } from './auth.middleware';

const router = Router();

router.post('/register', register);
router.post('/login', login);
router.post('/forgot-password', forgot);
router.post('/reset-password', reset);
router.get('/me', requireAuth, me);
router.get('/reset-password', resetRedirect);

export default router;
