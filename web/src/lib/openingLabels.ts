/**
 * Map first-five-halfmove SAN strings (Chess.com style) to human labels + optional flavor text.
 * Unknown lines fall back through shorter prefixes, then a generic title.
 */

export type OpeningDisplay = {
  title: string;
  /** Extra copy shown under the SAN when expanded */
  blurb?: string;
};

/** Longest-prefix wins: list ordered with more specific lines first. */
const BY_PREFIX: { prefix: string; title: string; blurb?: string }[] = [
  // Caro-Kann family
  {
    prefix: "e4 c6 d4 d5 e5",
    title: "Caro-Kann Advance",
    blurb: "Space grab — Black gets a target on e6 and opinions on e5.",
  },
  {
    prefix: "e4 c6 d4 d5 exd6",
    title: "Caro-Kann Exchange",
    blurb: "The structure says calm; your clock says otherwise.",
  },
  {
    prefix: "e4 c6 d4 d5 Nc3",
    title: "Caro-Kann Classical",
    blurb: "Main-line homework. Theory ends; panic invoices in the mail.",
  },
  {
    prefix: "e4 c6 d4 d5 Nf3",
    title: "Caro-Kann (Two Knights style)",
    blurb: "Still respectable — not the refuted meme line, we checked.",
  },
  {
    prefix: "e4 c6 Nc3 d5 Nf3",
    title: "Caro-Kann (Two Knights / Fantasy adjacent)",
    blurb: "You skipped d4 once. The universe noticed.",
  },
  {
    prefix: "e4 c6 d4 d5",
    title: "Caro-Kann main tabiya",
    blurb: "The real split happens on move 6 — you’re living in the trailer.",
  },
  {
    prefix: "e4 c6",
    title: "Caro-Kann territory",
    blurb: "The …c6 pawn filed paperwork before the game started.",
  },
  // French
  {
    prefix: "e4 e6 d4 d5 Nc3",
    title: "French Winawer / Classical crossroads",
    blurb: "The e6 pawn has HR on speed dial.",
  },
  {
    prefix: "e4 e6 d4 d5",
    title: "French Defense core",
    blurb: "Locked center, unlocked suffering.",
  },
  { prefix: "e4 e6", title: "French Defense", blurb: "Solid, cramped, proud." },
  // Sicilian
  {
    prefix: "e4 c5 Nf3 d6 d4",
    title: "Sicilian Dragon / Yugoslav orbit",
    blurb: "Sharp files incoming — bring hydration.",
  },
  {
    prefix: "e4 c5 Nf3 Nc6 Bb5",
    title: "Sicilian Rossolimo",
    blurb: "Avoid main-line theory; inherit new problems on c6.",
  },
  {
    prefix: "e4 c5 Nf3 d6",
    title: "Sicilian (…d6)",
    blurb: "The Najdorf’s quieter cousin still carries a knife.",
  },
  {
    prefix: "e4 c5 Nf3 Nc6",
    title: "Sicilian (2…Nc6)",
    blurb: "Classical chaos loading…",
  },
  { prefix: "e4 c5", title: "Sicilian Defense", blurb: "Half the internet plays this; all of it argues." },
  // 1.e4 e5 open games
  {
    prefix: "e4 e5 Nf3 Nc6 Bb5",
    title: "Ruy Lopez",
    blurb: "Four centuries of theory politely asking you to blunder.",
  },
  {
    prefix: "e4 e5 Nf3 Nc6 Bc4",
    title: "Italian Game",
    blurb: "c4 bishop energy — romantic, loud, occasionally punished.",
  },
  {
    prefix: "e4 e5 Nf3 Nc6 d4",
    title: "Scotch / Four Knights adjacent",
    blurb: "Central tension: installed. Exits: unclear.",
  },
  {
    prefix: "e4 e5 Nf3 Qf6",
    title: "Greco’s ghost (…Qf6)",
    blurb: "Scholar-adjacent — the refutation has seniority.",
  },
  {
    prefix: "e4 e5 Nf3 Nc6",
    title: "Open Game (2…Nc6)",
    blurb: "Still deciding whether life is Italian or Petroff.",
  },
  {
    prefix: "e4 e5 Nf3",
    title: "Double king’s pawn (2.Nf3)",
    blurb: "The trunk of the decision tree.",
  },
  {
    prefix: "e4 e5 Ke2",
    title: "Bongcloud Declined (you played it anyway)",
    blurb: "The king wanted screen time. FIDE sent thoughts and prayers.",
  },
  { prefix: "e4 e5", title: "King’s pawn duel", blurb: "1…e5 — the original subscription service." },
  // Scandinavian
  {
    prefix: "e4 d5 exd5 Qxd5 Nc3",
    title: "Scandinavian (Qd5 main)",
    blurb: "Queen out early — bold, bracing, occasionally refuted at move six.",
  },
  { prefix: "e4 d5", title: "Scandinavian", blurb: "Central tension in one move. Taxes due immediately." },
  // d4 systems
  {
    prefix: "d4 Nf6 c4 e6 Nc3",
    title: "Nimzo / Queen’s Indian orbit",
    blurb: "Hypermodern receipts attached.",
  },
  {
    prefix: "d4 d5 c4 e6 Nc3",
    title: "Semi-Slav / QGD complex",
    blurb: "The c-pawn wants drama; the e6 pawn wants stability. Guess who wins.",
  },
  {
    prefix: "d4 d5 c4",
    title: "Queen’s Gambit family",
    blurb: "Not a gift — a lien on the center.",
  },
  {
    prefix: "d4 Nf6 c4 g6 Nc3",
    title: "King’s Indian / Grünfeld orbit",
    blurb: "Fianchetto enjoyers anonymous.",
  },
  {
    prefix: "d4 d5 Nf3 Nf6 e3",
    title: "London / Colle adjacent",
    blurb: "Your bishop on f4 has tenure and a parking pass.",
  },
  {
    prefix: "d4 d5 Bf4",
    title: "London System",
    blurb: "Bf4 before e3 — the spreadsheet’s favorite opening.",
  },
  {
    prefix: "d4 d5 Nf3",
    title: "Closed Queen’s Pawn",
    blurb: "Slow burn, long memories.",
  },
  { prefix: "d4 Nf6", title: "Indian game", blurb: "Hypermodern handshake." },
  { prefix: "d4 d5", title: "Closed d4-d5", blurb: "Symmetry with intent." },
  // Flank / hypermodern
  {
    prefix: "Nf3 d5 g3 c5 Bg2",
    title: "English / Réti reverse",
    blurb: "You delayed the center like it was a group project.",
  },
  { prefix: "c4", title: "English (1.c4)", blurb: "Sideways pressure, upright attitude." },
  { prefix: "Nf3", title: "Réti / 1.Nf3", blurb: "Flex first, regret later." },
  // Alekhine / Pirc shapes (first 5 only — shallow)
  {
    prefix: "e4 Nf6 e5 Nd5 d4",
    title: "Alekhine Defense",
    blurb: "The knight taunts e5; e5 files a restraining order.",
  },
  {
    prefix: "e4 d6 d4 Nf6 Nc3",
    title: "Pirc / Modern orbit",
    blurb: "King safety negotiable; fianchetto inevitable.",
  },
  // Caro-Kann “refuted” meme line (Advance with early wing poke) — keep playful
  {
    prefix: "e4 c6 d4 d5 f3",
    title: "Caro-Kann (ambitious / shovey)",
    blurb: "The internet calls lines like this ‘refuted’; your mouse calls them ‘fun.’",
  },
];

