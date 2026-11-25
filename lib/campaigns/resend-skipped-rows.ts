/**
 * Prepara as linhas enviadas ao upsert de campaign_contacts no reenvio de ignorados.
 *
 * Upsert = INSERT ... ON CONFLICT: o Postgres valida NOT NULL na linha proposta antes de
 * resolver o conflito, então toda linha precisa levar tenant_id. Descarta linhas sem id
 * válido (evita inserts acidentais).
 */
export function buildCampaignContactUpsertRows<T extends { id?: unknown }>(
  updates: Array<T | null | undefined>,
  tenantId: string
): Array<T & { tenant_id: string }> {
  const rows: Array<T & { tenant_id: string }> = []
  for (const u of updates) {
    if (u && typeof u.id === 'string' && u.id.length > 0) {
      rows.push({ ...u, tenant_id: tenantId })
    }
  }
  return rows
}
