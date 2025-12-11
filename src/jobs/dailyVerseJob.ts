import cron, { ScheduledTask } from 'node-cron';
import { listActiveBibleVersions } from '../modules/bible/bible.service';
import { fetchAndStoreDailyVerse, toUTCDateOnly } from '../modules/verse/dailyVerse.service';

const DAILY_VERSE_CRON_EXPRESSION = '5 0 * * *'; // 00:05 UTC daily

export const runDailyVerseJobOnce = async (date: Date = new Date()): Promise<void> => {
  const targetDate = toUTCDateOnly(date);
  const dateLabel = targetDate.toISOString().slice(0, 10);

  // eslint-disable-next-line no-console
  console.log(`[DailyVerseJob] Starting run for ${dateLabel}`);

  try {
    const versions = await listActiveBibleVersions();
    // eslint-disable-next-line no-console
    console.log(`[DailyVerseJob] Found ${versions.length} active versions`);

    for (const version of versions) {
      try {
        await fetchAndStoreDailyVerse(version, targetDate);
        // eslint-disable-next-line no-console
        console.log(`[DailyVerseJob] Stored verse for version ${version.apiCode}`);
      } catch (error) {
        // eslint-disable-next-line no-console
        console.error(`[DailyVerseJob] Failed for version ${version.apiCode}`, error);
      }
    }

    // eslint-disable-next-line no-console
    console.log(`[DailyVerseJob] Completed run for ${dateLabel}`);
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error(`[DailyVerseJob] Job run failed for ${dateLabel}`, error);
  }
};

export const registerDailyVerseJob = (): ScheduledTask => {
  // eslint-disable-next-line no-console
  console.log(`[DailyVerseJob] Registering cron at "${DAILY_VERSE_CRON_EXPRESSION}" (UTC)`);
  return cron.schedule(
    DAILY_VERSE_CRON_EXPRESSION,
    () => {
      void runDailyVerseJobOnce().catch((error) => {
        // eslint-disable-next-line no-console
        console.error('[DailyVerseJob] Unhandled error during scheduled run', error);
      });
    },
    { timezone: 'UTC' },
  );
};
