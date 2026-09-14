import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabaseClient.js'
import { STATUS_LABELS } from '../constants.js'

// Riktig kalendervy (tidigare bara en platshållartext som väntade på TikTok-kopplingen) —
// efterfrågat direkt av användaren: vill se NÄR klipp faktiskt publicerats/schemalagts, plus
// ett förslag på näst bästa publiceringstid. Bygger helt på BEFINTLIGA fält i clips-tabellen
// (status/posted_at/scheduled_at/views_24h m.fl., se 0001_init_schema.sql och
// tiktokAdapter.js/Bibliotek.jsx som redan sätter dem) — ingen ny databastabell/migration
// behövdes, bara en ny läs-vy över samma data.

const WEEKDAY_LABELS = ['Måndag', 'Tisdag', 'Onsdag', 'Torsdag', 'Fredag', 'Lördag', 'Söndag']

const DAYPARTS = [
  { key: 'natt', label: 'Natt (00–06)', test: (h) => h < 6 },
  { key: 'morgon', label: 'Morgon (06–12)', test: (h) => h >= 6 && h < 12 },
  { key: 'dag', label: 'Mitt på dagen (12–17)', test: (h) => h >= 12 && h < 17 },
  { key: 'kvall', label: 'Kväll (17–24)', test: (h) => h >= 17 },
]

function daypartFor(hour) {
  return DAYPARTS.find((d) => d.test(hour))?.key ?? 'dag'
}

// Måndag som veckans första dag (svensk konvention) — JS egen getDay() har söndag som 0.
function mondayIndex(date) {
  return (date.getDay() + 6) % 7
}

function startOfWeek(date) {
  const d = new Date(date)
  d.setHours(0, 0, 0, 0)
  d.setDate(d.getDate() - mondayIndex(d))
  return d
}

function formatWeekLabel(weekStart) {
  const weekEnd = new Date(weekStart)
  weekEnd.setDate(weekEnd.getDate() + 6)
  const fmt = (d) => d.toLocaleDateString('sv-SE', { day: 'numeric', month: 'short' })
  return `Vecka ${fmt(weekStart)} – ${fmt(weekEnd)}`
}

