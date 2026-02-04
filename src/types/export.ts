/**
 * Types for timeline-aware video export
 */

export type ExportLayout = 'screen-pip' | 'camera-only' | 'screen-only' | 'speeddial';

export interface ExportSourceRef {
  sourceIndex: number; // Index in the input files array
  trimStartMs: number; // Trim from beginning (ms)
  trimEndMs: number; // Trim from end (ms)
}

export interface ExportSegment {
  id: string;
  startTimeMs: number; // Start time in output timeline (ms)
  endTimeMs: number; // End time in output timeline (ms)
  peerId: string | null; // null = local user
  peerName: string;
  layout: ExportLayout;
  camera?: ExportSourceRef;
  screen?: ExportSourceRef;
  speeddial?: ExportSourceRef; // Speed dial source reference
}

export interface ExportSource {
  id: string;
  peerId: string | null;
  peerName: string;
  sourceType: 'camera' | 'screen' | 'speeddial';
  blob?: Blob; // Optional for speeddial (already a file)
  filePath?: string; // Set after saving to temp file, or directly for speeddial
}

export interface ExportPlan {
  segments: ExportSegment[];
  sources: ExportSource[];
  totalDurationMs: number;
}

export interface TimelineExportOptions {
  inputFiles: string[];
  outputPath: string;
  format: 'mp4' | 'webm';
  segments: ExportSegment[];
  sourceCount: number;
  transitionDurationMs: number;
}

export interface TimelineExportResult {
  success: boolean;
  path?: string;
  error?: string;
}

// Constants for timeline export
export const TIMELINE_EXPORT_CONFIG = {
  OUTPUT_WIDTH: 1920,
  OUTPUT_HEIGHT: 1080,
  PIP_SCALE: 0.15, // 15% of output size
  PIP_PADDING: 20, // pixels from edge
  PIP_CORNER_RADIUS: 10, // pixels
  TRANSITION_DURATION_MS: 300, // 0.3 seconds
  BACKGROUND_COLOR: '#000000'
} as const;
