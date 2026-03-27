import axios from 'axios'
import { DevotionalHookSource } from '@prisma/client'
import { config } from '../../config/env'
import { buildDeterministicHookFallback } from './devotionalFeedContent'

const HOOK_MIN_LENGTH = 80
const HOOK_TARGET_MIN_LENGTH = 120
const HOOK_MAX_LENGTH = 140
const HOOK_MAX_OUTPUT_TOKENS = 120

const CLICKBAIT_PATTERNS = [
  /\bno vas a creer\b/u,
  /\blo que pasa despu[eé]s\b/u,
  /\besto cambiar[aá] tu vida\b/u,
  /\bnadie te dijo\b/u,
  /\bte sorprender[aá]\b/u,
]

const hookClient = axios.create({
  baseURL: 'https://api.openai.com/v1',
  timeout: config.openai.devotionalHookTimeoutMs,
})

const HOOK_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    hook: {
      type: 'string',
      description:
        'A single-sentence devotional feed hook in Spanish (Colombia), faithful to the devotional and close to the maximum allowed length.',
      minLength: HOOK_MIN_LENGTH,
      maxLength: HOOK_MAX_LENGTH,
    },
  },
  required: ['hook'],
} as const

type OpenAIResponseOutputContent = {
  type?: string
  text?: string
  json?: unknown
  parsed?: unknown
}

type OpenAIResponseOutputItem = {
  type?: string
  content?: OpenAIResponseOutputContent[]
}

type OpenAIResponsesApiResponse = {
  output_text?: string
  output?: OpenAIResponseOutputItem[]
}

export type HookInput = {
  title: string
  plainText: string
  primaryReference?: string | null
  fallbackHook?: string
  fallbackSource?: DevotionalHookSource
}

export type HookValidationResult =
  | {
      ok: true
      hook: string
    }
  | {
      ok: false
      reason:
        | 'length'
        | 'sentence_count'
        | 'hashtag'
        | 'quotes'
        | 'emoji'
        | 'clickbait'
        | 'no_letters'
        | 'empty'
        | 'incomplete_sentence'
    }

type HookValidationFailureReason = Extract<
  HookValidationResult,
  { ok: false }
>['reason']

export type HookResult = {
  hook: string
  source: DevotionalHookSource
  model: string | null
  usedFallback: boolean
  latencyMs: number
  validationFailureReason?: HookValidationFailureReason
  errorCode?: string
}

const normalizeForComparison = (value: string) =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()

