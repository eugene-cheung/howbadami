"use client";

import * as d3 from "d3";
import { useEffect, useRef } from "react";

type Pt = { t: number; r: number };

type Props = { series: Pt[]; className?: string };

/**
 * Listed pre-game rating (PGN WhiteElo/BlackElo) vs archive end time.
 */
export function RatingJourneyChart({ series, className = "" }: Props) {
  const ref = useRef<SVGSVGElement | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el || series.length < 1) return;

    const svg = d3.select(el);
    svg.selectAll("*").remove();

    const W = 820;
    const H = 280;
    const margin = { top: 16, right: 18, bottom: 36, left: 48 };
    const iw = W - margin.left - margin.right;
    const ih = H - margin.top - margin.bottom;

    const dates = series.map((p) => new Date(p.t * 1000));
    const rs = series.map((p) => p.r);
    let ext = d3.extent(dates) as [Date, Date];
    if (ext[0].getTime() === ext[1].getTime()) {
      const mid = ext[0].getTime();
      ext = [new Date(mid - 86400000), new Date(mid + 86400000)];
    }
    const x = d3.scaleUtc().domain(ext).range([0, iw]);

    const rMin = (d3.min(rs) ?? 1000) - 35;
    const rMax = (d3.max(rs) ?? 1000) + 35;
    const y = d3.scaleLinear().domain([rMin, rMax]).nice().range([ih, 0]);

    const root = svg
      .attr("viewBox", `0 0 ${W} ${H}`)
      .attr("class", className)
      .attr("role", "img")
      .attr(
        "aria-label",
        "Line chart of listed Chess.com rating over time in this archive slice",
      );

    const g = root
      .append("g")
      .attr("transform", `translate(${margin.left},${margin.top})`);

    const tickColor = "rgba(233,231,226,0.22)";
    const fgMuted = "rgba(233,231,226,0.42)";

    g.append("g")
      .attr("class", "grid-y")
      .call(
        d3
          .axisLeft(y)
          .ticks(5)
          .tickSize(-iw)
          .tickFormat(d3.format("d") as (v: d3.NumberValue) => string),
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
      .x((d) => x(new Date(d.t * 1000)))
      .y((d) => y(d.r));

    if (series.length > 1) {
      g.append("path")
        .datum(series)
        .attr("fill", "none")
        .attr("stroke", "#f54e00")
        .attr("stroke-width", 2.2)
        .attr("stroke-linejoin", "round")
        .attr("stroke-linecap", "round")
        .attr("d", line);
    }

    g.selectAll("circle.pt")
      .data(series)
      .join("circle")
      .attr("class", "pt")
      .attr("cx", (d) => x(new Date(d.t * 1000)))
      .attr("cy", (d) => y(d.r))
      .attr("r", series.length === 1 ? 5 : 2.8)
      .attr("fill", "#c08532")
      .attr("stroke", series.length === 1 ? "#f54e00" : "none")
      .attr("stroke-width", series.length === 1 ? 1.5 : 0);

    const xAxis = d3
      .axisBottom(x)
      .ticks(Math.min(6, Math.max(3, Math.floor(series.length / 80) + 3)))
      .tickFormat(d3.utcFormat("%b '%y") as (v: Date | d3.NumberValue) => string);

    g.append("g")
      .attr("transform", `translate(0,${ih})`)
      .call(xAxis)
      .call((ga) => ga.select(".domain").attr("stroke", tickColor))
      .call((ga) =>
        ga.selectAll(".tick line").attr("stroke", tickColor),
      )
      .call((ga) =>
        ga.selectAll(".tick text").attr("fill", fgMuted).attr("font-size", 10),
      );

    g.append("text")
      .attr("x", 0)
      .attr("y", -4)
      .attr("fill", "rgba(233,231,226,0.5)")
      .attr("font-size", 11)
      .text("Listed rating (pregame header)");
  }, [series, className]);

  if (series.length < 1) return null;

  return (
    <svg
      ref={ref}
      className={`h-auto w-full max-w-full ${className}`}
      preserveAspectRatio="xMidYMid meet"
    />
  );
}
