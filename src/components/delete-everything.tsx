import { useState } from "react";
import { Button } from "@/components/ui/button";

interface Props {
  onConfirm: () => void;
}

/** A two-step destructive button: no browser dialog needed. */
export function DeleteEverything({ onConfirm }: Props) {
  const [armed, setArmed] = useState(false);
  if (!armed) {
    return (
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={() => setArmed(true)}
      >
        Delete everything
      </Button>
    );
  }
  return (
    <span className="inline-flex items-center gap-2">
      <Button
        type="button"
        variant="destructive"
        size="sm"
        onClick={() => {
          setArmed(false);
          onConfirm();
        }}
      >
        Really delete keys, settings and videos
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={() => setArmed(false)}
      >
        Keep
      </Button>
    </span>
  );
}
