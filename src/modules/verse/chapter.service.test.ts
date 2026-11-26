import assert from 'node:assert/strict'
import test from 'node:test'
import { selectEffectiveVersionCode } from './chapter.service'

test('selectEffectiveVersionCode keeps an active catalog version', () => {
  const code = selectEffectiveVersionCode({ apiCode: 'pdt', isActive: true })

  assert.equal(code, 'pdt')
})

test('selectEffectiveVersionCode falls back to rv1960 for a retired version', () => {
  const code = selectEffectiveVersionCode({ apiCode: 'nvi', isActive: false })

  assert.equal(code, 'rv1960')
})

test('selectEffectiveVersionCode keeps an active version regardless of stored case', () => {
  const code = selectEffectiveVersionCode({ apiCode: 'RV1960', isActive: true })

  assert.equal(code, 'RV1960')
})

test('selectEffectiveVersionCode falls back to rv1960 for a retired version regardless of stored case', () => {
  const code = selectEffectiveVersionCode({ apiCode: 'NVI', isActive: false })

  assert.equal(code, 'rv1960')
})
