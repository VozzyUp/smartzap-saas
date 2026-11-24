'use client';

import React, { useState, useEffect } from 'react';
import { X } from 'lucide-react';
import { Contact, ContactStatus, CustomFieldDefinition, EditContactForm } from './types';

export interface ContactEditModalProps {
  isOpen: boolean;
  contact: Contact | null;
  onClose: () => void;
  onSubmit: (data: EditContactForm) => void;
  customFields: CustomFieldDefinition[];
}

const createInitialForm = (contact: Contact | null): EditContactForm => ({
  name: contact?.name || '',
  phone: contact?.phone || '',
  email: contact?.email || '',
  tags: contact?.tags.join(', ') || '',
  status: contact?.status || ContactStatus.OPT_IN,
  custom_fields: contact?.custom_fields || {}
});

export const ContactEditModal: React.FC<ContactEditModalProps> = ({
  isOpen,
  contact,
  onClose,
  onSubmit,
  customFields
}) => {
  const [form, setForm] = useState<EditContactForm>(createInitialForm(contact));

  // Sync form with contact when it changes
  useEffect(() => {
    if (contact) {
      setForm(createInitialForm(contact));
    }
  }, [contact]);

  if (!isOpen || !contact) return null;

  const updateCustomField = (key: string, value: string) => {
    setForm({
      ...form,
      custom_fields: { ...form.custom_fields, [key]: value }
    });
  };

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-zinc-950 border border-white/10 rounded-2xl w-full max-w-md p-6 shadow-2xl animate-in zoom-in duration-200 max-sm:max-h-[85dvh] max-sm:overflow-y-auto">
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-xl font-bold text-white">Editar Contato</h2>
          <button
            type="button"
            aria-label="Fechar formulário de edição de contato"
            onClick={onClose}
          >
            <X className="text-gray-500 hover:text-white" />
          </button>
        </div>
        <div className="space-y-4">
          <div>
            <label className="block text-sm text-gray-400 mb-1">Nome Completo</label>
            <input
              className="w-full bg-zinc-900 border border-white/10 rounded-lg px-4 py-3 text-white focus:border-primary-500 outline-none transition-colors max-sm:min-h-11"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </div>
          <div>
            <label className="block text-sm text-gray-400 mb-1">Telefone (WhatsApp) *</label>
            <input
              className="w-full bg-zinc-900 border border-white/10 rounded-lg px-4 py-3 text-white focus:border-primary-500 outline-none transition-colors max-sm:min-h-11"
              value={form.phone}
              onChange={(e) => setForm({ ...form, phone: e.target.value })}
            />
          </div>
          <div>
            <label className="block text-sm text-gray-400 mb-1">E-mail</label>
            <input
              className="w-full bg-zinc-900 border border-white/10 rounded-lg px-4 py-3 text-white focus:border-primary-500 outline-none transition-colors max-sm:min-h-11"
              placeholder="email@exemplo.com"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
            />
          </div>
          <div>
            <label className="block text-sm text-gray-400 mb-1">Tags (separadas por vírgula)</label>
            <input
              className="w-full bg-zinc-900 border border-white/10 rounded-lg px-4 py-3 text-white focus:border-primary-500 outline-none transition-colors max-sm:min-h-11"
              value={form.tags}
              onChange={(e) => setForm({ ...form, tags: e.target.value })}
            />
          </div>

          {/* Custom Fields */}
          {customFields.length > 0 && (
            <div className="pt-2 border-t border-white/10 mt-2">
              <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">
                Campos Personalizados
              </h3>
              <div className="space-y-3">
                {customFields.map(field => (
                  <CustomFieldInput
                    key={field.id}
                    field={field}
                    value={form.custom_fields[field.key] || ''}
                    onChange={(value) => updateCustomField(field.key, value)}
                  />
                ))}
              </div>
            </div>
          )}
          <div>
            <label className="block text-sm text-gray-400 mb-1">Status</label>
            <select
              className="w-full bg-zinc-900 border border-white/10 rounded-lg px-4 py-3 text-white focus:border-primary-500 outline-none transition-colors max-sm:min-h-11"
              value={form.status}
              onChange={(e) => setForm({ ...form, status: e.target.value as ContactStatus })}
            >
              <option value={ContactStatus.OPT_IN}>Opt-in</option>
              <option value={ContactStatus.OPT_OUT}>Opt-out</option>
              <option value={ContactStatus.UNKNOWN}>Desconhecido</option>
            </select>
          </div>
          <div className="pt-4 flex gap-3">
            <button
              onClick={onClose}
              className="flex-1 bg-zinc-800 text-white font-medium py-3 rounded-xl hover:bg-zinc-700 transition-colors"
            >
              Cancelar
            </button>
            <button
              onClick={() => onSubmit(form)}
              className="flex-1 bg-primary-500 text-white font-bold py-3 rounded-xl hover:bg-primary-400 transition-colors"
            >
              Salvar Alterações
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

interface CustomFieldInputProps {
  field: CustomFieldDefinition;
  value: string;
  onChange: (value: string) => void;
}

const CustomFieldInput: React.FC<CustomFieldInputProps> = ({ field, value, onChange }) => {
  return (
    <div>
      <label className="block text-sm text-gray-400 mb-1">{field.label}</label>
      {field.type === 'select' ? (
        <select
          className="w-full bg-zinc-900 border border-white/10 rounded-lg px-4 py-3 text-white focus:border-primary-500 outline-none transition-colors appearance-none max-sm:min-h-11"
          value={value}
          onChange={(e) => onChange(e.target.value)}
        >
          <option value="">Selecione...</option>
          {field.options?.map(opt => (
            <option key={opt} value={opt}>{opt}</option>
          ))}
        </select>
      ) : (
        <input
          type={field.type === 'number' ? 'number' : field.type === 'date' ? 'date' : 'text'}
          className="w-full bg-zinc-900 border border-white/10 rounded-lg px-4 py-3 text-white focus:border-primary-500 outline-none transition-colors max-sm:min-h-11"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={field.type === 'date' ? '' : `Digite ${field.label}...`}
        />
      )}
    </div>
  );
};
