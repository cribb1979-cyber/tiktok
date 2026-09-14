import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { uploadRawClip } from '../lib/storage.js'
import { useFileInputFallback } from '../lib/useFileInputFallback.js'
import { renderSlideshow } from '../lib/slideshowClient.js'
import { listGeneratedContent } from '../lib/generatedContent.js'
import { fetchVideoAsFile, shareVideoFile } from '../lib/saveVideo.js'
import { useWakeLock } from '../lib/useWakeLock.js'

// Bildspel: fristående verktyg efterfrågat direkt av användaren efter musikgenereringen —
// "nu kan jag generera musik, så vill jag kunna lägga bilder med text... bilderna som blir en
// video och musiken på de". Till skillnad från AI-kortfilm (AI-genererade bilder + rörelse)
// är det här HELT egna, uppladdade stillbilder — appen sammanställer dem bara till en video
// (render-slideshow.ts/Shotstack) med valfri text per bild och valfri musik under, hämtad
// från "Genererat innehåll"-biblioteket (samma musik som /musik eller Klippstudio genererat).
// Samma "generera → förhandsgranska → spara/dela"-mönster som Broll.jsx/Musik.jsx — sparas
// INTE i Bibliotek (samma medvetna avgränsning som de andra fristående verktygen).

const DURATION_OPTIONS = [2, 3, 4, 5, 6].map((s) => ({ value: s, label: `${s} sekunder/bild` }))

const RENDER_STATUS_LABELS = {
  queued: 'I kö…',
  fetching: 'Förbereder…',
  rendering: 'Renderar…',
  saving: 'Sparar…',
}

