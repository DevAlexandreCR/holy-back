import assert from 'node:assert/strict'
import test from 'node:test'
import { getLegacyAbbreviationForBookId, resolveBookId } from './bookResolver'
import { BOOK_API_CODE_MAP } from './bookApiMapping'
import { BOOK_DEFINITIONS } from './bookSearchData'
import { translateBookName } from './bookTranslations'

test('resolveBookId resolves the legacy abbreviation GN to Genesis', () => {
  assert.equal(resolveBookId('GN'), 1)
})

test('resolveBookId resolves the legacy abbreviation JUE to Judges', () => {
  assert.equal(resolveBookId('JUE'), 7)
})

test('resolveBookId resolves the legacy abbreviation 1S to 1 Samuel', () => {
  assert.equal(resolveBookId('1S'), 9)
})

test('resolveBookId resolves the English name genesis', () => {
  assert.equal(resolveBookId('genesis'), 1)
})

test('resolveBookId resolves the accented Spanish name Génesis', () => {
  assert.equal(resolveBookId('Génesis'), 1)
})

test('resolveBookId resolves the Spanish name juan to John', () => {
  assert.equal(resolveBookId('juan'), 43)
})

test('resolveBookId resolves the English name Nahum', () => {
  assert.equal(resolveBookId('Nahum'), 34)
})

test('resolveBookId resolves the accented Spanish name Nahúm', () => {
  assert.equal(resolveBookId('Nahúm'), 34)
})

test('resolveBookId resolves the Spanish alias Cantares to Song of Solomon', () => {
  assert.equal(resolveBookId('Cantares'), 22)
})

test('resolveBookId resolves the Spanish name 1 Reyes to 1 Kings', () => {
  assert.equal(resolveBookId('1 Reyes'), 11)
})

test('resolveBookId resolves the numeric id 43 to John', () => {
  assert.equal(resolveBookId('43'), 43)
})

test('resolveBookId does not resolve a near-miss typo of juan', () => {
  assert.equal(resolveBookId('jaun'), undefined)
})

test('resolveBookId does not resolve an unknown value', () => {
  assert.equal(resolveBookId('not-a-book'), undefined)
})

test('resolveBookId resolves the Spanish name juan to John even though it is also an alias of 1/2/3 John', () => {
  assert.equal(resolveBookId('juan'), 43)
})

test('resolveBookId resolves the English name john to John even though it is also an alias of 1/2/3 John', () => {
  assert.equal(resolveBookId('john'), 43)
})

test('resolveBookId resolves the Spanish name 1 juan to 1 John', () => {
  assert.equal(resolveBookId('1 juan'), 62)
})

test('resolveBookId resolves the English name 3 john to 3 John', () => {
  assert.equal(resolveBookId('3 john'), 64)
})

test('resolveBookId resolves the Spanish name Filipenses to Philippians', () => {
  assert.equal(resolveBookId('Filipenses'), 50)
})

test('resolveBookId resolves the Spanish name Filemon to Philemon', () => {
  assert.equal(resolveBookId('Filemon'), 57)
})

test('resolveBookId does not resolve the ambiguous alias jo (Josue vs Juan)', () => {
  assert.equal(resolveBookId('jo'), undefined)
})

test('resolveBookId does not resolve the ambiguous alias ju (Jueces vs Juan vs Judas)', () => {
  assert.equal(resolveBookId('ju'), undefined)
})

test('resolveBookId does not resolve the ambiguous alias ph (Efesios vs Filipenses vs Filemon)', () => {
  assert.equal(resolveBookId('ph'), undefined)
})

test('resolveBookId does not resolve the ambiguous alias peter (1 Peter vs 2 Peter)', () => {
  assert.equal(resolveBookId('peter'), undefined)
})

test('resolveBookId does not resolve the ambiguous alias es (Esdras vs Ester)', () => {
  assert.equal(resolveBookId('es'), undefined)
})

test('resolveBookId resolves ez to Ezekiel via its legacy abbreviation even though ez is also an ambiguous alias of Esdras', () => {
  assert.equal(resolveBookId('ez'), 26)
})

test('resolveBookId resolves every legacy abbreviation in BOOK_API_CODE_MAP to the book its normalized key names', () => {
  Object.entries(BOOK_API_CODE_MAP).forEach(([dbKey, abbreviation]) => {
    const idFromKey = resolveBookId(dbKey)
    const idFromAbbreviation = resolveBookId(abbreviation)

    assert.ok(
      idFromKey !== undefined,
      `expected normalized library name "${dbKey}" to resolve to a book id`
    )
    assert.ok(
      idFromAbbreviation !== undefined,
      `expected legacy abbreviation "${abbreviation}" to resolve to a book id`
    )
    assert.equal(
      idFromAbbreviation,
      idFromKey,
      `expected abbreviation "${abbreviation}" and library name "${dbKey}" to resolve to the same book`
    )
  })
})

test('resolveBookId resolves all 66 Spanish names from bookTranslations.ts to the right id', () => {
  BOOK_DEFINITIONS.forEach((book) => {
    const spanishName = translateBookName(book.english)
    assert.equal(
      resolveBookId(spanishName),
      book.id,
      `expected Spanish name "${spanishName}" to resolve to book id ${book.id}`
    )
  })
})

test('getLegacyAbbreviationForBookId round-trips with resolveBookId for every book', () => {
  for (let bookId = 1; bookId <= 66; bookId += 1) {
    const abbreviation = getLegacyAbbreviationForBookId(bookId)
    assert.ok(abbreviation, `expected book id ${bookId} to have a legacy abbreviation`)
    assert.equal(
      resolveBookId(abbreviation as string),
      bookId,
      `expected abbreviation "${abbreviation}" to resolve back to book id ${bookId}`
    )
  }
})
