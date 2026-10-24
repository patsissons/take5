import { useMemo } from "react";
import { encode } from "uqr";
import { cn } from "cn";

interface Props {
  value: string;
  label: string;
  className?: string;
}

/** A QR code as one SVG path, dark on light in either theme. */
export function QrCode({ value, label, className }: Props) {
  const { size, path } = useMemo(() => {
    const qr = encode(value, { ecc: "M", border: 4 });
    let d = "";
    qr.data.forEach((row, y) =>
      row.forEach((dark, x) => {
        if (dark) d += `M${x} ${y}h1v1h-1z`;
      }),
    );
    return { size: qr.size, path: d };
  }, [value]);
  return (
    <svg
      role="img"
      aria-label={label}
      viewBox={`0 0 ${size} ${size}`}
      shapeRendering="crispEdges"
      className={cn("bg-qr text-qr-foreground", className)}
    >
      <path d={path} fill="currentColor" />
    </svg>
  );
}
