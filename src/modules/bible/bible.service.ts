import { prisma } from '../../config/db';
import { DEFAULT_BIBLE_VERSION_CODE } from './bibleVersionCatalog';
import { planBibleVersionReconciliation, StoredBibleVersion } from './bibleVersionReconciliation';

export const listActiveBibleVersions = async () => {
  return prisma.bibleVersion.findMany({
    where: { isActive: true },
    orderBy: { name: 'asc' },
  });
};

export const reconcileBibleVersionCatalog = async (): Promise<{
  created: number;
  updated: number;
  deactivated: number;
  reassignedUsers: number;
}> => {
  return prisma.$transaction(
    async (tx) => {
      const stored: StoredBibleVersion[] = await tx.bibleVersion.findMany();
      const plan = planBibleVersionReconciliation(stored);
      const catalogVersionIds = { ...plan.catalogVersionIds };

      for (const version of plan.toCreate) {
        const created = await tx.bibleVersion.create({
          data: {
            apiCode: version.code,
            name: version.name,
            language: version.language,
            isActive: true,
          },
        });
        catalogVersionIds[version.code] = created.id;
      }

      for (const version of plan.toUpdate) {
        await tx.bibleVersion.update({
          where: { id: version.id },
          data: {
            name: version.name,
            language: version.language,
            isActive: true,
          },
        });
      }

      for (const version of plan.toDeactivate) {
        await tx.bibleVersion.update({
          where: { id: version.id },
          data: { isActive: false },
        });
      }

      const defaultVersionId = catalogVersionIds[DEFAULT_BIBLE_VERSION_CODE];
      if (!defaultVersionId) {
        throw new Error(
          `Reina-Valera 1960 (${DEFAULT_BIBLE_VERSION_CODE}) catalog version was not found after reconciliation`,
        );
      }

      const inactiveVersions = await tx.bibleVersion.findMany({
        where: { isActive: false },
        select: { id: true },
      });
      const inactiveVersionIds = inactiveVersions.map((version) => version.id);

      let reassignedUsers = 0;
      if (inactiveVersionIds.length > 0) {
        const result = await tx.userSettings.updateMany({
          where: { preferredVersionId: { in: inactiveVersionIds } },
          data: { preferredVersionId: defaultVersionId },
        });
        reassignedUsers = result.count;
      }

      return {
        created: plan.toCreate.length,
        updated: plan.toUpdate.length,
        deactivated: plan.toDeactivate.length,
        reassignedUsers,
      };
    },
    { maxWait: 5000, timeout: 30000 },
  );
};
