import {
  DeviceOsPermissionStatus,
  DevicePlatform,
  DevotionalNotificationType,
} from '@prisma/client'
import { z } from 'zod'

export const deviceTokenRegisterSchema = z.object({
  token: z.string().min(1),
  platform: z.nativeEnum(DevicePlatform),
  os_permission_status: z.nativeEnum(DeviceOsPermissionStatus),
})

export const deviceTokenDeleteSchema = z.object({
  token: z.string().min(1),
})

export const notificationPreferencesSchema = z.object({
  devotional_notifications_enabled: z.boolean(),
  followed_creator_notifications_enabled: z.boolean(),
  featured_devotional_notifications_enabled: z.boolean(),
  streak_risk_notifications_enabled: z.boolean(),
  author_moderation_notifications_enabled: z.boolean(),
  editor_review_notifications_enabled: z.boolean(),
  social_activity_notifications_enabled: z.boolean(),
  comment_notifications_enabled: z.boolean(),
  follow_notifications_enabled: z.boolean(),
  reaction_notifications_enabled: z.boolean(),
})

export const notificationOpenSchema = z.object({
  type: z.nativeEnum(DevotionalNotificationType),
  devotional_id: z.string().uuid(),
})

export const notificationInboxListSchema = z.object({
  cursor: z.string().optional(),
  limit: z.string().optional(),
  filter: z.enum(['all', 'unread']).optional(),
})

export const notificationInboxReadSchema = z.object({
  opened: z.boolean().optional(),
})
