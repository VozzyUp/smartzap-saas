import { describe, it, expect, vi, beforeEach } from 'vitest'

const maybeSingle = vi.fn()
vi.mock('@/lib/supabase', () => ({
  getSupabaseAdmin: () => ({
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle }) }) }),
  }),
}))

import { isTrialExpired, isTenantTrialExpired, isTenantBlocked } from '@/lib/trial'

describe('isTrialExpired', () => {
  it('NULL/undefined → false (sem limite)', () => {
    expect(isTrialExpired(null)).toBe(false)
    expect(isTrialExpired(undefined)).toBe(false)
  })
  it('futuro → false', () => {
    expect(isTrialExpired(new Date(Date.now() + 60_000).toISOString())).toBe(false)
  })
  it('passado → true', () => {
    expect(isTrialExpired(new Date(Date.now() - 60_000).toISOString())).toBe(true)
  })
})

describe('isTenantTrialExpired', () => {
  beforeEach(() => maybeSingle.mockReset())
  it('tenant com trial passado → true', async () => {
    maybeSingle.mockResolvedValue({ data: { trial_ends_at: new Date(Date.now() - 1000).toISOString() } })
    expect(await isTenantTrialExpired('t1')).toBe(true)
  })
  it('tenant com trial futuro → false', async () => {
    maybeSingle.mockResolvedValue({ data: { trial_ends_at: new Date(Date.now() + 60_000).toISOString() } })
    expect(await isTenantTrialExpired('t1')).toBe(false)
  })
  it('tenant sem linha ou erro → false (não derruba fluxo)', async () => {
    maybeSingle.mockResolvedValue({ data: null })
    expect(await isTenantTrialExpired('t1')).toBe(false)
  })
})

describe('isTenantBlocked', () => {
  beforeEach(() => maybeSingle.mockReset())
  it('suspenso → true (mesmo com trial ok)', async () => {
    maybeSingle.mockResolvedValue({ data: { status: 'suspended', trial_ends_at: new Date(Date.now() + 60_000).toISOString() } })
    expect(await isTenantBlocked('t1')).toBe(true)
  })
  it('ativo com trial expirado → true', async () => {
    maybeSingle.mockResolvedValue({ data: { status: 'active', trial_ends_at: new Date(Date.now() - 1000).toISOString() } })
    expect(await isTenantBlocked('t1')).toBe(true)
  })
  it('ativo com trial ok → false', async () => {
    maybeSingle.mockResolvedValue({ data: { status: 'active', trial_ends_at: null } })
    expect(await isTenantBlocked('t1')).toBe(false)
  })
  it('sem linha → false (fail-safe)', async () => {
    maybeSingle.mockResolvedValue({ data: null })
    expect(await isTenantBlocked('t1')).toBe(false)
  })
})
