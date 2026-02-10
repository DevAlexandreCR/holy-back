import type { AuthTokenPayload } from '../../modules/auth/jwt';

declare global {
  namespace Express {
    interface Request {
      user?: AuthTokenPayload;
      file?: Express.Multer.File;
      files?: Express.Multer.File[];
    }
  }
}

export {};
