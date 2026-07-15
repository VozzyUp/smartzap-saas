import { NextResponse } from 'next/server'
import { getTenantContext, type TenantContext } from '@/lib/tenant-context'

export async function requirePlatformAdmin():
  Promise<{ ok: true; ctx: TenantContext } | { ok: false; response: NextResponse }> {
  let ctx: TenantContext | null = null
  try {
    ctx = await getTenantContext()
  } catch {
    ctx = null
  }
  if (!ctx?.isPlatformAdmin) {
    return { ok: false, response: NextResponse.json({ error: 'forbidden' }, { status: 403 }) }
  }
  return { ok: true, ctx }
}
