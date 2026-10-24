import type { MediaModel } from "@/providers/types";

/**
 * A bundled snapshot of a public text-to-video arena: the app may contact
 * nothing but the visitor's provider, so the scores ship with it. Refresh
 * by hand from the leaderboard and move `asOf` along.
 */
export const ARENA = {
  source: "Artificial Analysis Video Arena (text to video)",
  url: "https://artificialanalysis.ai/video/leaderboard/text-to-video",
  asOf: "2026-10-19",
} as const;

interface Entry {
  /** The leaderboard's name for the model. */
  name: string;
  elo: number;
  /** The model family, matched against the normalised id and name. */
  family: RegExp;
  /** The tier words the model carries; must match exactly (see TIERS). */
  tiers?: string[];
}

/**
 * Words that tell a cheaper or pricier sibling apart from its flagship.
 * A model only takes an entry's score when its leftover words carry the
 * same tiers, so "Veo 3.1 Fast" never inherits "Veo 3.1".
 */
const TIERS = new Set([
  "fast",
  "lite",
  "turbo",
  "mini",
  "max",
  "pro",
  "standard",
  "omni",
]);

const ENTRIES: Entry[] = [
  { name: "Wan 3.0", elo: 1173, family: /wan-?v?3(?:\.0)?(?![.\d])/g },
  { name: "Utopai X", elo: 1166, family: /utopai-x(?![a-z\d])/g },
  {
    name: "Dreamina Seedance 2.5",
    elo: 1159,
    family: /seedance-?v?2\.5(?![.\d])/g,
  },
  {
    name: "FLUX 3 Max",
    elo: 1159,
    family: /flux-?3(?![.\d])/g,
    tiers: ["max"],
  },
  { name: "MiniMax H3", elo: 1158, family: /minimax-h3(?![.\d])/g },
  {
    name: "MiniMax H3 Max",
    elo: 1156,
    family: /minimax-h3(?![.\d])/g,
    tiers: ["max"],
  },
  { name: "FLUX 3", elo: 1145, family: /flux-?3(?![.\d])/g },
  {
    name: "Dreamina Seedance 2.0",
    elo: 1138,
    family: /seedance-?v?2(?:\.0)?(?![.\d])/g,
  },
  {
    name: "Gemini Omni Flash 1.1",
    elo: 1132,
    family: /gemini-omni-flash-1\.1(?![.\d])/g,
  },
  { name: "Agnes-Video-2.5", elo: 1069, family: /agnes-video-2\.5(?![.\d])/g },
  {
    name: "Grok Imagine Video 1.5",
    elo: 1059,
    family: /grok-imagine-video-1\.5(?![.\d])/g,
  },
  { name: "HappyHorse-1.1", elo: 1054, family: /happyhorse-1\.1(?![.\d])/g },
  { name: "MAGI-2", elo: 1044, family: /magi-2(?![.\d])/g },
  { name: "Wan 2.7", elo: 1040, family: /wan-?v?2\.7(?![.\d])/g },
  {
    name: "HappyHorse-1.0",
    elo: 1034,
    family: /happyhorse-1(?:\.0)?(?![.\d])/g,
  },
  {
    name: "Kling 3.0 Omni (Pro)",
    elo: 1020,
    family: /kling(?:-video)?-v?3(?:\.0)?(?![.\d])/g,
    tiers: ["omni", "pro"],
  },
  {
    name: "Kling 3.0 (Pro)",
    elo: 1000,
    family: /kling(?:-video)?-v?3(?:\.0)?(?![.\d])/g,
    tiers: ["pro"],
  },
  {
    name: "Grok Imagine Video 1.5 Lite",
    elo: 998,
    family: /grok-imagine-video-1\.5(?![.\d])/g,
    tiers: ["lite"],
  },
  { name: "PixVerse V6", elo: 989, family: /pixverse-v?6(?![.\d])/g },
  { name: "Veo 3.1", elo: 968, family: /veo-?3\.1(?![.\d])/g },
  {
    name: "Veo 3.1 Fast",
    elo: 964,
    family: /veo-?3\.1(?![.\d])/g,
    tiers: ["fast"],
  },
  {
    name: "Veo 3.1 Lite",
    elo: 952,
    family: /veo-?3\.1(?![.\d])/g,
    tiers: ["lite"],
  },
  {
    name: "LTX-2.5 Fast",
    elo: 951,
    family: /ltx-?(?:video-)?2\.5(?![.\d])/g,
    tiers: ["fast"],
  },
  {
    name: "LTX-2.5 Pro",
    elo: 948,
    family: /ltx-?(?:video-)?2\.5(?![.\d])/g,
    tiers: ["pro"],
  },
  {
    name: "Vidu Q3 Pro",
    elo: 943,
    family: /vidu-q3(?![.\d])/g,
    tiers: ["pro"],
  },
  {
    name: "Vidu Q3 Turbo",
    elo: 918,
    family: /vidu-q3(?![.\d])/g,
    tiers: ["turbo"],
  },
  {
    name: "LTX-2.3 Pro",
    elo: 894,
    family: /ltx-?(?:video-)?2\.3(?![.\d])/g,
    tiers: ["pro"],
  },
  {
    name: "LTX-2.3 Fast",
    elo: 845,
    family: /ltx-?(?:video-)?2\.3(?![.\d])/g,
    tiers: ["fast"],
  },
  { name: "Boreal", elo: 830, family: /(?:^|-)boreal(?![a-z\d])/g },
];

/** Lower case, with every run of separators turned into one dash. */
function normalise(text: string): string {
  return text.toLowerCase().replace(/[^a-z\d.]+/g, "-");
}

function tiersOf(text: string): Set<string> {
  return new Set(text.split("-").filter((word) => TIERS.has(word)));
}

function sameSet(a: Set<string>, b: string[]): boolean {
  return a.size === b.length && b.every((word) => a.has(word));
}

/** The arena entry for a model, matched on its id and display name. */
export function arenaEntry(
  model: Pick<MediaModel, "id" | "name">,
): Pick<Entry, "name" | "elo"> | undefined {
  const text = `${normalise(model.id)}-${normalise(model.name)}`;
  for (const entry of ENTRIES) {
    entry.family.lastIndex = 0;
    if (!entry.family.test(text)) continue;
    const rest = text.replace(entry.family, "-");
    if (sameSet(tiersOf(rest), entry.tiers ?? [])) {
      return { name: entry.name, elo: entry.elo };
    }
  }
  return undefined;
}

export function arenaElo(
  model: Pick<MediaModel, "id" | "name">,
): number | undefined {
  return arenaEntry(model)?.elo;
}

/** Highest Elo first; unranked models after, in the order they came. */
export function rankModels<T extends Pick<MediaModel, "id" | "name">>(
  models: T[],
): T[] {
  return models
    .map((model, index) => ({ model, index, elo: arenaElo(model) }))
    .sort(
      (a, b) =>
        (b.elo ?? -Infinity) - (a.elo ?? -Infinity) || a.index - b.index,
    )
    .map(({ model }) => model);
}
