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
        repeatedArtistCount: 1,
        repeatRatePercent: 33,
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
      repeatedArtistCount: 0,
      repeatRatePercent: 0,
    });
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
