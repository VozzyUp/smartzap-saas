import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { isSupabaseConfigured } from '@/lib/supabase'
import { normalizePhoneNumber, validateAnyPhoneNumber } from '@/lib/phone-formatter'
import { getTenantContext } from '@/lib/tenant-context'
import { settingsDb } from '@/lib/supabase-db'

/**
 * API Route: Test Contact Settings
 * 
 * Persists the test contact (name + phone) in Supabase settings table
 * This replaces the localStorage approach for better persistence
 */

const SETTING_KEY = 'test_contact'

export async function GET() {
    try {
        const ctx = await getTenantContext()
        if (!ctx?.tenantId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

        if (!isSupabaseConfigured()) {
            return NextResponse.json(null)
        }

        const value = await settingsDb.get(ctx.tenantId, SETTING_KEY)

        if (value) {
            // Parse JSON string to object (column is TEXT type)
            if (typeof value === 'string') {
                try {
                    const parsed = JSON.parse(value)
                    return NextResponse.json(parsed)
                } catch {
                    // Compat: versões antigas podem ter salvo apenas o telefone em texto.
                    const asText = String(value || '').trim()
                    const normalized = normalizePhoneNumber(asText)
                    const validation = validateAnyPhoneNumber(normalized)
                    if (validation.isValid) {
                        return NextResponse.json({ phone: normalized })
                    }
                    return NextResponse.json(null)
                }
            }

            return NextResponse.json(value)
        }

        return NextResponse.json(null)
    } catch (error) {
        console.error('Error fetching test contact:', error)
        return NextResponse.json(
            // Evita 500 para não causar cascata de retries/lentidão no frontend.
            { error: 'Failed to fetch test contact', details: String((error as any)?.message || error) }
        )
    }
}

export async function POST(request: NextRequest) {
    try {
        const ctx = await getTenantContext()
        if (!ctx?.tenantId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

        const body = await request.json()
        const { name, phone } = body

        if (!phone) {
            return NextResponse.json(
                { error: 'Phone number is required' },
                { status: 400 }
            )
        }

        // Normalize first so we accept inputs like "5511999999999" (without '+')
        const normalizedPhoneE164 = normalizePhoneNumber(String(phone))

        const phoneValidation = validateAnyPhoneNumber(normalizedPhoneE164)
        if (!phoneValidation.isValid) {
            return NextResponse.json(
                { error: phoneValidation.error || 'Telefone inválido' },
                { status: 400 }
            )
        }

        const testContact = {
            name: name?.trim() || '',
            phone: normalizedPhoneE164,
            updatedAt: new Date().toISOString()
        }

        // Upsert into settings table using tenant-scoped wrapper
        await settingsDb.set(ctx.tenantId, SETTING_KEY, JSON.stringify(testContact))

        return NextResponse.json({
            success: true,
            testContact
        })
    } catch (error) {
        console.error('Error saving test contact:', error)
        return NextResponse.json(
            { error: 'Failed to save test contact' },
            { status: 500 }
        )
    }
}

export async function DELETE() {
    try {
        const ctx = await getTenantContext()
        if (!ctx?.tenantId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

        const { error } = await supabase
            .from('settings')
            .delete()
            .eq('tenant_id', ctx.tenantId)
            .eq('key', SETTING_KEY)

        if (error) throw error

        return NextResponse.json({ success: true })
    } catch (error) {
        console.error('Error deleting test contact:', error)
        return NextResponse.json(
            { error: 'Failed to delete test contact' },
            { status: 500 }
        )
    }
}
