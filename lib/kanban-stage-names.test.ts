import { describe, it, expect } from 'vitest'
import { isReadStageName, isSentStageName, findReadStage, resolveFollowupStageId } from '@/lib/kanban-stage-names'

const stages = [
  { id: 's_new', name: 'Novo', position: 0 },
  { id: 's_sent', name: 'Mensagem enviada', position: 1 },
  { id: 's_read', name: 'Mensagem lida', position: 2 },
  { id: 's_reply', name: 'Respondeu', position: 3 },
]

describe('nomes de fase do funil', () => {
  it('reconhece "Mensagem lida" sem diferenciar maiúsculas, acentos e espaços', () => {
    expect(isReadStageName('Mensagem lida')).toBe(true)
    expect(isReadStageName('  MENSAGEM  LIDA ')).toBe(true)
    expect(isReadStageName('Mensagém Lída')).toBe(true)
    expect(isReadStageName('Mensagem enviada')).toBe(false)
    expect(isReadStageName('Lida')).toBe(false)
  })
  it('reconhece "Mensagem enviada"', () => {
    expect(isSentStageName('mensagem ENVIADA')).toBe(true)
    expect(isSentStageName('Mensagem lida')).toBe(false)
  })
  it('findReadStage devolve a fase ou null', () => {
    expect(findReadStage(stages)?.id).toBe('s_read')
    expect(findReadStage(stages.filter((s) => s.id !== 's_read'))).toBeNull()
  })
  it('resolveFollowupStageId: cartão em "Mensagem lida" usa as regras de "Mensagem enviada"', () => {
    expect(resolveFollowupStageId(stages, 's_read')).toBe('s_sent')
  })
  it('resolveFollowupStageId: outras fases ou quadro sem "Mensagem enviada" devolvem null', () => {
    expect(resolveFollowupStageId(stages, 's_reply')).toBeNull()
    expect(resolveFollowupStageId(stages, 's_sent')).toBeNull()
    expect(resolveFollowupStageId(stages.filter((s) => s.id !== 's_sent'), 's_read')).toBeNull()
  })
})
