'use client'

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Smartphone, Plus, Trash2, CheckCircle2, Loader2, Webhook, AlertTriangle, RefreshCw, ShieldCheck } from 'lucide-react'
import { Page, PageDescription, PageHeader, PageTitle } from '@/components/ui/page'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import { getPlanLimitBody, formatPlanLimit } from '@/lib/plan-limit-message'

// =============================================================================
// Types & API
// =============================================================================

type WhatsAppConnectionType = 'official_api' | 'coexistence'

type WhatsAppNumberPublic = {
  phone_number_id: string
  tenant_id: string
  business_account_id: string | null
  display_label: string | null
  display_phone_number: string | null
  is_active: boolean
  connection_type: WhatsAppConnectionType | null
}

async function fetchNumbers(): Promise<WhatsAppNumberPublic[]> {
  const data = await api.get<{ numbers: WhatsAppNumberPublic[] }>('/api/whatsapp-numbers')
  return data.numbers
}

type AddNumberInput = {
  phoneNumberId: string
  businessAccountId: string
  accessToken: string
  displayLabel: string
  connectionType: WhatsAppConnectionType
}

async function addNumber(input: AddNumberInput) {
  return api.post('/api/whatsapp-numbers', input)
}

async function activateNumber(phoneNumberId: string) {
  return api.post(`/api/whatsapp-numbers/${phoneNumberId}/activate`)
}

type TestConnectionResult = {
  ok: boolean
  displayPhoneNumber?: string | null
  verifiedName?: string | null
  error?: string
}

async function testConnection(input: { phoneNumberId: string; businessAccountId: string; accessToken: string }) {
  return api.post<TestConnectionResult>('/api/settings/test-connection', input)
}

async function removeNumber(phoneNumberId: string) {
  return api.del(`/api/whatsapp-numbers/${phoneNumberId}`)
}

type WebhookStatus = {
  messagesSubscribed: boolean
  overrideCallbackUri: string | null
  expectedWebhookUrl: string
  webhookActive: boolean
  ok: boolean
  error?: string
}

async function fetchWebhookStatus(phoneNumberId: string): Promise<WebhookStatus> {
  return api.get<WebhookStatus>(`/api/whatsapp-numbers/${phoneNumberId}/webhook`)
}

async function activateWebhook(phoneNumberId: string) {
  return api.post(`/api/whatsapp-numbers/${phoneNumberId}/webhook`)
}

// =============================================================================
// Components
// =============================================================================

