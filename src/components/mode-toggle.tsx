import { Film, ImageIcon } from "lucide-react";
import type { MediaKind } from "@/providers/types";

interface Props {
  mode: MediaKind;
  /** The kinds the provider makes; nothing to choose with fewer than two. */
  kinds: readonly MediaKind[];
  disabled?: boolean;
  onChange: (mode: MediaKind) => void;
}

const MODES: Array<{ kind: MediaKind; label: string; Icon: typeof Film }> = [
  { kind: "video", label: "Video", Icon: Film },
  { kind: "image", label: "Image", Icon: ImageIcon },
];

/** Video or Image: which of the provider's model lists the studio uses. */
export function ModeToggle({ mode, kinds, disabled, onChange }: Props) {
  if (kinds.length < 2) return null;
  return (
    <div
      role="group"
      aria-label="What to make"
      className="inline-flex shrink-0 rounded-lg border bg-card p-0.5"
    >
      {MODES.filter(({ kind }) => kinds.includes(kind)).map(
        ({ kind, label, Icon }) => (
          <button
            key={kind}
            type="button"
            aria-pressed={kind === mode}
            disabled={disabled}
            onClick={() => kind !== mode && onChange(kind)}
            className="inline-flex cursor-pointer items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium text-muted-foreground transition hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50 aria-pressed:bg-primary aria-pressed:text-primary-foreground"
          >
            <Icon aria-hidden className="size-3.5" />
            {label}
          </button>
        ),
      )}
    </div>
  );
}
