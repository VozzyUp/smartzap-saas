import React from 'react';
import Link from 'next/link';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { BookOpen, ExternalLink, Copy, Check } from 'lucide-react';
import { useState } from 'react';

export const ApiDocsPanel: React.FC = () => {
  const [copied, setCopied] = useState(false);

  const apiKey = typeof window !== 'undefined'
    ? localStorage.getItem('smartzap_api_key') || 'SUA_API_KEY'
    : 'SUA_API_KEY';

  const copyExample = () => {
    const example = `curl -X GET "https://seu-dominio.com/api/campaigns" \\
  -H "Authorization: Bearer ${apiKey}"`;
    navigator.clipboard.writeText(example);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Card className="border-zinc-800 bg-zinc-900/50">
      <CardHeader>
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-blue-500/10">
            <BookOpen className="h-5 w-5 text-blue-400" />
          </div>
          <div>
            <CardTitle className="text-lg text-zinc-100">Documentação da API</CardTitle>
            <CardDescription>
              Integre o V-Smart com seus sistemas via REST API
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-zinc-400">
          Acesse a documentação interativa (Swagger UI) para explorar todos os endpoints disponíveis,
          testar requisições e ver exemplos de uso.
        </p>

        {/* Exemplo de uso */}
        <div className="bg-zinc-950 rounded-lg p-4 border border-zinc-800">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs text-zinc-500 uppercase tracking-wider">Exemplo</span>
            <Button
              variant="ghost"
              size="sm"
              onClick={copyExample}
              className="h-6 px-2 text-zinc-500 hover:text-zinc-300"
            >
              {copied ? (
                <Check className="h-3 w-3 text-green-400" />
              ) : (
                <Copy className="h-3 w-3" />
              )}
            </Button>
          </div>
          <pre className="text-xs text-zinc-300 overflow-x-auto">
            <code>{`curl -X GET "/api/campaigns" \\
  -H "Authorization: Bearer <API_KEY>"`}</code>
          </pre>
        </div>

        {/* Botão de acesso */}
        <Link href="/docs" target="_blank">
          <Button className="w-full bg-blue-600 hover:bg-blue-700 text-white">
            <BookOpen className="h-4 w-4 mr-2" />
            Abrir Documentação
            <ExternalLink className="h-3 w-3 ml-2 opacity-50" />
          </Button>
        </Link>
      </CardContent>
    </Card>
  );
};
