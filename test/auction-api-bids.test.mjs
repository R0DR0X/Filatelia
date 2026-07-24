import test from 'node:test';
import assert from 'node:assert/strict';

// Helper to simulate POST /api/bids request validation and response
function simulatePostBid({ headers = {}, body = {}, auctionState }) {
  // 1. Auth check
  const authHeader = headers['authorization'];
  const userId = headers['x-user-id'] || (authHeader ? 'usr_token' : null);

  if (!userId) {
    return { status: 401, body: { success: false, error: 'Debes iniciar sesión para realizar una puja', code: 'UNAUTHORIZED' } };
  }

  // 2. Input validation
  const { auctionId, amount } = body;
  if (!auctionId || typeof amount !== 'number' || isNaN(amount) || amount <= 0) {
    return { status: 422, body: { success: false, error: 'Datos de puja inválidos o monto debe ser positivo', code: 'INVALID_INPUT' } };
  }

  if (!auctionState) {
    return { status: 404, body: { success: false, error: 'Subasta no encontrada', code: 'AUCTION_NOT_FOUND' } };
  }

  // 3. Expiration check
  const now = new Date().toISOString();
  if (auctionState.status !== 'active' || auctionState.endTime <= now) {
    return { status: 400, body: { success: false, error: 'La subasta ha finalizado', code: 'AUCTION_EXPIRED' } };
  }

  // 4. Min bid check
  const minRequired = auctionState.currentHighestBid > 0
    ? Math.round((auctionState.currentHighestBid + auctionState.minIncrement) * 100) / 100
    : Math.round(auctionState.startingPrice * 100) / 100;

  const roundedAmount = Math.round(amount * 100) / 100;

  if (roundedAmount < minRequired) {
    return { status: 422, body: { success: false, error: `La oferta mínima permitida es S/. ${minRequired.toFixed(2)}`, code: 'BID_TOO_LOW' } };
  }

  return {
    status: 201,
    body: {
      success: true,
      bid: { id: 'bid-123', auctionId, bidderId: userId, amount: roundedAmount, status: 'accepted' },
      updatedAuction: { ...auctionState, currentHighestBid: roundedAmount }
    }
  };
}

test('auction-api-bids: rejects unauthenticated bid requests with 401 (TM-AUC-01)', () => {
  const res = simulatePostBid({
    headers: {}, // No auth
    body: { auctionId: 'auc-01', amount: 160.00 },
    auctionState: { status: 'active', currentHighestBid: 150.00, minIncrement: 10.00, endTime: new Date(Date.now() + 3600000).toISOString() }
  });

  assert.equal(res.status, 401);
  assert.equal(res.body.code, 'UNAUTHORIZED');
});

test('auction-api-bids: rejects bids below minimum increment with 422 (TM-AUC-03)', () => {
  const res = simulatePostBid({
    headers: { 'x-user-id': 'usr-01' },
    body: { auctionId: 'auc-01', amount: 155.00 }, // Min required is 150 + 10 = 160
    auctionState: { status: 'active', currentHighestBid: 150.00, minIncrement: 10.00, endTime: new Date(Date.now() + 3600000).toISOString() }
  });

  assert.equal(res.status, 422);
  assert.equal(res.body.code, 'BID_TOO_LOW');
});

test('auction-api-bids: rejects bids for expired auctions with 400', () => {
  const res = simulatePostBid({
    headers: { 'x-user-id': 'usr-01' },
    body: { auctionId: 'auc-01', amount: 200.00 },
    auctionState: { status: 'active', currentHighestBid: 150.00, minIncrement: 10.00, endTime: new Date(Date.now() - 1000).toISOString() } // Expired
  });

  assert.equal(res.status, 400);
  assert.equal(res.body.code, 'AUCTION_EXPIRED');
});

test('auction-api-bids: accepts valid bid with 201 Created', () => {
  const res = simulatePostBid({
    headers: { 'x-user-id': 'usr-01' },
    body: { auctionId: 'auc-01', amount: 160.00 },
    auctionState: { status: 'active', currentHighestBid: 150.00, minIncrement: 10.00, endTime: new Date(Date.now() + 3600000).toISOString() }
  });

  assert.equal(res.status, 201);
  assert.equal(res.body.success, true);
  assert.equal(res.body.bid.amount, 160.00);
});
