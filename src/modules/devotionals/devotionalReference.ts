export const formatPrimaryReferenceLabel = (reference?: {
  book: string
  chapter: number
  verseStart: number
  verseEnd: number | null
} | null) => {
  if (!reference) {
    return null
  }

  return `${reference.book} ${reference.chapter}:${reference.verseStart}${
    reference.verseEnd ? `-${reference.verseEnd}` : ''
  }`
}
