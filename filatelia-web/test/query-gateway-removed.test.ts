import { describe, it, expect, vi, afterEach } from "vitest";

// The Worker's /query endpoint no longer accepts a `sql` field (see
// workers/filatelia-api/src/index.ts). These D1 access helpers used to fall
// back to POSTing `{ sql, params }` to that endpoint whenever no direct D1
// binding was available. That capability is gone, so the fallback must no
// longer attempt it: it should fail loudly with a clear configuration error
// instead of silently sending a `sql` payload over the network.

describe("D1 access helpers without a bound DB", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    delete (process.env as any).DB;
  });

  it("collection.ts never sends a sql payload to the network when DB is unbound", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const { getUserCollection } = await import("../src/lib/db/collection");
    await expect(getUserCollection("user-1")).rejects.toThrow();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("prisma.ts never sends a sql payload to the network when DB is unbound", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const { prisma } = await import("../src/lib/prisma");
    await expect(prisma.country.findMany()).rejects.toThrow();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
