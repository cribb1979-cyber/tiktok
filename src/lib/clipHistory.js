import { supabase } from './supabaseClient.js'

// Steg 9: hämtar tidigare bäst presterande publicerade klipp i samma kategori, för
// few-shot-kontext i Claude-anropet. Enkel filtrering + sortering på visningar — semantisk
// retrieval (pgvector) kopplas på i steg 10 när det finns tillräckligt med data.
export async function fetchBestPreviousClips(category, limit = 3) {
  let query = supabase
    .from('clips')
    .select('hook_text, category, subtopic, views_24h, avg_watch_pct, segments_plan')
    .eq('status', 'posted')
    .not('views_24h', 'is', null)
    .order('views_24h', { ascending: false })
    .limit(limit)

  if (category) {
    query = query.eq('category', category)
  }

  const { data, error } = await query
  if (error) throw new Error(error.message)
  return data ?? []
}
