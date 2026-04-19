"use client";

import * as d3 from "d3";
import { useEffect, useRef } from "react";

const FILES = "abcdefgh".split("");
const RANKS = [8, 7, 6, 5, 4, 3, 2, 1];

type Props = { heatmap: Record<string, number>; className?: string };

export function CaptureHeatmap({ heatmap, className = "" }: Props) {
  const ref = useRef<SVGSVGElement | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const svg = d3.select(el);
    svg.selectAll("*").remove();

    const size = 400;
    const pad = 2;
    const cell = (size - pad * 9) / 8;
    const values = FILES.flatMap((f) =>
      RANKS.map((r) => heatmap[`${f}${r}`] ?? 0),
    );
    const max = d3.max(values) ?? 1;
    const color = d3.scaleSequential(d3.interpolateInferno).domain([0, max]);

    const root = svg
      .attr("viewBox", `0 0 ${size} ${size}`)
      .attr("role", "img")
      .attr("aria-label", "Capture density by destination square");

    const g = root.append("g");

    for (let ri = 0; ri < 8; ri++) {
      for (let fi = 0; fi < 8; fi++) {
        const sq = `${FILES[fi]}${RANKS[ri]}`;
        const v = heatmap[sq] ?? 0;
        const x = pad + fi * (cell + pad);
        const y = pad + ri * (cell + pad);
        g.append("rect")
          .attr("x", x)
          .attr("y", y)
          .attr("width", cell)
          .attr("height", cell)
          .attr("rx", 3)
          .attr("fill", color(v));

        if (v > 0) {
          g.append("text")
            .attr("x", x + cell / 2)
            .attr("y", y + cell / 2 + 4)
            .attr("text-anchor", "middle")
            .attr("font-size", Math.max(9, cell / 4))
            .attr("fill", v > max * 0.55 ? "#090908" : "#e9e7e2")
            .attr("font-weight", 600)
            .text(String(v));
        }
      }
    }

    const label = root
      .append("g")
      .attr("font-size", 10)
      .attr("fill", "rgba(233,231,226,0.45)");
    FILES.forEach((f, i) => {
      label
        .append("text")
        .attr("x", pad + i * (cell + pad) + cell / 2)
        .attr("y", size - 2)
        .attr("text-anchor", "middle")
        .text(f);
    });
    RANKS.forEach((r, i) => {
      label
        .append("text")
        .attr("x", 8)
        .attr("y", pad + i * (cell + pad) + cell / 2 + 4)
        .attr("text-anchor", "middle")
        .text(String(r));
    });
  }, [heatmap]);

  return (
    <svg
      ref={ref}
      className={`mx-auto block h-auto w-full min-w-0 max-w-full md:max-w-md ${className}`}
    />
  );
}
