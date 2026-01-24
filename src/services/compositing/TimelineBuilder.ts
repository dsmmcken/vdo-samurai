import type { EditPoint } from '../../store/recordingStore';
import { COMPOSITE_CONFIG } from './config';

export interface VideoSource {
  id: string;
  name: string;
  blob: Blob;
  type: 'camera' | 'screen';
  duration?: number;
}

export interface TimelineSegment {
  startTime: number;
  endTime: number;
  focusSourceId: string;
  sources: string[]; // All source IDs visible in this segment
}

export interface CompositeJob {
  segments: TimelineSegment[];
  sources: VideoSource[];
  outputFormat: 'webm' | 'mp4';
  layout: 'focus' | 'grid' | 'pip';
}

export class TimelineBuilder {
  private sources: VideoSource[] = [];
  private editPoints: EditPoint[] = [];
  private recordingStartTime: number = 0;
  private recordingEndTime: number = 0;

  setSources(sources: VideoSource[]): this {
    this.sources = sources;
    return this;
  }

  setEditPoints(editPoints: EditPoint[]): this {
    this.editPoints = [...editPoints].sort((a, b) => a.timestamp - b.timestamp);
    return this;
  }

  setRecordingTimeRange(startTime: number, endTime: number): this {
    this.recordingStartTime = startTime;
    this.recordingEndTime = endTime;
    return this;
  }

  buildSegments(): TimelineSegment[] {
    if (this.sources.length === 0) {
      return [];
    }

    const segments: TimelineSegment[] = [];
    const duration = (this.recordingEndTime - this.recordingStartTime) / 1000;

    // Filter to focus change events only
    const focusChanges = this.editPoints.filter((ep) => ep.type === 'focus-change');

    if (focusChanges.length === 0) {
      // No focus changes - single segment with first source as focus
      return [
        {
          startTime: 0,
          endTime: duration,
          focusSourceId: this.sources[0]?.id || '',
          sources: this.sources.map((s) => s.id)
        }
      ];
    }

    // Build segments from focus change events
    let currentTime = 0;
    let currentFocus = this.sources[0]?.id || '';

    for (const editPoint of focusChanges) {
      const eventTime = (editPoint.timestamp - this.recordingStartTime) / 1000;

      if (eventTime > currentTime && eventTime <= duration) {
        segments.push({
          startTime: currentTime,
          endTime: eventTime,
          focusSourceId: currentFocus,
          sources: this.sources.map((s) => s.id)
        });

        currentTime = eventTime;
        currentFocus = editPoint.focusedPeerId || currentFocus;
      }
    }

    // Add final segment
    if (currentTime < duration) {
      segments.push({
        startTime: currentTime,
        endTime: duration,
        focusSourceId: currentFocus,
        sources: this.sources.map((s) => s.id)
      });
    }

    return segments;
  }

