/**
 * Setup API
 *
 * POST: Complete initial setup (company, email, phone)
 * Login de usuário é via Supabase Auth (magic link) — o proxy já exige uma
 * sessão válida antes desta rota ser alcançada.
 */

import { NextRequest, NextResponse } from 'next/server'
import { completeSetup, isSetupComplete } from '@/lib/user-auth'

export async function POST(request: NextRequest) {
  console.log('=== AUTH/SETUP START ===')
  
  try {
    // Check if already setup
    console.log('Checking if setup is complete...')
    const setupComplete = await isSetupComplete()
    console.log('Setup complete:', setupComplete)
    
    if (setupComplete) {
      console.log('Setup already complete, rejecting')
      return NextResponse.json(
        { error: 'Setup já foi concluído' },
        { status: 400 }
      )
    }
    
    const body = await request.json()
    console.log('Request body:', JSON.stringify(body, null, 2))
    
    const { companyName, companyAdmin, email, phone } = body
    
    console.log('Parsed fields - companyName:', companyName, 'companyAdmin:', companyAdmin, 'email:', email, 'phone:', phone)
    
    if (!companyName || !companyAdmin || !email || !phone) {
      console.log('Missing required fields')
      return NextResponse.json(
        { error: 'Empresa, responsável, e-mail e telefone são obrigatórios' },
        { status: 400 }
      )
    }
    
    console.log('Calling completeSetup...')
    const result = await completeSetup(companyName, companyAdmin, email, phone)
    console.log('completeSetup result:', JSON.stringify(result, null, 2))
    
    if (!result.success) {
      console.log('completeSetup failed:', result.error)
      return NextResponse.json(
        { error: result.error },
        { status: 400 }
      )
    }
    
    console.log('=== AUTH/SETUP SUCCESS ===')
    return NextResponse.json({
      success: true,
      company: result.company
    })
    
  } catch (error) {
    console.error('=== AUTH/SETUP ERROR ===', error)
    return NextResponse.json(
      { error: 'Erro ao completar setup' },
      { status: 500 }
    )
  }
}
