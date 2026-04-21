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

    const rankGutter = 22;
    const fileGutter = 22;
    const boardInner = 400;
    const pad = 2;
    const cell = (boardInner - pad * 9) / 8;

    const totalW = rankGutter + boardInner + pad * 2;
    const totalH = boardInner + fileGutter + pad * 2;

    const boardX0 = rankGutter + pad;
    const boardY0 = pad;

    const values = FILES.flatMap((f) =>
      RANKS.map((r) => heatmap[`${f}${r}`] ?? 0),
    );
    const max = d3.max(values) ?? 1;
    const color = d3.scaleSequential(d3.interpolateInferno).domain([0, max]);

    const root = svg
      .attr("viewBox", `0 0 ${totalW} ${totalH}`)
      .attr("role", "img")
      .attr(
        "aria-label",
        "Board heatmap of capture counts per square; bright center is typical—compare wings and back ranks for where your games concentrate violence",
      );

    const board = root.append("g").attr("transform", `translate(${boardX0},${boardY0})`);

    for (let ri = 0; ri < 8; ri++) {
      for (let fi = 0; fi < 8; fi++) {
        const sq = `${FILES[fi]}${RANKS[ri]}`;
        const v = heatmap[sq] ?? 0;
        const x = pad + fi * (cell + pad);
        const y = pad + ri * (cell + pad);
        board
          .append("rect")
          .attr("x", x)
          .attr("y", y)
          .attr("width", cell)
          .attr("height", cell)
          .attr("rx", 3)
          .attr("fill", color(v));

        if (v > 0) {
          board
            .append("text")
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

    const axisStyle = (sel: d3.Selection<SVGTextElement, unknown, null, undefined>) =>
      sel
        .attr("fill", "#d8d4cc")
        .attr("stroke", "#0a0908")
        .attr("stroke-width", 2.5)
        .attr("paint-order", "stroke fill");

    const ranks = root.append("g").attr("font-size", 11).attr("font-weight", 700);
    RANKS.forEach((r, i) => {
      axisStyle(
        ranks
          .append("text")
          .attr("x", rankGutter / 2)
          .attr("y", boardY0 + pad + i * (cell + pad) + cell / 2 + 4)
          .attr("text-anchor", "middle"),
      ).text(String(r));
    });

    const files = root.append("g").attr("font-size", 11).attr("font-weight", 700);
    FILES.forEach((f, i) => {
      axisStyle(
        files
          .append("text")
          .attr("x", boardX0 + pad + i * (cell + pad) + cell / 2)
          .attr("y", boardY0 + boardInner + fileGutter / 2 + 4)
          .attr("text-anchor", "middle"),
      ).text(f);
    });
  }, [heatmap]);

  return (
    <svg
      ref={ref}
      className={`mx-auto block h-auto w-full min-w-0 max-w-full md:max-w-md ${className}`}
    />
  );
}
