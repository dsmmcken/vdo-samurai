// Tailwind color names (excluding gray/black/white for better visibility)
const COLORS = [
  'red',
  'orange',
  'amber',
  'yellow',
  'lime',
  'green',
  'emerald',
  'teal',
  'cyan',
  'sky',
  'blue',
  'indigo',
  'violet',
  'purple',
  'fuchsia',
  'pink',
  'rose'
] as const;

export type ColorName = (typeof COLORS)[number];

/**
 * Hash a string to a consistent numeric value
 */
function hashString(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  return Math.abs(hash);
}

/**
 * Get a consistent color name for a display name
 */
export function getColorForName(displayName: string): ColorName {
  const hash = hashString(displayName.toLowerCase().trim());
  return COLORS[hash % COLORS.length];
}

/**
 * Get a Tailwind color class for a display name
 * @param displayName - The user's display name
 * @param variant - 'bg' for background, 'border' for border, 'text' for text color
 * @param shade - Tailwind shade (100-900)
 */
export function getColorClass(
  displayName: string,
  variant: 'bg' | 'border' | 'text' = 'bg',
  shade: number = 500
): string {
  const color = getColorForName(displayName);
  return `${variant}-${color}-${shade}`;
}

/**
 * Get both background and border classes for a display name
 * Useful for clips that need coordinated colors
 */
export function getClipColorClasses(
  displayName: string,
  options: { bgShade?: number; borderShade?: number } = {}
): { bg: string; border: string; text: string } {
  const { bgShade = 500, borderShade = 600 } = options;
  const color = getColorForName(displayName);
  return {
    bg: `bg-${color}-${bgShade}`,
    border: `border-${color}-${borderShade}`,
    text: `text-${color}-${bgShade}`
  };
}

/**
 * Get raw color value for non-Tailwind uses (e.g., canvas rendering)
 * Returns a hex color string
 */
const COLOR_VALUES: Record<ColorName, string> = {
  red: '#ef4444',
  orange: '#f97316',
  amber: '#f59e0b',
  yellow: '#eab308',
  lime: '#84cc16',
  green: '#22c55e',
  emerald: '#10b981',
  teal: '#14b8a6',
  cyan: '#06b6d4',
  sky: '#0ea5e9',
  blue: '#3b82f6',
  indigo: '#6366f1',
  violet: '#8b5cf6',
  purple: '#a855f7',
  fuchsia: '#d946ef',
  pink: '#ec4899',
  rose: '#f43f5e'
};

export function getColorValue(displayName: string): string {
  const color = getColorForName(displayName);
  return COLOR_VALUES[color];
}
