'use client'

import * as React from 'react'
import {
  RefreshCw,
  ArrowLeft,
  Copy,
  LifeBuoy,
  ChevronDown,
  AlertTriangle,
  XCircle,
} from 'lucide-react'

import { Page, PageActions, PageDescription, PageHeader, PageTitle } from '@/components/ui/page'
import { Container, containerVariants } from '@/components/ui/container'
import { PrefetchLink } from '@/components/ui/PrefetchLink'
import { useCopyToClipboard } from '@/hooks/use-copy-to-clipboard'
import type {
  MetaDiagnosticsAction,
  MetaDiagnosticsCheck,
  MetaDiagnosticsCheckStatus,
  MetaDiagnosticsResponse,
} from '@/services/metaDiagnosticsService'

import {
  META_BUSINESS_LOCKED_CODE,
  hasMetaBusinessLockedEvidence,
  formatJsonMaybe,
  getFriendlyCopy,
  topLineForSend,
  topLineForToken,
  topLineForWebhook,
  StatusBadge,
  NextSteps,
  ActionButtons,
  HealthStatusSeal,
  TokenExpirySeal,
  DebugTokenSeal,
  TokenValidityCard,
  TokenScopesCard,
  Simulate10033Card,
  QuickStartCard,
} from './diagnostics'

export interface MetaDiagnosticsViewProps {
  data?: MetaDiagnosticsResponse
  checks: MetaDiagnosticsCheck[]
  filteredChecks: MetaDiagnosticsCheck[]
  counts: { pass: number; warn: number; fail: number; info: number }
  overall: MetaDiagnosticsCheckStatus
  isLoading: boolean
  isFetching: boolean
  filter: 'all' | 'actionable' | 'problems'
  setFilter: (v: 'all' | 'actionable' | 'problems') => void
  onRefresh: () => void
  onRunAction: (a: MetaDiagnosticsAction) => void
  isActing: boolean
}

