import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

import { flowsService } from './flowsService'

import { createMockFetchResponse, setupFetchMock } from '@/tests/helpers'

const baseFlow = {
  id: 'f1',
  name: 'Flow 1',
  status: 'active',
  meta_flow_id: null,
  spec: { nodes: [] },
  created_at: '2024-01-01',
  updated_at: null,
}

describe('flowsService', () => {
  const mockFetch = setupFetchMock()

  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.resetAllMocks()
  })

  it('list deve filtrar itens inválidos', async () => {
    mockFetch.mockResolvedValueOnce(createMockFetchResponse([baseFlow, { id: 123 }]))

    const result = await flowsService.list()

    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('f1')
  })

  it('create deve retornar flow válido', async () => {
    mockFetch.mockResolvedValueOnce(createMockFetchResponse(baseFlow))

    const result = await flowsService.create({ name: 'novo' })

    expect(result.id).toBe('f1')
  })

  it('get deve retornar flow válido', async () => {
    mockFetch.mockResolvedValueOnce(createMockFetchResponse(baseFlow))

    const result = await flowsService.get('f1')

    expect(result.name).toBe('Flow 1')
  })

  it('create deve lançar erro se resposta inválida', async () => {
    mockFetch.mockResolvedValueOnce(createMockFetchResponse({ id: 'x' }))

    await expect(flowsService.create({ name: 'novo' })).rejects.toThrow('Resposta inválida')
  })

  it('update deve propagar erro do servidor', async () => {
    mockFetch.mockResolvedValueOnce(createMockFetchResponse({ error: 'Falha', details: 'x' }, { ok: false }))

    await expect(flowsService.update('f1', { name: 'n' })).rejects.toThrow('Falha')
  })

  it('publishToMeta deve incluir detalhes do graphError', async () => {
    mockFetch.mockResolvedValueOnce(createMockFetchResponse({
      error: 'Erro',
      debug: {
        graphError: {
          error_user_title: 'Título',
          error_user_msg: 'Mensagem',
        },
      },
    }, { ok: false }))

    await expect(flowsService.publishToMeta('f1')).rejects.toThrow('Erro: Título — Mensagem')
  })

  it('publishToMeta deve incluir a solução do health status em bloqueios de integridade', async () => {
    mockFetch.mockResolvedValueOnce(createMockFetchResponse({
      error: 'A Meta criou o MiniApp como rascunho, mas bloqueou a publicação por integridade da conta.',
      metaIssues: [
        {
          entityType: 'BUSINESS',
          errorCode: 141010,
          description: 'A empresa não concluiu a verificação.',
          possibleSolution: 'Conclua a verificação da empresa no Meta Business Manager.',
        },
      ],
    }, { ok: false }))

    await expect(flowsService.publishToMeta('f1')).rejects.toThrow(
      'Conclua a verificação da empresa no Meta Business Manager.'
    )
  })

  it('send deve lançar erro quando API falha', async () => {
    mockFetch.mockResolvedValueOnce(createMockFetchResponse({ error: 'Falhou' }, { ok: false }))

    await expect(flowsService.send({ to: '1', flowId: 'f', flowToken: 't' })).rejects.toThrow('Falhou')
  })

  it('generateForm deve exigir form no payload', async () => {
    mockFetch.mockResolvedValueOnce(createMockFetchResponse({} as any))

    await expect(flowsService.generateForm({ prompt: 'teste' })).rejects.toThrow('form ausente')
  })
})
