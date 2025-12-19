import { translateBookName } from './bookTranslations'

/**
 * Map from normalized database book names to Bible API book codes
 * Database uses: "2_peter", "second_kings", etc.
 * API expects abbreviations: "2P", "2R", etc.
 * Based on https://bible-api.deno.dev/api/books
 */
const BOOK_API_CODE_MAP: Record<string, string> = {
  // Old Testament
  'genesis': 'GN',
  'exodus': 'EX',
  'leviticus': 'LV',
  'numbers': 'NM',
  'deuteronomy': 'DT',
  'joshua': 'JOS',
  'judges': 'JUE',
  'ruth': 'RT',
  '1_samuel': '1S',
  '2_samuel': '2S',
  '1_kings': '1R',
  '2_kings': '2R',
  'first_kings': '1R',
  'second_kings': '2R',
  '1_chronicles': '1CR',
  '2_chronicles': '2CR',
  'first_chronicles': '1CR',
  'second_chronicles': '2CR',
  'ezra': 'ESD',
  'nehemiah': 'NEH',
  'esther': 'EST',
  'job': 'JOB',
  'psalms': 'SAL',
  'psalm': 'SAL',
  'proverbs': 'PR',
  'ecclesiastes': 'EC',
  'song_of_solomon': 'CNT',
  'song_of_songs': 'CNT',
  'isaiah': 'IS',
  'jeremiah': 'JER',
  'lamentations': 'LM',
  'ezekiel': 'EZ',
  'daniel': 'DN',
  'hosea': 'OS',
  'joel': 'JL',
  'amos': 'AM',
  'obadiah': 'ABD',
  'jonah': 'JON',
  'micah': 'MI',
  'nahum': 'NAH',
  'habakkuk': 'HAB',
  'zephaniah': 'SOF',
  'haggai': 'HAG',
  'zechariah': 'ZAC',
  'malachi': 'MAL',

  // New Testament
  'matthew': 'MT',
  'mark': 'MR',
  'luke': 'LC',
  'john': 'JN',
  'acts': 'HCH',
  'romans': 'RO',
  '1_corinthians': '1CO',
  '2_corinthians': '2CO',
  'galatians': 'GA',
  'ephesians': 'EF',
  'philippians': 'FIL',
  'colossians': 'COL',
  '1_thessalonians': '1TS',
  '2_thessalonians': '2TS',
  '1_timothy': '1TI',
  '2_timothy': '2TI',
  'titus': 'TIT',
  'philemon': 'FLM',
  'hebrews': 'HE',
  'james': 'STG',
  '1_peter': '1P',
  '2_peter': '2P',
  '1_john': '1JN',
  '2_john': '2JN',
  '3_john': '3JN',
  'jude': 'JUD',
  'revelation': 'AP',
}

/**
 * Convert a normalized database book name to the API book code
 * @param dbBookName - Normalized book name from database (e.g., "2_peter", "second_kings")
 * @returns API book code (e.g., "2peter", "2kings")
 */
export const convertBookToApiCode = (dbBookName: string): string => {
  const normalized = dbBookName.toLowerCase().trim()
  const apiCode = BOOK_API_CODE_MAP[normalized]

  if (!apiCode) {
    console.warn(`[bookApiMapping] No mapping found for book: "${dbBookName}". Using fallback: remove underscores.`)
    // Fallback: remove underscores and spaces
    return normalized.replace(/[_\s]/g, '')
  }

  return apiCode
}

/**
 * Get display name for a database book name in English
 * Converts "2_peter" to "2 Peter", "song_of_solomon" to "Song of Solomon"
 */
export const getBookDisplayNameEnglish = (dbBookName: string): string => {
  // Replace underscores with spaces and capitalize words
  return dbBookName
    .split('_')
    .map(word => {
      // Keep numbers as-is
      if (/^\d+$/.test(word)) {
        return word
      }
      // Handle "first", "second", "third" -> "1", "2", "3"
      if (word === 'first') return '1'
      if (word === 'second') return '2'
      if (word === 'third') return '3'
      // Capitalize first letter
      return word.charAt(0).toUpperCase() + word.slice(1)
    })
    .join(' ')
}

/**
 * Get display name for a database book name (in Spanish by default)
 * Converts "john" to "Juan", "2_peter" to "2 Pedro"
 * @param dbBookName - Normalized book name from database
 * @param language - Target language ('es' for Spanish, 'en' for English)
 */
export const getBookDisplayName = (dbBookName: string, language: 'es' | 'en' = 'es'): string => {
  const englishName = getBookDisplayNameEnglish(dbBookName)

  if (language === 'en') {
    return englishName
  }

  // Translate to Spanish
  return translateBookName(englishName)
}
