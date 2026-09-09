import { useRef, useState } from 'react'
import { supabase } from '../lib/supabaseClient.js'
import { generateClipPlan } from '../lib/claudeClient.js'
import { transcribeMedia } from '../lib/whisperClient.js'
import { CATEGORIES } from '../constants.js'

const MAX_FILE_BYTES = 25 * 1024 * 1024

export default function Klippstudio() {
  const [prompt, setPrompt] = useState('')
  const [category, setCategory] = useState(CATEGORIES[0])
  const [subtopic, setSubtopic] = useState('')

  const fileInputRef = useRef(null)
  const [mediaFile, setMediaFile] = useState(null)
  const [transcribing, setTranscribing] = useState(false)
  const [transcript, setTranscript] = useState(null)

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [plan, setPlan] = useState(null)
  const [selectedHookIndex, setSelectedHookIndex] = useState(0)

  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  async function handleFileChange(event) {
    const file = event.target.files?.[0]
    if (!file) return

    if (file.size > MAX_FILE_BYTES) {
      setError('Filen är för stor (max 25 MB). Korta ner klippet och försök igen.')
      event.target.value = ''
      return
    }

    setError(null)
    setMediaFile(file)
    setTranscript(null)
    setTranscribing(true)

    try {
      const result = await transcribeMedia(file)
      setTranscript(result)
    } catch (err) {
      setError(err.message)
      setMediaFile(null)
    } finally {
      setTranscribing(false)
    }
  }

  function clearMedia() {
    setMediaFile(null)
    setTranscript(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  async function handleGenerate(event) {
    event.preventDefault()
    if (!prompt.trim()) return

    setLoading(true)
    setError(null)
    setPlan(null)
    setSaved(false)

    try {
      // Few-shot-kontext (tidigare bäst presterande klipp) skickas som tom lista tills
      // retrieval kopplas på i steg 9-10 — anropsformatet är redan förberett för det.
      const result = await generateClipPlan({
        prompt,
        category,
        subtopic,
        transcript: transcript?.segments ?? [],
        trendContext: [],
        previousBestClips: [],
      })
      setPlan(result)
      setSelectedHookIndex(0)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  async function handleSaveDraft() {
    if (!plan) return
    setSaving(true)
    setError(null)

    const selectedHook = plan.hook_variants?.[selectedHookIndex]

    const { error: insertError } = await supabase.from('clips').insert({
      prompt,
      category: plan.category || category,
      subtopic: plan.subtopic || subtopic || null,
      hook_text: selectedHook?.text ?? null,
      hook_variants: plan.hook_variants ?? null,
      segments_plan: plan.segments_plan ?? null,
      status: 'draft',
      // Video-rendering är stubbad till en placeholder tills Shotstack kopplas på (steg 6).
      video_url: null,
    })

    setSaving(false)

    if (insertError) {
      setError(insertError.message)
      return
    }

    setSaved(true)
  }

  return (
    <div className="page">
      <header className="page-header">
        <h1>Klippstudio</h1>
      </header>

      {error && <p className="error-banner">{error}</p>}

      <form className="clip-form" onSubmit={handleGenerate}>
        <label>
          Råmaterial (video/ljud, valfritt)
          <input
            ref={fileInputRef}
            type="file"
            accept="video/*,audio/*"
            onChange={handleFileChange}
            disabled={transcribing}
          />
        </label>

        {transcribing && <p className="placeholder-note">Transkriberar…</p>}

        {mediaFile && transcript && (
          <div className="clip-card" style={{ margin: 0 }}>
            <div className="clip-card-header">
              <span className="status-pill status-posted">Transkriberat</span>
              <span className="clip-category">{mediaFile.name}</span>
            </div>
            <p className="clip-prompt">{transcript.text || 'Inget tal upptäcktes.'}</p>
            <button type="button" className="btn-danger" onClick={clearMedia}>
              Ta bort
            </button>
          </div>
        )}

        <label>
          Prompt / klippidé
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            rows={3}
            placeholder="T.ex. 3 tecken på att en själ försöker nå dig genom drömmar"
            required
          />
        </label>

        <label>
          Kategori
          <select value={category} onChange={(e) => setCategory(e.target.value)}>
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>

        <label>
          Underämne
          <input
            type="text"
            value={subtopic}
            onChange={(e) => setSubtopic(e.target.value)}
            placeholder="Fritext (valfritt)"
          />
        </label>

        <p className="placeholder-note">
          {transcript
            ? 'Klippningsplanen baseras på transkriptet ovan tillsammans med din prompt.'
            : 'Ladda upp råmaterial för tidsstämplad transkribering, eller lämna tomt och basera planen enbart på prompten.'}
        </p>

        <button className="btn-primary" type="submit" disabled={loading || transcribing}>
          {loading ? 'Genererar…' : 'Föreslå klippningsplan'}
        </button>
      </form>

      {plan && (
        <div className="clip-form">
          <h2 style={{ margin: 0 }}>Förslag</h2>

          <div>
            <p style={{ color: 'var(--text-muted)', marginBottom: 6 }}>Välj hook</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {(plan.hook_variants ?? []).map((hook, i) => (
                <label
                  key={i}
                  className="clip-card"
                  style={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: 10,
                    margin: 0,
                    cursor: 'pointer',
                    borderColor: i === selectedHookIndex ? 'var(--accent)' : 'var(--border)',
                  }}
                >
                  <input
                    type="radio"
                    name="hook"
                    checked={i === selectedHookIndex}
                    onChange={() => setSelectedHookIndex(i)}
                    style={{ marginTop: 4 }}
                  />
                  <span>
                    <span className="clip-hook" style={{ display: 'block' }}>
                      {hook.text}
                    </span>
                    {hook.rationale && (
                      <span className="clip-prompt" style={{ display: 'block' }}>
                        {hook.rationale}
                      </span>
                    )}
                  </span>
                </label>
              ))}
            </div>
          </div>

          <div>
            <p style={{ color: 'var(--text-muted)', marginBottom: 6 }}>Segmentplan</p>
            <ol style={{ margin: 0, paddingLeft: 20, display: 'flex', flexDirection: 'column', gap: 8 }}>
              {(plan.segments_plan ?? []).map((seg, i) => (
                <li key={i}>
                  <strong>
                    {seg.start}–{seg.end}
                  </strong>{' '}
                  {seg.description}
                </li>
              ))}
            </ol>
          </div>

          {plan.suggested_subtitles?.length > 0 && (
            <div>
              <p style={{ color: 'var(--text-muted)', marginBottom: 6 }}>Föreslagna nyckelfraser</p>
              <p>{plan.suggested_subtitles.join(' · ')}</p>
            </div>
          )}

          <p className="placeholder-note">
            Rendering (undertexter, effekter) kopplas på i steg 6 via Shotstack. Just nu sparas
            klippet som utkast med planen — förhandsgranskning kommer senare.
          </p>

          {saved ? (
            <p style={{ color: 'var(--success)' }}>Sparat i Bibliotek som utkast.</p>
          ) : (
            <button className="btn-primary" onClick={handleSaveDraft} disabled={saving}>
              {saving ? 'Sparar…' : 'Godkänn och spara som utkast'}
            </button>
          )}
        </div>
      )}
    </div>
  )
}
