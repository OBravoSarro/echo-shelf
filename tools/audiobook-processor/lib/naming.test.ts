import { describe, expect, it } from 'vitest'
import { buildFolderName, chapterFileName, outputExtension, sanitizeSegment } from './naming.ts'

// Same regex as src/features/library/drive-scanner.ts, to guarantee the app understands our folders.
const SCANNER_AUTHOR_TITLE = /^([^-]{2,})\s+-\s+(.+)$/

describe('sanitizeSegment', () => {
  it('removes characters that are invalid in file names', () => {
    expect(sanitizeSegment('Cap. 1: "El inicio" / parte?')).toBe('Cap. 1 El inicio parte')
    expect(sanitizeSegment('   ')).toBe('Sin título')
    expect(sanitizeSegment('...oculto...')).toBe('oculto')
  })
})

describe('buildFolderName', () => {
  it('follows the "Author - Title (narrado por X)" layout parsed by the scanner', () => {
    const name = buildFolderName({ title: 'Dune', author: 'Frank Herbert', narrator: 'Simon Vance' })
    expect(name).toBe('Frank Herbert - Dune (narrado por Simon Vance)')
    expect(name.match(SCANNER_AUTHOR_TITLE)?.[1]).toBe('Frank Herbert')
  })

  it('keeps hyphenated authors parseable', () => {
    const name = buildFolderName({ title: 'La náusea', author: 'Jean-Paul Sartre', narrator: '' })
    expect(name.match(SCANNER_AUTHOR_TITLE)?.[2]).toBe('La náusea')
  })

  it('uses only the title when there is no author', () => {
    expect(buildFolderName({ title: 'Anónimo', author: ' ', narrator: '' })).toBe('Anónimo')
  })
})

describe('chapterFileName', () => {
  it('zero-pads so natural and lexical order match', () => {
    expect(chapterFileName(3, 12, 'Capítulo 3', 'm4a')).toBe('03 - Capítulo 3.m4a')
    expect(chapterFileName(7, 120, 'X', 'm4a')).toBe('007 - X.m4a')
    expect(chapterFileName(1, 2, '', 'mp3')).toBe('01 - Capítulo 1.mp3')
  })
})

describe('outputExtension', () => {
  it('always produces mp3 for iPhone-compatible outputs', () => {
    expect(outputExtension('mp3', true)).toBe('mp3')
    expect(outputExtension('mp3', false)).toBe('mp3')
    expect(outputExtension('aac', false)).toBe('mp3')
  })
})
