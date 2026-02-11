import { AppError } from '../../common/errors'
import { prisma } from '../../config/db'
import { ensureSettings } from '../user/userSettings.service'
import BibleApiClient from './bibleApiClient'
import { convertBookToApiCode } from './bookApiMapping'
import { translateBookName } from './bookTranslations'
import { BOOK_DEFINITIONS } from './bookSearchData'

const MAX_IMAGE_CHARACTERS = 600

type ParsedReference = {
  bookKey: string
  bookId: number
  bookName: string
  chapter: number
  verseStart?: number
  verseEnd?: number
}

type BookEntry = {
  id: number
  key: string
  english: string
  spanish: string
  testament: 'old' | 'new'
  aliases: string[]
  abbreviations: string[]
}

const bibleApiClient = new BibleApiClient()

const stripAccents = (value: string) =>
  value.normalize('NFD').replace(/[\u0300-\u036f]/g, '')

const normalizeForMatch = (value: string) =>
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
      aliases: Array.from(aliasSet),
      abbreviations,
    }
  })
}

const BOOK_ENTRIES = buildBookEntries()

const NUMBERED_BASE_NAMES = (() => {
  const result = new Set<string>()
  BOOK_ENTRIES.forEach((entry) => {
    const match = normalizeForMatch(entry.english).match(/^(\d+)\s+(.*)$/)
    if (match) {
      result.add(match[2])
      result.add(normalizeForMatch(entry.spanish.replace(/^\d+\s+/, '')))
    }
  })
  return result
})()

const STANDALONE_NAMES = (() => {
  const result = new Set<string>()
  BOOK_ENTRIES.forEach((entry) => {
    const match = normalizeForMatch(entry.english).match(/^(\d+)\s+(.*)$/)
    if (!match) {
      result.add(normalizeForMatch(entry.english))
      result.add(normalizeForMatch(entry.spanish))
    }
  })
  return result
})()

const romanToNumber = (value: string) => {
  const roman = value.toLowerCase()
  if (roman === 'i') return '1'
  if (roman === 'ii') return '2'
  if (roman === 'iii') return '3'
  return value
}

const normalizeQuery = (query: string) => {
  const normalized = stripAccents(query)
    .toLowerCase()
    .replace(/[;,()\[\]{}]/g, ' ')
    .replace(/([a-z])(\d)/g, '$1 $2')
    .replace(/(\d)([a-z])/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim()

  return normalized
    .replace(/\b(primera|primer|primero)\b/g, '1')
    .replace(/\b(segunda|segundo)\b/g, '2')
    .replace(/\b(tercera|tercer|tercero)\b/g, '3')
    .replace(/\b(i|ii|iii)\b/g, (match) => romanToNumber(match))
    .replace(/\b(capitulo|cap|cap\.)\b/g, 'capitulo')
    .replace(/\b(versiculo|versiculos|verso|versos|v|vs|vs\.)\b/g, 'verso')
    .replace(/\s+/g, ' ')
    .trim()
}

const similarity = (a: string, b: string) => {
  const len1 = a.length
  const len2 = b.length
  if (len1 === 0 || len2 === 0) return 0

  const matrix: number[][] = Array.from({ length: len1 + 1 }, () =>
    Array(len2 + 1).fill(0)
  )

  for (let i = 0; i <= len1; i += 1) matrix[i][0] = i
  for (let j = 0; j <= len2; j += 1) matrix[0][j] = j

  for (let i = 1; i <= len1; i += 1) {
    for (let j = 1; j <= len2; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost
      )
    }
  }

  const distance = matrix[len1][len2]
  return 1 - distance / Math.max(len1, len2)
}

const scoreMatch = (query: string, alias: string) => {
  if (query === alias) return 1
  if (alias.startsWith(query)) return 0.9
  if (query.startsWith(alias)) return 0.85
  return similarity(query, alias)
}

const resolveBookName = (bookRaw: string): BookEntry | null => {
  const normalized = normalizeForMatch(bookRaw)
  if (!normalized) return null

  const tokens = normalized.split(' ')
  if (tokens.length > 1) {
    const last = tokens[tokens.length - 1]
    if (['1', '2', '3'].includes(last)) {
      const base = tokens.slice(0, -1).join(' ')
      if (NUMBERED_BASE_NAMES.has(base)) {
        return resolveBookName(`${last} ${base}`)
      }
    }
  }

  if (
    !/^\d+\s+/.test(normalized) &&
    NUMBERED_BASE_NAMES.has(normalized) &&
    !STANDALONE_NAMES.has(normalized)
  ) {
    return resolveBookName(`1 ${normalized}`)
  }

  let bestEntry: BookEntry | null = null
  let bestScore = 0
  const minScore = normalized.length <= 2 ? 0.85 : 0.6

  BOOK_ENTRIES.forEach((entry) => {
    entry.aliases.forEach((alias) => {
      if (normalized.length <= 2 && !alias.startsWith(normalized)) return
      const score = scoreMatch(normalized, alias)
      if (!bestEntry || score > bestScore) {
        bestEntry = entry
        bestScore = score
      }
    })
  })

  if (!bestEntry || bestScore < minScore) return null
  return bestEntry
}

