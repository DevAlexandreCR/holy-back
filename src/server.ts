import { Server } from 'http';
import { app } from './app';
import { config } from './config/env';
import { connectToDatabase, disconnectFromDatabase } from './config/db';
import { registerDailyVerseJob } from './jobs/dailyVerseJob';
import { registerBibleVersionsJob, syncBibleVersionsOnce } from './jobs/bibleVersionsJob';

const { port } = config.app;
let server: Server | undefined;
let dailyVerseJob: ReturnType<typeof registerDailyVerseJob> | undefined;
let bibleVersionsJob: ReturnType<typeof registerBibleVersionsJob> | undefined;

const start = async (): Promise<void> => {
  try {
    await connectToDatabase();
    await syncBibleVersionsOnce();
    server = app.listen(port, () => {
      // eslint-disable-next-line no-console
      console.log(`Backend running on port ${port}`);
    });
    bibleVersionsJob = registerBibleVersionsJob();
    dailyVerseJob = registerDailyVerseJob();
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
    if (dailyVerseJob) {
      dailyVerseJob.stop();
    }
    if (bibleVersionsJob) {
      bibleVersionsJob.stop();
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
