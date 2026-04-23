import {
  DevotionalPublicationState,
  DevotionalGenerationSource,
  HolyversoGenerationBatchStatus,
  HolyversoGenerationSlotStatus,
  Prisma,
  UserRole,
} from '@prisma/client'
import axios from 'axios'
import { prisma } from '../../config/db'
import { isAppError } from '../../common/errors'
import { config } from '../../config/env'
import { DEVOTIONAL_WORDS_PER_MINUTE } from '../devotionals/devotional.policy'
import { extractPlainText } from '../devotionals/devotionalFeedContent'
import { createDevotional, publishDevotional } from '../devotionals/devotional.service'
import { createDevotionalImageAssetFromBuffer } from '../devotionals/devotionalImageAsset.service'
import { ensureHolyversoUser } from './holyversoAccount.service'
import {
  HOLYVERSO_MAX_RETRIES,
  HOLYVERSO_RETRY_CUTOFF,
  HOLYVERSO_SLOT_TIMES,
  HOLYVERSO_STYLE_LIBRARY,
  HOLYVERSO_TARGET_DAILY_PUBLISH_COUNT,
  HOLYVERSO_TOPIC_POOL,
  type HolyversoStyleKey,
  type HolyversoTopicKey,
} from './holyverso.constants'
import {
  formatHolyversoAttemptSeed,
  buildHolyversoScheduledDate,
  getHolyversoLocalDateKey,
} from './holyverso.time'
import {
  generateHolyversoDevotional,
  generateHolyversoImage,
} from './holyversoOpenAI.service'

const buildContentOps = (paragraphs: string[]) => ({
  ops: paragraphs.flatMap((paragraph, index) =>
    index === paragraphs.length - 1
      ? [{ insert: paragraph.trim() }, { insert: '\n' }]
      : [{ insert: paragraph.trim() }, { insert: '\n\n' }]
  ),
})

const countWords = (content: Prisma.JsonValue) =>
  extractPlainText(content).split(/\s+/).filter(Boolean).length

const HOLYVERSO_MIN_WORD_COUNT = DEVOTIONAL_WORDS_PER_MINUTE * 1
const HOLYVERSO_MAX_WORD_COUNT = DEVOTIONAL_WORDS_PER_MINUTE * 3

const extractAxiosApiError = (error: unknown) => {
  if (!axios.isAxiosError(error)) {
    return null
  }

  const status = error.response?.status ?? null
  const payload = error.response?.data

  if (!payload || typeof payload !== 'object') {
    return {
      status,
      code: null,
      message: error.message,
    }
  }

  const apiError =
    'error' in payload && payload.error && typeof payload.error === 'object'
      ? payload.error
      : payload

  const code =
    'code' in apiError && typeof apiError.code === 'string' ? apiError.code : null
  const message =
    'message' in apiError && typeof apiError.message === 'string'
      ? apiError.message
      : error.message

  return {
    status,
    code,
    message,
  }
}

const normalizeErrorCode = (error: unknown) => {
  if (isAppError(error)) {
    return error.code
  }

  const axiosApiError = extractAxiosApiError(error)
  if (axiosApiError) {
    if (axiosApiError.code) {
      return axiosApiError.code.toUpperCase().replace(/[^A-Z0-9]+/g, '_')
    }

    if (axiosApiError.status) {
      return `AXIOS_${axiosApiError.status}`
    }
  }

  if (error instanceof Error && error.name) {
    return error.name.toUpperCase().replace(/[^A-Z0-9]+/g, '_')
  }

  return 'HOLYVERSO_SLOT_FAILED'
}

const normalizeErrorMessage = (error: unknown) => {
  const axiosApiError = extractAxiosApiError(error)
  if (axiosApiError) {
    const statusPrefix = axiosApiError.status
      ? `OpenAI request failed with status ${axiosApiError.status}`
      : 'OpenAI request failed'

    return `${statusPrefix}: ${axiosApiError.message}`
  }

  if (error instanceof Error && error.message.trim()) {
    return error.message
  }

  return 'HolyVerso slot generation failed.'
}

