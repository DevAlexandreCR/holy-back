/**
 * Map from normalized database book names to Bible API book codes
 * Database uses: "2_peter", "second_kings", etc.
 * API expects: "2peter", "2kings", etc.
 */
const BOOK_API_CODE_MAP: Record<string, string> = {
  // New Testament - numbered books
  '1_corinthians': '1corinthians',
  '1_john': '1john',
  '1_peter': '1peter',
  '1_thessalonians': '1thessalonians',
  '1_timothy': '1timothy',
  '2_corinthians': '2corinthians',
  '2_john': '2john',
  '2_peter': '2peter',
  '2_thessalonians': '2thessalonians',
  '2_timothy': '2timothy',
  '3_john': '3john',

  // Old Testament - numbered books
  '1_samuel': '1samuel',
  '2_samuel': '2samuel',
  'first_kings': '1kings',
  'second_kings': '2kings',
  'first_chronicles': '1chronicles',
  'second_chronicles': '2chronicles',

  // Apocrypha
  '1_maccabees': '1maccabees',
  '2_maccabees': '2maccabees',

  // Song of Solomon variations
  'song_of_solomon': 'songofsolomon',

  // Books that need underscore removed
  'acts': 'acts',
  'amos': 'amos',
  'colossians': 'colossians',
  'daniel': 'daniel',
  'deuteronomy': 'deuteronomy',
  'ecclesiastes': 'ecclesiastes',
  'ephesians': 'ephesians',
  'esther': 'esther',
  'exodus': 'exodus',
  'ezekiel': 'ezekiel',
  'ezra': 'ezra',
  'galatians': 'galatians',
  'habakkuk': 'habakkuk',
  'haggai': 'haggai',
  'hebrews': 'hebrews',
  'hosea': 'hosea',
  'isaiah': 'isaiah',
  'james': 'james',
  'jeremiah': 'jeremiah',
  'job': 'job',
  'joel': 'joel',
  'john': 'john',
  'jonah': 'jonah',
  'joshua': 'joshua',
  'jude': 'jude',
  'judges': 'judges',
  'judith': 'judith',
  'lamentations': 'lamentations',
  'leviticus': 'leviticus',
  'luke': 'luke',
  'mark': 'mark',
  'matthew': 'matthew',
  'micah': 'micah',
  'nahum': 'nahum',
  'nehemiah': 'nehemiah',
  'numbers': 'numbers',
  'obadiah': 'obadiah',
  'philemon': 'philemon',
  'philippians': 'philippians',
  'proverbs': 'proverbs',
  'psalms': 'psalms',
  'revelation': 'revelation',
  'romans': 'romans',
  'ruth': 'ruth',
  'titus': 'titus',
  'tobit': 'tobit',
  'zephaniah': 'zephaniah',
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
 * Get display name for a database book name
 * Converts "2_peter" to "2 Peter", "song_of_solomon" to "Song of Solomon"
 */
export const getBookDisplayName = (dbBookName: string): string => {
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
