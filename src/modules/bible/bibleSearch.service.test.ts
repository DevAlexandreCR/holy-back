import assert from 'node:assert/strict'
import test from 'node:test'
import { BOOK_ENTRIES } from './bookEntries'
import { resolveBookId } from './bookResolver'
import { filterAbbreviationsForOwnBook } from './bibleSearch.service'

test('filterAbbreviationsForOwnBook keeps only abbreviations that resolve back to the same book for every entry', () => {
  BOOK_ENTRIES.forEach((entry) => {
    const kept = filterAbbreviationsForOwnBook(entry)
    kept.forEach((abbreviation) => {
      assert.equal(
        resolveBookId(abbreviation),
        entry.id,
        `abbreviation "${abbreviation}" from ${entry.spanish} resolved to a different book`
      )
    })
  })
})

test('filterAbbreviationsForOwnBook never leaves a book without suggested abbreviations', () => {
  BOOK_ENTRIES.forEach((entry) => {
    const kept = filterAbbreviationsForOwnBook(entry)
    assert.ok(kept.length > 0, `${entry.spanish} (id ${entry.id}) was left with zero abbreviations`)
  })
})

test('filterAbbreviationsForOwnBook excludes Jud from Judges suggestions', () => {
  const judges = BOOK_ENTRIES.find((entry) => entry.english === 'Judges')
  assert.ok(judges, 'Judges entry not found in BOOK_ENTRIES')
  const kept = filterAbbreviationsForOwnBook(judges!)
  assert.ok(!kept.includes('Jud'), 'Judges suggestions still include Jud, which loads Jude')
  assert.ok(kept.length > 0, 'Judges should still have at least one abbreviation left')
})

test('filterAbbreviationsForOwnBook drops the known wrong-book abbreviations', () => {
  const cases: Array<{ english: string; abbreviation: string }> = [
    { english: 'Judges', abbreviation: 'Jud' },
    { english: 'Ezra', abbreviation: 'Ez' },
    { english: 'Jonah', abbreviation: 'Jn' },
    { english: 'Acts', abbreviation: 'He' },
    { english: 'Philemon', abbreviation: 'Fil' },
  ]

  cases.forEach(({ english, abbreviation }) => {
    const entry = BOOK_ENTRIES.find((candidate) => candidate.english === english)
    assert.ok(entry, `${english} entry not found in BOOK_ENTRIES`)
    const kept = filterAbbreviationsForOwnBook(entry!)
    assert.ok(
      !kept.includes(abbreviation),
      `${english} suggestions still include ${abbreviation}, which loads another book`
    )
  })
})
