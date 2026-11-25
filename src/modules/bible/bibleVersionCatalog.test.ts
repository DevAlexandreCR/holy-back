import assert from 'node:assert/strict'
import test from 'node:test'
import {
  BIBLE_VERSION_CATALOG,
  DEFAULT_BIBLE_VERSION_CODE,
  findBibleVersionCatalogEntry,
} from './bibleVersionCatalog'

test('findBibleVersionCatalogEntry resolves the stored code rv1960', () => {
  const entry = findBibleVersionCatalogEntry('rv1960')

  assert.ok(entry)
  assert.equal(entry?.code, 'rv1960')
  assert.equal(entry?.providerCode, 'RV1960')
  assert.equal(entry?.name, 'Reina-Valera 1960')
  assert.equal(entry?.language, 'es')
})

test('findBibleVersionCatalogEntry is case-insensitive', () => {
  const entry = findBibleVersionCatalogEntry('RV1960')

  assert.ok(entry)
  assert.equal(entry?.code, 'rv1960')
  assert.equal(entry?.providerCode, 'RV1960')
})

test('findBibleVersionCatalogEntry returns undefined for an unsupported code', () => {
  assert.equal(findBibleVersionCatalogEntry('nvi'), undefined)
})

test('findBibleVersionCatalogEntry returns undefined for empty input', () => {
  assert.equal(findBibleVersionCatalogEntry(''), undefined)
})

test('DEFAULT_BIBLE_VERSION_CODE points at a catalog entry for Reina-Valera 1960', () => {
  assert.equal(DEFAULT_BIBLE_VERSION_CODE, 'rv1960')
  const entry = findBibleVersionCatalogEntry(DEFAULT_BIBLE_VERSION_CODE)
  assert.equal(entry?.name, 'Reina-Valera 1960')
})

test('BIBLE_VERSION_CATALOG offers exactly the three supported versions', () => {
  const codes = BIBLE_VERSION_CATALOG.map((entry) => entry.code).sort()
  assert.deepEqual(codes, ['kjv', 'pdt', 'rv1960'])
})
