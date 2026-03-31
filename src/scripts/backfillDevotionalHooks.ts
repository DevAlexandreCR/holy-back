import {
  DevotionalHookSource,
  DevotionalPublicationState,
  Prisma,
} from '@prisma/client'
import { config } from '../config/env'
import { connectToDatabase, disconnectFromDatabase, prisma } from '../config/db'
import {
  buildOptimizedPreviewTextFromPlainText,
  deriveDevotionalFeedContent,
} from '../modules/devotionals/devotionalFeedContent'
import { devotionalHookGenerator } from '../modules/devotionals/devotionalHookGenerator.service'
import { formatPrimaryReferenceLabel } from '../modules/devotionals/devotionalReference'

type CliOptions = {
  dryRun: boolean
  limit: number
}

type BackfillCandidate = {
  id: string
  title: string
  content: unknown
  hookSource: DevotionalHookSource
  hookModel: string | null
  createdAt: Date
  publishedAt: Date | null
  verseReferences: Array<{
    book: string
    chapter: number
    verseStart: number
    verseEnd: number | null
  }>
}

const DEFAULT_LIMIT = 50

const parseCliOptions = (): CliOptions => {
  const args = process.argv.slice(2)
  let dryRun = false
  let limit = DEFAULT_LIMIT

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]

    if (arg === '--dry-run') {
      dryRun = true
      continue
    }

    if (arg.startsWith('--limit=')) {
      limit = parseLimitValue(arg.slice('--limit='.length))
      continue
    }

    if (arg === '--limit') {
      const nextArg = args[index + 1]
      if (!nextArg) {
        throw new Error('Missing value for --limit')
      }
      limit = parseLimitValue(nextArg)
      index += 1
      continue
    }

    throw new Error(`Unknown argument: ${arg}`)
  }

  return { dryRun, limit }
}

const parseLimitValue = (raw: string) => {
  const value = Number(raw)
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`Invalid --limit value: ${raw}`)
  }
  return value
}

const ensureAiHookConfig = () => {
  if (!config.openai.apiKey || !config.openai.devotionalHookModel) {
    throw new Error(
      'Missing OPENAI_API_KEY or OPENAI_DEVOTIONAL_HOOK_MODEL for devotional hook backfill'
    )
  }
}

const baseWhere: Prisma.DevotionalWhereInput = {
  publicationState: {
    in: [
      DevotionalPublicationState.PUBLISHED_LOW_REACH,
      DevotionalPublicationState.TRENDING,
      DevotionalPublicationState.FEATURED,
    ],
  },
  hookModel: null,
  NOT: {
    hookSource: DevotionalHookSource.AI_GENERATED,
  },
}

const selectCandidates = async (limit: number): Promise<BackfillCandidate[]> => {
  const candidates = await prisma.devotional.findMany({
    where: baseWhere,
    orderBy: [
      { publishedAt: 'asc' },
      { createdAt: 'asc' },
      { id: 'asc' },
    ],
    take: limit,
    select: {
      id: true,
      title: true,
      content: true,
      hookSource: true,
      hookModel: true,
      createdAt: true,
      publishedAt: true,
      verseReferences: {
        where: { isPrimary: true },
        orderBy: { createdAt: 'asc' },
        select: {
          book: true,
          chapter: true,
          verseStart: true,
          verseEnd: true,
        },
      },
    },
  })

  return candidates.map((candidate) => ({
    id: candidate.id,
    title: candidate.title,
    content: candidate.content,
    hookSource: candidate.hookSource,
    hookModel: candidate.hookModel,
    createdAt: candidate.createdAt,
    publishedAt: candidate.publishedAt,
    verseReferences: candidate.verseReferences.map((reference) => ({
      book: reference.book,
      chapter: reference.chapter,
      verseStart: reference.verseStart,
      verseEnd: reference.verseEnd,
    })),
  }))
}

