import { Fragment, useRef, type KeyboardEvent } from "react";
import { Input } from "@/components/ui/input";
import { CODE_LENGTH, codeChars } from "@/lib/handoff";

interface Props {
  /** One character per box, "" where nothing is typed yet. */
  value: readonly string[];
  onChange: (next: string[]) => void;
  labelledBy: string;
  invalid?: boolean;
  disabled?: boolean;
}

/**
 * A handoff code as one box per character, `ABCD-EFGH`: focus moves on as
 * you type and back as you delete, and a paste (or the keyboard's one-time
 * code suggestion) fills the boxes from the one it lands in.
 */
export function CodeInput({
  value,
  onChange,
  labelledBy,
  invalid,
  disabled,
}: Props) {
  const boxes = useRef<Array<HTMLInputElement | null>>([]);
  const focus = (index: number) => {
    const box = boxes.current[Math.max(0, Math.min(CODE_LENGTH - 1, index))];
    box?.focus();
    box?.select();
  };

  const type = (index: number, raw: string) => {
    // A caret beside the box's character (not over it) adds rather than
    // replaces: keep only the new one.
    const old = value[index];
    const chars = codeChars(
      old && raw.length === 2 && raw.includes(old) ? raw.replace(old, "") : raw,
    );
    const next = [...value];
    if (chars.length === 0) {
      next[index] = "";
      onChange(next);
      return;
    }
    chars.slice(0, CODE_LENGTH - index).forEach((char, offset) => {
      next[index + offset] = char;
    });
    onChange(next);
    focus(index + chars.length);
  };

  const key = (index: number, event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Backspace" && !value[index] && index > 0) {
      event.preventDefault();
      const next = [...value];
      next[index - 1] = "";
      onChange(next);
      focus(index - 1);
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      focus(index - 1);
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      focus(index + 1);
    }
  };

  return (
    <div
      role="group"
      aria-labelledby={labelledBy}
      className="flex w-full max-w-sm items-center gap-1"
    >
      {Array.from({ length: CODE_LENGTH }, (_, index) => (
        <Fragment key={index}>
          {index === CODE_LENGTH / 2 && (
            <span aria-hidden className="px-0.5 text-muted-foreground">
              -
            </span>
          )}
          <Input
            ref={(box) => {
              boxes.current[index] = box;
            }}
            aria-label={`Character ${index + 1} of ${CODE_LENGTH}`}
            autoComplete={index === 0 ? "one-time-code" : "off"}
            autoCapitalize="characters"
            autoCorrect="off"
            spellCheck={false}
            autoFocus={index === 0}
            disabled={disabled}
            aria-invalid={invalid ? true : undefined}
            className="h-11 w-full max-w-11 min-w-0 px-0 text-center font-mono text-lg uppercase"
            value={value[index] ?? ""}
            onFocus={(event) => event.target.select()}
            onChange={(event) => type(index, event.target.value)}
            onKeyDown={(event) => key(index, event)}
          />
        </Fragment>
      ))}
    </div>
  );
}
