/**
 * Map of Bible book names from English to Spanish
 */
const BOOK_NAME_MAP: Record<string, string> = {
  // Old Testament
  Genesis: 'Génesis',
  Exodus: 'Éxodo',
  Leviticus: 'Levítico',
  Numbers: 'Números',
  Deuteronomy: 'Deuteronomio',
  Joshua: 'Josué',
  Judges: 'Jueces',
  Ruth: 'Rut',
  '1 Samuel': '1 Samuel',
  '2 Samuel': '2 Samuel',
  '1 Kings': '1 Reyes',
  '2 Kings': '2 Reyes',
  '1 Chronicles': '1 Crónicas',
  '2 Chronicles': '2 Crónicas',
  Ezra: 'Esdras',
  Nehemiah: 'Nehemías',
  Esther: 'Ester',
  Job: 'Job',
  Psalms: 'Salmos',
  Psalm: 'Salmos',
  Proverbs: 'Proverbios',
  Ecclesiastes: 'Eclesiastés',
  'Song of Solomon': 'Cantares',
  'Song of Songs': 'Cantares',
  Isaiah: 'Isaías',
  Jeremiah: 'Jeremías',
  Lamentations: 'Lamentaciones',
  Ezekiel: 'Ezequiel',
  Daniel: 'Daniel',
  Hosea: 'Oseas',
  Joel: 'Joel',
  Amos: 'Amós',
  Obadiah: 'Abdías',
  Jonah: 'Jonás',
  Micah: 'Miqueas',
  Nahum: 'Nahúm',
  Habakkuk: 'Habacuc',
  Zephaniah: 'Sofonías',
  Haggai: 'Hageo',
  Zechariah: 'Zacarías',
  Malachi: 'Malaquías',

  // New Testament
  Matthew: 'Mateo',
  Mark: 'Marcos',
  Luke: 'Lucas',
  John: 'Juan',
  Acts: 'Hechos',
  Romans: 'Romanos',
  '1 Corinthians': '1 Corintios',
  '2 Corinthians': '2 Corintios',
  Galatians: 'Gálatas',
  Ephesians: 'Efesios',
  Philippians: 'Filipenses',
  Colossians: 'Colosenses',
  '1 Thessalonians': '1 Tesalonicenses',
  '2 Thessalonians': '2 Tesalonicenses',
  '1 Timothy': '1 Timoteo',
  '2 Timothy': '2 Timoteo',
  Titus: 'Tito',
  Philemon: 'Filemón',
  Hebrews: 'Hebreos',
  James: 'Santiago',
  '1 Peter': '1 Pedro',
  '2 Peter': '2 Pedro',
  '1 John': '1 Juan',
  '2 John': '2 Juan',
  '3 John': '3 Juan',
  Jude: 'Judas',
  Revelation: 'Apocalipsis',
}

/**
 * Translates a Bible book name from English to Spanish
 * @param bookName - The English book name
 * @returns The Spanish translation or the original name if no translation exists
 */
export const translateBookName = (bookName: string): string => {
  const trimmed = bookName.trim()
  return BOOK_NAME_MAP[trimmed] ?? trimmed
}

/**
 * Translates a Bible reference from English to Spanish
 * Replaces the book name while keeping the chapter and verse numbers
 * @param reference - The English reference (e.g., "Matthew 5:1-3")
 * @returns The Spanish reference (e.g., "Mateo 5:1-3")
 */
export const translateReference = (reference: string): string => {
  // Match pattern: Book Name Chapter:Verse or Book Name Chapter:Verse-Verse
  const match = reference.match(/^(.+?)\s+(\d+):(.+)$/)

  if (!match) {
    return reference // Return original if pattern doesn't match
  }

  const [, bookName, chapter, verses] = match
  const translatedBook = translateBookName(bookName.trim())

  return `${translatedBook} ${chapter}:${verses}`
}
