import {
  DevotionalPublicationState,
  DevotionalStateTransitionSource,
  Prisma,
} from '@prisma/client'

export type FeedDeliveryAttributionStatus =
  | 'resolved'
  | 'missing'
  | 'invalid'
  | 'mismatch'

export const resolveFeedDeliveryAttribution = async (
  client: Pick<Prisma.TransactionClient, 'devotionalFeedDelivery'>,
  params: {
    userId: string
    devotionalId: string
    deliveryToken?: string | null
  }
) => {
  if (!params.deliveryToken) {
    return {
      deliveryId: null,
      status: 'missing' as const,
    }
  }

  const delivery = await client.devotionalFeedDelivery.findUnique({
    where: {
      token: params.deliveryToken,
    },
    select: {
      id: true,
      userId: true,
      devotionalId: true,
    },
  })

  if (!delivery) {
    return {
      deliveryId: null,
      status: 'invalid' as const,
    }
  }

  if (
    delivery.userId !== params.userId ||
    delivery.devotionalId !== params.devotionalId
  ) {
    return {
      deliveryId: null,
      status: 'mismatch' as const,
    }
  }

  return {
    deliveryId: delivery.id,
    status: 'resolved' as const,
  }
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
