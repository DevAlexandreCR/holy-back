import type { StringValue } from 'ms';
import dotenv from 'dotenv';

dotenv.config();

type RequiredKey = 'JWT_SECRET' | 'BIBLE_API_BASE_URL';
type JwtTtl = StringValue | 'never';

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

const readEnvOptional = (keys: string[]): string | undefined => {
  for (const key of keys) {
    const value = process.env[key];
    if (value !== undefined) {
      return value;
    }
  }
  return undefined;
};

const toNumber = (value: string, keyLabel: string): number => {
  const parsed = Number(value);
  if (Number.isNaN(parsed)) {
    throw new Error(`Environment variable ${keyLabel} must be a number`);
  }
  return parsed;
};

const toOptionalNumber = (value: string | undefined, keyLabel: string): number | undefined => {
  if (value === undefined) return undefined;
  return toNumber(value, keyLabel);
};

const toOptionalBoolean = (value: string | undefined, keyLabel: string): boolean | undefined => {
  if (value === undefined) return undefined;
  const normalized = value.toLowerCase();
  if (normalized === 'true') return true;
  if (normalized === 'false') return false;
  throw new Error(`Environment variable ${keyLabel} must be "true" or "false"`);
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

const NODE_ENV = readEnvAny(['NODE_ENV'], 'development');
const APP_PORT = toNumber(readEnvAny(['APP_PORT', 'PORT'], '3000'), 'APP_PORT/PORT');
const JWT_SECRET = readEnvAny(['JWT_SECRET']);
const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET ?? JWT_SECRET;
const JWT_EXPIRES_IN = readEnvAny(['JWT_EXPIRES_IN'], 'never') as JwtTtl;
const JWT_REFRESH_EXPIRES_IN = readEnvAny(['JWT_REFRESH_EXPIRES_IN'], 'never') as JwtTtl;
const RESET_TOKEN_EXPIRES_MINUTES = toNumber(
  readEnvAny(['RESET_TOKEN_EXPIRES_MINUTES'], '30'),
  'RESET_TOKEN_EXPIRES_MINUTES',
);
const BIBLE_VERSIONS_CRON = readEnvAny(['BIBLE_VERSIONS_CRON'], '15 0 * * *');

const MAIL_HOST = readEnvOptional(['MAIL_HOST']);
const MAIL_PORT = toOptionalNumber(readEnvOptional(['MAIL_PORT']), 'MAIL_PORT');
const MAIL_USER = readEnvOptional(['MAIL_USER']);
const MAIL_PASSWORD = readEnvOptional(['MAIL_PASSWORD']);
const MAIL_SECURE = toOptionalBoolean(readEnvOptional(['MAIL_SECURE']), 'MAIL_SECURE');
const MAIL_FROM = readEnvOptional(['MAIL_FROM']);
const PASSWORD_RESET_BASE_URL = readEnvOptional(['PASSWORD_RESET_BASE_URL']);

export const config = {
  app: {
    port: APP_PORT,
    env: NODE_ENV,
    isProduction: NODE_ENV === 'production',
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
    bibleVersionsCron: BIBLE_VERSIONS_CRON,
  },
  mail: {
    host: MAIL_HOST,
    port: MAIL_PORT,
    user: MAIL_USER,
    password: MAIL_PASSWORD,
    secure: MAIL_SECURE ?? false,
    from: MAIL_FROM,
    passwordResetBaseUrl: PASSWORD_RESET_BASE_URL,
    isConfigured: Boolean(MAIL_HOST && MAIL_PORT && MAIL_FROM && PASSWORD_RESET_BASE_URL),
  },
} as const;

export type AppConfig = typeof config;
