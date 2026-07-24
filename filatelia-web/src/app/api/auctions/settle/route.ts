import { NextRequest, NextResponse } from "next/server";
import { settleExpiredAuctions } from "@/lib/db/auctions";

export async function POST(request: NextRequest) {
  try {
    const settlementKeyHeader = request.headers.get("x-settlement-key") || undefined;
    const authHeader = request.headers.get("authorization");

    const validKey = process.env.SETTLEMENT_KEY || "filatelia_settlement_secret_2026";
    const adminToken = process.env.ADMIN_TOKEN || "admin";
    const isAuthorized = 
      settlementKeyHeader === validKey || 
      authHeader === `Bearer ${adminToken}`;

    if (!isAuthorized) {
      return NextResponse.json(
        { success: false, error: "Unauthorized settlement trigger", code: "UNAUTHORIZED_SETTLEMENT" },
        { status: 401 }
      );
    }

    const result = await settleExpiredAuctions(settlementKeyHeader);

    return NextResponse.json({
      success: true,
      settledCount: result.settledCount,
      settledIds: result.settledIds,
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error?.message || "Internal server error" },
      { status: 500 }
    );
  }
}
