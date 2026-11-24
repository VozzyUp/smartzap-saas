'use client'

/**
 * AIAgentCompactCard - Card minimalista para agentes secundários
 * Usado na seção colapsável "Outros agentes"
 */

import React from 'react'
import { Star, Pencil, Trash2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import type { AIAgent } from '@/types'

export interface AIAgentCompactCardProps {
  agent: AIAgent
  onEdit: (agent: AIAgent) => void
  onDelete: (agent: AIAgent) => void
  onSetDefault: (agent: AIAgent) => void
  onToggleActive: (agent: AIAgent, isActive: boolean) => void
  isUpdating?: boolean
  disabled?: boolean
}

// Gera iniciais do nome
function getInitials(name: string): string {
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map(n => n[0])
    .join('')
    .toUpperCase()
}

export function AIAgentCompactCard({
  agent,
  onEdit,
  onDelete,
  onSetDefault,
  onToggleActive,
  isUpdating,
  disabled,
}: AIAgentCompactCardProps) {
  return (
    <div
      className={cn(
        'group flex flex-wrap items-center gap-3 p-3 rounded-xl transition-all',
        'bg-zinc-900/50 hover:bg-zinc-800/50',
        'border border-zinc-800/50 hover:border-zinc-700/50',
        !agent.is_active && 'opacity-60'
      )}
    >
      {/* Avatar pequeno */}
      <div
        className={cn(
          'flex items-center justify-center w-10 h-10 rounded-lg text-sm font-semibold flex-shrink-0',
          agent.is_active
            ? 'bg-zinc-800 text-zinc-300'
            : 'bg-zinc-800/50 text-zinc-500'
        )}
      >
        {getInitials(agent.name)}
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <h4 className="font-medium text-white truncate">{agent.name}</h4>
          {/* Status dot */}
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={() => onToggleActive(agent, !agent.is_active)}
                disabled={isUpdating || disabled}
                className={cn(
                  'relative w-2 h-2 rounded-full transition-all flex-shrink-0 max-sm:after:absolute max-sm:after:-inset-4 max-sm:after:content-[""]',
                  agent.is_active
                    ? 'bg-primary-400 shadow-[0_0_6px] shadow-primary-400/50'
                    : 'bg-zinc-600 hover:bg-zinc-500'
                )}
              />
            </TooltipTrigger>
            <TooltipContent>
              {agent.is_active ? 'Ativo - Clique para desativar' : 'Inativo - Clique para ativar'}
            </TooltipContent>
          </Tooltip>
        </div>
        <p className="text-xs text-zinc-500">
          {agent.is_active ? 'Ativo' : 'Inativo'}
        </p>
      </div>

      {/* Ações - aparecem no hover */}
      <div className="flex w-full flex-wrap items-center justify-end gap-1 transition-opacity sm:w-auto sm:flex-nowrap sm:opacity-0 sm:group-hover:opacity-100">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onSetDefault(agent)}
              disabled={isUpdating || disabled}
              className="h-8 px-2 text-xs text-zinc-400 hover:text-primary-400"
            >
              <Star className="h-3.5 w-3.5 mr-1" />
              Tornar principal
            </Button>
          </TooltipTrigger>
          <TooltipContent>Definir como agente principal</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => onEdit(agent)}
              disabled={isUpdating || disabled}
              className="h-8 w-8 text-zinc-400 hover:text-white"
            >
              <Pencil className="h-3.5 w-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Editar</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => onDelete(agent)}
              disabled={isUpdating || disabled}
              className="h-8 w-8 text-zinc-400 hover:text-red-400"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Excluir</TooltipContent>
        </Tooltip>
      </div>
    </div>
  )
}
