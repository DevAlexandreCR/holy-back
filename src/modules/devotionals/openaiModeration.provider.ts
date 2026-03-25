import axios from 'axios'
import { config } from '../../config/env'
import { AppError } from '../../common/errors'

type OpenAIModerationResult = {
  flagged?: boolean
  categories?: Record<string, boolean>
  category_scores?: Record<string, number>
  category_applied_input_types?: Record<string, string[]>
}

type OpenAIModerationResponse = {
  id?: string
  model?: string
  results?: OpenAIModerationResult[]
}

type ModerationInput = Array<Record<string, unknown>>

const moderationClient = axios.create({
  baseURL: 'https://api.openai.com/v1',
  timeout: config.openai.moderationTimeoutMs,
})

const ensureOpenAIConfigured = () => {
  if (!config.openai.apiKey) {
    throw new AppError(
      'OpenAI moderation is unavailable right now.',
      'OPENAI_MODERATION_UNAVAILABLE',
      503,
      {
        provider: 'openai',
        reason: 'missing_api_key',
        model: config.openai.moderationModel,
        timeout_ms: config.openai.moderationTimeoutMs,
      }
    )
  }
}

const createUnavailableError = (details?: unknown) =>
  new AppError(
    'OpenAI moderation is unavailable right now.',
    'OPENAI_MODERATION_UNAVAILABLE',
    503,
    details
  )

const createDataUrl = (mimeType: string, buffer: Buffer) =>
  `data:${mimeType};base64,${buffer.toString('base64')}`

const summarizeInput = (input: ModerationInput) =>
  input.map((item) => {
    if (item.type === 'text') {
      return {
        type: 'text',
        text_length: typeof item.text === 'string' ? item.text.length : 0,
      }
    }

    if (item.type === 'image_url') {
      const rawUrl =
        item.image_url &&
        typeof item.image_url === 'object' &&
        'url' in item.image_url
          ? item.image_url.url
          : null

      const url = typeof rawUrl === 'string' ? rawUrl : ''
      const base64Length = url.includes('base64,') ? url.split('base64,')[1]?.length ?? 0 : 0
      const approxBytes =
        base64Length > 0 ? Math.floor((base64Length * 3) / 4) : null

      return {
        type: 'image_url',
        url_scheme: typeof rawUrl === 'string' ? rawUrl.slice(0, rawUrl.indexOf(':')) : null,
        approx_bytes: approxBytes,
      }
    }

    return {
      type: typeof item.type === 'string' ? item.type : 'unknown',
    }
  })

const serializeAxiosError = (error: unknown) => {
  if (!axios.isAxiosError(error)) {
    return error
  }

  return {
    name: error.name,
    message: error.message,
    code: error.code,
    status: error.response?.status,
    status_text: error.response?.statusText,
    method: error.config?.method?.toUpperCase(),
    url: error.config?.url,
    timeout: error.config?.timeout,
    response_headers: error.response?.headers,
    response_data: error.response?.data,
  }
}

const requestModeration = async (
  input: ModerationInput
): Promise<OpenAIModerationResponse> => {
  ensureOpenAIConfigured()
  const requestContext = {
    provider: 'openai',
    endpoint: '/moderations',
    model: config.openai.moderationModel,
    timeout_ms: config.openai.moderationTimeoutMs,
    input_summary: summarizeInput(input),
  }

  try {
    const response = await moderationClient.post<OpenAIModerationResponse>(
      '/moderations',
      {
        model: config.openai.moderationModel,
        input,
      },
      {
        headers: {
          Authorization: `Bearer ${config.openai.apiKey}`,
          'Content-Type': 'application/json',
        },
      }
    )

    if (!Array.isArray(response.data.results) || response.data.results.length === 0) {
      throw createUnavailableError({
        ...requestContext,
        reason: 'empty_results',
        response_data: response.data,
      })
    }

    return response.data
  } catch (error) {
    if (error instanceof AppError) {
      throw error
    }

    const details = {
      ...requestContext,
      cause: serializeAxiosError(error),
    }

    // eslint-disable-next-line no-console
    console.error('[OpenAIModeration]', details)

    throw createUnavailableError(details)
  }
}

export const moderateWithOpenAIText = async (text: string) =>
  requestModeration([{ type: 'text', text }])

export const moderateWithOpenAIImage = async (params: {
  mimeType: string
  data: Buffer
}) =>
  requestModeration([
    {
      type: 'image_url',
      image_url: {
        url: createDataUrl(params.mimeType, params.data),
      },
    },
  ])
