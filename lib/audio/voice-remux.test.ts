import { describe, it, expect, vi, beforeEach } from 'vitest'
import { EventEmitter } from 'events'
import { spawn } from 'child_process'
import { remuxToOggOpus } from './voice-remux'

vi.mock('child_process', () => {
  const spawnMock = vi.fn()
  return {
    spawn: spawnMock,
    default: { spawn: spawnMock },
  }
})

function createFakeChild() {
  const child = new EventEmitter() as EventEmitter & {
    stdin: { write: ReturnType<typeof vi.fn>; end: ReturnType<typeof vi.fn>; on: ReturnType<typeof vi.fn> }
    stdout: EventEmitter
    kill: ReturnType<typeof vi.fn>
  }
  child.stdin = {
    write: vi.fn(),
    end: vi.fn(),
    on: vi.fn(),
  }
  child.stdout = new EventEmitter()
  child.kill = vi.fn()
  return child
}

describe('remuxToOggOpus', () => {
  beforeEach(() => {
    vi.mocked(spawn).mockReset()
  })

  // Formato de nota de voz do WhatsApp: Opus mono, 48kHz, perfil voip.
  const VOICE_ARGS = [
    '-hide_banner',
    '-loglevel',
    'error',
    '-i',
    'pipe:0',
    '-vn',
    '-ac',
    '1',
    '-ar',
    '48000',
    '-c:a',
    'libopus',
    '-b:a',
    '32k',
    '-application',
    'voip',
    '-af',
    'aresample=async=1:first_pts=0',
    '-avoid_negative_ts',
    'make_zero',
    '-f',
    'ogg',
    'pipe:1',
  ]

  it('input audio/ogg (ex.: Firefox): TAMBÉM normaliza via ffmpeg (mono/48k), não pula', async () => {
    const fakeChild = createFakeChild()
    vi.mocked(spawn).mockReturnValue(fakeChild as any)

    const input = Buffer.from('ogg-estereo-original')
    const promise = remuxToOggOpus(input, 'audio/ogg')

    const outputChunk = Buffer.from('ogg-mono-normalizado')
    queueMicrotask(() => {
      fakeChild.stdout.emit('data', outputChunk)
      fakeChild.emit('close', 0)
    })

    const result = await promise
    expect(spawn).toHaveBeenCalledWith('ffmpeg', VOICE_ARGS)
    expect(result).toEqual({
      buffer: outputChunk,
      mime: 'audio/ogg; codecs=opus',
      remuxed: true,
    })
  })

  it('input audio/webm com sucesso: chama ffmpeg com os args de voz e retorna ogg remuxado', async () => {
    const fakeChild = createFakeChild()
    vi.mocked(spawn).mockReturnValue(fakeChild as any)

    const input = Buffer.from('webm-bytes')
    const promise = remuxToOggOpus(input, 'audio/webm')

    const outputChunk = Buffer.from('ogg-remuxed-bytes')
    queueMicrotask(() => {
      fakeChild.stdout.emit('data', outputChunk)
      fakeChild.emit('close', 0)
    })

    const result = await promise

    expect(spawn).toHaveBeenCalledWith('ffmpeg', VOICE_ARGS)
    expect(fakeChild.stdin.write).toHaveBeenCalledWith(input)
    expect(fakeChild.stdin.end).toHaveBeenCalled()
    expect(result).toEqual({
      buffer: outputChunk,
      mime: 'audio/ogg; codecs=opus',
      remuxed: true,
    })
  })

  it('ffmpeg ausente (erro ENOENT): degrada para o áudio original sem lançar', async () => {
    const fakeChild = createFakeChild()
    vi.mocked(spawn).mockReturnValue(fakeChild as any)

    const input = Buffer.from('webm-bytes')
    const promise = remuxToOggOpus(input, 'audio/webm')

    queueMicrotask(() => {
      const err = Object.assign(new Error('spawn ffmpeg ENOENT'), { code: 'ENOENT' })
      fakeChild.emit('error', err)
    })

    const result = await promise
    expect(result).toEqual({ buffer: input, mime: 'audio/webm', remuxed: false })
  })

  it('ffmpeg sai com código != 0: degrada para o áudio original sem lançar', async () => {
    const fakeChild = createFakeChild()
    vi.mocked(spawn).mockReturnValue(fakeChild as any)

    const input = Buffer.from('webm-bytes')
    const promise = remuxToOggOpus(input, 'audio/webm')

    queueMicrotask(() => {
      fakeChild.emit('close', 1)
    })

    const result = await promise
    expect(result).toEqual({ buffer: input, mime: 'audio/webm', remuxed: false })
  })
})