  buildFilterComplex(
    segments: TimelineSegment[],
    layout: 'focus' | 'grid' | 'pip' = 'focus'
  ): string {
    if (segments.length === 0 || this.sources.length === 0) {
      return '';
    }

    // For simplicity with FFmpeg.wasm memory constraints,
    // we'll use a focus layout: main video + small thumbnails
    const sourceCount = this.sources.length;

    if (sourceCount === 1) {
      // Single source - no complex filtering needed
      return '[0:v]copy[vout];[0:a]acopy[aout]';
    }

    let filter = '';
    const mainWidth = 1920;
    const mainHeight = 1080;
    const thumbWidth = 320;
    const thumbHeight = 180;
    const thumbPadding = COMPOSITE_CONFIG.GRID_PADDING;

    switch (layout) {
      case 'grid': {
        // Grid layout - all sources equal size
        const gridSize = Math.ceil(Math.sqrt(sourceCount));
        const cellWidth = Math.floor(mainWidth / gridSize);
        const cellHeight = Math.floor(mainHeight / gridSize);

        // Scale each input
        for (let i = 0; i < sourceCount; i++) {
          filter += `[${i}:v]scale=${cellWidth}:${cellHeight}:force_original_aspect_ratio=decrease,`;
          filter += `pad=${cellWidth}:${cellHeight}:(ow-iw)/2:(oh-ih)/2:color=${COMPOSITE_CONFIG.GRID_BACKGROUND}[v${i}];`;
        }

        // Build grid
        if (sourceCount === 2) {
          filter += `[v0][v1]hstack=inputs=2[vout]`;
        } else if (sourceCount <= 4) {
          filter += `[v0][v1]hstack=inputs=2[row0];`;
          filter += `[v2]`;
          filter +=
            sourceCount > 3
              ? `[v3]hstack=inputs=2[row1]`
              : `pad=${cellWidth * 2}:${cellHeight}[row1]`;
          filter += `;[row0][row1]vstack=inputs=2[vout]`;
        } else {
          // 3x3 for up to 9
          for (let row = 0; row < 3; row++) {
            const rowInputs = [];
            for (let col = 0; col < 3; col++) {
              const idx = row * 3 + col;
              if (idx < sourceCount) {
                rowInputs.push(`[v${idx}]`);
              }
            }
            if (rowInputs.length > 0) {
              filter += `${rowInputs.join('')}hstack=inputs=${rowInputs.length}[row${row}];`;
            }
          }
          filter += `[row0][row1]`;
          filter += sourceCount > 6 ? `[row2]vstack=inputs=3[vout]` : `vstack=inputs=2[vout]`;
        }
        break;
      }

      case 'pip': {
        // Picture-in-picture - main video with small overlay
        const pipWidth = 320;
        const pipHeight = 180;
        const pipX = mainWidth - pipWidth - thumbPadding;
        const pipY = mainHeight - pipHeight - thumbPadding;

        filter += `[0:v]scale=${mainWidth}:${mainHeight}:force_original_aspect_ratio=decrease,`;
        filter += `pad=${mainWidth}:${mainHeight}:(ow-iw)/2:(oh-ih)/2:color=${COMPOSITE_CONFIG.GRID_BACKGROUND}[main];`;
        filter += `[1:v]scale=${pipWidth}:${pipHeight}[pip];`;
        filter += `[main][pip]overlay=${pipX}:${pipY}[vout]`;
        break;
      }

      case 'focus':
      default: {
        // Focus layout - large main video, thumbnails on the side
        const mainVideoWidth = mainWidth - thumbWidth - thumbPadding * 2;
        const thumbCount = sourceCount - 1;
        const maxThumbs = Math.floor(mainHeight / (thumbHeight + thumbPadding));

        // Scale main (focus) video - we'll use source 0 as focus for now
        filter += `[0:v]scale=${mainVideoWidth}:${mainHeight}:force_original_aspect_ratio=decrease,`;
        filter += `pad=${mainVideoWidth}:${mainHeight}:(ow-iw)/2:(oh-ih)/2:color=${COMPOSITE_CONFIG.GRID_BACKGROUND}[main];`;

        // Scale thumbnails
        for (let i = 1; i < sourceCount && i <= maxThumbs; i++) {
          filter += `[${i}:v]scale=${thumbWidth}:${thumbHeight}[thumb${i}];`;
        }

        // Create thumbnail column
        if (thumbCount > 0) {
          // Stack thumbnails vertically
          let thumbStack = '[thumb1]';
          for (let i = 2; i < sourceCount && i <= maxThumbs; i++) {
            thumbStack += `[thumb${i}]`;
          }
          const stackCount = Math.min(thumbCount, maxThumbs);
          if (stackCount > 1) {
            filter += `${thumbStack}vstack=inputs=${stackCount}[thumbcol];`;
          } else {
            filter += `[thumb1]pad=${thumbWidth}:${mainHeight}:0:0:color=${COMPOSITE_CONFIG.GRID_BACKGROUND}[thumbcol];`;
          }

          // Combine main and thumbnails
          filter += `[main][thumbcol]hstack=inputs=2[vout]`;
        } else {
          filter += `[main]copy[vout]`;
        }
        break;
      }
    }

    // Mix audio from all sources
    const audioInputs = Array.from({ length: sourceCount }, (_, i) => `[${i}:a]`).join('');
    filter += `;${audioInputs}amix=inputs=${sourceCount}:duration=longest[aout]`;

    return filter;
  }

  buildJob(
    outputFormat: 'webm' | 'mp4' = 'webm',
    layout: 'focus' | 'grid' | 'pip' = 'focus'
  ): CompositeJob {
    const segments = this.buildSegments();

    return {
      segments,
      sources: this.sources,
      outputFormat,
      layout
    };
  }

  // Split long recordings into chunks for processing
  chunkSegments(maxDuration: number = COMPOSITE_CONFIG.SEGMENT_DURATION): TimelineSegment[][] {
    const segments = this.buildSegments();
    const chunks: TimelineSegment[][] = [];
    let currentChunk: TimelineSegment[] = [];
    let chunkStartTime = 0;

    for (const segment of segments) {
      const segmentDuration = segment.endTime - segment.startTime;

      if (
        segment.startTime - chunkStartTime + segmentDuration > maxDuration &&
        currentChunk.length > 0
      ) {
        // Start new chunk
        chunks.push(currentChunk);
        currentChunk = [];
        chunkStartTime = segment.startTime;
      }

      currentChunk.push({
        ...segment,
        startTime: segment.startTime - chunkStartTime,
        endTime: segment.endTime - chunkStartTime
      });
    }

    if (currentChunk.length > 0) {
      chunks.push(currentChunk);
    }

    return chunks;
  }
}

export const timelineBuilder = new TimelineBuilder();