const isTerminalSlotStatus = (status: HolyversoGenerationSlotStatus) =>
  status === HolyversoGenerationSlotStatus.PUBLISHED ||
  status === HolyversoGenerationSlotStatus.FAILED

const isPendingSlotStatus = (status: HolyversoGenerationSlotStatus) =>
  status === HolyversoGenerationSlotStatus.PLANNED ||
  status === HolyversoGenerationSlotStatus.RETRY_PENDING

const rotateArray = <T>(items: readonly T[], offset: number) => {
  if (items.length === 0) {
    return []
  }

  const normalizedOffset = ((offset % items.length) + items.length) % items.length
  return [...items.slice(normalizedOffset), ...items.slice(0, normalizedOffset)]
}

const dateHash = (value: string) =>
  value.split('').reduce((total, part) => total + part.charCodeAt(0), 0)

const buildDailyTopicKeys = (localDate: string) =>
  rotateArray(HOLYVERSO_TOPIC_POOL, dateHash(localDate))
    .slice(0, HOLYVERSO_TARGET_DAILY_PUBLISH_COUNT)
    .map((topic) => topic.key)

const buildDailyStyleOrder = (localDate: string) =>
  rotateArray(HOLYVERSO_STYLE_LIBRARY, dateHash(localDate) + 3)

const resolveStyleKeyForAttempt = (params: {
  localDate: string
  slotIndex: number
  retryCount: number
}): HolyversoStyleKey => {
  const orderedStyles = buildDailyStyleOrder(params.localDate)
  const index =
    (params.slotIndex +
      params.retryCount * HOLYVERSO_TARGET_DAILY_PUBLISH_COUNT) %
    orderedStyles.length

  return orderedStyles[index].key
}

const buildBatchMetadata = (localDate: string) => {
  const topicKeys = buildDailyTopicKeys(localDate)
  const orderedStyles = buildDailyStyleOrder(localDate)

  return {
    topic_keys: topicKeys,
    style_keys: orderedStyles
      .slice(0, HOLYVERSO_TARGET_DAILY_PUBLISH_COUNT)
      .map((style) => style.key),
    timezone: 'America/Bogota',
  }
}

const buildSlotPlan = (localDate: string) =>
  HOLYVERSO_SLOT_TIMES.map((time, slotIndex) => ({
    slotIndex,
    scheduledFor: buildHolyversoScheduledDate(localDate, time),
    topicKey: buildDailyTopicKeys(localDate)[slotIndex] as HolyversoTopicKey,
    styleKey: resolveStyleKeyForAttempt({
      localDate,
      slotIndex,
      retryCount: 0,
    }),
  }))

const buildRetryCutoffDate = (localDate: string) =>
  buildHolyversoScheduledDate(localDate, HOLYVERSO_RETRY_CUTOFF)

const isAttemptWindowOpen = (localDate: string, now: Date) =>
  now.getTime() < buildRetryCutoffDate(localDate).getTime()

const canScheduleRetry = (localDate: string, now: Date, retryCount: number) =>
  retryCount < HOLYVERSO_MAX_RETRIES && isAttemptWindowOpen(localDate, now)

const syncBatchState = async (batchId: string) => {
  const batch = await prisma.holyversoGenerationBatch.findUnique({
    where: { id: batchId },
    include: {
      slots: {
        select: {
          status: true,
        },
      },
    },
  })

  if (!batch) {
    return null
  }

  const publishedCount = batch.slots.filter(
    (slot) => slot.status === HolyversoGenerationSlotStatus.PUBLISHED
  ).length
  const hasWorkStarted = batch.slots.some(
    (slot) => slot.status !== HolyversoGenerationSlotStatus.PLANNED
  )
  const terminalCount = batch.slots.filter((slot) =>
    isTerminalSlotStatus(slot.status)
  ).length

  let status = batch.status
  let completedAt = batch.completedAt
  let startedAt = batch.startedAt

  if (publishedCount === batch.targetCount) {
    status = HolyversoGenerationBatchStatus.COMPLETED
    startedAt = startedAt ?? new Date()
    completedAt = new Date()
  } else if (terminalCount === batch.targetCount) {
    status =
      publishedCount > 0
        ? HolyversoGenerationBatchStatus.PARTIAL
        : HolyversoGenerationBatchStatus.FAILED
    startedAt = startedAt ?? new Date()
    completedAt = new Date()
  } else if (hasWorkStarted || startedAt) {
    status = HolyversoGenerationBatchStatus.IN_PROGRESS
    startedAt = startedAt ?? new Date()
    completedAt = null
  } else {
    status = HolyversoGenerationBatchStatus.PLANNED
    completedAt = null
  }

  return prisma.holyversoGenerationBatch.update({
    where: { id: batchId },
    data: {
      publishedCount,
      status,
      startedAt,
      completedAt,
    },
  })
}

