import { z } from 'zod'

const creatorHandleUpdateSchema = z.preprocess((value) => {
  if (typeof value === 'string' && value.trim().length === 0) {
    return undefined
  }

  return value
}, z.string().max(60).optional())

export const creatorProfileUpdateSchema = z
  .object({
    handle: creatorHandleUpdateSchema,
    bio: z.string().max(280).optional().nullable(),
    avatar_asset_id: z.string().uuid().optional().nullable(),
  })
  .refine(
    (value) =>
      value.handle !== undefined ||
      value.bio !== undefined ||
      value.avatar_asset_id !== undefined,
    {
      message: 'At least one field is required',
    }
  )

export const creatorProfilePaginationSchema = z.object({
  cursor: z.string().optional(),
  limit: z.string().optional(),
})
