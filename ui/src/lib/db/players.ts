import type Database from 'better-sqlite3';

export interface PlayerIdentity {
  id: number;
  league_id: number | null;
  identity_type: 'whatsapp' | 'google-chat' | 'music-league';
  identifier: string;
}

export interface PlayerRelationship {
  id: number;
  related_player_id: number;
  related_player_name: string;
  relationship_type: string;
  relationship_note: string | null;
}

export interface Player {
  id: number;
  name: string;
  chatType: 'whatsapp' | 'google-chat' | null;
  chatIdentifier: string | null;
  mlCompetitorId: string | null;
  age: number | null;
  createdAt: string;
  seasonIds: number[];
  identities: PlayerIdentity[];
  relationships: PlayerRelationship[];
}

interface PlayerRow {
  id: number;
  name: string;
  chat_type: string | null;
  chat_identifier: string | null;
  ml_competitor_id: string | null;
  age: number | null;
  created_at: string;
}

interface IdentityRow {
  id: number;
  player_id: number;
  league_id: number | null;
  identity_type: string;
  identifier: string;
}

interface RelationshipRow {
  id: number;
  player_id: number;
  related_player_id: number;
  related_player_name: string;
  relationship_type: string;
  relationship_note: string | null;
}

function rowToPlayer(
  row: PlayerRow,
  seasonIds: number[],
  identities: PlayerIdentity[],
  relationships: PlayerRelationship[],
): Player {
  return {
    id: row.id,
    name: row.name,
    chatType: (row.chat_type as Player['chatType']) ?? null,
    chatIdentifier: row.chat_identifier ?? null,
    mlCompetitorId: row.ml_competitor_id ?? null,
    age: row.age ?? null,
    createdAt: row.created_at,
    seasonIds,
    identities,
    relationships,
  };
}

export function getAllPlayers(db: Database.Database): Player[] {
  const rows = db.prepare('SELECT * FROM players ORDER BY name').all() as PlayerRow[];

  // Bulk-load season memberships.
  const memberships = db.prepare(
    'SELECT player_id, season_id FROM season_players',
  ).all() as { player_id: number; season_id: number }[];
  const byPlayerSeasons = new Map<number, number[]>();
  for (const m of memberships) {
    const list = byPlayerSeasons.get(m.player_id) ?? [];
    list.push(m.season_id);
    byPlayerSeasons.set(m.player_id, list);
  }

  // Bulk-load identities.
  const identityRows = db.prepare('SELECT * FROM player_identities ORDER BY id').all() as IdentityRow[];
  const byPlayerIdentities = new Map<number, PlayerIdentity[]>();
  for (const r of identityRows) {
    const list = byPlayerIdentities.get(r.player_id) ?? [];
    list.push({
      id: r.id,
      league_id: r.league_id,
      identity_type: r.identity_type as PlayerIdentity['identity_type'],
      identifier: r.identifier,
    });
    byPlayerIdentities.set(r.player_id, list);
  }

  // Bulk-load relationships with related player names.
  const relRows = db.prepare(`
    SELECT pr.id, pr.player_id, pr.related_player_id, p.name AS related_player_name,
           pr.relationship_type, pr.relationship_note
    FROM player_relationships pr
    JOIN players p ON p.id = pr.related_player_id
    ORDER BY pr.id
  `).all() as RelationshipRow[];
  const byPlayerRelationships = new Map<number, PlayerRelationship[]>();
  for (const r of relRows) {
    const list = byPlayerRelationships.get(r.player_id) ?? [];
    list.push({
      id: r.id,
      related_player_id: r.related_player_id,
      related_player_name: r.related_player_name,
      relationship_type: r.relationship_type,
      relationship_note: r.relationship_note ?? null,
    });
    byPlayerRelationships.set(r.player_id, list);
  }

  return rows.map(r =>
    rowToPlayer(
      r,
      byPlayerSeasons.get(r.id) ?? [],
      byPlayerIdentities.get(r.id) ?? [],
      byPlayerRelationships.get(r.id) ?? [],
    ),
  );
}

export function getPlayerById(db: Database.Database, playerId: number): Player | null {
  const row = db.prepare('SELECT * FROM players WHERE id = ?').get(playerId) as PlayerRow | undefined;
  if (!row) return null;
  const seasons = db.prepare('SELECT season_id FROM season_players WHERE player_id = ?').all(playerId) as { season_id: number }[];
  const identityRows = db.prepare('SELECT * FROM player_identities WHERE player_id = ? ORDER BY id').all(playerId) as IdentityRow[];
  const relRows = db.prepare(`
    SELECT pr.id, pr.player_id, pr.related_player_id, p.name AS related_player_name,
           pr.relationship_type, pr.relationship_note
    FROM player_relationships pr
    JOIN players p ON p.id = pr.related_player_id
    WHERE pr.player_id = ?
    ORDER BY pr.id
  `).all(playerId) as RelationshipRow[];

  return rowToPlayer(
    row,
    seasons.map(s => s.season_id),
    identityRows.map(r => ({
      id: r.id,
      league_id: r.league_id,
      identity_type: r.identity_type as PlayerIdentity['identity_type'],
      identifier: r.identifier,
    })),
    relRows.map(r => ({
      id: r.id,
      related_player_id: r.related_player_id,
      related_player_name: r.related_player_name,
      relationship_type: r.relationship_type,
      relationship_note: r.relationship_note ?? null,
    })),
  );
}

