"use client";

import * as d3 from "d3";
import { useEffect, useRef } from "react";

type Pt = { t: number; r: number };

type Props = { series: Pt[]; className?: string };

/** Rating before each game vs when that game ended; hover for date + rating. */
export function RatingJourneyChart({ series, className = "" }: Props) {
  const ref = useRef<SVGSVGElement | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el || series.length < 1) return;

    const svg = d3.select(el);
    svg.selectAll("*").remove();

    const W = 820;
    const H = 300;
    const margin = { top: 18, right: 20, bottom: 40, left: 52 };
    const iw = W - margin.left - margin.right;
    const ih = H - margin.top - margin.bottom;

    const pts = [...series].sort((a, b) => a.t - b.t);
    const dates = pts.map((p) => new Date(p.t * 1000));
    const rs = pts.map((p) => p.r);
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
        "Line chart of your listed Chess.com rating over time for this report",
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

    if (pts.length > 1) {
      g.append("path")
        .datum(pts)
        .attr("fill", "none")
        .attr("stroke", "#f54e00")
        .attr("stroke-width", 2.2)
        .attr("stroke-linejoin", "round")
        .attr("stroke-linecap", "round")
        .attr("d", line);
    }

    g.selectAll("circle.pt")
      .data(pts)
      .join("circle")
      .attr("class", "pt")
      .attr("cx", (d) => x(new Date(d.t * 1000)))
      .attr("cy", (d) => y(d.r))
      .attr("r", pts.length === 1 ? 5 : 2.8)
      .attr("fill", "#c08532")
      .attr("stroke", pts.length === 1 ? "#f54e00" : "none")
      .attr("stroke-width", pts.length === 1 ? 1.5 : 0);

    const xAxis = d3
      .axisBottom(x)
      .ticks(Math.min(6, Math.max(3, Math.floor(pts.length / 80) + 3)))
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
      .attr("y", -6)
      .attr("fill", "rgba(233,231,226,0.5)")
      .attr("font-size", 11)
      .text("Rating before each game");

    const fmtDate = d3.utcFormat("%b %d, %Y");

    const focus = g.append("g").style("opacity", 0).style("pointer-events", "none");
    const vline = focus
      .append("line")
      .attr("y1", 0)
      .attr("y2", ih)
      .attr("stroke", "rgba(245,78,0,0.55)")
      .attr("stroke-width", 1)
      .attr("stroke-dasharray", "4,3");
    const tipG = focus.append("g");
    const tipBg = tipG
      .append("rect")
      .attr("rx", 5)
      .attr("fill", "rgba(14,12,10,0.94)")
      .attr("stroke", "rgba(245,78,0,0.35)")
      .attr("stroke-width", 1);
    const tipLine1 = tipG
      .append("text")
      .attr("fill", "#e9e7e2")
      .attr("font-size", 12)
      .attr("font-weight", 600)
      .attr("x", 10)
      .attr("y", 18);
    const tipLine2 = tipG
      .append("text")
      .attr("fill", "rgba(233,231,226,0.72)")
      .attr("font-size", 11)
      .attr("x", 10)
      .attr("y", 36);

    function nearestByX(mx: number): Pt {
      const tGuess = x.invert(mx).getTime() / 1000;
      let best = pts[0];
      let bestAbs = Infinity;
      for (const p of pts) {
        const a = Math.abs(p.t - tGuess);
        if (a < bestAbs) {
          bestAbs = a;
          best = p;
        }
      }
      return best;
    }

    g.append("rect")
      .attr("width", iw)
      .attr("height", ih)
      .attr("fill", "transparent")
      .style("cursor", "crosshair")
      .on("mousemove", (event: unknown) => {
        const ev = event as MouseEvent;
        const [mx, my] = d3.pointer(ev);
        const clampedX = Math.max(0, Math.min(iw, mx));
        const p = nearestByX(clampedX);
        const px = x(new Date(p.t * 1000));
        vline.attr("x1", px).attr("x2", px);
        tipLine1.text(fmtDate(new Date(p.t * 1000)));
        tipLine2.text(`Listed rating: ${p.r}`);
        const n1 = tipLine1.node() as SVGTextElement;
        const n2 = tipLine2.node() as SVGTextElement;
        const b1 = n1.getBBox();
        const b2 = n2.getBBox();
        const tw = Math.max(b1.width, b2.width) + 20;
        const th = Math.max(b2.y + b2.height, b1.y + b1.height) - Math.min(b1.y, b2.y) + 14;
        let tx = px + 10;
        let ty = my - th - 10;
        if (tx + tw > iw - 4) tx = px - tw - 10;
        if (ty < 4) ty = my + 14;
        if (ty + th > ih - 4) ty = ih - th - 4;
        tipBg.attr("x", 0).attr("y", 0).attr("width", tw).attr("height", th);
        tipG.attr("transform", `translate(${tx},${ty})`);
        focus.style("opacity", 1);
      })
      .on("mouseleave", () => {
        focus.style("opacity", 0);
      });
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
