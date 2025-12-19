import fs from 'fs/promises'
import path from 'path'

interface LibraryVerseEntry {
  book: string
  chapter: number
  verseFrom: number
  verseTo: number
  theme: string
}

const LIBRARY_PATH = path.join(__dirname, '../../../storage/library')

let cachedLibrary: LibraryVerseEntry[] | null = null

/**
 * Load all verse references from the local library
 * Caches in memory after first load
 */
export const loadLibrary = async (): Promise<LibraryVerseEntry[]> => {
  if (cachedLibrary) return cachedLibrary

  const files = await fs.readdir(LIBRARY_PATH)
  const jsonFiles = files.filter(f => f.endsWith('.json'))

  const allVerses: LibraryVerseEntry[] = []

  for (const file of jsonFiles) {
    const filePath = path.join(LIBRARY_PATH, file)
    const content = await fs.readFile(filePath, 'utf-8')
    const verses = JSON.parse(content) as LibraryVerseEntry[]
    allVerses.push(...verses)
  }

  cachedLibrary = allVerses
  console.log(`📚 Loaded ${allVerses.length} verses from library`)

  return allVerses
}

/**
 * Get a random verse entry from the library
 */
export const getRandomLibraryEntry = async (): Promise<LibraryVerseEntry> => {
  const library = await loadLibrary()
  const randomIndex = Math.floor(Math.random() * library.length)
  return library[randomIndex]
}

/**
 * Normalize book name for consistency
 */
export const normalizeBookName = (book: string): string => {
  return book.toLowerCase().trim().replace(/\s+/g, '_')
}

/**
 * Create a unique reference key for a verse
 */
export const createReferenceKey = (
  book: string,
  chapter: number,
  verseFrom: number,
  verseTo: number
): string => {
  const normalized = normalizeBookName(book)
  return `${normalized}_${chapter}_${verseFrom}_${verseTo}`
}

/**
 * Format a verse reference for display
 */
export const formatReference = (
  bookName: string,
  chapter: number,
  verseFrom: number,
  verseTo: number
): string => {
  if (verseFrom === verseTo) {
    return `${bookName} ${chapter}:${verseFrom}`
  }
  return `${bookName} ${chapter}:${verseFrom}-${verseTo}`
}
