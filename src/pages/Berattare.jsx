import { useRef, useState } from 'react'
import { uploadRawClip } from '../lib/storage.js'
import { generateNarrationAudio } from '../lib/narrationClient.js'
import { generateMusic, refineMusicStyle } from '../lib/musicClient.js'
import { renderClip } from '../lib/shotstackClient.js'
import { fetchVideoAsFile, shareVideoFile } from '../lib/saveVideo.js'
import { useFileInputFallback } from '../lib/useFileInputFallback.js'

// Berättarläge: en fristående genväg som hoppar över HELA klippningsplan-/transkriberings-
// flödet i Klippstudio (ingen Claude-genererad plan, ingen Whisper-transkribering) — istället
// laddas en färdig video upp rakt av, en skriven berättartext omvandlas till tal
// (generate-narration.ts, OpenAIs text-till-tal) och läggs som ett eget ljudspår ovanpå HELA
// videon (narrationAudioUrl i render-clip.ts, som stänger av videons eget ljud när det här är
// aktivt). Byggs ihop till en syntetisk ETT-segment-klippningsplan (hela videons längd, ingen
// AI-uppdelning) bara för att återanvända samma /api/render-clip oförändrat.
//
// Inga undertexter i det här läget — utan ett Whisper-transkript/tidsstämplar finns inget att
// synka undertexter mot (att bränna in HELA berättartexten som en enda bildtext hade sett risigt
// ut, avsiktligt uteslutet).

const VOICE_OPTIONS = [
  { value: 'fable', label: 'Fable — berättande, varm (standard)' },
  { value: 'onyx', label: 'Onyx — djup' },
  { value: 'nova', label: 'Nova — energisk' },
  { value: 'alloy', label: 'Alloy — neutral' },
  { value: 'echo', label: 'Echo — lugn' },
  { value: 'shimmer', label: 'Shimmer — ljus' },
]

const RENDER_STATUS_LABELS = {
  queued: 'I kö…',
  fetching: 'Hämtar källvideo…',
  rendering: 'Renderar…',
  saving: 'Sparar…',
}

// Replicates normaliserade status (se musicClient.js/broll-status.ts) — annat kontrakt än
// Shotstacks RENDER_STATUS_LABELS ovan.
const MUSIC_STATUS_LABELS = {
  PENDING: 'I kö…',
  RUNNING: 'Genererar musik…',
}

function formatTimecode(totalSeconds) {
  const s = Math.max(0, Math.round(totalSeconds))
  const hh = Math.floor(s / 3600)
  const mm = Math.floor((s % 3600) / 60)
  const ss = s % 60
  const pad = (n) => String(n).padStart(2, '0')
  return hh > 0 ? `${hh}:${pad(mm)}:${pad(ss)}` : `${mm}:${pad(ss)}`
}

