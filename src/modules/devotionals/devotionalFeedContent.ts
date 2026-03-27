import {
  DevotionalHookSource,
  DevotionalQualityGateStatus,
} from '@prisma/client'
import { DEVOTIONAL_PREVIEW_MAX_CHARS } from './devotional.policy'

const MIN_HOOK_LENGTH = 45
const MAX_HOOK_LENGTH = 140
const FALLBACK_HOOK_MIN_LENGTH = 80
const FALLBACK_HOOK_MAX_LENGTH = 120
const PREVIEW_MIN_LENGTH = 110
const PREVIEW_MAX_LENGTH = 160

const GENERIC_TITLE_PATTERNS = [
  /\bdevocional(?:\s+de\s+hoy)?\b/i,
  /\breflexi[oó]n\b/i,
  /\bpensamiento\b/i,
  /\bdios\s+es\s+bueno\b/i,
  /\bam[eé]n\b/i,
]

const LOW_INFORMATION_PATTERNS = [
  /^\s*(hola|buen(?:os)?\s+d[ií]as|buenas\s+tardes|buenas\s+noches)\b/i,
  /^\s*(bendiciones|dios\s+te\s+bendiga)\b/i,
  /^\s*(reflexi[oó]n|pensamiento|devocional)\b[:!.\s]*$/i,
]

const verseReferencePattern =
  /^\s*(?:[1-3]\s*)?[A-Za-zÁÉÍÓÚÑÜáéíóúñü.'-]+(?:\s+[A-Za-zÁÉÍÓÚÑÜáéíóúñü.'-]+)*\s+\d{1,3}:\d{1,3}(?:-\d{1,3})?\s*$/u

type SentenceCandidate = {
  raw: string
  cleaned: string
}

export type DerivedDevotionalFeedContent = {
  plainText: string
  previewText: string
  computedHook: string
  optimizedPreviewText: string
  hookSource: DevotionalHookSource
  qualityGateStatus: DevotionalQualityGateStatus
}

export const extractContentOps = (content: unknown): Record<string, unknown>[] => {
  if (Array.isArray(content)) {
    return content.filter(
      (item): item is Record<string, unknown> => !!item && typeof item === 'object'
    )
  }

  if (
    content &&
    typeof content === 'object' &&
    'ops' in content &&
    Array.isArray((content as { ops?: unknown }).ops)
  ) {
    return (content as { ops: unknown[] }).ops.filter(
      (item): item is Record<string, unknown> => !!item && typeof item === 'object'
    )
  }

  return []
}

export const extractPlainText = (content: unknown) => {
  const text = extractContentOps(content)
    .map((op) => {
      if (typeof op.insert === 'string') {
        return op.insert
      }
      return '\n'
    })
    .join('')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()

  return text
}

export const deriveDevotionalFeedContent = (params: {
  title: string
  content: unknown
}): DerivedDevotionalFeedContent => {
  const title = params.title.trim()
  const plainText = extractPlainText(params.content)
  const previewText = buildPreviewTextFromPlainText(plainText)
  const normalizedText = collapseWhitespace(plainText)
  const openingHook = extractOpeningHook(normalizedText)
  const titleStrong = isStrongTitle(title, openingHook ?? undefined)

  let computedHook = ''
  let hookSource: DevotionalHookSource = DevotionalHookSource.CONTENT_TRUNCATION

  if (openingHook) {
    computedHook = openingHook
    hookSource = DevotionalHookSource.CONTENT_OPENING
  } else if (titleStrong) {
    computedHook = trimToWordBoundary(title, MAX_HOOK_LENGTH)
    hookSource = DevotionalHookSource.TITLE_FALLBACK
  } else {
    computedHook = buildFallbackHook(normalizedText)
    hookSource = DevotionalHookSource.CONTENT_TRUNCATION
  }

  const optimizedPreviewText = buildOptimizedPreviewText({
    plainText: normalizedText,
    computedHook,
  })

  const words = normalizedText.split(/\s+/).filter(Boolean)
  const sentenceCount = extractSentenceCandidates(normalizedText).length
  const meaningfulParagraphs = plainText
    .split(/\n{2,}/)
    .map((paragraph) => collapseWhitespace(paragraph))
    .filter((paragraph) => paragraph.length >= 60).length

  const qualityGateStatus = resolveQualityGateStatus({
    plainTextLength: normalizedText.length,
    wordCount: words.length,
    sentenceCount,
    meaningfulParagraphs,
    hookSource,
    titleStrong,
  })

  return {
    plainText: normalizedText,
    previewText,
    computedHook,
    optimizedPreviewText,
    hookSource,
    qualityGateStatus,
  }
}

