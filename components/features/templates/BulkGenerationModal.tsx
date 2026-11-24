import React, { useMemo } from 'react';
import { X, Sparkles, Copy, Check, Info, Loader2, ArrowLeft, Zap, Target, MessageSquare, Link as LinkIcon, Phone, AlertCircle } from 'lucide-react'; // Added icons
import { UtilityCategory, GeneratedTemplate } from '../../../services/templateService';
import { UTILITY_CATEGORIES } from '../../../hooks/useTemplates';

interface BulkGenerationModalProps {
    isOpen: boolean;
    onClose: () => void;

    // Step 1: Configuration
    businessType: string;
    setBusinessType: (type: string) => void;
    quantity: number;
    setQuantity: (qty: number) => void;
    language: 'pt_BR' | 'en_US' | 'es_ES';
    setLanguage: (lang: 'pt_BR' | 'en_US' | 'es_ES') => void;

    // Step 2: Selection & Review
    generatedTemplates: GeneratedTemplate[];
    selectedTemplates: Set<string>;
    onGenerate: () => void;
    onToggleTemplate: (id: string) => void;
    onSelectAll: () => void;
    onSubmit: () => void;
    onCopyTemplate: (template: GeneratedTemplate) => void;

    // Universal URL/Phone for buttons (NEW)
    universalUrl: string;
    setUniversalUrl: (url: string) => void;
    universalPhone: string;
    setUniversalPhone: (phone: string) => void;

    // Loading States
    isGenerating: boolean;
    isSubmitting: boolean;

    // Customization for reuse
    submitLabel?: string;
    submitIcon?: React.ReactNode;
}