const extractReference = (query: string) => {
  const withRange = /^(.*?)\s+(\d+)\s*[:.]\s*(\d+)(?:\s*(?:-|a|al|hasta)\s*(\d+))?$/
  const withChapterWords =
    /^(.*?)\s+capitulo\s+(\d+)(?:\s+verso\s+(\d+)(?:\s*(?:-|a|al|hasta)\s*(\d+))?)?$/
  const withVerseWords =
    /^(.*?)\s+(\d+)\s+verso\s+(\d+)(?:\s*(?:-|a|al|hasta)\s*(\d+))?$/
  const withSpacedRange = /^(.*?)\s+(\d+)\s+(\d+)\s+(\d+)$/
  const withLooseVerses =
    /^(.*?)\s+(\d+)\s+(\d+)(?:\s*(?:-|a|al|hasta)\s*(\d+))?$/
  const chapterOnly = /^(.*?)\s+(\d+)$/
  const verseOnly =
    /^(.*?)\s+verso\s+(\d+)(?:\s*(?:-|a|al|hasta)\s*(\d+))?$/

  const matchWithRange = query.match(withRange)
  if (matchWithRange) {
    const [, book, chapter, verseStart, verseEnd] = matchWithRange
    return {
      book,
      chapter: Number(chapter),
      verseStart: Number(verseStart),
      verseEnd: verseEnd ? Number(verseEnd) : undefined,
    }
  }

  const matchChapterWords = query.match(withChapterWords)
  if (matchChapterWords) {
    const [, book, chapter, verseStart, verseEnd] = matchChapterWords
    return {
      book,
      chapter: Number(chapter),
      verseStart: verseStart ? Number(verseStart) : undefined,
      verseEnd: verseEnd ? Number(verseEnd) : undefined,
    }
  }

  const matchVerseWords = query.match(withVerseWords)
  if (matchVerseWords) {
    const [, book, chapter, verseStart, verseEnd] = matchVerseWords
    return {
      book,
      chapter: Number(chapter),
      verseStart: Number(verseStart),
      verseEnd: verseEnd ? Number(verseEnd) : undefined,
    }
  }

  const matchSpacedRange = query.match(withSpacedRange)
  if (matchSpacedRange) {
    const [, book, chapter, verseStart, verseEnd] = matchSpacedRange
    return {
      book,
      chapter: Number(chapter),
      verseStart: Number(verseStart),
      verseEnd: verseEnd ? Number(verseEnd) : undefined,
    }
  }

  const matchLooseVerses = query.match(withLooseVerses)
  if (matchLooseVerses) {
    const [, book, chapter, verseStart, verseEnd] = matchLooseVerses
    return {
      book,
      chapter: Number(chapter),
      verseStart: Number(verseStart),
      verseEnd: verseEnd ? Number(verseEnd) : undefined,
    }
  }

  const matchChapterOnly = query.match(chapterOnly)
  if (matchChapterOnly) {
    const [, book, chapter] = matchChapterOnly
    return {
      book,
      chapter: Number(chapter),
    }
  }

  const matchVerseOnly = query.match(verseOnly)
  if (matchVerseOnly) {
    const [, book, verseStart, verseEnd] = matchVerseOnly
    return {
      book,
      chapter: 1,
      verseStart: Number(verseStart),
      verseEnd: verseEnd ? Number(verseEnd) : undefined,
    }
  }

  return null
}

const validateReference = (reference: ParsedReference) => {
  if (!Number.isInteger(reference.chapter) || reference.chapter <= 0) {
    throw new AppError('Referencia bíblica inválida', 'INVALID_REFERENCE', 400)
  }

  if (reference.verseStart !== undefined && reference.verseStart <= 0) {
    throw new AppError('Referencia bíblica inválida', 'INVALID_REFERENCE', 400)
  }

  if (
    reference.verseStart !== undefined &&
    reference.verseEnd !== undefined &&
    reference.verseEnd < reference.verseStart
  ) {
    throw new AppError('Referencia bíblica inválida', 'INVALID_REFERENCE', 400)
  }
}

const parseReference = (rawQuery: string): ParsedReference => {
  const normalized = normalizeQuery(rawQuery)
  if (!normalized) {
    throw new AppError('No se pudo interpretar la búsqueda', 'INVALID_QUERY', 400)
  }

  const extracted = extractReference(normalized)
  if (!extracted) {
    throw new AppError('No se pudo interpretar la búsqueda', 'INVALID_QUERY', 400)
  }

  const bookEntry = resolveBookName(extracted.book)
  if (!bookEntry) {
    throw new AppError('No se encontró el libro bíblico', 'BOOK_NOT_FOUND', 404)
  }

  const parsed: ParsedReference = {
    bookKey: bookEntry.key,
    bookId: bookEntry.id,
    bookName: bookEntry.spanish,
    chapter: extracted.chapter,
    verseStart: extracted.verseStart,
    verseEnd: extracted.verseEnd,
  }

  validateReference(parsed)
  return parsed
}

