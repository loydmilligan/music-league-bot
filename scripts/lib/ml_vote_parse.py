"""Pure parser for a Music League voting-page ballot.

Deliberately has no network and no file I/O: all the fragile selector logic
lives here so it can be tested offline against a saved page. See
docs/research/2026-09-01-ml-voting-page.md §3 for how these selectors were
established.

Anonymity (spec §5): the voting page is anonymous by construction — it carries
a comment per song URI and never names the submitter. This parser must not emit
any identity field. Do NOT repoint it at /-/results, which looks similar but
attributes every comment to a named user.
"""

from __future__ import annotations

from bs4 import BeautifulSoup


def _text(node) -> str:
    return node.get_text(strip=True) if node else ""


def parse_ballot(html: str) -> list[dict]:
    soup = BeautifulSoup(html, "html.parser")
    songs: list[dict] = []

    for block in soup.select("div.songs > div.song"):
        uri_input = block.select_one('input[name="uri"]')
        if not uri_input or not uri_input.get("value"):
            continue

        meta = block.select_one(".col.text-truncate.order-3")

        # The comment <p> is present for every song; x-show carries the truth.
        comment = None
        wrapper = block.select_one("p.bg-body-tertiary")
        if wrapper is not None and wrapper.get("x-show") == "true":
            span = wrapper.select_one("span.text-break.ws-pre-wrap")
            text = span.get_text().strip() if span else ""
            comment = text or None

        songs.append(
            {
                "spotify_uri": uri_input["value"],
                "title": _text(meta.select_one("h6")) if meta else "",
                "artist": _text(meta.select_one("span.d-block.text-truncate")) if meta else "",
                "comment": comment,
                "is_mine": "mine: true" in (block.get("x-data") or ""),
            }
        )

    return songs
