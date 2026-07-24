import test from 'node:test';
import assert from 'node:assert/strict';

function calculateMinRequiredBid(startingPrice, currentHighestBid, minIncrement) {
  if (currentHighestBid > 0) {
    return Math.round((currentHighestBid + minIncrement) * 100) / 100;
  }
  return Math.round(startingPrice * 100) / 100;
}

function sanitizeBidAmount(amount) {
  return Math.round(amount * 100) / 100;
}

test('auction-bid-calc: calculates starting price as min required when no bids exist', () => {
  const minReq = calculateMinRequiredBid(100.00, 0.00, 5.00);
  assert.equal(minReq, 100.00);
});

test('auction-bid-calc: calculates current highest plus increment when bids exist', () => {
  const minReq = calculateMinRequiredBid(100.00, 150.00, 10.00);
  assert.equal(minReq, 160.00);
});

test('auction-bid-calc: float precision rounding handles floating point micro-inaccuracies', () => {
  // 150.05 + 5.01 = 155.06000000000003 in JavaScript floating point
  const unrounded = 150.05 + 5.01;
  const sanitized = sanitizeBidAmount(unrounded);
  assert.equal(sanitized, 155.06);
});

test('auction-bid-calc: validates bid against minimum required', () => {
  const minReq = calculateMinRequiredBid(100.00, 150.00, 5.00); // 155.00
  const bidA = 154.99;
  const bidB = 155.00;

  assert.equal(sanitizeBidAmount(bidA) < minReq, true, 'Bid below min must fail');
  assert.equal(sanitizeBidAmount(bidB) >= minReq, true, 'Bid equal or above min must pass');
});
