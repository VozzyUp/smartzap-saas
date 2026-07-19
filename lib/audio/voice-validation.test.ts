import { describe, expect, it } from 'vitest'
import { validateOggOpusVoice } from './voice-validation'

function oggOpus(channels = 1): Buffer {
  const segmentCount = 1
  const packet = Buffer.from([
    ...Buffer.from('OpusHead'),
    1, // version
    channels,
    0, 0, // pre-skip
    0x80, 0xbb, 0x00, 0x00, // input sample rate: 48 kHz (little endian)
    0, 0, // output gain
    0, // channel mapping family
  ])
  const header = Buffer.alloc(27 + segmentCount)
  header.write('OggS', 0, 'ascii')
  header[26] = segmentCount
  header[27] = packet.length
  return Buffer.concat([header, packet])
}

describe('validateOggOpusVoice', () => {
  it('aceita um contêiner OGG com cabeçalho Opus mono', () => {
    expect(validateOggOpusVoice(oggOpus())).toEqual({ valid: true })
  })

  it('rejeita áudio que não é um contêiner OGG/Opus', () => {
    expect(validateOggOpusVoice(Buffer.from('not-audio'))).toEqual({
      valid: false,
      reason: 'missing_ogg_opus_header',
    })
  })

  it('rejeita OGG/Opus estéreo para nota de voz', () => {
    expect(validateOggOpusVoice(oggOpus(2))).toEqual({
      valid: false,
      reason: 'not_mono',
    })
  })
})