export const buildPreviewTextFromPlainText = (plainText: string) => {
  const text = collapseWhitespace(plainText)
  if (text.length <= DEVOTIONAL_PREVIEW_MAX_CHARS) {
    return text
  }
  return `${trimToWordBoundary(text, DEVOTIONAL_PREVIEW_MAX_CHARS).trimEnd()}...`
}

export const qualityGateMessageForStatus = (
  status: DevotionalQualityGateStatus
) => {
  switch (status) {
    case DevotionalQualityGateStatus.NEEDS_MORE_REFLECTION:
      return 'Agrega un poco más de reflexión antes de publicarlo.'
    case DevotionalQualityGateStatus.NEEDS_CLEARER_OPENING:
      return 'Tu devocional necesita un inicio más claro para entrar al feed.'
    default:
      return null
  }
}

export const areTextsNearDuplicate = (left: string, right: string) => {
  const normalizedLeft = normalizeForComparison(left)
  const normalizedRight = normalizeForComparison(right)

  if (!normalizedLeft || !normalizedRight) {
    return false
  }

  if (
    normalizedLeft === normalizedRight ||
    normalizedLeft.includes(normalizedRight) ||
    normalizedRight.includes(normalizedLeft)
  ) {
    return true
  }

  const leftTokens = new Set(normalizedLeft.split(' ').filter(Boolean))
  const rightTokens = new Set(normalizedRight.split(' ').filter(Boolean))
  if (leftTokens.size === 0 || rightTokens.size === 0) {
    return false
  }

  let overlap = 0
  for (const token of leftTokens) {
    if (rightTokens.has(token)) {
      overlap += 1
    }
  }

  return overlap / Math.max(leftTokens.size, rightTokens.size) >= 0.8
}

const resolveQualityGateStatus = (params: {
  plainTextLength: number
  wordCount: number
  sentenceCount: number
  meaningfulParagraphs: number
  hookSource: DevotionalHookSource
  titleStrong: boolean
}) => {
  const hasEnoughReflection =
    params.plainTextLength >= 220 &&
    params.wordCount >= 45 &&
    (params.sentenceCount >= 3 || params.meaningfulParagraphs >= 2)

  if (!hasEnoughReflection) {
    return DevotionalQualityGateStatus.NEEDS_MORE_REFLECTION
  }

  if (
    params.hookSource === DevotionalHookSource.CONTENT_TRUNCATION &&
    !params.titleStrong
  ) {
    return DevotionalQualityGateStatus.NEEDS_CLEARER_OPENING
  }

  return DevotionalQualityGateStatus.READY
}

const extractOpeningHook = (plainText: string) => {
  const candidates = extractSentenceCandidates(plainText)

  for (const candidate of candidates) {
    if (
      candidate.cleaned.length >= MIN_HOOK_LENGTH &&
      candidate.cleaned.length <= MAX_HOOK_LENGTH &&
      isMeaningfulPhrase(candidate.cleaned)
    ) {
      return candidate.cleaned
    }
  }

  for (const candidate of candidates) {
    if (
      candidate.cleaned.length >= Math.max(32, MIN_HOOK_LENGTH - 13) &&
      isMeaningfulPhrase(candidate.cleaned)
    ) {
      return trimToWordBoundary(candidate.cleaned, MAX_HOOK_LENGTH)
    }
  }

  return null
}

const buildFallbackHook = (plainText: string) => {
  const cleaned = collapseWhitespace(plainText)
  if (!cleaned) {
    return ''
  }

  if (cleaned.length <= FALLBACK_HOOK_MAX_LENGTH) {
    return cleaned
  }

  const sentenceBreak = cleaned.indexOf('. ')
  if (
    sentenceBreak >= FALLBACK_HOOK_MIN_LENGTH &&
    sentenceBreak <= FALLBACK_HOOK_MAX_LENGTH
  ) {
    return cleaned.slice(0, sentenceBreak + 1).trim()
  }

  return trimToWordBoundary(cleaned, FALLBACK_HOOK_MAX_LENGTH)
}

