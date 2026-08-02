import { NextRequest, NextResponse } from "next/server";
import { placeBid } from "@/lib/db/auctions";

export const runtime = 'edge';

export async function POST(request: NextRequest) {
  try {
    // 1. Authentication check
    const authHeader = request.headers.get("authorization");
    const cookieToken = request.cookies.get("fp_session")?.value;
    const headerUserId = request.headers.get("x-user-id");
    const headerUserName = request.headers.get("x-user-name");

    let userId: string | null = null;
    let userName = "Coleccionista";

    if (authHeader && authHeader.startsWith("Bearer ")) {
      const token = authHeader.substring(7);
      if (token && token.trim() !== "") {
        userId = token.startsWith("usr_") ? token : `usr_${token.slice(0, 8)}`;
      }
    } else if (cookieToken) {
      userId = cookieToken.startsWith("usr_") ? cookieToken : `usr_${cookieToken.slice(0, 8)}`;
    } else if (process.env.NODE_ENV === "test" && headerUserId) {
      userId = headerUserId;
      if (headerUserName) userName = headerUserName;
    }

    if (!userId) {
      return NextResponse.json(
        { success: false, error: "Debes iniciar sesión para realizar una puja", code: "UNAUTHORIZED" },
        { status: 401 }
      );
    }

    // 2. Parse request body
    const body = await request.json();
    const { auctionId, amount, expectedCurrentHighestBid } = body;

    if (!auctionId || typeof amount !== "number" || isNaN(amount) || amount <= 0) {
      return NextResponse.json(
        { success: false, error: "Datos de puja inválidos o monto debe ser positivo", code: "INVALID_INPUT" },
        { status: 422 }
      );
    }

    // 3. Execute placeBid helper with OCC
    const result = await placeBid(auctionId, userId, userName, amount, expectedCurrentHighestBid);

    if (!result.success) {
      let status = 400;
      if (result.code === "BID_TOO_LOW" || result.code === "INVALID_INPUT") status = 422;
      if (result.code === "AUCTION_EXPIRED") status = 400;
      if (result.code === "CONCURRENT_BID_CONFLICT") status = 409;
      if (result.code === "UNAUTHORIZED") status = 401;

      return NextResponse.json(result, { status });
    }

    return NextResponse.json(result, { status: 201 });
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error?.message || "Internal server error" },
      { status: 500 }
    );
  }
}
