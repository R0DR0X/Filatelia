import { NextRequest, NextResponse } from "next/server";
import { getAuctions } from "@/lib/db/auctions";

export const runtime = 'edge';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const status = searchParams.get("status") || undefined;
    const sortBy = searchParams.get("sortBy") || undefined;

    const auctions = await getAuctions(status, sortBy);

    return NextResponse.json({
      success: true,
      auctions,
      total: auctions.length,
    });
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error?.message || "Internal server error" },
      { status: 500 }
    );
  }
}
