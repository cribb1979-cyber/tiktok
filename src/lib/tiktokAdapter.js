// TikTok-integration bakom ett adapter-lager (steg 8), enligt spec: "Bygg
// TikTok-integrationen bakom ett interface/adapter-lager så den går att stubba tills
// Developer-access är godkänd." Just nu finns bara mock-implementationen nedan — publicering,
// schemaläggning och resultat är simulerade. Byt ut `tiktokAdapter`-exporten mot en riktig
// implementation (samma metodnamn/signaturer) när TikTok Developer-ansökan är godkänd och
// Content Posting API / Display API kan anropas på riktigt — anropande kod (Inställningar,
// Bibliotek) behöver då inte ändras.

import { supabase } from './supabaseClient.js'

const STORAGE_KEY = 'klippapp_tiktok_mock_connection'

function readConnection() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

function writeConnection(value) {
  try {
    if (value) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(value))
    } else {
      localStorage.removeItem(STORAGE_KEY)
    }
  } catch {
    // localStorage otillgängligt (t.ex. privat läge) — kopplingen glöms bort vid omladdning,
    // ofarligt eftersom det ändå bara är en mock.
  }
}

function randomStats() {
  const views = Math.round(500 + Math.random() * 20000)
  return {
    views_24h: views,
    avg_watch_pct: Math.round((35 + Math.random() * 55) * 10) / 10,
    shares: Math.round(views * (0.005 + Math.random() * 0.03)),
    comments: Math.round(views * (0.002 + Math.random() * 0.015)),
  }
}

const mockAdapter = {
  isMock: true,

  getConnectionStatus() {
    const connection = readConnection()
    return { connected: Boolean(connection), accountName: connection?.accountName ?? null }
  },

  // Simulerar OAuth-flödet. Riktig implementation: redirect till TikToks
  // auktoriseringssida, byt sedan en "code" mot en access token server-side (Netlify Edge
  // Function — client secret får aldrig exponeras i klienten).
  async connectAccount() {
    await new Promise((resolve) => setTimeout(resolve, 500))
    const connection = { accountName: '@stoffe_medium (mock)', connectedAt: new Date().toISOString() }
    writeConnection(connection)
    return connection
  },

  async disconnectAccount() {
    writeConnection(null)
  },

  // Riktig implementation: TikTok Content Posting API. VIKTIGT när klippet har
  // ai_generated_content: true (B-roll använt, se generate-broll.ts) — TikToks regler
  // kräver att posten flaggas som AI-genererat innehåll i själva API-anropet (disclosure/
  // "AI-generated content"-fältet i Content Posting API), inte bara i vår egen databas.
  async publishClip(clip) {
    const fakePostId = `mock_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    const { error } = await supabase
      .from('clips')
      .update({ status: 'posted', posted_at: new Date().toISOString(), tiktok_post_id: fakePostId })
      .eq('id', clip.id)
    if (error) throw new Error(error.message)
    return { tiktok_post_id: fakePostId }
  },

  async schedulePost(clip, scheduledAtIso) {
    const { error } = await supabase
      .from('clips')
      .update({ status: 'scheduled', scheduled_at: scheduledAtIso })
      .eq('id', clip.id)
    if (error) throw new Error(error.message)
  },

  // Riktig implementation: TikTok Display API.
  async fetchStats(clip) {
    const stats = randomStats()
    const { error } = await supabase.from('clips').update(stats).eq('id', clip.id)
    if (error) throw new Error(error.message)
    return stats
  },
}

export const tiktokAdapter = mockAdapter
