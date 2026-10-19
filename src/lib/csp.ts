/**
 * The security headers Cloudflare serves with every page (public/_headers),
 * built from the provider host list. Runtime-agnostic (no DOM): both the
 * generator script and vite.config.ts import it under Node.
 */

export type Headers = Record<string, string>;

/** CSP directives, strictest first: nothing is allowed unless listed. */
export function cspDirectives(
  hosts: readonly string[],
): Record<string, string[]> {
  return {
    "default-src": ["'none'"],
    "script-src": ["'self'"],
    // Radix (shadcn/ui) writes inline style attributes; styles never load
    // from anywhere but the bundle.
    "style-src": ["'self'", "'unsafe-inline'"],
    // Local previews and thumbnails are object URLs and data URLs.
    "img-src": ["'self'", "blob:", "data:"],
    // Videos play from blobs held in the browser, never from a remote URL.
    "media-src": ["blob:"],
    "font-src": ["'self'"],
    // The only network the app can reach: the providers' APIs.
    "connect-src": hosts.map((host) => `https://${host}`),
    "base-uri": ["'none'"],
    "form-action": ["'none'"],
    "frame-ancestors": ["'none'"],
  };
}

export function renderCsp(directives: Record<string, string[]>): string {
  return Object.entries(directives)
    .map(([name, values]) => [name, ...values].join(" "))
    .join("; ");
}

export function securityHeaders(hosts: readonly string[]): Headers {
  return {
    "Content-Security-Policy": renderCsp(cspDirectives(hosts)),
    // Never tell a provider which page the request came from.
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Cross-Origin-Opener-Policy": "same-origin",
    "Permissions-Policy":
      "camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()",
  };
}

/** The Cloudflare `_headers` file: one rule for every path. */
export function renderHeadersFile(headers: Headers): string {
  const lines = Object.entries(headers).map(
    ([name, value]) => `  ${name}: ${value}`,
  );
  return ["/*", ...lines, ""].join("\n");
}

/** Reads the `/*` rule back out of a `_headers` file. */
export function parseHeaders(file: string): Headers {
  const headers: Headers = {};
  let inRule = false;
  for (const line of file.split("\n")) {
    if (!line.startsWith(" ")) {
      inRule = line.trim() === "/*";
      continue;
    }
    if (!inRule) continue;
    const colon = line.indexOf(":");
    if (colon === -1) continue;
    headers[line.slice(0, colon).trim()] = line.slice(colon + 1).trim();
  }
  return headers;
}

/**
 * The production headers, loosened only as far as `vite dev` needs: its
 * React refresh preamble is an inline script and HMR talks over a local
 * WebSocket.
 */
export function devHeaders(headers: Headers): Headers {
  const csp = headers["Content-Security-Policy"] ?? "";
  const relaxed = csp
    .replace("script-src 'self'", "script-src 'self' 'unsafe-inline'")
    .replace("connect-src", "connect-src 'self' ws: wss:");
  return { ...headers, "Content-Security-Policy": relaxed };
}
