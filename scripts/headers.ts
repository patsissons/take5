/**
 * Writes public/_headers, the security headers (CSP included) Cloudflare
 * serves with every response, from the provider host list in
 * src/providers/hosts.ts. src/lib/csp.test.ts fails when the committed file
 * is out of date.
 *
 *   pnpm headers
 */
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { renderHeadersFile, securityHeaders } from "../src/lib/csp.ts";
import { allHosts } from "../src/providers/hosts.ts";

const out = path.resolve(import.meta.dirname, "../public/_headers");
await writeFile(out, renderHeadersFile(securityHeaders(allHosts())));
console.log(`wrote public/_headers for ${allHosts().join(", ")}`);