const normalizeHook = (value: string) =>
  value
    .replace(/^[\s"“”'‘’\-–—•·]+/u, '')
    .replace(/[\s"“”'‘’]+$/u, '')
    .replace(/\s+/g, ' ')
    .trim()

const countSentences = (value: string) => {
  const normalized = value.replace(/\s+/g, ' ').trim()
  if (!normalized) {
    return 0
  }

  return normalized
    .split(/(?<=[.!?…])\s+/u)
    .map((sentence) => sentence.trim())
    .filter(Boolean).length
}

const hasTerminalSentencePunctuation = (value: string) => /[.!?…]$/u.test(value)

const looksIncompleteEnding = (value: string) =>
  /(?:\b(?:y|o|pero|porque|aunque|como|para|con|sin|si|cuando|mientras|que)\b|[:,;\-–—])$/u.test(
    value.trim().replace(/[.!?…]+$/u, '').trim()
  )

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

const finalizeFallbackHook = (value: string) => {
  const normalized = normalizeHook(trimToWordBoundary(value, HOOK_MAX_LENGTH))
  if (!normalized) {
    return ''
  }

  if (hasTerminalSentencePunctuation(normalized)) {
    return normalized
  }

  return `${normalized}.`
}

const resolveFallback = (input: HookInput) => {
  if (input.fallbackHook?.trim()) {
    return {
      hook: finalizeFallbackHook(input.fallbackHook),
      source:
        input.fallbackSource ?? DevotionalHookSource.CONTENT_TRUNCATION,
    }
  }

  const fallback = buildDeterministicHookFallback({
    title: input.title,
    plainText: input.plainText,
  })

  return {
    hook: finalizeFallbackHook(fallback.computedHook),
    source: fallback.hookSource,
  }
}

const buildHookPrompt = (input: HookInput) => {
  const primaryReference = input.primaryReference?.trim() || ''

  return [
    'You are generating a feed hook for a Christian devotional in HolyVerso.',
    '',
    'Return JSON only, following the provided JSON schema.',
    '',
    'Goal:',
    'Write one short feed hook that helps a reader open the devotional.',
    '',
    'Requirements:',
    '- Spanish (Colombia).',
    '- One sentence only.',
    '- Calm, clear, spiritually meaningful, and readable on a mobile feed card.',
    "- Faithful to the devotional's real meaning.",
    '- Create curiosity, but do not fully resolve the devotional in-feed.',
    '- Preserve theological and spiritual meaning.',
    '- Do not invent doctrine, promises, outcomes, blessings, testimony details, or facts not present in the devotional.',
    '- Do not sound like social media growth-hack bait.',
    '- Use as much of the allowed space as needed.',
    `- Prefer ${HOOK_TARGET_MIN_LENGTH}-${HOOK_MAX_LENGTH} characters when a faithful full sentence supports it.`,
    '- Return a full sentence that preserves the main idea.',
    '- Do not shorten the hook for mobile layout.',
    '',
    'Hard rules:',
    '- No emojis.',
    '- No hashtags.',
    '- No quotation marks unless unavoidable.',
    '- No clickbait formulas such as:',
    '  - No vas a creer',
    '  - Lo que pasa después',
    '  - Esto cambiará tu vida',
    '  - Nadie te dijo',
    '  - Te sorprenderá',
    '- Keep it as one complete sentence.',
    '- Prefer a declarative sentence.',
    '- If the devotional is too thin to support a strong hook, still return the most faithful concise hook possible from the provided content.',
    '',
    'Devotional data:',
    `Title: ${input.title.trim()}`,
    `Primary biblical reference: ${primaryReference}`,
    'Body:',
    input.plainText.trim(),
  ].join('\n')
}

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

const extractHook = (response: OpenAIResponsesApiResponse) => {
  const outputText = extractOutputText(response)

  if (!outputText) {
    return null
  }

  try {
    const parsed = JSON.parse(outputText) as { hook?: unknown }
    return typeof parsed.hook === 'string' ? parsed.hook : null
  } catch {
    return null
  }
}

export const validateGeneratedHook = (raw: string): HookValidationResult => {
  const hook = normalizeHook(raw)

  if (!hook) {
    return { ok: false, reason: 'empty' }
  }

  if (hook.length < HOOK_MIN_LENGTH || hook.length > HOOK_MAX_LENGTH) {
    return { ok: false, reason: 'length' }
  }

  if (countSentences(hook) !== 1) {
    return { ok: false, reason: 'sentence_count' }
  }

  if (!hasTerminalSentencePunctuation(hook) || looksIncompleteEnding(hook)) {
    return { ok: false, reason: 'incomplete_sentence' }
  }

  if (/[#]/u.test(hook)) {
    return { ok: false, reason: 'hashtag' }
  }

  if (/["“”'‘’]/u.test(hook)) {
    return { ok: false, reason: 'quotes' }
  }

  if (/\p{Extended_Pictographic}/u.test(hook)) {
    return { ok: false, reason: 'emoji' }
  }

  const comparable = normalizeForComparison(hook)
  if (CLICKBAIT_PATTERNS.some((pattern) => pattern.test(comparable))) {
    return { ok: false, reason: 'clickbait' }
  }

  if (!/\p{L}/u.test(hook)) {
    return { ok: false, reason: 'no_letters' }
  }

  return { ok: true, hook }
}

export class DevotionalHookGeneratorService {
  async generate(input: HookInput): Promise<HookResult> {
    const startedAt = Date.now()
    const fallback = resolveFallback(input)
    const model = config.openai.devotionalHookModel

    if (!config.openai.apiKey || !model) {
      return {
        hook: fallback.hook,
        source: fallback.source,
        model: null,
        usedFallback: true,
        latencyMs: Date.now() - startedAt,
        errorCode: 'HOOK_MODEL_UNAVAILABLE',
      }
    }

    try {
      const response = await hookClient.post<OpenAIResponsesApiResponse>(
        '/responses',
        {
          model,
          store: false,
          temperature: 0.3,
          max_output_tokens: HOOK_MAX_OUTPUT_TOKENS,
          input: buildHookPrompt(input),
          text: {
            format: {
              type: 'json_schema',
              name: 'devotional_feed_hook',
              strict: true,
              schema: HOOK_JSON_SCHEMA,
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

      const hook = extractHook(response.data)
      if (!hook) {
        return {
          hook: fallback.hook,
          source: fallback.source,
          model: null,
          usedFallback: true,
          latencyMs: Date.now() - startedAt,
          errorCode: 'HOOK_RESPONSE_INVALID',
        }
      }

      const validated = validateGeneratedHook(hook)
      if (!validated.ok) {
        return {
          hook: fallback.hook,
          source: fallback.source,
          model: null,
          usedFallback: true,
          latencyMs: Date.now() - startedAt,
          validationFailureReason: validated.reason,
          errorCode: 'HOOK_VALIDATION_FAILED',
        }
      }

      return {
        hook: validated.hook,
        source: DevotionalHookSource.AI_GENERATED,
        model,
        usedFallback: false,
        latencyMs: Date.now() - startedAt,
      }
    } catch (error) {
      const errorCode = axios.isAxiosError(error)
        ? error.code ?? String(error.response?.status ?? 'HOOK_REQUEST_FAILED')
        : 'HOOK_REQUEST_FAILED'

      return {
        hook: fallback.hook,
        source: fallback.source,
        model: null,
        usedFallback: true,
        latencyMs: Date.now() - startedAt,
        errorCode,
      }
    }
  }
}

export const devotionalHookGenerator = new DevotionalHookGeneratorService()
