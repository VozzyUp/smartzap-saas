import { describe, it, expect } from 'vitest'
import { getDailyContinuationLabel } from './campaign-progress-label'

const base = { status: 'Agendado', recipients: 100, sent: 30, delivered: 0, read: 0, failed: 0, scheduledAt: '2026-11-24T12:00:00.000Z' }

describe('getDailyContinuationLabel', () => {
  it('agendada com parte já enviada: mostra andamento e próxima execução', () => {
    const label = getDailyContinuationLabel(base as any, new Date('2026-11-23T15:00:00Z'))
    expect(label).toBe('Em andamento: 30 de 100 enviados, próximos 70 amanhã')
  })
  it('data que não é amanhã usa a data', () => {
    const label = getDailyContinuationLabel(base as any, new Date('2026-11-20T15:00:00Z'))
    expect(label).toMatch(/^Em andamento: 30 de 100 enviados, próximos 70 em \d{2}\/\d{2}/)
  })
  it('agendada sem nenhum envio (agendamento comum): sem rótulo', () => {
    expect(getDailyContinuationLabel({ ...base, sent: 0 } as any)).toBeNull()
  })
  it('outro status: sem rótulo', () => {
    expect(getDailyContinuationLabel({ ...base, status: 'Concluído' } as any)).toBeNull()
  })
  it('nada restante: sem rótulo', () => {
    expect(getDailyContinuationLabel({ ...base, sent: 100 } as any)).toBeNull()
  })
  it('usa entregues/lidos quando sent já "andou" de status', () => {
    const label = getDailyContinuationLabel({ ...base, sent: 5, delivered: 20, read: 10 } as any, new Date('2026-11-23T15:00:00Z'))
    expect(label).toBe('Em andamento: 20 de 100 enviados, próximos 80 amanhã')
  })
})
