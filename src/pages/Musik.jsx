import { useState } from 'react'
import { generateMusic, refineMusicStyle, suggestMusicIdea } from '../lib/musicClient.js'
import { fetchVideoAsFile, shareVideoFile } from '../lib/saveVideo.js'
import { saveGeneratedContent } from '../lib/generatedContent.js'
import { useWakeLock } from '../lib/useWakeLock.js'

// Fristående genväg till musikgeneratorn i Klippstudio (generate-music.ts) — för den som bara
// vill ha en låt att spara/dela, utan att först behöva ladda upp ett klipp och skapa en
// klippningsplan (som Klippstudios "Avancerat"-flöde annars kräver, precis som B-roll behövde
// innan /broll byggdes). Samma edge function/pollning, bara ett annat, mycket enklare UI runt
// den.
const MUSIC_STATUS_LABELS = {
  PENDING: 'I kö…',
  RUNNING: 'Genererar musik…',
}

// minimax/music-1.5 (se generate-music.ts) har inget duration-fält — låtlängden styrs av hur
// mycket text som skrivs i lyrics, inget separat reglage längre (till skillnad från ACE-Step
// tidigare, som i praktiken ändå ignorerade det värdet).
const LYRICS_MIN_LENGTH = 10
const LYRICS_MAX_LENGTH = 600

export default function Musik() {
  const [theme, setTheme] = useState('')
  const [suggesting, setSuggesting] = useState(false)
  const [styleIdea, setStyleIdea] = useState('')
  const [refinedTags, setRefinedTags] = useState('')
  const [refining, setRefining] = useState(false)
  const [lyrics, setLyrics] = useState('')
  const [audioUrl, setAudioUrl] = useState(null)
  const [tags, setTags] = useState(null)
  const [generating, setGenerating] = useState(false)
  const [status, setStatus] = useState(null)
  const [error, setError] = useState(null)
  const [preparingSave, setPreparingSave] = useState(false)
  const [readyFile, setReadyFile] = useState(null)

  // Håller skärmen tänd under generering (se useWakeLock.js) — annars kan skärmen
  // självslockna av inaktivitet och avbryta pollningsloopen mitt i.
  useWakeLock(refining || generating || suggesting)

  // AI-förslag: föreslår BÅDE musikstil och sångtext utifrån ett fritt tema (t.ex. "sommarkärlek"
  // eller "uppbrott och nya början") — samma underliggande förslag som Klippstudios
  // "AI-förslag utifrån klippet", men med ett fritt tema istället för klippets kategori/hook
  // som kontext, eftersom den här sidan inte har något klipp att utgå från.
  async function handleSuggest() {
    setSuggesting(true)
    setError(null)
    try {
      const context = theme.trim() || 'Valfritt, överraska med ett kreativt tema.'
      const suggestion = await suggestMusicIdea(context)
      setStyleIdea(suggestion.styleIdea)
      setRefinedTags('')
      setLyrics(suggestion.lyrics)
    } catch (err) {
      setError(err.message)
    } finally {
      setSuggesting(false)
    }
  }

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
    const lyricsLength = lyrics.trim().length
    if ((!refinedTags && !styleIdea.trim()) || lyricsLength < LYRICS_MIN_LENGTH || lyricsLength > LYRICS_MAX_LENGTH) {
      return
    }
    setGenerating(true)
    setStatus('PENDING')
    setError(null)
    try {
      const result = await generateMusic({
        styleIdea,
        refinedTags,
        lyrics,
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
        Skapa en fristående AI-låt med egen sångtext att spara och använda var du vill. Ingen
        uppladdning, inget klipp, ingen klippningsplan — bara en idé för stilen plus sångtext.
        Samma generator som "AI-genererad bakgrundsmusik" i Klippstudio. Musikmodellen kräver
        riktig sångtext (10–600 tecken) — inget renodlat instrumental-läge, och låtens längd
        styrs av hur mycket text du skriver, inget separat längdval.
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
              Tema (valfritt — t.ex. "sommarkärlek" eller "uppbrott och nya början")
              <input
                type="text"
                value={theme}
                onChange={(e) => setTheme(e.target.value)}
                placeholder="Lämna tomt för ett överraskningsförslag"
              />
            </label>
            <button
              type="button"
              className="btn-primary"
              style={{ marginTop: 4 }}
              onClick={handleSuggest}
              disabled={suggesting}
            >
              {suggesting ? 'Tar fram förslag…' : 'AI-förslag (stil + sångtext)'}
            </button>
            <label style={{ display: 'block', marginTop: 12 }}>
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
              Egen sångtext (krävs — 10–600 tecken, stödjer [Verse]/[Chorus]/[Bridge])
              <textarea
                value={lyrics}
                onChange={(e) => setLyrics(e.target.value)}
                rows={4}
                maxLength={LYRICS_MAX_LENGTH}
                placeholder={'[Verse]\nDin egen text här…\n[Chorus]\n...'}
              />
              <span
                className="clip-prompt"
                style={{ display: 'block', color: lyrics.trim().length < LYRICS_MIN_LENGTH ? '#b91c1c' : undefined }}
              >
                {lyrics.trim().length}/{LYRICS_MAX_LENGTH} tecken (minst {LYRICS_MIN_LENGTH})
              </span>
            </label>
            <button
              className="btn-primary"
              style={{ marginTop: 8 }}
              onClick={handleGenerate}
              disabled={
                generating ||
                !(refinedTags || styleIdea.trim()) ||
                lyrics.trim().length < LYRICS_MIN_LENGTH ||
                lyrics.trim().length > LYRICS_MAX_LENGTH
              }
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
