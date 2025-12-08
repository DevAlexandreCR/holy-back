import dotenv from 'dotenv';

dotenv.config();

type RequiredKey =
  | 'DB_HOST'
  | 'DB_PORT'
  | 'DB_USER'
  | 'DB_PASSWORD'
  | 'DB_NAME'
  | 'JWT_SECRET'
  | 'BIBLE_API_BASE_URL';

const requiredKeys: RequiredKey[] = [
  'DB_HOST',
  'DB_PORT',
  'DB_USER',
  'DB_PASSWORD',
  'DB_NAME',
  'JWT_SECRET',
  'BIBLE_API_BASE_URL',
];

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

const APP_PORT = toNumber(readEnv('APP_PORT', '3000'), 'APP_PORT');
const DB_PORT = toNumber(readEnv('DB_PORT'), 'DB_PORT');

const JWT_SECRET = readEnv('JWT_SECRET');
const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET ?? JWT_SECRET;

export const config = {
  app: {
    port: APP_PORT,
  },
  db: {
    host: readEnv('DB_HOST'),
    port: DB_PORT,
    user: readEnv('DB_USER'),
    password: readEnv('DB_PASSWORD'),
    name: readEnv('DB_NAME'),
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
