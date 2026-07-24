import { NextRequest, NextResponse } from "next/server";
import { getAllUserCollections } from "@/lib/db/collection";
import { calculateReciprocalMatches } from "@/lib/match-engine";

function getUserIdFromSession(request: NextRequest): string | null {
  const sessionCookie = request.cookies.get("fp_session")?.value;
  if (!sessionCookie) {
    const authHeader = request.headers.get("authorization");
    if (authHeader && authHeader.startsWith("Bearer ")) {
      const token = authHeader.substring(7);
      if (token.startsWith("usr_")) return token;
    }
    return null;
  }

  try {
    const parsed = JSON.parse(sessionCookie);
    return parsed.id || null;
  } catch {
    return sessionCookie.startsWith("usr_") ? sessionCookie : null;
  }
}

export async function GET(request: NextRequest) {
  const userId = getUserIdFromSession(request);
  if (!userId) {
    return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
  }

  try {
    const allItems = await getAllUserCollections();
    const proposals = calculateReciprocalMatches(userId, allItems);

    return NextResponse.json({
      success: true,
      userId,
      proposalsCount: proposals.length,
      proposals,
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
