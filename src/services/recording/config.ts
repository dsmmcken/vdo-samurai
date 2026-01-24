export function getOptimalMimeType(): string {
  const types = [
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm;codecs=h264,opus',
    'video/webm'
  ];

  for (const type of types) {
    if (MediaRecorder.isTypeSupported(type)) {
      return type;
    }
  }

  throw new Error('No supported video MIME type found');
}

export const RECORDING_OPTIONS = {
  videoBitsPerSecond: 8_000_000, // 8 Mbps HQ
  audioBitsPerSecond: 128_000 // 128 kbps
};

export const CHUNK_INTERVAL = 5000; // Save chunk every 5 seconds
