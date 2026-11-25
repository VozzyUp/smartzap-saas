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
  ensureAudio: vi.fn(),
  agentRow: { value: null as any },
  order: [] as string[],
  redis: { value: null as any },
  publish: vi.fn(),
}))

vi.mock('@/lib/inbox/inbox-db', () => ({
  inboxDb: {
    getConversation: (...a: unknown[]) => m.getConversation(...a),
    listMessages: (...a: unknown[]) => m.listMessages(...a),
    createMessage: (...a: unknown[]) => m.createMessage(...a),
    updateConversation: (...a: unknown[]) => m.updateConversation(...a),
  },
}))
vi.mock('@/lib/inbox/inbox-transcription', () => ({
  ensureAudioTranscriptions: (...a: unknown[]) => m.ensureAudio(...a),
}))
vi.mock('@/lib/ai/agents/chat-agent', () => ({ processChatAgent: (...a: unknown[]) => m.processChatAgent(...a) }))
vi.mock('@/lib/whatsapp-send', () => ({
  sendWhatsAppMessage: (...a: unknown[]) => m.sendWhatsAppMessage(...a),
  sendTypingIndicator: (...a: unknown[]) => m.sendTypingIndicator(...a),
}))
vi.mock('@/lib/redis', () => ({
  get redis() {
    return m.redis.value
  },
}))
vi.mock('@upstash/qstash', () => ({
  Client: class {
    publishJSON(...a: unknown[]) {
      return m.publish(...a)
    }
  },
}))
vi.mock('@/lib/app-url', () => ({ getAppUrl: () => 'http://app.test' }))
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

function req(extra: Record<string, unknown> = {}) {
  return new NextRequest('http://localhost/api/ai/respond', {
    method: 'POST',
    body: JSON.stringify({ conversationId: 'conv1', ...extra }),
  })
}

