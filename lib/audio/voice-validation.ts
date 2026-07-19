export type VoiceValidationResult =
  | { valid: true }
  | { valid: false; reason: 'missing_ogg_opus_header' | 'not_mono' }

/**
 * Verifica o cabeçalho do contêiner gerado para uma nota de voz WhatsApp.
 * A validação é propositalmente leve: confirma Ogg + OpusHead + um canal,
 * sem tentar decodificar o áudio durante a requisição HTTP.
 */
export function validateOggOpusVoice(buffer: Buffer): VoiceValidationResult {
  if (buffer.length < 38 || buffer.subarray(0, 4).toString('ascii') !== 'OggS') {
    return { valid: false, reason: 'missing_ogg_opus_header' }
  }

  const pageSegments = buffer[26]
  const opusHeaderOffset = 27 + pageSegments
  if (
    buffer.length < opusHeaderOffset + 10 ||
    buffer.subarray(opusHeaderOffset, opusHeaderOffset + 8).toString('ascii') !== 'OpusHead'
  ) {
    return { valid: false, reason: 'missing_ogg_opus_header' }
  }

  return buffer[opusHeaderOffset + 9] === 1
    ? { valid: true }
    : { valid: false, reason: 'not_mono' }
}
