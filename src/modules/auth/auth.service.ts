import crypto from 'crypto';
import { User } from '@prisma/client';
import { prisma } from '../../config/db';
import { config } from '../../config/env';
import { AppError } from '../../common/errors';
import { hashPassword, verifyPassword } from './password';
import { signAccessToken, signRefreshToken } from './jwt';
import { ensureSettings } from '../user/userSettings.service';
import { sendResetPasswordEmail } from './resetEmail.service';
import {
  formatUserModeration,
  userModerationSelect,
} from '../user/userModeration.service';

type RegisterInput = {
  name: string;
  email: string;
  password: string;
};

type LoginInput = {
  email: string;
  password: string;
};

type ResetPasswordInput = {
  token: string;
  newPassword: string;
};

const toAuthPayload = (user: User) => ({
  sub: user.id,
  email: user.email,
  role: user.role,
});

const sanitizeUser = (user: User & {
  blockedByUser?: { id: string; name: string; email: string } | null
  unblockedByUser?: { id: string; name: string; email: string } | null
}) => ({
  id: user.id,
  name: user.name,
  email: user.email,
  role: user.role,
  ...formatUserModeration({
    isBlocked: user.isBlocked,
    blockedReason: user.blockedReason,
    blockedAt: user.blockedAt,
    blockedByUser: user.blockedByUser,
    unblockedReason: user.unblockedReason,
    unblockedAt: user.unblockedAt,
    unblockedByUser: user.unblockedByUser,
  }),
});

const ensureUniqueEmail = async (email: string): Promise<void> => {
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    throw new AppError('Email is already in use', 'EMAIL_TAKEN', 400);
  }
};

export const registerUser = async (input: RegisterInput) => {
  await ensureUniqueEmail(input.email);
  const passwordHash = await hashPassword(input.password);

  const user = await prisma.$transaction(async (tx) => {
    const createdUser = await tx.user.create({
      data: {
        name: input.name,
        email: input.email,
        passwordHash,
      },
    });

    await tx.userSettings.create({
      data: {
        userId: createdUser.id,
        preferredVersionId: null,
        timezone: null,
      },
    });

    return createdUser;
  });

  const accessToken = signAccessToken(toAuthPayload(user));
  const refreshToken = signRefreshToken(toAuthPayload(user));

  return {
    user: sanitizeUser(user),
    access_token: accessToken,
    refresh_token: refreshToken,
  };
};

export const loginUser = async (input: LoginInput) => {
  const user = await prisma.user.findUnique({
    where: { email: input.email },
    include: {
      blockedByUser: {
        select: {
          id: true,
          name: true,
          email: true,
        },
      },
      unblockedByUser: {
        select: {
          id: true,
          name: true,
          email: true,
        },
      },
    },
  });
  if (!user) {
    throw new AppError('Invalid email or password', 'INVALID_CREDENTIALS', 401);
  }

  if (user.deletedAt) {
    throw new AppError('Account deleted', 'ACCOUNT_DELETED', 401);
  }

  const isValid = await verifyPassword(input.password, user.passwordHash);
  if (!isValid) {
    throw new AppError('Invalid email or password', 'INVALID_CREDENTIALS', 401);
  }

  const accessToken = signAccessToken(toAuthPayload(user));
  const refreshToken = signRefreshToken(toAuthPayload(user));

  return {
    user: sanitizeUser(user),
    access_token: accessToken,
    refresh_token: refreshToken,
  };
};

export const forgotPassword = async (email: string) => {
  const user = await prisma.user.findUnique({ where: { email } });
  const token = user ? crypto.randomBytes(32).toString('hex') : null;
  const expiresAt = token
    ? new Date(Date.now() + config.auth.resetTokenTtlMinutes * 60 * 1000)
    : null;

  if (user) {
    await prisma.user.update({
      where: { id: user.id },
      data: {
        resetToken: token,
        resetTokenExpiresAt: expiresAt,
      },
    });

    if (token) {
      // Send email in the background to avoid blocking the HTTP response
      void sendResetPasswordEmail(user.email, token).catch((error) => {
        // eslint-disable-next-line no-console
        console.error('[forgotPassword] Failed to send reset email', error);
      });
    }
  }

  const response: { message: string; reset_token?: string | null } = {
    message: 'If an account exists, password reset instructions will be sent shortly',
  };

  if (!config.app.isProduction && token) {
    response.reset_token = token;
  }

  return response;
};

export const resetPassword = async (input: ResetPasswordInput) => {
  const user = await prisma.user.findFirst({
    where: {
      resetToken: input.token,
      resetTokenExpiresAt: {
        gt: new Date(),
      },
    },
  });

  if (!user) {
    throw new AppError('Invalid or expired reset token', 'RESET_TOKEN_INVALID', 400);
  }

  const passwordHash = await hashPassword(input.newPassword);

  await prisma.user.update({
    where: { id: user.id },
    data: {
      passwordHash,
      resetToken: null,
      resetTokenExpiresAt: null,
    },
  });

  return { id: user.id };
};

export const getUserWithSettings = async (userId: string) => {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      deletedAt: true,
      ...userModerationSelect,
    },
  });

  if (!user) {
    throw new AppError('User not found', 'USER_NOT_FOUND', 404);
  }

  if (user.deletedAt) {
    throw new AppError('Account deleted', 'ACCOUNT_DELETED', 401);
  }

  const settings = await ensureSettings(user.id);

  return {
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      ...formatUserModeration(user),
    },
    settings: {
      preferred_version_id: settings.preferredVersionId,
      timezone: settings.timezone,
      widget_font_size: settings.widgetFontSize,
      devotional_notifications_enabled:
        settings.devotionalNotificationsEnabled,
      followed_creator_notifications_enabled:
        settings.followedCreatorNotificationsEnabled,
      featured_devotional_notifications_enabled:
        settings.featuredDevotionalNotificationsEnabled,
      author_moderation_notifications_enabled:
        settings.authorModerationNotificationsEnabled,
      editor_review_notifications_enabled:
        settings.editorReviewNotificationsEnabled,
    },
  };
};
