'use client';

import React, { useEffect, useState } from 'react';
import { CalendarClock, Loader2, Save } from 'lucide-react';
import { toast } from 'sonner';
import { Container } from '@/components/ui/container';
import { SectionHeader } from '@/components/ui/section-header';

/**
 * Limite diário de envios de campanha (setting `campaign_daily_limit`).
 * Vazio/0 = sem limite. Acima do limite, o restante é reprogramado para o dia seguinte às 9h.
 */
export function CampaignDailyLimitCard() {
  const [saved, setSaved] = useState<number | null>(null);
  const [value, setValue] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/settings/campaign-daily-limit');
        const data = await res.json();
        if (cancelled) return;
        const limit = Number(data?.limit) || 0;
        setSaved(limit);
        setValue(limit > 0 ? String(limit) : '');
      } catch {
        if (!cancelled) setSaved(0);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const parsed = value.trim() === '' ? 0 : Number(value);
  const invalid = !Number.isFinite(parsed) || parsed < 0;
  const dirty = !invalid && saved !== null && Math.floor(parsed) !== saved;

  const handleSave = async () => {
    if (invalid) {
      toast.error('Informe um número inteiro, ou deixe vazio para não limitar.');
      return;
    }
    setSaving(true);
    try {
      const res = await fetch('/api/settings/campaign-daily-limit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ limit: Math.floor(parsed) }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || 'Falha ao salvar');
      setSaved(data.limit);
      setValue(data.limit > 0 ? String(data.limit) : '');
      toast.success(data.limit > 0 ? `Limite diário salvo: ${data.limit} envios por dia` : 'Limite diário desativado');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao salvar');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Container variant="glass" padding="lg">
      <SectionHeader
        title="Limite de envios por dia"
        icon={CalendarClock}
        color="brand"
        showIndicator={true}
        description="Protege a qualidade do número ao falar com contatos frios: a campanha envia só até o limite do dia e continua sozinha no dia seguinte, às 9h."
      />

      <div className="mt-6 flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="campaign-daily-limit" className="text-xs text-[var(--ds-text-muted)] uppercase tracking-wide">
            Limite de envios por dia
          </label>
          <input
            id="campaign-daily-limit"
            type="number"
            min={0}
            step={1}
            inputMode="numeric"
            placeholder="Sem limite"
            disabled={loading}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            className="h-10 w-40 px-3 rounded-lg bg-[var(--ds-bg-surface)] border border-[var(--ds-border-default)] text-base sm:text-sm text-[var(--ds-text-primary)] focus:outline-none focus:border-[var(--ds-border-focus,var(--ds-border-default))] max-sm:min-h-11"
          />
        </div>
        <button
          onClick={handleSave}
          disabled={saving || loading || !dirty}
          className="inline-flex items-center justify-center gap-2 h-10 px-4 rounded-lg bg-[var(--ds-bg-surface)] text-[var(--ds-text-primary)] hover:bg-[var(--ds-bg-hover)] border border-[var(--ds-border-default)] transition-colors text-sm font-medium disabled:opacity-50"
        >
          {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
          Salvar
        </button>
      </div>

      <p className="mt-3 text-xs text-[var(--ds-text-muted)]">
        Deixe vazio para não limitar. O dia conta a partir da meia-noite (horário de Brasília) e vale para todas as campanhas da conta.
      </p>
    </Container>
  );
}
