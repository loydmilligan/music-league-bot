export type MusicPlatform = 'spotify' | 'youtube' | 'apple-music';

export interface DetectedUrl {
  url: string;
  platform: MusicPlatform;
}

const PATTERNS: Array<{ platform: MusicPlatform; re: RegExp }> = [
  {
    platform: 'spotify',
    re: /https?:\/\/open\.spotify\.com\/track\/[A-Za-z0-9]+(?:\?[^\s]*)*/g,
  },
  {
    platform: 'youtube',
    re: /https?:\/\/(?:www\.)?(?:youtube\.com\/watch\?(?:[^\s]*&)?v=|youtu\.be\/|music\.youtube\.com\/watch\?(?:[^\s]*&)?v=)[A-Za-z0-9_-]+(?:[^\s]*)*/g,
  },
  {
    platform: 'apple-music',
    re: /https?:\/\/music\.apple\.com\/[a-z]{2}\/album\/[^\s]+/g,
  },
];

export function detectMusicUrls(body: string): DetectedUrl[] {
  const results: DetectedUrl[] = [];
  const seen = new Set<string>();

  for (const { platform, re } of PATTERNS) {
    re.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = re.exec(body)) !== null) {
      const url = match[0];
      if (!seen.has(url)) {
        seen.add(url);
        results.push({ url, platform });
      }
    }
  }

  return results;
}
