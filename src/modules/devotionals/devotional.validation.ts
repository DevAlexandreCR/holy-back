import { DevotionalFeedEventType, DevotionalReportReason } from '@prisma/client'
import { z } from 'zod'
import { DEVOTIONAL_MANAGEMENT_STATUSES } from './devotional.service'

export const verseReferenceSchema = z
  .object({
    book: z.string().min(1).max(80),
    chapter: z.number().int().positive(),
    verse_start: z.number().int().positive(),
    verse_end: z.number().int().positive().optional(),
    is_primary: z.boolean().optional(),
  })
  .refine((data) => !data.verse_end || data.verse_end >= data.verse_start, {
    message: 'verse_end must be greater than or equal to verse_start',
    path: ['verse_end'],
  })

export const devotionalContentSchema = z.union([
  z.array(z.any()).min(1),
  z
    .object({
      ops: z.array(z.any()).min(1),
    })
    .passthrough(),
])

export const createDevotionalSchema = z.object({
  title: z.string().min(1).max(120),
  content: devotionalContentSchema,
  image_asset_id: z.string().uuid().optional().nullable(),
  cover_image_focus_y: z.number().min(-1).max(1).optional().nullable(),
  verse_references: z.array(verseReferenceSchema).min(1),
})

export const updateDevotionalSchema = z.object({
  title: z.string().min(1).max(120).optional(),
  content: devotionalContentSchema.optional(),
  image_asset_id: z.string().uuid().optional().nullable(),
  cover_image_focus_y: z.number().min(-1).max(1).optional().nullable(),
  verse_references: z.array(verseReferenceSchema).min(1).optional(),
})

export const commentSchema = z.object({
  content: z.string().min(1).max(500),
})

export const paginationSchema = z.object({
  page: z.string().optional(),
  limit: z.string().optional(),
})

export const listDevotionalsSchema = paginationSchema.extend({
  status: z.enum(DEVOTIONAL_MANAGEMENT_STATUSES).optional(),
  authorId: z.string().uuid().optional(),
})

export const feedPaginationSchema = z.object({
  cursor: z.string().optional(),
  limit: z.string().optional(),
})

export const feedEventsSchema = z.object({
  events: z
    .array(
      z.object({
        event_id: z.string().uuid(),
        type: z.nativeEnum(DevotionalFeedEventType),
        devotional_id: z.string().uuid(),
        delivery_token: z.string().min(1),
        occurred_at: z.string().datetime(),
      })
    )
    .min(1)
    .max(100),
})

export const devotionalReportSchema = z.object({
  reason: z.nativeEnum(DevotionalReportReason),
  details: z.string().max(1000).optional().nullable(),
})
