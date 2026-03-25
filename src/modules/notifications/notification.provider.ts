import axios from 'axios'
import { JWT } from 'google-auth-library'
import { config } from '../../config/env'

type SendPushMessageParams = {
  token: string
  title: string
  body: string
  imageUrl?: string | null
  data: Record<string, string>
}

type SendPushMessageResult = {
  providerAccepted: boolean
  providerMessageId?: string | null
  failureCode?: string | null
  shouldDeactivateToken?: boolean
}

let cachedAccessToken: { token: string; expiresAt: number } | null = null

const getAccessToken = async () => {
  if (!config.notifications.isConfigured) {
    return null
  }

  if (
    cachedAccessToken &&
    cachedAccessToken.expiresAt > Date.now() + 60 * 1000
  ) {
    return cachedAccessToken.token
  }

  const client = new JWT({
    email: config.notifications.fcmClientEmail!,
    key: config.notifications.fcmPrivateKey!,
    scopes: ['https://www.googleapis.com/auth/firebase.messaging'],
  })

  const response = await client.authorize()
  if (!response.access_token) {
    return null
  }

  cachedAccessToken = {
    token: response.access_token,
    expiresAt: response.expiry_date ?? Date.now() + 50 * 60 * 1000,
  }

  return response.access_token
}

const getFailureCode = (error: unknown) => {
  if (!axios.isAxiosError(error)) {
    return 'FCM_REQUEST_FAILED'
  }

  const details = error.response?.data as
    | {
        error?: {
          status?: string
          details?: Array<{ errorCode?: string }>
        }
      }
    | undefined

  return (
    details?.error?.details?.find((item) => item.errorCode)?.errorCode ??
    details?.error?.status ??
    `HTTP_${error.response?.status ?? 500}`
  )
}

export const sendPushMessage = async (
  params: SendPushMessageParams
): Promise<SendPushMessageResult> => {
  const accessToken = await getAccessToken()
  if (!accessToken || !config.notifications.fcmProjectId) {
    return {
      providerAccepted: false,
      failureCode: 'PUSH_NOT_CONFIGURED',
      shouldDeactivateToken: false,
    }
  }

  try {
    const response = await axios.post(
      `https://fcm.googleapis.com/v1/projects/${config.notifications.fcmProjectId}/messages:send`,
      {
        message: {
          token: params.token,
          notification: {
            title: params.title,
            body: params.body,
            ...(params.imageUrl ? { image: params.imageUrl } : {}),
          },
          data: params.data,
          android: {
            priority: 'high',
            notification: {
              channelId: 'devotionals',
              clickAction: 'FLUTTER_NOTIFICATION_CLICK',
              ...(params.imageUrl ? { image: params.imageUrl } : {}),
            },
          },
          apns: {
            headers: {
              'apns-priority': '10',
            },
            payload: {
              aps: {
                sound: 'default',
              },
            },
            fcm_options: params.imageUrl
              ? {
                  image: params.imageUrl,
                }
              : undefined,
          },
        },
      },
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
        timeout: 10000,
      }
    )

    return {
      providerAccepted: true,
      providerMessageId:
        typeof response.data?.name === 'string' ? response.data.name : null,
      shouldDeactivateToken: false,
    }
  } catch (error) {
    const failureCode = getFailureCode(error)
    return {
      providerAccepted: false,
      failureCode,
      shouldDeactivateToken:
        failureCode === 'UNREGISTERED' || failureCode === 'INVALID_ARGUMENT',
    }
  }
}
