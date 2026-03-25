import {
  DevotionalPublicationState,
  DevotionalStateTransitionSource,
  Prisma,
} from '@prisma/client'
import { AppError } from '../../common/errors'

export const resolveDeliveryIdByToken = async (
  tx: Prisma.TransactionClient,
  params: {
    userId: string
    devotionalId: string
    deliveryToken?: string | null
  }
) => {
  if (!params.deliveryToken) {
    return null
  }

  const delivery = await tx.devotionalFeedDelivery.findUnique({
    where: {
      token: params.deliveryToken,
    },
    select: {
      id: true,
      userId: true,
      devotionalId: true,
    },
  })

  if (
    !delivery ||
    delivery.userId !== params.userId ||
    delivery.devotionalId !== params.devotionalId
  ) {
    throw new AppError('Invalid delivery token', 'INVALID_DELIVERY_TOKEN', 400)
  }

  return delivery.id
}

export const recordPublicationStateTransition = async (
  tx: Prisma.TransactionClient,
  params: {
    devotionalId: string
    fromPublicationState: DevotionalPublicationState | null
    toPublicationState: DevotionalPublicationState
    source: DevotionalStateTransitionSource
    metadata?: Prisma.InputJsonValue
  }
) => {
  if (params.fromPublicationState === params.toPublicationState) {
    return false
  }

  await tx.devotionalStateTransitionEvent.create({
    data: {
      devotionalId: params.devotionalId,
      fromPublicationState: params.fromPublicationState,
      toPublicationState: params.toPublicationState,
      source: params.source,
      metadata: params.metadata,
    },
  })

  return true
}
