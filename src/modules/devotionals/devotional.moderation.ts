import {
  DevotionalImageModerationStatus,
  DevotionalModerationStatus,
} from '@prisma/client'
import { devotionalModerationPolicy } from './devotional.policy'

export type ModerationSeverity = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'

export type TextModerationResult = {
  severity: ModerationSeverity
  moderationStatus: DevotionalModerationStatus
  reason: string | null
  categories: string[]
}

export type ImageModerationResult = {
  attachable: boolean
  moderationStatus: DevotionalImageModerationStatus
  reason: string | null
}

const normalize = (value: string) =>
  value
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')

const includesAny = (source: string, values: readonly string[]) =>
  values.filter((value) => source.includes(normalize(value)))

export const moderateText = (text: string): TextModerationResult => {
  const normalized = normalize(text)
  const priorityMatches = includesAny(
    normalized,
    devotionalModerationPolicy.priorityKeywords
  )

  if (priorityMatches.length > 0) {
    return {
      severity: 'CRITICAL',
      moderationStatus: DevotionalModerationStatus.CLEAR,
      reason: 'El contenido fue bloqueado por una revisión de seguridad.',
      categories: priorityMatches,
    }
  }

  const blockedMatches = includesAny(
    normalized,
    devotionalModerationPolicy.blockedKeywords
  )
  if (blockedMatches.length > 0) {
    return {
      severity: 'HIGH',
      moderationStatus: DevotionalModerationStatus.CLEAR,
      reason: 'El contenido no cumple las políticas de publicación.',
      categories: blockedMatches,
    }
  }

  const reviewMatches = includesAny(
    normalized,
    devotionalModerationPolicy.reviewKeywords
  )
  if (reviewMatches.length > 0) {
    return {
      severity: 'MEDIUM',
      moderationStatus: DevotionalModerationStatus.UNDER_REVIEW,
      reason: 'Tu devocional fue enviado a revisión antes de entrar al feed.',
      categories: reviewMatches,
    }
  }

  return {
    severity: 'LOW',
    moderationStatus: DevotionalModerationStatus.CLEAR,
    reason: null,
    categories: [],
  }
}

export const moderateImageUpload = (): ImageModerationResult => {
  return {
    attachable: true,
    moderationStatus: DevotionalImageModerationStatus.APPROVED,
    reason: null,
  }
}
