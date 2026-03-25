import { Router } from 'express';
import { requireAuth } from '../auth/auth.middleware';
import {
  getBibleAutocomplete,
  getBibleChapter,
  getBibleBooks,
  getBibleVersions,
  searchBibleVerses,
} from './bible.controller';

const router = Router();

router.use(requireAuth);
router.get('/versions', getBibleVersions);
router.get('/books', getBibleBooks);
router.get('/autocomplete', getBibleAutocomplete);
router.get('/chapter', getBibleChapter);
router.post('/search', searchBibleVerses);

export default router;