const logSummary = (params: {
  dryRun: boolean
  totalCandidates: number
  selectedCandidates: number
  processed: number
  updated: number
  skippedFallback: number
  failed: number
}) => {
  console.log(
    JSON.stringify(
      {
        dry_run: params.dryRun,
        total_candidates: params.totalCandidates,
        selected_candidates: params.selectedCandidates,
        processed: params.processed,
        updated: params.updated,
        skipped_fallback: params.skippedFallback,
        failed: params.failed,
      },
      null,
      2
    )
  )
}

const processCandidate = async (candidate: BackfillCandidate) => {
  const derivedContent = deriveDevotionalFeedContent({
    title: candidate.title,
    content: candidate.content,
  })

  const hookResult = await devotionalHookGenerator.generate({
    title: candidate.title,
    plainText: derivedContent.plainText,
    primaryReference: formatPrimaryReferenceLabel(
      candidate.verseReferences[0] ?? null
    ),
    fallbackHook: derivedContent.computedHook,
    fallbackSource: derivedContent.hookSource,
  })

  if (
    hookResult.usedFallback ||
    hookResult.source !== DevotionalHookSource.AI_GENERATED
  ) {
    console.log(
      JSON.stringify({
        devotional_id: candidate.id,
        title: candidate.title,
        status: 'skipped_fallback',
        error_code: hookResult.errorCode ?? null,
        validation_failure_reason: hookResult.validationFailureReason ?? null,
      })
    )
    return { updated: false, skippedFallback: true }
  }

  const optimizedPreviewText = buildOptimizedPreviewTextFromPlainText({
    plainText: derivedContent.plainText,
    computedHook: hookResult.hook,
  })

  await prisma.devotional.update({
    where: { id: candidate.id },
    data: {
      computedHook: hookResult.hook,
      optimizedPreviewText,
      hookSource: hookResult.source,
      hookModel: hookResult.model,
    },
  })

  console.log(
    JSON.stringify({
      devotional_id: candidate.id,
      title: candidate.title,
      status: 'updated',
      hook_source: hookResult.source,
      hook_model: hookResult.model,
    })
  )

  return { updated: true, skippedFallback: false }
}

const run = async () => {
  let failed = 0

  try {
    const options = parseCliOptions()
    ensureAiHookConfig()

    await connectToDatabase()

    const totalCandidates = await prisma.devotional.count({
      where: baseWhere,
    })
    const candidates = await selectCandidates(options.limit)

    if (options.dryRun) {
      for (const candidate of candidates) {
        console.log(
          JSON.stringify({
            devotional_id: candidate.id,
            title: candidate.title,
            status: 'dry_run',
            current_hook_source: candidate.hookSource,
            current_hook_model: candidate.hookModel,
            published_at: candidate.publishedAt?.toISOString() ?? null,
            created_at: candidate.createdAt.toISOString(),
          })
        )
      }

      logSummary({
        dryRun: true,
        totalCandidates,
        selectedCandidates: candidates.length,
        processed: candidates.length,
        updated: 0,
        skippedFallback: 0,
        failed,
      })
      return
    }

    let processed = 0
    let updated = 0
    let skippedFallback = 0

    for (const candidate of candidates) {
      processed += 1

      try {
        const result = await processCandidate(candidate)
        if (result.updated) {
          updated += 1
        }
        if (result.skippedFallback) {
          skippedFallback += 1
        }
      } catch (error) {
        failed += 1
        const message =
          error instanceof Error ? error.message : 'Unexpected processing error'

        console.error(
          JSON.stringify({
            devotional_id: candidate.id,
            title: candidate.title,
            status: 'failed',
            error_code: 'UNEXPECTED_PROCESSING_ERROR',
            message,
          })
        )
      }
    }

    logSummary({
      dryRun: false,
      totalCandidates,
      selectedCandidates: candidates.length,
      processed,
      updated,
      skippedFallback,
      failed,
    })

    if (failed > 0) {
      process.exitCode = 1
    }
  } catch (error) {
    failed += 1
    console.error(
      'Devotional hook backfill failed',
      error instanceof Error ? error.message : error
    )
    process.exitCode = 1
  } finally {
    await disconnectFromDatabase()
  }
}

void run()
