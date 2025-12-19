import { PrismaClient } from '@prisma/client'
import { loadLibrary, normalizeBookName, createReferenceKey } from '../modules/verse/libraryLoader.service'

const prisma = new PrismaClient()

async function seedLibraryVerses() {
  console.log('🌱 Starting library verses seed...')

  const library = await loadLibrary()

  let created = 0
  let skipped = 0

  for (const entry of library) {
    const referenceKey = createReferenceKey(
      entry.book,
      entry.chapter,
      entry.verseFrom,
      entry.verseTo
    )

    try {
      await prisma.libraryVerse.upsert({
        where: { referenceKey },
        create: {
          book: normalizeBookName(entry.book),
          chapter: entry.chapter,
          verseFrom: entry.verseFrom,
          verseTo: entry.verseTo,
          theme: entry.theme,
          referenceKey,
        },
        update: {
          theme: entry.theme,
        },
      })
      created++
    } catch (error) {
      console.error(`❌ Error seeding ${referenceKey}:`, error)
      skipped++
    }
  }

  console.log(`✅ Seed complete: ${created} verses created/updated, ${skipped} skipped`)
}

seedLibraryVerses()
  .catch(console.error)
  .finally(() => prisma.$disconnect())
