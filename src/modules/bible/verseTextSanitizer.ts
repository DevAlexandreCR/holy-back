const STRONGS_TAG_REGEX = /<S>.*?<\/S>/gis
const BR_TAG_REGEX = /<br\s*\/?>/gi
const ANY_TAG_REGEX = /<[^>]*>/g
const WHITESPACE_REGEX = /\s+/g

export const sanitizeVerseText = (text: string): string => {
  return text
    .replace(STRONGS_TAG_REGEX, '')
    .replace(BR_TAG_REGEX, ' ')
    .replace(ANY_TAG_REGEX, '')
    .replace(WHITESPACE_REGEX, ' ')
    .trim()
}

export default sanitizeVerseText