function WebhookStatusRow({ phoneNumberId }: { phoneNumberId: string }) {
  const queryClient = useQueryClient()
  const queryKey = ['whatsapp-number-webhook', phoneNumberId]

  const { data, isFetching, isError, refetch } = useQuery({
    queryKey,
    queryFn: () => fetchWebhookStatus(phoneNumberId),
    staleTime: 30_000,
  })

  const activateMutation = useMutation({
    mutationFn: () => activateWebhook(phoneNumberId),
    onSuccess: () => {
      toast.success('Webhook ativado! O número já deve receber mensagens.')
      queryClient.invalidateQueries({ queryKey })
    },
    onError: (error: unknown) => {
      toast.error(error instanceof Error ? error.message : 'Erro ao ativar webhook')
    },
  })

  const subscribed = data?.webhookActive === true && data?.ok !== false

  return (
    <div className="mt-3 pt-3 border-t border-zinc-800">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2 min-w-0">
          <Webhook size={14} className="text-zinc-500 shrink-0" aria-hidden="true" />
          {isFetching ? (
            <span className="text-xs text-zinc-500 inline-flex items-center gap-1.5">
              <Loader2 size={11} className="animate-spin" aria-hidden="true" />
              Verificando webhook...
            </span>
          ) : isError || data?.ok === false ? (
            <span className="text-xs text-amber-400 inline-flex items-center gap-1.5">
              <AlertTriangle size={11} aria-hidden="true" />
              Não deu pra verificar
            </span>
          ) : subscribed ? (
            <span className="text-xs text-green-400 inline-flex items-center gap-1.5">
              <CheckCircle2 size={11} aria-hidden="true" />
              Webhook ativo — recebendo mensagens
            </span>
          ) : (
            <span className="text-xs text-amber-400 inline-flex items-center gap-1.5">
              <AlertTriangle size={11} aria-hidden="true" />
              Webhook não ativo — o número não recebe mensagens
            </span>
          )}
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <Button variant="ghost" size="sm" onClick={() => refetch()} disabled={isFetching}>
            <RefreshCw size={12} className="mr-1" aria-hidden="true" />
            Verificar
          </Button>
          {!isFetching && !subscribed && (
            <Button variant="outline" size="sm" onClick={() => activateMutation.mutate()} disabled={activateMutation.isPending}>
              {activateMutation.isPending ? (
                <Loader2 size={12} className="mr-1 animate-spin" aria-hidden="true" />
              ) : (
                <Webhook size={12} className="mr-1" aria-hidden="true" />
              )}
              Ativar webhook
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}

export function NumberCard({
  number,
  onActivate,
  onRemove,
  isActivating,
  isRemoving,
}: {
  number: WhatsAppNumberPublic
  onActivate: () => void
  onRemove: () => void
  isActivating: boolean
  isRemoving: boolean
}) {
  const label = number.display_phone_number || number.display_label || number.phone_number_id

  return (
    <div
      className={`bg-zinc-900 border rounded-xl p-5 ${
        number.is_active ? 'border-primary-500/40' : 'border-zinc-800'
      }`}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-10 h-10 rounded-lg bg-primary-500/10 flex items-center justify-center shrink-0">
            <Smartphone className="w-5 h-5 text-primary-400" aria-hidden="true" />
          </div>
          <div className="min-w-0">
            <h4 className="font-medium text-zinc-100 truncate">{label}</h4>
            <p className="text-xs text-zinc-500 truncate">
              ID: {number.phone_number_id}
              {number.business_account_id ? ` · Conta: ${number.business_account_id}` : ''}
            </p>
          </div>
        </div>

        <div className="flex flex-col items-end gap-1.5 shrink-0">
          {number.is_active && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-green-500/10 text-green-400 border border-green-500/20">
              <CheckCircle2 size={10} aria-hidden="true" />
              Ativo
            </span>
          )}
          {number.connection_type && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-zinc-800 text-zinc-400 border border-zinc-700">
              {number.connection_type === 'official_api' ? 'API oficial' : 'Coexistência'}
            </span>
          )}
        </div>
      </div>

      <div className="flex items-center gap-2 mt-4">
        {!number.is_active && (
          <Button variant="outline" size="sm" onClick={onActivate} disabled={isActivating}>
            {isActivating ? (
              <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" aria-hidden="true" />
            ) : null}
            Definir como ativo
          </Button>
        )}
        <Button variant="ghost-destructive" size="sm" onClick={onRemove} disabled={isRemoving}>
          {isRemoving ? (
            <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" aria-hidden="true" />
          ) : (
            <Trash2 className="w-3.5 h-3.5 mr-1.5" aria-hidden="true" />
          )}
          Remover
        </Button>
      </div>

      <WebhookStatusRow phoneNumberId={number.phone_number_id} />
    </div>
  )
}

export function AddNumberForm({ onSuccess }: { onSuccess: () => void }) {
  const [phoneNumberId, setPhoneNumberId] = useState('')
  const [businessAccountId, setBusinessAccountId] = useState('')
  const [accessToken, setAccessToken] = useState('')
  const [displayLabel, setDisplayLabel] = useState('')
  const [connectionType, setConnectionType] = useState<WhatsAppConnectionType>('coexistence')
  const [testResult, setTestResult] = useState<{ displayPhoneNumber?: string | null; verifiedName?: string | null } | null>(null)
  const [testError, setTestError] = useState<string | null>(null)

  const queryClient = useQueryClient()

  const canTest = Boolean(phoneNumberId.trim() && businessAccountId.trim() && accessToken.trim())

  // Editar qualquer campo depois de um teste invalida o resultado — o que foi
  // testado pode não ser mais o que está nos campos.
  const invalidateTest = () => {
    setTestResult(null)
    setTestError(null)
  }

  const testMutation = useMutation({
    mutationFn: testConnection,
    onSuccess: (result) => {
      setTestResult({ displayPhoneNumber: result.displayPhoneNumber, verifiedName: result.verifiedName })
      setTestError(null)
    },
    onError: (error: unknown) => {
      setTestResult(null)
      setTestError(error instanceof Error ? error.message : 'Erro ao testar conexão')
    },
  })

  const mutation = useMutation({
    mutationFn: addNumber,
    onSuccess: (result: unknown) => {
      const webhookOk = (result as { webhookSubscribed?: boolean })?.webhookSubscribed === true
      if (webhookOk) {
        toast.success('Número adicionado e webhook ativado — já pronto pra receber mensagens!')
      } else {
        toast.warning('Número adicionado, mas o webhook não ativou automaticamente. Use o botão "Ativar webhook" no card do número.')
      }
      setPhoneNumberId('')
      setBusinessAccountId('')
      setAccessToken('')
      setDisplayLabel('')
      invalidateTest()
      queryClient.invalidateQueries({ queryKey: ['whatsapp-numbers'] })
      onSuccess()
    },
    onError: (error: unknown) => {
      const planLimit = getPlanLimitBody(error)
      if (planLimit) {
        toast.error(formatPlanLimit(planLimit), {
          action: { label: 'Ver meu plano', onClick: () => { window.location.href = '/settings/plano' } },
        })
        return
      }
      toast.error(error instanceof Error ? error.message : 'Erro ao adicionar número')
    },
  })

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!phoneNumberId.trim() || !businessAccountId.trim() || !accessToken.trim()) {
      toast.error('Preencha ID do número, ID da conta e token de acesso')
      return
    }
    if (!testResult) {
      toast.error('Teste a conexão antes de adicionar o número')
      return
    }
    mutation.mutate({
      phoneNumberId: phoneNumberId.trim(),
      businessAccountId: businessAccountId.trim(),
      accessToken: accessToken.trim(),
      displayLabel: displayLabel.trim(),
      connectionType,
    })
  }

  const handleTest = () => {
    if (!canTest) return
    testMutation.mutate({
      phoneNumberId: phoneNumberId.trim(),
      businessAccountId: businessAccountId.trim(),
      accessToken: accessToken.trim(),
    })
  }

  return (
    <form onSubmit={handleSubmit} className="bg-zinc-900 border border-zinc-800 rounded-xl p-6">
      <h3 className="text-lg font-medium mb-4 flex items-center gap-2">
        <Plus size={18} className="text-primary-400" aria-hidden="true" />
        Adicionar Número
      </h3>

      <div className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="phoneNumberId">ID do número (Phone Number ID)</Label>
          <Input
            id="phoneNumberId"
            placeholder="Ex: 123456789012345"
            value={phoneNumberId}
            onChange={(e) => { setPhoneNumberId(e.target.value); invalidateTest() }}
            className="max-w-sm"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="businessAccountId">ID da conta comercial (Business Account ID)</Label>
          <Input
            id="businessAccountId"
            placeholder="Ex: 987654321098765"
            value={businessAccountId}
            onChange={(e) => { setBusinessAccountId(e.target.value); invalidateTest() }}
            className="max-w-sm"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="accessToken">Token de acesso</Label>
          <Input
            id="accessToken"
            type="password"
            placeholder="Token permanente da Meta"
            value={accessToken}
            onChange={(e) => { setAccessToken(e.target.value); invalidateTest() }}
            className="max-w-sm"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="displayLabel">Nome de exibição (opcional)</Label>
          <Input
            id="displayLabel"
            placeholder="Ex: Vendas SP"
            value={displayLabel}
            onChange={(e) => setDisplayLabel(e.target.value)}
            className="max-w-sm"
          />
        </div>

        <div className="space-y-2">
          <Label>Tipo de número</Label>
          <div className="flex flex-col gap-2">
            <label htmlFor="connectionTypeCoexistence" className="flex items-center gap-2 text-sm text-zinc-300">
              <input
                id="connectionTypeCoexistence"
                type="radio"
                name="connectionType"
                value="coexistence"
                checked={connectionType === 'coexistence'}
                onChange={() => setConnectionType('coexistence')}
              />
              Coexistência (app do WhatsApp Business no celular + API ao mesmo tempo)
            </label>
            <label htmlFor="connectionTypeOfficialApi" className="flex items-center gap-2 text-sm text-zinc-300">
              <input
                id="connectionTypeOfficialApi"
                type="radio"
                name="connectionType"
                value="official_api"
                checked={connectionType === 'official_api'}
                onChange={() => setConnectionType('official_api')}
              />
              API oficial (sem app no celular)
            </label>
          </div>
          {connectionType === 'coexistence' && (
            <p className="text-xs text-zinc-500">
              Pra funcionar, o vínculo do app do WhatsApp Business no celular com essa conta precisa estar concluído na Meta — sem isso a ativação do webhook pode falhar.
            </p>
          )}
        </div>

        {testError && (
          <div className="flex items-start gap-2 rounded-lg border border-red-500/20 bg-red-500/10 p-3 text-sm">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-400" aria-hidden="true" />
            <p className="text-red-200">{testError}</p>
          </div>
        )}

        {testResult && (
          <div className="flex items-start gap-2 rounded-lg border border-green-500/20 bg-green-500/10 p-3 text-sm">
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-green-400" aria-hidden="true" />
            <div className="text-green-200">
              <p className="font-medium">Conexão válida</p>
              {testResult.displayPhoneNumber && <p>{testResult.displayPhoneNumber}</p>}
              {testResult.verifiedName && <p className="text-green-300/80">{testResult.verifiedName}</p>}
            </div>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={handleTest}
            disabled={!canTest || testMutation.isPending}
          >
            {testMutation.isPending ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" aria-hidden="true" />
                Testando...
              </>
            ) : (
              <>
                <ShieldCheck className="w-4 h-4 mr-2" aria-hidden="true" />
                Testar Conexão
              </>
            )}
          </Button>

          <Button type="submit" disabled={mutation.isPending || !testResult}>
            {mutation.isPending ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" aria-hidden="true" />
                Adicionando...
              </>
            ) : (
              <>
                <Plus className="w-4 h-4 mr-2" aria-hidden="true" />
                Adicionar Número
              </>
            )}
          </Button>
        </div>
      </div>
    </form>
  )
}

