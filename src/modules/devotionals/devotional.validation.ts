import { z } from 'zod'
import { DevotionalStatus } from '@prisma/client'

export const verseReferenceSchema = z
  .object({
    book: z.string().min(1).max(80),
    chapter: z.number().int().positive(),
    verse_start: z.number().int().positive(),
    verse_end: z.number().int().positive().optional(),
    is_primary: z.boolean().optional(),
  })
  .refine(
    (data) => !data.verse_end || data.verse_end >= data.verse_start,
    {
      message: 'verse_end must be greater than or equal to verse_start',
      path: ['verse_end'],
    }
  )

export const devotionalContentSchema = z.union([
  z.array(z.any()).min(1),
  z
    .object({
      ops: z.array(z.any()).min(1),
    })
    .passthrough(),
])

export const createDevotionalSchema = z
  .object({
    title: z.string().min(1).max(120),
    content: devotionalContentSchema,
    cover_image_url: z.string().max(512).optional().nullable(),
    verse_references: z.array(verseReferenceSchema).min(1),
    status: z.nativeEnum(DevotionalStatus).optional(),
  })
  .refine(
    (data) => data.status !== DevotionalStatus.ARCHIVED,
    {
      message: 'status cannot be ARCHIVED when creating',
      path: ['status'],
    }
  )

export const updateDevotionalSchema = z
  .object({
    title: z.string().min(1).max(120).optional(),
    content: devotionalContentSchema.optional(),
    cover_image_url: z.string().max(512).optional().nullable(),
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
  status: z.nativeEnum(DevotionalStatus).optional(),
  authorId: z.string().uuid().optional(),
})
