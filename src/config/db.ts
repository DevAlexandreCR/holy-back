import { PrismaClient } from '@prisma/client';
import { config } from './env';

const prisma = new PrismaClient({
  datasourceUrl: config.db.url,
  log: ['error', 'warn'],
});

export const connectToDatabase = async (): Promise<void> => {
  try {
    await prisma.$connect();
    // eslint-disable-next-line no-console
    console.log('Database connection established');
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('Failed to connect to database', error);
    throw error;
  }
};

export const disconnectFromDatabase = async (): Promise<void> => {
  try {
    await prisma.$disconnect();
    // eslint-disable-next-line no-console
    console.log('Database connection closed');
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('Error while disconnecting from database', error);
  }
};

export { prisma };
