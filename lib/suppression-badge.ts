import { normalizePhoneNumber } from '@/lib/phone-formatter'
import { isOptOutSuppressionSource } from '@/lib/suppression-sources'

/** Texto completo do selo de número bloqueado, conforme a origem da supressão. */
export function suppressionBadgeLabel(source: string | null | undefined): string {
  switch (source) {
    case 'inbound_keyword':
    case 'ai_detected':
    case 'meta_opt_out_error':
      return 'Bloqueado · pediu para parar'
    case 'auto_failure_policy':
      return 'Bloqueado · falha de entrega'
    default:
      return 'Bloqueado'
  }
}

/** Faixa do Inbox: só quando a IA está silenciada por pedido do contato. */
export function suppressionInboxNotice(source: string | null | undefined): string | null {
  return isOptOutSuppressionSource(source)
    ? 'A IA não responde este contato porque ele pediu para parar.'
    : null
}

export type SuppressionInfo = {
  source: string | null
  reason: string | null
  expiresAt: string | null
}

/**
 * Acrescenta a informação de supressão ativa a cada contato, comparando telefones
 * normalizados. `suppressions` deve vir de uma consulta já filtrada por tenant.
 */
export function attachSuppressions<T extends { phone: string }>(
  contacts: T[],
  suppressions: Map<string, SuppressionInfo>
): Array<
  T & {
    isSuppressed: boolean
    suppressionReason: string | null
    suppressionSource: string | null
    suppressionExpiresAt: string | null
  }
> {
  return contacts.map((c) => {
    const info = suppressions.get(normalizePhoneNumber(String(c.phone || '').trim())) || null
    return {
      ...c,
      isSuppressed: info !== null,
      suppressionReason: info?.reason ?? null,
      suppressionSource: info?.source ?? null,
      suppressionExpiresAt: info?.expiresAt ?? null,
    }
  })
}
