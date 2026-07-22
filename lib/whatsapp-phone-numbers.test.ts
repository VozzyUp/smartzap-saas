import { describe, it, expect, vi, beforeEach } from 'vitest'

// --- Mocks nomeados por operação lógica (mesmo espírito do harness original:
// dispatch por colunas do .eq() para o vi.fn() certo). Generalizado para
// suportar chains com múltiplos .eq()/.order()/.limit(), que as novas
// funções da Task 2 precisam. ---
const upsertFn = vi.fn()
const upsertSelectFn = vi.fn()
const selectByPhoneFn = vi.fn()
const selectByTokenFn = vi.fn()
const selectActiveFn = vi.fn()
const selectFlowsActiveFn = vi.fn()
const selectByPhoneIdFn = vi.fn()
const listFn = vi.fn()
const promoteFn = vi.fn()
const updateFn = vi.fn()
const deactivateFn = vi.fn()
const activateFn = vi.fn()
const deleteFn = vi.fn()
const deleteByPhoneFn = vi.fn()

function dispatchSelect(cols: string, eqs: Record<string, any>, extra?: { order?: boolean }) {
  const keys = Object.keys(eqs)
  if (keys.length === 1 && eqs.phone_number_id !== undefined) {
    return selectByPhoneFn(eqs.phone_number_id)
  }
  if (keys.length === 1 && eqs.flows_webhook_token !== undefined) {
    return selectByTokenFn(eqs.flows_webhook_token)
  }
  if (keys.includes('tenant_id') && keys.includes('is_active') && cols === 'flows_webhook_token') {
    return selectFlowsActiveFn(eqs.tenant_id)
  }
  if (keys.includes('tenant_id') && keys.includes('is_active') && !extra) {
    return selectActiveFn(eqs.tenant_id)
  }
  if (keys.includes('tenant_id') && keys.includes('phone_number_id')) {
    return selectByPhoneIdFn(eqs.tenant_id, eqs.phone_number_id)
  }
  if (keys.length === 1 && eqs.tenant_id !== undefined && extra?.order && cols === 'phone_number_id') {
    return promoteFn(eqs.tenant_id)
  }
  if (keys.length === 1 && eqs.tenant_id !== undefined && extra?.order) {
    return listFn(eqs.tenant_id)
  }
  throw new Error(`unmapped select: cols=${cols} eqs=${JSON.stringify(eqs)} extra=${JSON.stringify(extra)}`)
}

function makeSelectChain(cols: string) {
  const eqs: Record<string, any> = {}
  const chain: any = {
    eq: (col: string, val: any) => {
      eqs[col] = val
      return chain
    },
    maybeSingle: () => dispatchSelect(cols, eqs),
    order: (_col: string, _opts?: any) => ({
      limit: (_n: number) => ({
        maybeSingle: () => dispatchSelect(cols, eqs, { order: true }),
      }),
      then: (resolve: any) => resolve(dispatchSelect(cols, eqs, { order: true })),
    }),
  }
  return chain
}

function dispatchUpdate(patch: any, eqs: Record<string, any>) {
  if (patch.flows_webhook_token !== undefined) return updateFn(patch, eqs)
  if (patch.is_active === false) return deactivateFn(patch, eqs)
  if (patch.is_active === true) return activateFn(patch, eqs)
  throw new Error(`unmapped update: patch=${JSON.stringify(patch)} eqs=${JSON.stringify(eqs)}`)
}

function makeUpdateChain(patch: any) {
  const eqs: Record<string, any> = {}
  const chain: any = {
    eq: (col: string, val: any) => {
      eqs[col] = val
      return chain
    },
    then: (resolve: any) => resolve(dispatchUpdate(patch, eqs)),
  }
  return chain
}

function dispatchDelete(eqs: Record<string, any>) {
  const keys = Object.keys(eqs)
  if (keys.length === 1 && eqs.tenant_id !== undefined) return deleteFn(eqs)
  if (keys.includes('tenant_id') && keys.includes('phone_number_id')) return deleteByPhoneFn(eqs)
  throw new Error(`unmapped delete: eqs=${JSON.stringify(eqs)}`)
}

