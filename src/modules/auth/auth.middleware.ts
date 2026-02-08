import { NextFunction, Request, Response } from 'express';
import { AppError, isAppError } from '../../common/errors';
import { prisma } from '../../config/db';
import { verifyAccessToken } from './jwt';

const ensureActiveUser = async (userId: string) => {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { deletedAt: true, role: true },
  });

  if (!user) {
    throw new AppError('Invalid or expired token', 'INVALID_TOKEN', 401);
  }

  if (user.deletedAt) {
    throw new AppError('Account deleted', 'ACCOUNT_DELETED', 401);
  }

  return user.role;
};

const getBearerToken = (header?: string) => {
  if (!header || !header.startsWith('Bearer ')) {
    return null;
  }
  return header.replace('Bearer ', '').trim();
};

export const requireAuth = async (req: Request, _res: Response, next: NextFunction) => {
  const token = getBearerToken(req.headers.authorization);
  if (!token) {
    return next(new AppError('Authentication required', 'AUTH_REQUIRED', 401));
  }

  try {
    const payload = verifyAccessToken(token);
    const role = await ensureActiveUser(payload.sub);
    req.user = { ...payload, role };
    return next();
  } catch (error) {
    if (isAppError(error)) {
      return next(error);
    }
    return next(new AppError('Invalid or expired token', 'INVALID_TOKEN', 401, error));
  }
};

export const optionalAuth = async (req: Request, _res: Response, next: NextFunction) => {
  const token = getBearerToken(req.headers.authorization);
  if (!token) {
    return next();
  }

  try {
    const payload = verifyAccessToken(token);
    const role = await ensureActiveUser(payload.sub);
    req.user = { ...payload, role };
    return next();
  } catch (error) {
    if (isAppError(error)) {
      return next(error);
    }
    return next(new AppError('Invalid or expired token', 'INVALID_TOKEN', 401, error));
  }
};
