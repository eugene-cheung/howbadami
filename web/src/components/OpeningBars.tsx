"use client";

import { openingDisplayFromLine } from "@/lib/openingLabels";
import {
  useEffect,
  useMemo,
  useState,
  type MouseEvent,
} from "react";

function useCoarsePointer(): boolean {
  const [coarse, setCoarse] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(pointer: coarse)");
    const apply = () => setCoarse(mq.matches);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);
  return coarse;
}

export type OpeningChartRow = {
  line: string;
  games: number;
  wins?: number;
  losses?: number;
  draws?: number;
  win_rate_pct?: number | null;
};

type Props = { rows: OpeningChartRow[] };

type TipState = { text: string; x: number; y: number };

function WinMixBar({
  n,
  w,
  l,
  d,
  winRateDecisive,
}: {
  n: number;
  w: number;
  l: number;
  d: number;
  winRateDecisive: number | null;
}) {
  const [tip, setTip] = useState<TipState | null>(null);
  const [tactileOpen, setTactileOpen] = useState(false);
  const coarsePointer = useCoarsePointer();

  const unk = Math.max(0, n - w - l - d);
  const rawPw = n > 0 ? (100 * w) / n : 0;
  const rawPd = n > 0 ? (100 * d) / n : 0;
  const rawPl = n > 0 ? (100 * l) / n : 0;
  const rawPu = n > 0 ? (100 * unk) / n : 0;
  let pw = rawPw;
  let pd = rawPd;
  let pl = rawPl;
  let pu = rawPu;
  const rawSum = pw + pd + pl + pu;
  if (rawSum > 100 && rawSum > 0) {
    const k = 100 / rawSum;
    pw *= k;
    pd *= k;
    pl *= k;
    pu *= k;
  }

  function buildTip() {
    if (n <= 0) return "No games";
    const parts = [
      `W ${rawPw.toFixed(1)}%`,
      `D ${rawPd.toFixed(1)}%`,
      `L ${rawPl.toFixed(1)}%`,
    ];
    if (rawPu > 0.05) parts.push(`? ${rawPu.toFixed(1)}%`);
    const decisive = w + l + d;
    const wr =
      winRateDecisive != null
        ? `\nWin rate (decisive): ${winRateDecisive.toFixed(1)}% (${w}/${decisive} wins)`
        : decisive === 0
          ? "\nNo decisive results in this bucket."
          : "";
    return `${parts.join(" · ")}${wr}`;
  }

  const onMove = (e: MouseEvent<HTMLDivElement>) => {
    setTip({ text: buildTip(), x: e.clientX, y: e.clientY });
  };

  if (n <= 0) return null;

  return (
    <>
      <div
        className="relative flex h-2 w-full cursor-crosshair overflow-hidden rounded-full bg-hb-inset ring-1 ring-white/[0.06]"
        onClick={(e) => {
          if (!coarsePointer) return;
          e.stopPropagation();
          setTactileOpen((v) => !v);
        }}
        onMouseEnter={(e: MouseEvent<HTMLDivElement>) => {
          if (coarsePointer) return;
          setTip({ text: buildTip(), x: e.clientX, y: e.clientY });
        }}
        onMouseMove={onMove}
        onMouseLeave={() => setTip(null)}
      >
        {pw > 0 && (
          <span
            className="h-full shrink-0 bg-hb-success"
            style={{ width: `${pw}%` }}
            aria-hidden
          />
        )}
        {pd > 0 && (
          <span
            className="h-full shrink-0 bg-hb-fg/30"
            style={{ width: `${pd}%` }}
            aria-hidden
          />
        )}
        {pl > 0 && (
          <span
            className="h-full shrink-0 bg-hb-crimson/90"
            style={{ width: `${pl}%` }}
            aria-hidden
          />
        )}
        {pu > 0 && (
          <span
            className="h-full shrink-0 bg-hb-fg/12"
            style={{ width: `${pu}%` }}
            aria-hidden
          />
        )}
      </div>
      {tactileOpen && coarsePointer && (
        <p className="mt-1 font-mono text-[10px] leading-snug text-hb-fg/80 whitespace-pre-wrap">
          {buildTip()}
        </p>
      )}
      {tip && !coarsePointer && (
        <div
          className="pointer-events-none fixed z-[100] max-w-[min(20rem,calc(100vw-1.5rem))] whitespace-pre-wrap rounded-md border border-white/10 bg-hb-panel px-2.5 py-1.5 font-mono text-[11px] leading-snug text-hb-fg shadow-hb-card"
          style={{
            left: (() => {
              const pad = 10;
              const estW = 200;
              if (typeof window === "undefined") return tip.x + pad;
              return Math.max(
                pad,
                Math.min(tip.x + pad, window.innerWidth - estW - pad),
              );
            })(),
            top: tip.y + 12,
          }}
        >
          {tip.text}
        </div>
      )}
    </>
  );
}

