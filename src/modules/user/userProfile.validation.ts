import { z } from 'zod'

export const creatorProfileUpdateSchema = z
  .object({
    handle: z.string().min(1).max(60).optional(),
    bio: z.string().max(280).optional().nullable(),
    avatar_asset_id: z.string().uuid().optional().nullable(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: 'At least one field is required',
  })

export const creatorProfilePaginationSchema = z.object({
  cursor: z.string().optional(),
  limit: z.string().optional(),
})
