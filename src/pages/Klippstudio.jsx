import { useEffect, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient.js'
import { generateClipPlan, revisePlan, parseScript } from '../lib/claudeClient.js'
import { transcribeMedia, transcribeFromUrl, transcribeMp4Url } from '../lib/whisperClient.js'
import { uploadRawClip } from '../lib/storage.js'
import { renderClip } from '../lib/shotstackClient.js'
import { fetchSimilarPreviousClips, embedAndStoreClip } from '../lib/clipHistory.js'
import { generateBroll, refineBrollPrompt } from '../lib/replicateClient.js'
import { generateBackgroundImage, matteVideo } from '../lib/backgroundClient.js'
import { generateAvatarVideo, listAvatars, listVoices } from '../lib/heygenClient.js'
import { fetchVideoAsFile, shareVideoFile } from '../lib/saveVideo.js'
import {
  CATEGORIES,
  SEGMENT_EFFECT_OPTIONS,
  SEGMENT_FILTER_OPTIONS,
  SEGMENT_SPEED_OPTIONS,
  EFFECT_TYPE_OPTIONS,
  EFFECT_POSITION_HINTS,
  GLOW_COLOR_OPTIONS,
  GLOW_INTENSITY_OPTIONS,
} from '../constants.js'

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

// Samma tidkodsformat som segments_plan.start/end (mm:ss eller hh:mm:ss) — bara för
// klient-sidiga uppskattningar/gränser i glow-UI:t nedan, inte auktoritativt (rendering
// klämmer fast värdena skarpt i render-clip.ts oavsett vad som skickas härifrån).
function parseTimecodeClient(tc) {
  const parts = String(tc).split(':').map(Number)
  if (parts.length === 2 && parts.every((n) => !Number.isNaN(n))) {
    return parts[0] * 60 + parts[1]
  }
  if (parts.length === 3 && parts.every((n) => !Number.isNaN(n))) {
    return parts[0] * 3600 + parts[1] * 60 + parts[2]
  }
  return Number(tc) || 0
}

const GLOW_DOT_COLORS = { gold: '#ffcc33', blue: '#4da8ff', white: '#ffffff', red: '#ff5050' }

// "Klippets sammansättning" — en 9:16-ruta (samma proportion som slutvideon) som visar ALLA
// aktiva tillval TILLSAMMANS ovanpå klippets första bildruta, istället för att varje
// tillval (glow/tankebubbla/AI-effekt/bakgrundsbyte) konfigureras blint i sitt eget separata
// kort. Generaliserad från den ursprungliga glow-positioneraren till att hantera flera
// "lager" av olika typ:
//   - 'circle' (glow): dragbar + resizable (handtag i hörnet)
//   - 'marker' (tankebubbla): dragbar, ingen storlek
//   - 'badge' (AI-effekt): SKRIVSKYDDAD referens — Shotstack stödjer bara förinställda lägen
//     för video-kompositering, inte fri positionering, så den går inte att flytta här
//   - 'zone' (hook/undertexter): skrivskyddat band, visar var text alltid hamnar
//   - 'fullFrame' (bakgrundsbyte): skrivskyddad hel-bild-indikator
// x/y/radius är alltid procent av BREDDEN (matchar hur render-clip.ts räknar ut
// pixelvärden), så cirklar hålls runda oavsett att rutan i sig är 9:16 och inte kvadratisk.
function ClipCanvas({ previewFrame, layers, onMoveLayer, onResizeLayer }) {
  const containerRef = useRef(null)
  const dragRef = useRef(null) // { id, mode: 'move' | 'resize' } | null

  function handlePointerMove(e) {
    const drag = dragRef.current
    if (!drag || !containerRef.current) return
    const layer = layers.find((l) => l.id === drag.id)
    if (!layer) return
    const rect = containerRef.current.getBoundingClientRect()
    if (drag.mode === 'move') {
      const x = Math.min(Math.max(((e.clientX - rect.left) / rect.width) * 100, 0), 100)
      const y = Math.min(Math.max(((e.clientY - rect.top) / rect.height) * 100, 0), 100)
      onMoveLayer(drag.id, Math.round(x), Math.round(y))
    } else if (drag.mode === 'resize') {
      const centerXpx = (layer.x / 100) * rect.width
      const centerYpx = (layer.y / 100) * rect.height
      const dxPx = e.clientX - rect.left - centerXpx
      const dyPx = e.clientY - rect.top - centerYpx
      const distPx = Math.sqrt(dxPx * dxPx + dyPx * dyPx)
      const radiusPct = (distPx / rect.width) * 100
      onResizeLayer(drag.id, Math.min(Math.max(Math.round(radiusPct), 3), 45))
    }
  }

  function stopDrag() {
    dragRef.current = null
  }

  function startDrag(id, mode) {
    return (e) => {
      e.preventDefault()
      if (mode === 'resize') e.stopPropagation()
      dragRef.current = { id, mode }
      e.currentTarget.setPointerCapture(e.pointerId)
    }
  }

  return (
    <div
      ref={containerRef}
      onPointerMove={handlePointerMove}
      onPointerUp={stopDrag}
      onPointerLeave={stopDrag}
      onPointerCancel={stopDrag}
      style={{
        position: 'relative',
        width: '100%',
        maxWidth: 270,
        aspectRatio: '9 / 16',
        borderRadius: 12,
        overflow: 'hidden',
        background: previewFrame ? `#000 url(${previewFrame}) center/cover no-repeat` : '#1a1a2e',
        border: '1px solid var(--border)',
        touchAction: 'none',
        margin: '0 auto',
      }}
    >
      {layers.map((layer) => {
        if (layer.kind === 'zone') {
          return (
            <div
              key={layer.id}
              style={{
                position: 'absolute',
                left: 0,
                right: 0,
                top: `${layer.y}%`,
                height: `${layer.height}%`,
                transform: 'translateY(-50%)',
                background: 'rgba(255,255,255,0.08)',
                borderTop: '1px dashed rgba(255,255,255,0.35)',
                borderBottom: '1px dashed rgba(255,255,255,0.35)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                pointerEvents: 'none',
              }}
            >
              <span
                style={{
                  fontSize: 10,
                  color: 'rgba(255,255,255,0.8)',
                  textTransform: 'uppercase',
                  letterSpacing: 0.5,
                  textShadow: '0 1px 2px rgba(0,0,0,0.8)',
                }}
              >
                {layer.label}
              </span>
            </div>
          )
        }
        if (layer.kind === 'fullFrame') {
          return (
            <div key={layer.id} style={{ position: 'absolute', inset: 0, background: 'rgba(80,160,255,0.1)', pointerEvents: 'none' }}>
              <span
                style={{
                  position: 'absolute',
                  top: 8,
                  left: 8,
                  fontSize: 11,
                  color: '#fff',
                  background: 'rgba(0,0,0,0.55)',
                  padding: '3px 8px',
                  borderRadius: 8,
                }}
              >
                {layer.label}
              </span>
            </div>
          )
        }
        if (layer.kind === 'badge') {
          return (
            <div
              key={layer.id}
              style={{
                position: 'absolute',
                left: `${layer.x}%`,
                top: `${layer.y}%`,
                transform: 'translate(-50%, -50%)',
                fontSize: 11,
                color: '#fff',
                background: 'rgba(0,0,0,0.6)',
                padding: '4px 9px',
                borderRadius: 10,
                pointerEvents: 'none',
                whiteSpace: 'nowrap',
              }}
            >
              {layer.label}
            </div>
          )
        }
        if (layer.kind === 'marker') {
          return (
            <div
              key={layer.id}
              onPointerDown={startDrag(layer.id, 'move')}
              style={{
                position: 'absolute',
                left: `${layer.x}%`,
                top: `${layer.y}%`,
                transform: 'translate(-50%, -50%)',
                fontSize: 13,
                fontWeight: 700,
                color: '#1a1130',
                background: 'rgba(255,255,255,0.95)',
                padding: '5px 10px',
                borderRadius: 12,
                boxShadow: '0 0 12px 3px rgba(178,132,255,0.8)',
                cursor: 'move',
                whiteSpace: 'nowrap',
              }}
            >
              {layer.label}
            </div>
          )
        }
        // 'circle' — glow, dragbar + resizable
        const dotColor = layer.color ?? GLOW_DOT_COLORS.gold
        return (
          <div
            key={layer.id}
            onPointerDown={startDrag(layer.id, 'move')}
            style={{
              position: 'absolute',
              left: `${layer.x}%`,
              top: `${layer.y}%`,
              width: `${layer.radius * 2}%`,
              aspectRatio: '1 / 1',
              transform: 'translate(-50%, -50%)',
              borderRadius: '50%',
              border: `2px solid ${dotColor}`,
              boxShadow: `0 0 16px 4px ${dotColor}`,
              cursor: 'move',
            }}
          >
            <div
              onPointerDown={startDrag(layer.id, 'resize')}
              style={{
                position: 'absolute',
                right: -8,
                bottom: -8,
                width: 16,
                height: 16,
                borderRadius: '50%',
                background: dotColor,
                border: '2px solid #fff',
                cursor: 'nwse-resize',
              }}
            />
          </div>
        )
      })}
    </div>
  )
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
  // Ett eller flera råklipp, tillagda ett i taget ("Lägg till klipp"). Varje element:
  // { id, name, publicUrl, transcript, transcribing, statusLabel, transcriptionSkipped, error }.
  // Den råa File-blobben sparas INTE här (se kommentaren i handleAddClip för varför).
  // id är en stabil sträng ("c0", "c1", …) oberoende av array-index (som kan ändras vid
  // borttagning) — samma id skickas till generate-plan.ts/render-clip.ts som clip_id på
  // varje segment, så AI:n och renderingen vet vilket klipp ett segment hör till.
  const [clips, setClips] = useState([])
  const nextClipIdRef = useRef(0)

  function updateClip(id, patch) {
    setClips((prev) => prev.map((c) => (c.id === id ? { ...c, ...patch } : c)))
  }

  // Manus-läge (valfritt tredje inmatningssätt utöver uppladdning/fri prompt): dialog +
  // regianvisningar i hakparenteser tolkas av Claude till beats (parse-script.ts), den
  // sammanslagna talbara dialogen skickas till HeyGen som genererar en talande AI-avatar-
  // video — som sedan läggs till i clips-listan OVAN precis som ett vanligt uppladdat klipp,
  // så hela transkriberings-/planerings-/renderingsflödet återanvänds oförändrat.
  const [manusText, setManusText] = useState('')
  const [manusParsing, setManusParsing] = useState(false)
  const [manusBeats, setManusBeats] = useState(null)
  const [manusGenerating, setManusGenerating] = useState(false)
  const [manusStatus, setManusStatus] = useState(null)
  const [manusError, setManusError] = useState(null)

  // Avatar-/röstväljare (se list-avatars.ts/list-voices.ts) — hämtas en gång när sidan
  // laddas (bara metadata, kostar inget). Tomt val ('') betyder "använd HEYGEN_AVATAR_ID/
  // HEYGEN_VOICE_ID-standardvalet server-side" (se generate-avatar-video.ts) — låter appen
  // fortsätta fungera oförändrat även om listorna inte kunde hämtas (t.ex. fel API-nyckel).
  const [avatarOptions, setAvatarOptions] = useState([])
  const [voiceOptions, setVoiceOptions] = useState([])
  const [selectedAvatarId, setSelectedAvatarId] = useState('')
  const [selectedVoiceId, setSelectedVoiceId] = useState('')
  const [avatarOptionsError, setAvatarOptionsError] = useState(null)

  useEffect(() => {
    listAvatars()
      .then(setAvatarOptions)
      .catch((err) => setAvatarOptionsError(err.message))
    listVoices()
      .then(setVoiceOptions)
      .catch((err) => setAvatarOptionsError(err.message))
  }, [])

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [plan, setPlan] = useState(null)
  const [selectedHookIndex, setSelectedHookIndex] = useState(0)
  const [fewShotCount, setFewShotCount] = useState(0)
  // Manuellt effekt-/filterval per segment ('' = automatiskt/inget) — index matchar
  // plan.segments_plan.
  const [segmentEffects, setSegmentEffects] = useState([])
  const [segmentFilters, setSegmentFilters] = useState([])
  // Manuellt redigerbara start-/sluttider (förifyllda med AI-förslaget, mm:ss) och
  // uppspelningshastighet ('' = normal) per segment — override av segments_plan[i].start/end
  // i render-clip.ts. Låter användaren klippa bort för mycket material eller skapa
  // slow-motion/time-lapse utan att bygga en full tidslinje-editor.
  const [segmentStarts, setSegmentStarts] = useState([])
  const [segmentEnds, setSegmentEnds] = useState([])
  const [segmentSpeeds, setSegmentSpeeds] = useState([])

  // "Redigera med vägledning" — fri textinstruktion som Claude tolkar och applicerar på HELA
  // segmentplanen (start/slut/hastighet), istället för att man ställer in siffror manuellt
  // per segment. Claude får också ett fåtal nedskalade bildrutor (en per segment) för grov
  // visuell kontext — se captureGuidanceFrames och revise-plan.ts.
  const [editInstruction, setEditInstruction] = useState('')
  const [revisingPlan, setRevisingPlan] = useState(false)
  const [reviseSummary, setReviseSummary] = useState(null)

  const [rendering, setRendering] = useState(false)
  const [renderStatus, setRenderStatus] = useState(null)
  const [renderedVideoUrl, setRenderedVideoUrl] = useState(null)

  // Snabb förhandsgranskning — gratis, vattenstämplad Shotstack-sandbox-rendering (samma
  // redigering som den skarpa, se buildRenderParams) så man kan SE det faktiska resultatet
  // (hook/undertexter/effekter/glow, allt) innan man committar till den betalda
  // slutrenderingen. Sparas aldrig till Bibliotek — helt engångsbruk.
  const [previewRendering, setPreviewRendering] = useState(false)
  const [previewStatus, setPreviewStatus] = useState(null)
  const [previewVideoUrl, setPreviewVideoUrl] = useState(null)

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
  const [backgroundImageStatus, setBackgroundImageStatus] = useState(null)
  const [backgroundImageUrl, setBackgroundImageUrl] = useState(null)
  const [backgroundPrompt, setBackgroundPrompt] = useState(null)
  const [backgroundMatting, setBackgroundMatting] = useState(false)
  const [backgroundMatteStatus, setBackgroundMatteStatus] = useState(null)
  const [backgroundMattedVideoUrl, setBackgroundMattedVideoUrl] = useState(null)

  // Tankebubblor — glödande "inre tankar" (plan.thought_bubbles) som poppar upp ovanpå
  // bilden, ett per segment. Ren textstyling, ingen AI-videogenerering. Opt-in, default av.
  // Positionen (x/y-procent, samma bas som glow) är dragbar i "Klippets sammansättning".
  const [thoughtBubblesEnabled, setThoughtBubblesEnabled] = useState(false)
  const [thoughtBubbleXPercent, setThoughtBubbleXPercent] = useState(50)
  const [thoughtBubbleYPercent, setThoughtBubbleYPercent] = useState(18)

  // Glow-overlay — manuellt positionerad, pulserande glödeffekt (t.ex. en tatuering/symbol
  // som ska se ut att lysa som ett kraftmärke). FAST position under ett tidsintervall i
  // klippets FÄRDIGA tidslinje — INGEN AI-baserad objektspårning, bäst när kameran/armen/
  // föremålet hålls stilla i bild. Sparas som glow_effect (jsonb) på klippet, se
  // GLOW_COLORS/GLOW_INTENSITY_OPACITY i render-clip.ts för hur den kompositeras.
  const [glowEnabled, setGlowEnabled] = useState(false)
  const [glowXPercent, setGlowXPercent] = useState(50)
  const [glowYPercent, setGlowYPercent] = useState(50)
  const [glowRadiusPercent, setGlowRadiusPercent] = useState(10)
  const [glowStartSeconds, setGlowStartSeconds] = useState(0)
  const [glowEndSeconds, setGlowEndSeconds] = useState(3)
  const [glowColor, setGlowColor] = useState('gold')
  const [glowIntensity, setGlowIntensity] = useState('medium')
  // Stillbild (dataURL) från klippets första bildruta, bara för att underlätta placering —
  // används aldrig i själva renderingen. Kan misslyckas (t.ex. CORS) utan att blockera
  // funktionen, se handleCaptureGlowPreview.
  const [glowPreviewFrame, setGlowPreviewFrame] = useState(null)
  const [glowCapturing, setGlowCapturing] = useState(false)

  // Avancerat-sektion: B-roll, AI-effekt, bakgrundsbyte, tankebubblor och glow är alla
  // valfria tillval som annars gjorde standardflödet (ladda upp → prompt → plan → rendera)
  // rörigt — hopfällt som standard, allt finns kvar men syns inte förrän man öppnar det.
  const [advancedOpen, setAdvancedOpen] = useState(false)

  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  // Satt så fort klippet finns i Supabase (auto-sparat direkt efter rendering, se
  // handleRender) — gör efterföljande sparningar till uppdateringar istället för dubbletter.
  const [savedClipId, setSavedClipId] = useState(null)
  const [autoSaveError, setAutoSaveError] = useState(null)
  // Tvåstegs-sparning: videon hämtas i bakgrunden först (videoFile), delningsmenyn öppnas
  // sedan vid ett nytt, direkt knapptryck — se kommentaren på shareVideoFile för varför.
  const [savingVideo, setSavingVideo] = useState(false)
  const [videoFile, setVideoFile] = useState(null)

  // Lägger till ETT nytt klipp i listan (upprepa för flera — "Lägg till klipp" i UI:t).
  // Samma uppladdnings-/transkriberingslogik som tidigare (Whisper-storleksgräns, .mov-
  // serverkonvertering), bara riktad mot en post i clips-arrayen istället för global state.
  async function handleAddClip(event) {
    const file = event.target.files?.[0]
    if (!file) return
    event.target.value = '' // så samma fil kan väljas igen om man vill lägga till den två gånger

    if (file.size > UPLOAD_MAX_FILE_BYTES) {
      setError(
        `Filen är för stor (max ${Math.round(UPLOAD_MAX_FILE_BYTES / (1024 * 1024))} MB). Korta ner klippet och försök igen.`
      )
      return
    }

    const id = `c${nextClipIdRef.current++}`
    setError(null)
    setClips((prev) => [
      ...prev,
      {
        id,
        // Den råa File-blobben (kan vara upp till 200 MB) sparas MEDVETET inte i state —
        // bara i den lokala `file`-variabeln ovan, som räcker för uppladdningen nedan.
        // Att hålla kvar den i React-state efter att den laddats upp håller onödigt mycket
        // videodata i minnet samtidigt för varje tillagt klipp — en trolig orsak till att
        // iOS Safari (strama minnesgränser för videoavkodning) kraschar/laddar om fliken
        // när ett andra klipp läggs till.
        name: file.name,
        publicUrl: null,
        transcript: null,
        transcribing: true,
        transcriptionSkipped: false,
        error: null,
      },
    ])
    // Ett nytt klipp gör en tidigare rendering/förhandsgranskning inaktuell (de speglar inte
    // längre alla uppladdade klipp) — men INTE en redan genererad plan, den kan fortfarande
    // vara giltig för de klipp som redan fanns när den skapades.
    setRenderedVideoUrl(null)
    setPreviewVideoUrl(null)
    setVideoFile(null)

    if (file.size > WHISPER_MAX_FILE_BYTES) {
      // Över Whisper-gränsen (25 MB, satt av OpenAI — kan inte höjas). Ladda upp för
      // rendering ändå, hoppa bara över transkriberingen istället för att blockera hela
      // flödet — klippningsplanen baseras då på prompten istället för transkriptet.
      try {
        const publicUrl = await uploadRawClip(file)
        updateClip(id, { publicUrl, transcriptionSkipped: true })
      } catch (err) {
        updateClip(id, { error: err.message })
      }
      updateClip(id, { transcribing: false })
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
        updateClip(id, { publicUrl })
        const result = await transcribeFromUrl(publicUrl, (status) => {
          updateClip(id, {
            statusLabel: status === 'converting' ? 'Konverterar video…' : 'Transkriberar…',
          })
        })
        updateClip(id, { transcript: result })
      } catch (err) {
        updateClip(id, { error: err.message })
      }
    } else {
      const [transcriptResult, uploadResult] = await Promise.allSettled([
        transcribeMedia(file),
        uploadRawClip(file),
      ])

      // Bara det FÖRSTA felet sparas (om båda misslyckas) — samma "tappa inte det första
      // felet"-princip som tidigare, fast som en enda sammanslagen uppdatering istället för
      // två separata (updateClip slår bara ihop ett rakt patch-objekt, stödjer inte en
      // funktionell uppdaterare per fält som setError kunde).
      const clipError =
        transcriptResult.status === 'rejected'
          ? transcriptResult.reason.message
          : uploadResult.status === 'rejected'
            ? uploadResult.reason.message
            : null

      updateClip(id, {
        ...(transcriptResult.status === 'fulfilled' ? { transcript: transcriptResult.value } : {}),
        ...(uploadResult.status === 'fulfilled' ? { publicUrl: uploadResult.value } : {}),
        ...(clipError ? { error: clipError } : {}),
      })
    }

    updateClip(id, { transcribing: false })
  }

  function handleRemoveClip(id) {
    setClips((prev) => prev.filter((c) => c.id !== id))
    // Ett borttaget klipp kan göra en redan genererad plans clip_id-referenser ogiltiga —
    // säkrast att be om en ny plan istället för att riskera att rendera mot ett klipp som
    // inte längre finns.
    if (plan) {
      setPlan(null)
      setError('Ett klipp togs bort — generera klippningsplanen på nytt.')
    }
    setRenderedVideoUrl(null)
    setPreviewVideoUrl(null)
    setVideoFile(null)
  }

  async function handleParseManus() {
    if (!manusText.trim()) return
    setManusParsing(true)
    setManusError(null)
    setManusBeats(null)
    try {
      const result = await parseScript(manusText)
      setManusBeats(result.parsed_beats)
    } catch (err) {
      setManusError(err.message)
    }
    setManusParsing(false)
  }

  // Skickar den tolkade dialogen till HeyGen, pollar tills videon är klar, och lägger sedan
  // till den som ett vanligt klipp i clips-listan (samma { id, name, publicUrl, transcript,
  // transcribing, ... }-form som handleAddClip bygger) — transkriberas här via
  // transcribeMp4Url (HeyGen levererar redan mp4, ingen Shotstack-konvertering behövs) så
  // ord-för-ord-undertexter/klippningsplan fungerar identiskt med ett uppladdat klipp.
  async function handleGenerateAvatarVideo() {
    if (!manusBeats || manusBeats.length === 0) return
    // HeyGen stödjer riktiga pauser via en <break time="Xs"/>-tagg inline i texten (den enda
    // taggen den stödjer — INTE en full SSML-<speak>-inpackning, det ger enligt HeyGens egen
    // dokumentation extra uppläst brus). Utan detta läste avataren upp replikerna rakt igenom
    // utan att respektera tystnad/paus markerad i manuset (rapporterad bugg). Kräver att den
    // valda HEYGEN_VOICE_ID faktiskt stödjer pauser (voice.support_pause via /v2/voices) —
    // annars kan taggen ignoreras eller läsas upp bokstavligt.
    const spokenText = manusBeats
      .map((b) => {
        const line = typeof b.line === 'string' ? b.line.trim() : ''
        if (!line) return ''
        const pause = typeof b.pause_after_seconds === 'number' && b.pause_after_seconds > 0 ? b.pause_after_seconds : 0
        return pause > 0 ? `${line} <break time="${pause}s"/>` : line
      })
      .filter(Boolean)
      .join(' ')
    if (!spokenText.trim()) {
      setManusError('Manuset innehåller ingen talbar dialog (bara regianvisningar?).')
      return
    }

    setManusGenerating(true)
    setManusError(null)
    setManusStatus(null)
    try {
      const videoUrl = await generateAvatarVideo({
        inputText: spokenText,
        avatarId: selectedAvatarId || undefined,
        voiceId: selectedVoiceId || undefined,
        onStatus: setManusStatus,
      })

      const id = `c${nextClipIdRef.current++}`
      setClips((prev) => [
        ...prev,
        {
          id,
          name: 'AI-avatar (manus)',
          publicUrl: videoUrl,
          transcript: null,
          transcribing: true,
          transcriptionSkipped: false,
          error: null,
        },
      ])
      setRenderedVideoUrl(null)
      setPreviewVideoUrl(null)
      setVideoFile(null)

      try {
        const result = await transcribeMp4Url(videoUrl)
        updateClip(id, { transcript: result })
      } catch (err) {
        updateClip(id, { error: err.message })
      }
      updateClip(id, { transcribing: false })
    } catch (err) {
      setManusError(err.message)
    }
    setManusGenerating(false)
  }

  async function handleGenerate(event) {
    event.preventDefault()
    if (!prompt.trim()) return

    setLoading(true)
    setError(null)
    setPlan(null)
    setRenderedVideoUrl(null)
    setPreviewVideoUrl(null)
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
    setThoughtBubblesEnabled(false)
    setThoughtBubbleXPercent(50)
    setThoughtBubbleYPercent(18)
    setGlowEnabled(false)
    setGlowXPercent(50)
    setGlowYPercent(50)
    setGlowRadiusPercent(10)
    setGlowStartSeconds(0)
    setGlowEndSeconds(3)
    setGlowColor('gold')
    setGlowIntensity('medium')
    setGlowPreviewFrame(null)
    setAdvancedOpen(false)
    setEditInstruction('')
    setReviseSummary(null)
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
        clips: clips.map((c) => ({ id: c.id, transcript: c.transcript?.segments ?? [] })),
        trendContext: [],
        previousBestClips,
        targetDurationSeconds: targetDuration ? Number(targetDuration) : null,
      })
      setPlan(result)
      setSelectedHookIndex(0)
      setSegmentEffects((result.segments_plan ?? []).map(() => ''))
      setSegmentFilters((result.segments_plan ?? []).map(() => ''))
      // Förifyllda med AI-förslaget (redigerbara direkt i fälten), till skillnad från
      // effekt/filter ovan som defaultar till "automatiskt"/"inget".
      setSegmentStarts((result.segments_plan ?? []).map((seg) => seg.start))
      setSegmentEnds((result.segments_plan ?? []).map((seg) => seg.end))
      setSegmentSpeeds((result.segments_plan ?? []).map(() => ''))
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
      // Manuell positionering/CSS, ingen AI-generering — taggas därför INTE som AI-genererat
      // innehåll (samma logik som tankebubblor, hook-text och undertexter).
      glow_effect: glowEnabled
        ? {
            enabled: true,
            x_percent: glowXPercent,
            y_percent: glowYPercent,
            radius_percent: glowRadiusPercent,
            start_seconds: glowStartSeconds,
            end_seconds: glowEndSeconds,
            color: glowColor,
            intensity: glowIntensity,
          }
        : null,
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

  // Delad av handleRender (skarp, betald rendering) och handlePreviewRender (gratis
  // sandbox-förhandsgranskning) — exakt samma redigering skickas till båda, bara `preview`
  // skiljer, så förhandsgranskningen garanterat stämmer med slutresultatet.
  function buildRenderParams() {
    const selectedHook = plan.hook_variants?.[selectedHookIndex]
    return {
      clips: clips
        .filter((c) => c.publicUrl)
        .map((c) => ({
          id: c.id,
          url: c.publicUrl,
          transcript: c.transcript?.segments ?? [],
          words: c.transcript?.words ?? [],
        })),
      segmentsPlan: plan.segments_plan ?? [],
      hookText: selectedHook?.text ?? '',
      suggestedSubtitles: plan.suggested_subtitles ?? [],
      brollVideoUrl,
      segmentEffects,
      segmentFilters,
      segmentStarts,
      segmentEnds,
      segmentSpeeds,
      effectVideoUrl,
      effectType,
      backgroundImageUrl: backgroundSwapEnabled ? backgroundImageUrl : null,
      backgroundMattedVideoUrl: backgroundSwapEnabled ? backgroundMattedVideoUrl : null,
      thoughtBubbles: plan.thought_bubbles ?? [],
      thoughtBubblesEnabled,
      thoughtBubbleXPercent,
      thoughtBubbleYPercent,
      glowEffect: glowEnabled
        ? {
            enabled: true,
            x_percent: glowXPercent,
            y_percent: glowYPercent,
            radius_percent: glowRadiusPercent,
            start_seconds: glowStartSeconds,
            end_seconds: glowEndSeconds,
            color: glowColor,
            intensity: glowIntensity,
          }
        : null,
    }
  }

  async function handlePreviewRender() {
    if (!plan || !hasUploadedClip) return
    if (glowEnabled && glowEndSeconds <= glowStartSeconds) {
      setError('Glow-effektens sluttid måste vara efter starttiden.')
      return
    }
    setPreviewRendering(true)
    setPreviewStatus('queued')
    setError(null)
    try {
      const url = await renderClip({
        ...buildRenderParams(),
        preview: true,
        onStatus: setPreviewStatus,
      })
      setPreviewVideoUrl(url)
    } catch (err) {
      setError(err.message)
    } finally {
      setPreviewRendering(false)
    }
  }

  async function handleRender() {
    if (!plan || !hasUploadedClip) return
    if (glowEnabled && glowEndSeconds <= glowStartSeconds) {
      setError('Glow-effektens sluttid måste vara efter starttiden.')
      return
    }
    setRendering(true)
    setRenderStatus('queued')
    setError(null)
    setVideoFile(null)

    try {
      const url = await renderClip({
        ...buildRenderParams(),
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
    setBackgroundImageStatus('PENDING')
    setError(null)
    try {
      const result = await generateBackgroundImage({
        customPrompt: backgroundCustomPrompt,
        onStatus: setBackgroundImageStatus,
      })
      setBackgroundImageUrl(result.imageUrl)
      setBackgroundPrompt(result.prompt)
    } catch (err) {
      setError(err.message)
    } finally {
      setBackgroundGenerating(false)
    }
  }

  async function handleMatteBackground() {
    if (!primaryClipUrl) return
    setBackgroundMatting(true)
    setBackgroundMatteStatus('PENDING')
    setError(null)
    try {
      const url = await matteVideo({ videoUrl: primaryClipUrl, onStatus: setBackgroundMatteStatus })
      setBackgroundMattedVideoUrl(url)
    } catch (err) {
      setError(err.message)
    } finally {
      setBackgroundMatting(false)
    }
  }

  // Hämtar en stillbild från källvideon vid klippets första segment, bara för att underlätta
  // placering av glow-effekten i förhandsvisningsrutan — används aldrig i själva renderingen.
  // Kan misslyckas (t.ex. om Supabase Storage-svaret saknar CORS-headers och canvasen blir
  // "tainted") utan att blockera funktionen — positionering fungerar ändå via procentvärden
  // mot en tom ruta med samma proportioner.
  async function handleCaptureGlowPreview() {
    if (!primaryClipUrl) return
    setGlowCapturing(true)
    setError(null)

    // iOS Safari kan misslyckas TYST (varken loadedmetadata/seeked eller error-eventet
    // fyras) med ett <video>-element som aldrig läggs till i dokumentet — avkodning/
    // rendering till canvas är opålitlig för "detached" videoelement där. Läggs till
    // osynligt (positionerat utanför skärmen, inte display:none — det kan också hindra
    // rendering) och tas bort igen i finally.
    const video = document.createElement('video')
    video.style.position = 'fixed'
    video.style.left = '-9999px'
    video.style.width = '1px'
    video.style.height = '1px'
    document.body.appendChild(video)

    try {
      const firstSegStart = parseTimecodeClient(plan?.segments_plan?.[0]?.start ?? '0:00')
      video.crossOrigin = 'anonymous'
      video.muted = true
      video.playsInline = true
      video.src = primaryClipUrl

      await Promise.race([
        new Promise((resolve, reject) => {
          video.addEventListener('loadedmetadata', () => {
            video.currentTime = Math.min(firstSegStart, Math.max(video.duration - 0.1, 0))
          })
          video.addEventListener('seeked', resolve, { once: true })
          video.addEventListener('error', () => reject(new Error('Kunde inte läsa videon för förhandsvisning.')))
        }),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Tog för lång tid att läsa videon.')), 8000)
        ),
      ])

      const canvas = document.createElement('canvas')
      canvas.width = video.videoWidth
      canvas.height = video.videoHeight
      const ctx = canvas.getContext('2d')
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
      setGlowPreviewFrame(canvas.toDataURL('image/jpeg', 0.85))
    } catch (err) {
      setError(
        `Kunde inte hämta en förhandsvisningsbild (${err.message}). Du kan fortfarande placera glöden mot en tom ruta med rätt proportioner.`,
      )
    } finally {
      video.remove()
      setGlowCapturing(false)
    }
  }

  // Hämtar en nedskalad bildruta per segment (max 480px bredd — Claude behöver bara grov
  // visuell kontext, inte full upplösning, och det håller anropsstorlek/kostnad nere), vid
  // varje segments mittpunkt, FRÅN RÄTT KLIPP (seg.clip_id — segment kan komma från olika
  // uppladdade klipp). Samma DOM-bilaga-teknik som handleCaptureGlowPreview (iOS Safari-
  // kompatibilitet). Ett video/canvas-par återanvänds, men video.src laddas om varje gång
  // klippet skiljer sig från föregående segments (annars samma element, ingen omladdning).
  async function captureGuidanceFrames(segmentsPlan) {
    const MAX_FRAMES = 6
    const targets = segmentsPlan.slice(0, MAX_FRAMES)

    const video = document.createElement('video')
    video.style.position = 'fixed'
    video.style.left = '-9999px'
    video.style.width = '1px'
    video.style.height = '1px'
    document.body.appendChild(video)

    try {
      video.crossOrigin = 'anonymous'
      video.muted = true
      video.playsInline = true

      const canvas = document.createElement('canvas')
      const ctx = canvas.getContext('2d')
      let loadedUrl = null
      const frames = []

      for (const seg of targets) {
        const clip = clips.find((c) => c.id === seg.clip_id) ?? clips[0]
        const url = clip?.publicUrl
        if (!url) continue

        if (url !== loadedUrl) {
          video.src = url
          await Promise.race([
            new Promise((resolve, reject) => {
              video.addEventListener('loadedmetadata', resolve, { once: true })
              video.addEventListener('error', () => reject(new Error('Kunde inte läsa videon.')), { once: true })
            }),
            new Promise((_, reject) => setTimeout(() => reject(new Error('Tog för lång tid att läsa videon.')), 8000)),
          ])
          loadedUrl = url
          const scale = Math.min(1, 480 / video.videoWidth)
          canvas.width = Math.round(video.videoWidth * scale)
          canvas.height = Math.round(video.videoHeight * scale)
        }

        const start = parseTimecodeClient(seg.start)
        const end = parseTimecodeClient(seg.end)
        const midpoint = (start + end) / 2
        await new Promise((resolve, reject) => {
          video.addEventListener('seeked', resolve, { once: true })
          video.addEventListener('error', () => reject(new Error('Kunde inte läsa videon.')), { once: true })
          video.currentTime = Math.min(Math.max(midpoint, 0), Math.max(video.duration - 0.1, 0))
        })
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
        // Bas64 utan "data:image/jpeg;base64,"-prefixet — edge functionen vill bara ha
        // själva datan (Claudes bild-content-block anger media_type separat).
        frames.push(canvas.toDataURL('image/jpeg', 0.6).split(',')[1])
      }
      return frames
    } finally {
      video.remove()
    }
  }

  async function handleReviseWithGuidance() {
    if (!plan || !hasUploadedClip || !editInstruction.trim()) return
    setRevisingPlan(true)
    setError(null)
    setReviseSummary(null)
    try {
      const frames = await captureGuidanceFrames(plan.segments_plan ?? [])
      const result = await revisePlan({
        segmentsPlan: plan.segments_plan ?? [],
        clips: clips.map((c) => ({ id: c.id, transcript: c.transcript?.segments ?? [] })),
        editInstruction,
        frames,
      })
      const newSegments = result.segments_plan
      setPlan((prev) => ({ ...prev, segments_plan: newSegments }))
      setSegmentStarts(newSegments.map((seg) => seg.start))
      setSegmentEnds(newSegments.map((seg) => seg.end))
      setSegmentSpeeds(
        Array.isArray(result.segment_speeds) && result.segment_speeds.length === newSegments.length
          ? result.segment_speeds
          : newSegments.map(() => ''),
      )
      // Segmentantalet kan ha ändrats (ihopslagna/borttagna/nya segment) — gamla effekt-/
      // filterval per index skulle annars kunna hamna fel mot de nya segmenten.
      setSegmentEffects(newSegments.map(() => ''))
      setSegmentFilters(newSegments.map(() => ''))
      setReviseSummary(result.summary ?? null)
      setEditInstruction('')
    } catch (err) {
      setError(err.message)
    } finally {
      setRevisingPlan(false)
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

  // Finns minst ett klipp med en publik URL (uppladdningen klar) — motsvarar den gamla
  // enkla mediaPublicUrl-kollen, fast över listan.
  const hasUploadedClip = clips.some((c) => c.publicUrl)
  // Klippet som "avancerade" tillval anchorade till segment 0 (glow-förhandsvisning,
  // bakgrundsbyte) ska utgå från — det uppladdade klipp som segment 0 i den aktuella planen
  // faktiskt kommer från, annars det först uppladdade (innan en plan finns, eller om
  // segment 0:s clip_id av någon anledning inte matchar något kvarvarande klipp).
  const primaryClip = clips.find((c) => c.id === plan?.segments_plan?.[0]?.clip_id) ?? clips[0] ?? null
  const primaryClipUrl = primaryClip?.publicUrl ?? null

  // Grov uppskattning av klippets totala längd (för glow-tidsintervallets gränser i UI:t) —
  // samma räknesätt som timelineCursor i render-clip.ts, men inte auktoritativt.
  const planTotalSeconds = (plan?.segments_plan ?? []).reduce((sum, seg, i) => {
    const start = parseTimecodeClient(segmentStarts[i] || seg.start)
    const end = parseTimecodeClient(segmentEnds[i] || seg.end)
    return sum + Math.max(end - start, 0.5)
  }, 0)

  // "Klippets sammansättning" — alla aktiva overlay-tillval som lager i EN gemensam canvas,
  // istället för utspridda i separata kort. Bara glow/tankebubbla är dragbara (badge/zone/
  // fullFrame är skrivskyddade referenser, se kommentaren på ClipCanvas för varför).
  const canvasLayers = [
    glowEnabled && {
      id: 'glow',
      kind: 'circle',
      x: glowXPercent,
      y: glowYPercent,
      radius: glowRadiusPercent,
      color: GLOW_DOT_COLORS[glowColor] ?? GLOW_DOT_COLORS.gold,
    },
    thoughtBubblesEnabled && {
      id: 'bubble',
      kind: 'marker',
      x: thoughtBubbleXPercent,
      y: thoughtBubbleYPercent,
      label: '💬 Tankebubbla',
    },
    effectEnabled && {
      id: 'effect',
      kind: 'badge',
      x: EFFECT_POSITION_HINTS[effectType]?.x ?? 50,
      y: EFFECT_POSITION_HINTS[effectType]?.y ?? 50,
      label: `✨ ${EFFECT_TYPE_OPTIONS.find((opt) => opt.value === effectType)?.label ?? 'AI-effekt'}`,
    },
    backgroundSwapEnabled && { id: 'background', kind: 'fullFrame', label: '🖼️ AI-bakgrund' },
    { id: 'hookZone', kind: 'zone', y: 50, height: 14, label: 'Hook (start)' },
    { id: 'captionZone', kind: 'zone', y: 88, height: 16, label: 'Undertexter' },
  ].filter(Boolean)

  function handleCanvasMove(id, x, y) {
    if (id === 'glow') {
      setGlowXPercent(x)
      setGlowYPercent(y)
    } else if (id === 'bubble') {
      setThoughtBubbleXPercent(x)
      setThoughtBubbleYPercent(y)
    }
  }

  function handleCanvasResize(id, radius) {
    if (id === 'glow') setGlowRadiusPercent(radius)
  }

  return (
    <div className="page">
      <header className="page-header">
        <h1>Klippstudio</h1>
      </header>

      {error && <p className="error-banner">{error}</p>}

      <div className="clip-form" style={{ marginBottom: 16 }}>
        <label>
          Manus (valfritt) — dialog + regianvisningar i hakparenteser, t.ex. &quot;[Lugn
          början – du sitter stilla] Har du någonsin känt...&quot;. En AI-avatar läser upp
          dialogen och blir ett klipp du kan bygga en klippningsplan från, precis som
          uppladdat råmaterial.
          <textarea
            rows={5}
            value={manusText}
            onChange={(e) => setManusText(e.target.value)}
            placeholder={'[Lugn början – du sitter stilla]\nHar du någonsin känt att någon var i rummet, fast du var ensam?'}
            disabled={manusParsing || manusGenerating}
          />
        </label>

        {avatarOptionsError && (
          <p className="clip-prompt">
            Kunde inte hämta avatar-/röstlistan från HeyGen ({avatarOptionsError}) — använder
            standardvalet från Netlify-miljövariablerna istället.
          </p>
        )}

        {(avatarOptions.length > 0 || voiceOptions.length > 0) && (
          <div className="form-grid">
            {avatarOptions.length > 0 && (
              <label>
                Avatar
                <select
                  value={selectedAvatarId}
                  onChange={(e) => setSelectedAvatarId(e.target.value)}
                  disabled={manusGenerating}
                >
                  <option value="">Standard (HEYGEN_AVATAR_ID)</option>
                  {avatarOptions.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {voiceOptions.length > 0 && (
              <label>
                Röst
                <select
                  value={selectedVoiceId}
                  onChange={(e) => setSelectedVoiceId(e.target.value)}
                  disabled={manusGenerating}
                >
                  <option value="">Standard (HEYGEN_VOICE_ID)</option>
                  {/* Servern (list-voices.ts) filtrerar redan till bara svenska + 10 engelska
                      röster — grupperat här bara för tydlighet i dropdownen. */}
                  <optgroup label="Svenska">
                    {voiceOptions
                      .filter((v) => v.language?.toLowerCase().includes('swedish'))
                      .map((v) => (
                        <option key={v.id} value={v.id}>
                          {v.name}
                          {v.supportPause ? ' — stödjer paus' : ''}
                        </option>
                      ))}
                  </optgroup>
                  <optgroup label="Engelska">
                    {voiceOptions
                      .filter((v) => v.language?.toLowerCase().includes('english'))
                      .map((v) => (
                        <option key={v.id} value={v.id}>
                          {v.name}
                          {v.supportPause ? ' — stödjer paus' : ''}
                        </option>
                      ))}
                  </optgroup>
                </select>
              </label>
            )}
          </div>
        )}

        <button
          type="button"
          className="btn-primary"
          style={{ marginTop: 8 }}
          onClick={handleParseManus}
          disabled={!manusText.trim() || manusParsing || manusGenerating}
        >
          {manusParsing ? 'Tolkar manus…' : 'Tolka manus'}
        </button>

        {manusError && <p className="error-banner">{manusError}</p>}

        {manusBeats && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 8 }}>
            {manusBeats.length === 0 ? (
              <p className="clip-prompt">Ingen talbar dialog hittades i manuset.</p>
            ) : (
              <>
                {manusBeats.map((beat, i) => (
                  <div key={i} className="clip-card" style={{ margin: 0 }}>
                    {beat.direction && <p className="clip-category">[{beat.direction}]</p>}
                    <p className="clip-prompt">{beat.line}</p>
                    {beat.pause_after_seconds > 0 && (
                      <p className="clip-prompt">⏸ Paus efter: {beat.pause_after_seconds}s</p>
                    )}
                  </div>
                ))}
                <button
                  type="button"
                  className="btn-primary"
                  style={{ marginTop: 8 }}
                  onClick={handleGenerateAvatarVideo}
                  disabled={manusGenerating}
                >
                  {manusGenerating
                    ? BROLL_STATUS_LABELS[manusStatus] ?? 'Genererar AI-avatar-video…'
                    : 'Generera AI-avatar-video'}
                </button>
              </>
            )}
          </div>
        )}
      </div>

      <form className="clip-form" onSubmit={handleGenerate}>
        <label>
          Råmaterial (video/ljud, valfritt — lägg till flera korta klipp för att klippa ihop dem)
          <input
            ref={fileInputRef}
            type="file"
            accept="video/*,audio/*"
            onChange={handleAddClip}
            disabled={clips.some((c) => c.transcribing)}
          />
        </label>

        {clips.some((c) => c.transcribing) && (
          <p className="placeholder-note">
            Transkriberar och laddar upp… (för .mov-filer konverteras videon server-side
            först, vilket kan ta ytterligare någon minut — lämna inte sidan)
          </p>
        )}

        {clips.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {clips.map((clip, i) => (
              <div key={clip.id} className="clip-card" style={{ margin: 0 }}>
                <div className="clip-card-header">
                  <span className="status-pill status-posted">
                    {clip.transcribing
                      ? clip.statusLabel || 'Bearbetar…'
                      : clip.publicUrl
                        ? 'Uppladdat'
                        : 'Väntar…'}
                  </span>
                  <span className="clip-category">
                    {i + 1}. {clip.name}
                  </span>
                </div>
                {clip.transcript && (
                  <p className="clip-prompt">{clip.transcript.text || 'Inget tal upptäcktes.'}</p>
                )}
                {clip.transcriptionSkipped && (
                  <p className="clip-prompt">
                    Filen är större än 25 MB — transkribering hoppades över (Whisper-gränsen är
                    satt av OpenAI, kan inte höjas). Klippningsplanen baseras på din prompt för
                    den här delen istället. Rendering fungerar som vanligt.
                  </p>
                )}
                {clip.error && <p className="error-banner">{clip.error}</p>}
                <button
                  type="button"
                  className="btn-danger"
                  onClick={() => handleRemoveClip(clip.id)}
                  disabled={clip.transcribing}
                >
                  Ta bort
                </button>
              </div>
            ))}
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
          {clips.some((c) => c.transcript)
            ? 'Klippningsplanen baseras på transkripten ovan tillsammans med din prompt.'
            : 'Ladda upp råmaterial för tidsstämplad transkribering, eller lämna tomt och basera planen enbart på prompten.'}
        </p>

        <button className="btn-primary" type="submit" disabled={loading || clips.some((c) => c.transcribing)}>
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
            {hasUploadedClip && (
              <p className="placeholder-note">
                Start-/sluttid (mm:ss) är AI:ns förslag men går att redigera direkt — t.ex. för
                att klippa bort för mycket material. Hastighet skapar slow-motion (under 1x)
                eller time-lapse-känsla (över 1x).
              </p>
            )}
            <ol style={{ margin: 0, paddingLeft: 20, display: 'flex', flexDirection: 'column', gap: 10 }}>
              {(plan.segments_plan ?? []).map((seg, i) => (
                <li key={i}>
                  <strong>
                    {seg.start}–{seg.end}
                  </strong>{' '}
                  {clips.length > 1 && (
                    <span style={{ color: 'var(--text-muted)' }}>
                      [{clips.find((c) => c.id === seg.clip_id)?.name ?? seg.clip_id}]{' '}
                    </span>
                  )}
                  {seg.description}
                  {hasUploadedClip && (
                    <div style={{ display: 'flex', gap: 8, marginTop: 4, flexWrap: 'wrap', alignItems: 'center' }}>
                      <input
                        type="text"
                        value={segmentStarts[i] ?? seg.start}
                        onChange={(e) => {
                          const next = [...segmentStarts]
                          next[i] = e.target.value
                          setSegmentStarts(next)
                        }}
                        aria-label="Starttid"
                        style={{ width: 64 }}
                      />
                      <span style={{ color: 'var(--text-muted)' }}>–</span>
                      <input
                        type="text"
                        value={segmentEnds[i] ?? seg.end}
                        onChange={(e) => {
                          const next = [...segmentEnds]
                          next[i] = e.target.value
                          setSegmentEnds(next)
                        }}
                        aria-label="Sluttid"
                        style={{ width: 64 }}
                      />
                      <select
                        value={segmentSpeeds[i] ?? ''}
                        onChange={(e) => {
                          const next = [...segmentSpeeds]
                          next[i] = e.target.value
                          setSegmentSpeeds(next)
                        }}
                        aria-label="Hastighet"
                      >
                        {SEGMENT_SPEED_OPTIONS.map((opt) => (
                          <option key={opt.value} value={opt.value}>
                            {opt.label}
                          </option>
                        ))}
                      </select>
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

          {hasUploadedClip && (
            <div className="clip-card" style={{ margin: 0 }}>
              <span className="clip-hook" style={{ display: 'block', marginBottom: 6 }}>
                Redigera med vägledning
              </span>
              <p className="clip-prompt" style={{ marginBottom: 10 }}>
                Beskriv i egna ord vad som ska ändras i klippet — Claude tolkar det och
                justerar segmentens start-/sluttider och hastighet åt dig, med hjälp av
                transkriptet och några nedskalade bildrutor från videon som visuell kontext.
                T.ex. "korta ner mittendelen", "sakta ner när jag säger den viktiga meningen",
                "klipp bort de första 3 sekunderna".
              </p>
              <textarea
                value={editInstruction}
                onChange={(e) => setEditInstruction(e.target.value)}
                rows={2}
                placeholder="Vad vill du ändra?"
                disabled={revisingPlan}
              />
              <button
                type="button"
                className="btn-primary"
                style={{ marginTop: 8 }}
                onClick={handleReviseWithGuidance}
                disabled={revisingPlan || !editInstruction.trim()}
              >
                {revisingPlan ? 'Redigerar…' : 'Redigera klippet'}
              </button>
              {reviseSummary && (
                <p style={{ color: 'var(--success)', marginTop: 8 }}>✓ {reviseSummary}</p>
              )}
              <p className="placeholder-note">
                Claude "ser" bara ett fåtal enskilda bildrutor, inte rörelse eller exakt
                tajming — fungerar bäst för önskemål kopplade till vad som SÄGS eller till
                klippets pacing, mindre bra för rent visuella önskemål ("klipp när jag vänder
                mig om"). Ändrar antal/gränser för segmenten, så manuella effekt-/filterval
                nollställs.
              </p>
            </div>
          )}

          {plan.suggested_subtitles?.length > 0 && (
            <div>
              <p style={{ color: 'var(--text-muted)', marginBottom: 6 }}>Föreslagna nyckelfraser</p>
              <p>{plan.suggested_subtitles.join(' · ')}</p>
              {clips.some((c) => c.transcript?.words?.length > 0) && (
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

          {hasUploadedClip && (
            <button
              type="button"
              className="btn-primary"
              onClick={() => setAdvancedOpen((v) => !v)}
              style={{ width: '100%' }}
            >
              {advancedOpen
                ? 'Dölj avancerat ▲'
                : 'Avancerat: B-roll, AI-effekt, bakgrundsbyte, tankebubblor, glow ▼'}
            </button>
          )}

          {advancedOpen && hasUploadedClip && (
            <div className="clip-card" style={{ margin: 0 }}>
              <span className="clip-hook" style={{ display: 'block', marginBottom: 6 }}>
                Klippets sammansättning
              </span>
              <p className="clip-prompt" style={{ marginBottom: 10 }}>
                Se hur tillvalen nedan placeras TILLSAMMANS, baserat på klippets första
                bildruta. Dra i glöden/tankebubblan för att flytta dem — AI-effekt,
                bakgrundsbyte, hook och undertexter visas bara som referens (Shotstack tillåter
                inte fri positionering för dem, bara förinställda lägen).
              </p>
              <button
                type="button"
                className="btn-primary"
                onClick={handleCaptureGlowPreview}
                disabled={glowCapturing}
              >
                {glowCapturing
                  ? 'Hämtar bildruta…'
                  : glowPreviewFrame
                    ? 'Uppdatera förhandsvisning'
                    : 'Visa förhandsvisning'}
              </button>
              <div style={{ marginTop: 12 }}>
                <ClipCanvas
                  previewFrame={glowPreviewFrame}
                  layers={canvasLayers}
                  onMoveLayer={handleCanvasMove}
                  onResizeLayer={handleCanvasResize}
                />
              </div>
            </div>
          )}

          {advancedOpen && plan.thought_bubbles?.length > 0 && (
            <div className="clip-card" style={{ margin: 0 }}>
              <label style={{ display: 'flex', alignItems: 'flex-start', gap: 10, cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={thoughtBubblesEnabled}
                  onChange={(e) => setThoughtBubblesEnabled(e.target.checked)}
                  style={{ marginTop: 4 }}
                />
                <span>
                  <span className="clip-hook" style={{ display: 'block' }}>
                    Tankebubblor (valfritt)
                  </span>
                  <span className="clip-prompt" style={{ display: 'block' }}>
                    Glödande textbubblor med korta "inre tankar" poppar upp ovanpå bilden, en per
                    segment: {plan.thought_bubbles.join(' · ')}
                  </span>
                </span>
              </label>
              {thoughtBubblesEnabled && (
                <p className="placeholder-note" style={{ marginTop: 8 }}>
                  Positionera tankebubblan i "Klippets sammansättning" ovan (dra i den).
                </p>
              )}
            </div>
          )}

          {advancedOpen && hasUploadedClip && (
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

          {advancedOpen && hasUploadedClip && (
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

          {advancedOpen && hasUploadedClip && (
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
                      {backgroundGenerating ? BROLL_STATUS_LABELS[backgroundImageStatus] ?? 'Genererar…' : 'Generera bakgrund'}
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

          {advancedOpen && hasUploadedClip && (
            <div className="clip-card" style={{ margin: 0 }}>
              <label style={{ display: 'flex', alignItems: 'flex-start', gap: 10, cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={glowEnabled}
                  onChange={(e) => {
                    setGlowEnabled(e.target.checked)
                    if (e.target.checked && planTotalSeconds > 0) {
                      setGlowEndSeconds(Math.min(3, planTotalSeconds))
                    }
                  }}
                  style={{ marginTop: 4 }}
                />
                <span>
                  <span className="clip-hook" style={{ display: 'block' }}>
                    Glow-effekt: få något att lysa (valfritt)
                  </span>
                  <span className="clip-prompt" style={{ display: 'block' }}>
                    Lägger en pulserande glöd ovanpå ett manuellt utvalt område — t.ex. en
                    tatuering, symbol eller ett föremål som ska se ut att lysa som ett
                    kraftmärke. Positionen är FAST under hela tidsintervallet (ingen
                    AI-spårning) — fungerar bäst när kameran/armen/föremålet hålls relativt
                    stilla i bild under sekvensen. Rör sig materialet mycket, använd extern
                    mjukvara (CapCut/DaVinci Resolve) för en spårad effekt istället.
                  </span>
                </span>
              </label>

              {glowEnabled && (
                <>
                  <p className="placeholder-note" style={{ marginTop: 8 }}>
                    Positionera/ändra storlek på glöden i "Klippets sammansättning" högre upp
                    (dra i cirkeln, dra i handtaget i hörnet för att ändra storlek).
                  </p>

                  <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 12 }}>
                    <label style={{ flex: '1 1 120px' }}>
                      Starttid (sek)
                      <input
                        type="number"
                        min={0}
                        step={0.5}
                        value={glowStartSeconds}
                        onChange={(e) => setGlowStartSeconds(Number(e.target.value))}
                      />
                    </label>
                    <label style={{ flex: '1 1 120px' }}>
                      Sluttid (sek)
                      <input
                        type="number"
                        min={0}
                        step={0.5}
                        value={glowEndSeconds}
                        onChange={(e) => setGlowEndSeconds(Number(e.target.value))}
                      />
                    </label>
                  </div>
                  {planTotalSeconds > 0 && (
                    <p className="placeholder-note">
                      Klippets ungefärliga totala längd: ca {Math.round(planTotalSeconds)}s.
                    </p>
                  )}

                  <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 8 }}>
                    <label style={{ flex: '1 1 120px' }}>
                      Färg
                      <select value={glowColor} onChange={(e) => setGlowColor(e.target.value)}>
                        {GLOW_COLOR_OPTIONS.map((opt) => (
                          <option key={opt.value} value={opt.value}>
                            {opt.label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label style={{ flex: '1 1 120px' }}>
                      Intensitet
                      <select value={glowIntensity} onChange={(e) => setGlowIntensity(e.target.value)}>
                        {GLOW_INTENSITY_OPTIONS.map((opt) => (
                          <option key={opt.value} value={opt.value}>
                            {opt.label}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                </>
              )}
            </div>
          )}

          {hasUploadedClip && !renderedVideoUrl && (
            <div className="clip-card" style={{ margin: 0 }}>
              <span className="clip-hook" style={{ display: 'block', marginBottom: 6 }}>
                Snabb förhandsgranskning (gratis)
              </span>
              <p className="clip-prompt" style={{ marginBottom: 10 }}>
                Renderar hela klippet — hook, undertexter, effekter, glow, allt — via
                Shotstacks gratis sandbox-miljö (lägre upplösning, vattenstämplad) så du kan
                SE det faktiska resultatet innan du kör den skarpa (betalda) renderingen
                nedan. Kostar inget och sparas inte i Bibliotek.
              </p>
              <button className="btn-primary" onClick={handlePreviewRender} disabled={previewRendering}>
                {previewRendering
                  ? RENDER_STATUS_LABELS[previewStatus] ?? 'Renderar…'
                  : previewVideoUrl
                    ? 'Uppdatera förhandsgranskning'
                    : 'Visa förhandsgranskning'}
              </button>
              {previewVideoUrl && (
                <video
                  src={previewVideoUrl}
                  controls
                  style={{ width: '100%', borderRadius: 12, marginTop: 10 }}
                />
              )}
            </div>
          )}

          {hasUploadedClip ? (
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
