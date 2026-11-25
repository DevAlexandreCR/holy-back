import assert from 'node:assert/strict'
import test from 'node:test'
import {
  planBibleVersionReconciliation,
  StoredBibleVersion,
} from './bibleVersionReconciliation'

const stored = (overrides: Partial<StoredBibleVersion>): StoredBibleVersion => ({
  id: 1,
  apiCode: 'rv1960',
  name: 'Reina-Valera 1960',
  language: 'es',
  isActive: true,
  ...overrides,
})

test('matches stored codes case-insensitively and never rewrites api_code', () => {
  const plan = planBibleVersionReconciliation([
    stored({ id: 1, apiCode: 'RV1960', name: 'Reina-Valera 1960', language: 'es', isActive: true }),
    stored({ id: 2, apiCode: 'Pdt', name: 'Palabra de Dios para Todos', language: 'es', isActive: true }),
    stored({ id: 3, apiCode: 'KJV', name: 'King James Version', language: 'en', isActive: true }),
  ])

  assert.deepEqual(plan.toCreate, [])
  assert.deepEqual(plan.toUpdate, [])
  assert.deepEqual(plan.toDeactivate, [])
  assert.deepEqual(plan.catalogVersionIds, { rv1960: 1, pdt: 2, kjv: 3 })
})

test('deactivates retired versions that are currently active', () => {
  const plan = planBibleVersionReconciliation([
    stored({ id: 1, apiCode: 'rv1960', isActive: true }),
    stored({ id: 2, apiCode: 'pdt', name: 'Palabra de Dios para Todos', language: 'es', isActive: true }),
    stored({ id: 3, apiCode: 'kjv', name: 'King James Version', language: 'en', isActive: true }),
    stored({ id: 4, apiCode: 'nvi', name: 'Nueva Version Internacional', language: 'es', isActive: true }),
    stored({ id: 5, apiCode: 'dhh', name: 'Dios Habla Hoy', language: 'es', isActive: true }),
  ])

  assert.deepEqual(
    plan.toDeactivate.map((version) => version.id).sort(),
    [4, 5]
  )
})

test('does not re-deactivate a retired version that is already inactive', () => {
  const plan = planBibleVersionReconciliation([
    stored({ id: 1, apiCode: 'rv1960', isActive: true }),
    stored({ id: 2, apiCode: 'pdt', name: 'Palabra de Dios para Todos', language: 'es', isActive: true }),
    stored({ id: 3, apiCode: 'kjv', name: 'King James Version', language: 'en', isActive: true }),
    stored({ id: 4, apiCode: 'nvi', name: 'Nueva Version Internacional', language: 'es', isActive: false }),
  ])

  assert.deepEqual(plan.toDeactivate, [])
})

test('creates a catalog version missing from storage', () => {
  const plan = planBibleVersionReconciliation([
    stored({ id: 1, apiCode: 'rv1960', isActive: true }),
    stored({ id: 2, apiCode: 'kjv', name: 'King James Version', language: 'en', isActive: true }),
  ])

  assert.deepEqual(plan.toCreate, [
    { code: 'pdt', name: 'Palabra de Dios para Todos', language: 'es' },
  ])
  assert.equal(plan.catalogVersionIds.pdt, undefined)
})

test('a second run over the reconciled state produces an empty plan', () => {
  const initialStored: StoredBibleVersion[] = [
    stored({ id: 1, apiCode: 'RV1960', isActive: true }),
    stored({ id: 4, apiCode: 'nvi', name: 'Nueva Version Internacional', language: 'es', isActive: true }),
  ]

  const firstPlan = planBibleVersionReconciliation(initialStored)
  assert.deepEqual(firstPlan.toCreate, [
    { code: 'pdt', name: 'Palabra de Dios para Todos', language: 'es' },
    { code: 'kjv', name: 'King James Version', language: 'en' },
  ])
  assert.deepEqual(
    firstPlan.toDeactivate.map((version) => version.id),
    [4]
  )

  const reconciledStored: StoredBibleVersion[] = [
    stored({ id: 1, apiCode: 'RV1960', isActive: true }),
    stored({ id: 4, apiCode: 'nvi', name: 'Nueva Version Internacional', language: 'es', isActive: false }),
    stored({ id: 5, apiCode: 'pdt', name: 'Palabra de Dios para Todos', language: 'es', isActive: true }),
    stored({ id: 6, apiCode: 'kjv', name: 'King James Version', language: 'en', isActive: true }),
  ]

  const secondPlan = planBibleVersionReconciliation(reconciledStored)

  assert.deepEqual(secondPlan.toCreate, [])
  assert.deepEqual(secondPlan.toUpdate, [])
  assert.deepEqual(secondPlan.toDeactivate, [])
})
