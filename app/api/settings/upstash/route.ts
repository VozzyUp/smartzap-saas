import { NextRequest, NextResponse } from 'next/server'
import { settingsDb } from '@/lib/supabase-db'
import { isSupabaseConfigured } from '@/lib/supabase'
import { fetchWithTimeout } from '@/lib/server-http'
import { getTenantContext } from '@/lib/tenant-context'

export const dynamic = 'force-dynamic'
export const revalidate = 0

/**
 * Credenciais do Upstash para métricas de uso do QStash.
 * Opcional - se não configurado, o painel de infraestrutura mostra zeros para QStash.
 */

// GET - Buscar credenciais (mascaradas)
export async function GET() {
  try {
    const ctx = await getTenantContext()
    if (!ctx?.tenantId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

    if (!isSupabaseConfigured()) {
      return NextResponse.json({ configured: false })
    }

    const email = await settingsDb.get(ctx.tenantId, 'upstashEmail')
    const apiKey = await settingsDb.get(ctx.tenantId, 'upstashApiKey')

    return NextResponse.json({
      configured: Boolean(email && apiKey),
      email: email || '',
      hasApiKey: Boolean(apiKey),
    })
  } catch (error) {
    console.error('Error fetching Upstash settings:', error)
    return NextResponse.json({ configured: false, error: 'Failed to fetch settings' })
  }
}

// POST - Salvar e validar credenciais
export async function POST(request: NextRequest) {
  try {
    const ctx = await getTenantContext()
    if (!ctx?.tenantId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

    const body = await request.json().catch(() => null)
    if (!body) {
      return NextResponse.json({ error: 'Body inválido' }, { status: 400 })
    }

    const { email, apiKey } = body

    if (!email || !apiKey) {
      return NextResponse.json(
        { error: 'Email e API Key são obrigatórios' },
        { status: 400 }
      )
    }

    // Validar credenciais fazendo uma chamada de teste à API do Upstash
    const auth = Buffer.from(`${email}:${apiKey}`).toString('base64')
    const testResponse = await fetchWithTimeout('https://api.upstash.com/v2/qstash/stats', {
      headers: { 'Authorization': `Basic ${auth}` },
      timeoutMs: 5000,
    })

    if (!testResponse.ok) {
      return NextResponse.json(
        { error: 'Credenciais inválidas - Upstash rejeitou a autenticação' },
        { status: 401 }
      )
    }

    // Salvar no banco
    await Promise.all([
      settingsDb.set(ctx.tenantId, 'upstashEmail', email),
      settingsDb.set(ctx.tenantId, 'upstashApiKey', apiKey),
    ])

    return NextResponse.json({
      success: true,
      message: 'Credenciais do Upstash salvas com sucesso',
    })
  } catch (error) {
    console.error('Error saving Upstash settings:', error)
    return NextResponse.json(
      { error: 'Falha ao salvar credenciais' },
      { status: 500 }
    )
  }
}

// DELETE - Remover credenciais
export async function DELETE() {
  try {
    const ctx = await getTenantContext()
    if (!ctx?.tenantId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

    await Promise.all([
      settingsDb.set(ctx.tenantId, 'upstashEmail', ''),
      settingsDb.set(ctx.tenantId, 'upstashApiKey', ''),
    ])

    return NextResponse.json({
      success: true,
      message: 'Credenciais do Upstash removidas',
    })
  } catch (error) {
    console.error('Error deleting Upstash settings:', error)
    return NextResponse.json(
      { error: 'Falha ao remover credenciais' },
      { status: 500 }
    )
  }
}
