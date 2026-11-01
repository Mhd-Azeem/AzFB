import { afterEach, describe, expect, it, vi } from "vitest";
import { exchange, graph, GraphError } from "./meta-client";
import type { Env } from "./types";
const env = {
  APP_ORIGIN: "https://crm.example.test",
  META_APP_ID: "12345",
  META_APP_SECRET: "fixture-app-secret",
  META_GRAPH_VERSION: "v26.0",
  TOKEN_ENCRYPTION_KEY: btoa("x".repeat(32)),
} as Env;
afterEach(() => vi.unstubAllGlobals());
describe("Workers-compatible Meta requests", () => {
  it("uses supported manual redirects in both OAuth exchanges and preserves the callback", async () => {
    const f = vi.fn(async (_url: unknown, init: RequestInit) => {
      if (init.redirect === "error")
        throw new TypeError("Unsupported Workers redirect mode");
      return new Response(
        JSON.stringify({ access_token: "fixture-token", expires_in: 3600 }),
      );
    });
    vi.stubGlobal("fetch", f);
    await expect(
      exchange(env, {
        code: "fixture-code",
        redirect_uri: env.APP_ORIGIN + "/api/meta/callback",
      }),
    ).resolves.toMatchObject({ access_token: "fixture-token" });
    await exchange(env, {
      grant_type: "fb_exchange_token",
      fb_exchange_token: "fixture-short",
    });
    expect(f.mock.calls).toHaveLength(2);
    for (const [, options] of f.mock.calls)
      expect(options.redirect).toBe("manual");
    expect(
      new URL(String(f.mock.calls[0][0])).searchParams.get("redirect_uri"),
    ).toBe(env.APP_ORIGIN + "/api/meta/callback");
  });
  it("uses manual mode for authenticated Graph calls without putting the bearer token in the URL", async () => {
    const f = vi.fn(async (_url: unknown, init: RequestInit) => {
      if (init.redirect === "error")
        throw new TypeError("Unsupported Workers redirect mode");
      return new Response(JSON.stringify({ id: "111" }));
    });
    vi.stubGlobal("fetch", f);
    await expect(
      graph(env, "111", "fixture-bearer", { fields: "id" }),
    ).resolves.toEqual({ id: "111" });
    expect(f.mock.calls[0][1].redirect).toBe("manual");
    expect(
      (f.mock.calls[0][1].headers as Record<string, string>).Authorization,
    ).toBe("Bearer fixture-bearer");
    expect(String(f.mock.calls[0][0])).not.toContain("fixture-bearer");
  });
  it("rejects redirects without following their destination or leaking it to the user", async () => {
    const f = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(null, {
          status: 302,
          headers: { Location: "https://untrusted.example/credential-target" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(null, {
          status: 307,
          headers: { Location: "https://untrusted.example/credential-target" },
        }),
      );
    vi.stubGlobal("fetch", f);
    await expect(exchange(env, { code: "fixture-code" })).rejects.toMatchObject(
      { code: "oauth_redirect", transient: false },
    );
    await expect(graph(env, "111", "fixture-bearer")).rejects.toMatchObject({
      code: "redirect",
      transient: false,
    });
    expect(f).toHaveBeenCalledTimes(2);
    for (const [url] of f.mock.calls)
      expect(new URL(String(url)).hostname).toBe("graph.facebook.com");
  });
  it("asks for fresh authorization on OAuth transport failure instead of claiming a scheduled retry", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockRejectedValue(
          new TypeError("Transport error with private URL details"),
        ),
    );
    try {
      await exchange(env, { code: "fixture-code" });
      throw new Error("Expected failure");
    } catch (e) {
      expect(e).toBeInstanceOf(GraphError);
      expect((e as GraphError).code).toBe("oauth_network");
      expect((e as Error).message).toContain("fresh authorization code");
      expect((e as Error).message).not.toMatch(/scheduled|private URL/);
    }
  });
  it("returns safe diagnostics for unreadable and rejected OAuth responses", async () => {
    const f = vi
      .fn()
      .mockResolvedValueOnce(
        new Response("<html>unavailable</html>", { status: 503 }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ error: { message: "sensitive provider details" } }),
          { status: 400 },
        ),
      );
    vi.stubGlobal("fetch", f);
    await expect(exchange(env, { code: "fixture-code" })).rejects.toMatchObject(
      { code: "oauth_invalid_response", transient: true },
    );
    try {
      await exchange(env, { code: "fixture-code" });
      throw new Error("Expected failure");
    } catch (e) {
      expect(e).toBeInstanceOf(GraphError);
      expect((e as GraphError).code).toBe("oauth_exchange");
      expect((e as Error).message).toContain("App ID");
      expect((e as Error).message).not.toContain("sensitive provider details");
    }
  });
});
