export const normalizeDevotionalTagValue = (value: string) =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()

export const DEVOTIONAL_TAG_DICTIONARY = [
  { key: 'esperanza', name: 'esperanza' },
  { key: 'ansiedad', name: 'ansiedad' },
  { key: 'proposito', name: 'propósito' },
  { key: 'disciplina', name: 'disciplina' },
  { key: 'fe', name: 'fe' },
  { key: 'trabajo', name: 'trabajo' },
  { key: 'relaciones', name: 'relaciones' },
  { key: 'oracion', name: 'oración' },
  { key: 'descanso', name: 'descanso' },
  { key: 'perdon', name: 'perdón' },
  { key: 'gratitud', name: 'gratitud' },
  { key: 'sabiduria', name: 'sabiduría' },
  { key: 'identidad', name: 'identidad' },
  { key: 'sanidad', name: 'sanidad' },
  { key: 'soledad', name: 'soledad' },
  { key: 'duelo', name: 'duelo' },
  { key: 'familia', name: 'familia' },
  { key: 'matrimonio', name: 'matrimonio' },
  { key: 'provision', name: 'provisión' },
  { key: 'obediencia', name: 'obediencia' },
] as const

export type DevotionalTagKey = (typeof DEVOTIONAL_TAG_DICTIONARY)[number]['key']
export type DevotionalTagName = (typeof DEVOTIONAL_TAG_DICTIONARY)[number]['name']

export const APPROVED_DEVOTIONAL_TAG_NAMES = DEVOTIONAL_TAG_DICTIONARY.map(
  (tag) => tag.name
)

export const findMatchingDevotionalTagName = (
  tagNames: readonly string[],
  candidate: string | null | undefined
) => {
  if (!candidate?.trim()) {
    return null
  }

  const normalizedCandidate = normalizeDevotionalTagValue(candidate)
  return (
    tagNames.find(
      (tagName) => normalizeDevotionalTagValue(tagName) === normalizedCandidate
    ) ?? null
  )
}

export const buildMissingDevotionalTagNames = (
  existingTagNames: readonly string[]
) => {
  const normalizedExisting = new Set(
    existingTagNames.map((tagName) => normalizeDevotionalTagValue(tagName))
  )

  return APPROVED_DEVOTIONAL_TAG_NAMES.filter(
    (tagName) => !normalizedExisting.has(normalizeDevotionalTagValue(tagName))
  )
}
