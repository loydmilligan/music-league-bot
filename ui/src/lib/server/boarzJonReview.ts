import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { BOARZ_ROOT, getReviewPlayers, type Candidate, type ReviewMedia } from './boarzReview.js';

export type JonReviewPlayer = {
  slug: string;
  name: string;
  heroName: string;
  power: string;
  videoPlan: string;
  song: { title: string; artist: string };
  images: ReviewMedia[];
  draftVideo: ReviewMedia | null;
};

export type JonReviewResponse = {
  slug: string;
  chosenImagePath: string;
  notes: string;
};

const SONG_LABELS: Record<string, string> = {
  'conor-johnston-cj-wookie': 'Conor',
  'jon-black-jb': 'Jon Black',
  'dave-steingart-steiny': 'Steiny',
  'darren-paletz-dp': 'Darren',
  'clements-johnson-clem': 'Clem',
  'dave-jensen-jensen': 'Jensen',
  'jimmy-troy': 'Jimmy',
  'grant-koziol-koz': 'Grant',
  'shane-farkas-uncle-shane': 'Shane',
  'matt-mariani-mashew': 'Matt'
};

const SONG_OVERRIDES: Partial<Record<string, { title: string; artist: string }>> = {
  // card-songs.md records this as "Green Corn (Jon's pick from the list)"
  // without the artist; the selected Boarz submission is NOFX.
  'dave-jensen-jensen': { title: 'Green Corn', artist: 'NOFX' }
};

function cleanMarkdown(value: string): string {
  return value
    .replace(/<!--[^]*?-->/g, '')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^>\s?/gm, '')
    .replace(/\[([^\]]+)]\([^)]+\)/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/^\s*[-*]\s+/gm, '• ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

type MarkdownField = { label: string; value: string };

function markdownFields(markdown: string): MarkdownField[] {
  const matches = [...markdown.matchAll(/^\*\*([^*\n]+?):\*\*\s*/gm)];
  return matches.map((match, index) => {
    const start = (match.index ?? 0) + match[0].length;
    const end = matches[index + 1]?.index ?? markdown.length;
    const raw = markdown.slice(start, end).split(/^#{1,6}\s|^---\s*$/m)[0];
    return { label: match[1].trim(), value: cleanMarkdown(raw) };
  }).filter(field => field.value);
}

function selectedConcept(selection: string): { id: string; heroName: string } {
  const line = /^\*\*Selected candidate:\*\*\s*(.+)$/m.exec(selection)?.[1] ?? '';
  const id = /Candidate\s+([A-Z])/i.exec(line)?.[1]?.toUpperCase() ?? '';
  const original = /Candidate\s+[A-Z]\s*[—–-]\s*\*\*"?([^*"]+)"?\*\*/i.exec(line)?.[1]?.trim();
  const revision = /revised into\s*\*\*"?([^*"]+)"?\*\*/i.exec(line)?.[1]?.trim();
  return { id, heroName: revision || original || 'Hero concept' };
}

function candidateField(candidate: Candidate | undefined, pattern: RegExp): string {
  return candidate?.fields.find(field => pattern.test(field.label))?.text ?? '';
}

function videoPlan(selection: string, candidate: Candidate | undefined): string {
  const fields = markdownFields(selection);
  const priorities = [
    /finalized intro-video beat sheet/i,
    /^intro-video beat sheet/i,
    /^entrance \+ 360 beat sheet/i,
    /^entrance \+ 360 idea/i,
    /^two-second beat/i
  ];
  for (const pattern of priorities) {
    const found = fields.find(field => pattern.test(field.label));
    if (found) return found.value;
  }
  const status = fields.find(field => /^status$/i.test(field.label))?.value ?? '';
  const inline = /Card-front video idea:\s*([^]*)/i.exec(status)?.[1]?.trim();
  if (inline) return inline;
  return candidateField(candidate, /how it reads on camera|two-second|motion beat/i)
    || candidateField(candidate, /hero-shot pose/i)
    || 'Draft pending; no detailed beat sheet has been recorded yet.';
}

function powerDescription(selection: string, concept: string, candidate: Candidate | undefined): string {
  const conceptFields = markdownFields(concept);
  const selectionFields = markdownFields(selection);
  return conceptFields.find(field => /^(power \/ gimmick|core)$/i.test(field.label))?.value
    || selectionFields.find(field => /^concept(?: revision\b|$)/i.test(field.label))?.value
    || candidateField(candidate, /^powers? \/ gimmick$|^core character hook$/i)
    || candidate?.hook
    || 'Power description pending.';
}

function parseSongs(markdown: string): Map<string, { title: string; artist: string }> {
  const rows = markdown.split('\n').filter(line => /^\|.+\|$/.test(line));
  const byLabel = new Map<string, { title: string; artist: string }>();
  for (const row of rows) {
    const cells = row.split('|').slice(1, -1).map(cell => cleanMarkdown(cell).trim());
    if (cells.length < 2 || cells[0] === 'Player' || /^-+$/.test(cells[0])) continue;
    const [title = cells[1], artist = 'Artist pending'] = cells[1].split(/\s+[—–]\s+/, 2);
    byLabel.set(cells[0].replace(/\s*\([^)]*\)\s*/g, '').trim().toLowerCase(), { title: title.trim(), artist: artist.trim() });
  }
  return byLabel;
}