function normalizeLine(line: string): string {
  return line.trim().replace(/\s+/g, " ");
}

/** Longer prefixes first so `e4 c6 d4 d5 Nc3` beats `e4 c6 d4 d5`. */
const BY_PREFIX_LONGEST_FIRST = [...BY_PREFIX].sort(
  (a, b) =>
    normalizeLine(b.prefix).split(" ").length -
    normalizeLine(a.prefix).split(" ").length,
);

export function openingDisplayFromLine(line: string): OpeningDisplay {
  const key = normalizeLine(line);
  const tokens = key.split(" ");
  if (tokens.length === 0 || tokens[0] === "") {
    return { title: "Empty board cosplay", blurb: "No moves parsed." };
  }

  for (const { prefix, title, blurb } of BY_PREFIX_LONGEST_FIRST) {
    const p = normalizeLine(prefix);
    if (key === p || key.startsWith(p + " ")) {
      return { title, blurb };
    }
  }

  // Short generic families from first two plies
  const t = tokens;
  if (t[0] === "e4" && t[1] === "c6")
    return {
      title: "Caro-Kann sideline",
      blurb: "Still …c6 energy — the name tag fell off this branch.",
    };
  if (t[0] === "e4" && t[1] === "c5")
    return {
      title: "Sicilian sideline",
      blurb: "…c5 spoke; the sequel is unlicensed.",
    };
  if (t[0] === "e4" && t[1] === "e6")
    return { title: "French sideline", blurb: "e6 filed the paperwork; the plan is TBD." };
  if (t[0] === "e4" && t[1] === "e5")
    return { title: "Open game sideline", blurb: "Double king’s pawn — plot twist pending." };
  if (t[0] === "d4" && t[1] === "d5")
    return { title: "Closed game sideline", blurb: "The d-file is a shared spreadsheet." };

  return {
    title: "Custom five-ply fingerprint",
    blurb: "No marquee name on file — you’re freelancing in theory space.",
  };
}
