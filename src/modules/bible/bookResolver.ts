import { BOOK_API_CODE_MAP } from './bookApiMapping'
import { BOOK_ENTRIES, normalizeForMatch } from './bookEntries'

const ORDINAL_WORD_TO_NUMBER: Record<string, string> = {
  first: '1',
  second: '2',
  third: '3',
}

const normalizeLibraryName = (value: string) =>
  normalizeForMatch(value).replace(
    /^(first|second|third)\b/,
    (match) => ORDINAL_WORD_TO_NUMBER[match]
  )

const PRIMARY_ALIAS_TO_BOOK_ID = new Map<string, number>()
BOOK_ENTRIES.forEach((entry) => {
  PRIMARY_ALIAS_TO_BOOK_ID.set(normalizeForMatch(entry.english), entry.id)
  PRIMARY_ALIAS_TO_BOOK_ID.set(normalizeForMatch(entry.spanish), entry.id)
})

const ALIAS_CANDIDATE_IDS = new Map<string, Set<number>>()
BOOK_ENTRIES.forEach((entry) => {
  entry.aliases.forEach((alias) => {
    const candidateIds = ALIAS_CANDIDATE_IDS.get(alias) ?? new Set<number>()
    candidateIds.add(entry.id)
    ALIAS_CANDIDATE_IDS.set(alias, candidateIds)
  })
})

const ALIAS_TO_BOOK_ID = new Map<string, number>(PRIMARY_ALIAS_TO_BOOK_ID)
ALIAS_CANDIDATE_IDS.forEach((candidateIds, alias) => {
  if (ALIAS_TO_BOOK_ID.has(alias)) return
  if (candidateIds.size === 1) {
    ALIAS_TO_BOOK_ID.set(alias, candidateIds.values().next().value as number)
  }
})

const resolveByAlias = (input: string): number | undefined =>
  ALIAS_TO_BOOK_ID.get(normalizeLibraryName(input))

const LEGACY_ABBREVIATION_TO_BOOK_ID = new Map<string, number>()
const BOOK_ID_TO_LEGACY_ABBREVIATION = new Map<number, string>()

Object.entries(BOOK_API_CODE_MAP).forEach(([dbKey, abbreviation]) => {
  const bookId = resolveByAlias(dbKey)
  if (bookId === undefined) return

  const normalizedAbbreviation = abbreviation.toUpperCase()
  if (!LEGACY_ABBREVIATION_TO_BOOK_ID.has(normalizedAbbreviation)) {
    LEGACY_ABBREVIATION_TO_BOOK_ID.set(normalizedAbbreviation, bookId)
  }
  if (!BOOK_ID_TO_LEGACY_ABBREVIATION.has(bookId)) {
    BOOK_ID_TO_LEGACY_ABBREVIATION.set(bookId, abbreviation)
  }
})

export const resolveBookId = (input: string): number | undefined => {
  if (typeof input !== 'string') return undefined

  const trimmed = input.trim()
  if (!trimmed) return undefined

  if (/^\d+$/.test(trimmed)) {
    const numericId = Number(trimmed)
    return numericId >= 1 && numericId <= 66 ? numericId : undefined
  }

  const legacyId = LEGACY_ABBREVIATION_TO_BOOK_ID.get(trimmed.toUpperCase())
  if (legacyId !== undefined) return legacyId

  return resolveByAlias(trimmed)
}

export const getLegacyAbbreviationForBookId = (bookId: number): string | undefined =>
  BOOK_ID_TO_LEGACY_ABBREVIATION.get(bookId)
