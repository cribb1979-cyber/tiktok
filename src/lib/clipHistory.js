import { supabase } from './supabaseClient.js'
import { embedText } from './embeddingClient.js'

// Retrieval (steg 10) ger först nytta vid tillräckligt många embeddade rader, enligt spec.
// Färre än så — fall tillbaka på den enklare kategorisorteringen (steg 9).
const MIN_ROWS_FOR_RETRIEVAL = 20

// Steg 9: enkel filtrering + sortering på visningar, ingen semantisk sökning.
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

// Steg 10: semantisk retrieval via pgvector (embedding av prompten, cosine similarity mot
// tidigare publicerade klipp) när det finns tillräckligt med data — annars steg 9:s
// enklare kategorisortering.
export async function fetchSimilarPreviousClips(promptText, category, limit = 3) {
  const { count, error: countError } = await supabase
    .from('clips')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'posted')
    .not('embedding', 'is', null)

  if (countError || (count ?? 0) < MIN_ROWS_FOR_RETRIEVAL) {
    return fetchBestPreviousClips(category, limit)
  }

  const embedding = await embedText(promptText)

  const { data, error } = await supabase.rpc('match_clips', {
    query_embedding: embedding,
    match_category: category || null,
    match_count: limit,
  })

  if (error) throw new Error(error.message)
  return data ?? []
}

// Beräknar och sparar en embedding för ett sparat klipp, så det kan hittas av framtida
// retrieval. Anropas efter att ett klipp sparats — icke-kritiskt, ett fel här ska aldrig
// påverka att själva klippet redan sparats.
export async function embedAndStoreClip(clipId, { prompt, hookText, category, subtopic }) {
  const text = [prompt, hookText, category, subtopic].filter(Boolean).join(' — ')
  if (!text) return

  const embedding = await embedText(text)
  const { error } = await supabase.from('clips').update({ embedding }).eq('id', clipId)
  if (error) throw new Error(error.message)
}
