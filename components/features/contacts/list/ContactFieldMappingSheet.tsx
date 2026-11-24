'use client';

import React, { useState } from 'react';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Settings2, Plus, ChevronLeft, Check, CheckCircle2 } from 'lucide-react';
import { CustomFieldsManager } from '../CustomFieldsManager';
import { CustomFieldDefinition, CsvPreviewData, ColumnMapping } from './types';

export interface ContactFieldMappingSheetProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  customFields: CustomFieldDefinition[];
  csvPreview: CsvPreviewData;
  columnMapping: ColumnMapping;
  onColumnMappingChange: (mapping: ColumnMapping) => void;
  onCustomFieldCreated: (field: CustomFieldDefinition) => void;
  onCustomFieldDeleted: (id: string) => void;
}

type MappingView = 'map' | 'manage';

export const ContactFieldMappingSheet: React.FC<ContactFieldMappingSheetProps> = ({
  isOpen,
  onOpenChange,
  customFields,
  csvPreview,
  columnMapping,
  onColumnMappingChange,
  onCustomFieldCreated,
  onCustomFieldDeleted
}) => {
  const [view, setView] = useState<MappingView>('map');

  const handleOpenChange = (open: boolean) => {
    onOpenChange(open);
    if (!open) setView('map'); // Reset view on close
  };

  const updateCustomFieldMapping = (key: string, value: string) => {
    onColumnMappingChange({
      ...columnMapping,
      custom_fields: { ...columnMapping.custom_fields, [key]: value }
    });
  };

  return (
    <Sheet open={isOpen} onOpenChange={handleOpenChange}>
      <SheetContent className="w-full sm:w-135 border-l border-white/10 bg-zinc-950 p-0 flex flex-col z-60">
        <SheetHeader className="p-6 border-b border-white/10">
          <div className="flex items-center justify-between">
            <SheetTitle className="text-white flex items-center gap-2">
              <Settings2 className="text-primary-500" size={20} />
              {view === 'map' ? 'Mapear Campos' : 'Gerenciar Campos'}
            </SheetTitle>

            {view === 'map' ? (
              <button
                onClick={() => setView('manage')}
                className="text-xs flex items-center gap-1.5 text-primary-400 hover:text-primary-300 font-medium bg-primary-500/10 hover:bg-primary-500/20 px-3 py-1.5 rounded-lg transition-colors"
              >
                <Plus size={14} />
                Criar / Editar
              </button>
            ) : (
              <button
                onClick={() => setView('map')}
                className="text-xs flex items-center gap-1.5 text-white font-semibold bg-zinc-800 hover:bg-zinc-700 border border-white/10 px-4 py-2 rounded-lg transition-all hover:scale-105 shadow-lg shadow-black/20"
              >
                <ChevronLeft size={14} />
                Voltar
              </button>
            )}
          </div>
          <SheetDescription className="text-gray-400 mt-1">
            {view === 'map'
              ? 'Vincule colunas do CSV aos campos do sistema.'
              : 'Crie ou remova campos personalizados.'}
          </SheetDescription>
        </SheetHeader>

        {view === 'manage' ? (
          <CustomFieldsManager
            entityType="contact"
            onFieldCreated={onCustomFieldCreated}
            onFieldDeleted={onCustomFieldDeleted}
          />
        ) : (
          <>
            <div className="flex-1 overflow-y-auto p-6 space-y-6">
              {customFields && customFields.length > 0 ? (
                <div className="space-y-6">
                  {customFields.map((field) => {
                    const isMapped = !!columnMapping.custom_fields?.[field.key];
                    return (
                      <div
                        key={field.id}
                        className={`p-4 rounded-xl border transition-all ${isMapped
                          ? 'bg-primary-500/5 border-primary-500/20'
                          : 'bg-zinc-900/50 border-white/5'
                          }`}
                      >
                        <div className="flex items-center justify-between mb-3">
                          <div className="flex items-center gap-2">
                            <label className={`text-sm font-medium ${isMapped ? 'text-primary-400' : 'text-white'}`}>
                              {field.label}
                            </label>
                            {isMapped && <Check size={14} className="text-primary-500" />}
                          </div>
                          <span className="text-[10px] font-mono text-gray-500 bg-zinc-900 px-2 py-1 rounded">
                            {`{{${field.key}}}`}
                          </span>
                        </div>

                        <select
                          className={`w-full bg-zinc-950 border rounded-lg px-3 py-2 text-white text-sm outline-none transition-colors ${isMapped
                            ? 'border-primary-500/30 focus:border-primary-500'
                            : 'border-white/10 focus:border-primary-500'
                            }`}
                          value={columnMapping.custom_fields?.[field.key] || ''}
                          onChange={(e) => updateCustomFieldMapping(field.key, e.target.value)}
                        >
                          <option value="">Não importar</option>
                          {csvPreview?.headers.map(h => {
                            const previewValue = csvPreview.rows[0]?.[csvPreview.headers.indexOf(h)];
                            return (
                              <option key={h} value={h}>
                                {h} {previewValue ? `(ex: ${previewValue})` : ''}
                              </option>
                            );
                          })}
                        </select>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="text-center py-10">
                  <p className="text-gray-500">Nenhum campo personalizado disponível.</p>
                  <button
                    onClick={() => setView('manage')}
                    className="mt-4 text-primary-400 hover:underline text-sm"
                  >
                    Criar primeiro campo
                  </button>
                </div>
              )}
            </div>

            <div className="p-6 border-t border-white/10 bg-zinc-900/50">
              <button
                onClick={() => onOpenChange(false)}
                className="w-full py-3 bg-primary-500 hover:bg-primary-600 text-black font-bold rounded-xl transition-colors flex items-center justify-center gap-2"
              >
                <CheckCircle2 size={18} />
                Confirmar Mapeamento
              </button>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
};
