'use client'

/**
 * Login Page
 *
 * Login via magic link (email) — Supabase Auth.
 */

import { useState, Suspense } from 'react'
import { Mail, Send, CheckCircle2 } from 'lucide-react'

function LoginForm() {
  const [email, setEmail] = useState('')
  const [error, setError] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [sent, setSent] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')

    if (!email) {
      setError('Digite seu email')
      return
    }

    setIsLoading(true)

    try {
      const response = await fetch('/api/auth/magic-link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email })
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Erro ao enviar link de acesso')
      }

      setSent(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao enviar link de acesso')
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
        <h1 className="text-2xl font-bold text-[var(--ds-text-primary)]">SmartZap</h1>
        <p className="text-[var(--ds-text-secondary)] mt-1">Entre para continuar</p>
      </div>

      {/* Card */}
      <div className="bg-[var(--ds-bg-elevated)] border border-[var(--ds-border-default)] rounded-2xl p-6 shadow-xl">
        {sent ? (
          <div className="text-center py-4">
            <CheckCircle2 className="w-10 h-10 text-emerald-500 mx-auto mb-3" />
            <p className="text-[var(--ds-text-primary)] font-medium">Cheque seu email</p>
            <p className="text-sm text-[var(--ds-text-secondary)] mt-1">
              Enviamos um link de acesso para <strong>{email}</strong>. Clique no link para entrar.
            </p>
          </div>
        ) : (
          <form onSubmit={handleSubmit}>
            <div className="relative">
              <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-[var(--ds-text-muted)]" />
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="Seu email"
                name="email"
                autoComplete="email"
                className="w-full bg-[var(--ds-bg-surface)] border border-[var(--ds-border-default)] rounded-xl pl-11 pr-4 py-3 text-[var(--ds-text-primary)] placeholder:text-[var(--ds-text-muted)] focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent"
                autoFocus
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
                  Enviar link de acesso
                  <Send className="w-4 h-4" />
                </>
              )}
            </button>
          </form>
        )}
      </div>

      {/* Footer */}
      <p className="text-center text-[var(--ds-text-muted)] text-sm mt-6">
        SmartZap © {new Date().getFullYear()} |{' '}
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

export default function LoginPage() {
  return (
    <div className="min-h-screen bg-[var(--ds-bg-base)] flex items-center justify-center p-4">
      <Suspense fallback={
        <div className="w-5 h-5 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
      }>
        <LoginForm />
      </Suspense>
    </div>
  )
}
