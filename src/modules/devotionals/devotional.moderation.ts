import {
  DevotionalImageModerationStatus,
  DevotionalModerationStatus,
  Prisma,
} from '@prisma/client'
import { devotionalModerationPolicy } from './devotional.policy'
import {
  moderateWithOpenAIImage,
  moderateWithOpenAIText,
} from './openaiModeration.provider'

export type ModerationSeverity = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'
export type ModerationProviderStatus =
  | 'APPROVED'
  | 'REJECTED'
  | 'UNAVAILABLE'

export type NormalizedModerationCategory = {
  key: string
  flagged: boolean
  score: number | null
  severity: ModerationSeverity
  source: 'OPENAI' | 'LOCAL'
}

type OpenAISeverityThresholds = {
  medium: number
  high: number
  critical: number
  flaggedSeverity: ModerationSeverity
}

type OpenAIModerationResult = {
  flagged?: boolean
  categories?: Record<string, boolean>
  category_scores?: Record<string, number>
}

type CombinedModerationResult = {
  severity: ModerationSeverity
  reason: string | null
  normalizedCategories: NormalizedModerationCategory[]
  rawProviderResult: Prisma.InputJsonValue | null
  providerStatus: ModerationProviderStatus
}

export type TextModerationResult = CombinedModerationResult & {
  moderationStatus: DevotionalModerationStatus
}

export type ImageModerationResult = CombinedModerationResult & {
  attachable: boolean
  moderationStatus: DevotionalImageModerationStatus
}

const severityRank: Record<ModerationSeverity, number> = {
  LOW: 0,
  MEDIUM: 1,
  HIGH: 2,
  CRITICAL: 3,
}

const normalize = (value: string) =>
  value
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')

const includesAny = (source: string, values: readonly string[]) =>
  values.filter((value) => source.includes(normalize(value)))

const maxSeverity = (...values: ModerationSeverity[]): ModerationSeverity =>
  values.reduce<ModerationSeverity>(
    (current, candidate) =>
      severityRank[candidate] > severityRank[current] ? candidate : current,
    'LOW'
  )

const severityFromThresholds = (
  thresholds: OpenAISeverityThresholds,
  score: number | null,
  flagged: boolean
): ModerationSeverity => {
  let severity: ModerationSeverity = 'LOW'

  if (score !== null) {
    if (score >= thresholds.critical) {
      severity = 'CRITICAL'
    } else if (score >= thresholds.high) {
      severity = 'HIGH'
    } else if (score >= thresholds.medium) {
      severity = 'MEDIUM'
    }
  }

  if (flagged) {
    severity = maxSeverity(severity, thresholds.flaggedSeverity)
  }

  return severity
}

const buildTextReason = (severity: ModerationSeverity) => {
  if (severity === 'MEDIUM') {
    return 'Tu devocional fue enviado a revisión antes de entrar al feed.'
  }
  if (severity === 'HIGH') {
    return 'El contenido no cumple las políticas de publicación.'
  }
  if (severity === 'CRITICAL') {
    return 'El contenido fue bloqueado por una revisión de seguridad.'
  }
  return null
}

const buildImageReason = (severity: ModerationSeverity) => {
  if (severity === 'LOW') {
    return null
  }
  if (severity === 'CRITICAL') {
    return 'La imagen fue bloqueada por una revisión de seguridad.'
  }
  return 'La imagen no cumple las políticas de publicación.'
}

const normalizeOpenAICategories = (
  source: 'text' | 'image',
  result: OpenAIModerationResult
) => {
  const matrix = devotionalModerationPolicy.openAISeverityMatrix[source]
  const categories = result.categories ?? {}
  const scores = result.category_scores ?? {}
  const keys = new Set([...Object.keys(categories), ...Object.keys(scores)])
  const normalizedCategories: NormalizedModerationCategory[] = []

  for (const key of keys) {
    const flagged = categories[key] === true
    const score = typeof scores[key] === 'number' ? scores[key] : null
    const thresholds: OpenAISeverityThresholds =
      matrix.categories[key as keyof typeof matrix.categories] ?? matrix.default
    const severity = severityFromThresholds(thresholds, score, flagged)

    if (severity === 'LOW' && !flagged) {
      continue
    }

    normalizedCategories.push({
      key,
      flagged,
      score,
      severity,
      source: 'OPENAI',
    })
  }

  return normalizedCategories.sort(
    (left, right) => severityRank[right.severity] - severityRank[left.severity]
  )
}

