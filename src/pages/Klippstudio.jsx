import { useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient.js'
import { generateClipPlan } from '../lib/claudeClient.js'
import { transcribeMedia, transcribeFromUrl } from '../lib/whisperClient.js'
import { uploadRawClip } from '../lib/storage.js'
import { renderClip } from '../lib/shotstackClient.js'
import { fetchSimilarPreviousClips, embedAndStoreClip } from '../lib/clipHistory.js'
import { CATEGORIES } from '../constants.js'

const MAX_FILE_BYTES = 25 * 1024 * 1024

const RENDER_STATUS_LABELS = {
  queued: 'I kö…',
  fetching: 'Hämtar källvideo…',
  rendering: 'Renderar…',
  saving: 'Sparar…',
}

export default function Klippstudio() {
  // Förifyllt från Idébanken ("Bygg vidare") via navigate(..., { state }) — bara läst en
  // gång vid mount, precis som ett vanligt formulär man kommer till med startvärden.
  const location = useLocation()
  const [prompt, setPrompt] = useState(location.state?.prefillPrompt ?? '')
  const [category, setCategory] = useState(location.state?.prefillCategory ?? CATEGORIES[0])
  const [subtopic, setSubtopic] = useState('')

  const fileInputRef = useRef(null)
  const [mediaFile, setMediaFile] = useState(null)
  const [mediaPublicUrl, setMediaPublicUrl] = useState(null)
  const [transcribing, setTranscribing] = useState(false)
  const [transcript, setTranscript] = useState(null)

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [plan, setPlan] = useState(null)
  const [selectedHookIndex, setSelectedHookIndex] = useState(0)
  const [fewShotCount, setFewShotCount] = useState(0)

  const [rendering, setRendering] = useState(false)
  const [renderStatus, setRenderStatus] = useState(null)
  const [renderedVideoUrl, setRenderedVideoUrl] = useState(null)

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
    setMediaPublicUrl(null)
    setTranscript(null)
    setRenderedVideoUrl(null)
    setTranscribing(true)

    // .mov (standard från iPhone/iPad) avvisas av Whisper, och Safari på iOS saknar både
    // stöd för att packa upp ljud ur videocontainrar via decodeAudioData och för
    // captureStream — client-side konvertering är inte möjlig där. Ladda därför upp filen
    // först (Shotstack, som konverterar server-side, behöver en URL) och transkribera sedan
    // via den URL:en istället för att skicka bytes direkt.
    const needsServerTranscode = /\.mov$/i.test(file.name) || file.type === 'video/quicktime'

    if (needsServerTranscode) {
      try {
        const publicUrl = await uploadRawClip(file)
        setMediaPublicUrl(publicUrl)
        const result = await transcribeFromUrl(publicUrl)
        setTranscript(result)
      } catch (err) {
        setError(err.message)
      }
    } else {
      const [transcriptResult, uploadResult] = await Promise.allSettled([
        transcribeMedia(file),
        uploadRawClip(file),
      ])

      if (transcriptResult.status === 'fulfilled') {
        setTranscript(transcriptResult.value)
      } else {
        setError(transcriptResult.reason.message)
      }

      if (uploadResult.status === 'fulfilled') {
        setMediaPublicUrl(uploadResult.value)
      } else {
        setError((prev) => prev ?? uploadResult.reason.message)
      }
    }

    setTranscribing(false)
  }

  function clearMedia() {
    setMediaFile(null)
    setMediaPublicUrl(null)
    setTranscript(null)
    setRenderedVideoUrl(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  async function handleGenerate(event) {
    event.preventDefault()
    if (!prompt.trim()) return

    setLoading(true)
    setError(null)
    setPlan(null)
    setRenderedVideoUrl(null)
    setSaved(false)

    // Few-shot-kontext: semantiskt liknande tidigare publicerade klipp (steg 10, pgvector)
    // när det finns tillräckligt med embeddad data, annars enkel kategorisortering (steg 9).
    // Icke-kritiskt — om det failar fortsätter vi ändå med en tom lista istället för att
    // blockera hela genereringen.
    let previousBestClips = []
    try {
      previousBestClips = await fetchSimilarPreviousClips(prompt, category)
    } catch (err) {
      console.warn('Kunde inte hämta tidigare bästa klipp för few-shot-kontext:', err)
    }
    setFewShotCount(previousBestClips.length)

    try {
      const result = await generateClipPlan({
        prompt,
        category,
        subtopic,
        transcript: transcript?.segments ?? [],
        trendContext: [],
        previousBestClips,
      })
      setPlan(result)
      setSelectedHookIndex(0)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  async function handleRender() {
    if (!plan || !mediaPublicUrl) return
    setRendering(true)
    setRenderStatus('queued')
    setError(null)

    const selectedHook = plan.hook_variants?.[selectedHookIndex]

    try {
      const url = await renderClip({
        videoUrl: mediaPublicUrl,
        segmentsPlan: plan.segments_plan ?? [],
        transcript: transcript?.segments ?? [],
        hookText: selectedHook?.text ?? '',
        suggestedSubtitles: plan.suggested_subtitles ?? [],
        onStatus: setRenderStatus,
      })
      setRenderedVideoUrl(url)
    } catch (err) {
      setError(err.message)
    } finally {
      setRendering(false)
    }
  }

  async function handleSaveDraft() {
    if (!plan) return
    setSaving(true)
    setError(null)

    const selectedHook = plan.hook_variants?.[selectedHookIndex]
    const finalCategory = plan.category || category
    const finalSubtopic = plan.subtopic || subtopic || null

    const { data: inserted, error: insertError } = await supabase
      .from('clips')
      .insert({
        prompt,
        category: finalCategory,
        subtopic: finalSubtopic,
        hook_text: selectedHook?.text ?? null,
        hook_variants: plan.hook_variants ?? null,
        segments_plan: plan.segments_plan ?? null,
        status: 'draft',
        video_url: renderedVideoUrl,
      })
      .select()
      .single()

    setSaving(false)

    if (insertError) {
      setError(insertError.message)
      return
    }

    setSaved(true)

    // Embedding för framtida retrieval (steg 10) — icke-kritiskt, ska aldrig påverka att
    // klippet redan sparats.
    embedAndStoreClip(inserted.id, {
      prompt,
      hookText: selectedHook?.text,
      category: finalCategory,
      subtopic: finalSubtopic,
    }).catch((err) => console.warn('Kunde inte spara embedding för klippet:', err))
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

        {transcribing && (
          <p className="placeholder-note">
            Transkriberar och laddar upp… (för .mov-filer konverteras videon server-side
            först, vilket kan ta ytterligare någon minut — lämna inte sidan)
          </p>
        )}

        {mediaFile && (transcript || mediaPublicUrl) && (
          <div className="clip-card" style={{ margin: 0 }}>
            <div className="clip-card-header">
              <span className="status-pill status-posted">
                {mediaPublicUrl ? 'Uppladdat' : 'Transkriberat'}
              </span>
              <span className="clip-category">{mediaFile.name}</span>
            </div>
            {transcript && <p className="clip-prompt">{transcript.text || 'Inget tal upptäcktes.'}</p>}
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

          {fewShotCount > 0 && (
            <p className="placeholder-note">
              Byggd med hjälp av {fewShotCount} tidigare bäst presterande klipp i samma
              kategori.
            </p>
          )}

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

          {mediaPublicUrl ? (
            <>
              {renderedVideoUrl ? (
                <div>
                  <p style={{ color: 'var(--text-muted)', marginBottom: 6 }}>Förhandsgranskning</p>
                  <video src={renderedVideoUrl} controls style={{ width: '100%', borderRadius: 12 }} />
                </div>
              ) : (
                <button className="btn-primary" onClick={handleRender} disabled={rendering}>
                  {rendering
                    ? RENDER_STATUS_LABELS[renderStatus] ?? 'Renderar…'
                    : 'Rendera video (undertexter + effekter)'}
                </button>
              )}
            </>
          ) : (
            <p className="placeholder-note">
              Rendering kräver uppladdat råmaterial (video/ljud) — ladda upp en fil ovan för att
              kunna rendera undertexter och effekter.
            </p>
          )}

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
