/**
 * CHECKPOINT MANAGER — Atomic Resumable State Persistence
 * =======================================================
 * Manages pipeline state in scrapers/checkpoints/r2-pipeline.json.
 * Uses atomic write pattern (.tmp file + fs.renameSync) to ensure crash durability.
 */

import fs from 'fs';
import path from 'path';

const DEFAULT_CHECKPOINT_PATH = './scrapers/checkpoints/r2-pipeline.json';

/**
 * Creates default checkpoint data structure.
 * @returns {object}
 */
export function createInitialState() {
  return {
    offset: 0,
    mirrored: 0,
    skipped: 0,
    errors: 0,
    lastUpdated: new Date().toISOString(),
    items: {},
  };
}

/**
 * Loads checkpoint file or returns fresh state if non-existent/corrupted.
 * @param {string} [filePath=DEFAULT_CHECKPOINT_PATH]
 * @returns {object}
 */
export function loadCheckpoint(filePath = DEFAULT_CHECKPOINT_PATH) {
  try {
    const dir = path.dirname(filePath);
    fs.mkdirSync(dir, { recursive: true });

    if (fs.existsSync(filePath)) {
      const content = fs.readFileSync(filePath, 'utf-8');
      const data = JSON.parse(content);
      if (!data.items) data.items = {};
      return data;
    }
  } catch (err) {
    console.warn(`[Checkpoint] Could not load ${filePath}, using initial state: ${err.message}`);
  }
  return createInitialState();
}

/**
 * Atomically saves checkpoint file using .tmp file and fs.renameSync.
 * @param {string} filePath 
 * @param {object} state 
 */
export function saveCheckpoint(filePath = DEFAULT_CHECKPOINT_PATH, state) {
  const targetPath = filePath || DEFAULT_CHECKPOINT_PATH;
  const dir = path.dirname(targetPath);
  fs.mkdirSync(dir, { recursive: true });

  const tmpPath = `${targetPath}.tmp`;
  state.lastUpdated = new Date().toISOString();

  const jsonContent = JSON.stringify(state, null, 2);
  fs.writeFileSync(tmpPath, jsonContent, 'utf-8');
  fs.renameSync(tmpPath, targetPath);
}

/**
 * Checks if a stamp ID has already been successfully mirrored/processed.
 * @param {object} state 
 * @param {string|number} stampId 
 * @returns {boolean}
 */
export function isCompleted(state, stampId) {
  if (!state || !state.items) return false;
  const item = state.items[String(stampId)];
  return item && item.status === 'completed';
}

/**
 * Marks an item as completed in the checkpoint state.
 * @param {object} state 
 * @param {string|number} stampId 
 * @param {object} [metadata={}] 
 */
export function markCompleted(state, stampId, metadata = {}) {
  if (!state.items) state.items = {};
  const idStr = String(stampId);
  if (!state.items[idStr] || state.items[idStr].status !== 'completed') {
    state.mirrored = (state.mirrored || 0) + 1;
  }
  state.items[idStr] = {
    status: 'completed',
    timestamp: new Date().toISOString(),
    ...metadata,
  };
}

/**
 * Marks an item as failed or corrupt buffer in the checkpoint state.
 * @param {object} state 
 * @param {string|number} stampId 
 * @param {string} [error='Unknown error'] 
 * @param {'failed'|'corrupt_buffer'} [status='failed'] 
 */
export function markFailed(state, stampId, error = 'Unknown error', status = 'failed') {
  if (!state.items) state.items = {};
  const idStr = String(stampId);
  state.errors = (state.errors || 0) + 1;
  state.items[idStr] = {
    status,
    error,
    timestamp: new Date().toISOString(),
  };
}
