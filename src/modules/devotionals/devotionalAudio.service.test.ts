import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildDevotionalNarrationHash,
  buildDevotionalNarrationText,
  buildNarrationSourceFromDevotional,
  chunkNarrationText,
} from './devotionalAudio.service'

test('buildNarrationSourceFromDevotional preserves title, primary reference, and body order', () => {
  const source = buildNarrationSourceFromDevotional({
    title: 'Dios sigue contigo',
    content: {
      ops: [
        { insert: 'Respira con calma.' },
        { insert: '\n\n' },
        { insert: 'Dios no te soltó hoy.' },
        { insert: '\n' },
      ],
    },
    verseReferences: [
      {
        book: 'Salmos',
        chapter: 46,
        verseStart: 1,
        verseEnd: null,
      },
    ],
  })

  assert.equal(source.title, 'Dios sigue contigo')
  assert.equal(source.primaryReferenceLabel, 'Salmos 46:1')
  assert.match(source.plainContent, /Respira con calma\./u)

  const narrationText = buildDevotionalNarrationText(source)
  assert.match(
    narrationText,
    /^Dios sigue contigo\n\nSalmos 46:1\n\nRespira con calma\./u,
  )
})

test('chunkNarrationText keeps every chunk under the configured limit', () => {
  const narrationText = [
    'A veces sientes que ya no puedes más, pero sigues intentando.',
    'Dios te ve en ese cansancio y no te abandona.',
    'Hoy puedes respirar, soltar el ruido y volver a confiar.',
  ].join('\n\n')

  const chunks = chunkNarrationText(narrationText, 55)

  assert.ok(chunks.length >= 2)
  assert.ok(chunks.every((chunk) => chunk.length <= 55))
  assert.ok(chunks.every((chunk) => chunk.trim().length > 0))
})

test('buildDevotionalNarrationHash changes when narration text changes', () => {
  const first = buildDevotionalNarrationHash(
    buildDevotionalNarrationText({
      title: 'Descansa en Dios',
      primaryReferenceLabel: 'Mateo 11:28',
      plainContent: 'Ven a mi y yo te hare descansar.',
    }),
  )
  const second = buildDevotionalNarrationHash(
    buildDevotionalNarrationText({
      title: 'Descansa en Dios',
      primaryReferenceLabel: 'Mateo 11:28',
      plainContent: 'Ven a mi y yo te dare descanso hoy.',
    }),
  )

  assert.notEqual(first, second)
})
