import { NextFunction, Request, Response } from 'express';
import { AppError } from '../../common/errors';
import { verifyAccessToken } from './jwt';

export const requireAuth = (req: Request, _res: Response, next: NextFunction) => {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return next(new AppError('Authentication required', 'AUTH_REQUIRED', 401));
  }

  const token = header.replace('Bearer ', '').trim();

  try {
    req.user = verifyAccessToken(token);
    return next();
  } catch (error) {
    return next(new AppError('Invalid or expired token', 'INVALID_TOKEN', 401, error));
  }
};
