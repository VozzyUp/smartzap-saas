import { NextResponse } from 'next/server'
import { settingsDb } from '@/lib/supabase-db'

import { getVerifyToken } from '@/lib/verify-token'
import { getAppUrl } from '@/lib/app-url'
import { getTenantContext } from '@/lib/tenant-context'

export async function GET() {
  const ctx = await getTenantContext()
  if (!ctx?.tenantId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const webhookUrl = `${getAppUrl()}/api/webhook`

  const webhookToken = await getVerifyToken(ctx.tenantId)

  // Stats are now tracked in Supabase (campaign_contacts table)
  // (Sem stats via cache)

  return NextResponse.json({
    webhookUrl,
    webhookToken,
    stats: null, // Stats removed - use campaign details page instead
    debug: {
      appUrl: process.env.NEXT_PUBLIC_APP_URL || null,
      env: {
        hasSupabaseUrl: Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL),
        hasSupabasePublishableKey: Boolean(process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY),
        hasSupabaseSecretKey: Boolean(process.env.SUPABASE_SECRET_KEY),
        hasQstashToken: Boolean(process.env.QSTASH_TOKEN),
        hasAuthSecret: Boolean(process.env.AUTH_SECRET),
      },
      gitCommitSha: process.env.APP_VERSION ?? null,
      gitCommitRef: null,
      gitCommitMessage: null,
      deploymentId: null,
    },
  })
}
