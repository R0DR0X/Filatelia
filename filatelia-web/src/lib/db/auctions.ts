import { Auction, Bid, AuctionWithDetails, AuctionStatus } from "@/types/auction";

const INITIAL_AUCTIONS: Auction[] = [
  {
    id: "auc-01",
    stampId: "PE-1857-01",
    title: "Perú 1857 1d Azul UN DINERO - Par Horizontal Raro",
    description: "Excelente pareja horizontal del primer sello oficial de Perú. Margen amplio, cancelación de rejilla negra en perfecto estado de conservación filatélico.",
    imageUrl: "https://images.unsplash.com/photo-1579783902614-a3fb3927b675?w=600&auto=format&fit=crop",
    startingPrice: 120.00,
    minIncrement: 10.00,
    currentHighestBid: 150.00,
    currentHighestBidderId: "usr_gold_01",
    currentHighestBidderName: "Carlos M.",
    totalBids: 4,
    startTime: new Date(Date.now() - 3600 * 1000 * 24).toISOString(),
    endTime: new Date(Date.now() + 3600 * 1000 * 2).toISOString(), // 2 hours remaining
    status: "active",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: "auc-02",
    stampId: "PE-1858-02",
    title: "Perú 1858 1d Rojo Frambuesa - Carta Completa Circulada",
    description: "Carta circulada desde Arequipa a Lima con matasellos fechador ovalado de 1858. Pieza de museo certificado por filatelia peruana.",
    imageUrl: "https://images.unsplash.com/photo-1582562124811-c09040d0a901?w=600&auto=format&fit=crop",
    startingPrice: 45.00,
    minIncrement: 5.00,
    currentHighestBid: 65.00,
    currentHighestBidderId: "usr_gold_02",
    currentHighestBidderName: "Elena R.",
    totalBids: 2,
    startTime: new Date(Date.now() - 3600 * 1000 * 12).toISOString(),
    endTime: new Date(Date.now() + 3600 * 1000 * 5).toISOString(), // 5 hours remaining
    status: "active",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: "auc-03",
    stampId: "PE-1860-03",
    title: "Perú 1860 1d Azul Escudo - Cancelación Sobrecargada",
    description: "Variedad de plancha con doble impresión parcial en escudo de armas. Certificado de autenticidad en papel filigranado.",
    imageUrl: "https://images.unsplash.com/photo-1607604276583-eef5d076aa5f?w=600&auto=format&fit=crop",
    startingPrice: 90.00,
    minIncrement: 15.00,
    currentHighestBid: 180.00,
    currentHighestBidderId: "usr_gold_03",
    currentHighestBidderName: "Roberto G.",
    totalBids: 7,
    startTime: new Date(Date.now() - 3600 * 1000 * 48).toISOString(),
    endTime: new Date(Date.now() + 240 * 1000).toISOString(), // 4 minutes remaining (Ending Soon!)
    status: "active",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: "auc-04",
    stampId: "PE-1871-04",
    title: "Perú 1871 TREN Un Peseta Bermellón - Muestra de Ensayo",
    description: "Sello Conmemorativo del Ferrocarril Lima-Callao. Ensayo de color raro sin dentar.",
    imageUrl: "https://images.unsplash.com/photo-1544716278-ca5e3f4abd8c?w=600&auto=format&fit=crop",
    startingPrice: 250.00,
    minIncrement: 20.00,
    currentHighestBid: 320.00,
    currentHighestBidderId: "usr_gold_01",
    currentHighestBidderName: "Carlos M.",
    totalBids: 5,
    startTime: new Date(Date.now() - 3600 * 1000 * 72).toISOString(),
    endTime: new Date(Date.now() - 3600 * 1000 * 2).toISOString(), // Ended
    status: "ended",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }
];

const INITIAL_BIDS: Bid[] = [
  {
    id: "bid-01-1",
    auctionId: "auc-01",
    bidderId: "usr_gold_04",
    bidderName: "Ana V.",
    amount: 130.00,
    status: "outbid",
    createdAt: new Date(Date.now() - 3600 * 1000 * 10).toISOString(),
  },
  {
    id: "bid-01-2",
    auctionId: "auc-01",
    bidderId: "usr_gold_01",
    bidderName: "Carlos M.",
    amount: 150.00,
    status: "accepted",
    createdAt: new Date(Date.now() - 3600 * 1000 * 2).toISOString(),
  },
  {
    id: "bid-03-1",
    auctionId: "auc-03",
    bidderId: "usr_gold_03",
    bidderName: "Roberto G.",
    amount: 180.00,
    status: "accepted",
    createdAt: new Date(Date.now() - 1800 * 1000).toISOString(),
  }
];

// In-memory persistent store for development/testing fallback
let auctionsStore: Auction[] = [...INITIAL_AUCTIONS];
let bidsStore: Bid[] = [...INITIAL_BIDS];

