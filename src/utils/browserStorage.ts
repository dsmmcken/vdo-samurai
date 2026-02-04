/**
 * Browser-based storage using IndexedDB for persistent recording storage
 * Supports storing recording chunks, finalized blobs, and pending transfers
 */

const DB_NAME = 'vdo-samurai-browser';
const DB_VERSION = 1;

// Store names
const CHUNKS_STORE = 'recording-chunks';
const PENDING_TRANSFERS_STORE = 'pending-transfers';

export interface PendingTransfer {
  id: string;
  blob: Blob;
  filename: string;
  type: 'camera' | 'screen';
  sessionCode: string;
  userName: string;
  createdAt: number;
  status: 'pending' | 'transferring' | 'completed';
}

let dbPromise: Promise<IDBDatabase> | null = null;

function openDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => {
      console.error('[BrowserStorage] Failed to open database:', request.error);
      reject(request.error);
    };

    request.onsuccess = () => {
      resolve(request.result);
    };

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;

      // Store for recording chunks (keyed by recordingId:index)
      if (!db.objectStoreNames.contains(CHUNKS_STORE)) {
        db.createObjectStore(CHUNKS_STORE);
      }

      // Store for pending transfers (keyed by id)
      if (!db.objectStoreNames.contains(PENDING_TRANSFERS_STORE)) {
        const store = db.createObjectStore(PENDING_TRANSFERS_STORE, { keyPath: 'id' });
        store.createIndex('status', 'status', { unique: false });
        store.createIndex('sessionCode', 'sessionCode', { unique: false });
      }
    };
  });

  return dbPromise;
}

// ============ Recording Chunks ============

export async function saveChunk(recordingId: string, chunk: Blob, index: number): Promise<void> {
  const db = await openDB();
  const key = `${recordingId}:${String(index).padStart(6, '0')}`;

  return new Promise((resolve, reject) => {
    const tx = db.transaction(CHUNKS_STORE, 'readwrite');
    const store = tx.objectStore(CHUNKS_STORE);
    const request = store.put(chunk, key);

    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve();
  });
}

export async function getChunks(recordingId: string): Promise<Blob[]> {
  const db = await openDB();

  return new Promise((resolve, reject) => {
    const tx = db.transaction(CHUNKS_STORE, 'readonly');
    const store = tx.objectStore(CHUNKS_STORE);
    const request = store.openCursor(IDBKeyRange.bound(`${recordingId}:`, `${recordingId}:\uffff`));

    const chunks: { key: string; blob: Blob }[] = [];

    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const cursor = request.result;
      if (cursor) {
        chunks.push({ key: cursor.key as string, blob: cursor.value as Blob });
        cursor.continue();
      } else {
        // Sort by key and return just the blobs
        chunks.sort((a, b) => a.key.localeCompare(b.key));
        resolve(chunks.map((c) => c.blob));
      }
    };
  });
}

export async function finalizeRecording(recordingId: string): Promise<Blob> {
  const chunks = await getChunks(recordingId);
  if (chunks.length === 0) {
    throw new Error('No recording chunks found');
  }

  const mimeType = chunks[0].type || 'video/webm';
  return new Blob(chunks, { type: mimeType });
}

export async function deleteChunks(recordingId: string): Promise<void> {
  const db = await openDB();

  return new Promise((resolve, reject) => {
    const tx = db.transaction(CHUNKS_STORE, 'readwrite');
    const store = tx.objectStore(CHUNKS_STORE);
    const request = store.openCursor(IDBKeyRange.bound(`${recordingId}:`, `${recordingId}:\uffff`));

    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const cursor = request.result;
      if (cursor) {
        cursor.delete();
        cursor.continue();
      } else {
        resolve();
      }
    };
  });
}

// ============ Pending Transfers ============

export async function savePendingTransfer(transfer: PendingTransfer): Promise<void> {
  const db = await openDB();

  return new Promise((resolve, reject) => {
    const tx = db.transaction(PENDING_TRANSFERS_STORE, 'readwrite');
    const store = tx.objectStore(PENDING_TRANSFERS_STORE);
    const request = store.put(transfer);

    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve();
  });
}

export async function getPendingTransfers(): Promise<PendingTransfer[]> {
  const db = await openDB();

  return new Promise((resolve, reject) => {
    const tx = db.transaction(PENDING_TRANSFERS_STORE, 'readonly');
    const store = tx.objectStore(PENDING_TRANSFERS_STORE);
    const index = store.index('status');
    const request = index.getAll(IDBKeyRange.only('pending'));

    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result || []);
  });
}

export async function getPendingTransfer(id: string): Promise<PendingTransfer | null> {
  const db = await openDB();

  return new Promise((resolve, reject) => {
    const tx = db.transaction(PENDING_TRANSFERS_STORE, 'readonly');
    const store = tx.objectStore(PENDING_TRANSFERS_STORE);
    const request = store.get(id);

    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result || null);
  });
}

export async function updateTransferStatus(
  id: string,
  status: PendingTransfer['status']
): Promise<void> {
  const db = await openDB();

  return new Promise((resolve, reject) => {
    const tx = db.transaction(PENDING_TRANSFERS_STORE, 'readwrite');
    const store = tx.objectStore(PENDING_TRANSFERS_STORE);
    const getRequest = store.get(id);

    getRequest.onerror = () => reject(getRequest.error);
    getRequest.onsuccess = () => {
      const transfer = getRequest.result;
      if (!transfer) {
        reject(new Error(`Transfer ${id} not found`));
        return;
      }

      transfer.status = status;
      const putRequest = store.put(transfer);
      putRequest.onerror = () => reject(putRequest.error);
      putRequest.onsuccess = () => resolve();
    };
  });
}

export async function deletePendingTransfer(id: string): Promise<void> {
  const db = await openDB();

  return new Promise((resolve, reject) => {
    const tx = db.transaction(PENDING_TRANSFERS_STORE, 'readwrite');
    const store = tx.objectStore(PENDING_TRANSFERS_STORE);
    const request = store.delete(id);

    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve();
  });
}

export async function clearCompletedTransfers(): Promise<void> {
  const db = await openDB();

  return new Promise((resolve, reject) => {
    const tx = db.transaction(PENDING_TRANSFERS_STORE, 'readwrite');
    const store = tx.objectStore(PENDING_TRANSFERS_STORE);
    const index = store.index('status');
    const request = index.openCursor(IDBKeyRange.only('completed'));

    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const cursor = request.result;
      if (cursor) {
        cursor.delete();
        cursor.continue();
      } else {
        resolve();
      }
    };
  });
}

// ============ Utility ============

export async function getStorageEstimate(): Promise<{ used: number; quota: number } | null> {
  if (navigator.storage && navigator.storage.estimate) {
    const estimate = await navigator.storage.estimate();
    return {
      used: estimate.usage || 0,
      quota: estimate.quota || 0
    };
  }
  return null;
}

export async function clearAllData(): Promise<void> {
  const db = await openDB();

  return new Promise((resolve, reject) => {
    const tx = db.transaction([CHUNKS_STORE, PENDING_TRANSFERS_STORE], 'readwrite');

    tx.onerror = () => reject(tx.error);
    tx.oncomplete = () => resolve();

    tx.objectStore(CHUNKS_STORE).clear();
    tx.objectStore(PENDING_TRANSFERS_STORE).clear();
  });
}
