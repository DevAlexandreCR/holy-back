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
} as const

export const devotionalRankingPolicy = {
  featureDurationHours: 48,
  privilegedLaunchScore: 1000,
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
