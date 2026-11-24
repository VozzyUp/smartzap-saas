import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const m = vi.hoisted(() => ({
  getConversation: vi.fn(),
  listMessages: vi.fn(),
  createMessage: vi.fn(),
  updateConversation: vi.fn(),
  processChatAgent: vi.fn(),
  sendWhatsAppMessage: vi.fn(),
  sendTypingIndicator: vi.fn(),
  getActiveSuppressionsByPhone: vi.fn(),
  upsertPhoneSuppression: vi.fn(),
  resolveFunnelContext: vi.fn(),
  applyFunnelClassification: vi.fn(),
  triggerKanbanAutomationForAIReply: vi.fn(),
  sendHandoffNotification: vi.fn(),
  settingsGet: vi.fn(),
  notifyOpsAlert: vi.fn(),
  moveHuman: vi.fn(),
  agentRow: { value: null as any },
  order: [] as string[],
}))

vi.mock('@/lib/inbox/inbox-db', () => ({
  inboxDb: {
    getConversation: (...a: unknown[]) => m.getConversation(...a),
    listMessages: (...a: unknown[]) => m.listMessages(...a),
    createMessage: (...a: unknown[]) => m.createMessage(...a),
    updateConversation: (...a: unknown[]) => m.updateConversation(...a),
  },
}))
vi.mock('@/lib/ai/agents/chat-agent', () => ({ processChatAgent: (...a: unknown[]) => m.processChatAgent(...a) }))
vi.mock('@/lib/whatsapp-send', () => ({
  sendWhatsAppMessage: (...a: unknown[]) => m.sendWhatsAppMessage(...a),
  sendTypingIndicator: (...a: unknown[]) => m.sendTypingIndicator(...a),
}))
vi.mock('@/lib/redis', () => ({ redis: null }))
vi.mock('@/lib/trial', () => ({ isTenantBlocked: async () => false }))
vi.mock('@/lib/phone-formatter', () => ({ normalizePhoneNumber: (p: string) => (p.startsWith('+') ? p : `+${p}`) }))
vi.mock('@/lib/phone-suppressions', () => ({
  getActiveSuppressionsByPhone: (...a: unknown[]) => m.getActiveSuppressionsByPhone(...a),
  upsertPhoneSuppression: (...a: unknown[]) => m.upsertPhoneSuppression(...a),
}))
vi.mock('@/lib/ai/funnel-classifier', () => ({
  resolveFunnelContext: (...a: unknown[]) => m.resolveFunnelContext(...a),
  applyFunnelClassification: (...a: unknown[]) => {
    m.order.push('funnel')
    return m.applyFunnelClassification(...a)
  },
}))
vi.mock('./kanban-automation-hook', () => ({
  triggerKanbanAutomationForAIReply: (...a: unknown[]) => {
    m.order.push('automation')
    return m.triggerKanbanAutomationForAIReply(...a)
  },
}))
vi.mock('@/lib/supabase-db', () => ({ settingsDb: { get: (...a: unknown[]) => m.settingsGet(...a) } }))
vi.mock('@/lib/ops-alert', () => ({
  notifyOpsAlert: (...a: unknown[]) => m.notifyOpsAlert(...a),
  moveConversationToHumanForOps: (...a: unknown[]) => m.moveHuman(...a),
}))
vi.mock('@/lib/push-notifications', () => ({ sendHandoffNotification: (...a: unknown[]) => m.sendHandoffNotification(...a) }))
vi.mock('@/lib/supabase', () => ({
  getSupabaseAdmin: () => ({
    from: (table: string) => {
      const chain: any = {
        select: () => chain,
        eq: () => chain,
        single: async () => {
          if (table === 'inbox_conversations') return { data: { tenant_id: 'tenant-1' }, error: null }
          if (table === 'ai_agents') return { data: m.agentRow.value, error: null }
          if (table === 'contacts') return { data: { name: 'Maria', email: null, created_at: null }, error: null }
          return { data: null, error: null }
        },
      }
      return chain
    },
  }),
}))

import { POST } from './route'

function req() {
  return new NextRequest('http://localhost/api/ai/respond', {
    method: 'POST',
    body: JSON.stringify({ conversationId: 'conv1' }),
  })
}

