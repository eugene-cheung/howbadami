"""Tests for timeline parsing used by the API."""

from __future__ import annotations

import pytest

from roast_mvp import VALID_TIMELINES, normalize_timeline


def test_normalize_default_and_whitespace() -> None:
    assert normalize_timeline(None) == "1m"
    assert normalize_timeline("") == "1m"
    assert normalize_timeline("   ") == "1m"
    assert normalize_timeline(" 1M ") == "1m"


@pytest.mark.parametrize("tid", VALID_TIMELINES)
def test_normalize_accepts_all_valid_ids(tid: str) -> None:
    assert normalize_timeline(tid) == tid


def test_normalize_rejects_unknown() -> None:
    with pytest.raises(ValueError, match="Unknown timeline"):
        normalize_timeline("2y")
