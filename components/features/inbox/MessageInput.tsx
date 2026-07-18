'use client'

/**
 * MessageInput - Editorial Minimal Design
 *
 * Design Philosophy:
 * - Ultra-clean input area
 * - Subtle borders and backgrounds
 * - Smooth micro-interactions
 * - Refined button states
 * - Inline shortcut autocomplete (/comando)
 */

import React, { useState, useRef, useCallback, useEffect, useMemo } from 'react'
import { Send, Loader2, Sparkles, Paperclip, X, FileText, Music } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { Textarea } from '@/components/ui/textarea'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { QuickRepliesPopover } from './QuickRepliesPopover'
import type { InboxQuickReply } from '@/types'

export interface MessageInputProps {
  onSend: (content: string) => void
  isSending: boolean
  disabled?: boolean
  placeholder?: string
  quickReplies: InboxQuickReply[]
  quickRepliesLoading?: boolean
  /** Callback to refresh quick replies after CRUD operations */
  onRefreshQuickReplies?: () => void
  /** Conversation ID for AI suggestions and for sending attachments */
  conversationId?: string | null
  /** Whether to show AI suggest button */
  showAISuggest?: boolean
}

type AttachmentKind = 'image' | 'video' | 'audio' | 'document'

const MAX_SIZE_BY_KIND: Record<AttachmentKind, number> = {
  image: 5 * 1024 * 1024,
  video: 16 * 1024 * 1024,
  audio: 16 * 1024 * 1024,
  document: 100 * 1024 * 1024,
}

const ACCEPTED_FILE_TYPES =
  'image/*,video/*,audio/*,application/pdf,application/msword,' +
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document,' +
  'application/vnd.ms-excel,' +
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,' +
  'application/vnd.ms-powerpoint,' +
  'application/vnd.openxmlformats-officedocument.presentationml.presentation,' +
  'text/plain,text/csv'

