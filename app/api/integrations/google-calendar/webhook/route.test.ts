import { describe, it, expect, vi } from 'vitest'
import { NextRequest } from 'next/server'

const resolveTenantMock = vi.fn()
const getChannelMock = vi.fn()
const markNotificationMock = vi.fn()
vi.mock('@/lib/google-calendar', () => ({
  resolveTenantByChannelToken: (...a: any[]) => resolveTenantMock(...a),
  getCalendarChannel: (...a: any[]) => getChannelMock(...a),
  markCalendarNotification: (...a: any[]) => markNotificationMock(...a),
}))
vi.mock('@/lib/supabase', () => ({ isSupabaseConfigured: () => true }))

import { POST } from './route'

describe('google-calendar webhook — resolução de tenant', () => {
  it('401 quando channel_token não está mapeado', async () => {
    resolveTenantMock.mockResolvedValueOnce(null)
    const req = new NextRequest('http://localhost/api/integrations/google-calendar/webhook', {
      method: 'POST',
      headers: { 'x-goog-channel-token': 'gc_desconhecido' },
    })
    const res = await POST(req)
    expect(res.status).toBe(401)
  })

  it('200 e processa quando channel_token bate', async () => {
    resolveTenantMock.mockResolvedValueOnce('t1')
    getChannelMock.mockResolvedValueOnce({ token: 'gc_valido', id: 'ch1', resourceId: 'res1', calendarId: 'primary', createdAt: new Date().toISOString() })
    markNotificationMock.mockResolvedValueOnce(undefined)
    const req = new NextRequest('http://localhost/api/integrations/google-calendar/webhook', {
      method: 'POST',
      headers: { 'x-goog-channel-token': 'gc_valido', 'x-goog-resource-state': 'exists' },
    })
    const res = await POST(req)
    expect(res.status).toBe(200)
    expect(markNotificationMock).toHaveBeenCalledWith('t1', { resourceState: 'exists' })
  })
})
