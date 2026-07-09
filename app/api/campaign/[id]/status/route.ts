/**
 * Campaign Status API
 * 
 * This endpoint is DEPRECATED - stats are now fetched directly from Supabase.
 * Kept for backwards compatibility but returns data from Supabase.
 * 
 * GET /api/campaign/[id]/status
 */

import { NextRequest, NextResponse } from 'next/server'
import { campaignDb } from '@/lib/supabase-db'
import { getTenantContext } from '@/lib/tenant-context'

// Force dynamic rendering (no caching)
export const dynamic = 'force-dynamic'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: campaignId } = await params

  try {
    const ctx = await getTenantContext()
    if (!ctx?.tenantId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

    // Get stats directly from Supabase (source of truth)
    const campaign = await campaignDb.getById(ctx.tenantId, campaignId)

    if (!campaign) {
      return NextResponse.json({ error: 'Campaign not found' }, { status: 404 })
    }

    return NextResponse.json({
      campaignId,
      stats: {
        sent: campaign.sent || 0,
        delivered: campaign.delivered || 0,
        read: campaign.read || 0,
        failed: campaign.failed || 0,
        total: campaign.recipients || 0
      }
    }, {
      headers: {
        'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
        'Pragma': 'no-cache',
        'Expires': '0',
      }
    })
  } catch (error) {
    console.error('Error fetching campaign status:', error)
    return NextResponse.json({ error: 'Failed to fetch status' }, { status: 500 })
  }
}
