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
