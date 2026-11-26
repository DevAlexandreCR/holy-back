import { connectToDatabase, disconnectFromDatabase } from '../config/db';
import { reconcileBibleVersionCatalog } from '../modules/bible/bible.service';

const run = async (): Promise<void> => {
  try {
    await connectToDatabase();
    const { created, updated, deactivated, reassignedUsers } = await reconcileBibleVersionCatalog();
    // eslint-disable-next-line no-console
    console.log(
      `Bible versions reconciliation completed: ${created} created, ${updated} updated, ${deactivated} deactivated, ${reassignedUsers} users reassigned`,
    );
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('Bible versions sync failed', error);
    process.exitCode = 1;
  } finally {
    await disconnectFromDatabase();
  }
};

void run();