export function resetAuctionsStore() {
  auctionsStore = JSON.parse(JSON.stringify(INITIAL_AUCTIONS));
  bidsStore = JSON.parse(JSON.stringify(INITIAL_BIDS));
}

export async function getAuctions(status?: string, sortBy?: string): Promise<Auction[]> {
  // Auto check for expired auctions to maintain consistency
  const now = new Date().toISOString();
  auctionsStore.forEach(auc => {
    if (auc.status === "active" && auc.endTime <= now) {
      auc.status = "ended";
    }
  });

  let result = [...auctionsStore];

  if (status && status !== "all") {
    result = result.filter(a => a.status === status);
  }

  if (sortBy === "ending_soon") {
    result.sort((a, b) => new Date(a.endTime).getTime() - new Date(b.endTime).getTime());
  } else if (sortBy === "highest_bid") {
    result.sort((a, b) => b.currentHighestBid - a.currentHighestBid);
  } else if (sortBy === "newest") {
    result.sort((a, b) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime());
  }

  return result;
}

export async function getAuctionById(id: string): Promise<AuctionWithDetails | null> {
  const auc = auctionsStore.find(a => a.id === id);
  if (!auc) return null;

  // Auto-expire check
  if (auc.status === "active" && auc.endTime <= new Date().toISOString()) {
    auc.status = "ended";
  }

  const auctionBids = bidsStore
    .filter(b => b.auctionId === id)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  return {
    ...auc,
    bids: auctionBids
  };
}

export async function placeBid(
  auctionId: string,
  bidderId: string,
  bidderName: string,
  amount: number,
  expectedCurrentHighestBid?: number
): Promise<{ success: boolean; bid?: Bid; updatedAuction?: Auction; error?: string; code?: string }> {
  // Round to 2 decimal places to sanitize float precision
  const roundedAmount = Math.round(amount * 100) / 100;

  const auction = auctionsStore.find(a => a.id === auctionId);
  if (!auction) {
    return { success: false, error: "Subasta no encontrada", code: "AUCTION_NOT_FOUND" };
  }

  const nowIso = new Date().toISOString();

  // Check expiration
  if (auction.status !== "active" || auction.endTime <= nowIso) {
    auction.status = "ended";
    return { success: false, error: "La subasta ha finalizado", code: "AUCTION_EXPIRED" };
  }

  // Calculate required minimum bid
  const minRequired = auction.currentHighestBid > 0 
    ? Math.round((auction.currentHighestBid + auction.minIncrement) * 100) / 100
    : Math.round(auction.startingPrice * 100) / 100;

  if (roundedAmount < minRequired) {
    return {
      success: false,
      error: `La oferta mínima permitida es S/. ${minRequired.toFixed(2)}`,
      code: "BID_TOO_LOW"
    };
  }

  // Concurrency Check (Optimistic Concurrency Control)
  if (expectedCurrentHighestBid !== undefined && auction.currentHighestBid !== expectedCurrentHighestBid) {
    return {
      success: false,
      error: "Conflicto de concurrencia: Otro coleccionista realizó una puja superior hace un instante",
      code: "CONCURRENT_BID_CONFLICT"
    };
  }

  // Mark previous highest bids for this auction as outbid
  bidsStore.forEach(b => {
    if (b.auctionId === auctionId && b.status === "accepted") {
      b.status = "outbid";
    }
  });

  // Create new bid record
  const newBid: Bid = {
    id: `bid-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
    auctionId,
    bidderId,
    bidderName,
    amount: roundedAmount,
    status: "accepted",
    createdAt: nowIso,
  };

  bidsStore.push(newBid);

  // Update auction state atomically
  auction.currentHighestBid = roundedAmount;
  auction.currentHighestBidderId = bidderId;
  auction.currentHighestBidderName = bidderName;
  auction.totalBids += 1;
  auction.updatedAt = nowIso;

  return {
    success: true,
    bid: newBid,
    updatedAuction: auction
  };
}

export async function settleExpiredAuctions(settlementKeyHeader?: string): Promise<{ settledCount: number; settledIds: string[] }> {
  const validKey = process.env.SETTLEMENT_KEY || "filatelia_settlement_secret_2026";
  if (settlementKeyHeader && settlementKeyHeader !== validKey) {
    throw new Error("Unauthorized settlement key");
  }

  const nowIso = new Date().toISOString();
  const settledIds: string[] = [];

  auctionsStore.forEach(auc => {
    if (auc.status === "active" && auc.endTime <= nowIso) {
      auc.status = "ended";
      auc.updatedAt = nowIso;
      settledIds.push(auc.id);
    }
  });

  return {
    settledCount: settledIds.length,
    settledIds
  };
}

export async function getUserBids(userId: string): Promise<Bid[]> {
  return bidsStore.filter(b => b.bidderId === userId);
}
