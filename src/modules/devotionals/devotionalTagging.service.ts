import axios from 'axios'
import {
  DevotionalModerationStatus,
  DevotionalPublicationState,
  Prisma,
} from '@prisma/client'
import { config } from '../../config/env'
import { prisma } from '../../config/db'
import { extractPlainText } from './devotionalFeedContent'
import {
  findMatchingDevotionalTagName,
  normalizeDevotionalTagValue,
  type DevotionalTagKey,
} from './devotionalTagDictionary'

const MAX_ASSIGNED_TAGS = 3

const tagClient = axios.create({
  baseURL: 'https://api.openai.com/v1',
  timeout: config.openai.devotionalTagTimeoutMs,
})

const splitNormalizedWords = (value: string) =>
  normalizeDevotionalTagValue(value)
    .split(/[^a-z0-9]+/u)
    .map((part) => part.trim())
    .filter(Boolean)

const FALLBACK_KEYWORDS: Record<DevotionalTagKey, string[]> = {
  esperanza: ['esperanza', 'esperar', 'animo', 'promesa', 'consuelo'],
  ansiedad: ['ansiedad', 'afan', 'angustia', 'preocupacion', 'cansancio'],
  proposito: ['proposito', 'llamado', 'sentido', 'direccion', 'vocacion'],
  disciplina: ['disciplina', 'constancia', 'habito', 'rutina', 'perseverancia'],
  fe: ['fe', 'confiar', 'confianza', 'creer', 'fidelidad'],
  trabajo: ['trabajo', 'labor', 'empleo', 'oficio', 'jornada'],
  relaciones: ['relacion', 'relaciones', 'amistad', 'amistades', 'convivencia'],
  oracion: ['oracion', 'orar', 'orando', 'clamar', 'intercesion'],
  descanso: ['descanso', 'reposo', 'quietud', 'fatiga', 'pausa'],
  perdon: ['perdon', 'perdonar', 'rencor', 'ofensa', 'reconciliacion'],
  gratitud: ['gratitud', 'agradecimiento', 'gracias', 'agradecer', 'contentamiento'],
  sabiduria: ['sabiduria', 'prudencia', 'discernimiento', 'entendimiento', 'consejo'],
  identidad: ['identidad', 'valor', 'pertenencia', 'aceptado', 'aceptada'],
  sanidad: ['sanidad', 'sanar', 'restauracion', 'enfermedad', 'herida'],
  soledad: ['soledad', 'solo', 'sola', 'abandono', 'aislamiento'],
  duelo: ['duelo', 'perdida', 'luto', 'ausencia', 'llorar'],
  familia: ['familia', 'hogar', 'padres', 'madre', 'hijos'],
  matrimonio: ['matrimonio', 'esposo', 'esposa', 'pareja', 'conyuge'],
  provision: ['provision', 'proveer', 'sustento', 'escasez', 'necesidad'],
  obediencia: ['obediencia', 'obedecer', 'mandato', 'mandamiento', 'sumision'],
}

type OpenAIResponseOutputContent = {
  text?: string
  json?: unknown
  parsed?: unknown
}

type OpenAIResponseOutputItem = {
  content?: OpenAIResponseOutputContent[]
}

type OpenAIResponsesApiResponse = {
  output_text?: string
  output?: OpenAIResponseOutputItem[]
}

const isPubliclyEligible = (devotional: {
  publicationState: DevotionalPublicationState
  moderationStatus: DevotionalModerationStatus
}) =>
  devotional.moderationStatus === DevotionalModerationStatus.CLEAR &&
  [
    DevotionalPublicationState.PUBLISHED_LOW_REACH,
    DevotionalPublicationState.TRENDING,
    DevotionalPublicationState.FEATURED,
  ].some((state) => state === devotional.publicationState)

