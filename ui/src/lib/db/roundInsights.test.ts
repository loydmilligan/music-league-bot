import { describe, expect, it } from "vitest";
import type Database from "better-sqlite3";
import { openLeagueDb } from "./client.js";
import { getRoundInsights } from "./roundInsights.js";

function seedRound(db: Database.Database, withDeadline = true): number {
  db.prepare(
    "INSERT INTO leagues (slug, name) VALUES ('insights', 'Insights')",
  ).run();
  db.prepare(
    "INSERT INTO seasons (league_id, season_number, status) VALUES (1, 1, 'active')",
  ).run();
  db.prepare(
    `INSERT INTO rounds (id, season_id, ml_round_id, name, submission_deadline, created_at)
     VALUES (1, 1, 'insights-1', 'Insight Round', ?, '2026-07-01T00:00:00Z')`,
  ).run(withDeadline ? "2026-07-10T00:00:00Z" : null);
  for (const [id, name] of [
    [1, "A"],
    [2, "B"],
    [3, "C"],
    [4, "D"],
  ]) {
    db.prepare(
      "INSERT INTO competitors (id, ml_competitor_id, name) VALUES (?, ?, ?)",
    ).run(id, `c-${id}`, name);
  }
  return 1;
}

function addSubmission(
  db: Database.Database,
  id: number,
  uri: string,
  artist: string,
  createdAt: string,
): void {
  db.prepare(
    `INSERT INTO ml_submissions (id, round_id, competitor_id, spotify_uri, title, artists, created_at)
     VALUES (?, 1, ?, ?, ?, ?, ?)`,
  ).run(id, id, uri, `Song ${id}`, artist, createdAt);
}

