import { spawn } from 'child_process'

export interface RemuxResult {
  buffer: Buffer
  mime: string
  remuxed: boolean
}

const REMUX_TIMEOUT_MS = 15_000
// O codec faz parte do MIME exigido no upload da nota de voz para a Meta.
const TARGET_MIME = 'audio/ogg; codecs=opus'

/**
 * Normaliza áudio para o formato de NOTA DE VOZ do WhatsApp: OGG/Opus **mono**,
 * 48kHz, perfil `voip`. É esse formato que o WhatsApp renderiza como nota de voz
 * tocável (PTT); Opus estéreo ou com params fora do padrão chega como um arquivo
 * de áudio que o destinatário não consegue reproduzir.
 *
 * IMPORTANTE: normaliza SEMPRE (via ffmpeg), inclusive quando o input já é
 * `audio/ogg` — o navegador (ex.: Firefox) pode gravar ogg estéreo/não-compatível.
 *
 * Fail-safe: NUNCA rejeita. Qualquer falha (ffmpeg ausente, exit code != 0,
 * timeout) degrada para o buffer/mime originais com `remuxed: false` — se o
 * original já for ogg, ainda envia (só não normalizado); se for webm, a whitelist
 * da rota rejeita como antes.
 */
export async function remuxToOggOpus(input: Buffer, inputMime: string): Promise<RemuxResult> {
  return new Promise<RemuxResult>((resolve) => {
    let settled = false
    const fallback = (reason: string) => {
      if (settled) return
      settled = true
      console.warn(`[voice-remux] fallback para áudio original: ${reason}`)
      resolve({ buffer: input, mime: inputMime, remuxed: false })
    }

    let child: ReturnType<typeof spawn>
    try {
      // Nota de voz do WhatsApp: Opus mono (-ac 1), 48kHz (-ar 48000), perfil voip.
      child = spawn('ffmpeg', [
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
        // Alguns clientes do WhatsApp recusam OGG/Opus cujo encoder preserva
        // PTS negativo do WebM. Normalizamos a primeira amostra e a saída.
        '-af',
        'aresample=async=1:first_pts=0',
        '-avoid_negative_ts',
        'make_zero',
        '-f',
        'ogg',
        'pipe:1',
      ])
    } catch (err) {
      fallback(`spawn lançou exceção: ${(err as Error)?.message ?? err}`)
      return
    }

    const chunks: Buffer[] = []

    const timer = setTimeout(() => {
      fallback('timeout de remux excedido')
      try {
        child.kill('SIGKILL')
      } catch {
        // ignore
      }
    }, REMUX_TIMEOUT_MS)

    child.stdin?.on('error', () => {
      // EPIPE etc. quando o ffmpeg morre antes de consumir stdin — ignorar,
      // o desfecho é tratado por 'error'/'close' do processo.
    })

    child.stdout?.on('data', (chunk: Buffer) => {
      chunks.push(chunk)
    })

    child.on('error', (err) => {
      clearTimeout(timer)
      fallback(`erro ao executar ffmpeg (${err?.message ?? err})`)
    })

    child.on('close', (code) => {
      clearTimeout(timer)
      if (settled) return
      if (code === 0) {
        const output = Buffer.concat(chunks)
        if (output.length > 0) {
          settled = true
          resolve({ buffer: output, mime: TARGET_MIME, remuxed: true })
          return
        }
        fallback('ffmpeg retornou saída vazia')
        return
      }
      fallback(`ffmpeg saiu com código ${code}`)
    })

    try {
      child.stdin?.write(input)
      child.stdin?.end()
    } catch (err) {
      fallback(`erro ao escrever no stdin do ffmpeg: ${(err as Error)?.message ?? err}`)
    }
  })
}