const extractOutputText = (response: OpenAIResponsesApiResponse) => {
  if (typeof response.output_text === 'string' && response.output_text.trim()) {
    return response.output_text
  }

  for (const item of response.output ?? []) {
    for (const content of item.content ?? []) {
      if (typeof content.text === 'string' && content.text.trim()) {
        return content.text
      }

      if (content.parsed && typeof content.parsed === 'object') {
        return JSON.stringify(content.parsed)
      }

      if (content.json && typeof content.json === 'object') {
        return JSON.stringify(content.json)
      }
    }
  }

  return null
}

const buildFallbackTags = (params: {
  title: string
  plainText: string
  availableTagNames: string[]
}) => {
  const words = splitNormalizedWords(`${params.title} ${params.plainText}`)
  const wordSet = new Set(words)
  const scored = params.availableTagNames
    .map((tagName) => {
      const normalizedTag = normalizeDevotionalTagValue(tagName) as DevotionalTagKey
      const keywords = FALLBACK_KEYWORDS[normalizedTag] ?? [normalizedTag]
      const score = keywords.reduce(
        (total, keyword) =>
          total + (wordSet.has(normalizeDevotionalTagValue(keyword)) ? 1 : 0),
        wordSet.has(normalizedTag) ? 2 : 0
      )

      return {
        tagName,
        score,
      }
    })
    .filter((item) => item.score > 0)
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score
      }

      return left.tagName.localeCompare(right.tagName)
    })

  return scored.slice(0, MAX_ASSIGNED_TAGS).map((item) => item.tagName)
}

const buildPrompt = (params: {
  title: string
  plainText: string
  tagNames: string[]
}) =>
  [
    'You classify Christian devotionals into a closed Spanish tag dictionary.',
    '',
    'Return JSON only following the supplied schema.',
    '',
    'Rules:',
    '- Spanish tags only.',
    '- Choose only tags from the provided dictionary.',
    '- Select at most 3 tags.',
    '- Prefer the devotional’s real emotional/spiritual theme, not surface wording.',
    '- If no tag is a good fit, return an empty array.',
    '',
    `Dictionary: ${params.tagNames.join(', ')}`,
    '',
    `Title: ${params.title.trim()}`,
    'Body:',
    params.plainText.trim(),
  ].join('\n')

const resolveOpenAITags = async (params: {
  title: string
  plainText: string
  availableTagNames: string[]
}) => {
  if (!config.openai.apiKey || !config.openai.devotionalTagModel) {
    return null
  }

  const response = await tagClient.post<OpenAIResponsesApiResponse>(
    '/responses',
    {
      model: config.openai.devotionalTagModel,
      input: buildPrompt({
        title: params.title,
        plainText: params.plainText,
        tagNames: params.availableTagNames,
      }),
      text: {
        format: {
          type: 'json_schema',
          name: 'devotional_tags',
          strict: true,
          schema: {
            type: 'object',
            additionalProperties: false,
            properties: {
              tags: {
                type: 'array',
                items: {
                  type: 'string',
                  enum: params.availableTagNames,
                },
                uniqueItems: true,
                maxItems: MAX_ASSIGNED_TAGS,
              },
            },
            required: ['tags'],
          },
        },
      },
    },
    {
      headers: {
        Authorization: `Bearer ${config.openai.apiKey}`,
        'Content-Type': 'application/json',
      },
    }
  )

  const output = extractOutputText(response.data)
  if (!output) {
    return null
  }

  try {
    const parsed = JSON.parse(output) as { tags?: unknown }
    if (!Array.isArray(parsed.tags)) {
      return null
    }

    return parsed.tags
      .filter((value): value is string => typeof value === 'string')
      .filter((value, index, values) => values.indexOf(value) === index)
      .filter((value) => params.availableTagNames.includes(value))
      .slice(0, MAX_ASSIGNED_TAGS)
  } catch {
    return null
  }
}

const selectTagNames = async (params: {
  title: string
  plainText: string
  availableTagNames: string[]
}) => {
  try {
    const openAITags = await resolveOpenAITags(params)
    if (openAITags) {
      return openAITags
    }
  } catch (error) {
    console.warn('[DevotionalTagging] OpenAI tagging failed, using fallback', {
      error,
    })
  }

  return buildFallbackTags(params)
}

