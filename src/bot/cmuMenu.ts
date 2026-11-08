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