/** Redis em memória com o subconjunto usado pela rota (SET NX/EX, GET, DEL, EVAL de compare-and-delete). */
function fakeRedis() {
  const store = new Map<string, unknown>()
  return {
    store,
    get: async (k: string) => (store.has(k) ? store.get(k) : null),
    set: async (k: string, v: unknown, opts?: { nx?: boolean }) => {
      if (opts?.nx && store.has(k)) return null
      store.set(k, v)
      return 'OK'
    },
    setex: async (k: string, _t: number, v: unknown) => {
      store.set(k, v)
      return 'OK'
    },
    del: async (k: string) => (store.delete(k) ? 1 : 0),
    eval: async (_script: string, keys: string[], args: string[]) => {
      if (store.get(keys[0]) === args[0]) return store.delete(keys[0]) ? 1 : 0
      return 0
    },
  }
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
  m.ensureAudio.mockImplementation(async (_t: string, msgs: unknown[]) => msgs)
  m.agentRow.value = { id: 'ag1', name: 'Bot', model: 'x', is_active: true }
  m.redis.value = null
  m.publish.mockResolvedValue({ messageId: 'q1' })
  process.env.QSTASH_TOKEN = 'tok'
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

describe('POST /api/ai/respond — transcrição de áudio (F16)', () => {
  it('transcreve os áudios antes de montar o contexto e entrega as mensagens atualizadas à IA', async () => {
    const original = [{ id: 'a1', direction: 'inbound', message_type: 'audio', content: '', whatsapp_message_id: 'w1' }]
    const updated = [{ ...original[0], payload: { transcription: { text: 'quero o preço' } } }]
    m.listMessages.mockResolvedValue({ messages: original })
    m.ensureAudio.mockResolvedValue(updated)
    await POST(req())
    expect(m.ensureAudio).toHaveBeenCalledWith('tenant-1', original)
    expect(m.processChatAgent).toHaveBeenCalledWith(expect.objectContaining({ messages: updated }))
  })

  it('falha inesperada na transcrição não impede a IA de responder', async () => {
    m.ensureAudio.mockRejectedValue(new Error('boom'))
    const res = await POST(req())
    expect((await res.json()).success).toBe(true)
    expect(m.processChatAgent).toHaveBeenCalled()
    expect(m.sendWhatsAppMessage).toHaveBeenCalled()
  })
})

describe('POST /api/ai/respond — bloqueado que volta a escrever vai para humano', () => {
  const sup = (source: string | null) => new Map([['+5511999999999', { is_active: true, source }]])
  const inbound = (content: string) =>
    m.listMessages.mockResolvedValue({ messages: [{ id: 'm1', direction: 'inbound', content, whatsapp_message_id: 'w1' }] })

  it('bloqueado manda "não tenho interesse": pula em silêncio, sem humano nem aviso', async () => {
    m.getActiveSuppressionsByPhone.mockResolvedValue(sup('inbound_keyword'))
    inbound('Não tenho interesse')
    const body = await (await POST(req())).json()
    expect(body.skipped).toBe('phone_suppressed')
    expect(m.moveHuman).not.toHaveBeenCalled()
    expect(m.sendHandoffNotification).not.toHaveBeenCalled()
    expect(m.processChatAgent).not.toHaveBeenCalled()
    expect(m.sendWhatsAppMessage).not.toHaveBeenCalled()
  })

  it('bloqueado manda "Oi": sem resposta da IA, conversa vai para humano e o dono é avisado', async () => {
    m.getActiveSuppressionsByPhone.mockResolvedValue(sup('inbound_keyword'))
    inbound('Oi')
    const body = await (await POST(req())).json()
    expect(body.skipped).toBe('phone_suppressed')
    expect(m.processChatAgent).not.toHaveBeenCalled()
    expect(m.sendWhatsAppMessage).not.toHaveBeenCalled()
    expect(m.moveHuman).toHaveBeenCalledWith('tenant-1', 'conv1', expect.stringContaining('pediu para parar'))
    expect(m.sendHandoffNotification).toHaveBeenCalledTimes(1)
    expect(m.sendHandoffNotification).toHaveBeenCalledWith(
      'tenant-1',
      expect.objectContaining({ conversationId: 'conv1', reason: expect.stringContaining('pediu para parar') })
    )
  })

  it('falha no aviso ou na troca de modo não vira resposta da IA', async () => {
    m.getActiveSuppressionsByPhone.mockResolvedValue(sup('ai_detected'))
    inbound('Oi')
    m.moveHuman.mockRejectedValue(new Error('db'))
    m.sendHandoffNotification.mockRejectedValue(new Error('push'))
    const res = await POST(req())
    expect((await res.json()).skipped).toBe('phone_suppressed')
    expect(m.processChatAgent).not.toHaveBeenCalled()
    expect(m.sendWhatsAppMessage).not.toHaveBeenCalled()
  })

  it('supressão auto_failure_policy continua sendo atendida pela IA, sem humano nem aviso', async () => {
    m.getActiveSuppressionsByPhone.mockResolvedValue(sup('auto_failure_policy'))
    inbound('Oi')
    const body = await (await POST(req())).json()
    expect(body.success).toBe(true)
    expect(m.sendWhatsAppMessage).toHaveBeenCalled()
    expect(m.moveHuman).not.toHaveBeenCalled()
    expect(m.sendHandoffNotification).not.toHaveBeenCalled()
  })
})


describe('POST /api/ai/respond — uma rodada por conversa (resposta em dobro)', () => {
  const inboundBoth = [
    { id: 'm1', direction: 'inbound', content: 'saudação automática', whatsapp_message_id: 'w1' },
    { id: 'm2', direction: 'inbound', content: 'ausência automática', whatsapp_message_id: 'w2' },
  ]

  it('(a) dois jobs concorrentes da mesma conversa (mensagens diferentes juntas): agente 1x, uma resposta', async () => {
    m.redis.value = fakeRedis()
    m.listMessages.mockResolvedValue({ messages: inboundBoth })
    let release!: () => void
    m.processChatAgent.mockImplementation(
      () => new Promise((resolve) => { release = () => resolve(aiOk()) })
    )
    const p1 = POST(req({ messageId: 'w1', debounceMs: 12000 }))
    const p2 = POST(req({ messageId: 'w2', debounceMs: 12000 }))
    await new Promise((r) => setTimeout(r, 50))
    release()
    await Promise.all([p1, p2])
    expect(m.processChatAgent).toHaveBeenCalledTimes(1)
    expect(m.sendWhatsAppMessage).toHaveBeenCalledTimes(1)
  })

  it('(a2) chave ai:lastmsg ausente com dois jobs: continua uma rodada só', async () => {
    m.redis.value = fakeRedis()
    m.listMessages.mockResolvedValue({ messages: inboundBoth })
    // dois jobs sequenciais depois do atraso, sem ai:lastmsg (expirou ou foi apagada)
    await POST(req({ messageId: 'w1', debounceMs: 12000 }))
    await POST(req({ messageId: 'w2', debounceMs: 12000 }))
    expect(m.processChatAgent).toHaveBeenCalledTimes(1)
    expect(m.sendWhatsAppMessage).toHaveBeenCalledTimes(1)
  })

  it('(b) job cuja mensagem já foi coberta por rodada anterior não chama o agente', async () => {
    const r = fakeRedis()
    r.store.set('ai:covered:conv1', ['w1', 'w2'])
    m.redis.value = r
    const res = await POST(req({ messageId: 'w2' }))
    expect((await res.json()).reason).toBe('already-covered')
    expect(m.processChatAgent).not.toHaveBeenCalled()
    expect(m.sendWhatsAppMessage).not.toHaveBeenCalled()
  })

  it('(c) mensagem nova durante rodada em andamento não se perde: é reagendada sem deduplicationId', async () => {
    const r = fakeRedis()
    r.store.set('ai:lock:conv1', 'outra-rodada')
    m.redis.value = r
    const res = await POST(req({ messageId: 'w3', debounceMs: 12000 }))
    expect((await res.json()).rescheduled).toBe(true)
    expect(m.processChatAgent).not.toHaveBeenCalled()
    expect(m.publish).toHaveBeenCalledTimes(1)
    const arg = m.publish.mock.calls[0][0]
    expect(arg.body).toMatchObject({ conversationId: 'conv1', messageId: 'w3', attempt: 1 })
    expect(arg.delay).toBeGreaterThan(0)
    expect(arg.deduplicationId).toBeUndefined()
    expect(r.store.get('ai:lock:conv1')).toBe('outra-rodada') // não liberou trava alheia
  })

  it('(c2) reagendamento esgotado: para de insistir', async () => {
    const r = fakeRedis()
    r.store.set('ai:lock:conv1', 'outra-rodada')
    m.redis.value = r
    const res = await POST(req({ messageId: 'w3', attempt: 99 }))
    expect((await res.json()).reason).toBe('lock-timeout')
    expect(m.publish).not.toHaveBeenCalled()
  })

  it('(c3) job reagendado (attempt>0) com mesmo messageId passa pela trava de mensagem e processa', async () => {
    const r = fakeRedis()
    r.store.set('ai:processed:w3', 'antes')
    m.redis.value = r
    m.listMessages.mockResolvedValue({ messages: [{ id: 'm3', direction: 'inbound', content: 'x', whatsapp_message_id: 'w3' }] })
    await POST(req({ messageId: 'w3', attempt: 1 }))
    expect(m.processChatAgent).toHaveBeenCalledTimes(1)
  })

  it('(d) a trava é liberada (e o marcador desfeito) quando a rodada falha com exceção', async () => {
    const r = fakeRedis()
    m.redis.value = r
    m.processChatAgent.mockRejectedValue(new Error('boom'))
    const res = await POST(req({ messageId: 'w1' }))
    expect(res.status).toBe(500)
    expect(r.store.has('ai:lock:conv1')).toBe(false)
    expect(r.store.has('ai:covered:conv1')).toBe(false)
  })

  it('trava liberada também no caminho feliz', async () => {
    const r = fakeRedis()
    m.redis.value = r
    await POST(req({ messageId: 'w1' }))
    expect(r.store.has('ai:lock:conv1')).toBe(false)
    expect(r.store.get('ai:covered:conv1')).toEqual(['w1'])
  })

  it('mesma mensagem entregue duas vezes em paralelo: trava por messageId atômica, 1 rodada', async () => {
    m.redis.value = fakeRedis()
    await Promise.all([POST(req({ messageId: 'w1' })), POST(req({ messageId: 'w1' }))])
    expect(m.processChatAgent).toHaveBeenCalledTimes(1)
  })

  it('(e) sem Redis, uma mensagem única continua sendo respondida', async () => {
    m.redis.value = null
    const res = await POST(req({ messageId: 'w1', debounceMs: 12000 }))
    expect((await res.json()).success).toBe(true)
    expect(m.processChatAgent).toHaveBeenCalledTimes(1)
    expect(m.sendWhatsAppMessage).toHaveBeenCalledTimes(1)
  })
})
