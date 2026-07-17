'use client';

import React from 'react';
import { PrefetchLink } from '@/components/ui/PrefetchLink';
import { Page, PageActions, PageDescription, PageHeader, PageTitle } from '@/components/ui/page';
import { formatDateFull } from '@/lib/date-formatter';
import { Container } from '@/components/ui/container';
import { StatCard } from '@/components/ui/stat-card';
import { StatusBadge } from '@/components/ui/status-badge';
import { PlanUsageCard } from '@/components/features/dashboard/PlanUsageCard';
import { Send, TrendingUp, AlertCircle, CheckCircle2, MoreHorizontal, ArrowUpRight } from 'lucide-react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from '@/components/ui/lazy-charts';
import { Campaign, CampaignStatus } from '../../../types';
import { DashboardStats } from '../../../services/dashboardService';

interface DashboardViewProps {
  stats: DashboardStats;
  recentCampaigns: Campaign[];
  isLoading: boolean;
}

/**
 * Mapeia CampaignStatus enum para status do StatusBadge
 */
const getCampaignBadgeStatus = (status: CampaignStatus) => {
  const map: Record<CampaignStatus, 'completed' | 'sending' | 'failed' | 'draft' | 'paused' | 'scheduled' | 'default'> = {
    [CampaignStatus.COMPLETED]: 'completed',
    [CampaignStatus.SENDING]: 'sending',
    [CampaignStatus.FAILED]: 'failed',
    [CampaignStatus.DRAFT]: 'draft',
    [CampaignStatus.PAUSED]: 'paused',
    [CampaignStatus.SCHEDULED]: 'scheduled',
    [CampaignStatus.CANCELLED]: 'default',
  };
  return map[status] || 'default';
};

const getCampaignLabel = (status: CampaignStatus) => {
  const labels: Record<CampaignStatus, string> = {
    [CampaignStatus.COMPLETED]: 'Concluído',
    [CampaignStatus.SENDING]: 'Enviando',
    [CampaignStatus.FAILED]: 'Falhou',
    [CampaignStatus.DRAFT]: 'Rascunho',
    [CampaignStatus.PAUSED]: 'Pausado',
    [CampaignStatus.SCHEDULED]: 'Agendado',
    [CampaignStatus.CANCELLED]: 'Cancelada',
  };
  return labels[status];
};

