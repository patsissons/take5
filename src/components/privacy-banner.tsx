import { ShieldCheck } from "lucide-react";

/**
 * The one-line promise that is always on screen. The Content-Security-Policy
 * (public/_headers) is what makes it true: the browser refuses any request
 * to a host that is not a provider's.
 */
export function PrivacyBanner() {
  return (
    <p
      role="note"
      className="flex items-center justify-center gap-2 border-b bg-card px-4 py-2 text-center text-sm text-muted-foreground"
    >
      <ShieldCheck aria-hidden className="size-4 shrink-0 text-primary" />
      <span>
        Your key and videos never leave this browser except to go to the
        provider you pick.{" "}
        <a href="#privacy" className="underline hover:text-foreground">
          How that is enforced
        </a>
      </span>
    </p>
  );
}
