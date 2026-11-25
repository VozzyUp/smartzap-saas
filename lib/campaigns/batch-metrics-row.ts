export type BatchMetricsRowInput = {
  tenantId: string
  campaignId: string
  traceId: string
  batchIndex: number
  configuredBatchSize: number
  batchSize: number
  concurrency: number
  adaptiveEnabled: boolean
  targetMps: number | null
  floorDelayMs: number
  sentCount: number
  failedCount: number
  skippedCount: number
  metaTimeMs: number
  dbTimeMs: number
  sawThroughput429: boolean
  batchOk: boolean
  error: string | null
}

/**
 * Linha de campaign_batch_metrics. tenant_id é NOT NULL: sempre vem da campanha.
 */
export function buildBatchMetricsRow(i: BatchMetricsRowInput) {
  return {
    tenant_id: i.tenantId,
    campaign_id: i.campaignId,
    trace_id: i.traceId,
    batch_index: i.batchIndex,
    configured_batch_size: i.configuredBatchSize,
    batch_size: i.batchSize,
    concurrency: i.concurrency,
    adaptive_enabled: i.adaptiveEnabled,
    target_mps: i.targetMps,
    floor_delay_ms: Number.isFinite(i.floorDelayMs) ? i.floorDelayMs : null,
    sent_count: i.sentCount,
    failed_count: i.failedCount,
    skipped_count: i.skippedCount,
    meta_requests: i.sentCount + i.failedCount,
    meta_time_ms: i.metaTimeMs,
    db_time_ms: i.dbTimeMs,
    saw_throughput_429: i.sawThroughput429,
    batch_ok: i.batchOk,
    error: i.error,
  }
}
