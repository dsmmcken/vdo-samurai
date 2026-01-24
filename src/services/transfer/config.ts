export const TRANSFER_CONFIG = {
  CHUNK_SIZE: 64 * 1024, // 64KB chunks
  HIGH_WATERMARK: 1024 * 1024, // 1MB buffer limit - pause sending
  LOW_WATERMARK: 256 * 1024, // 256KB - resume sending
  MAX_PARALLEL_TRANSFERS: 3,
  ACK_TIMEOUT: 30000, // 30s timeout for ACK
  DRAIN_CHECK_INTERVAL: 50 // Check buffer every 50ms
};
