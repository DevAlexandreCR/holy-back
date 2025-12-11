import { config } from '../config/env';
import { connectToDatabase, disconnectFromDatabase } from '../config/db';
import BibleApiClient from '../modules/bible/bibleApiClient';
import { upsertBibleVersions } from '../modules/bible/bible.service';

const run = async (): Promise<void> => {
  try {
    await connectToDatabase();
    const client = new BibleApiClient(config.external.bibleApiBaseUrl);
    const versions = await client.getVersions();

    // eslint-disable-next-line no-console
    console.log(`Fetched ${versions.length} versions from external API`);

    const { created, updated } = await upsertBibleVersions(versions);
    // eslint-disable-next-line no-console
    console.log(`Bible versions sync completed: ${created} created, ${updated} updated`);
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('Bible versions sync failed', error);
    process.exitCode = 1;
  } finally {
    await disconnectFromDatabase();
  }
};

void run();