const resolveVersion = async (userId: string, versionId?: number) => {
  if (versionId) {
    const version = await prisma.bibleVersion.findUnique({ where: { id: versionId } })
    if (!version) {
      throw new AppError('Bible version not found', 'BIBLE_VERSION_NOT_FOUND', 404)
    }
    if (!version.isActive) {
      throw new AppError('Bible version is not active', 'BIBLE_VERSION_INACTIVE', 400)
    }
    return version
  }

  const settings = await ensureSettings(userId)
  if (settings.preferredVersionId) {
    const preferred = await prisma.bibleVersion.findUnique({
      where: { id: settings.preferredVersionId },
    })
    if (preferred) return preferred
  }

  const fallback = await prisma.bibleVersion.findFirst({
    where: { isActive: true },
    orderBy: { id: 'asc' },
  })

  if (!fallback) {
    throw new AppError('No active Bible versions available', 'NO_ACTIVE_BIBLE_VERSION', 404)
  }

  return fallback
}

const buildReferenceResponse = (
  reference: ParsedReference,
  verseStart: number,
  verseEnd?: number
) => ({
  book: reference.bookName,
  bookId: reference.bookId,
  chapter: reference.chapter,
  verseStart,
  verseEnd: verseEnd ?? verseStart,
})

const buildVerseResponse = (number: number, text: string) => ({
  verseNumber: number,
  text,
})

export const searchBible = async (
  userId: string,
  query: string,
  versionId?: number
) => {
  if (!query || !query.trim()) {
    throw new AppError('No se pudo interpretar la búsqueda', 'INVALID_QUERY', 400)
  }

  const version = await resolveVersion(userId, versionId)
  let reference: ParsedReference
  try {
    reference = parseReference(query)
  } catch (error) {
    if (
      error instanceof AppError &&
      ['INVALID_QUERY', 'BOOK_NOT_FOUND', 'INVALID_REFERENCE'].includes(error.code)
    ) {
      return null
    }
    throw error
  }
  const bookCode = convertBookToApiCode(reference.bookKey)

  try {
    if (reference.verseStart === undefined) {
      const chapterData = await bibleApiClient.getChapter({
        versionCode: version.apiCode,
        book: bookCode,
        chapter: reference.chapter,
      })

      const verses = chapterData.verses.map((verse) =>
        buildVerseResponse(verse.number, verse.text)
      )

      if (verses.length === 0) {
        throw new AppError('Referencia bíblica inválida', 'INVALID_REFERENCE', 400)
      }

      const characterCount = verses.reduce((sum, verse) => sum + verse.text.length, 0)

      return {
        reference: buildReferenceResponse(
          reference,
          verses[0].verseNumber,
          verses[verses.length - 1].verseNumber
        ),
        verses,
        version: {
          id: version.id,
          name: version.name,
          abbreviation: version.apiCode,
          apiCode: version.apiCode,
        },
        canShareAsImage: characterCount <= MAX_IMAGE_CHARACTERS,
        characterCount,
      }
    }

    const verses = await bibleApiClient.getVerses({
      versionCode: version.apiCode,
      book: bookCode,
      chapter: reference.chapter,
      fromVerse: reference.verseStart,
      toVerse: reference.verseEnd,
    })

    if (!verses || verses.length === 0) {
      throw new AppError('Referencia bíblica inválida', 'INVALID_REFERENCE', 400)
    }

    const responseVerses = verses.map((verse) => {
      const text = verse.verse ? verse.verse.toString().trim() : ''
      return buildVerseResponse(verse.number, text)
    })

    const characterCount = responseVerses.reduce(
      (sum, verse) => sum + verse.text.length,
      0
    )

      return {
        reference: buildReferenceResponse(
          reference,
          responseVerses[0].verseNumber,
        responseVerses[responseVerses.length - 1].verseNumber
      ),
      verses: responseVerses,
      version: {
        id: version.id,
        name: version.name,
        abbreviation: version.apiCode,
        apiCode: version.apiCode,
      },
      canShareAsImage: characterCount <= MAX_IMAGE_CHARACTERS,
      characterCount,
    }
  } catch (error) {
    if (error instanceof AppError) {
      if (error.code === 'INVALID_REFERENCE') {
        return null
      }
      throw error
    }
    throw new AppError('Error al obtener los versículos', 'EXTERNAL_API_ERROR', 502, error)
  }
}

export const getAutocompleteSuggestions = async (query: string) => {
  const normalized = normalizeQuery(query)
  if (!normalized || normalized.length < 2) {
    return []
  }

  const scored = BOOK_ENTRIES.map((entry) => {
    const score = entry.aliases.reduce((maxScore, alias) => {
      const nextScore = scoreMatch(normalizeForMatch(normalized), alias)
      return nextScore > maxScore ? nextScore : maxScore
    }, 0)

    return { entry, score }
  })
    .filter((item) => item.score > 0.45)
    .sort((a, b) => b.score - a.score)
    .slice(0, 8)

  return scored.map(({ entry }) => ({
    bookName: entry.spanish,
    bookId: entry.id,
    abbreviations: entry.abbreviations,
    type: entry.testament,
  }))
}
