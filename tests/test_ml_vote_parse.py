from pathlib import Path
import pytest
from scripts.lib.ml_vote_parse import parse_ballot

FIXTURE = Path(__file__).parent / "fixtures" / "ml-vote-ballot.html"


@pytest.fixture(scope="module")
def songs():
    return parse_ballot(FIXTURE.read_text(encoding="utf-8"))


def test_finds_every_song(songs):
    assert len(songs) == 10


def test_extracts_uri_title_artist(songs):
    by_uri = {s["spotify_uri"]: s for s in songs}
    assert all(u.startswith("spotify:track:") for u in by_uri)
    lil_nas = next(s for s in songs if "Old Town Road" in s["title"])
    # Fixture reality: the featured artist is part of the Spotify credit string.
    assert lil_nas["artist"] == "Lil Nas X, Billy Ray Cyrus"


# DISCRIMINATING: the comment <p> is emitted for EVERY song with an empty span
# when there is no comment. A parser that selects the <p> without gating on
# x-show="true" returns 10 comments (mostly empty strings) and fails this.
def test_only_two_songs_have_comments(songs):
    with_comments = [s for s in songs if s["comment"] is not None]
    assert len(with_comments) == 2


def test_absent_comment_is_none_not_empty_string(songs):
    assert all(s["comment"] != "" for s in songs)


def test_comment_text_is_unescaped_and_stripped(songs):
    c = next(s["comment"] for s in songs if s["comment"] and "punk" in s["comment"])
    # Fixture reality: the source text uses a curly apostrophe (U+2019), not '.
    assert c.startswith("I’m hoping this crossover banger")
    assert "&#" not in c and "&amp;" not in c
    assert c == c.strip()


def test_marks_the_owners_own_song(songs):
    assert sum(1 for s in songs if s["is_mine"]) == 1


# spec §5: /vote/ is anonymous by construction and the parser must not invent
# or carry any submitter identity. This is the property that keeps the guessing
# game honest — if this ever fails, the wrong source page is being parsed.
def test_carries_no_submitter_identity(songs):
    allowed = {"spotify_uri", "title", "artist", "comment", "is_mine"}
    for s in songs:
        assert set(s) == allowed
