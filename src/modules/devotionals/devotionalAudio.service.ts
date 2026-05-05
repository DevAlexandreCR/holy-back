import axios from 'axios'
import crypto from 'crypto'
import { promises as fs } from 'fs'
import path from 'path'
import {
  DevotionalAudioStatus,
  DevotionalModerationStatus,
  Prisma,
} from '@prisma/client'
import { AppError } from '../../common/errors'
import { prisma } from '../../config/db'
import { config } from '../../config/env'
import { extractPlainText } from './devotionalFeedContent'
import { DEVOTIONAL_FEED_ELIGIBLE_STATES } from './devotional.policy'
import { formatPrimaryReferenceLabel } from './devotionalReference'

const DEVOTIONAL_AUDIO_UNAVAILABLE_MESSAGE =
  'Próximamente: estamos preparando esta función para ti.'
const DEVOTIONAL_AUDIO_RETRY_AFTER_MS = 2500
const DEVOTIONAL_AUDIO_STORAGE_ROOT = path.join(
  process.cwd(),
  'storage',
  'devotionals',
  'audio',
)
const DEVOTIONAL_AUDIO_TTS_INSTRUCTIONS = [
  'Narrate in Colombian Spanish with a calm, reverent, warm, and spiritually grounded tone.',
  'Keep a deep reflective pacing, with natural pauses between ideas.',
  'Do not sound theatrical, rushed, commercial, or overly emotional.',
  'Do not add words that are not present in the input.',
].join(' ')

const openaiAudioClient = axios.create({
  baseURL: 'https://api.openai.com/v1',
  timeout: config.openai.devotionalAudioTimeoutMs,
})

type DevotionalAudioSegment = {
  order: number
  url: string
  duration_ms: number | null
  chars: number
}

type DevotionalAudioRequestResult =
  | {
      status: 'READY'
      segments: DevotionalAudioSegment[]
    }
  | {
      status: 'GENERATING'
      retryAfterMs: number
    }

type DevotionalNarrationSource = {
  title: string
  primaryReferenceLabel: string | null
  plainContent: string
}

const normalizeNarrationText = (value: string) =>
  value
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim()

const splitIntoSentences = (value: string) => {
  const matches = value.match(/[^.!?…]+[.!?…]?(?=\s|$)/gu)
  if (!matches) {
    return [normalizeNarrationText(value)].filter(Boolean)
  }

  return matches.map((part) => normalizeNarrationText(part)).filter(Boolean)
}

const splitOversizedPiece = (value: string, maxChars: number) => {
  if (value.length <= maxChars) {
    return [value]
  }

  const words = value.split(/\s+/).filter(Boolean)
  const parts: string[] = []
  let current = ''

  const flush = () => {
    if (!current) {
      return
    }

    parts.push(current)
    current = ''
  }

  for (const word of words) {
    if (word.length > maxChars) {
      flush()
      for (let index = 0; index < word.length; index += maxChars) {
        parts.push(word.slice(index, index + maxChars))
      }
      continue
    }

    const candidate = current ? `${current} ${word}` : word
    if (candidate.length <= maxChars) {
      current = candidate
      continue
    }

    flush()
    current = word
  }

  flush()
  return parts
}

const pushChunkPiece = (params: {
  current: string
  piece: string
  maxChars: number
  chunks: string[]
}) => {
  const normalizedPiece = normalizeNarrationText(params.piece)
  if (!normalizedPiece) {
    return params.current
  }

  const candidate = params.current
    ? `${params.current}\n\n${normalizedPiece}`
    : normalizedPiece

  if (candidate.length <= params.maxChars) {
    return candidate
  }

  if (params.current) {
    params.chunks.push(params.current)
  }

  return normalizedPiece
}

const isPubliclyVisible = (devotional: {
  publicationState: (typeof DEVOTIONAL_FEED_ELIGIBLE_STATES)[number] | string
  moderationStatus: DevotionalModerationStatus
}) =>
  DEVOTIONAL_FEED_ELIGIBLE_STATES.some(
    (state) => state === devotional.publicationState,
  ) && devotional.moderationStatus === DevotionalModerationStatus.CLEAR