export default function Bildspel() {
  const [images, setImages] = useState([]) // { id, url, uploading, error, caption }
  const [durationPerImageSeconds, setDurationPerImageSeconds] = useState(3)
  const [savedMusic, setSavedMusic] = useState([])
  const [musicLoading, setMusicLoading] = useState(true)
  const [selectedMusicUrl, setSelectedMusicUrl] = useState('')
  const [rendering, setRendering] = useState(false)
  const [status, setStatus] = useState(null)
  const [renderedVideoUrl, setRenderedVideoUrl] = useState(null)
  const [error, setError] = useState(null)
  const [preparingSave, setPreparingSave] = useState(false)
  const [readyFile, setReadyFile] = useState(null)

  const imageInputRef = useRef(null)
  const nextIdRef = useRef(0)

  // Håller skärmen tänd under uppladdning/rendering (se useWakeLock.js) — annars kan skärmen
  // självslockna av inaktivitet och avbryta pollningsloopen mitt i.
  useWakeLock(images.some((img) => img.uploading) || rendering)

  useEffect(() => {
    let cancelled = false
    listGeneratedContent('music')
      .then((data) => {
        if (!cancelled) setSavedMusic(data)
      })
      .catch(() => {
        // Icke-kritiskt — musikväljaren visar bara "ingen sparad musik" om det här felar,
        // bildspelet fungerar fint utan musik.
      })
      .finally(() => {
        if (!cancelled) setMusicLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  async function handleAddImage(file) {
    if (!file) return
    const id = `img${nextIdRef.current++}`
    setImages((prev) => [...prev, { id, url: null, uploading: true, error: null, caption: '' }])
    try {
      const publicUrl = await uploadRawClip(file)
      setImages((prev) => prev.map((img) => (img.id === id ? { ...img, url: publicUrl, uploading: false } : img)))
    } catch (err) {
      setImages((prev) => prev.map((img) => (img.id === id ? { ...img, uploading: false, error: err.message } : img)))
    }
  }
  // Se kommentaren i useFileInputFallback.js — skyddsnät mot en bekräftad iOS Safari-bugg där
  // input[type=file]'s "change" ibland aldrig avfyras när man väljer från Fotobiblioteket.
  const handleAddImageChange = useFileInputFallback(imageInputRef, handleAddImage)

  function updateCaption(id, caption) {
    setImages((prev) => prev.map((img) => (img.id === id ? { ...img, caption } : img)))
  }

  function removeImage(id) {
    setImages((prev) => prev.filter((img) => img.id !== id))
  }

  function moveImage(id, direction) {
    setImages((prev) => {
      const index = prev.findIndex((img) => img.id === id)
      const newIndex = index + direction
      if (newIndex < 0 || newIndex >= prev.length) return prev
      const next = [...prev]
      ;[next[index], next[newIndex]] = [next[newIndex], next[index]]
      return next
    })
  }

  async function handleRender() {
    const readyImages = images.filter((img) => img.url)
    if (readyImages.length === 0) return
    setRendering(true)
    setStatus('queued')
    setError(null)
    setRenderedVideoUrl(null)
    try {
      const url = await renderSlideshow({
        images: readyImages.map((img) => ({ url: img.url, caption: img.caption })),
        durationPerImageSeconds,
        musicAudioUrl: selectedMusicUrl || undefined,
        onStatus: setStatus,
      })
      setRenderedVideoUrl(url)
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
      const file = await fetchVideoAsFile(renderedVideoUrl, 'bildspel.mp4')
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

  const hasReadyImages = images.some((img) => img.url)
  const anyUploading = images.some((img) => img.uploading)

  return (
    <div className="page">
      <header className="page-header">
        <h1>Bildspel</h1>
      </header>

      <p className="placeholder-note">
        Ladda upp egna bilder, lägg till text på varje bild om du vill, och få en färdig video
        med (valfri) AI-genererad musik under — dina egna foton, ingen AI-bildgenerering
        inblandad. Musiken hämtas från "Genererat innehåll" — skapa en låt i{' '}
        <Link to="/musik">Musik</Link> först om du inte redan har en sparad.
      </p>

      {!renderedVideoUrl ? (
        <>
          <div className="clip-card">
            <p className="clip-category">Bilder ({images.length})</p>
            {images.map((img, i) => (
              <div key={img.id} className="clip-card" style={{ margin: '8px 0' }}>
                {img.uploading ? (
                  <p className="clip-prompt">Laddar upp…</p>
                ) : img.error ? (
                  <p className="error-banner">{img.error}</p>
                ) : (
                  <img
                    src={img.url}
                    alt=""
                    style={{ width: '100%', maxHeight: 200, objectFit: 'cover', borderRadius: 10 }}
                  />
                )}
                <label style={{ display: 'block', marginTop: 6 }}>
                  Text på bilden (valfritt)
                  <input
                    type="text"
                    value={img.caption}
                    onChange={(e) => updateCaption(img.id, e.target.value)}
                    placeholder="T.ex. en kort rad text"
                  />
                </label>
                <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                  <button type="button" className="btn-primary" onClick={() => moveImage(img.id, -1)} disabled={i === 0}>
                    ↑
                  </button>
                  <button
                    type="button"
                    className="btn-primary"
                    onClick={() => moveImage(img.id, 1)}
                    disabled={i === images.length - 1}
                  >
                    ↓
                  </button>
                  <button type="button" className="btn-danger" onClick={() => removeImage(img.id)}>
                    Ta bort
                  </button>
                </div>
              </div>
            ))}
            <label style={{ display: 'block', marginTop: 8 }}>
              Lägg till bild
              <input ref={imageInputRef} type="file" accept="image/*" onChange={handleAddImageChange} />
            </label>
          </div>

          <div className="clip-form">
            <label>
              Längd per bild
              <select
                value={durationPerImageSeconds}
                onChange={(e) => setDurationPerImageSeconds(Number(e.target.value))}
              >
                {DURATION_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </label>

            <label>
              Musik (valfritt)
              {musicLoading ? (
                <p className="clip-prompt">Laddar sparad musik…</p>
              ) : savedMusic.length === 0 ? (
                <p className="clip-prompt">
                  Ingen sparad musik än. <Link to="/musik">Skapa en låt</Link> så dyker den upp här.
                </p>
              ) : (
                <select value={selectedMusicUrl} onChange={(e) => setSelectedMusicUrl(e.target.value)}>
                  <option value="">Ingen musik</option>
                  {savedMusic.map((item) => (
                    <option key={item.id} value={item.media_url}>
                      {item.prompt || 'Namnlös låt'}
                    </option>
                  ))}
                </select>
              )}
            </label>

            <button
              className="btn-primary"
              onClick={handleRender}
              disabled={!hasReadyImages || anyUploading || rendering}
            >
              {rendering ? RENDER_STATUS_LABELS[status] ?? 'Renderar…' : 'Skapa bildspel'}
            </button>
          </div>
        </>
      ) : (
        <div className="clip-card">
          <video src={renderedVideoUrl} controls style={{ width: '100%', borderRadius: 10 }} />
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
            {readyFile ? (
              <button className="btn-primary" onClick={handleShare}>
                Spara video till telefonen
              </button>
            ) : (
              <button className="btn-primary" onClick={handlePrepareSave} disabled={preparingSave}>
                {preparingSave ? 'Förbereder…' : 'Förbered för sparning'}
              </button>
            )}
            <button
              className="btn-primary"
              onClick={() => {
                setRenderedVideoUrl(null)
                setReadyFile(null)
              }}
            >
              Skapa ett nytt
            </button>
          </div>
        </div>
      )}

      {error && <p className="error-banner">{error}</p>}
    </div>
  )
}
