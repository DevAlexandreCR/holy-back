import axios from 'axios'
import { z } from 'zod'
import { config } from '../../config/env'
import { DEVOTIONAL_WORDS_PER_MINUTE } from '../devotionals/devotional.policy'
import {
  HOLYVERSO_STYLE_LIBRARY,
  HOLYVERSO_TOPIC_POOL,
  type HolyversoStyleKey,
  type HolyversoTopicKey,
} from './holyverso.constants'

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

type OpenAIImageGenerationResponse = {
  data?: Array<{
    b64_json?: string
  }>
}

const HOLYVERSO_MIN_WORD_COUNT = DEVOTIONAL_WORDS_PER_MINUTE * 1
const HOLYVERSO_MAX_WORD_COUNT = DEVOTIONAL_WORDS_PER_MINUTE * 3
const HOLYVERSO_TARGET_WORD_COUNT_MIN = Math.round(
  DEVOTIONAL_WORDS_PER_MINUTE * 1.3
)
const HOLYVERSO_TARGET_WORD_COUNT_MAX = Math.round(
  DEVOTIONAL_WORDS_PER_MINUTE * 2.2
)
export const HOLYVERSO_BLOCK_MIN_COUNT = 8
export const HOLYVERSO_BLOCK_MAX_COUNT = 14
export const HOLYVERSO_BLOCK_MIN_LENGTH = 15
export const HOLYVERSO_BLOCK_MAX_LENGTH = 260

const textClient = axios.create({
  baseURL: 'https://api.openai.com/v1',
  timeout: config.openai.holyversoTextTimeoutMs,
})

const imageClient = axios.create({
  baseURL: 'https://api.openai.com/v1',
  timeout: config.openai.holyversoImageTimeoutMs,
})

const primaryReferenceSchema = z.object({
  book: z.string().trim().min(1).max(80),
  chapter: z.number().int().positive(),
  verse_start: z.number().int().positive(),
  verse_end: z.number().int().positive().nullable().optional(),
})

export const holyversoGeneratedDevotionalSchema = z.object({
  title: z.string().trim().min(1).max(120),
  content: z
    .array(
      z
        .string()
        .trim()
        .min(HOLYVERSO_BLOCK_MIN_LENGTH)
        .max(HOLYVERSO_BLOCK_MAX_LENGTH)
    )
    .min(HOLYVERSO_BLOCK_MIN_COUNT)
    .max(HOLYVERSO_BLOCK_MAX_COUNT),
  primary_reference: primaryReferenceSchema,
  topic_key: z.string().trim().min(1).max(64),
  image_brief: z.string().trim().min(40).max(600),
})

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

const getTopicDescription = (topicKey: HolyversoTopicKey) =>
  HOLYVERSO_TOPIC_POOL.find((topic) => topic.key === topicKey)?.description ?? topicKey

const getStyleDescription = (styleKey: HolyversoStyleKey) =>
  HOLYVERSO_STYLE_LIBRARY.find((style) => style.key === styleKey)?.description ??
  styleKey

const holyversoGeneratedDevotionalJsonSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    title: {
      type: 'string',
      minLength: 1,
      maxLength: 120,
    },
    content: {
      type: 'array',
      minItems: HOLYVERSO_BLOCK_MIN_COUNT,
      maxItems: HOLYVERSO_BLOCK_MAX_COUNT,
      items: {
        type: 'string',
        minLength: HOLYVERSO_BLOCK_MIN_LENGTH,
        maxLength: HOLYVERSO_BLOCK_MAX_LENGTH,
      },
    },
    primary_reference: {
      type: 'object',
      additionalProperties: false,
      properties: {
        book: { type: 'string', minLength: 1, maxLength: 80 },
        chapter: { type: 'integer', minimum: 1 },
        verse_start: { type: 'integer', minimum: 1 },
        verse_end: {
          anyOf: [{ type: 'integer', minimum: 1 }, { type: 'null' }],
        },
      },
      required: ['book', 'chapter', 'verse_start', 'verse_end'],
    },
    topic_key: {
      type: 'string',
      enum: HOLYVERSO_TOPIC_POOL.map((topic) => topic.key),
    },
    image_brief: {
      type: 'string',
      minLength: 40,
      maxLength: 600,
    },
  },
  required: ['title', 'content', 'primary_reference', 'topic_key', 'image_brief'],
} as const

