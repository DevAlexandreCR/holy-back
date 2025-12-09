import dotenv from 'dotenv';

dotenv.config();

type RequiredKey = 'DATABASE_URL' | 'JWT_SECRET' | 'BIBLE_API_BASE_URL';

const requiredKeys: RequiredKey[] = ['DATABASE_URL', 'JWT_SECRET', 'BIBLE_API_BASE_URL'];

const readEnv = (key: string, defaultValue?: string): string => {
  const value = process.env[key] ?? defaultValue;
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
};

const toNumber = (value: string, key: string): number => {
  const parsed = Number(value);
  if (Number.isNaN(parsed)) {
    throw new Error(`Environment variable ${key} must be a number`);
  }
  return parsed;
};

const ensureRequired = (): void => {
  requiredKeys.forEach((key) => {
    if (!process.env[key]) {
      throw new Error(`Missing required environment variable: ${key}`);
    }
  });
};

ensureRequired();

const APP_PORT = toNumber(readEnv('PORT', '3000'), 'PORT');
const JWT_SECRET = readEnv('JWT_SECRET');
const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET ?? JWT_SECRET;

export const config = {
  app: {
    port: APP_PORT,
  },
  db: {
    url: readEnv('DATABASE_URL'),
  },
  auth: {
    jwtSecret: JWT_SECRET,
    jwtRefreshSecret: JWT_REFRESH_SECRET,
  },
  external: {
    bibleApiBaseUrl: readEnv('BIBLE_API_BASE_URL'),
  },
} as const;

export type AppConfig = typeof config;