const aiOk = (over: Record<string, unknown> = {}) => ({
  success: true,
  latencyMs: 5,
  logId: 'log1',
  response: { message: 'Olá!', sentiment: 'neutral', confidence: 0.9, shouldHandoff: false, ...over },
})

beforeEach(() => {
  vi.clearAllMocks()
  m.order.length = 0
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  m.getConversation.mockResolvedValue({ id: 'conv1', mode: 'bot', phone: '5511999999999', contact_id: 'c1', ai_agent_id: 'ag1', automation_paused_until: null })
  m.listMessages.mockResolvedValue({ messages: [{ id: 'm1', direction: 'inbound', content: 'oi', whatsapp_message_id: 'w1' }] })
  m.getActiveSuppressionsByPhone.mockResolvedValue(new Map())
  m.resolveFunnelContext.mockResolvedValue(null)
  m.applyFunnelClassification.mockResolvedValue('moved')
  m.processChatAgent.mockResolvedValue(aiOk())
  m.sendWhatsAppMessage.mockResolvedValue({ success: true, messageId: 'out1' })
  m.sendTypingIndicator.mockResolvedValue(undefined)
  m.createMessage.mockResolvedValue({})
  m.updateConversation.mockResolvedValue({})
  m.upsertPhoneSuppression.mockResolvedValue(undefined)
  m.triggerKanbanAutomationForAIReply.mockResolvedValue(undefined)
  m.sendHandoffNotification.mockResolvedValue({ sent: 1, failed: 0 })
  m.settingsGet.mockResolvedValue(null)
  m.notifyOpsAlert.mockResolvedValue(undefined)
  m.moveHuman.mockResolvedValue(undefined)
  m.agentRow.value = { id: 'ag1', name: 'Bot', model: 'x', is_active: true }
})

describe('POST /api/ai/respond — telefone suprimido (F02)', () => {
  it('não chama a IA nem envia nada quando o telefone está suprimido no tenant', async () => {
    m.getActiveSuppressionsByPhone.mockResolvedValue(new Map([['+5511999999999', { is_active: true }]]))
    const res = await POST(req())
    const body = await res.json()
    expect(body.skipped).toBe('phone_suppressed')
    expect(m.processChatAgent).not.toHaveBeenCalled()
    expect(m.sendWhatsAppMessage).not.toHaveBeenCalled()
    expect(m.getActiveSuppressionsByPhone).toHaveBeenCalledWith('tenant-1', expect.arrayContaining(['5511999999999', '+5511999999999']))
  })

  it('telefone não suprimido: responde normalmente', async () => {
    const res = await POST(req())
    expect((await res.json()).success).toBe(true)
    expect(m.sendWhatsAppMessage).toHaveBeenCalled()
  })

  it('erro ao consultar supressão: 500 (QStash tenta de novo) e não envia', async () => {
    m.getActiveSuppressionsByPhone.mockRejectedValue(new Error('db'))
    const res = await POST(req())
    expect(res.status).toBe(500)
    expect(m.sendWhatsAppMessage).not.toHaveBeenCalled()
  })
})

describe('POST /api/ai/respond — optOut decidido pela IA (F02)', () => {
  it('grava supressão (source ai_detected) e ainda envia a despedida', async () => {
    m.processChatAgent.mockResolvedValue(aiOk({ message: 'Tudo bem, não enviaremos mais.', optOut: true }))
    const res = await POST(req())
    expect((await res.json()).success).toBe(true)
    expect(m.upsertPhoneSuppression).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 'tenant-1', phone: '+5511999999999', source: 'ai_detected', isActive: true })
    )
    expect(m.sendWhatsAppMessage).toHaveBeenCalled()
  })

  it('falha ao gravar supressão: loga erro e ainda responde', async () => {
    m.processChatAgent.mockResolvedValue(aiOk({ optOut: true }))
    m.upsertPhoneSuppression.mockRejectedValue(new Error('db'))
    const res = await POST(req())
    expect((await res.json()).success).toBe(true)
    expect(console.error).toHaveBeenCalled()
    expect(m.sendWhatsAppMessage).toHaveBeenCalled()
  })

  it('sem optOut: não grava supressão', async () => {
    await POST(req())
    expect(m.upsertPhoneSuppression).not.toHaveBeenCalled()
  })
})

