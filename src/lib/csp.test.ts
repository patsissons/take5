import { describe, expect, it } from "vitest";
import headersFile from "../../public/_headers?raw";
import { allHosts, PROVIDER_HOSTS } from "@/providers/hosts";
import {
  cspDirectives,
  devHeaders,
  parseHeaders,
  renderHeadersFile,
  securityHeaders,
} from "./csp";

const HOSTS = ["api.example", "media.example"];

describe("cspDirectives", () => {
  it("allows no network but the given hosts over https", () => {
    const csp = cspDirectives(HOSTS);
    expect(csp["default-src"]).toEqual(["'none'"]);
    expect(csp["connect-src"]).toEqual([
      "https://api.example",
      "https://media.example",
    ]);
    expect(csp["script-src"]).toEqual(["'self'"]);
    expect(csp["media-src"]).toEqual(["blob:"]);
    expect(csp["frame-ancestors"]).toEqual(["'none'"]);
  });
});

describe("securityHeaders", () => {
  it("sends no referrer to providers and refuses framing", () => {
    const headers = securityHeaders(HOSTS);
    expect(headers["Referrer-Policy"]).toBe("no-referrer");
    expect(headers["X-Frame-Options"]).toBe("DENY");
    expect(headers["Content-Security-Policy"]).toContain(
      "connect-src https://api.example https://media.example;",
    );
  });
});

describe("renderHeadersFile / parseHeaders", () => {
  it("round-trips through the _headers format", () => {
    const headers = securityHeaders(HOSTS);
    const file = renderHeadersFile(headers);
    expect(file.startsWith("/*\n  Content-Security-Policy: ")).toBe(true);
    expect(parseHeaders(file)).toEqual(headers);
  });

  it("ignores rules for other paths", () => {
    expect(parseHeaders("/other\n  X-A: 1\n/*\n  X-B: 2\n")).toEqual({
      "X-B": "2",
    });
  });
});

describe("devHeaders", () => {
  it("allows only Vite's inline preamble and HMR socket on top", () => {
    const prod = securityHeaders(HOSTS)["Content-Security-Policy"]!;
    const dev = devHeaders(securityHeaders(HOSTS))["Content-Security-Policy"];
    expect(dev).toContain("script-src 'self' 'unsafe-inline';");
    expect(dev).toContain(
      "connect-src 'self' ws: wss: https://api.example https://media.example;",
    );
    expect(
      dev!.replace(" 'unsafe-inline';", ";").replace(" 'self' ws: wss:", ""),
    ).toBe(prod);
  });
});

describe("public/_headers", () => {
  it("matches the provider host list (run `pnpm headers` if not)", () => {
    expect(headersFile).toBe(renderHeadersFile(securityHeaders(allHosts())));
  });

  it("covers every provider", () => {
    for (const hosts of Object.values(PROVIDER_HOSTS)) {
      for (const host of hosts) expect(allHosts()).toContain(host);
    }
  });
});
