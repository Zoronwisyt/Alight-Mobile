// Normalises Alight Motion compound font tokens ("SpaceGrotesk-Bold", "FiraSans-SemiBoldItalic")
// into canonical CSS family + numeric weight + style triples.

const WEIGHT_PATTERNS: [RegExp, number][] = [
  [/extra\s*light|ultra\s*light/i, 200],
  [/semi\s*bold|demi\s*bold/i, 600],
  [/extra\s*bold|ultra\s*bold/i, 800],
  [/\bthin\b|hairline/i, 100],
  [/\blight\b/i, 300],
  [/\bmedium\b/i, 500],
  [/\bblack\b|\bheavy\b/i, 900],
  [/\bbold\b/i, 700],
  [/\bbook\b|\bregular\b|\bnormal\b/i, 400],
];

// Known canonical family names (populated dynamically from fontcatalog.json + bundled + user fonts)
const canonicalByKey = new Map<string, string>();

const INITIAL_CANONICAL = [
  'Arimo',
  'Fira Sans',
  'Hind',
  'Lato',
  'Lora',
  'Merriweather',
  'Montserrat',
  'Muli',
  'Nanum Gothic',
  'Noto Sans',
  'Nunito',
  'Open Sans',
  'Open Sans Condensed',
  'Oswald',
  'PT Sans',
  'PT Sans Narrow',
  'PT Serif',
  'Playfair Display',
  'Poppins',
  'Raleway',
  'Roboto',
  'Roboto Condensed',
  'Roboto Mono',
  'Roboto Slab',
  'Slabo 27px',
  'Source Sans Pro',
  'Space Grotesk',
  'Titillium Web',
  'Ubuntu',
];

function normKey(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, '');
}

for (const fam of INITIAL_CANONICAL) {
  canonicalByKey.set(normKey(fam), fam);
}

export function registerCanonicalFamily(family: string): void {
  const trimmed = family.trim();
  if (!trimmed) return;
  canonicalByKey.set(normKey(trimmed), trimmed);
}

export function humaniseFamily(raw: string): string {
  const trimmed = raw.trim().replace(/\s+/g, ' ');
  if (!trimmed) return 'Roboto';
  const hit = canonicalByKey.get(normKey(trimmed));
  if (hit) return hit;
  // Insert spaces at camelCase boundaries (e.g. "SpaceGrotesk" -> "Space Grotesk")
  const spaced = trimmed
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim();
  const hitSpaced = canonicalByKey.get(normKey(spaced));
  return hitSpaced ?? spaced;
}

export interface ParsedFontToken {
  family: string;
  weight: number;
  style: 'normal' | 'italic';
  usedDefault: boolean;
}

export function parseAmFontToken(token: string | null | undefined): ParsedFontToken {
  const raw = (token || '').trim();
  if (!raw) {
    return { family: 'Roboto', weight: 400, style: 'normal', usedDefault: true };
  }
  const style: 'normal' | 'italic' = /italic|oblique/i.test(raw) ? 'italic' : 'normal';
  // Strip file extension if present
  const noExt = raw.replace(/\.(ttf|otf|woff2?|ttc)$/i, '');
  // Split camelCase before matching weight tokens so "SemiBoldItalic" -> "Semi Bold Italic"
  let cleaned = noExt
    .replace(/[-_]+/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/(italic|oblique)/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  let weight = 400;
  let familyPart = cleaned;
  for (const [re, w] of WEIGHT_PATTERNS) {
    if (re.test(cleaned)) {
      weight = w;
      familyPart = cleaned.replace(re, ' ').replace(/\s+/g, ' ').trim();
      break;
    }
  }
  const family = humaniseFamily(familyPart || cleaned);
  return { family, weight, style, usedDefault: false };
}

export function normalizeFontWeight(weight?: number | string): number {
  if (typeof weight === 'number' && Number.isFinite(weight)) return weight;
  if (typeof weight === 'string') {
    const n = parseInt(weight, 10);
    if (Number.isFinite(n) && n >= 100 && n <= 900) return n;
    for (const [re, w] of WEIGHT_PATTERNS) {
      if (re.test(weight)) return w;
    }
  }
  return 400;
}

export function weightToLabel(weight?: number | string): string {
  const w = normalizeFontWeight(weight);
  if (w <= 150) return 'Thin';
  if (w <= 250) return 'Extra Light';
  if (w <= 350) return 'Light';
  if (w <= 450) return 'Regular';
  if (w <= 550) return 'Medium';
  if (w <= 650) return 'Semi Bold';
  if (w <= 750) return 'Bold';
  if (w <= 850) return 'Extra Bold';
  return 'Black';
}

export function formatAmFontToken(family: string, weight: number | string = 400, italic = false): string {
  const compact = family.replace(/\s+/g, '');
  const wLabel = weightToLabel(weight).replace(/\s+/g, '');
  const suffix = italic ? (wLabel === 'Regular' ? 'Italic' : `${wLabel}Italic`) : wLabel;
  return `${compact}-${suffix}`;
}
