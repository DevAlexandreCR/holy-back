import { connectToDatabase, disconnectFromDatabase } from '../config/db'
import { seedDevotionalTags } from '../modules/devotionals/devotionalTagSeed.service'

const main = async () => {
  await connectToDatabase()

  try {
    const result = await seedDevotionalTags()
    console.log('[SeedDevotionalTags]', result)
  } finally {
    await disconnectFromDatabase()
  }
}

void main().catch(async (error) => {
  console.error('[SeedDevotionalTags] Failed', error)
  await disconnectFromDatabase()
  process.exit(1)
})