export function OpeningBars({ rows }: Props) {
  const [expandedLine, setExpandedLine] = useState<string | null>(null);
  const maxGames = useMemo(
    () => Math.max(1, ...rows.map((r) => r.games)),
    [rows],
  );

  if (!rows.length) {
    return (
      <p className="text-center font-serif text-sm text-hb-fg/50">
        No five-ply opening keys in this slice (games too short or sparse).
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      <p className="mb-2 text-xs text-hb-fg/45">
        Orange bar = volume in this slice. Green / gray / red = win / draw /
        loss mix (hover for exact %). Tap a row for the SAN line.
      </p>
      <ul className="flex flex-col gap-0.5">
        {rows.map((row) => {
          const { title, blurb } = openingDisplayFromLine(row.line);
          const open = expandedLine === row.line;
          const volPct = Math.round((100 * row.games) / maxGames);
          const w = row.wins ?? 0;
          const l = row.losses ?? 0;
          const d = row.draws ?? 0;
          const decisiveWr =
            typeof row.win_rate_pct === "number" ? row.win_rate_pct : null;

          return (
            <li key={row.line} className="rounded-lg border border-transparent">
              <div
                role="button"
                tabIndex={0}
                onClick={() =>
                  setExpandedLine((cur) => (cur === row.line ? null : row.line))
                }
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    setExpandedLine((cur) =>
                      cur === row.line ? null : row.line,
                    );
                  }
                }}
                className="flex w-full min-w-0 cursor-pointer items-start gap-3 rounded-lg px-2 py-2 text-left transition hover:border-hb-fg/10 hover:bg-hb-inset/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-hb-accent/50"
                aria-expanded={open}
              >
                <span className="min-w-0 flex-[0_1_40%] sm:flex-[0_1_36%]">
                  <span className="line-clamp-2 text-sm font-medium leading-snug text-hb-fg">
                    {title}
                  </span>
                </span>
                <span className="flex min-w-0 flex-1 flex-col justify-center gap-1.5">
                  <span className="relative h-2.5 w-full overflow-hidden rounded-full bg-hb-inset">
                    <span
                      className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-hb-accent to-hb-gold"
                      style={{ width: `${volPct}%` }}
                    />
                  </span>
                  <WinMixBar
                    n={row.games}
                    w={w}
                    l={l}
                    d={d}
                    winRateDecisive={decisiveWr}
                  />
                </span>
                <span className="w-9 shrink-0 pt-0.5 text-right font-mono text-xs tabular-nums text-hb-fg/80">
                  {row.games}
                </span>
              </div>
              {open && (
                <div className="border-l-2 border-hb-accent/35 px-3 py-2 pl-4 text-sm text-hb-fg/75">
                  <p className="font-mono text-xs leading-relaxed tracking-tight text-hb-fg/90">
                    {row.line}
                  </p>
                  {blurb && (
                    <p className="mt-2 font-serif text-xs italic leading-relaxed text-hb-fg/60">
                      {blurb}
                    </p>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
