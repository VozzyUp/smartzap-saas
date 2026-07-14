/**
 * Company Setup Helpers
 *
 * Login de usuário é feito via Supabase Auth (senha) — ver
 * `app/api/auth/{login,callback}` e `proxy.ts`.
 *
 * Este módulo hoje só cuida dos dados de "empresa" (nome, admin, e-mail,
 * telefone) preenchidos no wizard de onboarding, persistidos na tabela
 * `settings`. Não gerencia mais sessão/senha — isso é responsabilidade do
 * Supabase (cookies geridos por `@supabase/ssr`, ver `lib/supabase-server.ts`).
 *
 * Usa Supabase (PostgreSQL) como banco de dados
 */

import { supabase } from './supabase'
import { normalizePhoneNumber, validateAnyPhoneNumber } from './phone-formatter'

function getFirstName(fullName: string): string {
  const normalized = fullName.trim().replace(/\s+/gu, ' ')
  if (!normalized) return ''
  const [first] = normalized.split(' ')
  return first || normalized
}

// ============================================================================
// TYPES
// ============================================================================

export interface Company {
  id: string
  name: string
  email: string
  phone: string
  createdAt: string
}

export interface UserAuthResult {
  success: boolean
  error?: string
  company?: Company
}

// ============================================================================
// DATABASE HELPERS
// ============================================================================

/**
 * Upsert a setting in the database
 */
async function upsertSetting(key: string, value: string): Promise<void> {
  const now = new Date().toISOString()
  const { error } = await supabase
    .from('settings')
    .upsert({ key, value, updated_at: now }, { onConflict: 'key' })

  if (error) {
    // Não silencie erros de permissão/RLS — isso causa loops e estados falsos.
    throw new Error(`Falha ao salvar setting "${key}": ${error.message}`)
  }
}

/**
 * Get a setting from the database
 */
async function getSetting(key: string): Promise<{ value: string; updated_at: string } | null> {
  const { data, error } = await supabase
    .from('settings')
    .select('value, updated_at')
    .eq('key', key)
    .single()

  if (error || !data) return null
  return data
}

/**
 * Check if setup is completed (company exists)
 */
export async function isSetupComplete(): Promise<boolean> {
  // Em produção, usamos a env var para evitar consultas e loops.
  if (process.env.SETUP_COMPLETE === 'true') return true

  // Em dev/local, o fluxo pode rodar sem Vercel.
  // Então consideramos "setup completo" se a empresa já foi gravada no banco.
  if (process.env.NODE_ENV !== 'production') {
    try {
      const { data, error } = await supabase
        .from('settings')
        .select('key, value')
        .eq('key', 'company_name')
        .single()

      if (error) {
        // Ajuda a diagnosticar "isSetup:false" causado por permissão negada.
        console.warn('[isSetupComplete] settings/company_name query error:', error.message)
        return false
      }
      return !!data?.value
    } catch {
      return false
    }
  }

  return false
}

/**
 * Get company info
 */
export async function getCompany(): Promise<Company | null> {
  try {
    const { data, error } = await supabase
      .from('settings')
      .select('key, value')
      .in('key', ['company_id', 'company_name', 'company_email', 'company_phone', 'company_created_at'])

    if (error || !data || data.length === 0) return null

    const settings: Record<string, string> = {}
    data.forEach(row => {
      settings[row.key] = row.value
    })

    if (!settings.company_name) return null

    return {
      id: settings.company_id || 'default',
      name: settings.company_name,
      email: settings.company_email || '',
      phone: settings.company_phone || '',
      createdAt: settings.company_created_at || new Date().toISOString()
    }
  } catch {
    return null
  }
}

// ============================================================================
// SETUP (First-time configuration)
// ============================================================================

/**
 * Complete initial setup - create company, email, phone
 *
 * Chamado a partir da UI já autenticada via sessão Supabase (o proxy exige
 * sessão antes de deixar a requisição chegar aqui). Não cria mais sessão
 * própria — isso é papel do Supabase Auth.
 */
