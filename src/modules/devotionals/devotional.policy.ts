import {
  DevotionalPublicationState,
  DevotionalReportReason,
  UserRole,
} from '@prisma/client'

export const DEVOTIONAL_MAX_CONTENT_BYTES = 200 * 1024
export const DEVOTIONAL_MAX_PAGE_LIMIT = 50
export const DEVOTIONAL_FEED_DEFAULT_LIMIT = 20
export const DEVOTIONAL_FEED_CANDIDATE_MULTIPLIER = 6
export const DEVOTIONAL_PREVIEW_MAX_CHARS = 240
export const DEVOTIONAL_WORDS_PER_MINUTE = 180

export const DEVOTIONAL_FEED_MODES = ['for_you', 'following'] as const
export type DevotionalFeedMode = (typeof DEVOTIONAL_FEED_MODES)[number]

export const DEVOTIONAL_FEED_ELIGIBLE_STATES = [
  DevotionalPublicationState.PUBLISHED_LOW_REACH,
  DevotionalPublicationState.TRENDING,
  DevotionalPublicationState.FEATURED,
] as const

export const DEVOTIONAL_PUBLISHED_MANAGEMENT_STATES = [
  DevotionalPublicationState.PUBLISHED_LOW_REACH,
  DevotionalPublicationState.TRENDING,
  DevotionalPublicationState.FEATURED,
] as const

export const devotionalFeedPolicy = {
  dedupWindowHours: 72,
  authorRepetitionMax: 2,
  authorRepetitionWindow: 20,
  forYou: {
    candidateWindowMultiplier: 12,
    freshnessWindowHours: 96,
    mix: {
      fresh: 0.35,
      globalDiscovery: 0.25,
      lowReachExploration: 0.15,
      personalized: 0.25,
    },
    lowReachAuthorImpressions24hMax: 50,
    followBoost: 16,
    affinityScoreMultiplier: 2.5,
    featuredBoost: 10,
    trendingThreshold: 20,
  },
  following: {
    candidateWindowMultiplier: 8,
  },
  affinitySignals: {
    follow: 12,
    save: 4,
    readComplete: 3,
  },
  profile: {
    maxBioLength: 280,
    handleMinLength: 3,
    handleMaxLength: 30,
    avatarAssetTtlHours: 24,
  },
} as const

export const devotionalNotificationPolicy = {
  featuredCampaignEnabled: true,
  shareAttributionWindowDays: 7,
  preferences: {
    devotionalDefaultEnabled: true,
    followedCreatorDefaultEnabled: true,
    featuredDefaultEnabled: true,
    authorModerationDefaultEnabled: true,
    editorReviewDefaultEnabled: true,
  },
  cooldowns: {
    featuredHours: 12,
    followedCreatorPer24h: 3,
  },
  titleTemplates: {
    followedCreator: 'Nuevo devocional de alguien que sigues',
    featured: 'Devocional destacado para ti',
    streakRisk: 'No pierdas tu racha hoy',
    editorReviewRequired: 'Nuevo devocional en revisión',
    authorApproved: 'Tu devocional fue aprobado',
    authorRestricted: 'Tu devocional fue restringido',
  },
  dailyReminderCopyTemplates: {
    streak: [
      {
        title: '🔥 Día {streak}, {name}',
        body: 'Tu racha sigue firme. Este es un buen momento para tu devocional de hoy.',
      },
      {
        title: 'Vas muy bien, {name} 🔥',
        body: 'Llevas {streak} días seguidos buscando a Dios. Sigamos hoy también.',
      },
      {
        title: '🔥 Racha de {streak} días',
        body: '{name}, tu momento con Dios te está esperando.',
      },
    ],
    invitation: [
      {
        title: 'Tu momento con Dios te espera',
        body: 'Hola {name}, hoy es un buen día para detenerte un momento y leer tu devocional.',
      },
      {
        title: 'Un espacio para respirar',
        body: '{name}, tómate unos minutos hoy para tu momento con Dios.',
      },
      {
        title: 'Hoy también hay un mensaje para ti',
        body: 'Hola {name}, tu devocional de hoy te está esperando.',
      },
    ],
  },
} as const

