'use client'

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Smartphone, Plus, Trash2, CheckCircle2, Loader2 } from 'lucide-react'
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

type WhatsAppNumberPublic = {
  phone_number_id: string
  tenant_id: string
  business_account_id: string | null
  display_label: string | null
  display_phone_number: string | null
  is_active: boolean
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
}

async function addNumber(input: AddNumberInput) {
  return api.post('/api/whatsapp-numbers', input)
}

async function activateNumber(phoneNumberId: string) {
  return api.post(`/api/whatsapp-numbers/${phoneNumberId}/activate`)
}

async function removeNumber(phoneNumberId: string) {
  return api.del(`/api/whatsapp-numbers/${phoneNumberId}`)
}

// =============================================================================
// Components
// =============================================================================

function NumberCard({
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

        {number.is_active && (
          <span className="inline-flex shrink-0 items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-green-500/10 text-green-400 border border-green-500/20">
            <CheckCircle2 size={10} aria-hidden="true" />
            Ativo
          </span>
        )}
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
    </div>
  )
}

function AddNumberForm({ onSuccess }: { onSuccess: () => void }) {
  const [phoneNumberId, setPhoneNumberId] = useState('')
  const [businessAccountId, setBusinessAccountId] = useState('')
  const [accessToken, setAccessToken] = useState('')
  const [displayLabel, setDisplayLabel] = useState('')

  const queryClient = useQueryClient()

  const mutation = useMutation({
    mutationFn: addNumber,
    onSuccess: () => {
      toast.success('Número adicionado com sucesso!')
      setPhoneNumberId('')
      setBusinessAccountId('')
      setAccessToken('')
      setDisplayLabel('')
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
    mutation.mutate({
      phoneNumberId: phoneNumberId.trim(),
      businessAccountId: businessAccountId.trim(),
      accessToken: accessToken.trim(),
      displayLabel: displayLabel.trim(),
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
            onChange={(e) => setPhoneNumberId(e.target.value)}
            className="max-w-sm"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="businessAccountId">ID da conta comercial (Business Account ID)</Label>
          <Input
            id="businessAccountId"
            placeholder="Ex: 987654321098765"
            value={businessAccountId}
            onChange={(e) => setBusinessAccountId(e.target.value)}
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
            onChange={(e) => setAccessToken(e.target.value)}
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

        <Button type="submit" disabled={mutation.isPending} className="w-full sm:w-auto">
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
