"use client";

import * as d3 from "d3";
import { useEffect, useRef } from "react";

type Pt = { t: number; s: number };

type Props = { curve: Pt[]; className?: string };

/** Kaplan–Meier step curve: x = half-moves after +3 lead, y = estimated survival. */
export function SurvivalStepChart({ curve, className = "" }: Props) {
  const ref = useRef<SVGSVGElement | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el || curve.length < 1) return;

    const svg = d3.select(el);
    svg.selectAll("*").remove();

    const W = 820;
    const H = 300;
    const margin = { top: 18, right: 20, bottom: 56, left: 48 };
    const iw = W - margin.left - margin.right;
    const ih = H - margin.top - margin.bottom;

    const pts = [...curve].sort((a, b) => a.t - b.t);
    const tMax = Math.max(8, d3.max(pts, (d) => d.t) ?? 8);
    const x = d3.scaleLinear().domain([0, tMax]).nice().range([0, iw]);
    const y = d3.scaleLinear().domain([0, 1.05]).range([ih, 0]);

    const tickColor = "rgba(233,231,226,0.22)";
    const fgMuted = "rgba(233,231,226,0.42)";

    const root = svg
      .attr("viewBox", `0 0 ${W} ${H}`)
      .attr("class", className)
      .attr("role", "img")
      .attr(
        "aria-label",
        "Step chart: fraction of plus-three material episodes that have not yet failed (dropped below plus one or lost or drawn), by half-moves after the lead first appears—not live win rate",
      );

    const g = root
      .append("g")
      .attr("transform", `translate(${margin.left},${margin.top})`);

    g.append("g")
      .attr("class", "grid-y")
      .call(
        d3
          .axisLeft(y)
          .ticks(5)
          .tickSize(-iw)
          .tickFormat(d3.format(".0%") as (v: d3.NumberValue) => string),
      )
      .call((ga) => ga.select(".domain").remove())
      .call((ga) =>
        ga.selectAll(".tick line").attr("stroke", tickColor).attr("stroke-dasharray", "2,4"),
      )
      .call((ga) =>
        ga.selectAll(".tick text").attr("fill", fgMuted).attr("font-size", 10),
      );

    const line = d3
      .line<Pt>()
      .curve(d3.curveStepAfter)
      .x((d) => x(d.t))
      .y((d) => y(d.s));

    g.append("path")
      .datum(pts)
      .attr("fill", "none")
      .attr("stroke", "#f54e00")
      .attr("stroke-width", 2.2)
      .attr("d", line);

    g.append("g")
      .attr("transform", `translate(0,${ih})`)
      .call(d3.axisBottom(x).ticks(8))
      .call((ga) => ga.select(".domain").attr("stroke", tickColor))
      .call((ga) =>
        ga.selectAll(".tick line").attr("stroke", tickColor),
      )
      .call((ga) =>
        ga.selectAll(".tick text").attr("fill", fgMuted).attr("font-size", 10),
      );

    g.append("text")
      .attr("x", 0)
      .attr("y", -6)
      .attr("fill", "rgba(233,231,226,0.5)")
      .attr("font-size", 11)
      .text("Half-moves after first ≥+3 lead");
    g.append("text")
      .attr("x", iw / 2)
      .attr("y", ih + 36)
      .attr("text-anchor", "middle")
      .attr("fill", "rgba(233,231,226,0.38)")
      .attr("font-size", 10)
      .text("Y-axis: share of episodes with no failure yet (not win % from the board)");
  }, [curve, className]);

  if (curve.length < 1) return null;

  return (
    <svg
      ref={ref}
      className="h-auto w-full max-w-full"
      preserveAspectRatio="xMidYMid meet"
    />
  );
}