const parseSegments = (value: Prisma.JsonValue | null): DevotionalAudioSegment[] => {
  if (!Array.isArray(value)) {
    return []
  }

  return value.flatMap((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      return []
    }

    const segment = item as Record<string, unknown>
    const order =
      typeof segment.order === 'number' && Number.isFinite(segment.order)
        ? segment.order
        : null
    const url = typeof segment.url === 'string' ? segment.url : null
    const chars =
      typeof segment.chars === 'number' && Number.isFinite(segment.chars)
        ? segment.chars
        : null
    const durationMs =
      segment.duration_ms == null
        ? null
        : typeof segment.duration_ms === 'number' &&
            Number.isFinite(segment.duration_ms)
        ? segment.duration_ms
        : null

    if (order == null || url == null || chars == null) {
      return []
    }

    return [
      {
        order,
        url,
        duration_ms: durationMs,
        chars,
      },
    ]
  })
}

const trimFailureMessage = (value: string) => value.slice(0, 500)

const normalizeGenerationFailure = (error: unknown) => {
  if (axios.isAxiosError(error)) {
    const status = error.response?.status
    const responseData =
      error.response?.data && typeof error.response.data === 'object'
        ? (error.response.data as Record<string, unknown>)
        : null
    const errorPayload =
      responseData?.error && typeof responseData.error === 'object'
        ? (responseData.error as Record<string, unknown>)
        : responseData
    const code =
      typeof errorPayload?.code === 'string'
        ? errorPayload.code
        : status
        ? `OPENAI_AUDIO_${status}`
        : 'OPENAI_AUDIO_REQUEST_FAILED'
    const message =
      typeof errorPayload?.message === 'string'
        ? errorPayload.message
        : error.message

    return {
      code,
      message: trimFailureMessage(message),
    }
  }

  if (error instanceof AppError) {
    return {
      code: error.code,
      message: trimFailureMessage(error.message),
    }
  }

  if (error instanceof Error) {
    return {
      code: 'DEVOTIONAL_AUDIO_GENERATION_FAILED',
      message: trimFailureMessage(error.message),
    }
  }

  return {
    code: 'DEVOTIONAL_AUDIO_GENERATION_FAILED',
    message: 'Unknown devotional audio generation failure.',
  }
}

const isAudioCacheUniqueError = (error: unknown) =>
  error instanceof Prisma.PrismaClientKnownRequestError &&
  error.code === 'P2002'

const ensureAudioEnabled = () => {
  if (!config.openai.devotionalAudioEnabled) {
    throw new AppError(
      DEVOTIONAL_AUDIO_UNAVAILABLE_MESSAGE,
      'DEVOTIONAL_AUDIO_DISABLED',
      503,
    )
  }
}

const ensureNarrationLength = (text: string) => {
  if (text.length > config.openai.devotionalAudioMaxChars) {
    throw new AppError(
      'This devotional is too long for audio generation.',
      'DEVOTIONAL_AUDIO_TOO_LONG',
      422,
    )
  }
}

const loadNarratableDevotional = async (devotionalId: string) => {
  const devotional = await prisma.devotional.findUnique({
    where: { id: devotionalId },
    select: {
      id: true,
      authorId: true,
      title: true,
      content: true,
      publicationState: true,
      moderationStatus: true,
      verseReferences: {
        where: { isPrimary: true },
        orderBy: { createdAt: 'asc' },
        take: 1,
        select: {
          book: true,
          chapter: true,
          verseStart: true,
          verseEnd: true,
        },
      },
    },
  })

  if (!devotional) {
    throw new AppError('Devotional not found', 'DEVOTIONAL_NOT_FOUND', 404)
  }

  return devotional
}

const buildAudioDirectory = (devotionalId: string, narrationHash: string) =>
  path.join(DEVOTIONAL_AUDIO_STORAGE_ROOT, devotionalId, narrationHash)

const buildSegmentUrl = (
  devotionalId: string,
  narrationHash: string,
  filename: string,
) => `/storage/devotionals/audio/${devotionalId}/${narrationHash}/${filename}`