function makeDeleteChain() {
  const eqs: Record<string, any> = {}
  const chain: any = {
    eq: (col: string, val: any) => {
      eqs[col] = val
      return chain
    },
    then: (resolve: any) => resolve(dispatchDelete(eqs)),
  }
  return chain
}

const saveAllMock = vi.fn(async () => {})
vi.mock('@/lib/supabase-db', () => ({
  settingsDb: {
    saveAll: (...a: any[]) => saveAllMock(...a),
  },
}))

vi.mock('@/lib/supabase', () => ({
  getSupabaseAdmin: () => ({
    from: (table: string) => {
      if (table !== 'whatsapp_phone_numbers') throw new Error(`unexpected table ${table}`)
      return {
        upsert: (row: any, opts: any) => {
          const base = upsertFn(row, opts) ?? {}
          return {
            error: base.error ?? null,
            select: (_cols: string) => ({
              single: () => upsertSelectFn(row, opts),
            }),
          }
        },
        select: (cols: string) => makeSelectChain(cols),
        update: (patch: any) => makeUpdateChain(patch),
        delete: () => makeDeleteChain(),
      }
    },
  }),
}))

import {
  upsertWhatsAppPhoneNumber,
  resolveTenantByPhoneNumberId,
  resolveTenantByFlowsWebhookToken,
  getOrCreateFlowsWebhookToken,
  clearWhatsAppPhoneNumber,
  getActiveWhatsAppNumber,
  getWhatsAppNumberByPhoneId,
  listWhatsAppNumbers,
  addWhatsAppNumber,
  setActiveWhatsAppNumber,
  removeWhatsAppNumber,
  mirrorActiveToSettings,
} from '@/lib/whatsapp-phone-numbers'

