import { connectToDatabase, disconnectFromDatabase } from '../config/db';
import { syncBibleVersionsFromApi } from '../modules/bible/bible.service';

const run = async (): Promise<void> => {
  try {
    await connectToDatabase();
    const { total, created, updated } = await syncBibleVersionsFromApi();
    // eslint-disable-next-line no-console
    console.log(`Bible versions sync completed: ${created} created, ${updated} updated (from ${total} upstream versions)`);
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('Bible versions sync failed', error);
    process.exitCode = 1;
  } finally {
    await disconnectFromDatabase();
  }
};

void run();
