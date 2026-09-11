import { supabase } from './supabaseClient.js'

const UPLOAD_MAX_RETRIES = 2
const UPLOAD_RETRY_DELAY_MS = 2000

// Laddar upp råmaterial till den publika bucketen "raw-clips" (se
// supabase/migrations/0002_storage_bucket.sql) så externa tjänster som Shotstack kan
// hämta videon via URL för rendering.
//
// Görs med ett par återförsök vid fel — stora videouppladdningar från mobil över wifi/4G
// är känsliga för tillfälliga nätverks-/Cloudflare-hicka (t.ex. observerat: "HTTP 520
// error" från Supabase Storage-frontenden) som normalt lyckas vid ett omförsök, istället
// för att permanent misslyckas och tvinga användaren att ladda upp samma klipp igen manuellt.
export async function uploadRawClip(file) {
  const safeName = file.name.replace(/[^a-zA-Z0-9.\-_]/g, '_')
  const path = `${Date.now()}-${safeName}`

  let lastError = null
  for (let attempt = 0; attempt <= UPLOAD_MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      await new Promise((resolve) => setTimeout(resolve, UPLOAD_RETRY_DELAY_MS * attempt))
    }

    const { error } = await supabase.storage.from('raw-clips').upload(path, file, {
      cacheControl: '3600',
      upsert: false,
    })

    if (!error) {
      const { data } = supabase.storage.from('raw-clips').getPublicUrl(path)
      return data.publicUrl
    }

    lastError = error
  }

  throw new Error(lastError.message)
}
