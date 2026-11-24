/**
 * Gera um resumo narrativo combinando perfil + memórias do contato
 *
 * POST - Gera resumo usando IA
 */

import { NextRequest, NextResponse } from 'next/server'
import { generateText } from 'ai'
import { getTenantContext } from '@/lib/tenant-context'
import { contactDb } from '@/lib/supabase-db'
import { getAiDirectConfig } from '@/lib/ai/ai-center-config'
import { createLanguageModel } from '@/lib/ai/llm-model'

interface RouteParams {
  params: Promise<{ phone: string }>
}

interface ProfileData {
  name: string | null
  email: string | null
  status: string
  tags: string[]
  customFields: Record<string, unknown>
  createdAt: string | null
}

interface MemoryData {
  memory: string
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const ctx = await getTenantContext()
    if (!ctx?.tenantId) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })
    const { phone } = await params
    if (!phone) return NextResponse.json({ ok: false, error: 'Phone é obrigatório' }, { status: 400 })

    // Não permita que uma rota de IA seja usada para resumir dados de um
    // contato que não pertence ao tenant autenticado.
    const contact = await contactDb.getByPhone(ctx.tenantId, phone).catch(() => null)
    if (!contact) return NextResponse.json({ ok: false, error: 'Contato não encontrado' }, { status: 404 })

    const body = await request.json()
    const { profile, memories } = body as { profile: ProfileData | null; memories: MemoryData[] }

    if (!profile && (!memories || memories.length === 0)) {
      return NextResponse.json({
        ok: false,
        error: 'Nenhum dado para resumir',
      }, { status: 400 })
    }

    // Monta contexto para o prompt
    const contextParts: string[] = []

    if (profile) {
      const profileLines: string[] = []
      if (profile.name) profileLines.push(`Nome: ${profile.name}`)
      if (profile.email) profileLines.push(`Email: ${profile.email}`)
      // Tags são metadados de sistema (segmentação interna), não preferências do cliente - não incluir
      if (profile.createdAt) profileLines.push(`Cliente desde: ${profile.createdAt}`)
      if (profile.customFields && Object.keys(profile.customFields).length > 0) {
        Object.entries(profile.customFields).forEach(([key, value]) => {
          profileLines.push(`${key}: ${value}`)
        })
      }
      if (profileLines.length > 0) {
        contextParts.push(`DADOS CADASTRAIS:\n${profileLines.join('\n')}`)
      }
    }

    if (memories && memories.length > 0) {
      const memoryLines = memories.map((m) => `- ${m.memory}`).join('\n')
      contextParts.push(`MEMÓRIAS DA IA:\n${memoryLines}`)
    }

    const context = contextParts.join('\n\n')

    // Usa o provedor e a chave configurados pela conta na Central de IA
    const directConfig = await getAiDirectConfig(ctx.tenantId)
    let model
    try {
      if (!directConfig.googleApiKey && !directConfig.openaiApiKey && !directConfig.anthropicApiKey) {
        throw new Error('sem chave')
      }
      model = createLanguageModel(directConfig).model
    } catch {
      return NextResponse.json({
        ok: false,
        error: 'Configure um provedor na Central de IA para gerar o resumo',
      }, { status: 400 })
    }

    const { text } = await generateText({
      model,
      maxOutputTokens: 400,
      prompt: `Você é um assistente que ajuda atendentes a entender rapidamente o contexto de um cliente.

Com base nas informações abaixo, gere um RESUMO NARRATIVO curto (2-3 frases) em português brasileiro, em tom profissional e amigável.

O resumo deve:
- Ser conciso e útil para um atendente
- Destacar informações mais relevantes para personalizar o atendimento
- Usar linguagem natural (não listar dados)

INFORMAÇÕES DO CLIENTE:
${context}

RESUMO:`,
    })

    return NextResponse.json({
      ok: true,
      summary: text.trim(),
    })
  } catch (error) {
    // Registra só o motivo (mensagem), nunca o objeto completo, para não vazar chave
    console.error('[mem0 summary] POST error:', error instanceof Error ? error.message : 'erro desconhecido')
    return NextResponse.json({
      ok: false,
      error: 'Falha ao gerar resumo',
    }, { status: 500 })
  }
}