export function MetaDiagnosticsView(props: MetaDiagnosticsViewProps) {
  const [simpleMode, setSimpleMode] = React.useState(true)
  const reportText = props.data?.report?.text || ''
  const supportPacketText = props.data?.report?.supportPacketText || reportText
  const { isCopied, copyToClipboard } = useCopyToClipboard({ timeout: 1800 })
  const lock = React.useMemo(() => hasMetaBusinessLockedEvidence(props.checks), [props.checks])
  const apiActionsDisabled = props.isActing || lock.kind === 'current'
  const lockedNow = lock.kind === 'current'
  const topSend = React.useMemo(() => topLineForSend(props.checks), [props.checks])
  const topToken = React.useMemo(() => topLineForToken(props.checks, props.data), [props.checks, props.data])
  const topWebhook = React.useMemo(() => topLineForWebhook(props.checks), [props.checks])

  const hasGraph100_33 = React.useMemo(() => {
    const checks = props.checks || []
    for (const c of checks) {
      const err = (c as { details?: { error?: { code?: number; error?: { code?: number; error_subcode?: number }; error_subcode?: number } } })?.details?.error
      const code = Number(err?.code ?? err?.error?.code)
      const sub = Number(err?.error_subcode ?? err?.error?.error_subcode)
      if (code === 100 && sub === 33) return true
    }
    return false
  }, [props.checks])

  const hasGraph190 = React.useMemo(() => {
    const checks = props.checks || []
    for (const c of checks) {
      const err = (c as { details?: { error?: { code?: number; error?: { code?: number } } } })?.details?.error
      const code = Number(err?.code ?? err?.error?.code)
      if (code === 190) return true
    }
    return false
  }, [props.checks])

  const hasSignal131042 = React.useMemo(() => {
    for (const c of props.checks || []) {
      if (c.id === 'internal_recent_failures') {
        const top = (c.details as { top?: Array<{ code?: number }> })?.top
        if (Array.isArray(top) && top.some((x) => Number(x?.code) === 131042)) return true
      }
      if (c.id === 'meta_health_status') {
        const errors = Array.isArray((c.details as { errors?: Array<{ error_code?: number }> })?.errors)
          ? ((c.details as { errors: Array<{ error_code?: number }> }).errors)
          : []
        if (errors.some((e) => Number(e?.error_code) === 131042)) return true
      }
    }
    return false
  }, [props.checks])

  const hasSignal131056 = React.useMemo(() => {
    for (const c of props.checks || []) {
      if (c.id === 'internal_recent_failures') {
        const top = (c.details as { top?: Array<{ code?: number }> })?.top
        if (Array.isArray(top) && top.some((x) => Number(x?.code) === 131056)) return true
      }
      const err = (c as { details?: { error?: { code?: number; error?: { code?: number } } } })?.details?.error
      const code = Number(err?.code ?? err?.error?.code)
      if (code === 131056) return true
    }
    return false
  }, [props.checks])

  return (
    <Page>
      <PageHeader>
        <div>
          <PageTitle>Diagnostico Meta</PageTitle>
          <PageDescription>
            Responde em linguagem simples: <b>posso enviar?</b> <b>meu token esta ok?</b> <b>vou receber delivered/read?</b>
          </PageDescription>
        </div>

        <PageActions>
          <PrefetchLink
            href="/settings"
            className="px-4 py-2 rounded-xl bg-white/5 text-white hover:bg-white/10 border border-white/10 hover:border-white/20 transition-all text-sm font-medium flex items-center gap-2"
          >
            <ArrowLeft size={16} />
            Voltar
          </PrefetchLink>

          <button
            onClick={() => copyToClipboard(reportText)}
            disabled={!reportText}
            className="px-4 py-2 rounded-xl bg-white/5 text-white hover:bg-white/10 border border-white/10 hover:border-white/20 transition-all text-sm font-medium flex items-center gap-2 disabled:opacity-50"
            title={reportText ? 'Copiar relatorio resumido (redigido)' : 'Relatorio indisponivel'}
          >
            <Copy size={16} />
            {isCopied ? 'Copiado!' : 'Copiar relatorio'}
          </button>

          <button
            onClick={props.onRefresh}
            className="px-4 py-2 rounded-xl bg-white/5 text-white hover:bg-white/10 border border-white/10 hover:border-white/20 transition-all text-sm font-medium flex items-center gap-2"
            title="Atualizar"
          >
            <RefreshCw size={16} className={props.isFetching ? 'animate-spin' : ''} />
            {props.isFetching ? 'Atualizando...' : 'Atualizar'}
          </button>
        </PageActions>
      </PageHeader>

      {/* Top Line Summary */}
      <Container variant="glass" padding="md" className="mb-6">
        <div className="text-xs text-gray-500">Resposta direta</div>
        <div className="mt-2 text-sm text-white font-medium">O que importa primeiro</div>
        <div className="mt-4 grid grid-cols-1 lg:grid-cols-3 gap-3">
          {([
            { category: 'Envio', label: topSend.label, status: topSend.status, detail: topSend.detail },
            { category: 'Token', label: topToken.label, status: topToken.status, detail: topToken.detail },
            { category: 'Webhook', label: topWebhook.label, status: topWebhook.status, detail: topWebhook.detail },
          ] as const).map((row) => (
            <div key={row.category} className="bg-zinc-900/40 border border-white/10 rounded-xl p-4">
              <div className="flex items-center justify-between gap-3">
                <div className="text-xs text-gray-500">{row.category}</div>
                <StatusBadge status={row.status} />
              </div>
              <div className="mt-2 text-sm text-white font-semibold">{row.label}</div>
              <div className="mt-1 text-sm text-gray-300">{row.detail}</div>
            </div>
          ))}
        </div>
      </Container>

      {/* Seals Section */}
      <details className={containerVariants({ variant: 'glass', padding: 'md' }) + ' mb-6'}>
        <summary className="cursor-pointer list-none flex items-center justify-between gap-3">
          <div>
            <div className="text-xs text-gray-500">Mais detalhes</div>
            <div className="mt-1 text-sm text-white">Selos, suporte e validacoes</div>
          </div>
          <ChevronDown size={16} className="text-gray-400" />
        </summary>
        <div className="mt-4 grid grid-cols-1 lg:grid-cols-4 gap-4">
          <HealthStatusSeal checks={props.checks} />
          <TokenExpirySeal data={props.data} checks={props.checks} />
          <DebugTokenSeal data={props.data} />

          <Container variant="glass" padding="md">
            <div className="text-xs text-gray-500">Atalho</div>
            <div className="mt-2 text-sm text-white font-medium">Support Packet</div>
            <div className="mt-2 text-sm text-gray-300">
              1 clique pra copiar um pacote pronto (inclui <span className="font-mono">fbtrace_id</span> quando existir).
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                onClick={() => copyToClipboard(supportPacketText)}
                disabled={!supportPacketText}
                className="px-3 py-2 rounded-lg bg-white/5 text-white hover:bg-white/10 border border-white/10 hover:border-white/20 transition-all text-sm font-medium inline-flex items-center gap-2 disabled:opacity-50"
                title={supportPacketText ? 'Copiar packet completo' : 'Indisponivel'}
              >
                <LifeBuoy size={14} /> {isCopied ? 'Copiado!' : 'Copiar packet'}
              </button>
              <button
                onClick={() => copyToClipboard(reportText)}
                disabled={!reportText}
                className="px-3 py-2 rounded-lg bg-white/5 text-white hover:bg-white/10 border border-white/10 hover:border-white/20 transition-all text-sm font-medium inline-flex items-center gap-2 disabled:opacity-50"
                title={reportText ? 'Copiar resumo' : 'Indisponivel'}
              >
                <Copy size={14} /> Resumo
              </button>
            </div>
          </Container>
        </div>
      </details>

      {/* Quick Start Card */}
      <div className="mb-6">
        <QuickStartCard
          checks={props.checks}
          onRunAction={props.onRunAction}
          isActing={props.isActing}
          lockedNow={lockedNow}
          simpleMode={simpleMode}
          lockedReason={
            lockedNow
              ? `Bloqueado pela Meta (codigo ${META_BUSINESS_LOCKED_CODE}). Resolva no Business Manager e tente novamente.`
              : undefined
          }
        />
      </div>

      {/* Token Cards */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
        <TokenValidityCard data={props.data} checks={props.checks} />
        <TokenScopesCard data={props.data} checks={props.checks} />
      </div>

      {/* Advanced Tools */}
      <details className={containerVariants({ variant: 'glass', padding: 'md' }) + ' mb-6'}>
        <summary className="cursor-pointer list-none flex items-center justify-between gap-3">
          <div>
            <div className="text-xs text-gray-500">Ferramentas avancadas</div>
            <div className="mt-1 text-sm text-white">Simuladores e debug para suporte/aula</div>
          </div>
          <ChevronDown size={16} className="text-gray-400" />
        </summary>
        <div className="mt-4">
          <Simulate10033Card />
        </div>
      </details>

      {/* Error Interpretation Panels */}
      {hasGraph100_33 && (
        <Container variant="glass" padding="md" className="border-amber-500/20 bg-amber-500/5 mb-6">
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 text-amber-300" size={18} />
            <div className="min-w-0">
              <div className="text-white font-semibold">Como interpretar: erro 100 (subcode 33)</div>
              <div className="text-sm text-gray-200/90 mt-1">
                Esse erro quase sempre significa: <b>ID incorreto</b> OU <b>token sem acesso ao ativo</b> (WABA/PHONE_NUMBER).
                Normalmente e permissao/atribuicao — nao e "bloqueio de conta".
              </div>
              <ul className="mt-3 list-disc pl-5 space-y-1 text-sm text-gray-200">
                <li>Confirme se o <b>phone_number_id</b> e o <b>waba_id</b> foram copiados do WhatsApp Manager correto.</li>
                <li>Gere um token do <b>System User</b> e atribua os ativos (WABA + Phone Number) no Business Manager.</li>
                <li>Garanta os escopos <span className="font-mono">whatsapp_business_messaging</span> e <span className="font-mono">whatsapp_business_management</span>.</li>
                <li>Volte aqui e clique em <b>Atualizar</b>.</li>
              </ul>
              <div className="mt-3 text-xs text-gray-400">
                Dica: configurando <b>Meta App ID/Secret</b> em Configuracoes, o diagnostico consegue validar escopos e origem do token via <span className="font-mono">/debug_token</span>.
              </div>
            </div>
          </div>
        </Container>
      )}

      {hasGraph190 && (
        <Container variant="glass" padding="md" className="border-red-500/20 bg-red-500/5 mb-6">
          <div className="flex items-start gap-3">
            <XCircle className="mt-0.5 text-red-300" size={18} />
            <div className="min-w-0">
              <div className="text-white font-semibold">Como interpretar: erro 190 (token invalido)</div>
              <div className="text-sm text-gray-200/90 mt-1">
                Esse erro indica token expirado/invalidado, token copiado errado ou token sem permissao (as vezes aparece como "Session has expired").
              </div>
              <ul className="mt-3 list-disc pl-5 space-y-1 text-sm text-gray-200">
                <li>Gere um novo token (recomendado: <b>System User</b> no Business Manager).</li>
                <li>Atribua os ativos (WABA + Phone Number) ao System User antes de gerar o token.</li>
                <li>Garanta os escopos <span className="font-mono">whatsapp_business_messaging</span> e <span className="font-mono">whatsapp_business_management</span>.</li>
                <li>Atualize o token em <b>Ajustes</b> e rode o diagnostico novamente.</li>
              </ul>
              <div className="mt-3 text-xs text-gray-400">
                Dica: com <span className="font-mono">debug_token</span> habilitado, voce ve expiracao/escopos com prova.
              </div>
            </div>
          </div>
        </Container>
      )}

      {hasSignal131042 && (
        <Container variant="glass" padding="md" className="border-amber-500/20 bg-amber-500/5 mb-6">
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 text-amber-300" size={18} />
            <div className="min-w-0">
              <div className="text-white font-semibold">Como interpretar: erro 131042 (pagamento/conta)</div>
              <div className="text-sm text-gray-200/90 mt-1">
                Esse codigo costuma aparecer quando ha problema de pagamento ou restricao de conta no Business Manager. E Meta-side.
              </div>
              <ul className="mt-3 list-disc pl-5 space-y-1 text-sm text-gray-200">
                <li>Abra o <b>Business Manager</b> e verifique alertas de cobranca/pagamento.</li>
                <li>Confirme se o WABA esta verificado e sem pendencias de revisao.</li>
                <li>Apos corrigir, rode o diagnostico e faca um envio de teste.</li>
              </ul>
            </div>
          </div>
        </Container>
      )}

      {hasSignal131056 && (
        <Container variant="glass" padding="md" className="border-amber-500/20 bg-amber-500/5 mb-6">
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 text-amber-300" size={18} />
            <div className="min-w-0">
              <div className="text-white font-semibold">Como interpretar: erro 131056 (rate limit por par)</div>
              <div className="text-sm text-gray-200/90 mt-1">
                A Meta limita envio para o mesmo usuario (pair rate limit). Isso nao e "bloqueio", e limite temporario.
              </div>
              <ul className="mt-3 list-disc pl-5 space-y-1 text-sm text-gray-200">
                <li>Evite mandar multiplas mensagens em sequencia para o mesmo numero em poucos segundos.</li>
                <li>Se for fluxo/campanha, aplique delay/backoff e re-tente com espacamento.</li>
                <li>Rode novamente depois de alguns minutos.</li>
              </ul>
            </div>
          </div>
        </Container>
      )}

      {/* Summary Panel */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Container variant="glass" padding="md">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="text-xs text-gray-500">Status geral</div>
              <div className="mt-2 flex items-center gap-2">
                <StatusBadge status={props.overall} />
                <span className="text-xs text-gray-400">({props.checks.length} checks)</span>
              </div>
            </div>
            <div className="text-right">
              <div className="text-xs text-gray-500">Falhas / Atencoes</div>
              <div className="mt-2 text-sm text-white font-medium">
                <span className="text-red-200">{props.counts.fail}</span>
                <span className="text-gray-500"> / </span>
                <span className="text-amber-200">{props.counts.warn}</span>
              </div>
            </div>
          </div>

          <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
            <div className="bg-zinc-900/40 border border-white/10 rounded-lg p-2">
              <div className="text-gray-500">OK</div>
              <div className="mt-1 text-white font-medium">{props.counts.pass}</div>
            </div>
            <div className="bg-zinc-900/40 border border-white/10 rounded-lg p-2">
              <div className="text-gray-500">Info</div>
              <div className="mt-1 text-white font-medium">{props.counts.info}</div>
            </div>
            <div className="bg-zinc-900/40 border border-amber-500/20 rounded-lg p-2">
              <div className="text-amber-200">Atencao</div>
              <div className="mt-1 text-white font-medium">{props.counts.warn}</div>
            </div>
            <div className="bg-zinc-900/40 border border-red-500/20 rounded-lg p-2">
              <div className="text-red-200">Falha</div>
              <div className="mt-1 text-white font-medium">{props.counts.fail}</div>
            </div>
          </div>
        </Container>

        <details className={containerVariants({ variant: 'glass', padding: 'md' }) + ' lg:col-span-2'}>
          <summary className="cursor-pointer list-none flex items-center justify-between gap-3">
            <div>
              <div className="text-xs text-gray-500">Painel tecnico</div>
              <div className="mt-1 text-sm text-white">Ambiente + webhook + ids de deploy</div>
            </div>
            <ChevronDown size={16} className="text-gray-400" />
          </summary>

          <div className="mt-4 grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="bg-zinc-900/40 border border-white/10 rounded-xl p-4">
              <div className="text-xs text-gray-500">Ambiente</div>
              <div className="mt-2 text-sm text-white">
                {(props.data?.env as { vercelEnv?: string })?.vercelEnv || '—'}
              </div>
              <div className="mt-3 text-xs text-gray-400 space-y-1">
                <div>
                  <span className="text-gray-500">Deploy:</span>{' '}
                  <span className="font-mono text-white/90">{((props.data?.env as { deploymentId?: string })?.deploymentId) || '—'}</span>
                </div>
                <div>
                  <span className="text-gray-500">Commit:</span>{' '}
                  <span className="font-mono text-white/90">{((props.data?.env as { gitCommitSha?: string })?.gitCommitSha)?.slice?.(0, 7) || '—'}</span>
                </div>
              </div>
            </div>

            <div className="bg-zinc-900/40 border border-white/10 rounded-xl p-4">
              <div className="text-xs text-gray-500">Webhook (URL esperada)</div>
              <div className="mt-2 text-sm text-white font-mono break-all">
                {props.data?.webhook?.expectedUrl || '—'}
              </div>
              <div className="mt-3 text-xs text-gray-400">
                Verify token:{' '}
                <span className="font-mono text-white/90">{props.data?.webhook?.verifyTokenPreview || '—'}</span>
              </div>
            </div>
          </div>
        </details>
      </div>

      {/* Lock Warning Panel */}
      {lock.kind !== 'none' && (
        <Container
          variant="glass"
          padding="md"
          className={`mt-4 ${
            lock.kind === 'current'
              ? 'border-red-500/20 bg-red-500/5'
              : 'border-amber-500/20 bg-amber-500/5'
          }`}
        >
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <StatusBadge status={lock.kind === 'current' ? 'fail' : 'warn'} />
                <h3 className="text-sm font-semibold text-white truncate">
                  {lock.kind === 'current'
                    ? `Bloqueio atual detectado (codigo ${META_BUSINESS_LOCKED_CODE})`
                    : `Sinal historico de bloqueio (codigo ${META_BUSINESS_LOCKED_CODE})`}
                </h3>
              </div>
              <div className="mt-2 text-sm text-gray-200">
                {lock.kind === 'current'
                  ? 'O Health Status da Meta indica BLOQUEIO na cadeia de envio (APP/BUSINESS/WABA/PHONE/TEMPLATE). Enquanto isso estiver ativo, acoes e envios podem falhar — nao ha "auto-fix" via API aqui dentro.'
                  : 'Detectamos o codigo 131031 em falhas recentes (ultimos 7 dias), mas o Health Status atual nao esta bloqueado. Isso pode ter sido temporario ou relacionado a uma tentativa antiga.'}
              </div>
              <div className="mt-3 text-sm text-gray-300 space-y-1">
                <div>
                  <span className="text-gray-400">O que fazer:</span>
                </div>
                <ul className="list-disc pl-5 space-y-1">
                  <li>Abra o Business Manager e verifique alertas de pagamento, verificacao e qualidade da conta.</li>
                  {lock.kind === 'current' ? (
                    <>
                      <li>Se nao houver caminho de auto-resolucao, abra um chamado no suporte da Meta para desbloqueio do WABA.</li>
                      <li>Depois do desbloqueio, volte aqui e clique em "Atualizar" e entao "Ativar messages".</li>
                    </>
                  ) : (
                    <>
                      <li>Se o problema voltar a acontecer, use o "Copiar relatorio" e envie junto do <span className="font-mono">fbtrace_id</span> (quando houver) ao suporte da Meta.</li>
                      <li>Se o objetivo agora e receber delivered/read, foque em ativar <span className="font-mono">messages</span> em <span className="font-mono">subscribed_apps</span> (botao "Ativar messages").</li>
                    </>
                  )}
                </ul>
              </div>
              <div className="mt-3 text-xs text-gray-400">
                Evidencia: {lock.evidence?.source || 'diagnostico'}
                {typeof lock.evidence?.count === 'number' ? ` (ocorrencias: ${lock.evidence.count})` : ''}
              </div>
            </div>

            <div className="shrink-0">
              <button
                onClick={() => copyToClipboard(reportText)}
                disabled={!reportText}
                className="px-3 py-2 rounded-lg bg-white/5 text-white hover:bg-white/10 border border-white/10 hover:border-white/20 transition-all text-sm font-medium inline-flex items-center gap-2 disabled:opacity-50"
                title={reportText ? 'Copiar relatorio para suporte' : 'Relatorio indisponivel'}
              >
                <Copy size={14} />
                Copiar relatorio
              </button>
            </div>
          </div>
        </Container>
      )}

      {/* Filters */}
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <div className="text-xs text-gray-400">Filtro:</div>
        {([
          { k: 'problems', label: 'Problemas' },
          { k: 'actionable', label: 'Com acoes' },
          { k: 'all', label: 'Tudo' },
        ] as const).map((b) => (
          <button
            key={b.k}
            type="button"
            onClick={() => props.setFilter(b.k)}
            className={`px-3 py-1.5 rounded-lg border text-xs transition-colors ${
              props.filter === b.k
                ? 'bg-white/10 text-white border-white/20'
                : 'bg-zinc-900/40 text-gray-300 border-white/10 hover:bg-white/5'
            }`}
          >
            {b.label}
          </button>
        ))}

        <button
          type="button"
          onClick={() => setSimpleMode((v) => !v)}
          className={`ml-2 px-3 py-1.5 rounded-lg border text-xs transition-colors ${
            simpleMode
              ? 'bg-emerald-500/10 text-emerald-200 border-emerald-500/20'
              : 'bg-zinc-900/40 text-gray-300 border-white/10 hover:bg-white/5'
          }`}
          title={simpleMode ? 'Modo simples (recomendado)' : 'Modo tecnico (para dev/suporte)'}
        >
          {simpleMode ? 'Modo simples: ON' : 'Modo simples: OFF'}
        </button>

        <div className="ml-auto text-xs text-gray-500">
          {props.isLoading ? 'Carregando...' : `${props.filteredChecks.length} itens`}
        </div>
      </div>

      {/* Checks List */}
      <div className="space-y-3">
        {props.isLoading && (
          <Container variant="glass" padding="md" className="text-sm text-gray-400">
            Carregando diagnostico...
          </Container>
        )}

        {!props.isLoading && props.filteredChecks.length === 0 && (
          <Container variant="glass" padding="md" className="text-sm text-gray-400">
            Nenhum item nesse filtro.
          </Container>
        )}

        {props.filteredChecks.map((c) => (
          <Container key={c.id} id={`check-${c.id}`} variant="glass" padding="md">
            {(() => {
              const friendly = simpleMode ? getFriendlyCopy(c) : { title: c.title, message: c.message }
              return (
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <StatusBadge status={c.status} />
                      <h3 className="text-sm font-semibold text-white truncate">{friendly.title}</h3>
                    </div>
                    <div className="mt-2 text-sm text-gray-300">{friendly.message}</div>

                    {simpleMode && friendly.why && (
                      <div className="mt-2 text-xs text-gray-500">Por que isso importa: {friendly.why}</div>
                    )}

                    <NextSteps value={(c.details as { nextSteps?: unknown })?.nextSteps} />

                    <ActionButtons
                      actions={c.actions || []}
                      onRunAction={props.onRunAction}
                      disabled={apiActionsDisabled}
                      disabledReason={
                        lock.kind === 'current'
                          ? `Bloqueado pela Meta (codigo ${META_BUSINESS_LOCKED_CODE}). Resolva no Business Manager e tente novamente.`
                          : 'Executando acao...'
                      }
                    />

                    {c.details && (
                      <details className="mt-4">
                        <summary className="cursor-pointer text-xs text-gray-400 hover:text-white transition-colors">
                          {simpleMode ? 'Detalhes (para suporte)' : 'Ver detalhes tecnicos'}
                        </summary>
                        <pre className="mt-3 text-xs bg-zinc-950/50 border border-white/10 rounded-xl p-4 overflow-auto text-gray-200">
                          {formatJsonMaybe(c.details)}
                        </pre>
                      </details>
                    )}
                  </div>
                </div>
              )
            })()}
          </Container>
        ))}
      </div>

      {/* Raw Report */}
      {reportText && (
        <Container variant="glass" padding="md">
          <div className="text-xs text-gray-500">Relatorio (resumo)</div>
          <pre className="mt-3 text-xs bg-zinc-950/50 border border-white/10 rounded-xl p-4 overflow-auto text-gray-200 whitespace-pre-wrap">
            {reportText}
          </pre>
        </Container>
      )}
    </Page>
  )
}
