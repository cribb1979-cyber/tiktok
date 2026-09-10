export const CATEGORIES = [
  'Kärlek/relationer',
  'Paranormalt/andevärlden',
  'Personlig reflektion/citat',
  'Vardag/bakom kulisserna',
]

export const STATUSES = ['draft', 'scheduled', 'posted']

export const STATUS_LABELS = {
  draft: 'Utkast',
  scheduled: 'Schemalagd',
  posted: 'Publicerad',
}

// Manuellt val av effekt per segment i Klippstudio — samma preset-namn som Shotstack
// förväntar sig (se render-clip.ts). Tomt värde = automatiskt (appen väljer/cyklar själv).
export const SEGMENT_EFFECT_OPTIONS = [
  { value: '', label: 'Automatiskt' },
  { value: 'zoomInFast', label: 'Zooma in (snabb)' },
  { value: 'zoomOutFast', label: 'Zooma ut (snabb)' },
  { value: 'slideLeftFast', label: 'Glid vänster (snabb)' },
  { value: 'slideRightFast', label: 'Glid höger (snabb)' },
  { value: 'slideUpFast', label: 'Glid upp (snabb)' },
  { value: 'slideDownFast', label: 'Glid ner (snabb)' },
  { value: 'zoomIn', label: 'Zooma in (mjuk)' },
  { value: 'zoomOut', label: 'Zooma ut (mjuk)' },
  { value: 'slideLeft', label: 'Glid vänster (mjuk)' },
  { value: 'slideRight', label: 'Glid höger (mjuk)' },
]

// Manuellt val av uppspelningshastighet per segment — Shotstacks "speed"-fält på video-
// asset (float-multiplikator, t.ex. 2 = dubbel hastighet, 0.5 = halva), se render-clip.ts.
// Tomt värde = normal hastighet (fältet skickas inte alls).
export const SEGMENT_SPEED_OPTIONS = [
  { value: '', label: 'Normal hastighet' },
  { value: '0.5', label: 'Halv fart (0.5x)' },
  { value: '0.75', label: 'Lite långsammare (0.75x)' },
  { value: '1.25', label: 'Lite snabbare (1.25x)' },
  { value: '1.5', label: 'Snabbare (1.5x)' },
  { value: '2', label: 'Dubbel fart (2x)' },
]

// Manuellt val av färgfilter per segment — samma preset-namn som Shotstack förväntar sig
// (clip-nivå "filter"-fält, se render-clip.ts). Tomt värde = inget filter.
export const SEGMENT_FILTER_OPTIONS = [
  { value: '', label: 'Inget filter' },
  { value: 'boost', label: 'Boost (mer mättnad/kontrast)' },
  { value: 'contrast', label: 'Kontrast' },
  { value: 'muted', label: 'Dämpad' },
  { value: 'darken', label: 'Mörkare' },
  { value: 'lighten', label: 'Ljusare' },
  { value: 'greyscale', label: 'Svartvitt' },
  { value: 'negative', label: 'Negativ' },
]

// AI-genererade overlay-effekter (läggs ovanpå videon, se generate-broll.ts effectMode och
// render-clip.ts EFFECT_COMPOSITE).
export const EFFECT_TYPE_OPTIONS = [
  { value: 'orb', label: 'Ljusklot' },
  { value: 'mist', label: 'Dimma/rök' },
  { value: 'sparks', label: 'Gnistor/glödpartiklar' },
  { value: 'edgeGlow', label: 'Flimrande kantglöd' },
  { value: 'static', label: 'TV-brus/glitch' },
  { value: 'eyes', label: 'Lysande ögon i mörkret' },
]

// Ungefärlig visuell position för varje AI-effekttyp (matchar EFFECT_COMPOSITE i
// render-clip.ts) — bara för att visa var effekten hamnar i "Klippets sammansättning"-
// canvasen i Klippstudio (ClipCanvas), INTE dragbar. Shotstack stödjer bara förinställda
// lägen för video-kompositering (center/bottom/right), inte fri positionering som
// html-assets (glow/tankebubblor) — badgen är alltså en skrivskyddad referens, inte en
// kontroll.
export const EFFECT_POSITION_HINTS = {
  orb: { x: 50, y: 50 },
  mist: { x: 50, y: 80 },
  sparks: { x: 50, y: 50 },
  edgeGlow: { x: 85, y: 50 },
  static: { x: 50, y: 50 },
  eyes: { x: 50, y: 50 },
}

// Glow-overlay (manuellt positionerad, se render-clip.ts GLOW_COLORS/GLOW_INTENSITY_OPACITY).
export const GLOW_COLOR_OPTIONS = [
  { value: 'gold', label: 'Guld' },
  { value: 'blue', label: 'Blå' },
  { value: 'white', label: 'Vit' },
  { value: 'red', label: 'Röd' },
]

export const GLOW_INTENSITY_OPTIONS = [
  { value: 'low', label: 'Låg' },
  { value: 'medium', label: 'Medel' },
  { value: 'high', label: 'Hög' },
]