const markSlotResult = async (params: {
  slotId: string
  batchId: string
  status: HolyversoGenerationSlotStatus
  retryCount?: number
  devotionalId?: string | null
  failureCode?: string | null
  metadata?: Prisma.InputJsonValue
}) => {
  await prisma.holyversoGenerationSlot.update({
    where: { id: params.slotId },
    data: {
      status: params.status,
      retryCount: params.retryCount,
      devotionalId: params.devotionalId ?? null,
      failureCode: params.failureCode ?? null,
      metadata: params.metadata,
    },
  })

  await syncBatchState(params.batchId)
}

const buildSlotMetadata = (params: {
  attemptSeed: string
  styleKey: HolyversoStyleKey
  topicKey: HolyversoTopicKey
  generatedTitle?: string
  failureCode?: string | null
  failureMessage?: string | null
  imageAssetId?: string | null
}) =>
  ({
    attempt_seed: params.attemptSeed,
    topic_key: params.topicKey,
    style_key: params.styleKey,
    generated_title: params.generatedTitle ?? null,
    failure_code: params.failureCode ?? null,
    failure_message: params.failureMessage ?? null,
    image_asset_id: params.imageAssetId ?? null,
  }) satisfies Prisma.InputJsonValue

export const ensureHolyversoDailyBatch = async (now = new Date()) => {
  const author = await ensureHolyversoUser()
  const localDate = getHolyversoLocalDateKey(now)
  const batchMetadata = buildBatchMetadata(localDate)

  await prisma.$transaction(async (tx) => {
    const batch = await tx.holyversoGenerationBatch.upsert({
      where: {
        localDate_authorId: {
          localDate,
          authorId: author.id,
        },
      },
      create: {
        localDate,
        authorId: author.id,
        targetCount: HOLYVERSO_TARGET_DAILY_PUBLISH_COUNT,
        status: HolyversoGenerationBatchStatus.PLANNED,
        metadata: batchMetadata,
      },
      update: {
        targetCount: HOLYVERSO_TARGET_DAILY_PUBLISH_COUNT,
        metadata: batchMetadata,
      },
      select: {
        id: true,
      },
    })

    await tx.holyversoGenerationSlot.createMany({
      data: buildSlotPlan(localDate).map((slot) => ({
        batchId: batch.id,
        slotIndex: slot.slotIndex,
        scheduledFor: slot.scheduledFor,
        topicKey: slot.topicKey,
        styleKey: slot.styleKey,
        status: HolyversoGenerationSlotStatus.PLANNED,
      })),
      skipDuplicates: true,
    })
  })

  return prisma.holyversoGenerationBatch.findUnique({
    where: {
      localDate_authorId: {
        localDate,
        authorId: author.id,
      },
    },
    include: {
      slots: {
        orderBy: {
          slotIndex: 'asc',
        },
      },
    },
  })
}