const extractLocalTextOverlay = (text: string): CombinedModerationResult => {
  const normalized = normalize(text)
  const priorityMatches = includesAny(
    normalized,
    devotionalModerationPolicy.priorityKeywords
  )

  if (priorityMatches.length > 0) {
    return {
      severity: 'CRITICAL',
      reason: buildTextReason('CRITICAL'),
      normalizedCategories: priorityMatches.map((key) => ({
        key,
        flagged: true,
        score: null,
        severity: 'CRITICAL',
        source: 'LOCAL',
      })),
      rawProviderResult: null,
      providerStatus: 'APPROVED',
    }
  }

  const blockedMatches = includesAny(
    normalized,
    devotionalModerationPolicy.blockedKeywords
  )
  if (blockedMatches.length > 0) {
    return {
      severity: 'HIGH',
      reason: buildTextReason('HIGH'),
      normalizedCategories: blockedMatches.map((key) => ({
        key,
        flagged: true,
        score: null,
        severity: 'HIGH',
        source: 'LOCAL',
      })),
      rawProviderResult: null,
      providerStatus: 'APPROVED',
    }
  }

  const reviewMatches = includesAny(
    normalized,
    devotionalModerationPolicy.reviewKeywords
  )
  if (reviewMatches.length > 0) {
    return {
      severity: 'MEDIUM',
      reason: buildTextReason('MEDIUM'),
      normalizedCategories: reviewMatches.map((key) => ({
        key,
        flagged: true,
        score: null,
        severity: 'MEDIUM',
        source: 'LOCAL',
      })),
      rawProviderResult: null,
      providerStatus: 'APPROVED',
    }
  }

  return {
    severity: 'LOW',
    reason: null,
    normalizedCategories: [],
    rawProviderResult: null,
    providerStatus: 'APPROVED',
  }
}

const buildOpenAIResult = (
  source: 'text' | 'image',
  rawProviderResult: Prisma.InputJsonValue
): CombinedModerationResult => {
  const firstResult = ((rawProviderResult as { results?: unknown[] }).results?.[0] ??
    {}) as OpenAIModerationResult
  const normalizedCategories = normalizeOpenAICategories(source, firstResult)
  const severity = normalizedCategories.reduce<ModerationSeverity>(
    (current, category) => maxSeverity(current, category.severity),
    firstResult.flagged ? 'MEDIUM' : 'LOW'
  )

  return {
    severity,
    reason:
      source === 'text' ? buildTextReason(severity) : buildImageReason(severity),
    normalizedCategories,
    rawProviderResult,
    providerStatus: severity === 'LOW' ? 'APPROVED' : 'REJECTED',
  }
}

const combineModerationResults = (
  openAIResult: CombinedModerationResult,
  localOverlay: CombinedModerationResult,
  source: 'text' | 'image'
): CombinedModerationResult => {
  const severity = maxSeverity(openAIResult.severity, localOverlay.severity)
  const higherPriorityReason =
    severityRank[localOverlay.severity] > severityRank[openAIResult.severity]
      ? localOverlay.reason
      : openAIResult.reason

  return {
    severity,
    reason:
      higherPriorityReason ??
      (source === 'text' ? buildTextReason(severity) : buildImageReason(severity)),
    normalizedCategories: [
      ...openAIResult.normalizedCategories,
      ...localOverlay.normalizedCategories,
    ],
    rawProviderResult: openAIResult.rawProviderResult,
    providerStatus: openAIResult.providerStatus,
  }
}

export const toModerationAuditMetadata = (
  result: CombinedModerationResult
) =>
  ({
  severity: result.severity,
  reason: result.reason,
  provider_status: result.providerStatus,
  normalized_categories: result.normalizedCategories,
  raw_provider_result: result.rawProviderResult,
}) as Prisma.InputJsonValue

export const moderateText = async (text: string): Promise<TextModerationResult> => {
  const openAIResponse = await moderateWithOpenAIText(text)
  const openAIResult = buildOpenAIResult(
    'text',
    openAIResponse as Prisma.InputJsonValue
  )
  const localOverlay = extractLocalTextOverlay(text)
  const result = combineModerationResults(openAIResult, localOverlay, 'text')

  return {
    ...result,
    moderationStatus:
      result.severity === 'MEDIUM'
        ? DevotionalModerationStatus.UNDER_REVIEW
        : result.severity === 'LOW'
          ? DevotionalModerationStatus.CLEAR
          : DevotionalModerationStatus.RESTRICTED,
  }
}

export const moderateImageUpload = async (params: {
  mimeType: string
  data: Buffer
}): Promise<ImageModerationResult> => {
  const openAIResponse = await moderateWithOpenAIImage(params)
  const openAIResult = buildOpenAIResult(
    'image',
    openAIResponse as Prisma.InputJsonValue
  )
  const result = combineModerationResults(
    openAIResult,
    {
      severity: 'LOW',
      reason: null,
      normalizedCategories: [],
      rawProviderResult: null,
      providerStatus: openAIResult.providerStatus,
    },
    'image'
  )

  return {
    ...result,
    attachable: result.severity === 'LOW',
    moderationStatus:
      result.severity === 'LOW'
        ? DevotionalImageModerationStatus.APPROVED
        : DevotionalImageModerationStatus.REJECTED,
  }
}
