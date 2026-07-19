import { afterEach, describe, expect, it, vi } from 'vitest'

import { metaGetFlowDetails } from './meta-flows-api'

describe('metaGetFlowDetails', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('retorna health_status para diagnosticar bloqueios de integridade', async () => {
    const healthStatus = {
      can_send_message: 'BLOCKED',
      entities: [
        {
          entity_type: 'BUSINESS',
          id: 'business-1',
          can_send_message: 'LIMITED',
          errors: [
            {
              error_code: 141010,
              error_description: 'The Business has not passed business verification.',
              possible_solution: 'Visit business settings and resolve business verification.',
            },
          ],
        },
      ],
    }
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          id: 'flow-1',
          status: 'DRAFT',
          validation_errors: [],
          health_status: healthStatus,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    )
    vi.stubGlobal('fetch', fetchMock)

    const details = await metaGetFlowDetails({ accessToken: 'token', flowId: 'flow-1' })

    expect((details as any).health_status).toEqual(healthStatus)
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain('health_status')
  })
})