const extractPrimaryTopicKey = (value: Prisma.JsonValue | null) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null
  }

  const topicKey = (value as Record<string, unknown>).topic_key
  return typeof topicKey === 'string' && topicKey.trim() ? topicKey.trim() : null
}

export const assignDevotionalTags = async (params: {
  devotionalId: string
  force?: boolean
  db?: Prisma.TransactionClient | typeof prisma
}) => {
  const db = params.db ?? prisma
  const devotional = await db.devotional.findUnique({
    where: { id: params.devotionalId },
    select: {
      id: true,
      title: true,
      content: true,
      publicationState: true,
      moderationStatus: true,
      generationMetadata: true,
    },
  })

  if (!devotional || !isPubliclyEligible(devotional)) {
    return {
      devotionalId: params.devotionalId,
      assigned: 0,
      skipped: 'not_publicly_eligible',
    }
  }

  const existingAssignments = await db.devotionalTagAssignment.count({
    where: { devotionalId: params.devotionalId },
  })

  if (existingAssignments > 0 && !params.force) {
    return {
      devotionalId: params.devotionalId,
      assigned: existingAssignments,
      skipped: 'already_tagged',
    }
  }

  const availableTags = await db.devotionalTag.findMany({
    orderBy: { name: 'asc' },
    select: {
      id: true,
      name: true,
    },
  })

  if (availableTags.length === 0) {
    return {
      devotionalId: params.devotionalId,
      assigned: 0,
      skipped: 'missing_dictionary',
    }
  }

  const selectedTagNames = await selectTagNames({
    title: devotional.title,
    plainText: extractPlainText(devotional.content),
    availableTagNames: availableTags.map((item) => item.name),
  })
  const primaryTopicKey = extractPrimaryTopicKey(devotional.generationMetadata)
  const primaryTopicTagName = findMatchingDevotionalTagName(
    availableTags.map((item) => item.name),
    primaryTopicKey
  )
  const mergedTagNames = [
    ...(primaryTopicTagName ? [primaryTopicTagName] : []),
    ...selectedTagNames,
  ]
    .filter((value, index, values) => values.indexOf(value) === index)
    .slice(0, MAX_ASSIGNED_TAGS)
  const selectedTags = availableTags.filter((item) =>
    mergedTagNames.includes(item.name)
  )

  await db.devotionalTagAssignment.deleteMany({
    where: { devotionalId: params.devotionalId },
  })

  if (selectedTags.length > 0) {
    await db.devotionalTagAssignment.createMany({
      data: selectedTags.map((tag) => ({
        devotionalId: params.devotionalId,
        tagId: tag.id,
      })),
      skipDuplicates: true,
    })
  }

  return {
    devotionalId: params.devotionalId,
    assigned: selectedTags.length,
    skipped: null,
  }
}

export const triggerDevotionalTagAssignment = async (devotionalId: string) => {
  try {
    return await assignDevotionalTags({ devotionalId })
  } catch (error) {
    console.error('[DevotionalTagging] Tag assignment failed', {
      devotionalId,
      error,
    })
    return {
      devotionalId,
      assigned: 0,
      skipped: 'tagging_failed',
    }
  }
}

export const backfillDevotionalTags = async (limit = 100) => {
  const devotionals = await prisma.devotional.findMany({
    where: {
      publicationState: {
        in: [
          DevotionalPublicationState.PUBLISHED_LOW_REACH,
          DevotionalPublicationState.TRENDING,
          DevotionalPublicationState.FEATURED,
        ],
      },
      moderationStatus: DevotionalModerationStatus.CLEAR,
      tagAssignments: {
        none: {},
      },
    },
    orderBy: [{ publishedAt: 'desc' }, { id: 'desc' }],
    take: limit,
    select: { id: true },
  })

  let processed = 0
  let tagged = 0

  for (const devotional of devotionals) {
    processed += 1
    const result = await triggerDevotionalTagAssignment(devotional.id)
    if (result.assigned > 0) {
      tagged += 1
    }
  }

  return {
    processed,
    tagged,
  }
}
