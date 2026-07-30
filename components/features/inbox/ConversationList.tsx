'use client'

/**
 * ConversationList - Seamless Sidebar
 *
 * Design Philosophy:
 * - Compact header integrated with search
 * - No heavy borders between items
 * - Smooth hover states
 * - Clean filter UI
 */

import React, { useState, useMemo, useCallback } from 'react'
import { Search, SlidersHorizontal, Bot, User, X, Inbox, LoaderCircle } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Input } from '@/components/ui/input'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuCheckboxItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { ConversationItem } from './ConversationItem'
import { AttendantsPopover } from './AttendantsPopover'
import { InboxSettingsPopover } from './InboxSettingsPopover'
import type { InboxConversation, InboxLabel, ConversationStatus, ConversationMode } from '@/types'

export interface ConversationListProps {
  conversations: InboxConversation[]
  selectedId: string | null
  onSelect: (id: string) => void
  isLoading: boolean
  totalUnread: number
  hasMore: boolean
  isLoadingMore: boolean
  onLoadMore: () => void

  // Filters
  labels: InboxLabel[]
  search: string
  onSearchChange: (search: string) => void
  statusFilter: ConversationStatus | null
  onStatusFilterChange: (status: ConversationStatus | null) => void
  modeFilter: ConversationMode | null
  onModeFilterChange: (mode: ConversationMode | null) => void
  labelFilter: string | null
  onLabelFilterChange: (labelId: string | null) => void
}