export const DashboardView: React.FC<DashboardViewProps> = ({ stats, recentCampaigns, isLoading }) => {
  const [range, setRange] = React.useState<'7D' | '15D' | '30D'>('7D');
  const [isMounted, setIsMounted] = React.useState(false);
  const containerRef = React.useRef<HTMLDivElement>(null);
  const rangeSize = range === '7D' ? 7 : range === '15D' ? 15 : 30;
  const chartData = stats.chartData || [];

  React.useEffect(() => {
    // Aguarda o browser calcular as dimensões do container antes de renderizar o chart
    // Isso evita o warning "width(-1) height(-1)" do Recharts
    // Usa setTimeout para garantir que o layout foi calculado após o primeiro paint
    const timer = setTimeout(() => {
      const container = containerRef.current;
      if (container && container.clientWidth > 0 && container.clientHeight > 0) {
        setIsMounted(true);
      } else {
        // Fallback: renderiza mesmo assim após 500ms
        setTimeout(() => setIsMounted(true), 500);
      }
    }, 100);
    return () => clearTimeout(timer);
  }, []);

  return (
    <Page>
      <PageHeader>
        <div>
          <PageTitle>Dashboard</PageTitle>
          <PageDescription>Visão geral da performance de mensagens</PageDescription>
        </div>
        <PageActions>
          <PrefetchLink
            href="/campaigns/new"
            className="bg-primary-600 text-white hover:bg-primary-500 dark:bg-white dark:text-black dark:hover:bg-white/90 px-4 py-2 rounded-lg font-semibold text-sm transition-colors shadow-lg shadow-primary-500/20 dark:shadow-white/15 ring-1 ring-primary-500/30 dark:ring-white/30 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary-500 dark:focus-visible:outline-white focus-visible:outline-offset-2"
            aria-label="Criar nova campanha rápida"
          >
            Campanha Rápida
          </PrefetchLink>
        </PageActions>
      </PageHeader>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-6">
        <StatCard
          title="Total Enviado"
          value={stats.sent24h}
          icon={Send}
          color="blue"
          loading={isLoading}
        />
        <StatCard
          title="Taxa de Entrega"
          value={stats.deliveryRate}
          icon={CheckCircle2}
          color="emerald"
          loading={isLoading}
        />
        <StatCard
          title="Campanhas Ativas"
          value={stats.activeCampaigns}
          icon={TrendingUp}
          color="purple"
          loading={isLoading}
        />
        <StatCard
          title="Falhas no Envio"
          value={stats.failedMessages}
          icon={AlertCircle}
          color="red"
          loading={isLoading}
        />
        <PlanUsageCard />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Chart Section */}
        <Container variant="glass" padding="lg" className="lg:col-span-2">
          <div className="flex items-center justify-between mb-8">
            <h3 className="text-heading-4" id="chart-title">Volume de Mensagens</h3>
            <div className="flex gap-2" role="group" aria-label="Período do gráfico">
              {[
                { key: '7D', label: 'Últimos 7 dias' },
                { key: '15D', label: 'Últimos 15 dias' },
                { key: '30D', label: 'Últimos 30 dias' }
              ].map((t) => (
                <button 
                  key={t.key} 
                  aria-label={t.label}
                  aria-pressed={t.key === range}
                  onClick={() => setRange(t.key as '7D' | '15D' | '30D')}
                  className={`text-xs px-3 py-1 rounded-lg transition-colors ${t.key === range ? 'bg-[var(--ds-bg-hover)] text-[var(--ds-text-primary)]' : 'text-[var(--ds-text-muted)] hover:text-[var(--ds-text-secondary)]'}`}
                >
                  {t.key}
                </button>
              ))}
            </div>
          </div>
          <figure 
            role="figure" 
            aria-labelledby="chart-title"
            aria-describedby="chart-description"
          >
            <div ref={containerRef} className="h-72 w-full">
              {isMounted && chartData.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={0}>
                  <AreaChart data={chartData.slice(-rangeSize)} aria-hidden="true">
                  <defs>
                    <linearGradient id="colorSent" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#10b981" stopOpacity={0.22}/>
                      <stop offset="95%" stopColor="#10b981" stopOpacity={0}/>
                    </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(255,255,255,0.06)" />
                <XAxis 
                  dataKey="name" 
                  axisLine={false} 
                  tickLine={false} 
                  tick={{fill: '#71717a', fontSize: 12}} 
                  dy={15}
                />
                <YAxis 
                  axisLine={false} 
                  tickLine={false} 
                  tick={{fill: '#71717a', fontSize: 12}} 
                />
                <Tooltip
                  contentStyle={{backgroundColor: '#101113', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.08)', color: '#fff'}}
                  itemStyle={{color: '#10b981'}}
                  labelStyle={{color: '#a1a1aa'}}
                  formatter={(value) => [value, 'Enviadas']}
                />
                <Area 
                  type="monotone" 
                  dataKey="sent" 
                  stroke="#10b981" 
                  strokeWidth={2}
                  fillOpacity={1} 
                  fill="url(#colorSent)" 
                />
              </AreaChart>
            </ResponsiveContainer>
              ) : (
                <div className="h-full w-full rounded-xl bg-[var(--ds-bg-hover)]" aria-hidden="true" />
              )}
          </div>
          <p id="chart-description" className="sr-only">
            Gráfico de área mostrando o volume de mensagens enviadas ao longo do tempo. 
            Os dados são atualizados automaticamente.
          </p>
        </figure>
        </Container>

        {/* Recent Activity */}
        <Container variant="glass" padding="none" className="flex flex-col overflow-hidden">
          <div className="p-6 border-b border-[var(--ds-border-default)] flex justify-between items-center">
            <h3 className="text-heading-4">Campanhas Recentes</h3>
            <button 
              aria-label="Mais opções"
              className="text-[var(--ds-text-muted)] hover:text-[var(--ds-text-primary)] transition-colors"
            >
              <MoreHorizontal size={20} aria-hidden="true" />
            </button>
          </div>
          <div className="flex-1 overflow-auto bg-[var(--ds-bg-elevated)]">
            {recentCampaigns.length === 0 ? (
              <div className="p-8 text-center text-[var(--ds-text-muted)]">
                Nenhuma campanha ainda.
              </div>
            ) : (
              <table className="w-full text-left text-sm">
                <thead className="sr-only">
                  <tr>
                    <th scope="col">Campanha</th>
                    <th scope="col">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--ds-border-subtle)]">
                  {recentCampaigns.map((campaign) => (
                    <tr key={campaign.id} className="hover:bg-[var(--ds-bg-hover)] transition-all duration-200 group cursor-pointer hover:shadow-[inset_0_0_20px_rgba(16,185,129,0.05)]">
                      <td className="px-6 py-5">
                        <p className="font-medium text-[var(--ds-text-primary)] group-hover:text-primary-600 dark:group-hover:text-primary-400 transition-colors duration-200">{campaign.name}</p>
                        <p className="text-[var(--ds-text-muted)] text-xs mt-1 font-mono">{formatDateFull(campaign.createdAt)}</p>
                      </td>
                      <td className="px-6 py-5 text-right">
                        <StatusBadge status={getCampaignBadgeStatus(campaign.status)} size="sm">
                          {getCampaignLabel(campaign.status)}
                        </StatusBadge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
          <div className="p-4 border-t border-[var(--ds-border-default)] text-center">
            <PrefetchLink href="/campaigns" className="text-label-sm hover:text-[var(--ds-text-primary)] transition-colors flex items-center justify-center gap-2">
              Ver Todas <ArrowUpRight size={14} />
            </PrefetchLink>
          </div>
        </Container>
      </div>
    </Page>
  );
};
