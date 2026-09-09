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

const RECORDER_MIME_CANDIDATES = ['audio/mp4', 'video/mp4', 'audio/webm', 'video/webm']

// Fallback när decodeAudioData inte kan packa upp ljudet (vanligt för HEVC/.mov från
// iPhone — WebKit stödjer inte alltid att extrahera ljudspår ur videocontainrar den vägen,
// även om videon spelar upp fint). Spelar upp videon osynligt och spelar in den på nytt med
// MediaRecorder — samma teknik som används för videosamtal i webbläsaren — vilket ger en
// riktig, nykodad fil i ett format Whisper förstår. Tar lika lång tid som klippets längd
// eftersom uppspelningen sker i realtid.
export async function reencodeViaMediaRecorder(file) {
  if (typeof MediaRecorder === 'undefined') {
    throw new Error('MediaRecorder stöds inte i den här webbläsaren.')
  }

  const mimeType = RECORDER_MIME_CANDIDATES.find((t) => MediaRecorder.isTypeSupported(t))
  if (!mimeType) {
    throw new Error('Inget känt inspelningsformat stöds av den här webbläsaren.')
  }

  const url = URL.createObjectURL(file)
  const video = document.createElement('video')
  video.src = url
  video.playsInline = true
  video.volume = 0
  video.style.position = 'fixed'
  video.style.top = '-9999px'
  document.body.appendChild(video)

  try {
    await new Promise((resolve, reject) => {
      video.onloadedmetadata = resolve
      video.onerror = () => reject(new Error('Kunde inte läsa videometadata.'))
    })

    const stream = video.captureStream ? video.captureStream() : video.mozCaptureStream?.()
    if (!stream) {
      throw new Error('captureStream stöds inte i den här webbläsaren.')
    }

    const recorder = new MediaRecorder(stream, { mimeType })
    const chunks = []
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.push(e.data)
    }

    const recordingDone = new Promise((resolve, reject) => {
      recorder.onstop = resolve
      recorder.onerror = (e) => reject(e.error || new Error('Inspelningsfel.'))
    })

    recorder.start()
    await video.play()
    await new Promise((resolve) => {
      video.onended = resolve
    })
    recorder.stop()
    await recordingDone

    const ext = mimeType.includes('mp4') ? 'mp4' : 'webm'
    const outName = (file.name || 'upload').replace(/\.[^.]+$/, '') + '.' + ext
    return new File(chunks, outName, { type: mimeType })
  } finally {
    video.remove()
    URL.revokeObjectURL(url)
  }
}