export function ConversationList({
  conversations,
  selectedId,
  onSelect,
  isLoading,
  totalUnread,
  hasMore,
  isLoadingMore,
  onLoadMore,
  labels,
  search,
  onSearchChange,
  statusFilter,
  onStatusFilterChange,
  modeFilter,
  onModeFilterChange,
  labelFilter,
  onLabelFilterChange,
}: ConversationListProps) {
  const [showFilters, setShowFilters] = useState(false)

  // Active filter count
  const activeFilterCount = useMemo(() => {
    let count = 0
    if (statusFilter) count++
    if (modeFilter) count++
    if (labelFilter) count++
    return count
  }, [statusFilter, modeFilter, labelFilter])

  // Clear all filters
  const clearFilters = () => {
    onStatusFilterChange(null)
    onModeFilterChange(null)
    onLabelFilterChange(null)
    onSearchChange('')
  }

  const handleScroll = useCallback((event: React.UIEvent<HTMLDivElement>) => {
    const { scrollTop, scrollHeight, clientHeight } = event.currentTarget
    const isNearBottom = scrollHeight - scrollTop - clientHeight < 96
    if (isNearBottom && hasMore && !isLoadingMore) onLoadMore()
  }, [hasMore, isLoadingMore, onLoadMore])

  return (
    <div className="flex flex-col h-full bg-[var(--ds-bg-elevated)]">
      {/* Compact header - search integrated with filters */}
      <div className="px-3 py-2.5">
        {/* Search bar with integrated filter button */}
        <div className="relative flex items-center gap-1.5">
          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[var(--ds-text-muted)]" />
            <Input
              type="text"
              placeholder="Buscar..."
              value={search}
              onChange={(e) => onSearchChange(e.target.value)}
              className="pl-8 pr-8 h-8 text-xs bg-[var(--ds-bg-surface)]/60 border-0 rounded-lg placeholder:text-[var(--ds-text-muted)] focus:ring-1 focus:ring-[var(--ds-border-strong)]"
            />
            {search && (
              <button
                onClick={() => onSearchChange('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--ds-text-muted)] hover:text-[var(--ds-text-secondary)] transition-colors"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          {/* Attendants button */}
          <AttendantsPopover />

          {/* Settings button */}
          <InboxSettingsPopover />

          {/* Filter button */}
          <DropdownMenu open={showFilters} onOpenChange={setShowFilters}>
            <DropdownMenuTrigger asChild>
              <button
                className={cn(
                  'h-8 w-8 flex items-center justify-center rounded-lg transition-colors',
                  activeFilterCount > 0
                    ? 'bg-emerald-500/10 text-emerald-400'
                    : 'text-[var(--ds-text-muted)] hover:text-[var(--ds-text-secondary)] hover:bg-[var(--ds-bg-surface)]/60'
                )}
              >
                <SlidersHorizontal className="h-3.5 w-3.5" />
                {activeFilterCount > 0 && (
                  <span className="absolute -top-0.5 -right-0.5 w-3.5 h-3.5 rounded-full bg-emerald-500 text-[9px] text-white flex items-center justify-center">
                    {activeFilterCount}
                  </span>
                )}
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-44">
              <DropdownMenuLabel className="text-[10px] text-[var(--ds-text-muted)] uppercase tracking-wide">Status</DropdownMenuLabel>
              <DropdownMenuCheckboxItem
                checked={statusFilter === null}
                onCheckedChange={() => onStatusFilterChange(null)}
                className="text-xs"
              >
                Todas
              </DropdownMenuCheckboxItem>
              <DropdownMenuCheckboxItem
                checked={statusFilter === 'open'}
                onCheckedChange={() => onStatusFilterChange('open')}
                className="text-xs"
              >
                Abertas
              </DropdownMenuCheckboxItem>
              <DropdownMenuCheckboxItem
                checked={statusFilter === 'closed'}
                onCheckedChange={() => onStatusFilterChange('closed')}
                className="text-xs"
              >
                Fechadas
              </DropdownMenuCheckboxItem>

              <DropdownMenuSeparator />
              <DropdownMenuLabel className="text-[10px] text-[var(--ds-text-muted)] uppercase tracking-wide">Modo</DropdownMenuLabel>
              <DropdownMenuCheckboxItem
                checked={modeFilter === null}
                onCheckedChange={() => onModeFilterChange(null)}
                className="text-xs"
              >
                Todos
              </DropdownMenuCheckboxItem>
              <DropdownMenuCheckboxItem
                checked={modeFilter === 'bot'}
                onCheckedChange={() => onModeFilterChange('bot')}
                className="text-xs"
              >
                <Bot className="h-3 w-3 mr-1.5" />
                Bot
              </DropdownMenuCheckboxItem>
              <DropdownMenuCheckboxItem
                checked={modeFilter === 'human'}
                onCheckedChange={() => onModeFilterChange('human')}
                className="text-xs"
              >
                <User className="h-3 w-3 mr-1.5" />
                Humano
              </DropdownMenuCheckboxItem>

              {labels.length > 0 && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuLabel className="text-[10px] text-[var(--ds-text-muted)] uppercase tracking-wide">Etiquetas</DropdownMenuLabel>
                  <DropdownMenuCheckboxItem
                    checked={labelFilter === null}
                    onCheckedChange={() => onLabelFilterChange(null)}
                    className="text-xs"
                  >
                    Todas
                  </DropdownMenuCheckboxItem>
                  {labels.map((label) => (
                    <DropdownMenuCheckboxItem
                      key={label.id}
                      checked={labelFilter === label.id}
                      onCheckedChange={() => onLabelFilterChange(label.id)}
                      className="text-xs"
                    >
                      <span
                        className="w-2 h-2 rounded-full mr-1.5"
                        style={{ backgroundColor: label.color }}
                      />
                      {label.name}
                    </DropdownMenuCheckboxItem>
                  ))}
                </>
              )}

              {activeFilterCount > 0 && (
                <>
                  <DropdownMenuSeparator />
                  <button
                    onClick={clearFilters}
                    className="w-full flex items-center gap-1.5 px-2 py-1.5 text-xs text-[var(--ds-text-secondary)] hover:text-[var(--ds-text-primary)] hover:bg-[var(--ds-bg-hover)] rounded transition-colors"
                  >
                    <X className="h-3 w-3" />
                    Limpar filtros
                  </button>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {/* Unread count - subtle, inline */}
        {totalUnread > 0 && (
          <div className="flex items-center gap-1.5 mt-2 px-0.5">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
            <span className="text-[10px] text-[var(--ds-text-muted)]">
              {totalUnread} {totalUnread === 1 ? 'não lida' : 'não lidas'}
            </span>
          </div>
        )}
      </div>

      {/* Conversation list - no ScrollArea wrapper for native feel */}
      <div className="flex-1 overflow-y-auto" onScroll={handleScroll}>
        {isLoading ? (
          // Skeleton loading - minimal
          <div className="px-2 py-1 space-y-0.5">
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="flex items-center gap-2.5 p-2.5 animate-pulse">
                <div className="h-9 w-9 rounded-full bg-[var(--ds-bg-surface)]" />
                <div className="flex-1 space-y-1.5">
                  <div className="h-3.5 w-3/4 bg-[var(--ds-bg-surface)] rounded" />
                  <div className="h-2.5 w-1/2 bg-[var(--ds-bg-surface)]/60 rounded" />
                </div>
              </div>
            ))}
          </div>
        ) : conversations.length === 0 ? (
          // Empty state - minimal
          <div className="flex flex-col items-center justify-center h-48 text-center px-6">
            <div className="w-10 h-10 rounded-full bg-[var(--ds-bg-surface)]/50 flex items-center justify-center mb-2.5">
              <Inbox className="h-5 w-5 text-[var(--ds-text-muted)]" />
            </div>
            <p className="text-xs text-[var(--ds-text-muted)]">
              {search || activeFilterCount > 0
                ? 'Nenhuma conversa'
                : 'Inbox vazia'}
            </p>
            {(search || activeFilterCount > 0) && (
              <button
                onClick={clearFilters}
                className="mt-2 text-[10px] text-emerald-400/80 hover:text-emerald-400 transition-colors"
              >
                Limpar filtros
              </button>
            )}
          </div>
        ) : (
          // Conversation items
          <div className="px-1.5 py-0.5">
            {conversations.map((conversation) => (
              <ConversationItem
                key={conversation.id}
                conversation={conversation}
                isSelected={selectedId === conversation.id}
                onClick={() => onSelect(conversation.id)}
              />
            ))}
            {(hasMore || isLoadingMore) && (
              <div className="flex justify-center py-2">
                {isLoadingMore ? (
                  <LoaderCircle className="h-4 w-4 animate-spin text-[var(--ds-text-muted)]" aria-label="Carregando mais conversas" />
                ) : (
                  <button
                    type="button"
                    onClick={onLoadMore}
                    className="text-[11px] text-emerald-400 hover:text-emerald-300 transition-colors"
                  >
                    Carregar mais conversas
                  </button>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
