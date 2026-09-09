import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabaseClient.js'
import { tiktokAdapter } from '../lib/tiktokAdapter.js'
import { embedAndStoreClip } from '../lib/clipHistory.js'
import { CATEGORIES, STATUSES, STATUS_LABELS } from '../constants.js'

const EMPTY_FORM = {
  prompt: '',
  category: CATEGORIES[0],
  subtopic: '',
  hook_text: '',
  status: 'draft',
  views_24h: '',
  avg_watch_pct: '',
  shares: '',
  comments: '',
}

const SORTS = {
  newest: { label: 'Senaste', column: 'created_at', ascending: false },
  views: { label: 'Flest visningar', column: 'views_24h', ascending: false },
  watch: { label: 'Bäst retention', column: 'avg_watch_pct', ascending: false },
}

export default function Bibliotek() {
  const [clips, setClips] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [sortKey, setSortKey] = useState('newest')
  const [filterCategory, setFilterCategory] = useState('alla')
  const [busyClipId, setBusyClipId] = useState(null)

  async function loadClips(sort = sortKey) {
    setLoading(true)
    setError(null)
    const { column, ascending } = SORTS[sort]
    const { data, error: fetchError } = await supabase
      .from('clips')
      .select('*')
      .order(column, { ascending, nullsFirst: false })

    if (fetchError) {
      setError(fetchError.message)
    } else {
      setClips(data ?? [])
    }
    setLoading(false)
  }

  useEffect(() => {
    loadClips(sortKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sortKey])

  const visibleClips = useMemo(() => {
    if (filterCategory === 'alla') return clips
    return clips.filter((clip) => clip.category === filterCategory)
  }, [clips, filterCategory])

  function updateField(field, value) {
    setForm((prev) => ({ ...prev, [field]: value }))
  }

  async function handleSubmit(event) {
    event.preventDefault()
    setSaving(true)
    setError(null)

    const payload = {
      prompt: form.prompt || null,
      category: form.category,
      subtopic: form.subtopic || null,
      hook_text: form.hook_text || null,
      status: form.status,
      views_24h: form.views_24h === '' ? null : Number(form.views_24h),
      avg_watch_pct: form.avg_watch_pct === '' ? null : Number(form.avg_watch_pct),
      shares: form.shares === '' ? null : Number(form.shares),
      comments: form.comments === '' ? null : Number(form.comments),
    }

    const { data: inserted, error: insertError } = await supabase
      .from('clips')
      .insert(payload)
      .select()
      .single()

    setSaving(false)

    if (insertError) {
      setError(insertError.message)
      return
    }

    setForm(EMPTY_FORM)
    setShowForm(false)
    loadClips()

    // Embedding för framtida retrieval (steg 10) — icke-kritiskt.
    embedAndStoreClip(inserted.id, {
      prompt: payload.prompt,
      hookText: payload.hook_text,
      category: payload.category,
      subtopic: payload.subtopic,
    }).catch((err) => console.warn('Kunde inte spara embedding för klippet:', err))
  }

  async function handleDelete(id) {
    const { error: deleteError } = await supabase.from('clips').delete().eq('id', id)
    if (deleteError) {
      setError(deleteError.message)
      return
    }
    setClips((prev) => prev.filter((clip) => clip.id !== id))
  }

  async function handlePublish(clip) {
    setBusyClipId(clip.id)
    setError(null)
    try {
      await tiktokAdapter.publishClip(clip)
      await loadClips()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusyClipId(null)
    }
  }

  async function handleFetchStats(clip) {
    setBusyClipId(clip.id)
    setError(null)
    try {
      await tiktokAdapter.fetchStats(clip)
      await loadClips()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusyClipId(null)
    }
  }

  return (
    <div className="page">
      <header className="page-header">
        <h1>Bibliotek</h1>
        <button className="btn-primary" onClick={() => setShowForm((v) => !v)}>
          {showForm ? 'Stäng' : '+ Nytt klipp'}
        </button>
      </header>

      {error && <p className="error-banner">{error}</p>}

      {showForm && (
        <form className="clip-form" onSubmit={handleSubmit}>
          <label>
            Prompt / idé
            <textarea
              value={form.prompt}
              onChange={(e) => updateField('prompt', e.target.value)}
              rows={2}
              placeholder="T.ex. 3 tecken på att en själ försöker nå dig"
            />
          </label>

          <label>
            Kategori
            <select value={form.category} onChange={(e) => updateField('category', e.target.value)}>
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
              value={form.subtopic}
              onChange={(e) => updateField('subtopic', e.target.value)}
              placeholder="Fritext"
            />
          </label>

          <label>
            Hook-text
            <input
              type="text"
              value={form.hook_text}
              onChange={(e) => updateField('hook_text', e.target.value)}
              placeholder="Den första raden i klippet"
            />
          </label>

          <label>
            Status
            <select value={form.status} onChange={(e) => updateField('status', e.target.value)}>
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {STATUS_LABELS[s]}
                </option>
              ))}
            </select>
          </label>

          <div className="form-grid">
            <label>
              Visningar (24h)
              <input
                type="number"
                min="0"
                value={form.views_24h}
                onChange={(e) => updateField('views_24h', e.target.value)}
              />
            </label>
            <label>
              Snitt-tittartid (%)
              <input
                type="number"
                min="0"
                max="100"
                step="0.1"
                value={form.avg_watch_pct}
                onChange={(e) => updateField('avg_watch_pct', e.target.value)}
              />
            </label>
            <label>
              Delningar
              <input
                type="number"
                min="0"
                value={form.shares}
                onChange={(e) => updateField('shares', e.target.value)}
              />
            </label>
            <label>
              Kommentarer
              <input
                type="number"
                min="0"
                value={form.comments}
                onChange={(e) => updateField('comments', e.target.value)}
              />
            </label>
          </div>

          <button className="btn-primary" type="submit" disabled={saving}>
            {saving ? 'Sparar…' : 'Spara klipp'}
          </button>
        </form>
      )}

      <div className="filter-row">
        <select value={sortKey} onChange={(e) => setSortKey(e.target.value)}>
          {Object.entries(SORTS).map(([key, { label }]) => (
            <option key={key} value={key}>
              {label}
            </option>
          ))}
        </select>

        <select value={filterCategory} onChange={(e) => setFilterCategory(e.target.value)}>
          <option value="alla">Alla kategorier</option>
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </div>

      {loading ? (
        <p>Laddar…</p>
      ) : visibleClips.length === 0 ? (
        <p className="empty-state">Inga klipp ännu. Lägg till ditt första klipp ovan.</p>
      ) : (
        <ul className="clip-list">
          {visibleClips.map((clip) => (
            <li key={clip.id} className="clip-card">
              <div className="clip-card-header">
                <span className={`status-pill status-${clip.status}`}>
                  {STATUS_LABELS[clip.status] ?? clip.status}
                </span>
                <span className="clip-category">{clip.category}</span>
              </div>
              {clip.hook_text && <p className="clip-hook">"{clip.hook_text}"</p>}
              {clip.prompt && <p className="clip-prompt">{clip.prompt}</p>}
              {clip.subtopic && <p className="clip-subtopic">#{clip.subtopic}</p>}
              <div className="clip-stats">
                <span>👁 {clip.views_24h ?? '–'}</span>
                <span>⏱ {clip.avg_watch_pct != null ? `${clip.avg_watch_pct}%` : '–'}</span>
                <span>🔁 {clip.shares ?? '–'}</span>
                <span>💬 {clip.comments ?? '–'}</span>
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {clip.status === 'draft' && (
                  <button
                    className="btn-primary"
                    onClick={() => handlePublish(clip)}
                    disabled={busyClipId === clip.id}
                  >
                    {busyClipId === clip.id ? 'Publicerar…' : 'Publicera (mock)'}
                  </button>
                )}
                {clip.status === 'posted' && (
                  <button
                    className="btn-primary"
                    onClick={() => handleFetchStats(clip)}
                    disabled={busyClipId === clip.id}
                  >
                    {busyClipId === clip.id ? 'Hämtar…' : 'Uppdatera resultat (mock)'}
                  </button>
                )}
                <button className="btn-danger" onClick={() => handleDelete(clip.id)}>
                  Ta bort
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