const claimAudioGeneration = async (params: {
  devotionalId: string
  voice: string
  model: string
  narrationHash: string
}) => {
  const existing = await prisma.devotionalAudioAsset.findUnique({
    where: {
      devotionalId_voice_model_narrationHash: {
        devotionalId: params.devotionalId,
        voice: params.voice,
        model: params.model,
        narrationHash: params.narrationHash,
      },
    },
  })

  if (!existing) {
    try {
      const created = await prisma.devotionalAudioAsset.create({
        data: {
          devotionalId: params.devotionalId,
          voice: params.voice,
          model: params.model,
          narrationHash: params.narrationHash,
          status: DevotionalAudioStatus.GENERATING,
        },
      })

      return { shouldGenerate: true, assetId: created.id } as const
    } catch (error) {
      if (isAudioCacheUniqueError(error)) {
        return claimAudioGeneration(params)
      }
      throw error
    }
  }

  if (existing.status === DevotionalAudioStatus.READY) {
    const segments = parseSegments(existing.segments)
    if (segments.length > 0) {
      return { shouldGenerate: false, status: 'READY', segments } as const
    }
  }

  if (existing.status === DevotionalAudioStatus.GENERATING) {
    return {
      shouldGenerate: false,
      status: 'GENERATING',
      retryAfterMs: DEVOTIONAL_AUDIO_RETRY_AFTER_MS,
    } as const
  }

  const claimed = await prisma.devotionalAudioAsset.updateMany({
    where: {
      id: existing.id,
      status: {
        in: [DevotionalAudioStatus.FAILED, DevotionalAudioStatus.READY],
      },
    },
    data: {
      status: DevotionalAudioStatus.GENERATING,
      segments: Prisma.DbNull,
      failureCode: null,
      failureMessage: null,
      completedAt: null,
    },
  })

  if (claimed.count > 0) {
    return { shouldGenerate: true, assetId: existing.id } as const
  }

  return claimAudioGeneration(params)
}

const persistAudioFailure = async (params: {
  assetId: string
  devotionalId: string
  narrationHash: string
  error: unknown
}) => {
  const failure = normalizeGenerationFailure(params.error)

  await fs.rm(
    buildAudioDirectory(params.devotionalId, params.narrationHash),
    { recursive: true, force: true },
  )

  await prisma.devotionalAudioAsset.update({
    where: { id: params.assetId },
    data: {
      status: DevotionalAudioStatus.FAILED,
      failureCode: failure.code,
      failureMessage: failure.message,
      completedAt: new Date(),
    },
  })
}

const generateNarrationSegments = async (params: {
  devotionalId: string
  narrationHash: string
  chunks: string[]
}) => {
  const outputDir = buildAudioDirectory(params.devotionalId, params.narrationHash)
  await fs.rm(outputDir, { recursive: true, force: true })
  await fs.mkdir(outputDir, { recursive: true })

  const segments: DevotionalAudioSegment[] = []

  for (const [index, chunk] of params.chunks.entries()) {
    const filename = `${String(index + 1).padStart(3, '0')}.mp3`
    const outputPath = path.join(outputDir, filename)
    const response = await openaiAudioClient.post<ArrayBuffer>(
      '/audio/speech',
      {
        model: config.openai.devotionalAudioModel,
        voice: config.openai.devotionalAudioVoice,
        input: chunk,
        instructions: DEVOTIONAL_AUDIO_TTS_INSTRUCTIONS,
        response_format: 'mp3',
      },
      {
        responseType: 'arraybuffer',
        headers: {
          Authorization: `Bearer ${config.openai.apiKey}`,
          'Content-Type': 'application/json',
        },
      },
    )

    await fs.writeFile(outputPath, Buffer.from(response.data))
    segments.push({
      order: index + 1,
      url: buildSegmentUrl(params.devotionalId, params.narrationHash, filename),
      duration_ms: null,
      chars: chunk.length,
    })
  }

  return segments
}

export const getDevotionalAudioConfig = () => ({
  enabled: config.openai.devotionalAudioEnabled,
  unavailable_message: DEVOTIONAL_AUDIO_UNAVAILABLE_MESSAGE,
})

