"""Unit tests for statistical appendix (KM, correlations, z-scores)."""

from __future__ import annotations

from roast_ds import kaplan_meier, pearson_r, spearman_r


def test_kaplan_meier_simple_failures() -> None:
    # Two failures at t=2, one censored at t=5
    obs = [(2, False), (2, False), (5, True)]
    curve, median, n = kaplan_meier(obs)
    assert n == 3
    assert median is not None
    assert curve[0]["s"] == 1.0
    assert curve[-1]["s"] < 1.0


def test_kaplan_meier_all_censored() -> None:
    curve, median, n = kaplan_meier([(10, True), (20, True)])
    assert n == 2
    assert median is None
    assert curve[0]["s"] == 1.0


def test_pearson_perfect_negative() -> None:
    xs = [float(h) for h in range(24)]
    ys = [1.0 - x / 23.0 for x in xs]
    r = pearson_r(xs, ys)
    assert r is not None
    assert r < -0.99


def test_spearman_monotone() -> None:
    xs = list(range(10))
    ys = list(range(10))
    r = spearman_r([float(x) for x in xs], [float(y) for y in ys])
    assert r is not None
    assert r > 0.99
