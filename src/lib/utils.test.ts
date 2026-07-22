import { describe, it, expect } from 'vitest'
import { cn, formatCurrency, formatPercent } from './utils'

describe('formatCurrency', () => {
  it('formats a positive amount as USD', () => {
    expect(formatCurrency(1234.5)).toBe('$1,234.50')
  })

  it('formats zero', () => {
    expect(formatCurrency(0)).toBe('$0.00')
  })

  it('formats negative amounts with a leading minus', () => {
    expect(formatCurrency(-12)).toBe('-$12.00')
  })
})

describe('formatPercent', () => {
  it('appends a percent sign with one decimal', () => {
    expect(formatPercent(33.333)).toBe('33.3%')
  })

  it('formats zero', () => {
    expect(formatPercent(0)).toBe('0.0%')
  })
})

describe('cn', () => {
  it('merges class names and resolves tailwind conflicts', () => {
    expect(cn('px-2 py-1', 'px-4')).toBe('py-1 px-4')
  })

  it('drops falsy values', () => {
    expect(cn('a', false, undefined, null, 'b')).toBe('a b')
  })
})
