'use client'

import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Loader2, Search, UserPlus } from 'lucide-react'
import { toast } from 'sonner'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { api, ApiError } from '@/lib/api'
import { addCard } from './api'

type ContactSearchResult = {
  id: string
  name: string | null
  phone: string | null
}

interface AddCardDialogProps {
  boardId: string
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function AddCardDialog({ boardId, open, onOpenChange }: AddCardDialogProps) {
  const queryClient = useQueryClient()
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')

  useEffect(() => {
    const timeout = setTimeout(() => setDebouncedSearch(search.trim()), 300)
    return () => clearTimeout(timeout)
  }, [search])

  useEffect(() => {
    if (!open) {
      setSearch('')
      setDebouncedSearch('')
    }
  }, [open])

  const { data: results = [], isFetching } = useQuery<ContactSearchResult[]>({
    queryKey: ['kanban-contact-search', debouncedSearch],
    queryFn: async () => {
      const data = await api.get<{ data: ContactSearchResult[] }>(
        `/api/contacts?limit=10&offset=0&search=${encodeURIComponent(debouncedSearch)}`
      )
      return data.data
    },
    enabled: open && debouncedSearch.length > 0,
  })

  const addMutation = useMutation({
    mutationFn: (contactId: string) => addCard(boardId, contactId),
    onSuccess: () => {
      toast.success('Cliente adicionado ao funil')
      queryClient.invalidateQueries({ queryKey: ['kanban-board-data', boardId] })
      onOpenChange(false)
    },
    onError: (error: unknown) => {
      if (error instanceof ApiError && error.body && (error.body as any).error === 'card_exists') {
        toast.error('Este cliente já está neste funil')
        return
      }
      toast.error(error instanceof Error ? error.message : 'Erro ao adicionar cliente')
    },
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Adicionar cliente</DialogTitle>
          <DialogDescription>Busque um contato para adicionar a este funil.</DialogDescription>
        </DialogHeader>

        <div className="relative">
          <Search
            size={16}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--ds-text-muted)]"
            aria-hidden="true"
          />
          <Input
            autoFocus
            placeholder="Nome, telefone ou e-mail..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>

        <div className="max-h-72 space-y-1 overflow-y-auto">
          {isFetching && (
            <div className="flex items-center justify-center py-6 text-[var(--ds-text-muted)]">
              <Loader2 className="animate-spin" size={18} aria-hidden="true" />
            </div>
          )}

          {!isFetching && debouncedSearch.length > 0 && results.length === 0 && (
            <p className="py-6 text-center text-sm text-[var(--ds-text-muted)]">Nenhum contato encontrado</p>
          )}

          {!isFetching && debouncedSearch.length === 0 && (
            <p className="py-6 text-center text-sm text-[var(--ds-text-muted)]">Digite para buscar contatos</p>
          )}

          {results.map((contact) => (
            <button
              key={contact.id}
              type="button"
              onClick={() => addMutation.mutate(contact.id)}
              disabled={addMutation.isPending}
              className="flex w-full items-center justify-between gap-3 rounded-xl border border-transparent px-3 py-2 text-left hover:border-[var(--ds-border-subtle)] hover:bg-[var(--ds-bg-muted)] disabled:opacity-50"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-[var(--ds-text-primary)]">
                  {contact.name?.trim() || contact.phone || 'Contato'}
                </p>
                {contact.phone && (
                  <p className="truncate text-xs text-[var(--ds-text-muted)]">{contact.phone}</p>
                )}
              </div>
              <UserPlus size={16} className="shrink-0 text-[var(--ds-text-muted)]" aria-hidden="true" />
            </button>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  )
}
