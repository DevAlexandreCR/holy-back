import { Request, Response } from 'express';
import { z } from 'zod';
import {
  LandingStoreTarget,
  recordStoreRedirectClick,
  resolveStoreTargetUrl,
} from './landingRedirect.service';

const redirectQuerySchema = z.object({
  cta_placement: z.string().trim().min(1).max(191).optional(),
  entry_context: z.string().trim().min(1).max(191).default('home'),
  lp_variant: z.string().trim().min(1).max(191).default('emotional'),
  landing_session_id: z.string().trim().min(1).max(191).optional(),
  utm_source: z.string().trim().min(1).max(191).optional(),
  utm_medium: z.string().trim().min(1).max(191).optional(),
  utm_campaign: z.string().trim().min(1).max(191).optional(),
  utm_content: z.string().trim().min(1).max(191).optional(),
  share_token: z.string().trim().min(1).max(191).optional(),
});

const pickFirstForwardedIp = (value: string | string[] | undefined) => {
  if (!value) return null;
  const raw = Array.isArray(value) ? value[0] : value;
  const first = raw.split(',')[0]?.trim();
  return first || null;
};

const sanitizeHeader = (value?: string | string[]) => {
  if (!value) return null;
  return Array.isArray(value) ? value[0] ?? null : value;
};

const handleRedirect = async (
  req: Request,
  res: Response,
  target: LandingStoreTarget
) => {
  const query = redirectQuerySchema.parse(req.query);

  try {
    await recordStoreRedirectClick({
      target,
      ctaPlacement: query.cta_placement ?? null,
      entryContext: query.entry_context,
      lpVariant: query.lp_variant,
      landingSessionId: query.landing_session_id ?? null,
      utmSource: query.utm_source ?? null,
      utmMedium: query.utm_medium ?? null,
      utmCampaign: query.utm_campaign ?? null,
      utmContent: query.utm_content ?? null,
      shareToken: query.share_token ?? null,
      referer: sanitizeHeader(req.headers.referer),
      userAgent: sanitizeHeader(req.headers['user-agent']),
      ipAddress:
        pickFirstForwardedIp(req.headers['x-forwarded-for']) ?? req.ip ?? null,
    });
  } catch (error) {
    console.log('[LandingRedirect] Failed to persist outbound click', {
      target,
      error,
    });
  }

  res.redirect(resolveStoreTargetUrl(target));
};

export const redirectToAppStoreHandler = async (
  req: Request,
  res: Response
) => {
  await handleRedirect(req, res, 'app-store');
};

export const redirectToGooglePlayHandler = async (
  req: Request,
  res: Response
) => {
  await handleRedirect(req, res, 'google-play');
};
