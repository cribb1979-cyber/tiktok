import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

export const supabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey)

if (!supabaseConfigured) {
  console.warn(
    'Supabase-miljövariabler saknas. Lägg till VITE_SUPABASE_URL och VITE_SUPABASE_ANON_KEY i .env lokalt, eller i Netlifys Environment variables (Site settings → Environment variables) för att de ska bakas in i produktionsbygget.'
  )
}

// createClient kastar synkront om url/key saknas, vilket kraschar hela appen redan vid
// sidladdning. Ett ofarligt placeholder-värde håller appen uppe så resten av gränssnittet
// renderas — Supabase-anrop misslyckas då istället med ett vanligt, hanterat fel.
export const supabase = createClient(
  supabaseConfigured ? supabaseUrl : 'https://placeholder.supabase.co',
  supabaseConfigured ? supabaseAnonKey : 'placeholder-anon-key'
)
