'use client'

/**
 * Reset Password Page
 *
 * Define nova senha a partir de uma sessão de recovery — Supabase Auth.
 */

import { useState } from 'react'
import { Lock, Send, CheckCircle2 } from 'lucide-react'

function ResetPasswordForm() {
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [done, setDone] = useState(false)
  const [expired, setExpired] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')

    if (!password || !confirmPassword) {
      setError('Preencha todos os campos')
      return
    }
    if (password.length < 8) {
      setError('A senha deve ter no mínimo 8 caracteres')
      return
    }
    if (password !== confirmPassword) {
      setError('As senhas não coincidem')
      return
    }

    setIsLoading(true)

    try {
      const response = await fetch('/api/auth/update-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      })

      if (response.status === 401) {
        setExpired(true)
        return
      }

      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Erro ao atualizar senha')
      setDone(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao atualizar senha')
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="w-full max-w-md">
      {/* Logo */}
      <div className="text-center mb-8">
        <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-linear-to-br from-emerald-500 to-emerald-600 mb-4">
          <span className="text-3xl font-bold text-white">S</span>
        </div>
        <h1 className="text-2xl font-bold text-[var(--ds-text-primary)]">V-Smart</h1>
        <p className="text-[var(--ds-text-secondary)] mt-1">Definir nova senha</p>
      </div>

      {/* Card */}
      <div className="bg-[var(--ds-bg-elevated)] border border-[var(--ds-border-default)] rounded-2xl p-6 shadow-xl">
        {expired ? (
          <div className="text-center py-4">
            <p className="text-[var(--ds-text-primary)] font-medium">Link expirado</p>
            <p className="text-sm text-[var(--ds-text-secondary)] mt-1">
              Solicite novamente.
            </p>
            <a
              href="/forgot-password"
              className="inline-block mt-4 text-sm text-[var(--ds-text-secondary)] hover:text-emerald-500 transition-colors"
            >
              Voltar para recuperar senha
            </a>
          </div>
        ) : done ? (
          <div className="text-center py-4">
            <CheckCircle2 className="w-10 h-10 text-emerald-500 mx-auto mb-3" />
            <p className="text-[var(--ds-text-primary)] font-medium">Senha atualizada</p>
            <button
              type="button"
              onClick={() => { window.location.href = '/' }}
              className="w-full mt-6 bg-emerald-600 hover:bg-emerald-500 text-white font-medium py-3 rounded-xl transition-colors"
            >
              Ir para o app
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit}>
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-[var(--ds-text-muted)]" />
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Nova senha"
                name="password"
                autoComplete="new-password"
                className="w-full bg-[var(--ds-bg-surface)] border border-[var(--ds-border-default)] rounded-xl pl-11 pr-4 py-3 text-[var(--ds-text-primary)] placeholder:text-[var(--ds-text-muted)] focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent"
                autoFocus
              />
            </div>

            <div className="relative mt-4">
              <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-[var(--ds-text-muted)]" />
              <input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Confirme a nova senha"
                name="confirmPassword"
                autoComplete="new-password"
                className="w-full bg-[var(--ds-bg-surface)] border border-[var(--ds-border-default)] rounded-xl pl-11 pr-4 py-3 text-[var(--ds-text-primary)] placeholder:text-[var(--ds-text-muted)] focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent"
              />
            </div>

            {error && (
              <p className="mt-4 text-[var(--ds-status-error-text)] text-sm">{error}</p>
            )}

            <button
              type="submit"
              disabled={isLoading}
              className="w-full mt-6 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium py-3 rounded-xl transition-colors flex items-center justify-center gap-2"
            >
              {isLoading ? (
                <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              ) : (
                <>
                  Atualizar senha
                  <Send className="w-4 h-4" />
                </>
              )}
            </button>
          </form>
        )}
      </div>

      {/* Footer */}
      <p className="text-center text-[var(--ds-text-muted)] text-sm mt-6">
        V-Smart © {new Date().getFullYear()} |{' '}
        <a
          href="https://www.escoladeautomacao.com.br/"
          target="_blank"
          rel="noopener noreferrer"
          className="hover:text-emerald-500 transition-colors"
        >
          Escola de Automação
        </a>
        {' '}| by{' '}
        <a
          href="https://instagram.com/thaleslaray"
          target="_blank"
          rel="noopener noreferrer"
          className="hover:text-emerald-500 transition-colors"
        >
          @thaleslaray
        </a>
      </p>
    </div>
  )
}

export default function ResetPasswordPage() {
  return (
    <div className="min-h-screen bg-[var(--ds-bg-base)] flex items-center justify-center p-4">
      <ResetPasswordForm />
    </div>
  )
}
