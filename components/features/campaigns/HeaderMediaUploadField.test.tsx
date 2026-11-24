import React from 'react'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { HeaderMediaUploadField, getTemplateHeaderMediaFormat } from './HeaderMediaUploadField'

describe('getTemplateHeaderMediaFormat', () => {
  it('detecta imagem e vídeo no cabeçalho', () => {
    expect(getTemplateHeaderMediaFormat({ components: [{ type: 'HEADER', format: 'IMAGE' }] } as any)).toBe('IMAGE')
    expect(getTemplateHeaderMediaFormat({ components: [{ type: 'header', format: 'video' }] } as any)).toBe('VIDEO')
  })
  it('ignora texto, localização, documento e modelos sem cabeçalho', () => {
    expect(getTemplateHeaderMediaFormat({ components: [{ type: 'HEADER', format: 'TEXT' }] } as any)).toBeNull()
    expect(getTemplateHeaderMediaFormat({ components: [{ type: 'HEADER', format: 'LOCATION' }] } as any)).toBeNull()
    expect(getTemplateHeaderMediaFormat({ components: [{ type: 'BODY' }] } as any)).toBeNull()
    expect(getTemplateHeaderMediaFormat(null)).toBeNull()
  })
})

describe('HeaderMediaUploadField', () => {
  beforeEach(() => vi.unstubAllGlobals())

  function pick(file: File) {
    const input = document.querySelector('input[type="file"]') as HTMLInputElement
    fireEvent.change(input, { target: { files: [file] } })
  }

  it('mostra o campo opcional com as regras do formato', () => {
    render(<HeaderMediaUploadField format="IMAGE" value={null} fileName={null} onChange={() => {}} />)
    expect(screen.getByText('Enviar com este arquivo')).toBeTruthy()
    expect(screen.getByText(/Máximo: 5 MB/)).toBeTruthy()
  })

  it('recusa arquivo inválido sem chamar a rede', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    render(<HeaderMediaUploadField format="IMAGE" value={null} fileName={null} onChange={() => {}} />)
    pick(new File([new Uint8Array(10)], 'a.pdf', { type: 'application/pdf' }))
    await screen.findByText(/Tipo de arquivo inválido/)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('faz upload e devolve o media id', async () => {
    const onChange = vi.fn()
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ ok: true, mediaId: 'm1', fileName: 'a.png' }) })))
    render(<HeaderMediaUploadField format="IMAGE" value={null} fileName={null} onChange={onChange} />)
    pick(new File([new Uint8Array(10)], 'a.png', { type: 'image/png' }))
    await waitFor(() => expect(onChange).toHaveBeenCalledWith('m1', 'a.png'))
  })

  it('mostra erro do servidor', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, json: async () => ({ error: 'Falha na Meta' }) })))
    render(<HeaderMediaUploadField format="IMAGE" value={null} fileName={null} onChange={() => {}} />)
    pick(new File([new Uint8Array(10)], 'a.png', { type: 'image/png' }))
    await screen.findByText('Falha na Meta')
  })

  it('com arquivo enviado mostra o nome e permite remover', () => {
    const onChange = vi.fn()
    render(<HeaderMediaUploadField format="VIDEO" value="m1" fileName="v.mp4" onChange={onChange} />)
    expect(screen.getByText('v.mp4')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /Remover/ }))
    expect(onChange).toHaveBeenCalledWith(null, null)
  })
})