export default function Berattare() {
  const [videoUrl, setVideoUrl] = useState(null)
  const [videoUploading, setVideoUploading] = useState(false)
  const [videoDuration, setVideoDuration] = useState(0)
  // Motrotation (Shotstacks transform.rotate.angle, se render-clip.ts) — vissa telefon-
  // inspelade videor har en rotations-flagga som Shotstack tolkar fel, trots att videon ser
  // rätt ut i förhandsvisningen på telefonen/i <video>-elementet nedan.
  const [videoRotation, setVideoRotation] = useState(0)
  const [narrationText, setNarrationText] = useState('')
  const [voice, setVoice] = useState('fable')
  const [narrationAudioUrl, setNarrationAudioUrl] = useState(null)
  const [narrationGenerating, setNarrationGenerating] = useState(false)
  const [previewVideoUrl, setPreviewVideoUrl] = useState(null)
  const [previewRendering, setPreviewRendering] = useState(false)
  const [previewStatus, setPreviewStatus] = useState(null)
  const [renderedVideoUrl, setRenderedVideoUrl] = useState(null)
  const [rendering, setRendering] = useState(false)
  const [renderStatus, setRenderStatus] = useState(null)
  const [preparingSave, setPreparingSave] = useState(false)
  const [readyVideoFile, setReadyVideoFile] = useState(null)
  const [musicStyleIdea, setMusicStyleIdea] = useState('')
  const [musicRefinedTags, setMusicRefinedTags] = useState('')
  const [musicRefining, setMusicRefining] = useState(false)
  const [musicAudioUrl, setMusicAudioUrl] = useState(null)
  const [musicGenerating, setMusicGenerating] = useState(false)
  const [musicStatus, setMusicStatus] = useState(null)
  const videoInputRef = useRef(null)
  // Skyddsnät mot en bekräftad iOS Safari-bugg (input[type=file]'s "change" avfyras ibland
  // aldrig när man väljer från Fotobiblioteket/videobiblioteket) — se useFileInputFallback.js.
  const handleVideoUploadChange = useFileInputFallback(videoInputRef, handleVideoUpload)
  const [error, setError] = useState(null)

  async function handleVideoUpload(file) {
    if (!file) return
    setVideoUploading(true)
    setError(null)
    setPreviewVideoUrl(null)
    setRenderedVideoUrl(null)
    try {
      const publicUrl = await uploadRawClip(file)
      setVideoUrl(publicUrl)
    } catch (err) {
      setError(err.message)
    } finally {
      setVideoUploading(false)
    }
  }

  async function handleGenerateNarration() {
    if (!narrationText.trim()) return
    setNarrationGenerating(true)
    setError(null)
    try {
      const blob = await generateNarrationAudio(narrationText, voice)
      const file = new File([blob], 'narration.mp3', { type: 'audio/mpeg' })
      const publicUrl = await uploadRawClip(file)
      setNarrationAudioUrl(publicUrl)
    } catch (err) {
      setError(err.message)
    } finally {
      setNarrationGenerating(false)
    }
  }

  async function handleRefineMusicStyle() {
    if (!musicStyleIdea.trim()) return
    setMusicRefining(true)
    setError(null)
    try {
      const tags = await refineMusicStyle(musicStyleIdea)
      setMusicRefinedTags(tags)
    } catch (err) {
      setError(err.message)
    } finally {
      setMusicRefining(false)
    }
  }

  async function handleGenerateMusic() {
    if (!musicRefinedTags && !musicStyleIdea.trim()) return
    setMusicGenerating(true)
    setMusicStatus('PENDING')
    setError(null)
    try {
      const result = await generateMusic({
        styleIdea: musicStyleIdea,
        refinedTags: musicRefinedTags,
        durationSeconds: Math.round(videoDuration) || undefined,
        onStatus: setMusicStatus,
      })
      setMusicAudioUrl(result.url)
      setMusicRefinedTags(result.tags)
    } catch (err) {
      setError(err.message)
    } finally {
      setMusicGenerating(false)
    }
  }

  function buildRenderParams() {
    return {
      clips: [{ id: 'c1', url: videoUrl, transcript: [], words: [], rotation: videoRotation }],
      segmentsPlan: [{ clip_id: 'c1', start: '0:00', end: formatTimecode(videoDuration || 1) }],
      hookText: '',
      suggestedSubtitles: [],
      narrationAudioUrl,
      musicAudioUrl,
    }
  }

  async function handlePreviewRender() {
    if (!videoUrl || !narrationAudioUrl) return
    if (videoDuration <= 0) {
      setError('Videons längd kunde inte läsas — vänta tills videospelaren laddat klart och försök igen.')
      return
    }
    setPreviewRendering(true)
    setPreviewStatus('queued')
    setError(null)
    try {
      const url = await renderClip({ ...buildRenderParams(), preview: true, onStatus: setPreviewStatus })
      setPreviewVideoUrl(url)
    } catch (err) {
      setError(err.message)
    } finally {
      setPreviewRendering(false)
    }
  }

  async function handleRender() {
    if (!videoUrl || !narrationAudioUrl) return
    if (videoDuration <= 0) {
      setError('Videons längd kunde inte läsas — vänta tills videospelaren laddat klart och försök igen.')
      return
    }
    setRendering(true)
    setRenderStatus('queued')
    setError(null)
    try {
      const url = await renderClip({ ...buildRenderParams(), preview: false, onStatus: setRenderStatus })
      setRenderedVideoUrl(url)
      setReadyVideoFile(null)
    } catch (err) {
      setError(err.message)
    } finally {
      setRendering(false)
    }
  }

  async function handlePrepareSave() {
    setPreparingSave(true)
    setError(null)
    try {
      const file = await fetchVideoAsFile(renderedVideoUrl, 'berattare.mp4')
      setReadyVideoFile(file)
    } catch (err) {
      setError(err.message)
    } finally {
      setPreparingSave(false)
    }
  }

  // Synkront (inget await innan share-anropet) — se kommentaren på shareVideoFile.
  function handleShareVideo() {
    shareVideoFile(readyVideoFile).catch((err) => {
      if (err.name !== 'AbortError') {
        setError(err.message)
      }
    })
  }

  return (
    <div className="page">
      <header className="page-header">
        <h1>Berättare</h1>
      </header>

      <p className="placeholder-note">
        Ladda upp en färdig video, skriv en berättartext som läses upp ovanpå den — helt utan
        klippningsplan, transkribering eller hook-förslag. Videons eget ljud stängs av
        automatiskt så det inte krockar med berättarrösten. Inga undertexter i det här läget
        (inget transkript att synka mot).
      </p>

      {error && <p className="error-banner">{error}</p>}

      <div className="clip-card">
        <p className="clip-category">1. Video</p>
        <input
          ref={videoInputRef}
          type="file"
          accept="video/*"
          onChange={handleVideoUploadChange}
          disabled={videoUploading}
        />
        {videoUploading && <p className="clip-prompt">Laddar upp video…</p>}
        {videoUrl && (
          <video
            src={videoUrl}
            controls
            onLoadedMetadata={(e) => setVideoDuration(e.currentTarget.duration || 0)}
            style={{ width: '100%', borderRadius: 12, marginTop: 8 }}
          />
        )}
        {videoDuration > 0 && (
          <p className="clip-prompt">Längd: ca {formatTimecode(videoDuration)}</p>
        )}
        {videoUrl && (
          <label style={{ display: 'block', marginTop: 8 }}>
            Rotera videon (om den blir sidledes/upp-och-ner i renderingen)
            <select value={videoRotation} onChange={(e) => setVideoRotation(Number(e.target.value))}>
              <option value={0}>Ingen rotation</option>
              <option value={90}>90° medurs</option>
              <option value={180}>180°</option>
              <option value={-90}>90° moturs</option>
            </select>
          </label>
        )}
      </div>

      {videoUrl && (
        <div className="clip-card">
          <p className="clip-category">2. Berättartext</p>
          <textarea
            value={narrationText}
            onChange={(e) => setNarrationText(e.target.value)}
            rows={4}
            placeholder="Skriv texten som ska läsas upp ovanpå videon…"
          />
          <label style={{ display: 'block', marginTop: 8 }}>
            Röst
            <select value={voice} onChange={(e) => setVoice(e.target.value)}>
              {VOICE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </label>
          <button
            className="btn-primary"
            style={{ marginTop: 8 }}
            onClick={handleGenerateNarration}
            disabled={!narrationText.trim() || narrationGenerating}
          >
            {narrationGenerating ? 'Genererar röst…' : 'Generera berättarröst'}
          </button>
          {narrationAudioUrl && (
            <audio controls src={narrationAudioUrl} style={{ width: '100%', marginTop: 8 }} />
          )}
        </div>
      )}

      {videoUrl && narrationAudioUrl && (
        <div className="clip-card">
          <p className="clip-category">3. Bakgrundsmusik (valfritt)</p>
          {musicAudioUrl ? (
            <>
              <audio controls src={musicAudioUrl} style={{ width: '100%' }} />
              <button
                type="button"
                className="btn-primary"
                style={{ marginTop: 8 }}
                onClick={() => {
                  setMusicAudioUrl(null)
                  setMusicRefinedTags('')
                }}
              >
                Välj en annan musikstil
              </button>
            </>
          ) : (
            <>
              <label style={{ display: 'block' }}>
                Musikstil (t.ex. "mörk, spöklik stämning" eller "lugn pianomusik")
                <textarea
                  value={musicStyleIdea}
                  onChange={(e) => setMusicStyleIdea(e.target.value)}
                  rows={2}
                  placeholder="Beskriv stämningen/genren — Claude skriver om den till ett format musikmodellen förstår"
                />
              </label>
              {musicRefinedTags ? (
                <label style={{ display: 'block', marginTop: 8 }}>
                  Färdiga taggar (redigerbara, engelska)
                  <textarea value={musicRefinedTags} onChange={(e) => setMusicRefinedTags(e.target.value)} rows={2} />
                </label>
              ) : (
                <button
                  className="btn-primary"
                  style={{ marginTop: 4 }}
                  onClick={handleRefineMusicStyle}
                  disabled={musicRefining || !musicStyleIdea.trim()}
                >
                  {musicRefining ? 'Förfinar…' : 'Förfina musikstil (valfritt, förhandsgranska)'}
                </button>
              )}
              <button
                className="btn-primary"
                style={{ marginTop: 8 }}
                onClick={handleGenerateMusic}
                disabled={musicGenerating || !(musicRefinedTags || musicStyleIdea.trim())}
              >
                {musicGenerating ? MUSIC_STATUS_LABELS[musicStatus] ?? 'Genererar musik…' : 'Generera musik'}
              </button>
            </>
          )}
        </div>
      )}

      {videoUrl && narrationAudioUrl && (
        <div className="clip-card">
          <p className="clip-category">4. Rendera</p>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button className="btn-primary" onClick={handlePreviewRender} disabled={previewRendering}>
              {previewRendering
                ? RENDER_STATUS_LABELS[previewStatus] ?? 'Renderar…'
                : 'Snabb förhandsgranskning (gratis)'}
            </button>
            <button className="btn-primary" onClick={handleRender} disabled={rendering}>
              {rendering ? RENDER_STATUS_LABELS[renderStatus] ?? 'Renderar…' : 'Rendera skarpt'}
            </button>
          </div>

          {previewVideoUrl && (
            <video src={previewVideoUrl} controls style={{ width: '100%', borderRadius: 12, marginTop: 10 }} />
          )}

          {renderedVideoUrl && (
            <div style={{ marginTop: 10 }}>
              <video src={renderedVideoUrl} controls style={{ width: '100%', borderRadius: 12 }} />
              <div style={{ marginTop: 8 }}>
                {readyVideoFile ? (
                  <button className="btn-primary" onClick={handleShareVideo}>
                    Spara video till telefonen
                  </button>
                ) : (
                  <button className="btn-primary" onClick={handlePrepareSave} disabled={preparingSave}>
                    {preparingSave ? 'Förbereder…' : 'Förbered video för sparning'}
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
