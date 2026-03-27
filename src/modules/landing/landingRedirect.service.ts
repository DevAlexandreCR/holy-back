import crypto from 'crypto';
import { prisma } from '../../config/db';
import { config } from '../../config/env';

export type LandingStoreTarget = 'app-store' | 'google-play';

type NullableString = string | null;

type LandingRedirectContext = {
  target: LandingStoreTarget;
  ctaPlacement: NullableString;
  entryContext: string;
  lpVariant: string;
  landingSessionId: NullableString;
  utmSource: NullableString;
  utmMedium: NullableString;
  utmCampaign: NullableString;
  utmContent: NullableString;
  shareToken: NullableString;
  referer: NullableString;
  userAgent: NullableString;
  ipAddress: NullableString;
};

const APP_STORE_URL = 'https://apps.apple.com/app/holyverso/id6757228086';
const GOOGLE_PLAY_URL =
  'https://play.google.com/store/apps/details?id=gorda.holyverso';

const toBaseUrl = (value: string) => value.replace(/\/+$/, '');

const normalizeNullable = (value?: string | null) => {
  if (!value) return null;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
};

export const resolveStoreTargetUrl = (target: LandingStoreTarget) =>
  target === 'app-store' ? APP_STORE_URL : GOOGLE_PLAY_URL;

export const buildTrackedStoreRedirectUrl = (params: {
  target: LandingStoreTarget;
  ctaPlacement?: string | null;
  entryContext?: string | null;
  lpVariant?: string | null;
  landingSessionId?: string | null;
  utmSource?: string | null;
  utmMedium?: string | null;
  utmCampaign?: string | null;
  utmContent?: string | null;
  shareToken?: string | null;
}) => {
  const url = new URL(
    `/out/${params.target}`,
    `${toBaseUrl(config.app.publicBaseUrl)}/`
  );

  const values: Record<string, string | null | undefined> = {
    cta_placement: params.ctaPlacement,
    entry_context: params.entryContext,
    lp_variant: params.lpVariant,
    landing_session_id: params.landingSessionId,
    utm_source: params.utmSource,
    utm_medium: params.utmMedium,
    utm_campaign: params.utmCampaign,
    utm_content: params.utmContent,
    share_token: params.shareToken,
  };

  Object.entries(values).forEach(([key, value]) => {
    const normalized = normalizeNullable(value);
    if (normalized != null) {
      url.searchParams.set(key, normalized);
    }
  });

  return url.toString();
};

export const recordStoreRedirectClick = async (
  context: LandingRedirectContext
) => {
  const destinationUrl = resolveStoreTargetUrl(context.target);

  await prisma.$executeRaw`
    INSERT INTO web_outbound_clicks (
      id,
      target,
      target_platform,
      destination_url,
      cta_placement,
      entry_context,
      lp_variant,
      landing_session_id,
      utm_source,
      utm_medium,
      utm_campaign,
      utm_content,
      share_token,
      referer,
      user_agent,
      ip_address,
      created_at
    ) VALUES (
      ${crypto.randomUUID()},
      ${context.target},
      ${context.target === 'app-store' ? 'ios' : 'android'},
      ${destinationUrl},
      ${context.ctaPlacement},
      ${context.entryContext},
      ${context.lpVariant},
      ${context.landingSessionId},
      ${context.utmSource},
      ${context.utmMedium},
      ${context.utmCampaign},
      ${context.utmContent},
      ${context.shareToken},
      ${context.referer},
      ${context.userAgent},
      ${context.ipAddress},
      NOW()
    )
  `;
};