const interpolateDailyReminderTemplate = (
  template: string,
  values: { name: string; streak: string },
) => template.replace(/\{name\}/g, values.name).replace(/\{streak\}/g, values.streak)

export const resolveDailyReminderCopy = (params: {
  name: string
  streak: number
}): { title: string; body: string } => {
  const firstName = params.name.trim().split(/\s+/)[0] || params.name
  const variant =
    params.streak >= 2
      ? devotionalNotificationPolicy.dailyReminderCopyTemplates.streak
      : devotionalNotificationPolicy.dailyReminderCopyTemplates.invitation
  const template = variant[Math.floor(Math.random() * variant.length)]
  const values = { name: firstName, streak: String(params.streak) }

  return {
    title: interpolateDailyReminderTemplate(template.title, values),
    body: interpolateDailyReminderTemplate(template.body, values),
  }
}

const streakMilestoneCopyTemplates: Record<
  number,
  { title: string; body: string }
> = {
  3: {
    title: '¡3 días seguidos! 🔥',
    body: 'Estás construyendo un lindo hábito. Sigamos así.',
  },
  7: {
    title: '¡7 días seguidos! 🔥',
    body: 'Una semana completa buscando a Dios cada día. ¡Vas muy bien!',
  },
  30: {
    title: '¡30 días seguidos! 🔥',
    body: 'Un mes entero de constancia. Este hábito ya es parte de tu vida.',
  },
  100: {
    title: '¡100 días seguidos! 🔥',
    body: 'Cien días seguidos buscando a Dios. Tu constancia es un testimonio. ¡Felicidades!',
  },
}

export const resolveStreakMilestoneCopy = (
  milestone: number
): { title: string; body: string } =>
  streakMilestoneCopyTemplates[milestone] ?? {
    title: `¡${milestone} días seguidos! 🔥`,
    body: 'Tu constancia está dando frutos. ¡Sigamos así!',
  }

// Win-back ladder copy: warm Spanish (Colombia), never guilt. Step 3 carries
// the verse-of-the-day text in the body (resolved server-side by the caller,
// see sendWinbackNotifications). Step 14 IS the final message announcing the
// pause — there is no separate "step 15".
const winbackCopyTemplates: Record<number, { title: string; body: string }> = {
  3: {
    title: 'Te extrañamos, {name} 💛',
    body: 'Hace unos días no sabemos de ti. Hoy tu versículo es: "{verse}"',
  },
  7: {
    title: 'Hay algo nuevo para ti',
    body: '{name}, preparamos nuevos devocionales pensando en ti. Vuelve cuando quieras retomar tu momento con Dios.',
  },
  14: {
    title: 'Vamos a dejarte tranquilo por ahora',
    body: '{name}, no queremos llenarte de notificaciones. Dejaremos de escribirte por un tiempo; aquí estaremos cuando quieras volver.',
  },
}

const interpolateWinbackTemplate = (
  template: string,
  values: { name: string; verse: string },
) =>
  template
    .replace(/\{name\}/g, values.name)
    .replace(/\{verse\}/g, values.verse)

export const resolveWinbackCopy = (params: {
  step: number
  name: string
  verseText?: string | null
}): { title: string; body: string } => {
  const firstName = params.name.trim().split(/\s+/)[0] || params.name
  const template = winbackCopyTemplates[params.step] ?? winbackCopyTemplates[3]
  const values = { name: firstName, verse: params.verseText ?? '' }

  return {
    title: interpolateWinbackTemplate(template.title, values),
    body: interpolateWinbackTemplate(template.body, values),
  }
}

export const devotionalRankingReviewPolicy = {
  version: 'phase3-v2',
  effectiveDate: '2026-03-27',
  reason: 'Added early-stage skip stabilization for low-volume exploration.',
  metricsReviewed: [
    'D1 retention',
    'D7 retention',
    'read complete rate by feed mode',
    'save rate by feed mode',
    'share rate by feed mode',
    'report rate by feed mode',
    'creator concentration among top creators',
    'low-reach promotion rate',
    'Following feed usage share',
    'personalized candidate lift in For You',
  ],
} as const