const processSlot = async (params: {
  slotId: string
  now: Date
}) => {
  const slot = await prisma.holyversoGenerationSlot.findUnique({
    where: { id: params.slotId },
    include: {
      batch: {
        include: {
          author: {
            select: {
              id: true,
              role: true,
            },
          },
          slots: {
            select: {
              id: true,
              topicKey: true,
            },
            orderBy: {
              slotIndex: 'asc',
            },
          },
        },
      },
    },
  })

  if (!slot) {
    return { processed: false, status: 'missing_slot' as const }
  }

  if (!isPendingSlotStatus(slot.status)) {
    return { processed: false, status: 'already_processed' as const }
  }

  if (params.now.getTime() < slot.scheduledFor.getTime()) {
    return { processed: false, status: 'not_due' as const }
  }

  if (!isAttemptWindowOpen(slot.batch.localDate, params.now)) {
    await markSlotResult({
      slotId: slot.id,
      batchId: slot.batchId,
      status: HolyversoGenerationSlotStatus.FAILED,
      retryCount: slot.retryCount,
      failureCode: slot.failureCode ?? 'RETRY_WINDOW_EXPIRED',
      metadata: buildSlotMetadata({
        attemptSeed: formatHolyversoAttemptSeed({
          localDate: slot.batch.localDate,
          slotIndex: slot.slotIndex,
          retryCount: slot.retryCount,
        }),
        topicKey: slot.topicKey as HolyversoTopicKey,
        styleKey: slot.styleKey as HolyversoStyleKey,
        failureCode: slot.failureCode ?? 'RETRY_WINDOW_EXPIRED',
        failureMessage: 'Retry window expired before the slot could be published.',
      }),
    })

    return { processed: true, status: 'expired' as const }
  }

  const styleKey = resolveStyleKeyForAttempt({
    localDate: slot.batch.localDate,
    slotIndex: slot.slotIndex,
    retryCount: slot.retryCount,
  })
  const attemptSeed = formatHolyversoAttemptSeed({
    localDate: slot.batch.localDate,
    slotIndex: slot.slotIndex,
    retryCount: slot.retryCount,
  })
  const excludedTopicKeys = slot.batch.slots
    .filter((candidate) => candidate.id !== slot.id)
    .map((candidate) => candidate.topicKey as HolyversoTopicKey)

  await prisma.holyversoGenerationSlot.update({
    where: { id: slot.id },
    data: {
      status: HolyversoGenerationSlotStatus.PROCESSING,
      styleKey,
      failureCode: null,
      metadata: buildSlotMetadata({
        attemptSeed,
        topicKey: slot.topicKey as HolyversoTopicKey,
        styleKey,
      }),
    },
  })
  await syncBatchState(slot.batchId)

  let createdDevotionalId: string | null = null

  try {
    const generated = await generateHolyversoDevotional({
      topicKey: slot.topicKey as HolyversoTopicKey,
      excludedTopicKeys,
      attemptSeed,
    })
    const content = buildContentOps(generated.content)
    const contentWordCount = countWords(content)

    if (
      contentWordCount < HOLYVERSO_MIN_WORD_COUNT ||
      contentWordCount > HOLYVERSO_MAX_WORD_COUNT
    ) {
      throw new Error(
        `HolyVerso devotional word count fell outside the allowed range (${HOLYVERSO_MIN_WORD_COUNT}-${HOLYVERSO_MAX_WORD_COUNT}). Received ${contentWordCount} words.`
      )
    }

    const devotionalPlainText = extractPlainText(content)
    const generatedImage = await generateHolyversoImage({
      title: generated.title,
      devotionalPlainText,
      imageBrief: generated.image_brief,
      topicKey: generated.topic_key as HolyversoTopicKey,
      styleKey,
      attemptSeed,
    })
    const imageAsset = await createDevotionalImageAssetFromBuffer({
      userId: slot.batch.author.id,
      inputBuffer: generatedImage,
      inputMimeType: 'image/png',
      outputMimeType: 'image/webp',
    })

    if (!imageAsset.attachable) {
      throw new Error(
        imageAsset.moderation_reason ?? 'HolyVerso image moderation rejected the asset.'
      )
    }

    const created = await createDevotional({
      authorId: slot.batch.author.id,
      title: generated.title,
      content,
      imageAssetId: imageAsset.asset.id,
      verseReferences: [
        {
          book: generated.primary_reference.book,
          chapter: generated.primary_reference.chapter,
          verse_start: generated.primary_reference.verse_start,
          verse_end: generated.primary_reference.verse_end ?? undefined,
          is_primary: true,
        },
      ],
      generationSource: DevotionalGenerationSource.HOLYVERSO_AUTOMATED,
      generationMetadata: {
        batch_id: slot.batchId,
        slot_id: slot.id,
        slot_index: slot.slotIndex,
        topic_key: generated.topic_key,
        style_key: styleKey,
        attempt_seed: attemptSeed,
        word_count: contentWordCount,
        openai_text_model: config.openai.holyversoTextModel,
        openai_image_model: config.openai.holyversoImageModel,
      },
    })
    createdDevotionalId = created.id

    await publishDevotional({
      devotionalId: created.id,
      viewerId: slot.batch.author.id,
      viewerRole: slot.batch.author.role ?? UserRole.USER,
    })

    await markSlotResult({
      slotId: slot.id,
      batchId: slot.batchId,
      status: HolyversoGenerationSlotStatus.PUBLISHED,
      retryCount: slot.retryCount,
      devotionalId: created.id,
      metadata: buildSlotMetadata({
        attemptSeed,
        topicKey: generated.topic_key as HolyversoTopicKey,
        styleKey,
        generatedTitle: generated.title,
        imageAssetId: imageAsset.asset.id,
      }),
    })

    return { processed: true, status: 'published' as const, devotionalId: created.id }
  } catch (error) {
    if (createdDevotionalId) {
      const createdDevotional = await prisma.devotional.findUnique({
        where: { id: createdDevotionalId },
        select: {
          publicationState: true,
        },
      })

      if (createdDevotional?.publicationState === DevotionalPublicationState.DRAFT) {
        await prisma.devotional
          .delete({
            where: { id: createdDevotionalId },
          })
          .catch(() => undefined)
      }
    }

    const failureCode = normalizeErrorCode(error)
    const failureMessage = normalizeErrorMessage(error)
    const nextRetryCount = slot.retryCount + 1

    await markSlotResult({
      slotId: slot.id,
      batchId: slot.batchId,
      status: canScheduleRetry(slot.batch.localDate, params.now, slot.retryCount)
        ? HolyversoGenerationSlotStatus.RETRY_PENDING
        : HolyversoGenerationSlotStatus.FAILED,
      retryCount: canScheduleRetry(
        slot.batch.localDate,
        params.now,
        slot.retryCount
      )
        ? nextRetryCount
        : slot.retryCount,
      failureCode,
      metadata: buildSlotMetadata({
        attemptSeed,
        topicKey: slot.topicKey as HolyversoTopicKey,
        styleKey,
        failureCode,
        failureMessage,
      }),
    })

    return { processed: true, status: 'failed' as const, failureCode }
  }
}

export const publishDueHolyversoSlots = async (now = new Date()) => {
  const author = await ensureHolyversoUser()
  const localToday = getHolyversoLocalDateKey(now)

  const slots = await prisma.holyversoGenerationSlot.findMany({
    where: {
      status: {
        in: [
          HolyversoGenerationSlotStatus.PLANNED,
          HolyversoGenerationSlotStatus.RETRY_PENDING,
        ],
      },
      batch: {
        authorId: author.id,
        localDate: {
          lte: localToday,
        },
      },
      scheduledFor: {
        lte: now,
      },
    },
    orderBy: [{ scheduledFor: 'asc' }, { slotIndex: 'asc' }],
    take: HOLYVERSO_TARGET_DAILY_PUBLISH_COUNT,
    select: { id: true },
  })

  let published = 0
  let failed = 0
  let expired = 0

  for (const slot of slots) {
    const result = await processSlot({
      slotId: slot.id,
      now,
    })

    if (result.status === 'published') {
      published += 1
    } else if (result.status === 'failed') {
      failed += 1
    } else if (result.status === 'expired') {
      expired += 1
    }
  }

  return {
    processed: slots.length,
    published,
    failed,
    expired,
  }
}
