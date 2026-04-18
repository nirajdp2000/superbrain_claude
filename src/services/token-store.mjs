import fs from "fs";
import path from "path";
import { config } from "../config.mjs";

const BLOB_KEY = "upstox-token";
let memoryRecord = null;
let blobStorePromise = null;

function ensureParentDirectory(filePath) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function normalizeRecord(input) {
  if (!input?.accessToken) {
    return null;
  }

  return {
    accessToken: input.accessToken,
    refreshToken: input.refreshToken || null,
    expiresAt: Number(input.expiresAt || Date.now() + 23 * 60 * 60 * 1000),
    updatedAt: Number(input.updatedAt || Date.now()),
  };
}

function envSeedRecord() {
  if (!config.upstox.accessToken) {
    return null;
  }

  return normalizeRecord({
    accessToken: config.upstox.accessToken,
    refreshToken: config.upstox.refreshToken || null,
    expiresAt: Date.now() + 23 * 60 * 60 * 1000,
  });
}

function shouldUseBlobs() {
  return config.isNetlifyRuntime;
}

async function getBlobStore() {
  if (!shouldUseBlobs()) {
    return null;
  }
  if (!blobStorePromise) {
    blobStorePromise = (async () => {
      try {
        const { getStore } = await import("@netlify/blobs");
        return getStore({ name: config.tokenBlobStore, consistency: "strong" });
      } catch (error) {
        console.warn(`[token-store] Netlify Blobs unavailable: ${error.message}. Falling back to in-memory only.`);
        return null;
      }
    })();
  }
  return blobStorePromise;
}

async function readFromBlobs() {
  const store = await getBlobStore();
  if (!store) return null;
  try {
    const payload = await store.get(BLOB_KEY, { type: "json" });
    return normalizeRecord(payload);
  } catch (error) {
    console.warn(`[token-store] Blob read failed: ${error.message}`);
    return null;
  }
}

async function writeToBlobs(record) {
  const store = await getBlobStore();
  if (!store) return false;
  try {
    await store.setJSON(BLOB_KEY, record);
    return true;
  } catch (error) {
    console.warn(`[token-store] Blob write failed: ${error.message}`);
    return false;
  }
}

function readFromFile() {
  try {
    if (fs.existsSync(config.tokenDbPath)) {
      const raw = fs.readFileSync(config.tokenDbPath, "utf8");
      return normalizeRecord(JSON.parse(raw));
    }
  } catch {
    // ignore
  }
  return null;
}

function writeToFile(record) {
  try {
    ensureParentDirectory(config.tokenDbPath);
    fs.writeFileSync(config.tokenDbPath, JSON.stringify(record, null, 2), "utf8");
    return true;
  } catch {
    return false;
  }
}

/**
 * Read token record.
 *
 * Order of preference:
 *   1. In-memory cache (same lambda warm invocation).
 *   2. Netlify Blobs (serverless durable store).
 *   3. Local file (standalone server).
 *   4. Seed from UPSTOX_ACCESS_TOKEN env var.
 */
export async function readTokenRecord() {
  if (memoryRecord?.accessToken && memoryRecord.expiresAt > Date.now() - 10 * 60 * 1000) {
    return memoryRecord;
  }

  if (shouldUseBlobs()) {
    const fromBlobs = await readFromBlobs();
    if (fromBlobs?.accessToken) {
      memoryRecord = fromBlobs;
      return memoryRecord;
    }
  } else {
    const fromFile = readFromFile();
    if (fromFile?.accessToken) {
      memoryRecord = fromFile;
      return memoryRecord;
    }
  }

  memoryRecord = envSeedRecord();
  return memoryRecord;
}

export async function writeTokenRecord(record) {
  const normalized = normalizeRecord(record);
  if (!normalized) {
    throw new Error("Cannot store empty Upstox token record.");
  }

  memoryRecord = normalized;

  if (shouldUseBlobs()) {
    await writeToBlobs(normalized);
  } else {
    writeToFile(normalized);
  }

  return normalized;
}

export function clearTokenRecordCache() {
  memoryRecord = null;
}