export function createPlayer(
  db: Database.Database,
  data: { name: string; chatType?: string | null; chatIdentifier?: string | null; mlCompetitorId?: string | null },
): Player {
  const { lastInsertRowid } = db.prepare(
    `INSERT INTO players (name, chat_type, chat_identifier, ml_competitor_id)
     VALUES (?, ?, ?, ?)`,
  ).run(data.name, data.chatType ?? null, data.chatIdentifier ?? null, data.mlCompetitorId ?? null);
  const player = getPlayerById(db, Number(lastInsertRowid));
  if (!player) throw new Error('insert failed');
  return player;
}

export function updatePlayer(
  db: Database.Database,
  playerId: number,
  data: { name?: string; chatType?: string | null; chatIdentifier?: string | null; age?: number | null },
): boolean {
  const fields: string[] = [];
  const values: unknown[] = [];
  if (data.name !== undefined) { fields.push('name = ?'); values.push(data.name); }
  if (data.chatType !== undefined) { fields.push('chat_type = ?'); values.push(data.chatType ?? null); }
  if (data.chatIdentifier !== undefined) { fields.push('chat_identifier = ?'); values.push(data.chatIdentifier ?? null); }
  if (data.age !== undefined) { fields.push('age = ?'); values.push(data.age ?? null); }
  if (fields.length === 0) return false;
  values.push(playerId);
  const info = db.prepare(`UPDATE players SET ${fields.join(', ')} WHERE id = ?`).run(...values);
  return info.changes > 0;
}

export function addPlayerIdentity(
  db: Database.Database,
  playerId: number,
  data: { league_id?: number | null; identity_type: string; identifier: string },
): PlayerIdentity {
  const { lastInsertRowid } = db.prepare(
    `INSERT INTO player_identities (player_id, league_id, identity_type, identifier)
     VALUES (?, ?, ?, ?)`,
  ).run(playerId, data.league_id ?? null, data.identity_type, data.identifier);
  const row = db.prepare('SELECT * FROM player_identities WHERE id = ?').get(Number(lastInsertRowid)) as IdentityRow;
  return {
    id: row.id,
    league_id: row.league_id,
    identity_type: row.identity_type as PlayerIdentity['identity_type'],
    identifier: row.identifier,
  };
}

export function removePlayerIdentity(db: Database.Database, identityId: number): boolean {
  const info = db.prepare('DELETE FROM player_identities WHERE id = ?').run(identityId);
  return info.changes > 0;
}

export function addRelationship(
  db: Database.Database,
  playerId: number,
  relatedPlayerId: number,
  type: string,
  note?: string,
): PlayerRelationship {
  const { lastInsertRowid } = db.prepare(
    `INSERT INTO player_relationships (player_id, related_player_id, relationship_type, relationship_note)
     VALUES (?, ?, ?, ?)`,
  ).run(playerId, relatedPlayerId, type, note ?? null);
  const row = db.prepare(`
    SELECT pr.id, pr.player_id, pr.related_player_id, p.name AS related_player_name,
           pr.relationship_type, pr.relationship_note
    FROM player_relationships pr
    JOIN players p ON p.id = pr.related_player_id
    WHERE pr.id = ?
  `).get(Number(lastInsertRowid)) as RelationshipRow;
  return {
    id: row.id,
    related_player_id: row.related_player_id,
    related_player_name: row.related_player_name,
    relationship_type: row.relationship_type,
    relationship_note: row.relationship_note ?? null,
  };
}

export function removeRelationship(db: Database.Database, relationshipId: number): boolean {
  const info = db.prepare('DELETE FROM player_relationships WHERE id = ?').run(relationshipId);
  return info.changes > 0;
}

export function addPlayerToSeason(db: Database.Database, seasonId: number, playerId: number): boolean {
  const info = db.prepare(
    'INSERT OR IGNORE INTO season_players (season_id, player_id) VALUES (?, ?)',
  ).run(seasonId, playerId);
  return info.changes > 0;
}

export function removePlayerFromSeason(db: Database.Database, seasonId: number, playerId: number): boolean {
  const info = db.prepare(
    'DELETE FROM season_players WHERE season_id = ? AND player_id = ?',
  ).run(seasonId, playerId);
  return info.changes > 0;
}
