import { connectToDatabase, disconnectFromDatabase } from '../config/db'
import { backfillDevotionalTags } from '../modules/devotionals/devotionalTagging.service'

const main = async () => {
  await connectToDatabase()
  try {
    const result = await backfillDevotionalTags()
    console.log('[BackfillDevotionalTags]', result)
  } finally {
    await disconnectFromDatabase()
  }
}

void main().catch(async (error) => {
  console.error('[BackfillDevotionalTags] Failed', error)
  await disconnectFromDatabase()
  process.exit(1)
})