describe('whatsapp-phone-numbers', () => {
  beforeEach(() => {
    upsertFn.mockReset(); upsertSelectFn.mockReset()
    selectByPhoneFn.mockReset(); selectByTokenFn.mockReset()
    selectActiveFn.mockReset(); selectFlowsActiveFn.mockReset()
    selectByPhoneIdFn.mockReset(); listFn.mockReset(); promoteFn.mockReset()
    updateFn.mockReset(); deactivateFn.mockReset(); activateFn.mockReset()
    deleteFn.mockReset(); deleteByPhoneFn.mockReset()
    saveAllMock.mockClear()
  })

  it('upsertWhatsAppPhoneNumber faz upsert com onConflict phone_number_id', async () => {
    upsertFn.mockReturnValueOnce({ error: null })
    await upsertWhatsAppPhoneNumber('t1', { phoneNumberId: 'pn_1', businessAccountId: 'ba_1' })
    expect(upsertFn).toHaveBeenCalledWith(
      expect.objectContaining({ phone_number_id: 'pn_1', tenant_id: 't1', business_account_id: 'ba_1' }),
      expect.objectContaining({ onConflict: 'phone_number_id' })
    )
  })

  it('resolveTenantByPhoneNumberId retorna tenant_id quando encontra', async () => {
    selectByPhoneFn.mockResolvedValueOnce({ data: { tenant_id: 't1' }, error: null })
    const r = await resolveTenantByPhoneNumberId('pn_1')
    expect(r).toBe('t1')
  })

  it('resolveTenantByPhoneNumberId retorna null quando não encontra', async () => {
    selectByPhoneFn.mockResolvedValueOnce({ data: null, error: null })
    const r = await resolveTenantByPhoneNumberId('pn_desconhecido')
    expect(r).toBeNull()
  })

  it('resolveTenantByFlowsWebhookToken retorna tenant_id quando encontra', async () => {
    selectByTokenFn.mockResolvedValueOnce({ data: { tenant_id: 't2' }, error: null })
    const r = await resolveTenantByFlowsWebhookToken('fwh_abc')
    expect(r).toBe('t2')
  })

  it('getOrCreateFlowsWebhookToken retorna token existente sem gerar novo (filtra is_active=true)', async () => {
    selectFlowsActiveFn.mockResolvedValueOnce({ data: { flows_webhook_token: 'fwh_existing' }, error: null })
    const r = await getOrCreateFlowsWebhookToken('t1')
    expect(r).toBe('fwh_existing')
    expect(selectFlowsActiveFn).toHaveBeenCalledWith('t1')
    expect(updateFn).not.toHaveBeenCalled()
  })

  it('getOrCreateFlowsWebhookToken gera e persiste quando ausente (update filtra is_active=true)', async () => {
    selectFlowsActiveFn.mockResolvedValueOnce({ data: { flows_webhook_token: null }, error: null })
    updateFn.mockReturnValueOnce({ error: null })
    const r = await getOrCreateFlowsWebhookToken('t1')
    expect(r).toMatch(/^fwh_[a-f0-9]{32}$/)
    expect(updateFn).toHaveBeenCalledWith(
      expect.objectContaining({ flows_webhook_token: r }),
      expect.objectContaining({ tenant_id: 't1', is_active: true })
    )
  })

  it('getOrCreateFlowsWebhookToken lança se o tenant não tem número ativo ainda', async () => {
    selectFlowsActiveFn.mockResolvedValueOnce({ data: null, error: null })
    await expect(getOrCreateFlowsWebhookToken('t-sem-linha')).rejects.toThrow()
  })

  it('clearWhatsAppPhoneNumber deleta a linha do tenant', async () => {
    deleteFn.mockReturnValueOnce({ error: null })
    await clearWhatsAppPhoneNumber('t1')
    expect(deleteFn).toHaveBeenCalled()
  })

  it('getActiveWhatsAppNumber filtra tenant_id + is_active=true', async () => {
    const row = { phone_number_id: 'pn_1', tenant_id: 't1', business_account_id: 'ba_1', access_token: 'tok', display_label: null, is_active: true }
    selectActiveFn.mockResolvedValueOnce({ data: row, error: null })
    const r = await getActiveWhatsAppNumber('t1')
    expect(selectActiveFn).toHaveBeenCalledWith('t1')
    expect(r).toEqual(row)
  })

  it('getActiveWhatsAppNumber retorna null quando não há número ativo', async () => {
    selectActiveFn.mockResolvedValueOnce({ data: null, error: null })
    const r = await getActiveWhatsAppNumber('t1')
    expect(r).toBeNull()
  })

  it('getWhatsAppNumberByPhoneId filtra tenant_id + phone_number_id', async () => {
    const row = { phone_number_id: 'pn_1', tenant_id: 't1', business_account_id: 'ba_1', access_token: 'tok', display_label: null, is_active: false }
    selectByPhoneIdFn.mockResolvedValueOnce({ data: row, error: null })
    const r = await getWhatsAppNumberByPhoneId('t1', 'pn_1')
    expect(selectByPhoneIdFn).toHaveBeenCalledWith('t1', 'pn_1')
    expect(r).toEqual(row)
  })

  it('getWhatsAppNumberByPhoneId retorna null para número de outro tenant', async () => {
    selectByPhoneIdFn.mockResolvedValueOnce({ data: null, error: null })
    const r = await getWhatsAppNumberByPhoneId('t1', 'pn_de_outro_tenant')
    expect(r).toBeNull()
  })

  it('listWhatsAppNumbers retorna a projeção pública, sem access_token', async () => {
    const rows = [
      { phone_number_id: 'pn_1', tenant_id: 't1', business_account_id: 'ba_1', display_label: 'Principal', is_active: true },
      { phone_number_id: 'pn_2', tenant_id: 't1', business_account_id: null, display_label: null, is_active: false },
    ]
    listFn.mockResolvedValueOnce({ data: rows, error: null })
    const r = await listWhatsAppNumbers('t1')
    expect(listFn).toHaveBeenCalledWith('t1')
    expect(r).toEqual(rows)
    for (const item of r) {
      expect(item).not.toHaveProperty('access_token')
    }
  })

  it('addWhatsAppNumber insere is_active=true quando o tenant ainda não tem número', async () => {
    selectActiveFn.mockResolvedValueOnce({ data: null, error: null })
    const inserted = { phone_number_id: 'pn_1', tenant_id: 't1', business_account_id: 'ba_1', access_token: 'tok', display_label: null, is_active: true }
    upsertSelectFn.mockResolvedValueOnce({ data: inserted, error: null })
    const r = await addWhatsAppNumber('t1', { phoneNumberId: 'pn_1', businessAccountId: 'ba_1', accessToken: 'tok' })
    expect(upsertFn).toHaveBeenCalledWith(
      expect.objectContaining({ phone_number_id: 'pn_1', tenant_id: 't1', is_active: true }),
      expect.objectContaining({ onConflict: 'phone_number_id' })
    )
    expect(r).toEqual(inserted)
  })

  it('addWhatsAppNumber grava connection_type quando informado', async () => {
    selectActiveFn.mockResolvedValueOnce({ data: null, error: null })
    const inserted = { phone_number_id: 'pn_1', tenant_id: 't1', business_account_id: 'ba_1', access_token: 'tok', display_label: null, is_active: true, connection_type: 'coexistence' }
    upsertSelectFn.mockResolvedValueOnce({ data: inserted, error: null })
    await addWhatsAppNumber('t1', { phoneNumberId: 'pn_1', businessAccountId: 'ba_1', accessToken: 'tok', connectionType: 'coexistence' })
    expect(upsertFn).toHaveBeenCalledWith(
      expect.objectContaining({ connection_type: 'coexistence' }),
      expect.objectContaining({ onConflict: 'phone_number_id' })
    )
  })

  it('addWhatsAppNumber grava connection_type=null quando não informado (retrocompat)', async () => {
    selectActiveFn.mockResolvedValueOnce({ data: null, error: null })
    const inserted = { phone_number_id: 'pn_1', tenant_id: 't1', business_account_id: 'ba_1', access_token: 'tok', display_label: null, is_active: true, connection_type: null }
    upsertSelectFn.mockResolvedValueOnce({ data: inserted, error: null })
    await addWhatsAppNumber('t1', { phoneNumberId: 'pn_1', businessAccountId: 'ba_1', accessToken: 'tok' })
    expect(upsertFn).toHaveBeenCalledWith(
      expect.objectContaining({ connection_type: null }),
      expect.objectContaining({ onConflict: 'phone_number_id' })
    )
  })

  it('addWhatsAppNumber insere is_active=false quando o tenant já tem um número ativo', async () => {
    selectActiveFn.mockResolvedValueOnce({
      data: { phone_number_id: 'pn_1', tenant_id: 't1', business_account_id: 'ba_1', access_token: 'tok', display_label: null, is_active: true },
      error: null,
    })
    const inserted = { phone_number_id: 'pn_2', tenant_id: 't1', business_account_id: 'ba_1', access_token: 'tok2', display_label: null, is_active: false }
    upsertSelectFn.mockResolvedValueOnce({ data: inserted, error: null })
    const r = await addWhatsAppNumber('t1', { phoneNumberId: 'pn_2', businessAccountId: 'ba_1', accessToken: 'tok2' })
    expect(upsertFn).toHaveBeenCalledWith(
      expect.objectContaining({ phone_number_id: 'pn_2', tenant_id: 't1', is_active: false }),
      expect.objectContaining({ onConflict: 'phone_number_id' })
    )
    expect(r).toEqual(inserted)
  })

  it('setActiveWhatsAppNumber lança se o número não é do tenant (não desliga o ativo)', async () => {
    selectByPhoneIdFn.mockResolvedValueOnce({ data: null, error: null })
    await expect(setActiveWhatsAppNumber('t1', 'pn_de_outro')).rejects.toThrow()
    expect(deactivateFn).not.toHaveBeenCalled()
    expect(activateFn).not.toHaveBeenCalled()
  })

  it('setActiveWhatsAppNumber zera o ativo atual do tenant e liga o escolhido', async () => {
    selectByPhoneIdFn.mockResolvedValueOnce({
      data: { phone_number_id: 'pn_2', tenant_id: 't1', business_account_id: null, access_token: 'tok', display_label: null, is_active: false },
      error: null,
    })
    deactivateFn.mockReturnValueOnce({ error: null })
    activateFn.mockReturnValueOnce({ error: null })
    await setActiveWhatsAppNumber('t1', 'pn_2')
    expect(deactivateFn).toHaveBeenCalledWith(
      expect.objectContaining({ is_active: false }),
      expect.objectContaining({ tenant_id: 't1', is_active: true })
    )
    expect(activateFn).toHaveBeenCalledWith(
      expect.objectContaining({ is_active: true }),
      expect.objectContaining({ tenant_id: 't1', phone_number_id: 'pn_2' })
    )
  })

  it('removeWhatsAppNumber deleta a linha do número, escopado ao tenant', async () => {
    selectByPhoneIdFn.mockResolvedValueOnce({
      data: { phone_number_id: 'pn_2', tenant_id: 't1', business_account_id: null, access_token: 'tok', display_label: null, is_active: false },
      error: null,
    })
    deleteByPhoneFn.mockReturnValueOnce({ error: null })
    await removeWhatsAppNumber('t1', 'pn_2')
    expect(deleteByPhoneFn).toHaveBeenCalledWith(
      expect.objectContaining({ tenant_id: 't1', phone_number_id: 'pn_2' })
    )
    expect(promoteFn).not.toHaveBeenCalled()
  })

  it('removeWhatsAppNumber promove outro número quando o removido era o ativo', async () => {
    selectByPhoneIdFn.mockResolvedValueOnce({
      data: { phone_number_id: 'pn_1', tenant_id: 't1', business_account_id: null, access_token: 'tok', display_label: null, is_active: true },
      error: null,
    })
    deleteByPhoneFn.mockReturnValueOnce({ error: null })
    promoteFn.mockResolvedValueOnce({ data: { phone_number_id: 'pn_2' }, error: null })
    // o setActive aninhado revalida o alvo (guard de posse)
    selectByPhoneIdFn.mockResolvedValueOnce({
      data: { phone_number_id: 'pn_2', tenant_id: 't1', business_account_id: null, access_token: 'tok', display_label: null, is_active: false },
      error: null,
    })
    deactivateFn.mockReturnValueOnce({ error: null })
    activateFn.mockReturnValueOnce({ error: null })
    await removeWhatsAppNumber('t1', 'pn_1')
    expect(promoteFn).toHaveBeenCalledWith('t1')
    expect(activateFn).toHaveBeenCalledWith(
      expect.objectContaining({ is_active: true }),
      expect.objectContaining({ tenant_id: 't1', phone_number_id: 'pn_2' })
    )
  })

  it('removeWhatsAppNumber não promove ninguém quando o removido era o ativo mas não sobra outro número', async () => {
    selectByPhoneIdFn.mockResolvedValueOnce({
      data: { phone_number_id: 'pn_1', tenant_id: 't1', business_account_id: null, access_token: 'tok', display_label: null, is_active: true },
      error: null,
    })
    deleteByPhoneFn.mockReturnValueOnce({ error: null })
    promoteFn.mockResolvedValueOnce({ data: null, error: null })
    await removeWhatsAppNumber('t1', 'pn_1')
    expect(promoteFn).toHaveBeenCalledWith('t1')
    expect(activateFn).not.toHaveBeenCalled()
  })

  it('mirrorActiveToSettings espelha as credenciais do ativo com isConnected=true', async () => {
    selectActiveFn.mockResolvedValueOnce({
      data: { phone_number_id: 'pn_1', tenant_id: 't1', business_account_id: 'ba_1', access_token: 'tok', display_label: null, is_active: true },
      error: null,
    })
    await mirrorActiveToSettings('t1')
    expect(saveAllMock).toHaveBeenCalledWith('t1', {
      phoneNumberId: 'pn_1',
      businessAccountId: 'ba_1',
      accessToken: 'tok',
      isConnected: true,
    })
  })

  it('mirrorActiveToSettings zera settings com isConnected=false quando não há ativo', async () => {
    selectActiveFn.mockResolvedValueOnce({ data: null, error: null })
    await mirrorActiveToSettings('t1')
    expect(saveAllMock).toHaveBeenCalledWith('t1', {
      phoneNumberId: '',
      businessAccountId: '',
      accessToken: '',
      isConnected: false,
    })
  })
})
