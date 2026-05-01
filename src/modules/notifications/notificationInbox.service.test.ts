import assert from 'node:assert/strict'
import test from 'node:test'
import { NotificationInboxType } from '@prisma/client'
import { buildInboxCopy, mergeActorPreview } from './notificationInbox.service'

test('mergeActorPreview prepends the newest actor and de-duplicates repeats', () => {
  const result = mergeActorPreview(
    [
      { id: 'a', name: 'Ana', avatar_url: null },
      { id: 'b', name: 'Beto', avatar_url: null },
    ],
    { id: 'b', name: 'Beto', avatar_url: null }
  )

  assert.deepEqual(result, [
    { id: 'b', name: 'Beto', avatar_url: null },
    { id: 'a', name: 'Ana', avatar_url: null },
  ])
})

test('mergeActorPreview keeps only the latest three actors', () => {
  const result = mergeActorPreview(
    [
      { id: 'a', name: 'Ana', avatar_url: null },
      { id: 'b', name: 'Beto', avatar_url: null },
      { id: 'c', name: 'Clau', avatar_url: null },
    ],
    { id: 'd', name: 'Dani', avatar_url: null }
  )

  assert.equal(result.length, 3)
  assert.deepEqual(result.map((item) => item.id), ['d', 'a', 'b'])
})

test('buildInboxCopy summarizes aggregated likes in Spanish', () => {
  const result = buildInboxCopy({
    type: NotificationInboxType.DEVOTIONAL_LIKE,
    devotionalTitle: 'Luz en medio del proceso',
    actorPreview: [{ id: 'a', name: 'Ana', avatar_url: null }],
    aggregateCount: 3,
  })

  assert.equal(result.title, 'Nuevos likes')
  assert.match(result.body, /Ana y 2 personas más reaccionaron/)
})

test('buildInboxCopy returns immediate follower copy', () => {
  const result = buildInboxCopy({
    type: NotificationInboxType.NEW_FOLLOWER,
    actorPreview: [{ id: 'a', name: 'Ana', avatar_url: null }],
    aggregateCount: 1,
  })

  assert.equal(result.title, 'Nuevo seguidor')
  assert.equal(result.body, 'Ana comenzó a seguirte.')
})
