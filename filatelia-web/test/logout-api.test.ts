import { describe, it, expect } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "../src/app/api/auth/logout/route";
import { verifySession, signSession } from "../src/lib/session";

describe("POST /api/auth/logout", () => {
  it("clears the fp_session cookie so a subsequent request has no valid session", async () => {
    const token = await signSession({ id: "usr_1" });
    const request = new NextRequest("http://localhost:3000/api/auth/logout", {
      method: "POST",
      headers: { Cookie: `fp_session=${token}` },
    });

    const response = await POST(request);
    expect(response.status).toBe(200);

    const cleared = response.cookies.get("fp_session");
    // Either the cookie is removed entirely, or set to an empty/expired
    // value — either way it must not still verify as the original session.
    const clearedValue = cleared?.value ?? "";
    const payload = clearedValue ? await verifySession(clearedValue) : null;
    expect(payload).toBeNull();
  });
});
