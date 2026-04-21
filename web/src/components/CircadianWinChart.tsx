"use client";

import * as d3 from "d3";
import { useEffect, useRef } from "react";

type Bar = {
  hour: number;
  games: number;
  win_rate_pct: number | null;
};

type Props = { bars: Bar[]; className?: string };

/** Win rate (%) by UTC hour of game end. */
export function CircadianWinChart({ bars, className = "" }: Props) {
  const ref = useRef<SVGSVGElement | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el || bars.length < 1) return;

    const svg = d3.select(el);
    svg.selectAll("*").remove();

    const W = 820;
    const H = 260;
    const margin = { top: 18, right: 16, bottom: 40, left: 44 };
    const iw = W - margin.left - margin.right;
    const ih = H - margin.top - margin.bottom;

    const data = bars.filter((b) => b.games > 0);
    const rates = data
      .map((b) => b.win_rate_pct)
      .filter((x): x is number => x != null);
    const yMax = Math.min(
      100,
      Math.max(55, (d3.max(rates) ?? 50) + 8),
    );

    const x = d3
      .scaleBand()
      .domain(bars.map((b) => String(b.hour)))
      .range([0, iw])
      .padding(0.12);
    const y = d3.scaleLinear().domain([0, yMax]).nice().range([ih, 0]);

    const tickColor = "rgba(233,231,226,0.22)";
    const fgMuted = "rgba(233,231,226,0.42)";

    const root = svg
      .attr("viewBox", `0 0 ${W} ${H}`)
      .attr("class", className)
      .attr("role", "img")
      .attr("aria-label", "Bar chart of win rate by UTC hour");

    const g = root
      .append("g")
      .attr("transform", `translate(${margin.left},${margin.top})`);

    g.append("g")
      .call(
        d3
          .axisLeft(y)
          .ticks(5)
          .tickFormat((v) => `${v}%`)
          .tickSize(-iw),
      )
      .call((ga) => ga.select(".domain").remove())
      .call((ga) =>
        ga.selectAll(".tick line").attr("stroke", tickColor).attr("stroke-dasharray", "2,4"),
      )
      .call((ga) =>
        ga.selectAll(".tick text").attr("fill", fgMuted).attr("font-size", 10),
      );

    g.selectAll("rect.bar")
      .data(bars)
      .join("rect")
      .attr("class", "bar")
      .attr("x", (d) => x(String(d.hour)) ?? 0)
      .attr("width", x.bandwidth())
      .attr("y", (d) =>
        d.games > 0 && d.win_rate_pct != null ? y(d.win_rate_pct) : y(0),
      )
      .attr("height", (d) =>
        d.games > 0 && d.win_rate_pct != null
          ? ih - y(d.win_rate_pct)
          : 0,
      )
      .attr("rx", 2)
      .attr("fill", (d) =>
        d.games === 0
          ? "rgba(233,231,226,0.06)"
          : d.hour >= 1 && d.hour <= 4
            ? "rgba(245,78,0,0.55)"
            : "rgba(192,133,50,0.75)",
      );

    g.append("g")
      .attr("transform", `translate(0,${ih})`)
      .call(
        d3
          .axisBottom(x)
          .tickValues(
            [0, 3, 6, 9, 12, 15, 18, 21].map(String),
          ),
      )
      .call((ga) => ga.select(".domain").attr("stroke", tickColor))
      .call((ga) =>
        ga.selectAll(".tick line").attr("stroke", tickColor),
      )
      .call((ga) =>
        ga.selectAll(".tick text").attr("fill", fgMuted).attr("font-size", 9),
      );

    g.append("text")
      .attr("x", 0)
      .attr("y", -6)
      .attr("fill", "rgba(233,231,226,0.5)")
      .attr("font-size", 11)
      .text("Win % by UTC hour (game end)");
  }, [bars, className]);

  return (
    <svg
      ref={ref}
      className="h-auto w-full max-w-full"
      preserveAspectRatio="xMidYMid meet"
    />
  );
}
