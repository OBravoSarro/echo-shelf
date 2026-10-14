import { describe, expect, it } from 'vitest'
import { compareSemver } from './app-version'

describe('compareSemver', () => {
  it('compares patch versions', () => {
    expect(compareSemver('0.1.1', '0.1.0')).toBe(1)
    expect(compareSemver('0.1.0', '0.1.1')).toBe(-1)
  })

  it('accepts v prefix', () => {
    expect(compareSemver('v0.2.0', '0.2.0')).toBe(0)
  })

  it('compares different length versions', () => {
    expect(compareSemver('0.2', '0.2.0')).toBe(0)
    expect(compareSemver('1.0.0', '0.9.9')).toBe(1)
  })
})
