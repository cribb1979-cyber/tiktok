import { supabase } from './supabaseClient.js'

// Bibliotek för allt AI-genererat innehåll som inte redan har ett eget (se
// 0010_generated_content.sql) — B-roll, musik, berättarröst. Sparas automatiskt vid varje
// lyckad generering (icke-kritiskt, samma "fire and forget"-mönster som embedAndStoreClip/
// effect_library) så resultatet aldrig går förlorat, även om själva sessionen avbryts innan
// man hann använda det i en rendering.
export function saveGeneratedContent({ kind, prompt, metadata, mediaUrl }) {
  supabase
    .from('generated_content')
    .insert({ kind, prompt: prompt ?? null, metadata: metadata ?? null, media_url: mediaUrl })
    .then(({ error }) => {
      if (error) console.warn(`Kunde inte spara genererat innehåll (${kind}) i biblioteket:`, error.message)
    })
}

export async function listGeneratedContent(kind) {
  const { data, error } = await supabase
    .from('generated_content')
    .select('*')
    .eq('kind', kind)
    .order('created_at', { ascending: false })
  if (error) throw new Error(error.message)
  return data ?? []
}

export async function deleteGeneratedContent(id) {
  const { error } = await supabase.from('generated_content').delete().eq('id', id)
  if (error) throw new Error(error.message)
}
