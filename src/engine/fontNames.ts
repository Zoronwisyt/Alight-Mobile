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

// Weight/style words that describe a *face*, not a family. Stripped before a family
// comparison so "Hind SemiBold", "Hind-SemiBold" and "Hind" are one family.
const FACE_WORD_RE =
  /\b(extra[\s-]*light|ultra[\s-]*light|semi[\s-]*bold|demi[\s-]*bold|extra[\s-]*bold|ultra[\s-]*bold|thin|hairline|light|book|regular|normal|medium|bold|black|heavy|italic|oblique)\b/gi;

/**
 * Family identity key: the part of a font name that survives weight, style and
 * punctuation differences.
 *
 * "Roboto Black" → "roboto", "Space Grotesk" → "spacegrotesk",
 * "PT_Sans-Narrow" → "ptsansnarrow". Deliberately *not* a substring match — "Roboto
 * Mono" must stay distinct from "Roboto" — so only whole face words are dropped.
 */
export function familyKey(family: string): string {
  const human = humaniseFamily(family)
    .replace(FACE_WORD_RE, ' ')
    .replace(/[^A-Za-z0-9]+/g, '');
  return human.toLowerCase();
}

/** True when two font names describe the same family regardless of face suffix. */
export function sameFamily(a: string, b: string): boolean {
  // humaniseFamily() turns an empty name into Roboto; two blanks are not a match.
  if (!a.trim() || !b.trim()) return false;
  const ka = familyKey(a);
  const kb = familyKey(b);
  return ka.length > 0 && ka === kb;
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
  /** The raw provider descriptor when the token carried one, e.g.
   *  `com.google.android.gms.fonts?name=Roboto&weight=900`. */
  provider?: string;
}

// AM writes a font as a *pair*: a human display name, a colon, then a provider
// descriptor. Both halves are real, from shipped AM project files:
//
//   font="Roboto Black:com.google.android.gms.fonts?name=Roboto&weight=900"
//   font="Oswald:com.google.android.gms.fonts?name=Oswald"
//   font="googlefonts?name=Roboto&weight=400"          (3.6-era, no display half)
//
// See assets/hometab/beta_anim.xml and assets/effects/presets/text-presets.xml.
const PROVIDER_PREFIX_RE = /^(googlefonts|systemfonts|assetfonts|local|file)\?/i;

function parseProviderQuery(descriptor: string): Map<string, string> {
  const out = new Map<string, string>();
  const q = descriptor.indexOf('?');
  if (q < 0) return out;
  for (const part of descriptor.slice(q + 1).split('&')) {
    const eq = part.indexOf('=');
    if (eq <= 0) continue;
    let value = part.slice(eq + 1);
    try {
      value = decodeURIComponent(value.replace(/\+/g, ' '));
    } catch {
      // leave the raw value when it is not valid percent-encoding
    }
    out.set(part.slice(0, eq).toLowerCase(), value.trim());
  }
  return out;
}

export function parseAmFontToken(token: string | null | undefined): ParsedFontToken {
  const raw = (token || '').trim();
  if (!raw) {
    return { family: 'Roboto', weight: 400, style: 'normal', usedDefault: true };
  }

  // 1. Split display name from provider descriptor.
  let display = raw;
  let descriptor = '';
  if (PROVIDER_PREFIX_RE.test(raw)) {
    display = '';
    descriptor = raw;
  } else {
    const colon = raw.indexOf(':');
    if (colon > 0) {
      const right = raw.slice(colon + 1);
      // A descriptor always carries a query or a path; a bare "Family:Style" pair does not.
      if (right.includes('?') || right.includes('/')) {
        display = raw.slice(0, colon);
        descriptor = right;
      }
    } else if (raw.includes('?')) {
      // iOS/AM 6+ emits colon-less provider tokens like `imported?name=Valorant Font.ttf`
      display = '';
      descriptor = raw;
    }
  }

  const query = parseProviderQuery(descriptor);
  const rawQueryName = query.get('name') || query.get('family') || '';
  const queryName = rawQueryName.replace(/\.(ttf|otf|woff2?|ttc)$/i, '').trim();
  const queryWeight = query.get('weight');
  const queryItalic = query.has('italic') ? /^(1|true|yes)$/i.test(query.get('italic') || '') : undefined;

  // 2. Weight + italic from the display half, when there is one.
  const noExt = display.replace(/\.(ttf|otf|woff2?|ttc)$/i, '');
  let cleaned = noExt
    .replace(/[-_]+/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim();

  let displayWeight = 400;
  let familyPart = cleaned;
  for (const [re, w] of WEIGHT_PATTERNS) {
    if (re.test(cleaned)) {
      displayWeight = w;
      familyPart = cleaned.replace(re, ' ').replace(/\s+/g, ' ').trim();
      break;
    }
  }
  // "Space Grotesk Bold Italic" → "Space Grotesk". The style is already captured above.
  familyPart = familyPart.replace(/\b(italic|oblique)\b/gi, ' ').replace(/\s+/g, ' ').trim();

  const style: 'normal' | 'italic' =
    queryItalic !== undefined
      ? queryItalic
        ? 'italic'
        : 'normal'
      : /italic|oblique/i.test(raw)
        ? 'italic'
        : 'normal';

  // 3. Family: the provider's own `name` is authoritative (it is what AM resolves
  //    the face by); the display half is a localised label and only a fallback.
  const familySource = queryName || familyPart || cleaned || 'Roboto';
  const family = humaniseFamily(
    familySource.replace(/\s+/g, ' ').replace(/^[^A-Za-z0-9]+/, '').trim() || 'Roboto'
  );

  const weight = queryWeight ? normalizeFontWeight(queryWeight) : displayWeight;

  return {
    family,
    weight,
    style,
    usedDefault: false,
    provider: descriptor || undefined,
  };
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
