import crypto from 'crypto';
import { prisma } from '../../config/db';
import { AppError } from '../../common/errors';
import { hashPassword } from '../auth/password';

const DELETED_NAME = 'Deleted User';
const DEFAULT_DELETION_REASON = 'user_requested';
const DELETED_EMAIL_DOMAIN = 'deleted.holyverso.app';

const buildDeletedEmail = (userId: string) =>
  `deleted+${userId}@${DELETED_EMAIL_DOMAIN}`;

export const deleteUserAccount = async (
  userId: string,
  reason: string = DEFAULT_DELETION_REASON,
) => {
  const deletedAt = new Date();
  const anonymizedEmail = buildDeletedEmail(userId);
  const randomPassword = crypto.randomBytes(32).toString('hex');
  const passwordHash = await hashPassword(randomPassword);

  return prisma.$transaction(async (tx) => {
    const existing = await tx.user.findUnique({
      where: { id: userId },
      select: { deletedAt: true },
    });

    if (!existing) {
      throw new AppError('User not found', 'USER_NOT_FOUND', 404);
    }

    if (existing.deletedAt) {
      return { deleted_at: existing.deletedAt };
    }

    await tx.userSettings.deleteMany({ where: { userId } });
    await tx.userSavedVerse.deleteMany({ where: { userId } });
    await tx.userVerseHistory.deleteMany({ where: { userId } });
    await tx.userThemePreference.deleteMany({ where: { userId } });

    await tx.user.update({
      where: { id: userId },
      data: {
        deletedAt,
        deletedReason: reason,
        email: anonymizedEmail,
        name: DELETED_NAME,
        passwordHash,
        resetToken: null,
        resetTokenExpiresAt: null,
      },
    });

    return { deleted_at: deletedAt };
  });
};
