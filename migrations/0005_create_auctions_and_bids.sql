-- Migration 0005: Create auctions and bids

CREATE TABLE IF NOT EXISTS Auction (
  id TEXT PRIMARY KEY,
  stamp_id TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  image_url TEXT,
  starting_price REAL NOT NULL,
  min_increment REAL NOT NULL DEFAULT 5.0,
  current_highest_bid REAL NOT NULL,
  current_highest_bidder_id TEXT,
  current_highest_bidder_name TEXT,
  total_bids INTEGER NOT NULL DEFAULT 0,
  start_time DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  end_time DATETIME NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'ended', 'cancelled')),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS Bid (
  id TEXT PRIMARY KEY,
  auction_id TEXT NOT NULL,
  bidder_id TEXT NOT NULL,
  bidder_name TEXT NOT NULL,
  amount REAL NOT NULL,
  status TEXT NOT NULL DEFAULT 'accepted' CHECK (status IN ('accepted', 'outbid', 'rejected')),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (auction_id) REFERENCES Auction(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_auction_status ON Auction(status);
CREATE INDEX IF NOT EXISTS idx_auction_end_time ON Auction(end_time);
CREATE INDEX IF NOT EXISTS idx_bid_auction_id ON Bid(auction_id);
CREATE INDEX IF NOT EXISTS idx_bid_bidder_id ON Bid(bidder_id);
