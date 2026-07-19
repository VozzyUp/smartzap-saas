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
import { Send, Loader2, Sparkles, Paperclip, X, FileText, Music, Mic, Square, Trash2 } from 'lucide-react'
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

function formatDuration(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60).toString().padStart(2, '0')
  const s = (totalSeconds % 60).toString().padStart(2, '0')
  return `${m}:${s}`
}

type VoiceRecordingState = 'idle' | 'recording' | 'preview' | 'sending'

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

  // Voice recording (Fase 5B - Task 4)
  const [voiceState, setVoiceState] = useState<VoiceRecordingState>('idle')
  const [voiceSeconds, setVoiceSeconds] = useState(0)
  const [voiceBlob, setVoiceBlob] = useState<Blob | null>(null)
  const [voicePreviewUrl, setVoicePreviewUrl] = useState<string | null>(null)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const mediaStreamRef = useRef<MediaStream | null>(null)
  const voiceChunksRef = useRef<Blob[]>([])
  const voiceTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const voiceCancelledRef = useRef(false)
  // Guard síncrono contra duplo-clique: voiceState só vira 'recording' após o
  // await getUserMedia, então dois cliques rápidos abririam dois streams e o
  // primeiro ficaria órfão (mic preso). Este ref fecha essa janela.
  const isStartingVoiceRef = useRef(false)

  const stopMediaStream = useCallback(() => {
    mediaStreamRef.current?.getTracks().forEach((track) => track.stop())
    mediaStreamRef.current = null
  }, [])

  const clearVoiceTimer = useCallback(() => {
    if (voiceTimerRef.current) {
      clearInterval(voiceTimerRef.current)
      voiceTimerRef.current = null
    }
  }, [])

  // Revoke the voice preview object URL when it changes or the component unmounts
  useEffect(() => {
    return () => {
      if (voicePreviewUrl) {
        URL.revokeObjectURL(voicePreviewUrl)
      }
    }
  }, [voicePreviewUrl])

  // Rigorous cleanup: stop mic tracks and clear timer on unmount regardless of state
  useEffect(() => {
    return () => {
      clearVoiceTimer()
      stopMediaStream()
    }
  }, [clearVoiceTimer, stopMediaStream])

  const startVoiceRecording = useCallback(async () => {
    if (disabled || !conversationId || voiceState !== 'idle') return
    if (isStartingVoiceRef.current) return
    isStartingVoiceRef.current = true

    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    } catch (error) {
      isStartingVoiceRef.current = false
      console.error('[MessageInput] Erro ao acessar microfone:', error)
      // Mensagem acionável por tipo de erro do getUserMedia — "não foi possível"
      // genérico não diz ao usuário O QUE fazer.
      const name = (error as DOMException)?.name
      const description =
        name === 'NotAllowedError' || name === 'PermissionDeniedError'
          ? 'Permissão negada. Clique no cadeado na barra de endereço → Microfone → Permitir, e recarregue a página.'
          : name === 'NotFoundError' || name === 'DevicesNotFoundError'
            ? 'Nenhum microfone encontrado. Conecte um microfone e verifique a entrada de som do sistema.'
            : name === 'NotReadableError'
              ? 'O microfone está em uso por outro aplicativo. Feche-o e tente novamente.'
              : name || undefined
      toast.error('Não foi possível acessar o microfone', { description })
      return
    }

    // Defesa extra: nunca deixe um stream anterior órfão ao assumir o novo.
    stopMediaStream()

    const mimeType = MediaRecorder.isTypeSupported('audio/ogg;codecs=opus')
      ? 'audio/ogg;codecs=opus'
      : MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : undefined

    const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream)
    voiceChunksRef.current = []
    voiceCancelledRef.current = false

    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) voiceChunksRef.current.push(e.data)
    }

    recorder.onstop = () => {
      stopMediaStream()
      clearVoiceTimer()
      const cancelled = voiceCancelledRef.current
      const chunks = voiceChunksRef.current
      voiceChunksRef.current = []
      setVoiceSeconds(0)

      if (cancelled || chunks.length === 0) {
        setVoiceState('idle')
        return
      }

      const blob = new Blob(chunks, { type: recorder.mimeType || mimeType || 'audio/webm' })
      setVoiceBlob(blob)
      setVoicePreviewUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev)
        return URL.createObjectURL(blob)
      })
      setVoiceState('preview')
    }

    mediaRecorderRef.current = recorder
    mediaStreamRef.current = stream
    setVoiceSeconds(0)
    setVoiceState('recording')
    recorder.start()
    isStartingVoiceRef.current = false

    voiceTimerRef.current = setInterval(() => {
      setVoiceSeconds((s) => s + 1)
    }, 1000)
  }, [disabled, conversationId, voiceState, stopMediaStream, clearVoiceTimer])

  const stopVoiceRecording = useCallback(() => {
    voiceCancelledRef.current = false
    const recorder = mediaRecorderRef.current
    if (recorder && recorder.state !== 'inactive') recorder.stop()
  }, [])

  const cancelVoiceRecording = useCallback(() => {
    voiceCancelledRef.current = true
    const recorder = mediaRecorderRef.current
    if (recorder && recorder.state !== 'inactive') {
      recorder.stop()
    } else {
      // Recorder já inativo (ex.: clique duplo): garante limpeza e volta ao idle.
      stopMediaStream()
      clearVoiceTimer()
      setVoiceSeconds(0)
      setVoiceState('idle')
    }
  }, [stopMediaStream, clearVoiceTimer])

  const discardVoicePreview = useCallback(() => {
    setVoicePreviewUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev)
      return null
    })
    setVoiceBlob(null)
    setVoiceState('idle')
  }, [])

  const handleSendVoice = useCallback(async () => {
    if (!voiceBlob || !conversationId || voiceState !== 'preview') return

    setVoiceState('sending')
    try {
      const isOgg = voiceBlob.type.includes('ogg')
      const filename = isOgg ? 'voice.ogg' : 'voice.webm'
      const formData = new FormData()
      formData.append('file', voiceBlob, filename)
      formData.append('voice', 'true')

      const response = await fetch(`/api/inbox/conversations/${conversationId}/media`, {
        method: 'POST',
        body: formData,
      })

      if (!response.ok) {
        const data = await response.json().catch(() => null)
        throw new Error(data?.error || 'Erro ao enviar nota de voz')
      }

      toast.success('Nota de voz enviada')
      setVoicePreviewUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev)
        return null
      })
      setVoiceBlob(null)
      setVoiceState('idle')
    } catch (error) {
      console.error('[MessageInput] Erro ao enviar nota de voz:', error)
      toast.error(error instanceof Error ? error.message : 'Erro ao enviar nota de voz')
      setVoiceState('preview')
    }
  }, [voiceBlob, conversationId, voiceState])

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

      {/* Voice recording / preview - Fase 5B (Task 4) */}
      {voiceState !== 'idle' && (
        <div className="px-3 pt-3 border-b border-[var(--ds-border-subtle)] pb-3">
          <div className="flex items-center gap-3 bg-[var(--ds-bg-surface)]/50 rounded-lg p-2.5">
            {voiceState === 'recording' ? (
              <>
                <div className="flex items-center gap-2 flex-1 min-w-0">
                  <span className="h-2 w-2 rounded-full bg-red-500 animate-pulse shrink-0" />
                  <span className="text-sm font-mono text-[var(--ds-text-primary)]">
                    {formatDuration(voiceSeconds)}
                  </span>
                  <span className="text-xs text-[var(--ds-text-muted)]">Gravando...</span>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <button
                    type="button"
                    onClick={cancelVoiceRecording}
                    className={cn(
                      'h-8 w-8 rounded-md flex items-center justify-center',
                      'text-[var(--ds-text-muted)] hover:text-[var(--ds-text-primary)] hover:bg-[var(--ds-bg-hover)]',
                      'transition-colors'
                    )}
                    title="Cancelar"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    onClick={stopVoiceRecording}
                    className={cn(
                      'h-8 w-8 rounded-md flex items-center justify-center',
                      'bg-emerald-600 text-white hover:bg-emerald-500 active:scale-95',
                      'transition-all'
                    )}
                    title="Parar"
                  >
                    <Square className="h-3.5 w-3.5" fill="currentColor" />
                  </button>
                </div>
              </>
            ) : (
              <>
                {voicePreviewUrl && (
                  // eslint-disable-next-line jsx-a11y/media-has-caption
                  <audio controls src={voicePreviewUrl} className="flex-1 min-w-0 h-9" />
                )}
                <div className="flex items-center gap-1.5 shrink-0">
                  <button
                    type="button"
                    onClick={discardVoicePreview}
                    disabled={voiceState === 'sending'}
                    className={cn(
                      'h-8 w-8 rounded-md flex items-center justify-center',
                      'text-[var(--ds-text-muted)] hover:text-[var(--ds-text-primary)] hover:bg-[var(--ds-bg-hover)]',
                      'transition-colors',
                      voiceState === 'sending' && 'opacity-40 cursor-not-allowed'
                    )}
                    title="Cancelar"
                  >
                    <X className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    onClick={handleSendVoice}
                    disabled={voiceState === 'sending'}
                    className={cn(
                      'h-8 w-8 rounded-md flex items-center justify-center',
                      'bg-emerald-600 text-white hover:bg-emerald-500 active:scale-95',
                      'transition-all',
                      voiceState === 'sending' && 'opacity-50 cursor-not-allowed'
                    )}
                    title="Enviar"
                  >
                    {voiceState === 'sending' ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Send className="h-4 w-4" />
                    )}
                  </button>
                </div>
              </>
            )}
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
              disabled={disabled || !conversationId || voiceState !== 'idle'}
              className={cn(
                'h-9 w-9 shrink-0 rounded-lg flex items-center justify-center',
                'transition-all duration-150',
                disabled || !conversationId || voiceState !== 'idle'
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

        {/* Voice recording button - Fase 5B (Task 4) */}
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={startVoiceRecording}
              disabled={disabled || !conversationId || !!attachedFile || voiceState !== 'idle'}
              className={cn(
                'h-9 w-9 shrink-0 rounded-lg flex items-center justify-center',
                'transition-all duration-150',
                disabled || !conversationId || !!attachedFile || voiceState !== 'idle'
                  ? 'text-[var(--ds-text-muted)] cursor-not-allowed'
                  : 'text-[var(--ds-text-secondary)] hover:text-[var(--ds-text-primary)] hover:bg-[var(--ds-bg-hover)]'
              )}
            >
              <Mic className="h-4 w-4" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="top" className="text-xs">
            Gravar áudio
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
