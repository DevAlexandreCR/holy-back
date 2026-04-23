import { Prisma } from '@prisma/client'
import { prisma } from '../../config/db'
import {
  APPROVED_DEVOTIONAL_TAG_NAMES,
  buildMissingDevotionalTagNames,
} from './devotionalTagDictionary'

export const seedDevotionalTags = async (
  db: Prisma.TransactionClient | typeof prisma = prisma
) => {
  const existingTags = await db.devotionalTag.findMany({
    orderBy: { name: 'asc' },
    select: { name: true },
  })

  const missingTagNames = buildMissingDevotionalTagNames(
    existingTags.map((tag) => tag.name)
  )

  if (missingTagNames.length > 0) {
    await db.devotionalTag.createMany({
      data: missingTagNames.map((name) => ({ name })),
      skipDuplicates: true,
    })
  }

  return {
    created: missingTagNames.length,
    existing: APPROVED_DEVOTIONAL_TAG_NAMES.length - missingTagNames.length,
    total: APPROVED_DEVOTIONAL_TAG_NAMES.length,
  }
}
