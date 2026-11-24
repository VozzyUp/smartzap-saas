'use client';

import React, { useState, useEffect } from 'react';
import { BarChart3, X, Check, ExternalLink } from 'lucide-react';
import { toast } from 'sonner';
import { SectionHeader } from '@/components/ui/section-header';
import { Container } from '@/components/ui/container';

export interface UpstashConfigPanelProps {
  upstashConfig?: { email: string; hasApiKey: boolean; configured: boolean } | null;
  upstashConfigLoading?: boolean;
  saveUpstashConfig?: (config: { email: string; apiKey: string }) => Promise<void>;
  removeUpstashConfig?: () => Promise<void>;
  isSaving?: boolean;
}

export function UpstashConfigPanel({
  upstashConfig,
  upstashConfigLoading,
  saveUpstashConfig,
  removeUpstashConfig,
  isSaving,
}: UpstashConfigPanelProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [email, setEmail] = useState('');
  const [apiKey, setApiKey] = useState('');

  useEffect(() => {
    if (upstashConfig?.email) {
      setEmail(upstashConfig.email);
    }
  }, [upstashConfig?.email]);

  const handleSave = async () => {
    if (!email.trim() || !apiKey.trim()) {
      toast.error('Preencha email e API Key');
      return;
    }

    if (!saveUpstashConfig) {
      toast.error('Função de salvar não disponível');
      return;
    }

    try {
      await saveUpstashConfig({
        email: email.trim(),
        apiKey: apiKey.trim(),
      });
      setIsEditing(false);
      setApiKey(''); // Limpa API Key do state após salvar
    } catch {
      // Error handled by mutation
    }
  };

  const handleRemove = async () => {
    if (!removeUpstashConfig) return;

    try {
      await removeUpstashConfig();
      setEmail('');
      setApiKey('');
    } catch {
      // Error handled by mutation
    }
  };

  const handleEdit = () => {
    setEmail(upstashConfig?.email || '');
    setApiKey('');
    setIsEditing(true);
  };

  const handleCancel = () => {
    setIsEditing(false);
    setEmail(upstashConfig?.email || '');
    setApiKey('');
  };

  if (upstashConfigLoading) {
    return (
      <Container variant="glass" padding="lg">
        <div className="animate-pulse space-y-4">
          <div className="h-6 w-48 bg-[var(--ds-bg-elevated)] rounded" />
          <div className="h-20 bg-[var(--ds-bg-elevated)] rounded-xl" />
        </div>
      </Container>
    );
  }

  return (
    <Container variant="glass" padding="lg">
      <SectionHeader
        title="Métricas do QStash"
        description="Configure credenciais do Upstash para ver métricas de uso do QStash no painel de infraestrutura."
        color="warning"
        icon={BarChart3}
        className="mb-6"
      />

      {upstashConfig?.configured && !isEditing ? (
        // Show saved config
        <div className="bg-[var(--ds-status-success-bg)] border border-[var(--ds-status-success)]/20 rounded-xl p-4 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="p-3 bg-[var(--ds-status-success)]/20 rounded-xl">
              <Check size={24} className="text-[var(--ds-status-success-text)]" />
            </div>
            <div>
              <p className="font-medium text-[var(--ds-text-primary)]">Credenciais configuradas</p>
              <p className="text-sm text-[var(--ds-text-secondary)] font-mono">
                {upstashConfig.email}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleEdit}
              className="h-10 px-4 text-sm text-[var(--ds-text-secondary)] hover:text-[var(--ds-text-primary)] hover:bg-[var(--ds-bg-hover)] rounded-lg transition-colors"
            >
              Editar
            </button>
            <button
              onClick={handleRemove}
              className="h-10 w-10 flex items-center justify-center text-[var(--ds-text-secondary)] hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-colors"
            >
              <X size={16} />
            </button>
          </div>
        </div>
      ) : (
        // Form to add/edit config
        <div className="space-y-4">
          <div className="bg-[var(--ds-bg-subtle)] border border-[var(--ds-border-default)] rounded-xl p-4">
            <p className="text-sm text-[var(--ds-text-secondary)] mb-3">
              Para obter as credenciais:
            </p>
            <ol className="text-sm text-[var(--ds-text-secondary)] space-y-1 list-decimal list-inside">
              <li>Acesse o <a href="https://console.upstash.com" target="_blank" rel="noopener noreferrer" className="text-primary-400 hover:underline inline-flex items-center gap-1">Console Upstash <ExternalLink size={12} /></a></li>
              <li>Clique no seu perfil → <strong className="text-[var(--ds-text-primary)]">Account</strong></li>
              <li>Na aba <strong className="text-[var(--ds-text-primary)]">API Keys</strong>, copie o email e a API Key</li>
            </ol>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-[var(--ds-text-primary)] mb-2">
                Email da conta
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="seu@email.com"
                className="w-full px-4 py-3 bg-[var(--ds-bg-elevated)] border border-[var(--ds-border-default)] rounded-xl focus:ring-2 focus:ring-primary-500/50 focus:border-primary-500/50 outline-none text-base sm:text-sm text-[var(--ds-text-primary)] transition-all max-sm:min-h-11"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-[var(--ds-text-primary)] mb-2">
                API Key
              </label>
              <input
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="••••••••••••••••"
                className="w-full px-4 py-3 bg-[var(--ds-bg-elevated)] border border-[var(--ds-border-default)] rounded-xl focus:ring-2 focus:ring-primary-500/50 focus:border-primary-500/50 outline-none text-base sm:text-sm text-[var(--ds-text-primary)] font-mono transition-all max-sm:min-h-11"
              />
            </div>
          </div>
          <div className="flex justify-end gap-3">
            {isEditing && (
              <button
                onClick={handleCancel}
                className="h-10 px-4 text-sm text-[var(--ds-text-secondary)] hover:text-[var(--ds-text-primary)] transition-colors"
              >
                Cancelar
              </button>
            )}
            <button
              onClick={handleSave}
              disabled={isSaving || !email.trim() || !apiKey.trim()}
              className="h-10 px-4 bg-primary-600 hover:bg-primary-500 text-white font-medium rounded-lg transition-colors flex items-center gap-2 disabled:opacity-50"
            >
              <BarChart3 size={16} />
              {isSaving ? 'Validando...' : 'Salvar Credenciais'}
            </button>
          </div>
        </div>
      )}
    </Container>
  );
}
