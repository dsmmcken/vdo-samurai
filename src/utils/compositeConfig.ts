export const COMPOSITE_CONFIG = {
  // Output settings
  OUTPUT_VIDEO_BITRATE: '6M',
  OUTPUT_AUDIO_BITRATE: '128k',
  OUTPUT_FRAMERATE: 30,

  // Chunked processing (for long recordings)
  SEGMENT_DURATION: 600, // 10 minutes in seconds

  // Layout settings for multi-participant composite
  GRID_PADDING: 10,
  GRID_BACKGROUND: '#1a1a2e',

  // Output formats
  OUTPUT_FORMATS: {
    webm: {
      extension: 'webm',
      videoCodec: 'libvpx-vp9',
      audioCodec: 'libopus',
      mimeType: 'video/webm'
    },
    mp4: {
      extension: 'mp4',
      videoCodec: 'libx264',
      audioCodec: 'aac',
      mimeType: 'video/mp4'
    }
  } as const
};

export type OutputFormat = keyof typeof COMPOSITE_CONFIG.OUTPUT_FORMATS;
