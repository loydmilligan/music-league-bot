/**
 * Canonical avatar trait option lists. Shared by the trait-save endpoint
 * (validation), the Settings roster editor (dropdowns), and kept in one place so
 * the whitelist and the UI can never drift apart.
 */

export const AVATAR_GENDERS = ['male', 'female', 'nonbinary'];

export const AVATAR_RACES = [
  'White',
  'Black',
  'East Asian',
  'South Asian',
  'Southeast Asian',
  'Hispanic/Latino',
  'Middle Eastern',
  'Indigenous',
  'Pacific Islander',
  'Mixed',
];

export const AVATAR_HEIGHTS = ['petite', 'short', 'average', 'tall', 'very tall'];
export const AVATAR_BUILDS = ['lanky', 'medium', 'athletic', 'thick'];

export const AVATAR_HAIR_STYLES = [
  'bald',
  'buzzcut',
  'short',
  'medium',
  'long',
  'shoulder-length',
  'ponytail',
  'bun',
  'braids',
  'dreadlocks',
  'afro',
  'curly',
  'wavy',
  'bob',
  'pixie',
  'mohawk',
];

export const AVATAR_HAIR_COLORS = [
  'black',
  'dark brown',
  'brown',
  'light brown',
  'blonde',
  'red/ginger',
  'auburn',
  'gray',
  'salt-and-pepper',
  'white',
  'dyed',
];

// Style is gender-dependent: a shared base plus gender-specific additions.
const STYLE_BASE = [
  'average',
  'casual',
  'formal',
  'preppy',
  'skater',
  'punk',
  'goth',
  'hipster',
  'bohemian',
];

export const AVATAR_STYLES_BY_GENDER: Record<string, string[]> = {
  male: [...STYLE_BASE, 'streetwear', 'rugged', 'jock'],
  female: [...STYLE_BASE, 'chic', 'glam', 'athleisure'],
  nonbinary: [...STYLE_BASE, 'androgynous', 'streetwear', 'artsy'],
};

/** Union of every gendered style — used for endpoint validation (gender-agnostic). */
export const AVATAR_STYLES_ALL = Array.from(
  new Set(Object.values(AVATAR_STYLES_BY_GENDER).flat()),
);

/** Style options to show for a given (possibly unset) gender. */
export function stylesForGender(gender: string | null | undefined): string[] {
  return (gender && AVATAR_STYLES_BY_GENDER[gender]) || STYLE_BASE;
}
