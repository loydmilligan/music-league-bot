const TONES = [
  'text-health',
  'text-accent',
  'text-warn',
  'text-blue-400',
  'text-fg-muted',
] as const;

export type Tone = typeof TONES[number];

export function nameToTone(name: string): Tone {
  let h = 0;
  for (let i = 0; i < name.length; i++) {
    h = (Math.imul(31, h) + name.charCodeAt(i)) | 0;
  }
  return TONES[Math.abs(h) % TONES.length];
}

export function nameInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return name.slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}
