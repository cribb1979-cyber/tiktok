// Whisper-endpointen avvisar .mov (kräver flac/m4a/mp3/mp4/mpeg/mpga/oga/ogg/wav/webm) —
// OpenAI validerar den faktiska containern, så att bara byta filändelse/mime-typ räcker
// inte. Vi extraherar därför ljudspåret client-side (Web Audio API, inga externa
// bibliotek) och skickar det som WAV istället. Källvideon laddas fortfarande upp oförändrad
// till Supabase Storage för Shotstack-rendering — bara transkriberingen använder WAV:en.
export async function extractAudioAsWav(file) {
  const arrayBuffer = await file.arrayBuffer()
  const AudioContextCtor = window.AudioContext || window.webkitAudioContext
  const decodeCtx = new AudioContextCtor()

  let decoded
  try {
    decoded = await decodeCtx.decodeAudioData(arrayBuffer)
  } finally {
    decodeCtx.close()
  }

  // Ner till 16 kHz mono — Whisper jobbar internt i 16 kHz, och det håller filstorleken
  // långt under 25 MB-gränsen även för längre råmaterial.
  const targetSampleRate = 16000
  const offlineCtx = new OfflineAudioContext(
    1,
    Math.ceil(decoded.duration * targetSampleRate),
    targetSampleRate
  )
  const source = offlineCtx.createBufferSource()
  source.buffer = decoded
  source.connect(offlineCtx.destination)
  source.start()
  const rendered = await offlineCtx.startRendering()

  const wavBlob = encodeWav(rendered)
  const wavName = (file.name || 'upload').replace(/\.[^.]+$/, '') + '.wav'
  return new File([wavBlob], wavName, { type: 'audio/wav' })
}

function encodeWav(audioBuffer) {
  const numChannels = audioBuffer.numberOfChannels
  const sampleRate = audioBuffer.sampleRate
  const samples = audioBuffer.getChannelData(0)

  const bytesPerSample = 2
  const blockAlign = numChannels * bytesPerSample
  const dataSize = samples.length * bytesPerSample
  const buffer = new ArrayBuffer(44 + dataSize)
  const view = new DataView(buffer)

  writeString(view, 0, 'RIFF')
  view.setUint32(4, 36 + dataSize, true)
  writeString(view, 8, 'WAVE')
  writeString(view, 12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true) // PCM
  view.setUint16(22, numChannels, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * blockAlign, true)
  view.setUint16(32, blockAlign, true)
  view.setUint16(34, bytesPerSample * 8, true)
  writeString(view, 36, 'data')
  view.setUint32(40, dataSize, true)

  let offset = 44
  for (let i = 0; i < samples.length; i++, offset += 2) {
    const s = Math.max(-1, Math.min(1, samples[i]))
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true)
  }

  return new Blob([buffer], { type: 'audio/wav' })
}

function writeString(view, offset, str) {
  for (let i = 0; i < str.length; i++) {
    view.setUint8(offset + i, str.charCodeAt(i))
  }
}
