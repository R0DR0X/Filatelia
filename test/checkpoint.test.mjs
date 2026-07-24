import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import {
  loadCheckpoint,
  saveCheckpoint,
  isCompleted,
  markCompleted,
  markFailed,
} from '../scrapers/lib/checkpoint-manager.mjs';

const TEST_CP_PATH = './scratch/test-checkpoint.json';

test.afterEach(() => {
  try {
    if (fs.existsSync(TEST_CP_PATH)) fs.unlinkSync(TEST_CP_PATH);
    if (fs.existsSync(`${TEST_CP_PATH}.tmp`)) fs.unlinkSync(`${TEST_CP_PATH}.tmp`);
  } catch {}
});

test('checkpoint-manager: initializes fresh state when file does not exist', () => {
  const cp = loadCheckpoint(TEST_CP_PATH);
  assert.equal(cp.offset, 0);
  assert.equal(cp.mirrored, 0);
  assert.equal(cp.errors, 0);
  assert.deepEqual(cp.items, {});
});

test('checkpoint-manager: atomically saves state using .tmp file and reloads cleanly', () => {
  const cp = loadCheckpoint(TEST_CP_PATH);
  markCompleted(cp, 101, { r2ImageUrl: 'https://cdn.filatelia.app/stamps/101.jpg' });
  markFailed(cp, 102, 'HTTP 404 Not Found');

  saveCheckpoint(TEST_CP_PATH, cp);

  // Assert file exists and .tmp file does not remain
  assert.ok(fs.existsSync(TEST_CP_PATH));
  assert.ok(!fs.existsSync(`${TEST_CP_PATH}.tmp`));

  // Reload checkpoint and verify contents
  const reloaded = loadCheckpoint(TEST_CP_PATH);
  assert.equal(isCompleted(reloaded, 101), true);
  assert.equal(isCompleted(reloaded, 102), false);
  assert.equal(reloaded.mirrored, 1);
  assert.equal(reloaded.errors, 1);
  assert.equal(reloaded.items['101'].r2ImageUrl, 'https://cdn.filatelia.app/stamps/101.jpg');
});
