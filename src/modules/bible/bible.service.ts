import { prisma } from '../../config/db';
import BibleApiClient from './bibleApiClient';
import { BibleVersionApiModel } from './bible.types';

export const listActiveBibleVersions = async () => {
  return prisma.bibleVersion.findMany({
    where: { isActive: true },
    orderBy: { name: 'asc' },
  });
};

export const syncBibleVersionsFromApi = async (): Promise<{
  total: number;
  created: number;
  updated: number;
}> => {
  const apiClient = new BibleApiClient();
  const versions = await apiClient.getVersions();
  const result = await upsertBibleVersions(versions);

  return { total: versions.length, ...result };
};

export const upsertBibleVersions = async (versions: BibleVersionApiModel[]) => {
  let created = 0;
  let updated = 0;

  if (versions.length === 0) {
    return { created, updated };
  }

  await prisma.$transaction(async (tx) => {
    for (const version of versions) {
      const existing = await tx.bibleVersion.findUnique({ where: { apiCode: version.code } });

      if (existing) {
        await tx.bibleVersion.update({
          where: { id: existing.id },
          data: {
            name: version.name,
            language: version.language,
            isActive: true,
          },
        });
        updated += 1;
      } else {
        await tx.bibleVersion.create({
          data: {
            apiCode: version.code,
            name: version.name,
            language: version.language,
            isActive: true,
          },
        });
        created += 1;
      }
    }
  });

  return { created, updated };
};
