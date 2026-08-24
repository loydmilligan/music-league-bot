import os
import sys

import pytest

# The migration script lives in scripts/, not scripts/digest-qa/, so conftest's
# path insert does not cover it.
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..")))

from fix_chat_timestamps import classify_row, corrected_ts

SB = "Music League chat for Second Best and Friends"
BOARZ = "Boarz II Men - Music League"
HIP = "Hip jammers"


@pytest.mark.parametrize("group,ts,expected", [
    (SB, "2026-05-06T22:17:00Z", "relay"),
    (SB, "2026-05-06T22:17:00+00:00", "export_needs_shift"),
    (HIP, "2026-05-10T19:00:00+00:00", "export_needs_shift"),
    (BOARZ, "2026-07-15T03:47:00+00:00", "export_correct"),
    (BOARZ, "2026-07-15T03:47:00Z", "relay"),
])
def test_classify_row(group, ts, expected):
    assert classify_row(group, ts) == expected


def test_shift_adds_seven_hours_and_normalises_format():
    # Matt's ground truth: stored 22:17 was actually 10:17pm local,
    # so the stored value IS local and true UTC is 05:17 the next day.
    assert corrected_ts("2026-05-06T22:17:00+00:00", "export_needs_shift") == "2026-05-07T05:17:00Z"


def test_correct_export_is_only_reformatted():
    assert corrected_ts("2026-07-15T03:47:00+00:00", "export_correct") == "2026-07-15T03:47:00Z"


def test_relay_row_is_unchanged():
    assert corrected_ts("2026-08-20T02:41:00Z", "relay") == "2026-08-20T02:41:00Z"
