import cron, { ScheduledTask } from 'node-cron';
import { config } from '../config/env';
import { syncBibleVersionsFromApi } from '../modules/bible/bible.service';

const BIBLE_VERSIONS_CRON_EXPRESSION = config.jobs.bibleVersionsCron; // default daily

export const syncBibleVersionsOnce = async (): Promise<void> => {
  // eslint-disable-next-line no-console
  console.log('[BibleVersionsJob] Starting sync');

  try {
    const { total, created, updated, skipped } = await syncBibleVersionsFromApi();
    // eslint-disable-next-line no-console
    console.log(
      `[BibleVersionsJob] Sync finished: ${created} created, ${updated} updated, ${skipped} skipped (from ${total} upstream versions)`,
    );
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('[BibleVersionsJob] Sync failed', error);
  }
};

export const registerBibleVersionsJob = (): ScheduledTask => {
  // eslint-disable-next-line no-console
  console.log(`[BibleVersionsJob] Registering cron at "${BIBLE_VERSIONS_CRON_EXPRESSION}" (UTC)`);

  return cron.schedule(
    BIBLE_VERSIONS_CRON_EXPRESSION,
    () => {
      void syncBibleVersionsOnce().catch((error) => {
        // eslint-disable-next-line no-console
        console.error('[BibleVersionsJob] Unhandled error during scheduled run', error);
      });
    },
    { timezone: 'UTC' },
  );
};
