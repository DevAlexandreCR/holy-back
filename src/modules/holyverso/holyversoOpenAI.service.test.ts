import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildHolyversoTextPrompt,
  HOLYVERSO_BLOCK_MAX_COUNT,
  HOLYVERSO_BLOCK_MAX_LENGTH,
  HOLYVERSO_BLOCK_MIN_COUNT,
  holyversoGeneratedDevotionalSchema,
} from './holyversoOpenAI.service'
import { HOLYVERSO_TONE_LIBRARY } from './holyverso.constants'

test('buildHolyversoTextPrompt requires the short-block editorial cadence', () => {
  const prompt = buildHolyversoTextPrompt({
    topicKey: 'ansiedad',
    excludedTopicKeys: ['gratitud', 'descanso'],
    attemptSeed: '2026-05-01-slot-1',
    toneKey: 'gentle-teacher',
  })

  assert.match(
    prompt,
    new RegExp(
      `recognition -> concrete tension -> hidden inner question -> biblical pivot -> reframing -> practical action -> memorable landing`,
      'u'
    )
  )
  assert.match(
    prompt,
    new RegExp(
      `Structure the devotional body in ${HOLYVERSO_BLOCK_MIN_COUNT} to ${HOLYVERSO_BLOCK_MAX_COUNT} short blocks`,
      'u'
    )
  )
  assert.match(prompt, /Address the reader directly in second person/u)
  assert.match(prompt, /Write for spoken listening as well as mobile reading/u)
  assert.match(prompt, /Prefer short, natural spoken sentences/u)
  assert.match(prompt, /generic churchy filler/u)
  assert.match(prompt, /confrontation plus a micro-action for today/u)
  assert.match(prompt, /brief final prayer inside the existing content blocks/u)

  const toneDescription = HOLYVERSO_TONE_LIBRARY.find(
    (tone) => tone.key === 'gentle-teacher'
  )?.description
  assert.ok(toneDescription)
  assert.ok(prompt.includes(`Voice profile: ${toneDescription}`))
})

test('holyversoGeneratedDevotionalSchema accepts the new short-block range', () => {
  const content = Array.from({ length: HOLYVERSO_BLOCK_MIN_COUNT }, (_, index) =>
    `Bloque ${index + 1} con tensión real, claridad bíblica y aplicación práctica.`
  )

  const parsed = holyversoGeneratedDevotionalSchema.parse({
    title: 'Dios sigue obrando en tu proceso',
    content,
    primary_reference: {
      book: 'Filipenses',
      chapter: 1,
      verse_start: 6,
      verse_end: null,
    },
    topic_key: 'ansiedad',
    image_brief:
      'Una escena íntima y contemplativa de madrugada, con luz cálida entrando en un espacio sencillo y transmitiendo esperanza serena.',
  })

  assert.equal(parsed.content.length, HOLYVERSO_BLOCK_MIN_COUNT)
})

test('holyversoGeneratedDevotionalSchema rejects content outside the new cadence limits', () => {
  assert.throws(() =>
    holyversoGeneratedDevotionalSchema.parse({
      title: 'Muy corto',
      content: Array.from(
        { length: HOLYVERSO_BLOCK_MIN_COUNT - 1 },
        (_, index) => `Bloque ${index + 1} suficientemente claro para la prueba.`
      ),
      primary_reference: {
        book: 'Filipenses',
        chapter: 1,
        verse_start: 6,
        verse_end: null,
      },
      topic_key: 'ansiedad',
      image_brief:
        'Una escena íntima y contemplativa de madrugada, con luz cálida entrando en un espacio sencillo y transmitiendo esperanza serena.',
    })
  )

  assert.throws(() =>
    holyversoGeneratedDevotionalSchema.parse({
      title: 'Muy largo',
      content: [
        ...Array.from(
          { length: HOLYVERSO_BLOCK_MIN_COUNT - 1 },
          (_, index) => `Bloque ${index + 1} suficientemente claro para la prueba.`
        ),
        'x'.repeat(HOLYVERSO_BLOCK_MAX_LENGTH + 1),
      ],
      primary_reference: {
        book: 'Filipenses',
        chapter: 1,
        verse_start: 6,
        verse_end: null,
      },
      topic_key: 'ansiedad',
      image_brief:
        'Una escena íntima y contemplativa de madrugada, con luz cálida entrando en un espacio sencillo y transmitiendo esperanza serena.',
    })
  )
})
