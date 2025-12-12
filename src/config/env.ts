import type { StringValue } from 'ms';
import dotenv from 'dotenv';

dotenv.config();

type RequiredKey = 'JWT_SECRET' | 'BIBLE_API_BASE_URL';

const requiredKeys: RequiredKey[] = ['JWT_SECRET', 'BIBLE_API_BASE_URL'];

const readEnvAny = (keys: string[], defaultValue?: string): string => {
  for (const key of keys) {
    const value = process.env[key];
    if (value !== undefined) {
      return value;
    }
  }

  if (defaultValue !== undefined) {
    return defaultValue;
  }

  throw new Error(`Missing required environment variable: ${keys.join(' or ')}`);
};

const toNumber = (value: string, keyLabel: string): number => {
  const parsed = Number(value);
  if (Number.isNaN(parsed)) {
    throw new Error(`Environment variable ${keyLabel} must be a number`);
  }
  return parsed;
};

const ensureRequired = (): void => {
  const missing: string[] = [];

  requiredKeys.forEach((key) => {
    if (!process.env[key]) {
      missing.push(key);
    }
  });

  const hasDatabaseUrl = Boolean(process.env.DATABASE_URL);
  const hasDbComponents =
    process.env.DB_HOST && process.env.DB_USER && process.env.DB_PASSWORD && process.env.DB_NAME;

  if (!hasDatabaseUrl && !hasDbComponents) {
    missing.push('DATABASE_URL or DB_HOST, DB_USER, DB_PASSWORD, DB_NAME');
  }

  if (missing.length) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }
};

const buildDatabaseUrl = (): string => {
  const directUrl = process.env.DATABASE_URL;
  if (directUrl) return directUrl;

  const host = readEnvAny(['DB_HOST']);
  const port = toNumber(readEnvAny(['DB_PORT'], '3306'), 'DB_PORT');
  const user = readEnvAny(['DB_USER']);
  const password = readEnvAny(['DB_PASSWORD']);
  const name = readEnvAny(['DB_NAME']);

  return `mysql://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${host}:${port}/${name}`;
};

ensureRequired();

const APP_PORT = toNumber(readEnvAny(['APP_PORT', 'PORT'], '3000'), 'APP_PORT/PORT');
const JWT_SECRET = readEnvAny(['JWT_SECRET']);
const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET ?? JWT_SECRET;
const JWT_EXPIRES_IN = readEnvAny(['JWT_EXPIRES_IN'], 'never') as StringValue;
const JWT_REFRESH_EXPIRES_IN = readEnvAny(['JWT_REFRESH_EXPIRES_IN'], 'never') as StringValue;
const RESET_TOKEN_EXPIRES_MINUTES = toNumber(
  readEnvAny(['RESET_TOKEN_EXPIRES_MINUTES'], '30'),
  'RESET_TOKEN_EXPIRES_MINUTES',
);
const DAILY_VERSE_CRON = readEnvAny(['CRON_SCHEDULE', 'VERSE_OF_DAY_CRON'], '5 0 * * *');
const BIBLE_VERSIONS_CRON = readEnvAny(['BIBLE_VERSIONS_CRON'], '15 0 * * *');

export const config = {
  app: {
    port: APP_PORT,
  },
  db: {
    url: buildDatabaseUrl(),
  },
  auth: {
    jwtSecret: JWT_SECRET,
    jwtRefreshSecret: JWT_REFRESH_SECRET,
    accessTokenTtl: JWT_EXPIRES_IN,
    refreshTokenTtl: JWT_REFRESH_EXPIRES_IN,
    resetTokenTtlMinutes: RESET_TOKEN_EXPIRES_MINUTES,
  },
  external: {
    bibleApiBaseUrl: readEnvAny(['BIBLE_API_BASE_URL']),
  },
  jobs: {
    dailyVerseCron: DAILY_VERSE_CRON,
    bibleVersionsCron: BIBLE_VERSIONS_CRON,
  },
} as const;

export type AppConfig = typeof config;
