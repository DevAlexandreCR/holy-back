import { Router } from 'express';
import {
  redirectToAppStoreHandler,
  redirectToGooglePlayHandler,
} from './landingRedirect.controller';

const router = Router();

router.get('/out/app-store', redirectToAppStoreHandler);
router.get('/out/google-play', redirectToGooglePlayHandler);

export default router;
