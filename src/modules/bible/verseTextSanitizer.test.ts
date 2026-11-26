import assert from 'node:assert/strict'
import test from 'node:test'
import { sanitizeVerseText } from './verseTextSanitizer'

test('sanitizeVerseText replaces <br> variants with a space and collapses whitespace', () => {
  const input =
    '¡Oh Jehová,  cuánto se han multiplicado mis adversarios!<br> Muchos son los que se levantan contra mí.'
  const result = sanitizeVerseText(input)
  assert.equal(
    result,
    '¡Oh Jehová, cuánto se han multiplicado mis adversarios! Muchos son los que se levantan contra mí.',
  )
})

test('sanitizeVerseText removes <S>...</S> Strong\'s number annotations with their content', () => {
  const input = 'For<S>1063</S> God<S>2316</S> so<S>3779</S> loved<S>25</S> the world<S>2889</S>'
  const result = sanitizeVerseText(input)
  assert.equal(result, 'For God so loved the world')
})

test('sanitizeVerseText returns an empty string for empty input', () => {
  assert.equal(sanitizeVerseText(''), '')
})

test('sanitizeVerseText returns already-clean input unchanged', () => {
  const input = 'En el principio creó Dios los cielos y la tierra.'
  assert.equal(sanitizeVerseText(input), input)
})
