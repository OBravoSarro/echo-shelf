import { describe, expect, it } from 'vitest'
import type { BookCollection } from '../../domain/audiobook'
import { activeCollections, applyBookMembership, findCollectionByName, mergeCollections, normalizeCollectionName } from './collection-utils'

const make = (id: string, patch: Partial<BookCollection> = {}): BookCollection => ({
  id,
  name: id,
  bookIds: [],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...patch,
})

describe('collection utils', () => {
  it('normalizes names', () => {
    expect(normalizeCollectionName('  Ciencia   ficcion ')).toBe('Ciencia ficcion')
    expect(normalizeCollectionName('   ')).toBe('')
    expect(normalizeCollectionName('x'.repeat(100))).toHaveLength(60)
  })

  it('finds collections by name ignoring case and accents', () => {
    const list = [make('a', { name: 'Fantasía' }), make('b', { name: 'Borrada', deleted: true })]
    expect(findCollectionByName(list, ' fantasia ')?.id).toBe('a')
    expect(findCollectionByName(list, 'borrada')).toBeUndefined()
  })

  it('lists active collections by creation date', () => {
    const records = {
      b: make('b', { createdAt: '2026-02-01T00:00:00.000Z' }),
      a: make('a'),
      c: make('c', { deleted: true }),
    }
    expect(activeCollections(records).map((item) => item.id)).toEqual(['a', 'b'])
  })

  it('merges remote and local with last write wins', () => {
    const local = {
      newer: make('newer', { updatedAt: '2026-03-01T00:00:00.000Z' }),
      older: make('older'),
      onlyLocal: make('onlyLocal'),
    }
    const remote = [
      make('newer'),
      make('older', { updatedAt: '2026-03-01T00:00:00.000Z', deleted: true }),
      make('onlyRemote'),
    ]
    const { toApply, toPush } = mergeCollections(local, remote)
    expect(toApply.map((item) => item.id).sort()).toEqual(['older', 'onlyRemote'])
    expect(toPush.map((item) => item.id).sort()).toEqual(['newer', 'onlyLocal'])
  })

  it('computes membership changes for a book', () => {
    const list = [make('a', { bookIds: ['x', 'book'] }), make('b', { bookIds: ['x'] }), make('c', { bookIds: ['book'] })]
    const changes = applyBookMembership(list, 'book', new Set(['b', 'c']))
    expect(changes).toEqual([
      { id: 'a', bookIds: ['x'] },
      { id: 'b', bookIds: ['x', 'book'] },
    ])
  })
})
