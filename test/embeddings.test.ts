import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import {
  computeExponentialBackoff,
  sliceBatch,
  loadCheckpoint,
  saveCheckpoint,
  generateWorkerAiEmbedding,
  processStampsBatch,
} from '../generate-embeddings.mjs';

const TEST_CHECKPOINT_FILE = path.join(process.cwd(), '.test_embedding_checkpoint.json');

describe('Task 4.1: Embedding Generation Unit Tests', () => {
  afterEach(() => {
    if (fs.existsSync(TEST_CHECKPOINT_FILE)) {
      fs.unlinkSync(TEST_CHECKPOINT_FILE);
    }
  });

  it('computes correct exponential backoff delays', () => {
    expect(computeExponentialBackoff(0, 1000)).toBe(1000);
    expect(computeExponentialBackoff(1, 1000)).toBe(2000);
    expect(computeExponentialBackoff(2, 1000)).toBe(4000);
    expect(computeExponentialBackoff(3, 1000)).toBe(8000);
    expect(computeExponentialBackoff(4, 1000)).toBe(16000);
  });

  it('slices array into batches of 1,000 items', () => {
    const items = Array.from({ length: 2500 }, (_, i) => i);
    const batches = sliceBatch(items, 1000);
    expect(batches.length).toBe(3);
    expect(batches[0].length).toBe(1000);
    expect(batches[1].length).toBe(1000);
    expect(batches[2].length).toBe(500);
  });

  it('serializes and restores checkpoint state correctly', () => {
    const state = {
      lastProcessedOffset: 2000,
      totalProcessedCount: 1980,
      failedStampIds: ['stamp_12', 'stamp_45'],
    };

    saveCheckpoint(TEST_CHECKPOINT_FILE, state);

    expect(fs.existsSync(TEST_CHECKPOINT_FILE)).toBe(true);

    const loaded = loadCheckpoint(TEST_CHECKPOINT_FILE);
    expect(loaded.lastProcessedOffset).toBe(2000);
    expect(loaded.totalProcessedCount).toBe(1980);
    expect(loaded.failedStampIds).toEqual(['stamp_12', 'stamp_45']);
    expect(loaded.updatedAt).toBeDefined();
  });

  it('generates 1536-dimensional mock embedding in test mode', async () => {
    const embedding = await generateWorkerAiEmbedding('Sello Postal Peruano 1857', { testMode: true });
    expect(Array.isArray(embedding)).toBe(true);
    expect(embedding.length).toBe(1536);
    expect(typeof embedding[0]).toBe('number');
  });

  it('processes batch of stamp records successfully', async () => {
    const sampleStamps = [
      { id: 'stamp_1', nameEs: 'Sello Peru 1857 1d', year: 1857 },
      { id: 'stamp_2', nameEs: 'Estampilla Arequipa 1881', year: 1881 },
    ];
    const { results, failedIds } = await processStampsBatch(sampleStamps, { testMode: true });
    expect(results.length).toBe(2);
    expect(failedIds.length).toBe(0);
    expect(results[0].embedding.length).toBe(1536);
  });
});
