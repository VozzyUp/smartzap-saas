import { NextRequest, NextResponse } from 'next/server'
import { settingsDb } from '@/lib/supabase-db'
import { getMetaAppConfigPublic } from '@/lib/meta-app-credentials'
import { isSupabaseConfigured } from '@/lib/supabase'
import { getTenantContext } from '@/lib/tenant-context'

export const dynamic = 'force-dynamic'
export const revalidate = 0

// GET - Retorna status público (não expõe o secret)
export async function GET() {
  try {
    const ctx = await getTenantContext()
    if (!ctx?.tenantId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

    const cfg = await getMetaAppConfigPublic(ctx.tenantId)
    return NextResponse.json(cfg, {
      headers: {
        'Cache-Control': 'private, no-store, no-cache, must-revalidate, max-age=0',
        Pragma: 'no-cache',
        Expires: '0',
      },
    })
  } catch (error) {
    console.error('Error fetching Meta App config:', error)
    // Evita 500 para não quebrar a página de Settings.
    return NextResponse.json({
      source: 'none',
      appId: null,
      hasAppSecret: false,
      isConfigured: false,
      ...(isSupabaseConfigured() ? { warning: 'Falha ao carregar config do Meta App.' } : { warning: 'Supabase não configurado.' }),
    })
  }
}

// POST - Salva App ID/Secret no Supabase settings
// Observação: secret NUNCA é retornado; no máximo confirmamos booleanos.
export async function POST(request: NextRequest) {
  try {
    const ctx = await getTenantContext()
    if (!ctx?.tenantId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

    if (!isSupabaseConfigured()) {
      return NextResponse.json({ error: 'Supabase não configurado. Complete o setup antes de salvar.' }, { status: 400 })
    }

    const body = await request.json().catch(() => ({}))
    const appId = String((body as any)?.appId || '').trim()
    const appSecret = String((body as any)?.appSecret || '').trim()

    if (!appId) {
      return NextResponse.json({ error: 'appId é obrigatório' }, { status: 400 })
    }

    // Para upload (Resumable Upload API), precisamos apenas do App ID.
    // O App Secret é opcional e só é usado em diagnósticos (/debug_token).
    await settingsDb.set(ctx.tenantId, 'metaAppId', appId)
    if (appSecret) {
      await settingsDb.set(ctx.tenantId, 'metaAppSecret', appSecret)
    }

    const cfg = await getMetaAppConfigPublic(ctx.tenantId)
    return NextResponse.json({ success: true, ...cfg })
  } catch (error) {
    console.error('Error saving Meta App config:', error)
    return NextResponse.json({ error: 'Failed to save Meta App config' }, { status: 502 })
  }
}

// DELETE - Remove do DB (não mexe nas env vars)
export async function DELETE() {
  try {
    const ctx = await getTenantContext()
    if (!ctx?.tenantId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

    if (!isSupabaseConfigured()) {
      return NextResponse.json({ error: 'Supabase não configurado. Complete o setup antes de remover.' }, { status: 400 })
    }

    await settingsDb.set(ctx.tenantId, 'metaAppId', '')
    await settingsDb.set(ctx.tenantId, 'metaAppSecret', '')

    const cfg = await getMetaAppConfigPublic(ctx.tenantId)
    return NextResponse.json({ success: true, ...cfg })
  } catch (error) {
    console.error('Error deleting Meta App config:', error)
    return NextResponse.json({ error: 'Failed to delete Meta App config' }, { status: 502 })
  }
}
