import { BIBLE_VERSION_CATALOG } from './bibleVersionCatalog'

export interface StoredBibleVersion {
  id: number
  apiCode: string
  name: string
  language: string
  isActive: boolean
}

export interface BibleVersionCreatePlan {
  code: string
  name: string
  language: string
}

export interface BibleVersionUpdatePlan {
  id: number
  name: string
  language: string
}

export interface BibleVersionDeactivatePlan {
  id: number
}

export interface BibleVersionReconciliationPlan {
  toCreate: BibleVersionCreatePlan[]
  toUpdate: BibleVersionUpdatePlan[]
  toDeactivate: BibleVersionDeactivatePlan[]
  catalogVersionIds: Record<string, number>
}

export const planBibleVersionReconciliation = (
  stored: StoredBibleVersion[]
): BibleVersionReconciliationPlan => {
  const storedByLowerCode = new Map<string, StoredBibleVersion>()
  stored.forEach((version) => {
    storedByLowerCode.set(version.apiCode.toLowerCase(), version)
  })

  const toCreate: BibleVersionCreatePlan[] = []
  const toUpdate: BibleVersionUpdatePlan[] = []
  const catalogVersionIds: Record<string, number> = {}
  const catalogCodes = new Set(BIBLE_VERSION_CATALOG.map((entry) => entry.code))

  BIBLE_VERSION_CATALOG.forEach((entry) => {
    const existing = storedByLowerCode.get(entry.code)

    if (!existing) {
      toCreate.push({ code: entry.code, name: entry.name, language: entry.language })
      return
    }

    catalogVersionIds[entry.code] = existing.id

    const needsUpdate =
      existing.name !== entry.name ||
      existing.language !== entry.language ||
      !existing.isActive

    if (needsUpdate) {
      toUpdate.push({ id: existing.id, name: entry.name, language: entry.language })
    }
  })

  const toDeactivate: BibleVersionDeactivatePlan[] = stored
    .filter(
      (version) => version.isActive && !catalogCodes.has(version.apiCode.toLowerCase())
    )
    .map((version) => ({ id: version.id }))

  return { toCreate, toUpdate, toDeactivate, catalogVersionIds }
}
