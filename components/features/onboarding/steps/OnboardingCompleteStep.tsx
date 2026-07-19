'use client';

import React from 'react';
import {
  CheckCircle2,
  Rocket,
  MessageSquare,
  Users,
  BarChart3,
} from 'lucide-react';
import { Button } from '@/components/ui/button';

interface OnboardingCompleteStepProps {
  onComplete: () => void;
}

export function OnboardingCompleteStep({
  onComplete,
}: OnboardingCompleteStepProps) {
  const handleComplete = () => {
    onComplete();
  };

  return (
    <div className="space-y-6 py-4">
      {/* Ícone de sucesso */}
      <div className="flex justify-center">
        <div className="relative">
          <div className="w-24 h-24 rounded-full bg-gradient-to-br from-emerald-500 to-teal-500 flex items-center justify-center animate-pulse">
            <CheckCircle2 className="w-12 h-12 text-white" />
          </div>
          <div className="absolute -top-1 -right-1 w-8 h-8 rounded-full bg-amber-500 flex items-center justify-center">
            <span className="text-lg">🎉</span>
          </div>
        </div>
      </div>

      {/* Título */}
      <div className="text-center space-y-2">
        <h2 className="text-2xl font-bold text-white">Tudo pronto!</h2>
        <p className="text-zinc-400">
          Seu V-Smart está configurado e pronto para usar
        </p>
      </div>

      {/* O que você pode fazer agora */}
      <div className="space-y-3">
        <h4 className="text-sm font-medium text-zinc-300 text-center">
          O que você pode fazer agora:
        </h4>

        <div className="grid gap-3">
          <div className="flex items-center gap-3 p-3 rounded-lg bg-zinc-800/50 border border-zinc-700">
            <div className="w-10 h-10 rounded-lg bg-emerald-500/20 flex items-center justify-center flex-shrink-0">
              <MessageSquare className="w-5 h-5 text-emerald-400" />
            </div>
            <div>
              <p className="font-medium text-white text-sm">Criar campanhas</p>
              <p className="text-xs text-zinc-400">Envie mensagens em massa para seus contatos</p>
            </div>
          </div>

          <div className="flex items-center gap-3 p-3 rounded-lg bg-zinc-800/50 border border-zinc-700">
            <div className="w-10 h-10 rounded-lg bg-blue-500/20 flex items-center justify-center flex-shrink-0">
              <Users className="w-5 h-5 text-blue-400" />
            </div>
            <div>
              <p className="font-medium text-white text-sm">Importar contatos</p>
              <p className="text-xs text-zinc-400">Adicione sua lista de contatos via CSV</p>
            </div>
          </div>

          <div className="flex items-center gap-3 p-3 rounded-lg bg-zinc-800/50 border border-zinc-700">
            <div className="w-10 h-10 rounded-lg bg-purple-500/20 flex items-center justify-center flex-shrink-0">
              <BarChart3 className="w-5 h-5 text-purple-400" />
            </div>
            <div>
              <p className="font-medium text-white text-sm">Acompanhar métricas</p>
              <p className="text-xs text-zinc-400">Veja entregas, leituras e respostas</p>
            </div>
          </div>
        </div>
      </div>

      {/* Botão de conclusão */}
      <Button
        onClick={handleComplete}
        className="w-full bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-600 hover:to-teal-600"
        size="lg"
      >
        <Rocket className="w-5 h-5 mr-2" />
        Começar a usar o V-Smart
      </Button>
    </div>
  );
}