describe("getRoundInsights", () => {
  it("summarizes audio metadata, deadline behavior, and repeated artists deterministically", () => {
    const db = openLeagueDb(":memory:");
    seedRound(db);
    addSubmission(db, 1, "spotify:track:a", "The Aces", "2026-07-09T23:00:00Z");
    addSubmission(
      db,
      2,
      "spotify:track:b",
      "The Aces, Guest",
      "2026-07-09T18:00:00Z",
    );
    addSubmission(db, 3, "spotify:track:c", "Beta", "2026-07-08T00:00:00Z");
    addSubmission(db, 4, "spotify:track:d", "Gamma", "2026-07-10T01:00:00Z");
    db.prepare(
      "INSERT INTO song_audio_features (spotify_uri, bpm, key, scale, energy, duration_s) VALUES (?, ?, ?, ?, ?, ?)",
    ).run("spotify:track:a", 100, "C", "major", 0.4, 180);
    db.prepare(
      "INSERT INTO song_audio_features (spotify_uri, bpm, key, scale, energy, duration_s) VALUES (?, ?, ?, ?, ?, ?)",
    ).run("spotify:track:b", 120, "C", "minor", 0.8, 180);
    db.prepare(
      "INSERT INTO song_audio_features (spotify_uri, bpm, key, scale, energy, duration_s) VALUES (?, ?, ?, ?, ?, ?)",
    ).run("spotify:track:c", 140, "G", "major", 0.6, 180);

    expect(getRoundInsights(db, 1)).toEqual({
      audio: {
        totalSongs: 4,
        analyzedSongs: 3,
        coveragePercent: 75,
        medianBpm: 120,
        bpmMin: 100,
        bpmMax: 140,
        averageEnergy: 0.6,
        topKeys: [
          { value: "C", count: 2 },
          { value: "G", count: 1 },
        ],
        topScales: [
          { value: "major", count: 2 },
          { value: "minor", count: 1 },
        ],
      },
      submissionTiming: {
        submissionCount: 4,
        deadline: "2026-07-10T00:00:00Z",
        measuredCount: 4,
        lateCount: 1,
        finalSixHoursCount: 2,
        medianHoursBeforeDeadline: 3.5,
        earliestHoursBeforeDeadline: 48,
        latestHoursBeforeDeadline: -1,
      },
      artists: {
        songCount: 4,
        uniqueArtistCount: 3,
        priorSeasonsCompared: 0,
        callbackCount: 0,
        callbacks: [],
        topArtists: [
          { value: "The Aces", count: 2 },
          { value: "Beta", count: 1 },
          { value: "Gamma", count: 1 },
        ],
      },
      wordCloud: [],
    });
    db.close();
  });

  it("returns null timing metrics without a deadline and empty metadata safely", () => {
    const db = openLeagueDb(":memory:");
    seedRound(db, false);
    addSubmission(db, 1, "spotify:track:a", "Artist", "2026-07-09T00:00:00Z");
    const insights = getRoundInsights(db, 1);
    expect(insights.audio).toMatchObject({
      totalSongs: 1,
      analyzedSongs: 0,
      coveragePercent: 0,
      medianBpm: null,
      topKeys: [],
    });
    expect(insights.submissionTiming).toMatchObject({
      deadline: null,
      measuredCount: 0,
      lateCount: null,
      finalSixHoursCount: null,
      medianHoursBeforeDeadline: null,
    });
    expect(insights.artists).toMatchObject({
      uniqueArtistCount: 1,
      priorSeasonsCompared: 0,
      callbackCount: 0,
      callbacks: [],
    });
    db.close();
  });

  it("reports artists carried over from an earlier season of the same league", () => {
    const db = openLeagueDb(":memory:");
    seedRound(db); // league 1, season 1 (season_number 1), round 1
    db.prepare(
      "INSERT INTO seasons (id, league_id, season_number, status) VALUES (2, 1, 2, 'active')",
    ).run();
    db.prepare(
      `INSERT INTO rounds (id, season_id, ml_round_id, name, submission_deadline, created_at)
       VALUES (2, 2, 'insights-2', 'Season Two Round', '2026-08-10T00:00:00Z', '2026-08-01T00:00:00Z')`,
    ).run();
    // Season 1 history: competitor A played The Aces, competitor B played Beta.
    addSubmission(db, 1, "spotify:track:s1a", "The Aces", "2026-07-09T00:00:00Z");
    addSubmission(db, 2, "spotify:track:s1b", "Beta", "2026-07-09T00:00:00Z");
    // Season 2 round: A returns to The Aces; C brings Beta for the first time.
    db.prepare(
      `INSERT INTO ml_submissions (id, round_id, competitor_id, spotify_uri, title, artists, created_at)
       VALUES (?, 2, ?, ?, ?, ?, ?)`,
    ).run(3, 1, "spotify:track:s2a", "Encore", "The Aces", "2026-08-09T00:00:00Z");
    db.prepare(
      `INSERT INTO ml_submissions (id, round_id, competitor_id, spotify_uri, title, artists, created_at)
       VALUES (?, 2, ?, ?, ?, ?, ?)`,
    ).run(4, 3, "spotify:track:s2b", "Borrowed", "Beta", "2026-08-09T00:00:00Z");

    const { artists } = getRoundInsights(db, 2);
    expect(artists.priorSeasonsCompared).toBe(1);
    expect(artists.callbackCount).toBe(2);
    // Self-callbacks sort first.
    expect(artists.callbacks[0]).toEqual({
      artist: "The Aces",
      title: "Encore",
      submitter: "A",
      priorTitle: "Song 1",
      priorSubmitter: "A",
      priorSeasonNumber: 1,
      sameSubmitter: true,
    });
    expect(artists.callbacks[1]).toMatchObject({
      artist: "Beta",
      submitter: "C",
      priorSubmitter: "B",
      sameSubmitter: false,
    });
    db.close();
  });

  it("finds no callbacks when the earlier season shares no artists", () => {
    const db = openLeagueDb(":memory:");
    seedRound(db);
    db.prepare(
      "INSERT INTO seasons (id, league_id, season_number, status) VALUES (2, 1, 2, 'active')",
    ).run();
    db.prepare(
      `INSERT INTO rounds (id, season_id, ml_round_id, name, created_at)
       VALUES (2, 2, 'insights-2', 'Season Two Round', '2026-08-01T00:00:00Z')`,
    ).run();
    addSubmission(db, 1, "spotify:track:s1a", "The Aces", "2026-07-09T00:00:00Z");
    db.prepare(
      `INSERT INTO ml_submissions (id, round_id, competitor_id, spotify_uri, title, artists, created_at)
       VALUES (?, 2, ?, ?, ?, ?, ?)`,
    ).run(3, 1, "spotify:track:s2a", "Fresh", "Someone Else", "2026-08-09T00:00:00Z");

    const { artists } = getRoundInsights(db, 2);
    expect(artists.priorSeasonsCompared).toBe(1);
    expect(artists.callbacks).toEqual([]);
    db.close();
  });

  it("caps artist and key distributions", () => {
    const db = openLeagueDb(":memory:");
    seedRound(db);
    for (let i = 1; i <= 4; i++) {
      addSubmission(
        db,
        i,
        `spotify:track:${i}`,
        `Artist ${i}`,
        `2026-07-01T0${i}:00:00Z`,
      );
      db.prepare(
        "INSERT INTO song_audio_features (spotify_uri, bpm, key, scale, energy, duration_s) VALUES (?, ?, ?, ?, ?, ?)",
      ).run(`spotify:track:${i}`, 90 + i, `Key ${i}`, "major", 0.5, 180);
    }
    const insights = getRoundInsights(db, 1);
    expect(insights.artists.topArtists).toHaveLength(4);
    expect(insights.audio.topKeys).toHaveLength(4);
    db.close();
  });
});
