import { describe, it, expect } from 'vitest'
import { buildBatchMetricsRow } from './batch-metrics-row'

describe('buildBatchMetricsRow', () => {
  it('leva o tenant_id da campanha (coluna NOT NULL)', () => {
    const row = buildBatchMetricsRow({
      tenantId: 't-1', campaignId: 'c-1', traceId: 'tr', batchIndex: 0,
      configuredBatchSize: 10, batchSize: 3, concurrency: 2, adaptiveEnabled: true,
      targetMps: 5, floorDelayMs: 100, sentCount: 2, failedCount: 1, skippedCount: 0,
      metaTimeMs: 10, dbTimeMs: 5, sawThroughput429: false, batchOk: true, error: null,
    })
    expect(row.tenant_id).toBe('t-1')
    expect(row.campaign_id).toBe('c-1')
    expect(row.meta_requests).toBe(3)
  })
})
