import { Router } from 'express';
import { requireAuth } from '../auth/auth.middleware';
import { getWidgetVerse } from '../verse/verse.controller';

const router = Router();

router.use(requireAuth);
router.get('/verse', getWidgetVerse);

export default router;