describe('POST /api/ai/respond — funil (F01)', () => {
  const ctx = { boardId: 'b1', boardName: 'V', stages: [{ id: 's1', name: 'Novo' }], currentStageName: null }

  it('passa o contexto do funil à IA e aplica a fase DEPOIS da automação (a IA prevalece)', async () => {
    m.resolveFunnelContext.mockResolvedValue(ctx)
    m.processChatAgent.mockResolvedValue(aiOk({ funnelStage: 'Novo' }))
    await POST(req())
    expect(m.processChatAgent).toHaveBeenCalledWith(expect.objectContaining({ funnel: ctx }))
    expect(m.applyFunnelClassification).toHaveBeenCalledWith('tenant-1', 'c1', ctx, 'Novo')
    expect(m.order).toEqual(['automation', 'funnel'])
  })

  it('sem quadro: não classifica', async () => {
    m.processChatAgent.mockResolvedValue(aiOk({ funnelStage: 'Novo' }))
    await POST(req())
    expect(m.applyFunnelClassification).not.toHaveBeenCalled()
  })

  it('funnelStage null: não aplica', async () => {
    m.resolveFunnelContext.mockResolvedValue(ctx)
    m.processChatAgent.mockResolvedValue(aiOk({ funnelStage: null }))
    await POST(req())
    expect(m.applyFunnelClassification).not.toHaveBeenCalled()
  })

  it('exceção ao aplicar o funil não impede a resposta ao lead', async () => {
    m.resolveFunnelContext.mockResolvedValue(ctx)
    m.processChatAgent.mockResolvedValue(aiOk({ funnelStage: 'Novo' }))
    m.applyFunnelClassification.mockRejectedValue(new Error('kanban'))
    const res = await POST(req())
    expect((await res.json()).success).toBe(true)
    expect(m.sendWhatsAppMessage).toHaveBeenCalled()
  })
})

describe('POST /api/ai/respond — aviso de handoff (F03)', () => {
  it('shouldHandoff: muda para humano e dispara push do tenant', async () => {
    m.processChatAgent.mockResolvedValue(aiOk({ shouldHandoff: true, handoffReason: 'pediu humano' }))
    await POST(req())
    expect(m.updateConversation).toHaveBeenCalledWith('tenant-1', 'conv1', { mode: 'human' })
    expect(m.sendHandoffNotification).toHaveBeenCalledWith(
      'tenant-1',
      expect.objectContaining({ conversationId: 'conv1', contactLabel: 'Maria', reason: 'pediu humano' })
    )
  })

  it('auto-handoff por erro da IA também avisa', async () => {
    m.processChatAgent.mockResolvedValue({ success: false, error: 'timeout', latencyMs: 1 })
    const res = await POST(req())
    expect((await res.json()).handedOff).toBe(true)
    expect(m.sendHandoffNotification).toHaveBeenCalledWith('tenant-1', expect.objectContaining({ conversationId: 'conv1' }))
  })

  it('falha do push só loga: handoff continua', async () => {
    m.processChatAgent.mockResolvedValue(aiOk({ shouldHandoff: true }))
    m.sendHandoffNotification.mockRejectedValue(new Error('push'))
    const res = await POST(req())
    expect((await res.json()).success).toBe(true)
  })

  it('sem handoff: não avisa', async () => {
    await POST(req())
    expect(m.sendHandoffNotification).not.toHaveBeenCalled()
  })
})

