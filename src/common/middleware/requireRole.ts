import { NextFunction, Request, Response } from 'express'
import { UserRole } from '@prisma/client'
import { AppError } from '../errors'

export const requireRole = (allowedRoles: UserRole[]) => {
  return (req: Request, _res: Response, next: NextFunction) => {
    const user = req.user
    if (!user || !user.role) {
      return next(new AppError('Authentication required', 'AUTH_REQUIRED', 401))
    }

    if (!allowedRoles.includes(user.role)) {
      return next(
        new AppError(
          'Insufficient permissions to access this resource',
          'FORBIDDEN',
          403
        )
      )
    }

    return next()
  }
}