export const buildDevotionalNarrationText = (
  source: DevotionalNarrationSource,
) =>
  [source.title, source.primaryReferenceLabel, source.plainContent]
    .map((part) => normalizeNarrationText(part ?? ''))
    .filter(Boolean)
    .join('\n\n')

export const buildDevotionalNarrationHash = (value: string) =>
  crypto.createHash('sha256').update(value, 'utf8').digest('hex')

export const chunkNarrationText = (value: string, maxChars: number) => {
  if (maxChars <= 0) {
    throw new Error('maxChars must be greater than zero')
  }

  const paragraphs = value
    .split(/\n{2,}/)
    .map((paragraph) => normalizeNarrationText(paragraph))
    .filter(Boolean)
  const chunks: string[] = []
  let current = ''

  for (const paragraph of paragraphs) {
    if (paragraph.length <= maxChars) {
      current = pushChunkPiece({ current, piece: paragraph, maxChars, chunks })
      continue
    }

    for (const sentence of splitIntoSentences(paragraph)) {
      if (sentence.length <= maxChars) {
        current = pushChunkPiece({ current, piece: sentence, maxChars, chunks })
        continue
      }

      for (const part of splitOversizedPiece(sentence, maxChars)) {
        current = pushChunkPiece({ current, piece: part, maxChars, chunks })
      }
    }
  }

  if (current) {
    chunks.push(current)
  }

  return chunks
}

export const buildNarrationSourceFromDevotional = (devotional: {
  title: string
  content: Prisma.JsonValue
  verseReferences: Array<{
    book: string
    chapter: number
    verseStart: number
    verseEnd: number | null
  }>
}): DevotionalNarrationSource => ({
  title: devotional.title.trim(),
  primaryReferenceLabel:
    formatPrimaryReferenceLabel(devotional.verseReferences[0] ?? null) ?? null,
  plainContent: extractPlainText(devotional.content),
})

export const requestDevotionalAudio = async (params: {
  devotionalId: string
  userId: string
}): Promise<DevotionalAudioRequestResult> => {
  ensureAudioEnabled()

  const devotional = await loadNarratableDevotional(params.devotionalId)
  const isOwner = devotional.authorId === params.userId

  if (!isOwner && !isPubliclyVisible(devotional)) {
    throw new AppError('Devotional not found', 'DEVOTIONAL_NOT_FOUND', 404)
  }

  const narrationSource = buildNarrationSourceFromDevotional(devotional)
  const narrationText = buildDevotionalNarrationText(narrationSource)
  ensureNarrationLength(narrationText)

  const narrationHash = buildDevotionalNarrationHash(narrationText)
  const chunks = chunkNarrationText(
    narrationText,
    config.openai.devotionalAudioChunkMaxChars,
  )

  const claimed = await claimAudioGeneration({
    devotionalId: devotional.id,
    voice: config.openai.devotionalAudioVoice,
    model: config.openai.devotionalAudioModel,
    narrationHash,
  })

  if (!claimed.shouldGenerate) {
    if (claimed.status === 'READY') {
      return {
        status: 'READY',
        segments: claimed.segments,
      }
    }

    return {
      status: 'GENERATING',
      retryAfterMs: claimed.retryAfterMs,
    }
  }

  try {
    const segments = await generateNarrationSegments({
      devotionalId: devotional.id,
      narrationHash,
      chunks,
    })

    await prisma.devotionalAudioAsset.update({
      where: { id: claimed.assetId },
      data: {
        status: DevotionalAudioStatus.READY,
        segments: segments as Prisma.InputJsonValue,
        failureCode: null,
        failureMessage: null,
        completedAt: new Date(),
      },
    })

    return {
      status: 'READY',
      segments,
    }
  } catch (error) {
    await persistAudioFailure({
      assetId: claimed.assetId,
      devotionalId: devotional.id,
      narrationHash,
      error,
    })

    if (error instanceof AppError) {
      throw error
    }

    throw new AppError(
      'Could not generate devotional audio.',
      'DEVOTIONAL_AUDIO_GENERATION_FAILED',
      502,
    )
  }
}
