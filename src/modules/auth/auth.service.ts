import crypto from 'crypto';
import { User } from '@prisma/client';
import { prisma } from '../../config/db';
import { config } from '../../config/env';
import { AppError } from '../../common/errors';
import { hashPassword, verifyPassword } from './password';
import { signAccessToken, signRefreshToken } from './jwt';
import { ensureSettings } from '../user/userSettings.service';
import { sendResetPasswordEmail } from './resetEmail.service';

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
});

const sanitizeUser = (user: User) => ({
  id: user.id,
  name: user.name,
  email: user.email,
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
  const user = await prisma.user.findUnique({ where: { email: input.email } });
  if (!user) {
    throw new AppError('Invalid email or password', 'INVALID_CREDENTIALS', 401);
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
      try {
        await sendResetPasswordEmail(user.email, token);
      } catch (error) {
        await prisma.user.update({
          where: { id: user.id },
          data: { resetToken: null, resetTokenExpiresAt: null },
        });
        throw error;
      }
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
  const user = await prisma.user.findUnique({ where: { id: userId } });

  if (!user) {
    throw new AppError('User not found', 'USER_NOT_FOUND', 404);
  }

  const settings = await ensureSettings(user.id);

  return {
    user: sanitizeUser(user),
    settings: {
      preferred_version_id: settings.preferredVersionId,
      timezone: settings.timezone,
    },
  };
};
