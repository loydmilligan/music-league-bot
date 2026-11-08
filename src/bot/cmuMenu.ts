export interface MenuEntry {
  command: string;
  oneLine: string;
}

export const MENU_HEADING = 'DM me any of these (no @ needed):';

export const PLAYER_MENU: MenuEntry[] = [
  { command: 'catch me up', oneLine: 'What you missed, as a picture' },
  { command: 'help', oneLine: 'Everything else I can do' },
];
