import { describe, it, expect } from 'vitest'
import { isOptOutKeyword } from './opt-out-keywords'

describe('isOptOutKeyword', () => {
  const optOut = [
    // regra 1: mensagem inteira
    'parar', 'pare', 'stop', 'cancelar', 'cancele', 'sair', 'remover', 'remove',
    'descadastrar', 'desinscrever', 'unsubscribe', 'optout', 'opt-out',
    'nao quero', 'não quero mais', 'nao quero receber', 'nao receber',
    'Não tenho interesse', 'sem interesse', 'Parar de receber', 'PARAR de receber',
    'nao quero mais receber', 'não me mande mais', 'nao mande mais', 'pare de mandar',
    'pare de me mandar', 'me tire da lista', 'me tira da lista', 'sair da lista',
    'remover da lista', 'nao envie mais', 'nao me envie mais',
    // formatação
    'PARAR!!!', 'Não tenho interesse 🙏', 'sair.', 'STOP!', 'Opt-Out',
    // regra 3: cortesia
    'Sair, por favor', 'parar obrigada', 'por favor, parar', 'ola, sair', 'ok parar pfv',
    // regra 2: frase inequívoca em mensagem curta
    'não tenho interesse, obrigada', 'por favor parar de receber',
    'quero me descadastrar', 'ja falei, nao me mande mais',
  ]
  it.each(optOut)('"%s" é opt-out', (text) => {
    expect(isOptOutKeyword(text)).toBe(true)
  })

  const notOptOut = [
    'posso cancelar quando quiser?',
    'quero cancelar meu horário de amanhã',
    'tem como remarcar ou cancelar?',
    'vou sair agora, falo depois',
    'não quero perder cliente',
    'não quero perder esse horário',
    'pode parar de me ligar e mandar só mensagem?',
    'parece interessante', 'Agora não', 'Aqui não', 'Ninguém', 'É robô mesmo?', 'Mostra',
    'comparar', 'aparecer', 'removedor', 'Quero saber o preço', 'estou interessado',
    'repare nisso', 'transtorno', '', '   ', '😀👍', 'ok', 'por favor',
  ]
  it.each(notOptOut)('"%s" NÃO é opt-out', (text) => {
    expect(isOptOutKeyword(text)).toBe(false)
  })

  it('texto muito longo sem palavra-chave não é opt-out e não trava', () => {
    expect(isOptOutKeyword('ola '.repeat(20000))).toBe(false)
  })
  it('palavra-chave no meio de texto longo NÃO bloqueia mais', () => {
    expect(isOptOutKeyword('bla '.repeat(500) + 'sem interesse ' + 'bla '.repeat(500))).toBe(false)
  })
  it('desempenho: 20.000 repetições rápidas', () => {
    const t0 = Date.now()
    for (let i = 0; i < 20000; i++) isOptOutKeyword('por favor, não tenho interesse obrigada')
    expect(Date.now() - t0).toBeLessThan(1000)
  })
})
