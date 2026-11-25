import { translateBookName } from './bookTranslations'
import { BOOK_DEFINITIONS } from './bookSearchData'

export type BookEntry = {
  id: number
  key: string
  english: string
  spanish: string
  testament: 'old' | 'new'
  chapters: number
  aliases: string[]
  abbreviations: string[]
}

export const stripAccents = (value: string) =>
  value.normalize('NFD').replace(/[̀-ͯ]/g, '')

export const normalizeForMatch = (value: string) =>
  stripAccents(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ')

const compact = (value: string) => value.replace(/\s+/g, '')

const removeVowels = (value: string) => value.replace(/[aeiou]/g, '')

const normalizeBookKey = (english: string) =>
  english
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')

const formatAbbreviation = (abbr: string) => {
  const trimmed = abbr.trim()
  if (!trimmed) return trimmed
  const match = trimmed.match(/^(\d+)([a-z]+)$/i)
  if (match) {
    const suffix = match[2]
    return `${match[1]} ${suffix.charAt(0).toUpperCase()}${suffix.slice(1)}`
  }
  return `${trimmed.charAt(0).toUpperCase()}${trimmed.slice(1)}`
}

const buildAbbreviations = (names: string[], prefix?: string) => {
  const result = new Set<string>()
  names.forEach((name) => {
    const normalized = compact(normalizeForMatch(name))
    if (!normalized) return
    const consonants = removeVowels(normalized)
    const candidates = [
      normalized.slice(0, 2),
      normalized.slice(0, 3),
      consonants.slice(0, 2),
      consonants.slice(0, 3),
    ].filter(Boolean)
    candidates.forEach((candidate) => {
      const withPrefix = prefix ? `${prefix}${candidate}` : candidate
      result.add(formatAbbreviation(withPrefix))
    })
  })
  return Array.from(result)
}

const EXTRA_ALIASES: Record<string, string[]> = {
  psalms: ['psalm', 'salmo', 'salmos'],
  song_of_solomon: ['song of songs', 'cantares', 'cantar de los cantares'],
}

const buildBookEntries = (): BookEntry[] => {
  return BOOK_DEFINITIONS.map((book) => {
    const key = normalizeBookKey(book.english)
    const spanish = translateBookName(book.english)
    const baseAliases = new Set<string>([normalizeForMatch(book.english), normalizeForMatch(spanish)])
    const numberPrefixMatch = book.english.match(/^(\d+)\s+(.*)$/)
    const prefix = numberPrefixMatch?.[1]
    const baseName = numberPrefixMatch?.[2]

    if (baseName) {
      baseAliases.add(normalizeForMatch(baseName))
      const spanishBase = normalizeForMatch(translateBookName(baseName))
      baseAliases.add(spanishBase)
    }

    const extraAliases = EXTRA_ALIASES[key] ?? []
    extraAliases.forEach((alias) => baseAliases.add(normalizeForMatch(alias)))

    const aliasList = Array.from(baseAliases).flatMap((alias) => {
      const compactAlias = compact(alias)
      const consonantAlias = removeVowels(compactAlias)
      return [alias, compactAlias, consonantAlias].filter(Boolean)
    })

    const abbreviationNames = baseName
      ? [baseName, translateBookName(baseName)]
      : [book.english, spanish]
    const abbreviations = buildAbbreviations(abbreviationNames, prefix)

    const aliasSet = new Set<string>(aliasList.map((alias) => normalizeForMatch(alias)))
    const abbreviationsNormalized = abbreviations.map((abbr) => normalizeForMatch(abbr))
    abbreviationsNormalized.forEach((abbr) => aliasSet.add(abbr))

    if (prefix && baseName) {
      const prefixAlias = `${prefix} ${normalizeForMatch(baseName)}`
      aliasSet.add(prefixAlias)
      aliasSet.add(compact(prefixAlias))
    }

    return {
      id: book.id,
      key,
      english: book.english,
      spanish,
      testament: book.testament,
      chapters: book.chapters,
      aliases: Array.from(aliasSet),
      abbreviations,
    }
  })
}

export const BOOK_ENTRIES = buildBookEntries()