function attachmentKindFromMime(mime: string): AttachmentKind {
  if (mime.startsWith('image/')) return 'image'
  if (mime.startsWith('video/')) return 'video'
  if (mime.startsWith('audio/')) return 'audio'
  return 'document'
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function MessageInput({
  onSend,
  isSending,
  disabled,
  placeholder = 'Escreva uma mensagem...',
  quickReplies,
  quickRepliesLoading,
  onRefreshQuickReplies,
  conversationId,
  showAISuggest = false,
}: MessageInputProps) {
  const [value, setValue] = useState('')
  const [isLoadingSuggestion, setIsLoadingSuggestion] = useState(false)
  const [suggestionNotes, setSuggestionNotes] = useState<string | null>(null)
  const [isFocused, setIsFocused] = useState(false)
  const [selectedShortcutIndex, setSelectedShortcutIndex] = useState(0)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const autocompleteRef = useRef<HTMLDivElement>(null)
  const wasSendingRef = useRef(false)

  // Attachment (Fase 5A - Task 9)
  const [attachedFile, setAttachedFile] = useState<File | null>(null)
  const [attachmentPreviewUrl, setAttachmentPreviewUrl] = useState<string | null>(null)
  const [attachmentCaption, setAttachmentCaption] = useState('')
  const [isUploadingAttachment, setIsUploadingAttachment] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const attachmentKind = useMemo(
    () => (attachedFile ? attachmentKindFromMime(attachedFile.type || '') : null),
    [attachedFile]
  )

  // Revoke the object URL when the attachment changes or the component unmounts
  useEffect(() => {
    return () => {
      if (attachmentPreviewUrl) {
        URL.revokeObjectURL(attachmentPreviewUrl)
      }
    }
  }, [attachmentPreviewUrl])

  const clearAttachment = useCallback(() => {
    setAttachmentPreviewUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev)
      return null
    })
    setAttachedFile(null)
    setAttachmentCaption('')
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
  }, [])

  const handleFileSelected = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    const kind = attachmentKindFromMime(file.type || '')
    const maxSize = MAX_SIZE_BY_KIND[kind]
    if (file.size > maxSize) {
      toast.error(
        `Arquivo muito grande para ${kind} (máx. ${formatFileSize(maxSize)})`
      )
      if (fileInputRef.current) fileInputRef.current.value = ''
      return
    }

    setAttachmentPreviewUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev)
      return kind === 'image' || kind === 'video' ? URL.createObjectURL(file) : null
    })
    setAttachedFile(file)
    setAttachmentCaption('')
  }, [])

  const handleSendAttachment = useCallback(async () => {
    if (!attachedFile || !conversationId || isUploadingAttachment || disabled) return

    setIsUploadingAttachment(true)
    try {
      const formData = new FormData()
      formData.append('file', attachedFile)
      if (attachmentCaption.trim()) {
        formData.append('caption', attachmentCaption.trim())
      }

      const response = await fetch(`/api/inbox/conversations/${conversationId}/media`, {
        method: 'POST',
        body: formData,
      })

      if (!response.ok) {
        const data = await response.json().catch(() => null)
        throw new Error(data?.error || 'Erro ao enviar arquivo')
      }

      toast.success('Arquivo enviado')
      clearAttachment()
    } catch (error) {
      console.error('[MessageInput] Erro ao enviar anexo:', error)
      toast.error(error instanceof Error ? error.message : 'Erro ao enviar arquivo')
    } finally {
      setIsUploadingAttachment(false)
    }
  }, [attachedFile, attachmentCaption, conversationId, isUploadingAttachment, disabled, clearAttachment])

  // Detect shortcut pattern: /word at start or after space
  const shortcutMatch = useMemo(() => {
    // Match /word at the end of the input (what user is currently typing)
    const match = value.match(/(^|\s)\/([a-z0-9]*)$/i)
    if (!match) return null
    return {
      prefix: match[1], // space or empty
      query: match[2].toLowerCase(), // text after /
      fullMatch: match[0],
      startIndex: value.length - match[0].length,
    }
  }, [value])

  // Filter quick replies by shortcut
  const shortcutSuggestions = useMemo(() => {
    if (!shortcutMatch) return []
    const { query } = shortcutMatch

    // Only show suggestions for quick replies that have shortcuts
    return quickReplies
      .filter((qr) => qr.shortcut && qr.shortcut.toLowerCase().startsWith(query))
      .slice(0, 5) // Limit to 5 suggestions
  }, [shortcutMatch, quickReplies])

  // Reset selection when suggestions change
  useEffect(() => {
    setSelectedShortcutIndex(0)
  }, [shortcutSuggestions.length])

  // Auto-resize textarea
  useEffect(() => {
    const textarea = textareaRef.current
    if (textarea) {
      textarea.style.height = 'auto'
      textarea.style.height = `${Math.min(textarea.scrollHeight, 120)}px`
    }
  }, [value])

  // Refocus input after send completes (isSending: true -> false)
  useEffect(() => {
    if (wasSendingRef.current && !isSending) {
      // Envio terminou, refocalizar o input
      textareaRef.current?.focus()
    }
    wasSendingRef.current = isSending
  }, [isSending])

  // Handle send
  const handleSend = useCallback(() => {
    const trimmed = value.trim()
    if (!trimmed || isSending || disabled) return

    onSend(trimmed)
    setValue('')
    setSuggestionNotes(null)

    // Reset textarea height (refocus é feito pelo useEffect quando isSending muda para false)
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
    }
  }, [value, isSending, disabled, onSend])

  // Insert quick reply content (from popover)
  const handleQuickReplySelect = useCallback((content: string) => {
    setValue((prev) => {
      if (prev.trim()) {
        return `${prev.trimEnd()} ${content}`
      }
      return content
    })
    setTimeout(() => textareaRef.current?.focus(), 0)
  }, [])

  // Insert shortcut content (from autocomplete)
  const handleShortcutSelect = useCallback((qr: InboxQuickReply) => {
    if (!shortcutMatch) return

    // Replace the /shortcut with the content
    const beforeShortcut = value.slice(0, shortcutMatch.startIndex)
    const newValue = beforeShortcut.trimEnd() + (beforeShortcut ? ' ' : '') + qr.content

    setValue(newValue)
    setTimeout(() => textareaRef.current?.focus(), 0)
  }, [value, shortcutMatch])

  // Handle keyboard shortcuts
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      // Handle autocomplete navigation
      if (shortcutSuggestions.length > 0) {
        if (e.key === 'ArrowDown') {
          e.preventDefault()
          setSelectedShortcutIndex((prev) =>
            prev < shortcutSuggestions.length - 1 ? prev + 1 : 0
          )
          return
        }
        if (e.key === 'ArrowUp') {
          e.preventDefault()
          setSelectedShortcutIndex((prev) =>
            prev > 0 ? prev - 1 : shortcutSuggestions.length - 1
          )
          return
        }
        if (e.key === 'Enter' || e.key === 'Tab') {
          e.preventDefault()
          handleShortcutSelect(shortcutSuggestions[selectedShortcutIndex])
          return
        }
        if (e.key === 'Escape') {
          // Clear the shortcut by removing the /
          setValue((prev) => prev.slice(0, -1))
          return
        }
      }

      // Ctrl/Cmd + Enter to send
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault()
        handleSend()
      }
    },
    [handleSend, shortcutSuggestions, selectedShortcutIndex, handleShortcutSelect]
  )

  // AI Suggest handler
  const handleAISuggest = useCallback(async () => {
    if (!conversationId || isLoadingSuggestion || disabled) return

    setIsLoadingSuggestion(true)
    setSuggestionNotes(null)

    try {
      const response = await fetch('/api/inbox/suggest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conversationId }),
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || 'Erro ao gerar sugestão')
      }

      const data = await response.json()
      setValue(data.suggestion)

      if (data.notes) {
        setSuggestionNotes(data.notes)
      }

      setTimeout(() => {
        textareaRef.current?.focus()
        if (textareaRef.current) {
          textareaRef.current.selectionStart = textareaRef.current.value.length
          textareaRef.current.selectionEnd = textareaRef.current.value.length
        }
      }, 0)
    } catch (error) {
      console.error('[AI Suggest] Error:', error)
    } finally {
      setIsLoadingSuggestion(false)
    }
  }, [conversationId, isLoadingSuggestion, disabled])

  // Clear suggestion notes when value is cleared
  useEffect(() => {
    if (suggestionNotes && value.trim() === '') {
      setSuggestionNotes(null)
    }
  }, [value, suggestionNotes])

  const canSend = value.trim().length > 0 && !isSending && !disabled
  const canSuggest = showAISuggest && conversationId && !isLoadingSuggestion && !disabled

  return (
    <div className={cn(
      'border-t transition-colors duration-150',
      isFocused ? 'border-[var(--ds-border-strong)]' : 'border-[var(--ds-border-subtle)]',
      'bg-[var(--ds-bg-elevated)]'
    )}>
      {/* AI Suggestion notes - subtle inline banner */}
      {suggestionNotes && (
        <div className="px-3 py-2 bg-[var(--ds-bg-surface)]/50 border-b border-[var(--ds-border-subtle)]">
          <div className="flex items-start gap-2">
            <Sparkles className="h-3 w-3 text-[var(--ds-text-muted)] mt-0.5 shrink-0" />
            <p className="text-[11px] text-[var(--ds-text-muted)] leading-relaxed">{suggestionNotes}</p>
          </div>
        </div>
      )}

      {/* Attachment preview - Fase 5A (Task 9) */}
      {attachedFile && (
        <div className="px-3 pt-3 border-b border-[var(--ds-border-subtle)] pb-3">
          <div className="flex items-start gap-3 bg-[var(--ds-bg-surface)]/50 rounded-lg p-2.5">
            {/* Thumbnail / icon */}
            <div className="shrink-0 h-14 w-14 rounded-md overflow-hidden bg-[var(--ds-bg-hover)] flex items-center justify-center">
              {attachmentKind === 'image' && attachmentPreviewUrl ? (
                <img
                  src={attachmentPreviewUrl}
                  alt={attachedFile.name}
                  className="h-full w-full object-cover"
                />
              ) : attachmentKind === 'video' && attachmentPreviewUrl ? (
                <video src={attachmentPreviewUrl} className="h-full w-full object-cover" muted />
              ) : attachmentKind === 'audio' ? (
                <Music className="h-5 w-5 text-[var(--ds-text-muted)]" />
              ) : (
                <FileText className="h-5 w-5 text-[var(--ds-text-muted)]" />
              )}
            </div>

            {/* File info + caption */}
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium text-[var(--ds-text-primary)] truncate">
                {attachedFile.name}
              </p>
              <p className="text-[10px] text-[var(--ds-text-muted)] mb-1.5">
                {formatFileSize(attachedFile.size)}
              </p>
              <input
                type="text"
                value={attachmentCaption}
                onChange={(e) => setAttachmentCaption(e.target.value)}
                placeholder="Adicionar legenda (opcional)"
                disabled={isUploadingAttachment}
                className={cn(
                  'w-full text-xs px-2 py-1.5 rounded-md',
                  'bg-[var(--ds-bg-surface)] border border-[var(--ds-border-subtle)]',
                  'text-[var(--ds-text-primary)] placeholder:text-[var(--ds-text-muted)]',
                  'focus:outline-none focus:border-[var(--ds-border-strong)]',
                  isUploadingAttachment && 'opacity-50'
                )}
              />
            </div>

            {/* Actions */}
            <div className="flex items-center gap-1.5 shrink-0">
              <button
                type="button"
                onClick={clearAttachment}
                disabled={isUploadingAttachment}
                className={cn(
                  'h-8 w-8 rounded-md flex items-center justify-center',
                  'text-[var(--ds-text-muted)] hover:text-[var(--ds-text-primary)] hover:bg-[var(--ds-bg-hover)]',
                  'transition-colors',
                  isUploadingAttachment && 'opacity-40 cursor-not-allowed'
                )}
                title="Cancelar"
              >
                <X className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={handleSendAttachment}
                disabled={isUploadingAttachment || !conversationId || disabled}
                className={cn(
                  'h-8 w-8 rounded-md flex items-center justify-center',
                  'bg-emerald-600 text-white hover:bg-emerald-500 active:scale-95',
                  'transition-all',
                  (isUploadingAttachment || !conversationId || disabled) &&
                    'opacity-50 cursor-not-allowed'
                )}
                title="Enviar"
              >
                {isUploadingAttachment ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Send className="h-4 w-4" />
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="flex items-end gap-2 p-3">
        {/* Quick replies */}
        <QuickRepliesPopover
          quickReplies={quickReplies}
          onSelect={handleQuickReplySelect}
          isLoading={quickRepliesLoading}
          onRefresh={onRefreshQuickReplies}
        />

        {/* Attachment button - Fase 5A (Task 9) */}
        <input
          ref={fileInputRef}
          type="file"
          hidden
          accept={ACCEPTED_FILE_TYPES}
          onChange={handleFileSelected}
          disabled={disabled}
        />
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={disabled || !conversationId}
              className={cn(
                'h-9 w-9 shrink-0 rounded-lg flex items-center justify-center',
                'transition-all duration-150',
                disabled || !conversationId
                  ? 'text-[var(--ds-text-muted)] cursor-not-allowed'
                  : 'text-[var(--ds-text-secondary)] hover:text-[var(--ds-text-primary)] hover:bg-[var(--ds-bg-hover)]'
              )}
            >
              <Paperclip className="h-4 w-4" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="top" className="text-xs">
            Anexar arquivo
          </TooltipContent>
        </Tooltip>

        {/* AI Suggest button */}
        {showAISuggest && (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={handleAISuggest}
                disabled={!canSuggest}
                className={cn(
                  'h-9 w-9 shrink-0 rounded-lg flex items-center justify-center',
                  'transition-all duration-150',
                  isLoadingSuggestion && 'animate-pulse',
                  canSuggest
                    ? 'text-[var(--ds-text-secondary)] hover:text-[var(--ds-text-primary)] hover:bg-[var(--ds-bg-hover)]'
                    : 'text-[var(--ds-text-muted)] cursor-not-allowed'
                )}
              >
                {isLoadingSuggestion ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Sparkles className="h-4 w-4" />
                )}
              </button>
            </TooltipTrigger>
            <TooltipContent side="top" className="text-xs">
              Sugestão IA
            </TooltipContent>
          </Tooltip>
        )}

        {/* Input area */}
        <div className="flex-1 relative">
          {/* Shortcut autocomplete dropdown */}
          {shortcutSuggestions.length > 0 && (
            <div
              ref={autocompleteRef}
              className="absolute bottom-full left-0 right-0 mb-1 bg-[var(--ds-bg-surface)] border border-[var(--ds-border-strong)] rounded-lg shadow-xl overflow-hidden z-50"
            >
              <div className="py-1">
                {shortcutSuggestions.map((qr, index) => (
                  <button
                    key={qr.id}
                    type="button"
                    onMouseDown={(e) => {
                      e.preventDefault() // Prevent blur
                      handleShortcutSelect(qr)
                    }}
                    onMouseEnter={() => setSelectedShortcutIndex(index)}
                    className={cn(
                      'w-full px-3 py-2 text-left transition-colors',
                      index === selectedShortcutIndex
                        ? 'bg-[var(--ds-bg-hover)]'
                        : 'hover:bg-[var(--ds-bg-hover)]/50'
                    )}
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-400 font-mono">
                        /{qr.shortcut}
                      </span>
                      <span className="text-sm font-medium text-[var(--ds-text-primary)] truncate">
                        {qr.title}
                      </span>
                    </div>
                    <p className="text-xs text-[var(--ds-text-muted)] mt-0.5 line-clamp-1 pl-0">
                      {qr.content}
                    </p>
                  </button>
                ))}
              </div>
              <div className="px-3 py-1.5 border-t border-[var(--ds-border-subtle)] bg-[var(--ds-bg-surface)]/50">
                <p className="text-[10px] text-[var(--ds-text-muted)]">
                  <span className="text-[var(--ds-text-muted)]">↑↓</span> navegar
                  <span className="mx-2 text-[var(--ds-text-muted)]/50">·</span>
                  <span className="text-[var(--ds-text-muted)]">↵</span> selecionar
                  <span className="mx-2 text-[var(--ds-text-muted)]/50">·</span>
                  <span className="text-[var(--ds-text-muted)]">esc</span> fechar
                </p>
              </div>
            </div>
          )}

          <Textarea
            ref={textareaRef}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={handleKeyDown}
            onFocus={() => setIsFocused(true)}
            onBlur={() => setIsFocused(false)}
            placeholder={placeholder}
            disabled={disabled || isSending || isLoadingSuggestion}
            rows={1}
            className={cn(
              'min-h-[36px] max-h-[100px] resize-none py-2 px-3',
              'bg-[var(--ds-bg-surface)]/50 border-[var(--ds-border-subtle)] rounded-lg',
              'text-sm text-[var(--ds-text-primary)] placeholder:text-[var(--ds-text-muted)]',
              'focus:border-[var(--ds-border-strong)] focus:ring-0 focus:bg-[var(--ds-bg-surface)]',
              'transition-all duration-100',
              disabled && 'opacity-40 cursor-not-allowed'
            )}
          />
        </div>

        {/* Send button - monochrome when disabled, subtle when active */}
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={handleSend}
              disabled={!canSend}
              className={cn(
                'h-9 w-9 shrink-0 rounded-lg flex items-center justify-center',
                'transition-all duration-150',
                canSend
                  ? 'bg-emerald-600 text-white hover:bg-emerald-500 active:scale-95'
                  : 'bg-[var(--ds-bg-surface)]/50 text-[var(--ds-text-muted)] cursor-not-allowed'
              )}
            >
              {isSending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Send className="h-4 w-4" />
              )}
            </button>
          </TooltipTrigger>
          <TooltipContent side="top" className="text-xs">
            {canSend ? 'Enviar · ⌘↵' : 'Digite uma mensagem'}
          </TooltipContent>
        </Tooltip>
      </div>
    </div>
  )
}
