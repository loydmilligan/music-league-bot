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


# The captured fixture happens to have an empty <span> for every x-show="false"
# comment wrapper, so it can't exercise the case Music League actually uses
# x-show for: a comment the submitter hid from voters, where the span still
# carries real text server-side. Synthetic markup below reproduces that shape
# (trimmed from the real fixture's song-0 block) because the real page has no
# such example. See the mutation-test note in task-1-report.md.
HIDDEN_COMMENT_SONG = """
<div class="songs">
    <div id="song-0" class="song" x-data="{ mine: false }">
        <div class="card mb-3">
            <div class="card-body">
                <div class="row gx-3 align-items-center">
                    <div class="col text-truncate order-3">
                        <h6 class="mb-0 text-truncate">Some Song</h6>
                        <span class="d-block text-truncate">Some Artist</span>
                        <span class="text-body-secondary">Some Album</span>
                    </div>
                </div>
                <p x-show="false" class="bg-body-tertiary my-3 p-2 border-1 rounded">
                    <i class="bi bi-quote flex-shrink-0 me-1 fs-5"></i>
                    <span class="text-break ws-pre-wrap">hidden by the submitter</span>
                    <b x-show="mine" class="ms-2">&#8212; You</b>
                </p>
                <input type="hidden" name="uri" value="spotify:track:HIDDENCOMMENT0001">
            </div>
        </div>
    </div>
</div>
"""


# DISCRIMINATING: this song's comment span has real, non-empty text
# ("hidden by the submitter") but its wrapper's x-show is "false" — the shape
# Music League uses when a submitter opted the comment out of view. Only the
# x-show check can catch this; the empty-string-to-None fallback cannot, since
# the span isn't empty. Removing `wrapper.get("x-show") == "true"` from the
# parser must make this test fail.
def test_hidden_comment_with_nonempty_span_is_not_leaked():
    songs = parse_ballot(HIDDEN_COMMENT_SONG)
    assert len(songs) == 1
    assert songs[0]["comment"] is None
