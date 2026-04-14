import { Server } from 'http';
import { app } from './app';
import { config } from './config/env';
import { connectToDatabase, disconnectFromDatabase } from './config/db';
import { registerBibleVersionsJob, syncBibleVersionsOnce } from './jobs/bibleVersionsJob';
import {
  registerDailyAggregatesJob,
  runDailyAggregatesOnce,
} from './jobs/dailyAggregatesJob';
import {
  registerDevotionalRankingJob,
  runDevotionalRankingOnce,
} from './jobs/devotionalRankingJob';
import {
  registerUserStreakMaintenanceJob,
  runUserStreakMaintenanceOnce,
} from './jobs/userStreakMaintenanceJob';

const { port } = config.app;
let server: Server | undefined;
let bibleVersionsJob: ReturnType<typeof registerBibleVersionsJob> | undefined;
let devotionalRankingJob:
  | ReturnType<typeof registerDevotionalRankingJob>
  | undefined;
let dailyAggregatesJob:
  | ReturnType<typeof registerDailyAggregatesJob>
  | undefined;
let userStreakMaintenanceJob:
  | ReturnType<typeof registerUserStreakMaintenanceJob>
  | undefined;

const start = async (): Promise<void> => {
  try {
    await connectToDatabase();
    await syncBibleVersionsOnce();
    await runDevotionalRankingOnce();
    await runDailyAggregatesOnce();
    await runUserStreakMaintenanceOnce();
    server = app.listen(port, () => {
      // eslint-disable-next-line no-console
      console.log(`Backend running on port ${port}`);
    });
    bibleVersionsJob = registerBibleVersionsJob();
    devotionalRankingJob = registerDevotionalRankingJob();
    dailyAggregatesJob = registerDailyAggregatesJob();
    userStreakMaintenanceJob = registerUserStreakMaintenanceJob();
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('Failed to start server', error);
    process.exit(1);
  }
};

const shutdown = async (signal: string): Promise<void> => {
  // eslint-disable-next-line no-console
  console.log(`Received ${signal}, shutting down gracefully...`);
  try {
    if (bibleVersionsJob) {
      bibleVersionsJob.stop();
    }
    if (devotionalRankingJob) {
      devotionalRankingJob.stop();
    }
    if (dailyAggregatesJob) {
      dailyAggregatesJob.stop();
    }
    if (userStreakMaintenanceJob) {
      userStreakMaintenanceJob.stop();
    }
    if (server) {
      await new Promise<void>((resolve) => server?.close(() => resolve()));
    }
    await disconnectFromDatabase();
    process.exit(0);
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('Error during shutdown', error);
    process.exit(1);
  }
};

void start();

['SIGINT', 'SIGTERM'].forEach((signal) => {
  process.on(signal, () => {
    void shutdown(signal);
  });
});