const buildOptimizedPreviewText = (params: {
  plainText: string
  computedHook: string
}) => {
  const withoutHook = removeLeadingHook(params.plainText, params.computedHook)
  const source = collapseWhitespace(withoutHook)

  if (!source) {
    return ''
  }

  const sentences = extractSentenceCandidates(source).map((item) => item.cleaned)
  if (sentences.length === 0) {
    return appendEllipsisIfNeeded(trimToWordBoundary(source, PREVIEW_MAX_LENGTH))
  }

  let preview = ''
  for (const sentence of sentences) {
    const next = preview ? `${preview} ${sentence}` : sentence
    if (next.length > PREVIEW_MAX_LENGTH) {
      if (preview.length >= PREVIEW_MIN_LENGTH) {
        break
      }
      preview = trimToWordBoundary(next, PREVIEW_MAX_LENGTH)
      break
    }
    preview = next
    if (preview.length >= PREVIEW_MIN_LENGTH) {
      break
    }
  }

  if (!preview) {
    preview = trimToWordBoundary(source, PREVIEW_MAX_LENGTH)
  }

  return appendEllipsisIfNeeded(preview)
}

const removeLeadingHook = (plainText: string, hook: string) => {
  const source = plainText.trim()
  const hookVariants = [hook.trim(), hook.trim().replace(/[.!?…:;,]+$/u, '').trim()]
    .filter(Boolean)

  for (const variant of hookVariants) {
    if (!variant) {
      continue
    }

    const lowerSource = source.toLowerCase()
    const lowerVariant = variant.toLowerCase()
    if (lowerSource.startsWith(lowerVariant)) {
      return source.slice(variant.length).replace(/^[\s,:;.!?…-]+/u, '').trim()
    }
  }

  return source
}

const extractSentenceCandidates = (plainText: string): SentenceCandidate[] => {
  const normalized = plainText
    .replace(/\n{2,}/g, '. ')
    .replace(/\n/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  if (!normalized) {
    return []
  }

  return normalized
    .split(/(?<=[.!?…])\s+/u)
    .map((sentence) => sentence.trim())
    .filter(Boolean)
    .map((raw) => ({
      raw,
      cleaned: cleanSentence(raw),
    }))
    .filter((item) => item.cleaned.length > 0)
}

const cleanSentence = (value: string) =>
  value
    .replace(/[“”"']/g, '')
    .replace(/\s+/g, ' ')
    .trim()

const isStrongTitle = (title: string, hook?: string) => {
  const cleaned = title.trim()
  if (cleaned.length < 18) {
    return false
  }

  if (!containsLetters(cleaned)) {
    return false
  }

  if (GENERIC_TITLE_PATTERNS.some((pattern) => pattern.test(cleaned))) {
    return false
  }

  if (isMostlyEmojiOrPunctuation(cleaned)) {
    return false
  }

  if (isAllCaps(cleaned)) {
    return false
  }

  if (hook && areTextsNearDuplicate(cleaned, hook)) {
    return false
  }

  return true
}

const isMeaningfulPhrase = (value: string) => {
  const cleaned = value.trim()
  if (cleaned.length < 18) {
    return false
  }

  if (verseReferencePattern.test(cleaned)) {
    return false
  }

  if (LOW_INFORMATION_PATTERNS.some((pattern) => pattern.test(cleaned))) {
    return false
  }

  if (isMostlyEmojiOrPunctuation(cleaned) || !containsLetters(cleaned)) {
    return false
  }

  return true
}

const trimToWordBoundary = (value: string, maxLength: number) => {
  if (value.length <= maxLength) {
    return value.trim()
  }

  const sliced = value.slice(0, maxLength + 1)
  const lastSpace = sliced.lastIndexOf(' ')
  if (lastSpace >= Math.floor(maxLength * 0.6)) {
    return sliced.slice(0, lastSpace).trim()
  }

  return value.slice(0, maxLength).trim()
}

const appendEllipsisIfNeeded = (value: string) => {
  const trimmed = value.trim()
  if (!trimmed) {
    return ''
  }

  if (/[.!?…]$/u.test(trimmed)) {
    return `${trimmed}..`
  }

  return `${trimmed}...`
}

const collapseWhitespace = (value: string) =>
  value.replace(/\s+/g, ' ').trim()

const normalizeForComparison = (value: string) =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()

const containsLetters = (value: string) => /\p{L}/u.test(value)

const isMostlyEmojiOrPunctuation = (value: string) => {
  const stripped = value.replace(/[\p{L}\p{N}\s]/gu, '')
  return stripped.length >= Math.ceil(value.trim().length * 0.5)
}

const isAllCaps = (value: string) => {
  const letters = [...value].filter((char) => /\p{L}/u.test(char))
  if (letters.length < 6) {
    return false
  }

  const uppercase = letters.filter((char) => char === char.toUpperCase()).length
  return uppercase / letters.length >= 0.85
}
