import { Server } from 'http';
import { app } from './app';
import { config } from './config/env';
import { connectToDatabase, disconnectFromDatabase } from './config/db';
import { registerDailyVerseJob } from './jobs/dailyVerseJob';

const { port } = config.app;
let server: Server | undefined;
let dailyVerseJob: ReturnType<typeof registerDailyVerseJob> | undefined;

const start = async (): Promise<void> => {
  try {
    await connectToDatabase();
    server = app.listen(port, () => {
      // eslint-disable-next-line no-console
      console.log(`Backend running on port ${port}`);
    });
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
