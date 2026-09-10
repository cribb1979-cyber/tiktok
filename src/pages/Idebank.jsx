import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient.js'
import { CATEGORIES } from '../constants.js'

const EMPTY_FORM = { hashtag: '', sound_name: '', sound_url: '', category: '' }

// Ord som ofta följer med när man kopierar en hashtag-lista från TikTok Creative Center
// (kolumnrubriker, statistik) — filtreras bort så bara faktiska hashtags blir kvar.
const PASTE_NOISE_WORDS = new Set([
  'views',
  'posts',
  'videos',
  'creators',
  'new',
  'trending',
  'rank',
  'growth',
  'popularity',
  'weekly',
  'daily',
  'monthly',
  'industry',
  'all',
  'overview',
  'hashtag',
  'hashtags',
  'sound',
  'sounds',
  'music',
  'use',
  'uses',
  'engagement',
  'ctr',
  'impressions',
  'top',
])

// Tolkar inklistrad text (t.ex. kopierad direkt från TikTok Creative Centers hashtag-lista)
// till en lista av kandidat-hashtags — en per rad eller kommaseparerat, "#" och
// statistik-/rubrikrader (t.ex. "12.3M", "Views") filtreras bort.
function parsePastedHashtags(text) {
  const lines = text
    .split(/[\n,]+/)
    .map((line) => line.trim().replace(/^#/, ''))
    .filter(Boolean)

  const cleaned = lines.filter((word) => {
    if (/^[\d.,]+[kmb]?%?$/i.test(word)) return false
    if (PASTE_NOISE_WORDS.has(word.toLowerCase())) return false
    if (!/^[\p{L}\p{N}_]+$/u.test(word)) return false
    return true
  })

  return Array.from(new Set(cleaned.map((w) => w.toLowerCase())))
}

function buildPromptFromTrend(trend) {
  const parts = [trend.hashtag ? `Skapa ett klipp inspirerat av trenden #${trend.hashtag}` : 'Skapa ett klipp inspirerat av dagens trend']
  if (trend.sound_name) parts.push(`med ljudet "${trend.sound_name}"`)
  return parts.join(' ') + '.'
}

function formatDate(iso) {
  if (!iso) return ''
  return new Date(iso).toLocaleDateString('sv-SE', { day: 'numeric', month: 'short' })
}

export default function Idebank() {
  const navigate = useNavigate()

  const [trends, setTrends] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [currentIndex, setCurrentIndex] = useState(0)

  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState(EMPTY_FORM)
  const [saving, setSaving] = useState(false)

  // Klistra in en hashtag-lista (t.ex. från TikTok Creative Center) och välj vilka som ska
  // sparas — istället för att skriva in en och en.
  const [showBulkForm, setShowBulkForm] = useState(false)
  const [bulkText, setBulkText] = useState('')
  const [candidates, setCandidates] = useState([])
  const [selectedCandidates, setSelectedCandidates] = useState(new Set())
  const [bulkCategory, setBulkCategory] = useState('')
  const [bulkSaving, setBulkSaving] = useState(false)

  async function loadTrends() {
    setLoading(true)
    setError(null)
    const { data, error: fetchError } = await supabase
      .from('trend_snapshots')
      .select('*')
      .order('fetched_at', { ascending: false })

    if (fetchError) {
      setError(fetchError.message)
    } else {
      setTrends(data ?? [])
    }
    setLoading(false)
  }

  useEffect(() => {
    loadTrends()
  }, [])

  function updateField(field, value) {
    setForm((prev) => ({ ...prev, [field]: value }))
  }

  async function handleAddTrend(event) {
    event.preventDefault()
    setSaving(true)
    setError(null)

    const { error: insertError } = await supabase.from('trend_snapshots').insert({
      hashtag: form.hashtag || null,
      sound_name: form.sound_name || null,
      sound_url: form.sound_url || null,
      category: form.category || null,
    })

    setSaving(false)

    if (insertError) {
      setError(insertError.message)
      return
    }

    setForm(EMPTY_FORM)
    setShowForm(false)
    setCurrentIndex(0)
    loadTrends()
  }

  function handleParseBulk() {
    setCandidates(parsePastedHashtags(bulkText))
    setSelectedCandidates(new Set())
  }

  function toggleCandidate(word) {
    setSelectedCandidates((prev) => {
      const next = new Set(prev)
      if (next.has(word)) {
        next.delete(word)
      } else {
        next.add(word)
      }
      return next
    })
  }

  async function handleSaveSelectedCandidates() {
    if (selectedCandidates.size === 0) return
    setBulkSaving(true)
    setError(null)

    const rows = Array.from(selectedCandidates).map((hashtag) => ({
      hashtag,
      category: bulkCategory || null,
    }))

    const { error: insertError } = await supabase.from('trend_snapshots').insert(rows)

    setBulkSaving(false)

    if (insertError) {
      setError(insertError.message)
      return
    }

    setBulkText('')
    setCandidates([])
    setSelectedCandidates(new Set())
    setShowBulkForm(false)
    setCurrentIndex(0)
    loadTrends()
  }

  function handleDismiss() {
    setCurrentIndex((i) => i + 1)
  }

  function handleBuildOn(trend) {
    const prefillCategory = CATEGORIES.includes(trend.category) ? trend.category : undefined
    navigate('/studio', {
      state: {
        prefillPrompt: buildPromptFromTrend(trend),
        prefillCategory,
      },
    })
  }

  const currentTrend = trends[currentIndex]

  return (
    <div className="page">
      <header className="page-header">
        <h1>Idébank</h1>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn-primary" onClick={() => setShowBulkForm((v) => !v)}>
            {showBulkForm ? 'Stäng' : 'Klistra in trender'}
          </button>
          <button className="btn-primary" onClick={() => setShowForm((v) => !v)}>
            {showForm ? 'Stäng' : '+ Lägg till trend'}
          </button>
        </div>
      </header>

      {error && <p className="error-banner">{error}</p>}

      {showBulkForm && (
        <div className="clip-form">
          <label>
            Klistra in hashtags (t.ex. kopierat från TikTok Creative Center)
            <textarea
              value={bulkText}
              onChange={(e) => setBulkText(e.target.value)}
              rows={4}
              placeholder={'En hashtag per rad eller kommaseparerat, t.ex.:\n#andlighet\n#tarot\n#fyp'}
            />
          </label>
          <button
            type="button"
            className="btn-primary"
            onClick={handleParseBulk}
            disabled={!bulkText.trim()}
          >
            Tolka text
          </button>

          {candidates.length > 0 && (
            <>
              <p style={{ color: 'var(--text-muted)', marginBottom: 6 }}>
                Välj vilka som ska sparas som trender ({selectedCandidates.size} valda)
              </p>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {candidates.map((word) => (
                  <button
                    key={word}
                    type="button"
                    onClick={() => toggleCandidate(word)}
                    className="status-pill"
                    style={{
                      cursor: 'pointer',
                      border: '1px solid var(--border)',
                      background: selectedCandidates.has(word) ? 'var(--accent)' : 'transparent',
                      color: selectedCandidates.has(word) ? '#fff' : 'inherit',
                    }}
                  >
                    #{word}
                  </button>
                ))}
              </div>

              <label>
                Kategori (valfritt, sätts på alla valda)
                <select value={bulkCategory} onChange={(e) => setBulkCategory(e.target.value)}>
                  <option value="">Ingen/okänd</option>
                  {CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </label>

              <button
                type="button"
                className="btn-primary"
                onClick={handleSaveSelectedCandidates}
                disabled={selectedCandidates.size === 0 || bulkSaving}
              >
                {bulkSaving ? 'Sparar…' : `Spara ${selectedCandidates.size} valda trender`}
              </button>
            </>
          )}
        </div>
      )}

      {showForm && (
        <form className="clip-form" onSubmit={handleAddTrend}>
          <label>
            Hashtag
            <input
              type="text"
              value={form.hashtag}
              onChange={(e) => updateField('hashtag', e.target.value)}
              placeholder="T.ex. andevärlden"
            />
          </label>

          <label>
            Ljud (namn)
            <input
              type="text"
              value={form.sound_name}
              onChange={(e) => updateField('sound_name', e.target.value)}
              placeholder="Namnet på trendande ljud/låt"
            />
          </label>

          <label>
            Ljud-URL
            <input
              type="text"
              value={form.sound_url}
              onChange={(e) => updateField('sound_url', e.target.value)}
              placeholder="Länk till ljudet på TikTok (valfritt)"
            />
          </label>

          <label>
            Kategori
            <select value={form.category} onChange={(e) => updateField('category', e.target.value)}>
              <option value="">Ingen/okänd</option>
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>

          <button className="btn-primary" type="submit" disabled={saving}>
            {saving ? 'Sparar…' : 'Spara trend'}
          </button>
        </form>
      )}

      {loading ? (
        <p>Laddar…</p>
      ) : trends.length === 0 ? (
        <p className="empty-state">
          Inga trender ännu. Lägg till dagens hashtags/ljud ovan för att komma igång — riktig
          skrapning av trenddata kopplas på i ett senare steg.
        </p>
      ) : !currentTrend ? (
        <div className="clip-card">
          <p className="clip-prompt">Du har gått igenom alla trender för nu.</p>
          <button className="btn-primary" onClick={() => setCurrentIndex(0)}>
            Börja om
          </button>
        </div>
      ) : (
        <div className="clip-card">
          <div className="clip-card-header">
            <span className="status-pill status-draft">{currentTrend.category || 'Okategoriserad'}</span>
            <span className="clip-category">{formatDate(currentTrend.fetched_at)}</span>
          </div>
          {currentTrend.hashtag && <p className="clip-hook">#{currentTrend.hashtag}</p>}
          {currentTrend.sound_name && <p className="clip-prompt">🎵 {currentTrend.sound_name}</p>}
          {!currentTrend.hashtag && !currentTrend.sound_name && (
            <p className="clip-prompt">Ingen hashtag eller ljud angivet för denna trend.</p>
          )}

          <div style={{ display: 'flex', gap: 10, marginTop: 12 }}>
            <button className="btn-danger" style={{ flex: 1 }} onClick={handleDismiss}>
              Hoppa över
            </button>
            <button className="btn-primary" style={{ flex: 1 }} onClick={() => handleBuildOn(currentTrend)}>
              Bygg vidare
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
