import { useState } from 'react'
import { generateBroll, refineBrollPrompt } from '../lib/replicateClient.js'
import { fetchVideoAsFile, shareVideoFile } from '../lib/saveVideo.js'

// Fristående genväg till B-roll-generatorn i Klippstudio (generate-broll.ts) — för den som
// bara vill ha en atmosfärisk stämningsvideo att spara/dela, utan att behöva ladda upp ett
// eget klipp eller göra en hel klippningsplan först (som Klippstudios "Avancerat"-flöde
// annars kräver, se README "AI-genererad B-roll"). Samma edge function/pollning, bara ett
// annat, mycket enklare UI runt den — inget category/subtopic/hookText att skicka med, temat
// är helt valfritt (se generate-broll.ts, kravet på ett ifyllt tema togs bort för att just
// det här verktyget saknar dem helt).
const BROLL_STATUS_LABELS = {
  PENDING: 'I kö…',
  RUNNING: 'Genererar video…',
}

export default function Broll() {
  const [customPrompt, setCustomPrompt] = useState('')
  const [allowFigures, setAllowFigures] = useState(false)
  const [refinedPrompt, setRefinedPrompt] = useState('')
  const [refining, setRefining] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [status, setStatus] = useState(null)
  const [videoUrl, setVideoUrl] = useState(null)
  const [prompt, setPrompt] = useState(null)
  const [error, setError] = useState(null)
  const [preparingSave, setPreparingSave] = useState(false)
  const [readyVideoFile, setReadyVideoFile] = useState(null)

  function reset() {
    setVideoUrl(null)
    setPrompt(null)
    setRefinedPrompt('')
    setReadyVideoFile(null)
    setError(null)
  }

  async function handleRefine() {
    setRefining(true)
    setError(null)
    try {
      const refined = await refineBrollPrompt({
        customPrompt,
        allowIllustrativeFigures: allowFigures,
      })
      setRefinedPrompt(refined)
    } catch (err) {
      setError(err.message)
    } finally {
      setRefining(false)
    }
  }

  async function handleGenerate() {
    setGenerating(true)
    setStatus('PENDING')
    setError(null)
    setReadyVideoFile(null)
    try {
      const result = await generateBroll({
        customPrompt,
        allowIllustrativeFigures: allowFigures,
        refinedPrompt,
        onStatus: setStatus,
      })
      setVideoUrl(result.url)
      setPrompt(result.prompt)
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
      const file = await fetchVideoAsFile(videoUrl, 'broll.mp4')
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
        <h1>B-roll</h1>
      </header>

      <p className="placeholder-note">
        Skapa en fristående, atmosfärisk B-roll-video (natur, ljus, rök, stämning — aldrig
        personer som standard) att spara och använda var du vill. Ingen uppladdning, ingen
        klippningsplan — bara en idé (eller inte ens det). Samma generator som "AI-genererad
        B-roll" i Klippstudio, taggas som AI-genererat innehåll om du delar den.
      </p>

      <div className="clip-card">
        {videoUrl ? (
          <>
            <video src={videoUrl} controls style={{ width: '100%', borderRadius: 12 }} />
            {prompt && <p className="clip-prompt">Prompt: {prompt}</p>}
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
              {readyVideoFile ? (
                <button className="btn-primary" onClick={handleShareVideo}>
                  Spara video till telefonen
                </button>
              ) : (
                <button className="btn-primary" onClick={handlePrepareSave} disabled={preparingSave}>
                  {preparingSave ? 'Förbereder…' : 'Förbered video för sparning'}
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
              Egen idé (valfritt)
              <textarea
                value={customPrompt}
                onChange={(e) => setCustomPrompt(e.target.value)}
                rows={2}
                placeholder="T.ex. regn mot ett fönster, neonljus i vattenpölar — lämna tomt för ett generiskt, atmosfäriskt förslag"
              />
            </label>
            <p className="placeholder-note">
              Din text går via Claude, som skriver om den till en bildprompt utan personer —
              samma person-skydd som i Klippstudio.
            </p>
            <label style={{ display: 'flex', alignItems: 'flex-start', gap: 10, cursor: 'pointer', marginTop: 8 }}>
              <input
                type="checkbox"
                checked={allowFigures}
                onChange={(e) => setAllowFigures(e.target.checked)}
                style={{ marginTop: 4 }}
              />
              <span className="clip-prompt">
                Illustrera min berättelse — tillåt generiska/anonyma mänskliga figurer i
                scenen (t.ex. en siluett vid ett bord). Föreställer ALDRIG dig eller någon
                specifik verklig person, bara en generisk illustration.
              </span>
            </label>

            {refinedPrompt ? (
              <label style={{ display: 'block', marginTop: 8 }}>
                Färdig prompt (redigerbar, engelska)
                <textarea value={refinedPrompt} onChange={(e) => setRefinedPrompt(e.target.value)} rows={2} />
                <span className="placeholder-note" style={{ display: 'block' }}>
                  Detta är vad som faktiskt skickas till videomodellen — redigera fritt eller
                  töm fältet för att låta Claude skriva om den igen.
                </span>
              </label>
            ) : (
              <button className="btn-primary" style={{ marginTop: 4 }} onClick={handleRefine} disabled={refining}>
                {refining ? 'Förfinar…' : 'Förfina prompt (valfritt, förhandsgranska)'}
              </button>
            )}

            <button className="btn-primary" style={{ marginTop: 8 }} onClick={handleGenerate} disabled={generating}>
              {generating ? BROLL_STATUS_LABELS[status] ?? 'Genererar…' : 'Generera B-roll'}
            </button>
          </>
        )}
      </div>

      {error && <p className="error-banner">{error}</p>}
    </div>
  )
}
