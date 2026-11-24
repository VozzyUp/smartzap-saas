import { describe, it, expect } from 'vitest'
import { isOptOutKeyword } from './opt-out-keywords'

describe('isOptOutKeyword', () => {
  const optOut = [
    'parar',
    'pare',
    'PARAR de receber',
    'Parar de receber',
    'sair',
    'stop',
    'STOP!',
    'não quero mais',
    'Não tenho interesse',
    'sem interesse',
    'nao receber',
    'por favor, parar',
    'cancelar',
    'unsubscribe',
    'opt-out',
    'descadastrar',
  ]
  it.each(optOut)('"%s" é opt-out', (text) => {
    expect(isOptOutKeyword(text)).toBe(true)
  })

  const notOptOut = [
    'parece interessante',
    'comparar',
    'aparecer',
    'removedor',
    'Quero saber o preço',
    'estou interessado',
    'repare nisso',
    'transtorno',
    '',
    '   ',
    '😀👍',
  ]
  it.each(notOptOut)('"%s" NÃO é opt-out', (text) => {
    expect(isOptOutKeyword(text)).toBe(false)
  })

  it('texto muito longo sem palavra-chave não é opt-out e não trava', () => {
    expect(isOptOutKeyword('ola '.repeat(20000))).toBe(false)
  })
  it('palavra-chave no meio de texto longo é detectada', () => {
    expect(isOptOutKeyword('ola '.repeat(500) + 'sem interesse ' + 'ola '.repeat(500))).toBe(true)
  })
})