export const buildHolyversoTextPrompt = (params: {
  topicKey: HolyversoTopicKey
  excludedTopicKeys: HolyversoTopicKey[]
  attemptSeed: string
}) =>
  [
    'You write Christian devotionals for HolyVerso.',
    '',
    'Return JSON only following the schema.',
    '',
    'Hard requirements:',
    '- Language: Spanish for Colombia.',
    '- Tone: natural, warm, pastoral, close, never robotic.',
    '- Address the reader directly in second person whenever it feels natural.',
    '- Write for spoken listening as well as mobile reading.',
    '- Prefer short, natural spoken sentences.',
    '- Avoid dense clauses that become hard to follow in audio.',
    '- The opening must be highly engaging, emotionally sharp, and impossible to confuse with generic Christian copy.',
    '- Open with a first block that names a real emotional state, tension, relief, weariness, or hidden fear without clickbait or manipulation.',
    '- Make the opening sound oral and immediate, naming a believable emotional tension from real life.',
    `- Total devotional body length must stay between ${HOLYVERSO_MIN_WORD_COUNT} and ${HOLYVERSO_MAX_WORD_COUNT} words.`,
    `- Ideal target length is ${HOLYVERSO_TARGET_WORD_COUNT_MIN} to ${HOLYVERSO_TARGET_WORD_COUNT_MAX} words so the text feels complete but not exhausting.`,
    `- Structure the devotional body in ${HOLYVERSO_BLOCK_MIN_COUNT} to ${HOLYVERSO_BLOCK_MAX_COUNT} short blocks inside the content array.`,
    '- Each block should usually be 1 sentence, sometimes 2, and only rarely 3 if a biblical pivot or closing line truly needs it.',
    '- Keep a short-block cadence: punchy, breathable, mobile-friendly, and emotionally progressive.',
    '- Do not merge ideas into dense paragraphs. Each block should carry one clear beat.',
    '- Because this is a short devotional, be concise and selective. Do not overdevelop every idea.',
    '- One clear biblical anchor with a single main verse reference.',
    '- Practical application for daily life.',
    '- Follow this editorial progression, adapted naturally to the topic: recognition -> concrete tension -> hidden inner question -> biblical pivot -> reframing -> practical action -> memorable landing.',
    '- Build escalating specificity through relatable examples, inner conflict, or lived tension instead of abstract teaching.',
    '- Include one explicit inner question, exposed doubt, or silent fear before the biblical answer arrives.',
    '- Use the verse as the turning point that answers the tension. Do not use the verse as decoration.',
    '- Include one compact thesis line that feels memorable and easy to retain.',
    '- End according to the topic: use confrontation plus a micro-action for today when the theme supports it; use comfort, surrender, reflection, or a prayerful landing when the topic is more tender.',
    '- Include a brief final prayer inside the existing content blocks, near the end, without creating extra schema fields or list items.',
    '- A brief natural pivot line is acceptable, but do not use sermon-outline headings or formulaic section labels.',
    '- No hashtags, no emojis, no lists, no sermon outline labels.',
    '- Avoid repeating the exact topic labels in an artificial way.',
    '- Avoid generic churchy filler, sermon-outline exposition, repetitive verse paraphrasing, fake certainty, and promises not grounded in the verse.',
    '- Do not let the call to action sound like motivational content or social-media advice. It must remain pastoral, biblical, and believable.',
    '- End with a concise landing that leaves the reader with clarity, peace, conviction, surrender, or a concrete next step that fits the theme.',
    '',
    `Main topic key: ${params.topicKey}`,
    `Main topic guidance: ${getTopicDescription(params.topicKey)}`,
    `Other topics already used today and must not be the main topic: ${
      params.excludedTopicKeys.length > 0 ? params.excludedTopicKeys.join(', ') : 'none'
    }`,
    `Attempt seed: ${params.attemptSeed}`,
  ].join('\n')

const buildImagePrompt = (params: {
  title: string
  devotionalPlainText: string
  imageBrief: string
  topicKey: HolyversoTopicKey
  styleKey: HolyversoStyleKey
  attemptSeed: string
}) =>
  [
    'Create a vertical devotional cover image for a Christian mobile app.',
    '',
    'Requirements:',
    '- No text, letters, captions, logos, watermarks, UI, or verse typography.',
    '- Safe, reverent, emotionally clear, visually polished.',
    '- The image must feel distinct from previous styles and not generic stock imagery.',
    `- Style direction: ${getStyleDescription(params.styleKey)}`,
    `- Topic key: ${params.topicKey}`,
    `- Attempt seed: ${params.attemptSeed}`,
    '',
    `Title context: ${params.title}`,
    `Image brief: ${params.imageBrief}`,
    'Devotional context:',
    params.devotionalPlainText,
  ].join('\n')

const ensureConfigured = () => {
  if (!config.openai.apiKey || !config.openai.holyversoTextModel) {
    throw new Error('HolyVerso text generation is not configured.')
  }

  if (!config.openai.holyversoImageModel) {
    throw new Error('HolyVerso image generation is not configured.')
  }
}

export const generateHolyversoDevotional = async (params: {
  topicKey: HolyversoTopicKey
  excludedTopicKeys: HolyversoTopicKey[]
  attemptSeed: string
}) => {
  ensureConfigured()

  const response = await textClient.post<OpenAIResponsesApiResponse>(
    '/responses',
    {
      model: config.openai.holyversoTextModel,
      input: buildHolyversoTextPrompt(params),
      text: {
        format: {
          type: 'json_schema',
          name: 'holyverso_devotional',
          strict: true,
          schema: holyversoGeneratedDevotionalJsonSchema,
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
    throw new Error('HolyVerso text generation returned an empty response.')
  }

  const parsed = holyversoGeneratedDevotionalSchema.parse(JSON.parse(output))
  if (parsed.topic_key !== params.topicKey) {
    throw new Error('HolyVerso text generation returned a mismatched topic key.')
  }

  return parsed
}

export const generateHolyversoImage = async (params: {
  title: string
  devotionalPlainText: string
  imageBrief: string
  topicKey: HolyversoTopicKey
  styleKey: HolyversoStyleKey
  attemptSeed: string
}) => {
  ensureConfigured()

  const response = await imageClient.post<OpenAIImageGenerationResponse>(
    '/images/generations',
    {
      model: config.openai.holyversoImageModel,
      prompt: buildImagePrompt(params),
      size: '1536x1024',
    },
    {
      headers: {
        Authorization: `Bearer ${config.openai.apiKey}`,
        'Content-Type': 'application/json',
      },
    }
  )

  const imagePayload = response.data.data?.[0]?.b64_json
  if (!imagePayload) {
    throw new Error('HolyVerso image generation returned no image data.')
  }

  return Buffer.from(imagePayload, 'base64')
}
