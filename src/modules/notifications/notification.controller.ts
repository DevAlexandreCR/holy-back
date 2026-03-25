import { Request, Response } from 'express'
import { z } from 'zod'
import { AppError } from '../../common/errors'
import {
  deleteDeviceToken,
  getNotificationPreferences,
  markNotificationOpened,
  registerDeviceToken,
  updateNotificationPreferences,
} from './notification.service'
import {
  deviceTokenDeleteSchema,
  deviceTokenRegisterSchema,
  notificationOpenSchema,
  notificationPreferencesSchema,
} from './notification.validation'

const parseOrThrow = <T>(schema: z.Schema<T>, payload: unknown): T => {
  try {
    return schema.parse(payload)
  } catch (error) {
    throw new AppError('Validation failed', 'VALIDATION_ERROR', 400, error)
  }
}

const ensureAuth = (req: Request) => {
  if (!req.user) {
    throw new AppError('Authentication required', 'AUTH_REQUIRED', 401)
  }
}

export const registerDeviceTokenHandler = async (
  req: Request,
  res: Response
) => {
  ensureAuth(req)
  const body = parseOrThrow(deviceTokenRegisterSchema, req.body)
  const result = await registerDeviceToken({
    userId: req.user!.sub,
    token: body.token,
    platform: body.platform,
    osPermissionStatus: body.os_permission_status,
  })

  res.json({ data: result })
}

export const deleteDeviceTokenHandler = async (req: Request, res: Response) => {
  ensureAuth(req)
  const body = parseOrThrow(deviceTokenDeleteSchema, req.body)
  const result = await deleteDeviceToken({
    userId: req.user!.sub,
    token: body.token,
  })

  res.json({ data: result })
}

export const getNotificationPreferencesHandler = async (
  req: Request,
  res: Response
) => {
  ensureAuth(req)
  const result = await getNotificationPreferences(req.user!.sub)
  res.json({ data: result })
}

export const updateNotificationPreferencesHandler = async (
  req: Request,
  res: Response
) => {
  ensureAuth(req)
  const body = parseOrThrow(notificationPreferencesSchema, req.body)
  const result = await updateNotificationPreferences(req.user!.sub, body)
  res.json({ data: result })
}

export const markNotificationOpenedHandler = async (
  req: Request,
  res: Response
) => {
  ensureAuth(req)
  const body = parseOrThrow(notificationOpenSchema, req.body)
  const result = await markNotificationOpened({
    userId: req.user!.sub,
    devotionalId: body.devotional_id,
    type: body.type,
  })

  res.json({ data: result })
}
