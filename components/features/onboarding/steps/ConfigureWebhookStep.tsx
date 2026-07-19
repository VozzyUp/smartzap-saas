'use client';

import React, { useState, useEffect } from 'react';
import {
  ArrowRight,
  Copy,
  Check,
  ExternalLink,
  Loader2,
  CheckCircle2,
  Bell,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { StepHeader } from './StepHeader';
import { toast } from 'sonner';

interface ConfigureWebhookStepProps {
  onNext: () => void;
  onBack: () => void;
  stepNumber: number;
  totalSteps: number;
}

interface WebhookInfo {
  webhookUrl: string;
  webhookToken: string;
}

type SubStep = 'configure' | 'subscribe';

export function ConfigureWebhookStep({
  onNext,
  onBack,
  stepNumber,
  totalSteps,
}: ConfigureWebhookStepProps) {
  const [webhookInfo, setWebhookInfo] = useState<WebhookInfo | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [subStep, setSubStep] = useState<SubStep>('configure');
  const [confirmed, setConfirmed] = useState(false);
  const [messagesConfirmed, setMessagesConfirmed] = useState(false);

  // Buscar dados do webhook
  useEffect(() => {
    async function fetchWebhookInfo() {
      try {
        const response = await fetch('/api/webhook/info');
        if (!response.ok) throw new Error('Falha ao carregar dados do webhook');
        const data = await response.json();
        setWebhookInfo({
          webhookUrl: data.webhookUrl,
          webhookToken: data.webhookToken,
        });
      } catch (error) {
        toast.error('Erro ao carregar dados do webhook');
      } finally {
        setIsLoading(false);
      }
    }
    fetchWebhookInfo();
  }, []);

  const handleCopy = async (text: string, field: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedField(field);
      toast.success('Copiado!');
      setTimeout(() => setCopiedField(null), 2000);
    } catch {
      toast.error('Falha ao copiar');
    }
  };

  const META_APP_SETTINGS_URL = 'https://developers.facebook.com/apps/';

  const handleConfigureDone = () => {
    setSubStep('subscribe');
  };

  const handleSubscribeDone = () => {
    onNext();
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-8 h-8 animate-spin text-zinc-400" />
      </div>
    );
  }

  // ============================================================================
  // Sub-step 1: Configurar Webhook (URL + Token)
  // ============================================================================
  if (subStep === 'configure') {
    return (
      <div className="space-y-6">
        <StepHeader
          stepNumber={stepNumber}
          totalSteps={totalSteps}
          title="Configurar Webhook"
          onBack={onBack}
        />

        {/* Explicação do objetivo */}
        <div className="text-center space-y-1">
          <p className="text-zinc-300">
            Para saber quando suas mensagens foram <strong className="text-white">entregues</strong> e <strong className="text-white">lidas</strong>,
          </p>
          <p className="text-zinc-400 text-sm">
            o V-Smart precisa receber notificações do WhatsApp.
          </p>
        </div>

        {/* Dados do Webhook - Sempre visíveis neste step */}
        <div className="p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/20 space-y-4">
          <h4 className="font-medium text-emerald-200 flex items-center gap-2">
            <span className="text-lg">🔗</span>
            Copie estes dados para o Meta
          </h4>

          {/* URL */}
          <div className="space-y-1">
            <label className="text-xs text-zinc-400 uppercase tracking-wide">URL do Callback</label>
            <div className="flex items-center gap-2">
              <code className="flex-1 px-3 py-2 bg-zinc-800 rounded-lg font-mono text-sm text-white truncate">
                {webhookInfo?.webhookUrl}
              </code>
              <Button
                variant="outline"
                size="sm"
                onClick={() => handleCopy(webhookInfo?.webhookUrl || '', 'url')}
                className="flex-shrink-0"
              >
                {copiedField === 'url' ? (
                  <Check className="w-4 h-4 text-emerald-500" />
                ) : (
                  <Copy className="w-4 h-4" />
                )}
              </Button>
            </div>
          </div>

          {/* Token */}
          <div className="space-y-1">
            <label className="text-xs text-zinc-400 uppercase tracking-wide">Token de Verificação</label>
            <div className="flex items-center gap-2">
              <code className="flex-1 px-3 py-2 bg-zinc-800 rounded-lg font-mono text-sm text-white truncate">
                {webhookInfo?.webhookToken}
              </code>
              <Button
                variant="outline"
                size="sm"
                onClick={() => handleCopy(webhookInfo?.webhookToken || '', 'token')}
                className="flex-shrink-0"
              >
                {copiedField === 'token' ? (
                  <Check className="w-4 h-4 text-emerald-500" />
                ) : (
                  <Copy className="w-4 h-4" />
                )}
              </Button>
            </div>
          </div>
        </div>

        {/* Instruções compactas */}
        <div className="space-y-3">
          <h4 className="text-sm font-medium text-zinc-300">No Meta for Developers:</h4>

          <ol className="space-y-2 text-sm text-zinc-400">
            <li className="flex items-start gap-2">
              <span className="w-5 h-5 rounded-full bg-zinc-700 text-zinc-300 flex items-center justify-center text-xs flex-shrink-0 mt-0.5">1</span>
              <span>Vá em <strong className="text-white">WhatsApp → Configuração</strong></span>
            </li>
            <li className="flex items-start gap-2">
              <span className="w-5 h-5 rounded-full bg-zinc-700 text-zinc-300 flex items-center justify-center text-xs flex-shrink-0 mt-0.5">2</span>
              <span>Na seção <strong className="text-white">Webhook</strong>, clique em <strong className="text-white">Editar</strong></span>
            </li>
            <li className="flex items-start gap-2">
              <span className="w-5 h-5 rounded-full bg-zinc-700 text-zinc-300 flex items-center justify-center text-xs flex-shrink-0 mt-0.5">3</span>
              <span>Cole a <strong className="text-white">URL</strong> e o <strong className="text-white">Token</strong> copiados acima</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="w-5 h-5 rounded-full bg-zinc-700 text-zinc-300 flex items-center justify-center text-xs flex-shrink-0 mt-0.5">4</span>
              <span>Clique em <strong className="text-white">Verificar e salvar</strong></span>
            </li>
          </ol>
        </div>

        {/* Botão para abrir Meta */}
        <a
          href={META_APP_SETTINGS_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center justify-center gap-2 w-full p-3 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-medium transition-colors"
        >
          <ExternalLink className="w-4 h-4" />
          Abrir Meta for Developers
        </a>

        {/* Info */}
        <p className="text-xs text-zinc-500 text-center">
          Deixe esta janela aberta para copiar os dados enquanto configura no Meta
        </p>

        {/* Confirmação */}
        <div className="flex items-start gap-3 p-3 rounded-lg bg-zinc-800/50 border border-zinc-700">
          <Checkbox
            id="confirm-webhook"
            checked={confirmed}
            onCheckedChange={(checked) => setConfirmed(checked === true)}
            className="mt-0.5 border-emerald-500 data-[state=checked]:bg-emerald-500"
          />
          <label
            htmlFor="confirm-webhook"
            className="text-sm text-zinc-300 cursor-pointer select-none leading-relaxed"
          >
            Confirmo que cliquei em <strong className="text-white">"Verificar e salvar"</strong> no Meta e vi a mensagem de sucesso
          </label>
        </div>

        {/* Ações */}
        <div className="flex justify-end pt-2">
          <Button onClick={handleConfigureDone} disabled={!confirmed}>
            Continuar
            <ArrowRight className="w-4 h-4 ml-2" />
          </Button>
        </div>
      </div>
    );
  }

  // ============================================================================
  // Sub-step 2: Ativar Notificações de Mensagens
  // ============================================================================
  return (
    <div className="space-y-6">
      <StepHeader
        stepNumber={stepNumber}
        totalSteps={totalSteps}
        title="Ativar Notificações"
        onBack={() => setSubStep('configure')}
      />

      {/* Status de sucesso */}
      <div className="p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/20">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-emerald-500/20 flex items-center justify-center">
            <CheckCircle2 className="w-5 h-5 text-emerald-400" />
          </div>
          <div>
            <p className="font-medium text-emerald-200">Webhook configurado!</p>
            <p className="text-sm text-emerald-200/70">Agora vamos ativar as notificações</p>
          </div>
        </div>
      </div>

      {/* Ícone central */}
      <div className="flex justify-center py-4">
        <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-amber-500/20 to-orange-500/20 flex items-center justify-center">
          <Bell className="w-10 h-10 text-amber-400" />
        </div>
      </div>

      {/* Instruções */}
      <div className="space-y-3">
        <h4 className="text-sm font-medium text-zinc-300 text-center">
          Ainda no Meta for Developers:
        </h4>

        <div className="space-y-3">
          <div className="flex items-start gap-3 p-3 rounded-lg bg-amber-500/10 border border-amber-500/20">
            <span className="w-6 h-6 rounded-full bg-amber-500/20 text-amber-400 flex items-center justify-center text-sm font-medium flex-shrink-0">!</span>
            <div className="text-amber-200/90">
              <p className="font-medium">Atualize a página (F5)</p>
              <p className="text-sm text-amber-200/70">A opção de inscrição só aparece após recarregar</p>
            </div>
          </div>

          <ol className="space-y-2 text-sm text-zinc-400">
            <li className="flex items-start gap-2">
              <span className="w-5 h-5 rounded-full bg-zinc-700 text-zinc-300 flex items-center justify-center text-xs flex-shrink-0 mt-0.5">1</span>
              <span>Na seção <strong className="text-white">Webhook</strong>, clique em <strong className="text-white">Gerenciar</strong></span>
            </li>
            <li className="flex items-start gap-2">
              <span className="w-5 h-5 rounded-full bg-zinc-700 text-zinc-300 flex items-center justify-center text-xs flex-shrink-0 mt-0.5">2</span>
              <span>Encontre <strong className="text-white">messages</strong> na lista</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="w-5 h-5 rounded-full bg-zinc-700 text-zinc-300 flex items-center justify-center text-xs flex-shrink-0 mt-0.5">3</span>
              <span>Marque o checkbox para <strong className="text-white">ativar</strong></span>
            </li>
          </ol>
        </div>
      </div>

      {/* Explicação do que isso faz */}
      <div className="p-4 rounded-xl bg-zinc-800/50 border border-zinc-700">
        <p className="text-sm text-zinc-400">
          <strong className="text-zinc-300">Por que isso é importante?</strong>
          <br />
          Ao ativar "messages", você receberá confirmações de entrega, leitura e respostas dos seus contatos.
        </p>
      </div>

      {/* Confirmação */}
      <div className="flex items-start gap-3 p-3 rounded-lg bg-zinc-800/50 border border-zinc-700">
        <Checkbox
          id="confirm-messages"
          checked={messagesConfirmed}
          onCheckedChange={(checked) => setMessagesConfirmed(checked === true)}
          className="mt-0.5 border-emerald-500 data-[state=checked]:bg-emerald-500"
        />
        <label
          htmlFor="confirm-messages"
          className="text-sm text-zinc-300 cursor-pointer select-none leading-relaxed"
        >
          Confirmo que marquei o campo <strong className="text-white">"messages"</strong> no Meta
        </label>
      </div>

      {/* Ações */}
      <div className="flex justify-end pt-2">
        <Button onClick={handleSubscribeDone} disabled={!messagesConfirmed}>
          Próximo passo
          <ArrowRight className="w-4 h-4 ml-2" />
        </Button>
      </div>
    </div>
  );
}
