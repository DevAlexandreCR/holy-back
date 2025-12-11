import { Router } from 'express';
import { requireAuth } from '../auth/auth.middleware';
import { getBibleBooks, getBibleVersions } from './bible.controller';

const router = Router();

router.use(requireAuth);
router.get('/versions', getBibleVersions);
router.get('/books', getBibleBooks);

export default router;
