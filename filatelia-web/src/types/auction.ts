export type AuctionStatus = 'active' | 'ended' | 'cancelled';
export type BidStatus = 'accepted' | 'outbid' | 'rejected';

export interface Auction {
  id: string;
  stampId: string;
  title: string;
  description?: string;
  imageUrl?: string;
  startingPrice: number;
  minIncrement: number;
  currentHighestBid: number;
  currentHighestBidderId?: string;
  currentHighestBidderName?: string;
  totalBids: number;
  startTime: string;
  endTime: string;
  status: AuctionStatus;
  createdAt?: string;
  updatedAt?: string;
}

export interface Bid {
  id: string;
  auctionId: string;
  bidderId: string;
  bidderName: string;
  amount: number;
  status: BidStatus;
  createdAt: string;
}

export type AuctionWithDetails = Auction & {
  bids?: Bid[];
};

export interface BidApiResponse {
  success: boolean;
  bid?: Bid;
  updatedAuction?: Auction;
  error?: string;
  code?: string;
}

export interface AuctionListResponse {
  success: boolean;
  auctions: Auction[];
  total: number;
}

export interface PlaceBidPayload {
  auctionId: string;
  amount: number;
}