function songFor(slug: string, songs: Map<string, { title: string; artist: string }>): { title: string; artist: string } {
  if (SONG_OVERRIDES[slug]) return SONG_OVERRIDES[slug];
  const label = SONG_LABELS[slug]?.toLowerCase();
  if (!label) return { title: 'Song pending', artist: 'Artist pending' };
  for (const [key, song] of songs) if (key.startsWith(label)) return song;
  return { title: 'Song pending', artist: 'Artist pending' };
}

async function newestFirst(slug: string, media: ReviewMedia[]): Promise<ReviewMedia[]> {
  const dated = await Promise.all(media.map(async item => ({
    item,
    modified: await stat(join(BOARZ_ROOT, 'players', slug, item.path)).then(info => info.mtimeMs).catch(() => 0)
  })));
  return dated.sort((a, b) => b.modified - a.modified || a.item.path.localeCompare(b.item.path)).map(entry => entry.item);
}

function isSelectableImage(media: ReviewMedia): boolean {
  const file = basename(media.path).toLowerCase();
  return media.kind === 'image'
    && media.path.startsWith('stills/')
    && file.endsWith('.png')
    && file !== 'person.png'
    && !file.startsWith('inspiration.');
}

export async function getJonReviewPlayers(): Promise<JonReviewPlayer[]> {
  const [players, songsText] = await Promise.all([
    getReviewPlayers(),
    readFile(join(BOARZ_ROOT, 'handoff', 'card-songs.md'), 'utf8').catch(() => '')
  ]);
  const songs = parseSongs(songsText);
  return Promise.all(players.map(async player => {
    const playerDir = join(BOARZ_ROOT, 'players', player.slug);
    const [selection, concept] = await Promise.all([
      readFile(join(playerDir, 'selects', 'selection.md'), 'utf8').catch(() => ''),
      readFile(join(playerDir, 'superhero_concept.md'), 'utf8').catch(() => '')
    ]);
    const selected = selectedConcept(selection);
    const candidate = player.candidates.find(item => item.id === selected.id);
    const images = await newestFirst(player.slug, player.media.filter(isSelectableImage));
    const videos = await newestFirst(player.slug, player.media.filter(item => item.kind === 'video' && item.path.startsWith('generations/')));
    return {
      slug: player.slug,
      name: player.name,
      heroName: selected.heroName,
      power: powerDescription(selection, concept, candidate),
      videoPlan: videoPlan(selection, candidate),
      song: songFor(player.slug, songs),
      images,
      draftVideo: videos[0] ?? null
    };
  }));
}

async function writeJsonAtomic(path: string, value: unknown): Promise<void> {
  const temporary = `${path}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  await rename(temporary, path);
}

export async function saveJonReviewResponses(input: unknown): Promise<{ submittedAt: string; combinedPath: string }> {
  if (!input || typeof input !== 'object' || !Array.isArray((input as { responses?: unknown }).responses)) {
    throw new Error('responses must be an array');
  }
  const responses = (input as { responses: unknown[] }).responses;
  const players = await getJonReviewPlayers();
  if (players.length !== 10) throw new Error(`expected 10 review players, found ${players.length}`);
  if (responses.length !== players.length) throw new Error(`expected ${players.length} responses`);

  const submitted = new Map<string, JonReviewResponse>();
  for (const raw of responses) {
    if (!raw || typeof raw !== 'object') throw new Error('invalid response');
    const value = raw as Partial<JonReviewResponse>;
    const slug = typeof value.slug === 'string' ? value.slug : '';
    const chosenImagePath = typeof value.chosenImagePath === 'string' ? value.chosenImagePath : '';
    const notes = typeof value.notes === 'string' ? value.notes.trim() : '';
    const player = players.find(item => item.slug === slug);
    if (!player || submitted.has(slug)) throw new Error(`invalid or duplicate player: ${slug || '(missing)'}`);
    if (!player.images.some(image => image.path === chosenImagePath)) throw new Error(`invalid image selection for ${slug}`);
    if (!notes) throw new Error(`notes are required for ${slug}`);
    if (notes.length > 5000) throw new Error(`notes are too long for ${slug}`);
    submitted.set(slug, { slug, chosenImagePath, notes });
  }

  const ordered = players.map(player => submitted.get(player.slug)!);
  const submittedAt = new Date().toISOString();
  const combinedDir = join(BOARZ_ROOT, 'jon-review');
  await mkdir(combinedDir, { recursive: true });
  for (const response of ordered) {
    const selectsDir = join(BOARZ_ROOT, 'players', response.slug, 'selects');
    await mkdir(selectsDir, { recursive: true });
    await writeJsonAtomic(join(selectsDir, 'jon-review.json'), { ...response, submittedAt });
  }
  const filename = `responses-${submittedAt.replace(/[:.]/g, '-')}.json`;
  await writeJsonAtomic(join(combinedDir, filename), { reviewer: 'Jon', submittedAt, responses: ordered });
  return { submittedAt, combinedPath: `jon-review/${filename}` };
}
