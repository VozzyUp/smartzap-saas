'use server'

import { createClient } from '@/lib/supabase-server'
import { getAppUrl } from '@/lib/app-url'
import type { LeadForm } from '@/types'

export interface FormsInitialData {
  forms: LeadForm[]
  tags: string[]
  publicBaseUrl: string
}

/**
 * Busca dados iniciais de formulários no servidor (RSC).
 */
export async function getFormsInitialData(): Promise<FormsInitialData> {
  const supabase = await createClient()

  // Buscar formulários e tags em paralelo
  const [formsResult, tagsResult] = await Promise.all([
    supabase
      .from('lead_forms')
      .select('*')
      .order('created_at', { ascending: false }),

    supabase
      .from('contacts')
      .select('tags')
      .not('tags', 'is', null)
  ])

  // Extrair tags únicas
  const allTags = new Set<string>()
  ;(tagsResult.data || []).forEach(row => {
    if (Array.isArray(row.tags)) {
      row.tags.forEach((tag: string) => allTags.add(tag))
    }
  })

  // URL base para formulários públicos
  const publicBaseUrl = getAppUrl()

  return {
    forms: (formsResult.data || []) as LeadForm[],
    tags: Array.from(allTags).sort(),
    publicBaseUrl
  }
}