export async function completeSetup(
  companyName: string,
  companyAdmin: string,
  email: string,
  phone: string
): Promise<UserAuthResult> {
  // Validate inputs
  if (!companyName || companyName.trim().length < 2) {
    return { success: false, error: 'Nome da empresa deve ter pelo menos 2 caracteres' }
  }

  if (!companyAdmin || companyAdmin.trim().length < 2) {
    return { success: false, error: 'Nome do responsável deve ter pelo menos 2 caracteres' }
  }

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { success: false, error: 'E-mail inválido' }
  }

  // Normalize first so we accept inputs like "5511999999999" (without '+')
  const normalizedPhoneE164ForValidation = normalizePhoneNumber(phone)
  const phoneValidation = validateAnyPhoneNumber(normalizedPhoneE164ForValidation)
  if (!phoneValidation.isValid) {
    return { success: false, error: phoneValidation.error || 'Telefone inválido' }
  }

  try {
    const now = new Date().toISOString()
    // Use existing company_id if available, otherwise create new
    const existingId = await getSetting('company_id')
    const companyId = existingId?.value || crypto.randomUUID()

    const normalizedPhoneE164 = normalizedPhoneE164ForValidation
    const storedPhoneDigits = normalizedPhoneE164.replace(/\D/g, '')

    // Save company info using parallel upserts
    await Promise.all([
      upsertSetting('company_id', companyId),
      upsertSetting('company_name', companyName.trim()),
      upsertSetting('company_admin', companyAdmin.trim()),
      upsertSetting('company_email', email.trim().toLowerCase()),
      upsertSetting('company_phone', storedPhoneDigits),
      upsertSetting('company_created_at', now)
    ])

    // Seed automático do "Contato de Teste" (Settings → Testes)
    // Só cria se ainda não existir, para não sobrescrever a escolha do usuário.
    try {
      const existingTestContact = await getSetting('test_contact')
      const adminFullName = companyAdmin.trim()
      const adminFirstName = getFirstName(adminFullName)
      const desiredName = adminFirstName || adminFullName

      if (!existingTestContact?.value) {
        await upsertSetting(
          'test_contact',
          JSON.stringify({
            name: desiredName,
            phone: normalizedPhoneE164,
            updatedAt: now,
          })
        )
      } else {
        // Se o contato já existe mas parece ter sido seedado automaticamente com o nome completo,
        // podemos ajustar para o primeiro nome sem sobrescrever personalizações.
        try {
          const parsed = JSON.parse(existingTestContact.value) as unknown
          if (parsed && typeof parsed === 'object') {
            const tc = parsed as { name?: unknown; phone?: unknown; updatedAt?: unknown }
            const currentName = typeof tc.name === 'string' ? tc.name.trim() : ''
            const currentPhoneRaw = typeof tc.phone === 'string' ? tc.phone.trim() : ''
            const currentPhoneDigits = currentPhoneRaw.replace(/\D/g, '')
            const shouldUpgradePhoneToE164 = !!currentPhoneRaw && !currentPhoneRaw.startsWith('+')

            // Upgrade seguro de seeds antigos:
            // - Se o nome é o nome completo do admin (seed antigo) e o telefone bate (por dígitos),
            //   atualiza para primeiro nome e telefone em E.164.
            if (currentName === adminFullName && currentPhoneDigits === storedPhoneDigits) {
              await upsertSetting(
                'test_contact',
                JSON.stringify({
                  ...tc,
                  name: desiredName,
                  phone: normalizedPhoneE164,
                  updatedAt: now,
                })
              )
            } else if (shouldUpgradePhoneToE164 && currentPhoneDigits === storedPhoneDigits) {
              // Se o usuário não personalizou o nome mas o telefone está sem '+',
              // apenas normaliza para E.164.
              await upsertSetting(
                'test_contact',
                JSON.stringify({
                  ...tc,
                  phone: normalizedPhoneE164,
                  updatedAt: now,
                })
              )
            }
          }
        } catch {
          // Se não for JSON válido, não mexe.
        }
      }
    } catch (err) {
      // Não bloqueia o setup inteiro se apenas o seed do contato de teste falhar.
      console.warn('[completeSetup] Falha ao criar test_contact automaticamente:', err)
    }

    return {
      success: true,
      company: {
        id: companyId,
        name: companyName.trim(),
        email: email.trim().toLowerCase(),
        phone: storedPhoneDigits,
        createdAt: now
      }
    }
  } catch (error) {
    console.error('Setup error:', error)
    return { success: false, error: 'Erro ao salvar configuração' }
  }
}