export const BulkGenerationModal: React.FC<BulkGenerationModalProps> = ({
    isOpen,
    onClose,
    businessType,
    setBusinessType,
    quantity,
    setQuantity,
    language,
    setLanguage,
    generatedTemplates,
    selectedTemplates,
    onGenerate,
    onToggleTemplate,
    onSelectAll,
    onSubmit,
    onCopyTemplate,
    universalUrl,
    setUniversalUrl,
    universalPhone,
    setUniversalPhone,
    isGenerating,
    isSubmitting,
    submitLabel = 'Submeter Lote',
    submitIcon = <Zap size={16} />
}) => {
    if (!isOpen) return null;

    const hasTemplates = generatedTemplates.length > 0;

    // Detect if selected templates have URL or PHONE buttons
    const buttonAnalysis = useMemo(() => {
        const selectedList = generatedTemplates.filter(t => selectedTemplates.has(t.id));
        let hasUrlButtons = false;
        let hasPhoneButtons = false;
        let urlButtonCount = 0;
        let phoneButtonCount = 0;

        for (const template of selectedList) {
            if (template.buttons) {
                for (const btn of template.buttons) {
                    if (btn.type === 'URL') {
                        hasUrlButtons = true;
                        urlButtonCount++;
                    }
                    if (btn.type === 'PHONE_NUMBER') {
                        hasPhoneButtons = true;
                        phoneButtonCount++;
                    }
                }
            }
        }

        return { hasUrlButtons, hasPhoneButtons, urlButtonCount, phoneButtonCount };
    }, [generatedTemplates, selectedTemplates]);

    // Validation: can submit only if required fields are filled
    const isUrlValid = !buttonAnalysis.hasUrlButtons || (universalUrl.startsWith('http://') || universalUrl.startsWith('https://'));
    const isPhoneValid = !buttonAnalysis.hasPhoneButtons || universalPhone.length >= 10;
    const canSubmit = selectedTemplates.size > 0 && isUrlValid && isPhoneValid;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            {/* Backdrop with Blur */}
            <div
                className="absolute inset-0 bg-black/70 backdrop-blur-sm transition-opacity duration-300"
                onClick={onClose}
            />

            {/* Modal Content */}
            <div className="relative bg-zinc-900/80 border border-white/10 rounded-2xl w-full max-w-4xl shadow-[0_30px_80px_rgba(0,0,0,0.55)] flex flex-col max-h-[90vh] overflow-hidden animate-in zoom-in-95 duration-200">

                {/* Header - Apple-esque: Clean, Centered or subtle */}
                <div className="px-6 py-4 border-b border-white/10 flex items-center justify-between bg-zinc-950/40 backdrop-blur-xl z-10">
                    <div className="flex items-center gap-3">
                        <div className="p-2 rounded-xl bg-emerald-500/10 border border-emerald-500/20">
                            {hasTemplates ? <Target className="w-5 h-5 text-emerald-300" /> : <Sparkles className="w-5 h-5 text-emerald-300" />}
                        </div>
                        <div>
                            <h2 className="text-lg font-semibold text-white tracking-tight">
                                {hasTemplates ? 'Revisão de Templates' : 'Fábrica de Utilidade'}
                            </h2>
                            <p className="text-xs text-zinc-400 font-medium">
                                {hasTemplates
                                    ? `${selectedTemplates.size} de ${generatedTemplates.length} selecionados`
                                    : 'Geração assistida por IA para máxima aprovação'
                                }
                            </p>
                        </div>
                    </div>
                    <button
                        onClick={onClose}
                        className="p-2 text-zinc-400 hover:text-white hover:bg-white/5 rounded-full transition-all"
                    >
                        <X size={20} />
                    </button>
                </div>

                {/* Body */}
                <div className="flex-1 overflow-y-auto overflow-x-hidden relative">
                    {!hasTemplates ? (
                        /* STEP 1: CONFIGURATION */
                        <div className="p-8 max-w-2xl mx-auto space-y-8">
                            {/* Context Input */}
                            <div className="space-y-4">
                                <label className="block text-sm font-medium text-zinc-300">
                                    Sobre o que são os templates?
                                </label>
                                <div className="relative group">
                                    <textarea
                                        value={businessType}
                                        onChange={(e) => setBusinessType(e.target.value)}
                                        placeholder="Ex: Confirmação de agendamento para clínica odontológica, avisar sobre boleto vencido, envio de código de rastreio..."
                                        className="w-full h-40 bg-zinc-950/40 border border-white/10 rounded-xl p-5 text-white placeholder:text-zinc-500 focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/30 outline-none resize-none transition-all text-base leading-relaxed"
                                    />
                                    <div className="absolute bottom-4 right-4 text-xs text-zinc-500 bg-zinc-900/80 px-2 py-1 rounded-md border border-white/5">
                                        {businessType.length} caracteres
                                    </div>
                                </div>
                                <div className="flex items-start gap-3 p-4 bg-emerald-500/10 border border-emerald-500/20 rounded-xl">
                                    <Info className="w-5 h-5 text-emerald-300 shrink-0 mt-0.5" />
                                    <p className="text-sm text-emerald-100/80 leading-relaxed">
                                        Nossa IA gera variações otimizadas especificamente para a categoria <strong>UTILITY</strong>, maximizando suas chances de aprovação imediata na Meta.
                                    </p>
                                </div>
                            </div>

                            {/* Controls Grid */}
                            <div className="grid grid-cols-2 gap-6">
                                <div className="space-y-2">
                                    <label className="text-sm font-medium text-zinc-400">Quantidade</label>
                                    <div className="relative">
                                        <select
                                            value={quantity}
                                            onChange={(e) => setQuantity(Number(e.target.value))}
                                            className="w-full bg-zinc-950/40 border border-white/10 rounded-xl px-4 py-3 text-white outline-none focus:border-emerald-500/50 appearance-none cursor-pointer hover:bg-white/5 transition-colors max-sm:min-h-11"
                                        >
                                            {[3, 5, 10, 15, 20].map(n => (
                                                <option key={n} value={n}>{n} variações</option>
                                            ))}
                                        </select>
                                        <div className="absolute inset-y-0 right-4 flex items-center pointer-events-none text-zinc-500">
                                            <span className="text-xs">▼</span>
                                        </div>
                                    </div>
                                </div>
                                <div className="space-y-2">
                                    <label className="text-sm font-medium text-zinc-400">Idioma</label>
                                    <div className="relative">
                                        <select
                                            value={language}
                                            onChange={(e) => setLanguage(e.target.value as any)}
                                            className="w-full bg-zinc-950/40 border border-white/10 rounded-xl px-4 py-3 text-white outline-none focus:border-emerald-500/50 appearance-none cursor-pointer hover:bg-white/5 transition-colors max-sm:min-h-11"
                                        >
                                            <option value="pt_BR">🇧🇷 Português (BR)</option>
                                            <option value="en_US">🇺🇸 English (US)</option>
                                            <option value="es_ES">🇪🇸 Español</option>
                                        </select>
                                        <div className="absolute inset-y-0 right-4 flex items-center pointer-events-none text-zinc-500">
                                            <span className="text-xs">▼</span>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    ) : (
                        /* STEP 2: REVIEW & SELECTION */
                        <div className="p-6">
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                {generatedTemplates.map((template) => {
                                    const isSelected = selectedTemplates.has(template.id);
                                    return (
                                        <div
                                            key={template.id}
                                            onClick={() => onToggleTemplate(template.id)}
                                            className={`relative group cursor-pointer transition-all duration-300 border rounded-2xl p-5 hover:scale-[1.01] ${isSelected
                                                ? 'bg-emerald-500/10 border-emerald-500/30 shadow-[0_0_20px_-10px_rgba(16,185,129,0.2)]'
                                                : 'bg-zinc-950/40 border-white/10 hover:border-white/20 hover:bg-white/5'
                                                }`}
                                        >
                                            {/* Header */}
                                            <div className="flex justify-between items-start mb-3">
                                                <div className="flex-1 min-w-0 pr-4">
                                                    <h3 className={`text-sm font-bold truncate ${isSelected ? 'text-emerald-400' : 'text-zinc-300'}`}>
                                                        {template.name}
                                                    </h3>
                                                    <div className="flex items-center gap-2 mt-1">
                                                        <span className="text-[10px] uppercase font-bold tracking-wider text-zinc-500 bg-zinc-900/50 px-1.5 py-0.5 rounded border border-white/5">
                                                            {template.category}
                                                        </span>
                                                        {template.buttons && template.buttons.length > 0 && (
                                                            <span className="text-[10px] text-zinc-500 flex items-center gap-1">
                                                                <MessageSquare size={10} /> {template.buttons.length} botões
                                                            </span>
                                                        )}
                                                    </div>
                                                </div>

                                                {/* Checkbox Ring */}
                                                <div className={`w-5 h-5 rounded-full border flex items-center justify-center transition-all duration-300 ${isSelected
                                                    ? 'bg-emerald-500 border-emerald-500 shadow-sm'
                                                    : 'border-zinc-600 group-hover:border-zinc-400'
                                                    }`}>
                                                    {isSelected && <Check size={12} className="text-white" strokeWidth={3} />}
                                                </div>
                                            </div>

                                            {/* Content Preview - WhatsApp Style */}
                                            <div className="bg-[#0b141a] rounded-lg p-3 relative overflow-hidden">
                                                {/* Chat Bubble */}
                                                <div className="bg-[#005c4b] text-white text-[13px] leading-relaxed p-2.5 rounded-lg rounded-tl-none shadow-sm relative z-10">
                                                    {template.header?.text && <p className="font-bold mb-1 opacity-90">{template.header.text}</p>}
                                                    <p className="whitespace-pre-wrap">{template.content}</p>
                                                    <div className="flex justify-end mt-1 opacity-60">
                                                        <span className="text-[9px]">12:00</span>
                                                    </div>
                                                </div>
                                                {/* Buttons */}
                                                {template.buttons && template.buttons.length > 0 && (
                                                    <div className="mt-1 space-y-0.5">
                                                        {template.buttons.map((btn, i) => (
                                                            <div key={i} className="bg-[#0b141a] border border-[#005c4b]/50 text-[#00a884] text-xs font-medium py-1.5 text-center rounded">
                                                                {btn.text}
                                                            </div>
                                                        ))}
                                                    </div>
                                                )}
                                            </div>

                                            {/* Actions */}
                                            <div className="mt-3 flex justify-end opacity-0 group-hover:opacity-100 transition-opacity duration-200">
                                                <button
                                                    onClick={() => onCopyTemplate(template)}
                                                    className="shrink-0 p-2 text-gray-500 hover:text-white hover:bg-white/10 rounded-lg transition-colors"
                                                    title="Copiar template"
                                                >
                                                    <Copy size={16} />
                                                </button>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>

                            {/* CONFIGURATION PANEL - Shows when buttons need values */}
                            {(buttonAnalysis.hasUrlButtons || buttonAnalysis.hasPhoneButtons) && selectedTemplates.size > 0 && (
                                <div className="mt-6 p-5 bg-amber-500/10 border border-amber-500/20 rounded-xl animate-in fade-in slide-in-from-bottom-2 duration-300">
                                    <div className="flex items-start gap-3 mb-4">
                                        <div className="p-2 bg-amber-500/20 rounded-lg">
                                            <AlertCircle className="w-5 h-5 text-amber-400" />
                                        </div>
                                        <div>
                                            <h3 className="text-sm font-bold text-white">Configurar Botões</h3>
                                            <p className="text-xs text-zinc-400 mt-1">
                                                Os templates selecionados têm botões. Preencha os valores abaixo.
                                            </p>
                                        </div>
                                    </div>

                                    <div className="space-y-4">
                                        {/* URL Input */}
                                        {buttonAnalysis.hasUrlButtons && (
                                            <div className="space-y-2">
                                                <label className="flex items-center gap-2 text-sm font-medium text-amber-300">
                                                    <LinkIcon size={14} />
                                                    URL para botões de link ({buttonAnalysis.urlButtonCount} botões)
                                                </label>
                                                <input
                                                    type="url"
                                                    value={universalUrl}
                                                    onChange={(e) => setUniversalUrl(e.target.value)}
                                                    placeholder="https://exemplo.com/pagina"
                                                    className={`w-full px-4 py-3 bg-zinc-950/40 border rounded-xl text-white placeholder:text-zinc-500 focus:ring-2 focus:ring-amber-500/30 outline-none transition-all ${universalUrl && !isUrlValid ? 'border-amber-500/50' : 'border-white/10 focus:border-amber-500/40'
                                                        }`}
                                                />
                                                {universalUrl && !isUrlValid && (
                                                    <p className="text-xs text-amber-300">URL deve começar com http:// ou https://</p>
                                                )}
                                                <p className="text-xs text-zinc-500">
                                                    Este link será usado em TODOS os templates selecionados
                                                </p>
                                            </div>
                                        )}

                                        {/* Phone Input */}
                                        {buttonAnalysis.hasPhoneButtons && (
                                            <div className="space-y-2">
                                                <label className="flex items-center gap-2 text-sm font-medium text-amber-300">
                                                    <Phone size={14} />
                                                    Telefone para botões de ligação ({buttonAnalysis.phoneButtonCount} botões)
                                                </label>
                                                <input
                                                    type="tel"
                                                    value={universalPhone}
                                                    onChange={(e) => setUniversalPhone(e.target.value)}
                                                    placeholder="+5511999999999"
                                                    className={`w-full px-4 py-3 bg-zinc-950/40 border rounded-xl text-white placeholder:text-zinc-500 focus:ring-2 focus:ring-amber-500/30 outline-none transition-all ${universalPhone && !isPhoneValid ? 'border-amber-500/50' : 'border-white/10 focus:border-amber-500/40'
                                                        }`}
                                                />
                                                {universalPhone && !isPhoneValid && (
                                                    <p className="text-xs text-amber-300">Telefone deve ter pelo menos 10 dígitos</p>
                                                )}
                                                <p className="text-xs text-zinc-500">
                                                    Este número será usado em TODOS os templates selecionados
                                                </p>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            )}
                        </div>
                    )}
                </div>

                {/* Footer */}
                <div className="p-6 border-t border-white/10 bg-zinc-950/40 backdrop-blur-xl z-10 flex justify-between items-center gap-4">
                    {!hasTemplates ? (
                        <>
                            <div className="text-xs text-zinc-500 italic hidden sm:block">
                                Ex: "Promoção de relâmpago" (min. 10 caracteres)
                            </div>
                            <button
                                onClick={onGenerate}
                                disabled={isGenerating || !businessType || businessType.length < 10}
                                className="flex items-center gap-2 px-8 py-3 bg-white text-black font-semibold rounded-xl hover:bg-zinc-200 transition-all disabled:opacity-50 disabled:cursor-not-allowed ml-auto"
                            >
                                {isGenerating ? (
                                    <><Loader2 size={18} className="animate-spin" /> Gerando...</>
                                ) : (
                                    <><Sparkles size={18} className="text-emerald-600" /> Gerar Templates</>
                                )}
                            </button>
                        </>
                    ) : (
                        <>
                            <div className="flex items-center gap-3">
                                <button
                                    onClick={() => setBusinessType('')}
                                    className="px-4 py-2 text-zinc-400 hover:text-white text-sm font-medium transition-colors flex items-center gap-2"
                                >
                                    <ArrowLeft size={16} /> Voltar
                                </button>
                                <button
                                    onClick={onSelectAll}
                                    className="px-4 py-2 text-zinc-400 hover:text-emerald-300 text-sm font-medium transition-colors"
                                >
                                    {selectedTemplates.size === generatedTemplates.length ? 'Desmarcar Todos' : 'Selecionar Todos'}
                                </button>
                            </div>

                            <button
                                onClick={onSubmit}
                                disabled={isSubmitting || !canSubmit}
                                className="flex items-center gap-2 px-8 py-3 bg-emerald-500 text-black font-semibold rounded-xl hover:bg-emerald-400 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                                title={!canSubmit && (buttonAnalysis.hasUrlButtons || buttonAnalysis.hasPhoneButtons) ? 'Preencha os campos de configuração acima' : ''}
                            >
                                {isSubmitting ? (
                                    <><Loader2 size={18} className="animate-spin" /> Processando...</>
                                ) : (
                                    <>{submitIcon} {submitLabel} ({selectedTemplates.size})</>
                                )}
                            </button>
                        </>
                    )}
                </div>

            </div>
        </div>
    );
};
