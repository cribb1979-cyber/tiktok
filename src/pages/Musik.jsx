import { useState } from 'react'
import { generateMusic, refineMusicStyle } from '../lib/musicClient.js'
import { fetchVideoAsFile, shareVideoFile } from '../lib/saveVideo.js'
import { saveGeneratedContent } from '../lib/generatedContent.js'
import { useWakeLock } from '../lib/useWakeLock.js'

// Fristående genväg till musikgeneratorn i Klippstudio (generate-music.ts) — för den som bara
// vill ha en låt (egen sångtext eller instrumentalt) att spara/dela, utan att först behöva
// ladda upp ett klipp och skapa en klippningsplan (som Klippstudios "Avancerat"-flöde annars
// kräver, precis som B-roll behövde innan /broll byggdes). Samma edge function/pollning, bara
// ett annat, mycket enklare UI runt den.
const MUSIC_STATUS_LABELS = {
  PENDING: 'I kö…',
  RUNNING: 'Genererar musik…',
}

const DURATION_OPTIONS = [
  { value: 30, label: '30 sekunder' },
  { value: 60, label: '1 minut' },
  { value: 120, label: '2 minuter' },
  { value: 180, label: '3 minuter' },
  { value: 240, label: '4 minuter (max)' },
]

export default function Musik() {
  const [styleIdea, setStyleIdea] = useState('')
  const [refinedTags, setRefinedTags] = useState('')
  const [refining, setRefining] = useState(false)
  const [lyrics, setLyrics] = useState('')
  const [durationSeconds, setDurationSeconds] = useState(60)
  const [audioUrl, setAudioUrl] = useState(null)
  const [tags, setTags] = useState(null)
  const [generating, setGenerating] = useState(false)
  const [status, setStatus] = useState(null)
  const [error, setError] = useState(null)
  const [preparingSave, setPreparingSave] = useState(false)
  const [readyFile, setReadyFile] = useState(null)

  // Håller skärmen tänd under generering (se useWakeLock.js) — annars kan skärmen
  // självslockna av inaktivitet och avbryta pollningsloopen mitt i.
  useWakeLock(refining || generating)

  function reset() {
    setAudioUrl(null)
    setTags(null)
    setRefinedTags('')
    setReadyFile(null)
    setError(null)
  }

  async function handleRefine() {
    if (!styleIdea.trim()) return
    setRefining(true)
    setError(null)
    try {
      const result = await refineMusicStyle(styleIdea)
      setRefinedTags(result)
    } catch (err) {
      setError(err.message)
    } finally {
      setRefining(false)
    }
  }

  async function handleGenerate() {
    if (!refinedTags && !styleIdea.trim()) return
    setGenerating(true)
    setStatus('PENDING')
    setError(null)
    try {
      const result = await generateMusic({
        styleIdea,
        refinedTags,
        lyrics,
        durationSeconds,
        onStatus: setStatus,
      })
      setAudioUrl(result.url)
      setTags(result.tags)
      saveGeneratedContent({
        kind: 'music',
        prompt: styleIdea,
        metadata: { tags: result.tags, lyrics },
        mediaUrl: result.url,
      })
    } catch (err) {
      setError(err.message)
    } finally {
      setGenerating(false)
    }
  }

  async function handlePrepareSave() {
    setPreparingSave(true)
    setError(null)
    try {
      const file = await fetchVideoAsFile(audioUrl, 'musik.mp3')
      setReadyFile(file)
    } catch (err) {
      setError(err.message)
    } finally {
      setPreparingSave(false)
    }
  }

  // Synkront (inget await innan share-anropet) — se kommentaren på shareVideoFile.
  function handleShare() {
    shareVideoFile(readyFile).catch((err) => {
      if (err.name !== 'AbortError') {
        setError(err.message)
      }
    })
  }

  return (
    <div className="page">
      <header className="page-header">
        <h1>Musik</h1>
      </header>

      <p className="placeholder-note">
        Skapa en fristående AI-låt (egen sångtext eller rent instrumentalt) att spara och
        använda var du vill. Ingen uppladdning, inget klipp, ingen klippningsplan — bara en
        idé för stilen. Samma generator som "AI-genererad bakgrundsmusik" i Klippstudio.
      </p>

      <div className="clip-card">
        {audioUrl ? (
          <>
            <audio controls src={audioUrl} style={{ width: '100%' }} />
            {tags && <p className="clip-prompt">Taggar: {tags}</p>}
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
              {readyFile ? (
                <button className="btn-primary" onClick={handleShare}>
                  Spara musik till telefonen
                </button>
              ) : (
                <button className="btn-primary" onClick={handlePrepareSave} disabled={preparingSave}>
                  {preparingSave ? 'Förbereder…' : 'Förbered för sparning'}
                </button>
              )}
              <button className="btn-primary" onClick={reset}>
                Skapa en till
              </button>
            </div>
          </>
        ) : (
          <>
            <label style={{ display: 'block' }}>
              Musikstil (t.ex. "mörk, spöklik stämning" eller "lugn pianomusik")
              <textarea
                value={styleIdea}
                onChange={(e) => setStyleIdea(e.target.value)}
                rows={2}
                placeholder="Beskriv stämningen/genren — Claude skriver om den till ett format musikmodellen förstår"
              />
            </label>
            {refinedTags ? (
              <label style={{ display: 'block', marginTop: 8 }}>
                Färdiga taggar (redigerbara, engelska)
                <textarea value={refinedTags} onChange={(e) => setRefinedTags(e.target.value)} rows={2} />
              </label>
            ) : (
              <button className="btn-primary" style={{ marginTop: 4 }} onClick={handleRefine} disabled={refining || !styleIdea.trim()}>
                {refining ? 'Förfinar…' : 'Förfina musikstil (valfritt, förhandsgranska)'}
              </button>
            )}
            <label style={{ display: 'block', marginTop: 8 }}>
              Egen sångtext (valfritt — lämna tomt för rent instrumental musik)
              <textarea
                value={lyrics}
                onChange={(e) => setLyrics(e.target.value)}
                rows={4}
                placeholder={'[Verse]\nDin egen text här…\n[Chorus]\n...'}
              />
            </label>
            <label style={{ display: 'block', marginTop: 8 }}>
              Längd
              <select value={durationSeconds} onChange={(e) => setDurationSeconds(Number(e.target.value))}>
                {DURATION_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </label>
            <button
              className="btn-primary"
              style={{ marginTop: 8 }}
              onClick={handleGenerate}
              disabled={generating || !(refinedTags || styleIdea.trim())}
            >
              {generating ? MUSIC_STATUS_LABELS[status] ?? 'Genererar…' : 'Generera musik'}
            </button>
          </>
        )}
      </div>

      {error && <p className="error-banner">{error}</p>}
    </div>
  )
}
