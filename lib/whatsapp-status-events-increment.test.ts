import { beforeEach, describe, expect, it, vi } from 'vitest'

// Harness de dispatch por chain do Supabase (select/update/rpc), no mesmo
// espírito dos outros testes desta sessão: cada operação lógica tem seu
// próprio vi.fn() para poder configurar retorno e asserir os argumentos.
const selectContactFn = vi.fn()
const updateContactFn = vi.fn()
const rpcFn = vi.fn()

function makeSelectChain() {
  return {
    eq: () => ({
      limit: async () => selectContactFn(),
    }),
  }
}

function makeUpdateChain(patch: any) {
  const chain: any = {
    eq: () => chain,
    neq: () => chain,
    is: () => chain,
    select: async () => updateContactFn(patch),
  }
  return chain
}

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: (table: string) => {
      if (table !== 'campaign_contacts') throw new Error(`unexpected table ${table}`)
      return {
        select: () => makeSelectChain(),
        update: (patch: any) => makeUpdateChain(patch),
      }
    },
    rpc: (name: string, args: any) => rpcFn(name, args),
  },
}))

import { applyStatusUpdateToCampaignContact } from './whatsapp-status-events'

describe('applyStatusUpdateToCampaignContact — increment_campaign_stat com p_tenant_id', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    rpcFn.mockResolvedValue({ error: null })
  })

  it('status failed: chama increment_campaign_stat com p_tenant_id (bug: RPC exige esse parâmetro desde 20260708000004)', async () => {
    selectContactFn.mockResolvedValueOnce({
      data: [{ id: 'cc_1', status: 'sent', campaign_id: 'camp_1', tenant_id: 'tenant_1', phone: '+5511999999999', trace_id: null, delivered_at: null }],
      error: null,
    })
    updateContactFn.mockResolvedValueOnce({ data: [{ id: 'cc_1' }], error: null })

    await applyStatusUpdateToCampaignContact({
      messageId: 'wamid.1',
      status: 'failed',
      eventTsIso: '2026-07-20T00:00:00.000Z',
      errors: [{ code: 131026, title: 'Undeliverable' }],
    })

    expect(rpcFn).toHaveBeenCalledWith('increment_campaign_stat', {
      campaign_id_input: 'camp_1',
      field: 'failed',
      p_tenant_id: 'tenant_1',
    })
  })

  it('status delivered: chama increment_campaign_stat com p_tenant_id', async () => {
    selectContactFn.mockResolvedValueOnce({
      data: [{ id: 'cc_2', status: 'sent', campaign_id: 'camp_2', tenant_id: 'tenant_2', phone: '+5511999999999', trace_id: null, delivered_at: null }],
      error: null,
    })
    updateContactFn.mockResolvedValueOnce({ data: [{ id: 'cc_2' }], error: null })

    await applyStatusUpdateToCampaignContact({
      messageId: 'wamid.2',
      status: 'delivered',
      eventTsIso: '2026-07-20T00:00:00.000Z',
    })

    expect(rpcFn).toHaveBeenCalledWith('increment_campaign_stat', {
      campaign_id_input: 'camp_2',
      field: 'delivered',
      p_tenant_id: 'tenant_2',
    })
  })
})