export const devotionalRankingPolicy = {
  featureDurationHours: 48,
  privilegedLaunchScore: 1000,
  skipStabilization: {
    minimumRateImpressions: 50,
    neutralBelowUniqueImpressions: 50,
    fullPenaltyAtUniqueImpressions: 100,
    rampMultiplier: 0.5,
    freshnessGraceHours: 6,
    freshnessMultiplier: 0.5,
  },
  promotion: {
    trending: {
      uniqueImpressions: 250,
      score: 20,
      readCompleteRate: 0.08,
      saveRate: 0.03,
      reportRate: 0.02,
      skipRate: 0.8,
    },
    featured: {
      uniqueImpressions: 1000,
      score: 40,
      readCompleteRate: 0.12,
      shareRate: 0.02,
      reportRate: 0.01,
      skipRate: 0.7,
    },
  },
  decay: {
    trendingScoreFloor: 18,
    featuredScoreFloor: 32,
  },
  scoreWeights: {
    like: 0.5,
    comment: 2,
    share: 4,
    save: 3,
    readComplete: 3,
    qualityRateMultiplier: 35,
    reportPenalty: 10,
    skipPenalty: 12,
    authorPenaltyImpressionsDivisor: 200,
  },
} as const

export const DEVOTIONAL_PRIVILEGED_FEATURE_ROLES = [
  UserRole.ADMIN,
  UserRole.EDITOR,
] as const

export const devotionalModerationPolicy = {
  reportEscalation: {
    distinctReports: 3,
    distinctUsers: 3,
  },
  openAISeverityMatrix: {
    text: {
      default: {
        medium: 0.2,
        high: 0.5,
        critical: 0.8,
        flaggedSeverity: 'MEDIUM',
      },
      categories: {
        'sexual/minors': {
          medium: 0.01,
          high: 0.05,
          critical: 0.1,
          flaggedSeverity: 'CRITICAL',
        },
        'self-harm/instructions': {
          medium: 0.05,
          high: 0.2,
          critical: 0.45,
          flaggedSeverity: 'CRITICAL',
        },
        'self-harm/intent': {
          medium: 0.08,
          high: 0.25,
          critical: 0.5,
          flaggedSeverity: 'HIGH',
        },
        'harassment/threatening': {
          medium: 0.12,
          high: 0.35,
          critical: 0.65,
          flaggedSeverity: 'HIGH',
        },
        'hate/threatening': {
          medium: 0.08,
          high: 0.25,
          critical: 0.5,
          flaggedSeverity: 'CRITICAL',
        },
        'illicit/violent': {
          medium: 0.08,
          high: 0.22,
          critical: 0.45,
          flaggedSeverity: 'HIGH',
        },
        'violence/graphic': {
          medium: 0.08,
          high: 0.25,
          critical: 0.5,
          flaggedSeverity: 'HIGH',
        },
      },
    },
    image: {
      default: {
        medium: 0.12,
        high: 0.3,
        critical: 0.6,
        flaggedSeverity: 'MEDIUM',
      },
      categories: {
        'sexual/minors': {
          medium: 0.01,
          high: 0.03,
          critical: 0.08,
          flaggedSeverity: 'CRITICAL',
        },
        'self-harm/instructions': {
          medium: 0.04,
          high: 0.12,
          critical: 0.3,
          flaggedSeverity: 'CRITICAL',
        },
        'harassment/threatening': {
          medium: 0.08,
          high: 0.25,
          critical: 0.5,
          flaggedSeverity: 'HIGH',
        },
        'hate/threatening': {
          medium: 0.08,
          high: 0.22,
          critical: 0.45,
          flaggedSeverity: 'CRITICAL',
        },
        'illicit/violent': {
          medium: 0.05,
          high: 0.18,
          critical: 0.35,
          flaggedSeverity: 'HIGH',
        },
        'violence/graphic': {
          medium: 0.05,
          high: 0.18,
          critical: 0.35,
          flaggedSeverity: 'HIGH',
        },
      },
    },
  },
  reviewKeywords: [
    'casino',
    'apuesta',
    'apuestas',
    'crypto pump',
    'hate',
    'odio',
    'violento',
  ],
  blockedKeywords: [
    'porn',
    'porno',
    'sexo explicito',
    'sexual explícito',
    'kill',
    'matar',
    'suicidio',
  ],
  priorityKeywords: ['abuso infantil', 'child abuse'],
  allowedReportReasons: Object.values(DevotionalReportReason),
} as const
