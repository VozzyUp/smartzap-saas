import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const resolveTenantMock = vi.fn()
const isTenantBlockedMock = vi.fn()
const settingsGetMock = vi.fn()
const workflowVersionsOrderMock = vi.fn()
const campaignContactsLimitMock = vi.fn()
const shouldProcessStatusMock = vi.fn()
const recordStatusEventMock = vi.fn()
const markEventAttemptMock = vi.fn()
const enqueueStatusReconcileMock = vi.fn()
const applyCampaignStatusMock = vi.fn()
const handleDeliveryStatusMock = vi.fn()
const campaignContactsUpdateMock = vi.fn()
const rpcMock = vi.fn()

const supabaseFromMock = vi.fn((table: string) => {
  if (table === 'workflow_versions') {
    const query: any = { order: workflowVersionsOrderMock }
    query.eq = () => query
    return {
      select: () => query,
    }
  }

  if (table === 'campaign_contacts') {
    return {
      select: () => ({
        eq: () => ({
          limit: campaignContactsLimitMock,
        }),
      }),
      update: (patch: any) => {
        const chain: any = {
          eq: () => chain,
          neq: () => chain,
          select: async () => campaignContactsUpdateMock(patch),
        }
        return chain
      },
    }
  }

  throw new Error(`Tabela inesperada no teste: ${table}`)
})
vi.mock('@/lib/whatsapp-phone-numbers', () => ({
  resolveTenantByPhoneNumberId: (...a: any[]) => resolveTenantMock(...a),
}))
vi.mock('@/lib/supabase', () => ({
  getSupabaseAdmin: () => ({}),
  supabase: {
    from: (...a: [string]) => supabaseFromMock(...a),
    rpc: (...a: [string, any]) => rpcMock(...a),
  },
}))
vi.mock('@/lib/trial', () => ({
  isTenantBlocked: (...a: any[]) => isTenantBlockedMock(...a),
}))
vi.mock('@/lib/supabase-db', () => ({
  settingsDb: { get: (...a: any[]) => settingsGetMock(...a) },
}))
vi.mock('@/lib/whatsapp-webhook-dedupe', () => ({
  shouldProcessWhatsAppStatusEvent: (...a: any[]) => shouldProcessStatusMock(...a),
}))
vi.mock('@/lib/whatsapp-status-events', () => ({
  applyStatusUpdateToCampaignContact: (...a: any[]) => applyCampaignStatusMock(...a),
  enqueueWebhookStatusReconcileBestEffort: (...a: any[]) => enqueueStatusReconcileMock(...a),
  markEventAttempt: (...a: any[]) => markEventAttemptMock(...a),
  normalizeMetaStatus: (status: string) => status,
  recordStatusEvent: (...a: any[]) => recordStatusEventMock(...a),
  tryParseWebhookTimestampSeconds: (timestamp: string) => ({
    iso: new Date(Number(timestamp) * 1000).toISOString(),
    raw: timestamp,
  }),
}))
vi.mock('@/lib/inbox/inbox-webhook', () => ({
  handleInboundMessage: vi.fn(),
  handleDeliveryStatus: (...a: any[]) => handleDeliveryStatusMock(...a),
}))
// lib/builder/workflow-conversations.ts tem `import "server-only"`, que lança
// fora do build do Next (o pacote depende de aliasing do webpack que o Vitest
// não replica) — mockar em vez de deixar carregar o arquivo real.
vi.mock('@/lib/builder/workflow-conversations', () => ({
  getPendingConversation: vi.fn(async () => null),
}))

import { POST } from './route'

describe('webhook route — resolução de tenant', () => {
  beforeEach(() => {
    resolveTenantMock.mockReset()
    delete process.env.META_APP_SECRET
  })

  it('retorna 200 ignorado quando nenhum entry tem phone_number_id', async () => {
    const payload = {
      object: 'whatsapp_business_account',
      entry: [{ changes: [{ value: { metadata: {} } }] }],
    }
    const req = new NextRequest('http://localhost/api/webhook', {
      method: 'POST',
      body: JSON.stringify(payload),
    })
    const res = await POST(req)
    const json = await res.json()
    expect(res.status).toBe(200)
    expect(json.reason).toBe('no_phone_number_id')
    expect(resolveTenantMock).not.toHaveBeenCalled()
  })

  it('retorna 200 ignorado quando phone_number_id não está mapeado', async () => {
    resolveTenantMock.mockResolvedValueOnce(null)
    const payload = {
      object: 'whatsapp_business_account',
      entry: [{ changes: [{ value: { metadata: { phone_number_id: 'pn_desconhecido' } } }] }],
    }
    const req = new NextRequest('http://localhost/api/webhook', {
      method: 'POST',
      body: JSON.stringify(payload),
    })
    const res = await POST(req)
    const json = await res.json()
    expect(res.status).toBe(200)
    expect(json.reason).toBe('unknown_phone_number_id')
    expect(resolveTenantMock).toHaveBeenCalledWith('pn_desconhecido')
  })
})

