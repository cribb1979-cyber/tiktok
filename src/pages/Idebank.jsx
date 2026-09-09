import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient.js'
import { CATEGORIES } from '../constants.js'

const EMPTY_FORM = { hashtag: '', sound_name: '', sound_url: '', category: '' }

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
        <button className="btn-primary" onClick={() => setShowForm((v) => !v)}>
          {showForm ? 'Stäng' : '+ Lägg till trend'}
        </button>
      </header>

      {error && <p className="error-banner">{error}</p>}

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
