import { supabase } from './supabaseClient.js'

// Laddar upp råmaterial till den publika bucketen "raw-clips" (se
// supabase/migrations/0002_storage_bucket.sql) så externa tjänster som Shotstack kan
// hämta videon via URL för rendering.
export async function uploadRawClip(file) {
  const safeName = file.name.replace(/[^a-zA-Z0-9.\-_]/g, '_')
  const path = `${Date.now()}-${safeName}`

  const { error } = await supabase.storage.from('raw-clips').upload(path, file, {
    cacheControl: '3600',
    upsert: false,
  })

  if (error) {
    throw new Error(error.message)
  }

  const { data } = supabase.storage.from('raw-clips').getPublicUrl(path)
  return data.publicUrl
}