describe('webhook route - status de entrega do Inbox', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    delete process.env.META_APP_SECRET
    resolveTenantMock.mockResolvedValue('tenant_1')
    isTenantBlockedMock.mockResolvedValue(false)
    settingsGetMock.mockResolvedValue(null)
    workflowVersionsOrderMock.mockResolvedValue({ data: [], error: null })
    campaignContactsLimitMock.mockResolvedValue({ data: [], error: null })
    shouldProcessStatusMock.mockResolvedValue(true)
    recordStatusEventMock.mockResolvedValue({ id: 'event_1' })
    markEventAttemptMock.mockResolvedValue(undefined)
    enqueueStatusReconcileMock.mockResolvedValue(undefined)
    handleDeliveryStatusMock.mockResolvedValue(true)
    campaignContactsUpdateMock.mockResolvedValue({ data: [{ id: 'cc_1' }], error: null })
    rpcMock.mockResolvedValue({ error: null })
  })

  it('status failed com campaign_contact correspondente: chama increment_campaign_stat com p_tenant_id (bug: RPC exige esse parâmetro desde 20260708000004)', async () => {
    campaignContactsLimitMock.mockResolvedValueOnce({
      data: [{ id: 'cc_1', status: 'sent', campaign_id: 'camp_1', phone: '+5511999999999', trace_id: null, delivered_at: null }],
      error: null,
    })

    const errors = [{ code: 131053, title: 'Media upload error' }]
    const payload = {
      object: 'whatsapp_business_account',
      entry: [{
        id: 'waba_1',
        changes: [{
          field: 'messages',
          value: {
            metadata: { phone_number_id: 'pn_1' },
            statuses: [{
              id: 'wamid.campaign_failed',
              recipient_id: '5511999999999',
              status: 'failed',
              timestamp: '1700000000',
              errors,
            }],
          },
        }],
      }],
    }
    const req = new NextRequest('http://localhost/api/webhook', {
      method: 'POST',
      body: JSON.stringify(payload),
    })

    const res = await POST(req)

    expect(res.status).toBe(200)
    expect(rpcMock).toHaveBeenCalledWith('increment_campaign_stat', {
      campaign_id_input: 'camp_1',
      field: 'failed',
      p_tenant_id: 'tenant_1',
    })
  })

  it('encaminha status failed ao Inbox mesmo sem campaign_contact correspondente', async () => {
    const errors = [{ code: 131053, title: 'Media upload error' }]
    const payload = {
      object: 'whatsapp_business_account',
      entry: [{
        id: 'waba_1',
        changes: [{
          field: 'messages',
          value: {
            metadata: { phone_number_id: 'pn_1' },
            statuses: [{
              id: 'wamid.inbox_failed',
              recipient_id: '5511999999999',
              status: 'failed',
              timestamp: '1700000000',
              errors,
            }],
          },
        }],
      }],
    }
    const req = new NextRequest('http://localhost/api/webhook', {
      method: 'POST',
      body: JSON.stringify(payload),
    })

    const res = await POST(req)

    expect(res.status).toBe(200)
    expect(recordStatusEventMock).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: 'tenant_1',
      messageId: 'wamid.inbox_failed',
      status: 'failed',
    }))
    expect(campaignContactsLimitMock).toHaveBeenCalledOnce()
    expect(handleDeliveryStatusMock).toHaveBeenCalledWith({
      messageId: 'wamid.inbox_failed',
      status: 'failed',
      timestamp: '2023-11-14T22:13:20.000Z',
      errors,
    })
  })

  it('retorna 500 para falha de integridade ao persistir o evento', async () => {
    applyCampaignStatusMock.mockResolvedValue({ reason: 'noop' })
    recordStatusEventMock.mockRejectedValue({
      code: '23502',
      message: 'null value in column "tenant_id" of relation "whatsapp_status_events" violates not-null constraint',
    })
    const req = new NextRequest('http://localhost/api/webhook', {
      method: 'POST',
      body: JSON.stringify({
        object: 'whatsapp_business_account',
        entry: [{
          changes: [{
            value: {
              metadata: { phone_number_id: 'pn_1' },
              statuses: [{ id: 'wamid.integrity_error', status: 'sent', timestamp: '1700000000' }],
            },
          }],
        }],
      }),
    })

    const res = await POST(req)

    expect(res.status).toBe(500)
    expect(await res.json()).toMatchObject({ error: 'Falha ao persistir evento do webhook (retry)' })
  })
})
