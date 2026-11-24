'use client';

import React from 'react';
import { Users, UserCheck, UserX } from 'lucide-react';
import { StatCard } from '@/components/ui/stat-card';
import type { ContactStatsData } from './types';

export interface ContactStatsProps {
  stats: ContactStatsData;
}

export const ContactStats: React.FC<ContactStatsProps> = ({ stats }) => {
  return (
    <div className="grid grid-cols-3 gap-2 sm:gap-6">
      <StatCard
        title="Total de Contatos"
        value={(stats?.total ?? 0).toLocaleString()}
        icon={Users}
        color="blue"
        layout="horizontal"
      />
      <StatCard
        title="Opt-in Ativos"
        value={(stats?.optIn ?? 0).toLocaleString()}
        icon={UserCheck}
        color="emerald"
        layout="horizontal"
      />
      <StatCard
        title="Inativos / Opt-out"
        value={(stats?.optOut ?? 0).toLocaleString()}
        icon={UserX}
        color="zinc"
        layout="horizontal"
      />
    </div>
  );
};
