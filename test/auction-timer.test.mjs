import test from 'node:test';
import assert from 'node:assert/strict';

function formatTimeRemaining(endTimeStr) {
  const target = new Date(endTimeStr).getTime();
  const now = Date.now();
  const totalMs = target - now;

  if (isNaN(target) || totalMs <= 0) {
    return {
      days: 0,
      hours: 0,
      minutes: 0,
      seconds: 0,
      totalMs: 0,
      formatted: "00h 00m 00s",
      isEndingSoon: false,
      isExpired: true,
    };
  }

  const seconds = Math.floor((totalMs / 1000) % 60);
  const minutes = Math.floor((totalMs / (1000 * 60)) % 60);
  const hours = Math.floor((totalMs / (1000 * 60 * 60)) % 24);
  const days = Math.floor(totalMs / (1000 * 60 * 60 * 24));

  const pad = (num) => String(num).padStart(2, "0");
  const isEndingSoon = totalMs <= 5 * 60 * 1000;

  let formatted = "";
  if (days > 0) {
    formatted = `${days}d ${pad(hours)}h ${pad(minutes)}m`;
  } else {
    formatted = `${pad(hours)}h ${pad(minutes)}m ${pad(seconds)}s`;
  }

  return {
    days,
    hours,
    minutes,
    seconds,
    totalMs,
    formatted,
    isEndingSoon,
    isExpired: false,
  };
}

test('auction-timer: formatTimeRemaining detects expired times correctly', () => {
  const pastTime = new Date(Date.now() - 1000).toISOString();
  const result = formatTimeRemaining(pastTime);

  assert.equal(result.isExpired, true);
  assert.equal(result.formatted, '00h 00m 00s');
  assert.equal(result.totalMs, 0);
});

test('auction-timer: formatTimeRemaining flags ending soon when under 5 minutes', () => {
  const endingSoonTime = new Date(Date.now() + 4 * 60 * 1000).toISOString(); // 4 mins
  const result = formatTimeRemaining(endingSoonTime);

  assert.equal(result.isExpired, false);
  assert.equal(result.isEndingSoon, true);
  assert.ok(result.minutes <= 4 && result.minutes >= 3);
});

test('auction-timer: formatTimeRemaining formats days correctly for distant deadlines', () => {
  const futureTime = new Date(Date.now() + 50 * 3600 * 1000).toISOString(); // 50 hours = 2 days 2 hours
  const result = formatTimeRemaining(futureTime);

  assert.equal(result.isExpired, false);
  assert.equal(result.isEndingSoon, false);
  assert.equal(result.days, 2);
  assert.ok(result.formatted.includes('2d'));
});