function formatDateTime(iso) {
  return new Date(iso).toLocaleDateString('sv-SE', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export default function Kalender() {
  const [clips, setClips] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    supabase
      .from('clips')
      .select('*')
      .in('status', ['posted', 'scheduled'])
      .then(({ data, error: fetchError }) => {
        if (cancelled) return
        if (fetchError) {
          setError(fetchError.message)
        } else {
          setClips(data ?? [])
        }
        setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  // Grupperar klipp per kalendervecka (måndag–söndag), sorterat senaste vecka först — varje
  // klipp läggs under posted_at (redan publicerat) eller scheduled_at (planerat), vilket alltid
  // finns för klipp i status posted/scheduled (satt av tiktokAdapter.js).
  const weeks = useMemo(() => {
    const byWeek = new Map()
    for (const clip of clips) {
      const dateIso = clip.posted_at ?? clip.scheduled_at
      if (!dateIso) continue
      const date = new Date(dateIso)
      const weekStart = startOfWeek(date)
      const key = weekStart.toISOString()
      if (!byWeek.has(key)) byWeek.set(key, { weekStart, items: [] })
      byWeek.get(key).items.push({ clip, date })
    }
    return [...byWeek.values()]
      .map((w) => ({ ...w, items: w.items.sort((a, b) => b.date - a.date) }))
      .sort((a, b) => b.weekStart - a.weekStart)
  }, [clips])

  // Bästa publiceringstid enligt statistiken: grupperar PUBLICERADE klipp med både posted_at
  // och views_24h (dvs. "Uppdatera resultat" har körts minst en gång) på veckodag+dygnsdel,
  // och lyfter fram bucketen med högst snittvisningar. Kräver minst 3 sådana klipp — under det
  // är det mest slumpmässigt brus (och med mock-statistik, se varningen i UI:t, är det ÄNDÄ
  // bara en illustration av hur funktionen kommer fungera med riktig TikTok-statistik).
  const suggestion = useMemo(() => {
    const measured = clips.filter((c) => c.status === 'posted' && c.posted_at && c.views_24h != null)
    if (measured.length < 3) return null

    const buckets = new Map() // "weekday-daypart" -> { sum, count, weekday, daypart }
    for (const clip of measured) {
      const date = new Date(clip.posted_at)
      const weekday = mondayIndex(date)
      const daypart = daypartFor(date.getHours())
      const key = `${weekday}-${daypart}`
      const bucket = buckets.get(key) ?? { weekday, daypart, sum: 0, count: 0 }
      bucket.sum += clip.views_24h
      bucket.count += 1
      buckets.set(key, bucket)
    }

    const best = [...buckets.values()].sort((a, b) => b.sum / b.count - a.sum / a.count)[0]
    return {
      weekdayLabel: WEEKDAY_LABELS[best.weekday],
      daypartLabel: DAYPARTS.find((d) => d.key === best.daypart)?.label ?? best.daypart,
      avgViews: Math.round(best.sum / best.count),
      sampleSize: measured.length,
    }
  }, [clips])

  return (
    <div className="page">
      <header className="page-header">
        <h1>Kalender</h1>
      </header>

      {suggestion && (
        <div className="clip-card" style={{ marginBottom: 16 }}>
          <p className="clip-hook">
            📈 Bästa tiden att lägga ut enligt statistiken: {suggestion.weekdayLabel}, {suggestion.daypartLabel}
          </p>
          <p className="clip-prompt">
            Snitt {suggestion.avgViews.toLocaleString('sv-SE')} visningar (24h) i den tidsluckan, baserat på{' '}
            {suggestion.sampleSize} publicerade klipp.
          </p>
          <p className="clip-prompt">
            OBS: så länge TikTok-kopplingen är en mock (se Inställningar) är visningssiffrorna
            slumpmässigt genererade av "Uppdatera resultat (mock)" i Bibliotek — förslaget blir
            först meningsfullt när riktig TikTok-statistik kopplas in. Funktionen fungerar
            annars redan likadant då.
          </p>
        </div>
      )}

      {error && <p className="error-banner">{error}</p>}

      {loading ? (
        <p>Laddar…</p>
      ) : weeks.length === 0 ? (
        <p className="empty-state">
          Inga publicerade eller schemalagda klipp än. Publicera ett klipp i Bibliotek så dyker det
          upp här.
        </p>
      ) : (
        weeks.map((week) => (
          <div key={week.weekStart.toISOString()} style={{ marginBottom: 20 }}>
            <p style={{ color: 'var(--text-muted)', fontWeight: 600, margin: '0 0 8px' }}>
              {formatWeekLabel(week.weekStart)}
            </p>
            <ul className="clip-list">
              {week.items.map(({ clip, date }) => (
                <li key={clip.id} className="clip-card">
                  <div className="clip-card-header">
                    <span className={`status-pill status-${clip.status}`}>
                      {STATUS_LABELS[clip.status] ?? clip.status}
                    </span>
                    <span className="clip-category">{clip.category}</span>
                  </div>
                  <p className="clip-prompt">{formatDateTime(date)}</p>
                  {clip.hook_text && <p className="clip-hook">"{clip.hook_text}"</p>}
                  {clip.status === 'posted' && (
                    <div className="clip-stats">
                      <span>👁 {clip.views_24h ?? '–'}</span>
                      <span>⏱ {clip.avg_watch_pct != null ? `${clip.avg_watch_pct}%` : '–'}</span>
                      <span>🔁 {clip.shares ?? '–'}</span>
                      <span>💬 {clip.comments ?? '–'}</span>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </div>
        ))
      )}
    </div>
  )
}