// =============================================================================
// Main Page
// =============================================================================

export default function NumerosPage() {
  const queryClient = useQueryClient()
  const [showAddForm, setShowAddForm] = useState(false)
  const [activatingId, setActivatingId] = useState<string | null>(null)
  const [removingId, setRemovingId] = useState<string | null>(null)

  const { data: numbers = [], isLoading } = useQuery({
    queryKey: ['whatsapp-numbers'],
    queryFn: fetchNumbers,
  })

  const activateMutation = useMutation({
    mutationFn: activateNumber,
    onSuccess: () => {
      toast.success('Número ativo atualizado')
      queryClient.invalidateQueries({ queryKey: ['whatsapp-numbers'] })
      setActivatingId(null)
    },
    onError: (error: unknown) => {
      toast.error(error instanceof Error ? error.message : 'Erro ao ativar número')
      setActivatingId(null)
    },
  })

  const removeMutation = useMutation({
    mutationFn: removeNumber,
    onSuccess: () => {
      toast.success('Número removido')
      queryClient.invalidateQueries({ queryKey: ['whatsapp-numbers'] })
      setRemovingId(null)
    },
    onError: (error: unknown) => {
      toast.error(error instanceof Error ? error.message : 'Erro ao remover número')
      setRemovingId(null)
    },
  })

  const handleActivate = (phoneNumberId: string) => {
    setActivatingId(phoneNumberId)
    activateMutation.mutate(phoneNumberId)
  }

  const handleRemove = (phoneNumberId: string, label: string) => {
    if (confirm(`Tem certeza que deseja remover "${label}"?`)) {
      setRemovingId(phoneNumberId)
      removeMutation.mutate(phoneNumberId)
    }
  }

  if (isLoading) {
    return (
      <Page>
        <div className="flex items-center justify-center h-64">
          <Loader2 className="w-8 h-8 animate-spin text-zinc-500" aria-hidden="true" />
        </div>
      </Page>
    )
  }

  return (
    <Page>
      <PageHeader>
        <div className="flex items-center justify-between w-full">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-xl bg-primary-500/10 flex items-center justify-center">
              <Smartphone className="w-6 h-6 text-primary-400" aria-hidden="true" />
            </div>
            <div>
              <PageTitle>Números de WhatsApp</PageTitle>
              <PageDescription>
                Gerencie os números conectados e escolha qual está ativo para novos envios
              </PageDescription>
            </div>
          </div>
          <Button size="sm" onClick={() => setShowAddForm(!showAddForm)}>
            <Plus size={14} className="mr-1.5" aria-hidden="true" />
            Adicionar número
          </Button>
        </div>
      </PageHeader>

      <div className="max-w-3xl space-y-6">
        {showAddForm && <AddNumberForm onSuccess={() => setShowAddForm(false)} />}

        {numbers.length === 0 ? (
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-8 text-center">
            <Smartphone size={40} className="mx-auto text-zinc-600 mb-3" aria-hidden="true" />
            <h3 className="text-lg font-medium mb-1">Nenhum número conectado</h3>
            <p className="text-sm text-zinc-500 mb-4">
              Adicione um número de WhatsApp para começar a enviar campanhas
            </p>
            <Button onClick={() => setShowAddForm(true)}>
              <Plus size={14} className="mr-1.5" aria-hidden="true" />
              Adicionar Número
            </Button>
          </div>
        ) : (
          <div className="space-y-4">
            <h3 className="text-sm font-medium text-zinc-400">
              {numbers.length} número{numbers.length !== 1 ? 's' : ''}
            </h3>

            {numbers.map((number) => (
              <NumberCard
                key={number.phone_number_id}
                number={number}
                onActivate={() => handleActivate(number.phone_number_id)}
                onRemove={() =>
                  handleRemove(number.phone_number_id, number.display_phone_number || number.display_label || number.phone_number_id)
                }
                isActivating={activatingId === number.phone_number_id && activateMutation.isPending}
                isRemoving={removingId === number.phone_number_id && removeMutation.isPending}
              />
            ))}
          </div>
        )}
      </div>
    </Page>
  )
}
