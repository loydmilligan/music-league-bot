from participation_report import render_report

ROWS = [
    {"name": "Joe Quinto", "score": 30.0, "pct": 20.0, "delta": -5.0,
     "vec": {"msgs": 0, "days_active": 0, "vote_comments": 5}},
    {"name": "Mara", "score": 80.0, "pct": 100.0, "delta": 3.0,
     "vec": {"msgs": 25, "days_active": 7, "vote_comments": 5}},
]


def test_report_is_self_contained():
    html = render_report("second-best", "More Cowbell!", ROWS, [(139, 50.0), (140, 55.0)])
    assert "<style>" in html
    assert "http://" not in html and "https://" not in html


def test_every_player_appears():
    html = render_report("second-best", "More Cowbell!", ROWS, [])
    assert "Joe Quinto" in html and "Mara" in html


def test_impact_block_is_present_but_empty():
    html = render_report("second-best", "More Cowbell!", ROWS, [])
    assert "Impact" in html
    assert "project D" in html


def test_falling_players_are_flagged():
    html = render_report("second-best", "More Cowbell!", ROWS, [])
    assert "falling" in html.lower()
