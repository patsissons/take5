import type { MediaKind, MediaModel } from "@/providers/types";

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
const VIDEO_TIERS = [
  "fast",
  "lite",
  "turbo",
  "mini",
  "max",
  "pro",
  "standard",
  "omni",
];

/** Image models name their variants with more words. */
const IMAGE_TIERS = [
  ...VIDEO_TIERS,
  "flash",
  "quality",
  "instant",
  "klein",
  "flex",
  "dev",
  "large",
  "medium",
  "utility",
  "sunburst",
  "flare",
];

const VIDEO_ENTRIES: Entry[] = [
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

// Families are written to match every provider's spelling: Gemini's model
// ids, OpenRouter's slugs and display names, fal's endpoint paths.
const NANO_BANANA_2 =
  /nano-banana-2(?:\.0)?(?![.\d])|gemini-3\.1-flash(?=-(?:lite-)?image)/g;
const GROK_IMAGE = /grok-imagine-image(?!-v?\d)/g;
const GPT_IMAGE_2_5 = /gpt-image-2\.5(?![.\d])/g;
const MAI_2_6 = /mai-image-2\.6(?![.\d])/g;
const MAI_2_5 = /mai-image-2\.5(?![.\d])/g;
const FLUX_3 = /flux[-.]?3(?![.\d])/g;
const FLUX_2 = /flux[-.]?2(?![.\d])/g;
const KONTEXT = /flux(?:[-.]?1)?(?:-pro)?-kontext/g;
const SEEDREAM_5 = /seedream-?v?5(?:[.-]0)?(?![.\d])/g;
const QWEN_3 = /qwen-image-v?3(?:\.0)?(?![.\d])/g;
const QWEN_2_1 = /qwen-image-v?2\.1(?![.\d])/g;
const RECRAFT_4_1 = /recraft-v?4\.1(?![.\d])/g;
const IDEOGRAM_4 = /ideogram-v?4(?:\.0)?(?![.\d])/g;
const KREA_2 = /krea-2(?![.\d])/g;
const WAN_2_7 = /wan-?v?2\.7(?![.\d])/g;

const IMAGE_ENTRIES: Entry[] = [
  {
    name: "GPT Image 2.5 Sunburst",
    elo: 1222,
    family: GPT_IMAGE_2_5,
    tiers: ["sunburst"],
  },
  {
    name: "GPT Image 2.5 Flare",
    elo: 1207,
    family: GPT_IMAGE_2_5,
    tiers: ["flare"],
  },
  { name: "GPT Image 2", elo: 1186, family: /gpt-image-2(?![.\d])/g },
  { name: "Nano Banana 2.1", elo: 1176, family: /nano-banana-2\.1(?![.\d])/g },
  { name: "MAI-Image-2.6", elo: 1166, family: MAI_2_6 },
  {
    name: "Grok Imagine Image 2.0",
    elo: 1166,
    family: /grok-imagine-image-v?2(?:\.0)?(?![.\d])/g,
  },
  { name: "Nano Banana 2", elo: 1140, family: NANO_BANANA_2 },
  { name: "GPT Image 1.5", elo: 1123, family: /gpt-image-1\.5(?![.\d])/g },
  {
    name: "MAI-Image-2.6-Flash",
    elo: 1119,
    family: MAI_2_6,
    tiers: ["flash"],
  },
  {
    name: "Nano Banana Pro",
    elo: 1118,
    family: /nano-banana-pro(?![a-z\d])|gemini-3-pro-image/g,
  },
  { name: "MAI-Image-2.5", elo: 1118, family: MAI_2_5 },
  { name: "FLUX 3 Image", elo: 1117, family: FLUX_3 },
  { name: "MAI-Image-2.5-Pro", elo: 1114, family: MAI_2_5, tiers: ["pro"] },
  {
    name: "Nano Banana 2 Lite",
    elo: 1107,
    family: NANO_BANANA_2,
    tiers: ["lite"],
  },
  { name: "Seedream 5.0 Pro", elo: 1100, family: SEEDREAM_5, tiers: ["pro"] },
  { name: "Qwen-Image-3.0-Pro", elo: 1095, family: QWEN_3, tiers: ["pro"] },
  { name: "Qwen-Image-3.0", elo: 1070, family: QWEN_3 },
  { name: "Qwen-Image-2.1-Pro", elo: 1056, family: QWEN_2_1, tiers: ["pro"] },
  {
    name: "Grok Imagine Image Quality",
    elo: 1049,
    family: GROK_IMAGE,
    tiers: ["quality"],
  },
  { name: "FLUX 3 Image Klein", elo: 1043, family: FLUX_3, tiers: ["klein"] },
  { name: "Qwen-Image-2.1", elo: 1042, family: QWEN_2_1 },
  { name: "Krea 2 Large", elo: 1034, family: KREA_2, tiers: ["large"] },
  {
    name: "MAI-Image-2.5-Flash",
    elo: 1029,
    family: MAI_2_5,
    tiers: ["flash"],
  },
  {
    name: "Qwen-Image-2.1-Turbo",
    elo: 1029,
    family: QWEN_2_1,
    tiers: ["turbo"],
  },
  {
    name: "Recraft V4.1 Utility",
    elo: 1026,
    family: RECRAFT_4_1,
    tiers: ["utility"],
  },
  {
    name: "Seedream 4.5",
    elo: 1026,
    family: /seedream-?v?4[.-]5(?![.\d])/g,
  },
  { name: "FLUX.2 [flex]", elo: 1026, family: FLUX_2, tiers: ["flex"] },
  {
    name: "Ideogram 4.0 (Quality)",
    elo: 1026,
    family: IDEOGRAM_4,
    tiers: ["quality"],
  },
  { name: "Grok Imagine Image", elo: 1022, family: GROK_IMAGE },
  { name: "FLUX.2 [max]", elo: 1021, family: FLUX_2, tiers: ["max"] },
  {
    name: "Krea 2 Medium Turbo",
    elo: 1020,
    family: KREA_2,
    tiers: ["medium", "turbo"],
  },
  {
    name: "Recraft V4.1 Utility Pro",
    elo: 1017,
    family: RECRAFT_4_1,
    tiers: ["utility", "pro"],
  },
  { name: "Seedream 5.0 Lite", elo: 1017, family: SEEDREAM_5, tiers: ["lite"] },
  { name: "GPT Image 1", elo: 1013, family: /gpt-image-1(?![.\d])/g },
  { name: "Krea 2 Medium", elo: 1012, family: KREA_2, tiers: ["medium"] },
  { name: "FLUX.2 [pro]", elo: 1003, family: FLUX_2, tiers: ["pro"] },
  { name: "Ideogram 4.0", elo: 1002, family: IDEOGRAM_4 },
  { name: "FLUX.2 [dev]", elo: 1000, family: FLUX_2, tiers: ["dev"] },
  {
    name: "FLUX.2 [dev] Turbo",
    elo: 994,
    family: FLUX_2,
    tiers: ["dev", "turbo"],
  },
  {
    name: "FLUX.2 [dev] Flash",
    elo: 988,
    family: FLUX_2,
    tiers: ["dev", "flash"],
  },
  { name: "Wan 2.7", elo: 986, family: WAN_2_7 },
  {
    name: "Nano Banana",
    elo: 985,
    family: /nano-banana(?!-?(?:\d|pro))|gemini-2\.5-flash-image/g,
  },
  {
    name: "Ideogram 4.0 Fast (Quality)",
    elo: 982,
    family: IDEOGRAM_4,
    tiers: ["fast", "quality"],
  },
  {
    name: "Ideogram 4.0 Instant",
    elo: 981,
    family: IDEOGRAM_4,
    tiers: ["instant"],
  },
  { name: "Wan 2.7 Pro", elo: 979, family: WAN_2_7, tiers: ["pro"] },
  {
    name: "Ideogram 4.0 Fast",
    elo: 963,
    family: IDEOGRAM_4,
    tiers: ["fast"],
  },
  {
    name: "Recraft V4.1 Flash",
    elo: 949,
    family: RECRAFT_4_1,
    tiers: ["flash"],
  },
  {
    name: "GPT Image 1 Mini",
    elo: 936,
    family: /gpt-image-1(?![.\d])/g,
    tiers: ["mini"],
  },
  {
    name: "Z-Image Turbo",
    elo: 936,
    family: /(?:^|-)z-image(?![a-z\d])/g,
    tiers: ["turbo"],
  },
  {
    name: "HunyuanImage 3.0",
    elo: 932,
    family: /hunyuan-?image-v?3(?:\.0)?(?![.\d])/g,
  },
  { name: "FLUX.1 Kontext [max]", elo: 929, family: KONTEXT, tiers: ["max"] },
  {
    name: "Kling Image 3.0 Omni",
    elo: 918,
    family: /kling-image-v?3(?:\.0)?(?![.\d])/g,
    tiers: ["omni"],
  },
  { name: "FLUX.1 Kontext [pro]", elo: 917, family: KONTEXT, tiers: ["pro"] },
  {
    name: "Ideogram 3.0",
    elo: 911,
    family: /ideogram-v?3(?:\.0)?(?![.\d])/g,
  },
];

interface Arena {
  source: string;
  /** Short name for labels: "Video Arena". */
  label: string;
  url: string;
  asOf: string;
  tiers: Set<string>;
  entries: Entry[];
}

/**
 * Bundled snapshots of public arenas, one per kind: the app may contact
 * nothing but the visitor's provider, so the scores ship with it. Refresh
 * by hand from each leaderboard and move its `asOf` along. Separate tables
 * keep a video model from taking an image model's score (FLUX 3 is in both).
 */
export const ARENAS: Record<MediaKind, Arena> = {
  video: {
    source: "Artificial Analysis Video Arena (text to video)",
    label: "Video Arena",
    url: "https://artificialanalysis.ai/video/leaderboard/text-to-video",
    asOf: "2026-10-19",
    tiers: new Set(VIDEO_TIERS),
    entries: VIDEO_ENTRIES,
  },
  image: {
    source: "Artificial Analysis Image Arena (text to image)",
    label: "Image Arena",
    url: "https://artificialanalysis.ai/text-to-image/arena/leaderboard-text",
    asOf: "2026-10-24",
    tiers: new Set(IMAGE_TIERS),
    entries: IMAGE_ENTRIES,
  },
};

type Rankable = Pick<MediaModel, "id" | "name"> &
  Partial<Pick<MediaModel, "kind">>;

/** Lower case, with every run of separators turned into one dash. */
function normalise(text: string): string {
  return text.toLowerCase().replace(/[^a-z\d.]+/g, "-");
}

function tiersOf(text: string, tiers: Set<string>): Set<string> {
  return new Set(text.split("-").filter((word) => tiers.has(word)));
}

function sameSet(a: Set<string>, b: string[]): boolean {
  return a.size === b.length && b.every((word) => a.has(word));
}

/**
 * The arena entry for a model, matched on its id and display name in its
 * kind's arena (video when the model does not say).
 */
export function arenaEntry(
  model: Rankable,
): Pick<Entry, "name" | "elo"> | undefined {
  const arena = ARENAS[model.kind ?? "video"];
  const text = `${normalise(model.id)}-${normalise(model.name)}`;
  for (const entry of arena.entries) {
    entry.family.lastIndex = 0;
    if (!entry.family.test(text)) continue;
    const rest = text.replace(entry.family, "-");
    if (sameSet(tiersOf(rest, arena.tiers), entry.tiers ?? [])) {
      return { name: entry.name, elo: entry.elo };
    }
  }
  return undefined;
}

export function arenaElo(model: Rankable): number | undefined {
  return arenaEntry(model)?.elo;
}

/** Highest Elo first; unranked models after, in the order they came. */
export function rankModels<T extends Rankable>(models: T[]): T[] {
  return models
    .map((model, index) => ({ model, index, elo: arenaElo(model) }))
    .sort(
      (a, b) =>
        (b.elo ?? -Infinity) - (a.elo ?? -Infinity) || a.index - b.index,
    )
    .map(({ model }) => model);
}
