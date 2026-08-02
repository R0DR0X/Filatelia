import { NextRequest, NextResponse } from "next/server";
import { getAllUserCollections } from "@/lib/db/collection";
import { calculateReciprocalMatches } from "@/lib/match-engine";

import { verifySession } from "@/lib/session";

export const runtime = 'edge';

async function getUserIdFromSession(request: NextRequest): Promise<string | null> {
  const sessionCookie = request.cookies.get("fp_session")?.value;
  if (!sessionCookie) {
    return null;
  }

  const payload = await verifySession(sessionCookie);
  return payload?.id || null;
}

export async function GET(request: NextRequest) {
  const userId = await getUserIdFromSession(request);
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
