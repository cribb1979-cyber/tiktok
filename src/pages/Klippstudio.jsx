import { useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient.js'
import { generateClipPlan } from '../lib/claudeClient.js'
import { transcribeMedia, transcribeFromUrl } from '../lib/whisperClient.js'
import { uploadRawClip } from '../lib/storage.js'
import { renderClip } from '../lib/shotstackClient.js'
import { fetchSimilarPreviousClips, embedAndStoreClip } from '../lib/clipHistory.js'
import { generateBroll, refineBrollPrompt } from '../lib/replicateClient.js'
import { generateBackgroundImage, matteVideo } from '../lib/backgroundClient.js'
import { fetchVideoAsFile, shareVideoFile } from '../lib/saveVideo.js'
import { CATEGORIES, SEGMENT_EFFECT_OPTIONS, SEGMENT_FILTER_OPTIONS, EFFECT_TYPE_OPTIONS } from '../constants.js'

// Whisper (OpenAI) har en hård 25 MB-gräns per fil — den kan inte höjas, det är deras
// API:s egen begränsning. Uppladdning/rendering (Shotstack) har ingen sådan gräns, så den
// är satt betydligt högre — bara en förnuftig spärr mot orimligt stora filer på mobildata.
// Supabase Storage har ett eget projektinställt max-filstorlekstak (default kan vara lägre)
// som också kan behöva höjas i Supabase-dashboarden om uppladdningen ändå fastnar.
const WHISPER_MAX_FILE_BYTES = 25 * 1024 * 1024
const UPLOAD_MAX_FILE_BYTES = 200 * 1024 * 1024

const RENDER_STATUS_LABELS = {
  queued: 'I kö…',
  fetching: 'Hämtar källvideo…',
  rendering: 'Renderar…',
  saving: 'Sparar…',
}

const BROLL_STATUS_LABELS = {
  PENDING: 'I kö…',
  RUNNING: 'Genererar video…',
}

export default function Klippstudio() {
  // Förifyllt från Idébanken ("Bygg vidare") via navigate(..., { state }) — bara läst en
  // gång vid mount, precis som ett vanligt formulär man kommer till med startvärden.
  const location = useLocation()
  const [prompt, setPrompt] = useState(location.state?.prefillPrompt ?? '')
  const [category, setCategory] = useState(location.state?.prefillCategory ?? CATEGORIES[0])
  const [subtopic, setSubtopic] = useState('')
  // Total längd på det färdiga klippet — Claude anpassar antal/längd på segmenten efter
  // detta (se generate-plan.ts). Tom sträng = ingen preferens, Claude väljer själv.
  const [targetDuration, setTargetDuration] = useState('')

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
  // Manuellt effekt-/filterval per segment ('' = automatiskt/inget) — index matchar
  // plan.segments_plan.
  const [segmentEffects, setSegmentEffects] = useState([])
  const [segmentFilters, setSegmentFilters] = useState([])

  const [rendering, setRendering] = useState(false)
  const [renderStatus, setRenderStatus] = useState(null)
  const [renderedVideoUrl, setRenderedVideoUrl] = useState(null)

  // AI-genererad B-roll — valfritt tillval, aldrig standard (se generate-broll.ts).
  const [brollEnabled, setBrollEnabled] = useState(false)
  const [brollGenerating, setBrollGenerating] = useState(false)
  const [brollStatus, setBrollStatus] = useState(null)
  const [brollVideoUrl, setBrollVideoUrl] = useState(null)
  const [brollPrompt, setBrollPrompt] = useState(null)
  // Valfri egen idé till B-roll — går via Claude (se generate-broll.ts) istället för direkt
  // till videomodellen, så person-skyddet gäller även för användarens egen text.
  const [brollCustomPrompt, setBrollCustomPrompt] = useState('')
  // Uttryckligt opt-in: tillåter generiska/anonyma mänskliga figurer i scenen (illustration
  // av en berättelse) — aldrig menat att föreställa en specifik verklig person. Default av,
  // dvs. B-roll är person-fri om inte detta kryssas i explicit.
  const [brollAllowFigures, setBrollAllowFigures] = useState(false)
  // Valfritt mellansteg: Claude förfinar/översätter idén till en filmisk engelsk prompt,
  // visas här redigerbar innan den (betalda) Replicate-genereringen startas.
  const [brollRefinedPrompt, setBrollRefinedPrompt] = useState('')
  const [brollRefining, setBrollRefining] = useState(false)

  // AI-effekt (ljusklot/dimma/gnistor/kantglöd/static) — genereras separat från B-roll och
  // läggs som ett eget lager OVANPÅ videon (kromakey mot svart bakgrund, utom "static" som
  // läggs på med opacity), istället för att klippas in som ett eget segment. Se EFFECT_TYPES
  // i generate-broll.ts och EFFECT_COMPOSITE i render-clip.ts.
  const [effectEnabled, setEffectEnabled] = useState(false)
  const [effectType, setEffectType] = useState('orb')
  const [effectGenerating, setEffectGenerating] = useState(false)
  const [effectStatus, setEffectStatus] = useState(null)
  const [effectVideoUrl, setEffectVideoUrl] = useState(null)
  const [effectPrompt, setEffectPrompt] = useState(null)
  const [effectCustomPrompt, setEffectCustomPrompt] = useState('')
  const [effectRefinedPrompt, setEffectRefinedPrompt] = useState('')
  const [effectRefining, setEffectRefining] = useState(false)

  // Bakgrundsbyte (experimentellt) — byter ut bakgrunden bakom dig i första segmentet mot en
  // AI-genererad bild. Två separata steg: generera bakgrundsbild (snabbt), och ta bort
  // bakgrunden ur din egen video (Replicate, kan ta en stund). Båda krävs innan rendering
  // faktiskt använder bakgrundsbytet — se backgroundSwapActive i render-clip.ts.
  const [backgroundSwapEnabled, setBackgroundSwapEnabled] = useState(false)
  const [backgroundCustomPrompt, setBackgroundCustomPrompt] = useState('')
  const [backgroundGenerating, setBackgroundGenerating] = useState(false)
  const [backgroundImageUrl, setBackgroundImageUrl] = useState(null)
  const [backgroundPrompt, setBackgroundPrompt] = useState(null)
  const [backgroundMatting, setBackgroundMatting] = useState(false)
  const [backgroundMatteStatus, setBackgroundMatteStatus] = useState(null)
  const [backgroundMattedVideoUrl, setBackgroundMattedVideoUrl] = useState(null)

  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  // Satt så fort klippet finns i Supabase (auto-sparat direkt efter rendering, se
  // handleRender) — gör efterföljande sparningar till uppdateringar istället för dubbletter.
  const [savedClipId, setSavedClipId] = useState(null)
  const [autoSaveError, setAutoSaveError] = useState(null)
  const [transcriptionSkipped, setTranscriptionSkipped] = useState(false)
  // Tvåstegs-sparning: videon hämtas i bakgrunden först (videoFile), delningsmenyn öppnas
  // sedan vid ett nytt, direkt knapptryck — se kommentaren på shareVideoFile för varför.
  const [savingVideo, setSavingVideo] = useState(false)
  const [videoFile, setVideoFile] = useState(null)

  async function handleFileChange(event) {
    const file = event.target.files?.[0]
    if (!file) return

    if (file.size > UPLOAD_MAX_FILE_BYTES) {
      setError(
        `Filen är för stor (max ${Math.round(UPLOAD_MAX_FILE_BYTES / (1024 * 1024))} MB). Korta ner klippet och försök igen.`
      )
      event.target.value = ''
      return
    }

    setError(null)
    setMediaFile(file)
    setMediaPublicUrl(null)
    setTranscript(null)
    setRenderedVideoUrl(null)
    setVideoFile(null)
    setTranscriptionSkipped(false)
    setTranscribing(true)

    if (file.size > WHISPER_MAX_FILE_BYTES) {
      // Över Whisper-gränsen (25 MB, satt av OpenAI — kan inte höjas). Ladda upp för
      // rendering ändå, hoppa bara över transkriberingen istället för att blockera hela
      // flödet — klippningsplanen baseras då på prompten istället för transkriptet.
      try {
        const publicUrl = await uploadRawClip(file)
        setMediaPublicUrl(publicUrl)
        setTranscriptionSkipped(true)
      } catch (err) {
        setError(err.message)
      }
      setTranscribing(false)
      return
    }

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
    setVideoFile(null)
    setTranscriptionSkipped(false)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  async function handleGenerate(event) {
    event.preventDefault()
    if (!prompt.trim()) return

    setLoading(true)
    setError(null)
    setPlan(null)
    setRenderedVideoUrl(null)
    setVideoFile(null)
    setBrollEnabled(false)
    setBrollVideoUrl(null)
    setBrollPrompt(null)
    setBrollCustomPrompt('')
    setBrollAllowFigures(false)
    setBrollRefinedPrompt('')
    setEffectEnabled(false)
    setEffectType('orb')
    setEffectVideoUrl(null)
    setEffectPrompt(null)
    setEffectCustomPrompt('')
    setEffectRefinedPrompt('')
    setBackgroundSwapEnabled(false)
    setBackgroundCustomPrompt('')
    setBackgroundImageUrl(null)
    setBackgroundPrompt(null)
    setBackgroundMattedVideoUrl(null)
    setSaved(false)
    setSavedClipId(null)
    setAutoSaveError(null)

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
        targetDurationSeconds: targetDuration ? Number(targetDuration) : null,
      })
      setPlan(result)
      setSelectedHookIndex(0)
      setSegmentEffects((result.segments_plan ?? []).map(() => ''))
      setSegmentFilters((result.segments_plan ?? []).map(() => ''))
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  // Sparar (eller uppdaterar, om klippet redan finns i Supabase) klippet. Anropas
  // automatiskt direkt efter en lyckad rendering — INNAN användaren öppnar
  // "Öppna & spara video"-länken — så att klippet aldrig bara finns i webbläsarens
  // tillfälliga state. iOS Safari kan ladda om appens flik i bakgrunden när en video öppnas
  // i en ny flik (minneshantering), vilket annars nollställer allt osparat.
  async function persistClip(overrides = {}) {
    const selectedHook = plan.hook_variants?.[selectedHookIndex]
    const finalCategory = plan.category || category
    const finalSubtopic = plan.subtopic || subtopic || null

    const payload = {
      prompt,
      category: finalCategory,
      subtopic: finalSubtopic,
      hook_text: selectedHook?.text ?? null,
      hook_variants: plan.hook_variants ?? null,
      segments_plan: plan.segments_plan ?? null,
      hashtags: plan.suggested_hashtags ?? null,
      status: 'draft',
      video_url: renderedVideoUrl,
      broll_enabled: brollEnabled,
      broll_prompt: brollPrompt,
      broll_video_url: brollVideoUrl,
      // Aldrig manuellt valbart — sätts automatiskt när B-roll eller AI-ljuseffekten
      // används, enligt TikToks regler om taggning av AI-genererat innehåll.
      ai_generated_content: brollEnabled || effectEnabled || backgroundSwapEnabled,
      ...overrides,
    }

    if (savedClipId) {
      const { error: updateError } = await supabase.from('clips').update(payload).eq('id', savedClipId)
      if (updateError) throw new Error(updateError.message)
      return savedClipId
    }

    const { data: inserted, error: insertError } = await supabase
      .from('clips')
      .insert(payload)
      .select()
      .single()
    if (insertError) throw new Error(insertError.message)

    setSavedClipId(inserted.id)

    // Embedding för framtida retrieval (steg 10) — icke-kritiskt, ska aldrig påverka att
    // klippet redan sparats.
    embedAndStoreClip(inserted.id, {
      prompt,
      hookText: selectedHook?.text,
      category: finalCategory,
      subtopic: finalSubtopic,
    }).catch((err) => console.warn('Kunde inte spara embedding för klippet:', err))

    return inserted.id
  }

  async function handleRender() {
    if (!plan || !mediaPublicUrl) return
    setRendering(true)
    setRenderStatus('queued')
    setError(null)
    setVideoFile(null)

    const selectedHook = plan.hook_variants?.[selectedHookIndex]

    try {
      const url = await renderClip({
        videoUrl: mediaPublicUrl,
        segmentsPlan: plan.segments_plan ?? [],
        transcript: transcript?.segments ?? [],
        hookText: selectedHook?.text ?? '',
        suggestedSubtitles: plan.suggested_subtitles ?? [],
        brollVideoUrl,
        segmentEffects,
        segmentFilters,
        words: transcript?.words ?? [],
        effectVideoUrl,
        effectType,
        backgroundImageUrl: backgroundSwapEnabled ? backgroundImageUrl : null,
        backgroundMattedVideoUrl: backgroundSwapEnabled ? backgroundMattedVideoUrl : null,
        onStatus: setRenderStatus,
      })
      setRenderedVideoUrl(url)

      // Spara direkt — se kommentaren på persistClip för varför. video_url skickas
      // explicit eftersom setRenderedVideoUrl ovan inte hunnit uppdatera state än här.
      try {
        await persistClip({ video_url: url })
        setAutoSaveError(null)
      } catch (saveErr) {
        console.warn('Kunde inte spara klippet automatiskt efter rendering:', saveErr)
        setAutoSaveError(saveErr.message)
      }
    } catch (err) {
      setError(err.message)
    } finally {
      setRendering(false)
    }
  }

  async function handlePrepareVideo() {
    if (!renderedVideoUrl) return
    setSavingVideo(true)
    setError(null)
    try {
      const file = await fetchVideoAsFile(renderedVideoUrl, 'klipp.mp4')
      setVideoFile(file)
    } catch (err) {
      setError(err.message)
    } finally {
      setSavingVideo(false)
    }
  }

  // Synkront (inget await innan share-anropet) — se kommentaren på shareVideoFile.
  function handleShareVideo() {
    shareVideoFile(videoFile).catch((err) => {
      // AbortError = användaren stängde delningsmenyn själv, inget fel att visa.
      if (err.name !== 'AbortError') {
        setError(err.message)
      }
    })
  }

  // Valfritt mellansteg — låter Claude förfina/översätta idén utan att starta den betalda
  // Replicate-genereringen, så du kan läsa/redigera resultatet först.
  async function handleRefineBrollPrompt() {
    if (!plan) return
    setBrollRefining(true)
    setError(null)

    const selectedHook = plan.hook_variants?.[selectedHookIndex]

    try {
      const refined = await refineBrollPrompt({
        category: plan.category || category,
        subtopic: plan.subtopic || subtopic,
        hookText: selectedHook?.text,
        customPrompt: brollCustomPrompt,
        allowIllustrativeFigures: brollAllowFigures,
      })
      setBrollRefinedPrompt(refined)
    } catch (err) {
      setError(err.message)
    } finally {
      setBrollRefining(false)
    }
  }

  async function handleGenerateBroll() {
    if (!plan) return
    setBrollGenerating(true)
    setBrollStatus('PENDING')
    setError(null)

    const selectedHook = plan.hook_variants?.[selectedHookIndex]

    try {
      const result = await generateBroll({
        category: plan.category || category,
        subtopic: plan.subtopic || subtopic,
        hookText: selectedHook?.text,
        customPrompt: brollCustomPrompt,
        allowIllustrativeFigures: brollAllowFigures,
        refinedPrompt: brollRefinedPrompt,
        onStatus: setBrollStatus,
      })
      setBrollVideoUrl(result.url)
      setBrollPrompt(result.prompt)
    } catch (err) {
      setError(err.message)
    } finally {
      setBrollGenerating(false)
    }
  }

  async function handleRefineEffectPrompt() {
    setEffectRefining(true)
    setError(null)
    try {
      const refined = await refineBrollPrompt({
        customPrompt: effectCustomPrompt,
        effectMode: effectType,
      })
      setEffectRefinedPrompt(refined)
    } catch (err) {
      setError(err.message)
    } finally {
      setEffectRefining(false)
    }
  }

  async function handleGenerateEffect() {
    setEffectGenerating(true)
    setEffectStatus('PENDING')
    setError(null)

    try {
      const result = await generateBroll({
        customPrompt: effectCustomPrompt,
        refinedPrompt: effectRefinedPrompt,
        effectMode: effectType,
        onStatus: setEffectStatus,
      })
      setEffectVideoUrl(result.url)
      setEffectPrompt(result.prompt)
    } catch (err) {
      setError(err.message)
    } finally {
      setEffectGenerating(false)
    }
  }

  async function handleGenerateBackgroundImage() {
    if (!backgroundCustomPrompt.trim()) return
    setBackgroundGenerating(true)
    setError(null)
    try {
      const result = await generateBackgroundImage({ customPrompt: backgroundCustomPrompt })
      setBackgroundImageUrl(result.imageUrl)
      setBackgroundPrompt(result.prompt)
    } catch (err) {
      setError(err.message)
    } finally {
      setBackgroundGenerating(false)
    }
  }

  async function handleMatteBackground() {
    if (!mediaPublicUrl) return
    setBackgroundMatting(true)
    setBackgroundMatteStatus('PENDING')
    setError(null)
    try {
      const url = await matteVideo({ videoUrl: mediaPublicUrl, onStatus: setBackgroundMatteStatus })
      setBackgroundMattedVideoUrl(url)
    } catch (err) {
      setError(err.message)
    } finally {
      setBackgroundMatting(false)
    }
  }

  async function handleSaveDraft() {
    if (!plan) return
    setSaving(true)
    setError(null)

    try {
      await persistClip()
      setSaved(true)
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
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
            {transcriptionSkipped && (
              <p className="clip-prompt">
                Filen är större än 25 MB — transkribering hoppades över (Whisper-gränsen är
                satt av OpenAI, kan inte höjas). Klippningsplanen baseras på din prompt
                istället. Rendering fungerar som vanligt.
              </p>
            )}
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

        <label>
          Total videolängd
          <select value={targetDuration} onChange={(e) => setTargetDuration(e.target.value)}>
            <option value="">Ingen preferens (Claude väljer)</option>
            <option value="15">15 sekunder</option>
            <option value="30">30 sekunder</option>
            <option value="60">60 sekunder</option>
            <option value="90">90 sekunder</option>
          </select>
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
            <ol style={{ margin: 0, paddingLeft: 20, display: 'flex', flexDirection: 'column', gap: 10 }}>
              {(plan.segments_plan ?? []).map((seg, i) => (
                <li key={i}>
                  <strong>
                    {seg.start}–{seg.end}
                  </strong>{' '}
                  {seg.description}
                  {mediaPublicUrl && (
                    <div style={{ display: 'flex', gap: 8, marginTop: 4, flexWrap: 'wrap' }}>
                      <select
                        value={segmentEffects[i] ?? ''}
                        onChange={(e) => {
                          const next = [...segmentEffects]
                          next[i] = e.target.value
                          setSegmentEffects(next)
                        }}
                      >
                        {SEGMENT_EFFECT_OPTIONS.map((opt) => (
                          <option key={opt.value} value={opt.value}>
                            {opt.label}
                          </option>
                        ))}
                      </select>
                      <select
                        value={segmentFilters[i] ?? ''}
                        onChange={(e) => {
                          const next = [...segmentFilters]
                          next[i] = e.target.value
                          setSegmentFilters(next)
                        }}
                      >
                        {SEGMENT_FILTER_OPTIONS.map((opt) => (
                          <option key={opt.value} value={opt.value}>
                            {opt.label}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                </li>
              ))}
            </ol>
          </div>

          {plan.suggested_subtitles?.length > 0 && (
            <div>
              <p style={{ color: 'var(--text-muted)', marginBottom: 6 }}>Föreslagna nyckelfraser</p>
              <p>{plan.suggested_subtitles.join(' · ')}</p>
              {transcript?.words?.length > 0 && (
                <p className="placeholder-note">
                  Används bara som reserv — eftersom ett riktigt transkript finns renderas
                  ord-för-ord-undertexter synkade mot talet istället.
                </p>
              )}
            </div>
          )}

          {plan.suggested_hashtags?.length > 0 && (
            <div>
              <p style={{ color: 'var(--text-muted)', marginBottom: 6 }}>Föreslagna hashtags</p>
              <p>{plan.suggested_hashtags.map((h) => `#${h}`).join(' ')}</p>
            </div>
          )}

          {mediaPublicUrl && (
            <div className="clip-card" style={{ margin: 0 }}>
              <label style={{ display: 'flex', alignItems: 'flex-start', gap: 10, cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={brollEnabled}
                  onChange={(e) => {
                    setBrollEnabled(e.target.checked)
                    if (!e.target.checked) {
                      setBrollVideoUrl(null)
                      setBrollPrompt(null)
                      setBrollCustomPrompt('')
                      setBrollAllowFigures(false)
                      setBrollRefinedPrompt('')
                    }
                  }}
                  style={{ marginTop: 4 }}
                />
                <span>
                  <span className="clip-hook" style={{ display: 'block' }}>
                    AI-genererad B-roll (valfritt)
                  </span>
                  <span className="clip-prompt" style={{ display: 'block' }}>
                    Atmosfärisk bakgrundsvideo (natur, ljus, stämning) klipps in mellan
                    huvudklippen — visar ALDRIG Christoffer själv. Taggas automatiskt som
                    AI-genererat innehåll enligt TikToks regler. Generera den här innan du
                    renderar om du vill att den ska vara med i videon.
                  </span>
                </span>
              </label>

              {brollEnabled &&
                (brollVideoUrl ? (
                  <div style={{ marginTop: 12 }}>
                    <video src={brollVideoUrl} controls style={{ width: '100%', borderRadius: 12 }} />
                    {brollPrompt && <p className="clip-prompt">Prompt: {brollPrompt}</p>}
                  </div>
                ) : (
                  <>
                    <label style={{ display: 'block', marginTop: 12 }}>
                      Egen idé (valfritt)
                      <textarea
                        value={brollCustomPrompt}
                        onChange={(e) => setBrollCustomPrompt(e.target.value)}
                        rows={2}
                        placeholder="T.ex. regn mot ett fönster, neonljus i vattenpölar — lämna tomt så väljer Claude själv utifrån kategori/hook"
                      />
                    </label>
                    <p className="placeholder-note">
                      Din text går via Claude, som skriver om den till en bildprompt utan
                      personer — samma person-skydd som annars.
                    </p>
                    <label style={{ display: 'flex', alignItems: 'flex-start', gap: 10, cursor: 'pointer', marginTop: 8 }}>
                      <input
                        type="checkbox"
                        checked={brollAllowFigures}
                        onChange={(e) => setBrollAllowFigures(e.target.checked)}
                        style={{ marginTop: 4 }}
                      />
                      <span className="clip-prompt">
                        Illustrera min berättelse — tillåt generiska/anonyma mänskliga figurer
                        i scenen (t.ex. en siluett vid ett bord). Föreställer ALDRIG dig eller
                        någon specifik verklig person, bara en generisk illustration.
                      </span>
                    </label>
                    {brollRefinedPrompt ? (
                      <label style={{ display: 'block', marginTop: 8 }}>
                        Färdig prompt (redigerbar, engelska)
                        <textarea
                          value={brollRefinedPrompt}
                          onChange={(e) => setBrollRefinedPrompt(e.target.value)}
                          rows={2}
                        />
                        <span className="placeholder-note" style={{ display: 'block' }}>
                          Detta är vad som faktiskt skickas till videomodellen — redigera fritt
                          eller töm fältet för att låta Claude skriva om den igen.
                        </span>
                      </label>
                    ) : (
                      <button
                        className="btn-primary"
                        style={{ marginTop: 4 }}
                        onClick={handleRefineBrollPrompt}
                        disabled={brollRefining}
                      >
                        {brollRefining ? 'Förfinar…' : 'Förfina prompt (valfritt, förhandsgranska)'}
                      </button>
                    )}
                    <button
                      className="btn-primary"
                      style={{ marginTop: 8 }}
                      onClick={handleGenerateBroll}
                      disabled={brollGenerating}
                    >
                      {brollGenerating ? BROLL_STATUS_LABELS[brollStatus] ?? 'Genererar…' : 'Generera B-roll'}
                    </button>
                  </>
                ))}
            </div>
          )}

          {mediaPublicUrl && (
            <div className="clip-card" style={{ margin: 0 }}>
              <label style={{ display: 'flex', alignItems: 'flex-start', gap: 10, cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={effectEnabled}
                  onChange={(e) => {
                    setEffectEnabled(e.target.checked)
                    if (!e.target.checked) {
                      setEffectVideoUrl(null)
                      setEffectPrompt(null)
                      setEffectCustomPrompt('')
                      setEffectRefinedPrompt('')
                    }
                  }}
                  style={{ marginTop: 4 }}
                />
                <span>
                  <span className="clip-hook" style={{ display: 'block' }}>
                    AI-effekt ovanpå bilden (valfritt)
                  </span>
                  <span className="clip-prompt" style={{ display: 'block' }}>
                    Ett AI-genererat lysande fenomen (ljusklot, dimma, gnistor m.m.) läggs
                    ovanpå ditt eget klipp under första segmentet — som ett "caught on
                    camera"-ögonblick. Kromakey tar bort den svarta bakgrunden automatiskt.
                    Taggas som AI-genererat innehåll. Generera innan du renderar om du vill ha
                    den med.
                  </span>
                </span>
              </label>

              {effectEnabled && (
                <label style={{ display: 'block', marginTop: 12 }}>
                  Typ av effekt
                  <select
                    value={effectType}
                    onChange={(e) => {
                      setEffectType(e.target.value)
                      setEffectVideoUrl(null)
                      setEffectPrompt(null)
                      setEffectRefinedPrompt('')
                    }}
                  >
                    {EFFECT_TYPE_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </label>
              )}

              {effectEnabled &&
                (effectVideoUrl ? (
                  <div style={{ marginTop: 12 }}>
                    <video src={effectVideoUrl} controls style={{ width: '100%', borderRadius: 12 }} />
                    {effectPrompt && <p className="clip-prompt">Prompt: {effectPrompt}</p>}
                  </div>
                ) : (
                  <>
                    <label style={{ display: 'block', marginTop: 12 }}>
                      Egen idé (valfritt)
                      <textarea
                        value={effectCustomPrompt}
                        onChange={(e) => setEffectCustomPrompt(e.target.value)}
                        rows={2}
                        placeholder="T.ex. ett pulserande blått ljussken — lämna tomt för ett generiskt förslag som passar vald typ"
                      />
                    </label>
                    <p className="placeholder-note">
                      Din text går via Claude, som skriver om den till en bildprompt med ren
                      svart bakgrund (krävs för att kromakey ska fungera).
                    </p>
                    {effectRefinedPrompt ? (
                      <label style={{ display: 'block', marginTop: 8 }}>
                        Färdig prompt (redigerbar, engelska)
                        <textarea
                          value={effectRefinedPrompt}
                          onChange={(e) => setEffectRefinedPrompt(e.target.value)}
                          rows={2}
                        />
                        <span className="placeholder-note" style={{ display: 'block' }}>
                          Detta är vad som faktiskt skickas till videomodellen — redigera fritt
                          eller töm fältet för att låta Claude skriva om den igen.
                        </span>
                      </label>
                    ) : (
                      <button
                        className="btn-primary"
                        style={{ marginTop: 4 }}
                        onClick={handleRefineEffectPrompt}
                        disabled={effectRefining}
                      >
                        {effectRefining ? 'Förfinar…' : 'Förfina prompt (valfritt, förhandsgranska)'}
                      </button>
                    )}
                    <button
                      className="btn-primary"
                      style={{ marginTop: 8 }}
                      onClick={handleGenerateEffect}
                      disabled={effectGenerating}
                    >
                      {effectGenerating ? BROLL_STATUS_LABELS[effectStatus] ?? 'Genererar…' : 'Generera ljuseffekt'}
                    </button>
                  </>
                ))}
            </div>
          )}

          {mediaPublicUrl && (
            <div className="clip-card" style={{ margin: 0 }}>
              <label style={{ display: 'flex', alignItems: 'flex-start', gap: 10, cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={backgroundSwapEnabled}
                  onChange={(e) => {
                    setBackgroundSwapEnabled(e.target.checked)
                    if (!e.target.checked) {
                      setBackgroundCustomPrompt('')
                      setBackgroundImageUrl(null)
                      setBackgroundPrompt(null)
                      setBackgroundMattedVideoUrl(null)
                    }
                  }}
                  style={{ marginTop: 4 }}
                />
                <span>
                  <span className="clip-hook" style={{ display: 'block' }}>
                    Byt bakgrund bakom dig (experimentellt, valfritt)
                  </span>
                  <span className="clip-prompt" style={{ display: 'block' }}>
                    Ersätter bakgrunden i klippets första segment med en AI-genererad bild
                    (t.ex. ett slott, en klippa) — du syns kvar som vanligt, bara det som är
                    bakom dig byts ut. Experimentellt: kan ge fladdriga kanter runt hår/rörelse
                    i vanlig belysning. Fungerar bara om källvideon (hela filen) är under 60
                    sekunder. Taggas som AI-genererat innehåll.
                  </span>
                </span>
              </label>

              {backgroundSwapEnabled && (
                <>
                  <label style={{ display: 'block', marginTop: 12 }}>
                    Bakgrundsidé
                    <textarea
                      value={backgroundCustomPrompt}
                      onChange={(e) => setBackgroundCustomPrompt(e.target.value)}
                      rows={2}
                      placeholder="T.ex. ett slott bakom mig i skymningen, eller en klippkant med utsikt över en dal"
                    />
                  </label>

                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
                    <button
                      className="btn-primary"
                      onClick={handleGenerateBackgroundImage}
                      disabled={backgroundGenerating || !backgroundCustomPrompt.trim()}
                    >
                      {backgroundGenerating ? 'Genererar…' : 'Generera bakgrund'}
                    </button>
                    <button className="btn-primary" onClick={handleMatteBackground} disabled={backgroundMatting}>
                      {backgroundMatting
                        ? BROLL_STATUS_LABELS[backgroundMatteStatus] ?? 'Bearbetar…'
                        : 'Ta bort bakgrund ur mitt klipp'}
                    </button>
                  </div>

                  {backgroundImageUrl && (
                    <div style={{ marginTop: 12 }}>
                      <p style={{ color: 'var(--text-muted)', marginBottom: 6 }}>Ny bakgrund</p>
                      <img
                        src={backgroundImageUrl}
                        alt="Genererad bakgrund"
                        style={{ width: '100%', borderRadius: 12 }}
                      />
                      {backgroundPrompt && <p className="clip-prompt">Prompt: {backgroundPrompt}</p>}
                    </div>
                  )}

                  {backgroundMattedVideoUrl && (
                    <div style={{ marginTop: 12 }}>
                      <p style={{ color: 'var(--text-muted)', marginBottom: 6 }}>
                        Din video utan bakgrund (grönt tas bort automatiskt vid rendering)
                      </p>
                      <video
                        src={backgroundMattedVideoUrl}
                        controls
                        style={{ width: '100%', borderRadius: 12 }}
                      />
                    </div>
                  )}

                  {backgroundImageUrl && backgroundMattedVideoUrl && (
                    <p style={{ color: 'var(--success)', marginTop: 8 }}>
                      ✓ Redo — bakgrundsbytet används automatiskt i första segmentet när du
                      renderar.
                    </p>
                  )}
                </>
              )}
            </div>
          )}

          {mediaPublicUrl ? (
            <>
              {renderedVideoUrl ? (
                <div>
                  <p style={{ color: 'var(--text-muted)', marginBottom: 6 }}>Förhandsgranskning</p>
                  <video src={renderedVideoUrl} controls style={{ width: '100%', borderRadius: 12 }} />
                  {savedClipId ? (
                    <p style={{ color: 'var(--success)', marginTop: 8 }}>
                      ✓ Sparat i Bibliotek — försvinner inte även om appen laddas om.
                    </p>
                  ) : (
                    <p className="error-banner">
                      Kunde inte spara klippet automatiskt{autoSaveError ? `: ${autoSaveError}` : '.'}{' '}
                      Tryck "Godkänn och spara som utkast" nedan INNAN du öppnar videon, annars
                      kan den försvinna.
                    </p>
                  )}
                  {videoFile ? (
                    <button
                      className="btn-primary"
                      style={{ display: 'block', width: '100%', marginTop: 10 }}
                      onClick={handleShareVideo}
                    >
                      Spara video till telefonen
                    </button>
                  ) : (
                    <button
                      className="btn-primary"
                      style={{ display: 'block', width: '100%', marginTop: 10 }}
                      onClick={handlePrepareVideo}
                      disabled={savingVideo}
                    >
                      {savingVideo ? 'Förbereder…' : 'Förbered video för sparning'}
                    </button>
                  )}
                  <p className="placeholder-note">
                    {videoFile
                      ? 'Videon är redo — tryck igen för att öppna delningsmenyn och välja "Spara video" (iOS) eller motsvarande.'
                      : 'Två steg krävs på iOS: förbered videon först, tryck sedan igen för att öppna delningsmenyn.'}{' '}
                    Sen kan du lägga till ljud/trendande sound och publicera direkt i
                    TikTok-appen (tills den riktiga TikTok-kopplingen är på plats). Klippet
                    finns alltid kvar i Bibliotek oavsett.
                  </p>
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
