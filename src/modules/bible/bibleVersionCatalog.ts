export interface BibleVersionCatalogEntry {
  code: string;
  providerCode: string;
  name: string;
  language: string;
}

export const BIBLE_VERSION_CATALOG: BibleVersionCatalogEntry[] = [
  { code: 'rv1960', providerCode: 'RV1960', name: 'Reina-Valera 1960', language: 'es' },
  { code: 'pdt', providerCode: 'PDT', name: 'Palabra de Dios para Todos', language: 'es' },
  { code: 'kjv', providerCode: 'KJV', name: 'King James Version', language: 'en' },
];

export const DEFAULT_BIBLE_VERSION_CODE = 'rv1960';

export const findBibleVersionCatalogEntry = (
  code: string,
): BibleVersionCatalogEntry | undefined => {
  const normalized = code.trim().toLowerCase();

  return BIBLE_VERSION_CATALOG.find((entry) => entry.code === normalized);
};
