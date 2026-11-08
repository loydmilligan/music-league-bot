export interface MenuEntry {
  command: string;
  oneLine: string;
}

/** Group wording: sits above `playerMenu(false)`, whose entries work in the group. */
export const MENU_HEADING = 'Send any of these as @bot <command> in the group:';

const DM_MENU_HEADING = 'DM me any of these (no @ needed):';

export const PLAYER_MENU: MenuEntry[] = [
  { command: 'catch me up', oneLine: 'What you missed, as a picture' },
  { command: 'pick one', oneLine: "The one topic you'd like most" },
  { command: 'top-pics', oneLine: 'Best pics of the last 48 h (add "week")' },
  { command: 'top-songs', oneLine: 'Most-loved songs posted (add "week")' },
  { command: 'my-dossier', oneLine: 'What the bot knows about you' },
  { command: 'help', oneLine: 'Everything else I can do' },
];

/** Every DM command, in help order (no explanations). */
export const ALL_COMMANDS: string[] = [
  'catch me up',
  'pick one',
  'top-songs',
  'top-pics',
  'top-videos',
  'top-links',
  'top-media',
  'list-topics',
  'show-topic 3',
  'my-dossier',
  'morning-recap sub',
  'help',
];

/** Only DM-capable (preview) recipients see the full menu; everyone else keeps today's two. */
export const playerMenu = (dmOk: boolean): MenuEntry[] =>
  dmOk ? PLAYER_MENU : PLAYER_MENU.filter((e) => e.command === 'catch me up' || e.command === 'help');

export const menuHeading = (dmOk: boolean): string => (dmOk ? DM_MENU_HEADING : MENU_HEADING);

export interface HelpEntry {
  command: string;
  explain: string;
  where: 'both' | 'group' | 'dm';
  owner?: boolean;
}

export const SECTION_EXPLAIN = {
  both: 'Both: work in the group (@bot …) and in a DM.',
  group: 'Group commands: send as @bot <command> in the group.',
  dm: 'DM commands: send these to me directly, no @.',
} as const;

/** Every player and owner command, one short plain line each. */
export const HELP_TABLE: HelpEntry[] = [
  { command: 'catch me up', explain: 'A picture of what you missed since your last post', where: 'both' },
  { command: 'help', explain: 'This list of everything I can do', where: 'both' },
  { command: 'pick one', explain: 'The one topic you would like most', where: 'dm' },
  { command: 'top-songs', explain: 'Most-loved songs posted; add "week" for 7 days', where: 'dm' },
  { command: 'top-pics', explain: 'Best pics of the last 48 hours; add "week" for 7 days', where: 'dm' },
  { command: 'top-videos', explain: 'Top videos; add "week" for 7 days', where: 'dm' },
  { command: 'top-links', explain: 'Top links; add "week" for 7 days', where: 'dm' },
  { command: 'top-media', explain: 'Top pics, videos and links together', where: 'dm' },
  { command: 'list-topics', explain: 'The topics being talked about right now', where: 'dm' },
  { command: 'show-topic 3', explain: 'Read one topic from that list by number', where: 'dm' },
  { command: 'my-dossier', explain: 'What the bot knows about you', where: 'dm' },
  { command: 'recap7', explain: 'The last 7 days of the chat in one recap', where: 'dm' },
  { command: 'morning-brief sub', explain: 'Get the morning brief every day', where: 'dm' },
  { command: 'morning-brief unsub', explain: 'Stop the morning brief', where: 'dm' },
  { command: 'morning-brief 7:30', explain: 'Change the time the morning brief arrives', where: 'dm' },
  { command: 'full', explain: 'The last 48 hours; does not count or move your window', where: 'group', owner: true },
  { command: 'forget', explain: 'Forget your last catch-up and reset your count', where: 'group', owner: true },
  { command: 'forget @Player', explain: 'The same for that player', where: 'group', owner: true },
  { command: 'forget all', explain: 'The same for every player', where: 'group', owner: true },
  { command: 'forget dl', explain: 'Forget only the DL side', where: 'group', owner: true },
  { command: 'forget sybg', explain: 'Forget only the SYBG side', where: 'group', owner: true },
  { command: 'off', explain: 'Turn catch-me-up off everywhere', where: 'group', owner: true },
  { command: 'on', explain: 'Turn catch-me-up back on', where: 'group', owner: true },
  { command: 'tldr', explain: 'Post a short how-to in this group', where: 'group', owner: true },
];

/** A random tip for the footer. DM tips need no @; group tips are Both commands only. */
export function didYouKnow(o: { dmOk: boolean; exclude?: string; random?: () => number }): string {
  const ex = o.exclude?.trim().toLowerCase();
  const pool = HELP_TABLE.filter(
    (e) => !e.owner && e.where === (o.dmOk ? 'dm' : 'both') && e.command.toLowerCase() !== ex,
  );
  if (pool.length === 0) return '';
  const r = (o.random ?? Math.random)();
  const e = pool[Math.min(pool.length - 1, Math.floor(r * pool.length))];
  return `Did you know? ${o.dmOk ? '' : '@bot '}${e.command} \u2014 ${e.explain}`;
}