describe('POST /api/ai/respond — silêncio só para opt-out (F07)', () => {
  const sup = (source: string | null) => new Map([['+5511999999999', { is_active: true, source }]])

  it.each(['inbound_keyword', 'ai_detected', 'meta_opt_out_error'])('supressão %s silencia o robô', async (source) => {
    m.getActiveSuppressionsByPhone.mockResolvedValue(sup(source))
    const body = await (await POST(req())).json()
    expect(body.skipped).toBe('phone_suppressed')
    expect(m.sendWhatsAppMessage).not.toHaveBeenCalled()
  })

  it('supressão automática por falha de entrega NÃO silencia o robô', async () => {
    m.getActiveSuppressionsByPhone.mockResolvedValue(sup('auto_failure_policy'))
    const body = await (await POST(req())).json()
    expect(body.success).toBe(true)
    expect(body.skipped).toBeUndefined()
    expect(m.sendWhatsAppMessage).toHaveBeenCalled()
  })

  it('supressão manual (sem source) continua silenciando', async () => {
    m.getActiveSuppressionsByPhone.mockResolvedValue(sup(null))
    expect((await (await POST(req())).json()).skipped).toBe('phone_suppressed')
  })

  it('opt-out junto de falha automática: silencia', async () => {
    m.getActiveSuppressionsByPhone.mockResolvedValue(
      new Map([['5511999999999', { is_active: true, source: 'auto_failure_policy' }], ['+5511999999999', { is_active: true, source: 'inbound_keyword' }]])
    )
    expect((await (await POST(req())).json()).skipped).toBe('phone_suppressed')
  })
})

describe('POST /api/ai/respond — interruptor global de IA (F09)', () => {
  it('desligado: não chama a IA nem envia', async () => {
    m.settingsGet.mockResolvedValue('false')
    const body = await (await POST(req())).json()
    expect(body.skipped).toBe('ai_globally_disabled')
    expect(m.settingsGet).toHaveBeenCalledWith('tenant-1', 'ai_agents_global_enabled')
    expect(m.processChatAgent).not.toHaveBeenCalled()
    expect(m.sendWhatsAppMessage).not.toHaveBeenCalled()
  })

  it('sem a setting: ligado (comportamento atual)', async () => {
    m.settingsGet.mockResolvedValue(null)
    expect((await (await POST(req())).json()).success).toBe(true)
    expect(m.sendWhatsAppMessage).toHaveBeenCalled()
  })

  it('"true": ligado', async () => {
    m.settingsGet.mockResolvedValue('true')
    expect((await (await POST(req())).json()).success).toBe(true)
  })

  it('falha ao ler a setting: segue ligado', async () => {
    m.settingsGet.mockRejectedValue(new Error('db'))
    expect((await (await POST(req())).json()).success).toBe(true)
  })
})

describe('POST /api/ai/respond — alertas quando a IA não responde (F08)', () => {
  it('sem agente: 400, alerta e conversa vai para humano', async () => {
    m.agentRow.value = null
    const res = await POST(req())
    expect(res.status).toBe(400)
    expect(m.notifyOpsAlert).toHaveBeenCalledWith(expect.objectContaining({ tenantId: 'tenant-1', conversationId: 'conv1', type: 'ai_no_agent' }))
    expect(m.moveHuman).toHaveBeenCalledWith('tenant-1', 'conv1', expect.any(String))
  })

  it('agente inativo: alerta e conversa vai para humano', async () => {
    m.agentRow.value = { id: 'ag1', name: 'Bot', model: 'x', is_active: false }
    const body = await (await POST(req())).json()
    expect(body.reason).toBe('agent-not-active')
    expect(m.notifyOpsAlert).toHaveBeenCalledWith(expect.objectContaining({ type: 'ai_no_agent' }))
    expect(m.moveHuman).toHaveBeenCalled()
  })

  it('falha ao enviar TODAS as partes: alerta ai_send_failed e vai para humano', async () => {
    m.sendWhatsAppMessage.mockResolvedValue({ success: false, error: 'meta 131047' })
    await POST(req())
    expect(m.notifyOpsAlert).toHaveBeenCalledWith(expect.objectContaining({ tenantId: 'tenant-1', conversationId: 'conv1', type: 'ai_send_failed' }))
    expect(m.moveHuman).toHaveBeenCalledWith('tenant-1', 'conv1', expect.any(String))
  })

  it('envio ok: nenhum alerta', async () => {
    await POST(req())
    expect(m.notifyOpsAlert).not.toHaveBeenCalled()
    expect(m.moveHuman).not.toHaveBeenCalled()
  })
})
