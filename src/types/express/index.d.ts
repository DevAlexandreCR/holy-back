import type { AuthTokenPayload } from '../../modules/auth/jwt';

declare global {
  namespace Express {
    interface Request {
      user?: AuthTokenPayload;
    }
  }
}

export {};
