import { NextFunction, Request, Response } from 'express'
import { AppError } from '../errors'

export type BlockedUserCapability =
  | 'DEVOTIONAL_CREATE'
  | 'DEVOTIONAL_EDIT'
  | 'DEVOTIONAL_PUBLISH'
  | 'COMMENT_CREATE'
  | 'COMMENT_EDIT'
  | 'COMMENT_DELETE'

const blockedCapabilityErrors: Record<
  BlockedUserCapability,
  { message: string; code: string }
> = {
  DEVOTIONAL_CREATE: {
    message: 'Tu cuenta está bloqueada y no puede crear devocionales.',
    code: 'USER_BLOCKED_DEVOTIONAL_CREATE',
  },
  DEVOTIONAL_EDIT: {
    message: 'Tu cuenta está bloqueada y no puede editar devocionales.',
    code: 'USER_BLOCKED_DEVOTIONAL_EDIT',
  },
  DEVOTIONAL_PUBLISH: {
    message: 'Tu cuenta está bloqueada y no puede publicar devocionales.',
    code: 'USER_BLOCKED_DEVOTIONAL_PUBLISH',
  },
  COMMENT_CREATE: {
    message: 'Tu cuenta está bloqueada y no puede comentar.',
    code: 'USER_BLOCKED_COMMENT_CREATE',
  },
  COMMENT_EDIT: {
    message: 'Tu cuenta está bloqueada y no puede editar comentarios.',
    code: 'USER_BLOCKED_COMMENT_EDIT',
  },
  COMMENT_DELETE: {
    message: 'Tu cuenta está bloqueada y no puede eliminar comentarios.',
    code: 'USER_BLOCKED_COMMENT_DELETE',
  },
}

export const requireUserCapability = (capability: BlockedUserCapability) => {
  return (req: Request, _res: Response, next: NextFunction) => {
    const user = req.user
    if (!user) {
      return next(new AppError('Authentication required', 'AUTH_REQUIRED', 401))
    }

    if (!user.isBlocked) {
      return next()
    }

    const error = blockedCapabilityErrors[capability]

    return next(new AppError(error.message, error.code, 403))
  }
}
