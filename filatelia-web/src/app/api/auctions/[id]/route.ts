import { NextRequest, NextResponse } from "next/server";
import { getAuctionById } from "@/lib/db/auctions";

export const runtime = 'edge';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const resolvedParams = await params;
    const { id } = resolvedParams;

    const auction = await getAuctionById(id);
    if (!auction) {
      return NextResponse.json(
        { success: false, error: "Subasta no encontrada", code: "NOT_FOUND" },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      auction,
    });
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error?.message || "Internal Server Error" },
      { status: 500 }
    );
  }
}
