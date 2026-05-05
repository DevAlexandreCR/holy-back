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

const toBoundedNumber = (
  value: string,
  keyLabel: string,
  options: { min?: number; max?: number } = {},
): number => {
  const parsed = toNumber(value, keyLabel);
  if (options.min !== undefined && parsed < options.min) {
    throw new Error(`Environment variable ${keyLabel} must be >= ${options.min}`);
  }
  if (options.max !== undefined && parsed > options.max) {
    throw new Error(`Environment variable ${keyLabel} must be <= ${options.max}`);
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
const DAILY_AGGREGATES_CRON = readEnvAny(['DAILY_AGGREGATES_CRON'], '25 0 * * *');
const USER_STREAK_MAINTENANCE_CRON = readEnvAny(
  ['USER_STREAK_MAINTENANCE_CRON'],
  '0 * * * *',
);
const DEVOTIONAL_DAILY_FEATURE_CANDIDATES_CRON = readEnvAny(
  ['DEVOTIONAL_DAILY_FEATURE_CANDIDATES_CRON'],
  '0 * * * *',
);
const DEVOTIONAL_TAG_AFFINITY_DECAY_CRON = readEnvAny(
  ['DEVOTIONAL_TAG_AFFINITY_DECAY_CRON'],
  '10 0 * * *',
);
const DEVOTIONAL_STREAK_RISK_CRON = readEnvAny(
  ['DEVOTIONAL_STREAK_RISK_CRON'],
  '*/15 * * * *',
);
const NOTIFICATION_INBOX_FLUSH_CRON = readEnvAny(
  ['NOTIFICATION_INBOX_FLUSH_CRON'],
  '*/5 * * * *',
);
const HOLYVERSO_DAILY_PLANNER_CRON = readEnvAny(
  ['HOLYVERSO_DAILY_PLANNER_CRON'],
  '*/30 * * * *',
);
const HOLYVERSO_SLOT_PUBLISHER_CRON = readEnvAny(
  ['HOLYVERSO_SLOT_PUBLISHER_CRON'],
  '*/10 * * * *',
);
const DEVOTIONAL_DAILY_FEATURED_AFFINITY_MULTIPLIER = toBoundedNumber(
  readEnvAny(['DEVOTIONAL_DAILY_FEATURED_AFFINITY_MULTIPLIER'], '0.25'),
  'DEVOTIONAL_DAILY_FEATURED_AFFINITY_MULTIPLIER',
  { min: 0 },
);
const DEVOTIONAL_DAILY_FEATURED_AFFINITY_CAP = toBoundedNumber(
  readEnvAny(['DEVOTIONAL_DAILY_FEATURED_AFFINITY_CAP'], '3'),
  'DEVOTIONAL_DAILY_FEATURED_AFFINITY_CAP',
  { min: 0 },
);
const DEVOTIONAL_FOR_YOU_AFFINITY_MULTIPLIER = toBoundedNumber(
  readEnvAny(['DEVOTIONAL_FOR_YOU_AFFINITY_MULTIPLIER'], '0.1'),
  'DEVOTIONAL_FOR_YOU_AFFINITY_MULTIPLIER',
  { min: 0 },
);
const DEVOTIONAL_FOR_YOU_AFFINITY_CAP = toBoundedNumber(
  readEnvAny(['DEVOTIONAL_FOR_YOU_AFFINITY_CAP'], '2'),
  'DEVOTIONAL_FOR_YOU_AFFINITY_CAP',
  { min: 0 },
);
const DEVOTIONAL_AFFINITY_WEIGHT_READ_COMPLETE = toBoundedNumber(
  readEnvAny(['DEVOTIONAL_AFFINITY_WEIGHT_READ_COMPLETE'], '1'),
  'DEVOTIONAL_AFFINITY_WEIGHT_READ_COMPLETE',
  { min: 0 },
);
const DEVOTIONAL_AFFINITY_WEIGHT_SAVE = toBoundedNumber(
  readEnvAny(['DEVOTIONAL_AFFINITY_WEIGHT_SAVE'], '3'),
  'DEVOTIONAL_AFFINITY_WEIGHT_SAVE',
  { min: 0 },
);
const DEVOTIONAL_AFFINITY_WEIGHT_SHARE = toBoundedNumber(
  readEnvAny(['DEVOTIONAL_AFFINITY_WEIGHT_SHARE'], '4'),
  'DEVOTIONAL_AFFINITY_WEIGHT_SHARE',
  { min: 0 },
);
const DEVOTIONAL_STREAK_FREEZE_GRANT_INTERVAL_DAYS = toBoundedNumber(
  readEnvAny(['DEVOTIONAL_STREAK_FREEZE_GRANT_INTERVAL_DAYS'], '7'),
  'DEVOTIONAL_STREAK_FREEZE_GRANT_INTERVAL_DAYS',
  { min: 1 },
);
const DEVOTIONAL_STREAK_FREEZE_BALANCE_CAP = toBoundedNumber(
  readEnvAny(['DEVOTIONAL_STREAK_FREEZE_BALANCE_CAP'], '1'),
  'DEVOTIONAL_STREAK_FREEZE_BALANCE_CAP',
  { min: 1 },
);
const DEVOTIONAL_FEATURED_NOTIFICATION_COOLDOWN_HOURS = toBoundedNumber(
  readEnvAny(['DEVOTIONAL_FEATURED_NOTIFICATION_COOLDOWN_HOURS'], '12'),
  'DEVOTIONAL_FEATURED_NOTIFICATION_COOLDOWN_HOURS',
  { min: 1 },
);
const DEVOTIONAL_STREAK_RISK_SEND_AFTER_LOCAL_HOUR = toBoundedNumber(
  readEnvAny(['DEVOTIONAL_STREAK_RISK_SEND_AFTER_LOCAL_HOUR'], '18'),
  'DEVOTIONAL_STREAK_RISK_SEND_AFTER_LOCAL_HOUR',
  { min: 0, max: 23 },
);
const PUBLIC_BASE_URL = readEnvAny(['PUBLIC_BASE_URL', 'APP_BASE_URL'], 'https://holyverso.com');
const PUBLIC_API_BASE_URL = readEnvAny(['PUBLIC_API_BASE_URL'], PUBLIC_BASE_URL);

const MAIL_HOST = readEnvOptional(['MAIL_HOST']);
const MAIL_PORT = toOptionalNumber(readEnvOptional(['MAIL_PORT']), 'MAIL_PORT');
const MAIL_USER = readEnvOptional(['MAIL_USER']);
const MAIL_PASSWORD = readEnvOptional(['MAIL_PASSWORD']);
const MAIL_SECURE = toOptionalBoolean(readEnvOptional(['MAIL_SECURE']), 'MAIL_SECURE');
const MAIL_FROM = readEnvOptional(['MAIL_FROM']);
const PASSWORD_RESET_BASE_URL = readEnvOptional(['PASSWORD_RESET_BASE_URL']);
const PASSWORD_RESET_DEEP_LINK = readEnvOptional(['PASSWORD_RESET_DEEP_LINK']);
const OPENAI_API_KEY = readEnvOptional(['OPENAI_API_KEY']);
const OPENAI_MODERATION_MODEL = readEnvAny(
  ['OPENAI_MODERATION_MODEL'],
  'omni-moderation-latest',
);
const OPENAI_MODERATION_TIMEOUT_MS = toNumber(
  readEnvAny(['OPENAI_MODERATION_TIMEOUT_MS'], '8000'),
  'OPENAI_MODERATION_TIMEOUT_MS',
);
const OPENAI_DEVOTIONAL_HOOK_MODEL = readEnvOptional([
  'OPENAI_DEVOTIONAL_HOOK_MODEL',
]);
const OPENAI_DEVOTIONAL_HOOK_TIMEOUT_MS = toNumber(
  readEnvAny(['OPENAI_DEVOTIONAL_HOOK_TIMEOUT_MS'], '5000'),
  'OPENAI_DEVOTIONAL_HOOK_TIMEOUT_MS',
);
const OPENAI_DEVOTIONAL_TAG_MODEL = readEnvOptional([
  'OPENAI_DEVOTIONAL_TAG_MODEL',
]);
const OPENAI_DEVOTIONAL_TAG_TIMEOUT_MS = toNumber(
  readEnvAny(['OPENAI_DEVOTIONAL_TAG_TIMEOUT_MS'], '5000'),
  'OPENAI_DEVOTIONAL_TAG_TIMEOUT_MS',
);
const DEVOTIONAL_AUDIO_ENABLED = toOptionalBoolean(
  readEnvOptional(['DEVOTIONAL_AUDIO_ENABLED']),
  'DEVOTIONAL_AUDIO_ENABLED',
) ?? false;
const OPENAI_DEVOTIONAL_AUDIO_MODEL = readEnvAny(
  ['OPENAI_DEVOTIONAL_AUDIO_MODEL'],
  'gpt-4o-mini-tts',
);
const OPENAI_DEVOTIONAL_AUDIO_VOICE = readEnvAny(
  ['OPENAI_DEVOTIONAL_AUDIO_VOICE'],
  'cedar',
);
const OPENAI_DEVOTIONAL_AUDIO_TIMEOUT_MS = toBoundedNumber(
  readEnvAny(['OPENAI_DEVOTIONAL_AUDIO_TIMEOUT_MS'], '60000'),
  'OPENAI_DEVOTIONAL_AUDIO_TIMEOUT_MS',
  { min: 1000 },
);
const OPENAI_DEVOTIONAL_AUDIO_MAX_CHARS = toBoundedNumber(
  readEnvAny(['OPENAI_DEVOTIONAL_AUDIO_MAX_CHARS'], '12000'),
  'OPENAI_DEVOTIONAL_AUDIO_MAX_CHARS',
  { min: 1 },
);
const OPENAI_DEVOTIONAL_AUDIO_CHUNK_MAX_CHARS = toBoundedNumber(
  readEnvAny(['OPENAI_DEVOTIONAL_AUDIO_CHUNK_MAX_CHARS'], '4096'),
  'OPENAI_DEVOTIONAL_AUDIO_CHUNK_MAX_CHARS',
  { min: 1, max: 4096 },
);
const OPENAI_HOLYVERSO_TEXT_MODEL = readEnvOptional([
  'OPENAI_HOLYVERSO_TEXT_MODEL',
]);
const OPENAI_HOLYVERSO_TEXT_TIMEOUT_MS = toNumber(
  readEnvAny(['OPENAI_HOLYVERSO_TEXT_TIMEOUT_MS'], '15000'),
  'OPENAI_HOLYVERSO_TEXT_TIMEOUT_MS',
);
const OPENAI_HOLYVERSO_IMAGE_MODEL = readEnvOptional([
  'OPENAI_HOLYVERSO_IMAGE_MODEL',
]);
const OPENAI_HOLYVERSO_IMAGE_TIMEOUT_MS = toNumber(
  readEnvAny(['OPENAI_HOLYVERSO_IMAGE_TIMEOUT_MS'], '45000'),
  'OPENAI_HOLYVERSO_IMAGE_TIMEOUT_MS',
);
const HOLYVERSO_USER_NAME = readEnvAny(['HOLYVERSO_USER_NAME'], 'HolyVerso');
const HOLYVERSO_USER_EMAIL = readEnvAny(
  ['HOLYVERSO_USER_EMAIL'],
  'holyverso@holyverso.com',
);
const HOLYVERSO_USER_HANDLE = readEnvAny(['HOLYVERSO_USER_HANDLE'], 'holyverso');
const HOLYVERSO_USER_PASSWORD = readEnvOptional(['HOLYVERSO_USER_PASSWORD']);
const HOLYVERSO_USER_BIO = readEnvAny(
  ['HOLYVERSO_USER_BIO'],
  'Devocionales diarios para acompañarte con la Palabra de Dios.',
);

if (DEVOTIONAL_AUDIO_ENABLED && !OPENAI_API_KEY) {
  throw new Error(
    'OPENAI_API_KEY is required when DEVOTIONAL_AUDIO_ENABLED=true',
  );
}
const FCM_PROJECT_ID = readEnvOptional(['FCM_PROJECT_ID']);
const FCM_CLIENT_EMAIL = readEnvOptional(['FCM_CLIENT_EMAIL']);
const rawFcmPrivateKey =
  readEnvOptional(['FCM_PRIVATE_KEY']) ??
  (readEnvOptional(['FCM_PRIVATE_KEY_BASE64'])
    ? Buffer.from(readEnvOptional(['FCM_PRIVATE_KEY_BASE64'])!, 'base64').toString('utf8')
    : undefined);
const FCM_PRIVATE_KEY = rawFcmPrivateKey?.replace(/\\n/g, '\n');

export const config = {
  app: {
    port: APP_PORT,
    env: NODE_ENV,
    isProduction: NODE_ENV === 'production',
    publicBaseUrl: PUBLIC_BASE_URL,
    publicApiBaseUrl: PUBLIC_API_BASE_URL,
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
    dailyAggregatesCron: DAILY_AGGREGATES_CRON,
    userStreakMaintenanceCron: USER_STREAK_MAINTENANCE_CRON,
    devotionalDailyFeatureCandidatesCron:
      DEVOTIONAL_DAILY_FEATURE_CANDIDATES_CRON,
    devotionalTagAffinityDecayCron: DEVOTIONAL_TAG_AFFINITY_DECAY_CRON,
    devotionalStreakRiskCron: DEVOTIONAL_STREAK_RISK_CRON,
    notificationInboxFlushCron: NOTIFICATION_INBOX_FLUSH_CRON,
    holyversoDailyPlannerCron: HOLYVERSO_DAILY_PLANNER_CRON,
    holyversoSlotPublisherCron: HOLYVERSO_SLOT_PUBLISHER_CRON,
  },
  mail: {
    host: MAIL_HOST,
    port: MAIL_PORT,
    user: MAIL_USER,
    password: MAIL_PASSWORD,
    secure: MAIL_SECURE ?? false,
    from: MAIL_FROM,
    passwordResetBaseUrl: PASSWORD_RESET_BASE_URL,
    passwordResetDeepLink: PASSWORD_RESET_DEEP_LINK ?? 'holyverso://app/reset-password',
    isConfigured: Boolean(MAIL_HOST && MAIL_PORT && MAIL_FROM && PASSWORD_RESET_BASE_URL),
  },
  openai: {
    apiKey: OPENAI_API_KEY,
    moderationModel: OPENAI_MODERATION_MODEL,
    moderationTimeoutMs: OPENAI_MODERATION_TIMEOUT_MS,
    devotionalHookModel: OPENAI_DEVOTIONAL_HOOK_MODEL,
    devotionalHookTimeoutMs: OPENAI_DEVOTIONAL_HOOK_TIMEOUT_MS,
    devotionalTagModel: OPENAI_DEVOTIONAL_TAG_MODEL,
    devotionalTagTimeoutMs: OPENAI_DEVOTIONAL_TAG_TIMEOUT_MS,
    devotionalAudioEnabled: DEVOTIONAL_AUDIO_ENABLED,
    devotionalAudioModel: OPENAI_DEVOTIONAL_AUDIO_MODEL,
    devotionalAudioVoice: OPENAI_DEVOTIONAL_AUDIO_VOICE,
    devotionalAudioTimeoutMs: OPENAI_DEVOTIONAL_AUDIO_TIMEOUT_MS,
    devotionalAudioMaxChars: OPENAI_DEVOTIONAL_AUDIO_MAX_CHARS,
    devotionalAudioChunkMaxChars: OPENAI_DEVOTIONAL_AUDIO_CHUNK_MAX_CHARS,
    holyversoTextModel: OPENAI_HOLYVERSO_TEXT_MODEL,
    holyversoTextTimeoutMs: OPENAI_HOLYVERSO_TEXT_TIMEOUT_MS,
    holyversoImageModel: OPENAI_HOLYVERSO_IMAGE_MODEL,
    holyversoImageTimeoutMs: OPENAI_HOLYVERSO_IMAGE_TIMEOUT_MS,
  },
  notifications: {
    fcmProjectId: FCM_PROJECT_ID,
    fcmClientEmail: FCM_CLIENT_EMAIL,
    fcmPrivateKey: FCM_PRIVATE_KEY,
    isConfigured: Boolean(FCM_PROJECT_ID && FCM_CLIENT_EMAIL && FCM_PRIVATE_KEY),
  },
  engagement: {
    dailyFeaturedAffinity: {
      multiplier: DEVOTIONAL_DAILY_FEATURED_AFFINITY_MULTIPLIER,
      cap: DEVOTIONAL_DAILY_FEATURED_AFFINITY_CAP,
    },
    forYouAffinity: {
      multiplier: DEVOTIONAL_FOR_YOU_AFFINITY_MULTIPLIER,
      cap: DEVOTIONAL_FOR_YOU_AFFINITY_CAP,
    },
    affinityWeights: {
      readComplete: DEVOTIONAL_AFFINITY_WEIGHT_READ_COMPLETE,
      save: DEVOTIONAL_AFFINITY_WEIGHT_SAVE,
      share: DEVOTIONAL_AFFINITY_WEIGHT_SHARE,
    },
    freeze: {
      grantIntervalDays: DEVOTIONAL_STREAK_FREEZE_GRANT_INTERVAL_DAYS,
      balanceCap: DEVOTIONAL_STREAK_FREEZE_BALANCE_CAP,
    },
    notifications: {
      featuredCooldownHours: DEVOTIONAL_FEATURED_NOTIFICATION_COOLDOWN_HOURS,
      streakRiskSendAfterLocalHour: DEVOTIONAL_STREAK_RISK_SEND_AFTER_LOCAL_HOUR,
    },
  },
  holyverso: {
    user: {
      name: HOLYVERSO_USER_NAME,
      email: HOLYVERSO_USER_EMAIL,
      handle: HOLYVERSO_USER_HANDLE,
      password: HOLYVERSO_USER_PASSWORD,
      bio: HOLYVERSO_USER_BIO,
    },
    isConfigured: Boolean(
      OPENAI_API_KEY &&
        OPENAI_HOLYVERSO_TEXT_MODEL &&
        OPENAI_HOLYVERSO_IMAGE_MODEL
    ),
  },
} as const;

export type AppConfig = typeof config;
