# Phase 5: Video Compositing

## Tasks
- [ ] FFmpeg.wasm integration
- [ ] TimelineBuilder for filter_complex commands
- [ ] CompositeEditor UI (timeline preview)
- [ ] CompositeProgress with percentage
- [ ] Final video download (WebM or MP4)

## coi-serviceworker Setup

For GitHub Pages deployment, FFmpeg.wasm requires SharedArrayBuffer which needs special headers.

```javascript
// public/coi-serviceworker.js
// Download from: https://github.com/nicoleahmed/coi-serviceworker
// This service worker intercepts requests and adds COOP/COEP headers
```

```html
<!-- index.html -->
<script>
  // Register service worker for SharedArrayBuffer support
  if ('serviceWorker' in navigator && !window.crossOriginIsolated) {
    navigator.serviceWorker.register('/coi-serviceworker.js');
  }
</script>
```

## FFmpeg Service

```typescript
// src/services/compositing/FFmpegService.ts
import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile, toBlobURL } from '@ffmpeg/util';

export class FFmpegService {
  private ffmpeg: FFmpeg | null = null;
  private loaded = false;
  private onProgress: ((progress: number) => void) | null = null;

  async load(): Promise<void> {
    if (this.loaded) return;

    this.ffmpeg = new FFmpeg();

    this.ffmpeg.on('progress', ({ progress }) => {
      this.onProgress?.(progress);
    });

    // Load FFmpeg core from CDN
    const baseURL = 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/esm';

    await this.ffmpeg.load({
      coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, 'text/javascript'),
      wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, 'application/wasm')
    });

    this.loaded = true;
  }

  async writeFile(name: string, data: Blob | Uint8Array): Promise<void> {
    if (!this.ffmpeg) throw new Error('FFmpeg not loaded');

    if (data instanceof Blob) {
      const buffer = await data.arrayBuffer();
      await this.ffmpeg.writeFile(name, new Uint8Array(buffer));
    } else {
      await this.ffmpeg.writeFile(name, data);
    }
  }

  async readFile(name: string): Promise<Uint8Array> {
    if (!this.ffmpeg) throw new Error('FFmpeg not loaded');
    return await this.ffmpeg.readFile(name) as Uint8Array;
  }

  async deleteFile(name: string): Promise<void> {
    if (!this.ffmpeg) throw new Error('FFmpeg not loaded');
    await this.ffmpeg.deleteFile(name);
  }

  async exec(args: string[]): Promise<void> {
    if (!this.ffmpeg) throw new Error('FFmpeg not loaded');
    await this.ffmpeg.exec(args);
  }

  setProgressCallback(callback: (progress: number) => void): void {
    this.onProgress = callback;
  }

  isLoaded(): boolean {
    return this.loaded;
  }
}
```

## Timeline Builder

```typescript
// src/services/compositing/TimelineBuilder.ts
export interface EditPoint {
  timestamp: number;       // ms from recording start
  focusedPeerId: string | null;
  type: 'focus-change' | 'marker';
}

export interface VideoSource {
  peerId: string;
  filename: string;
  duration: number;
}

export interface TimelineSegment {
  startTime: number;
  endTime: number;
  mainSource: string;      // filename of main video
  pipSources: string[];    // filenames for picture-in-picture
}

export class TimelineBuilder {
  private editPoints: EditPoint[] = [];
  private sources: VideoSource[] = [];

  setEditPoints(points: EditPoint[]): void {
    this.editPoints = [...points].sort((a, b) => a.timestamp - b.timestamp);
  }

  setSources(sources: VideoSource[]): void {
    this.sources = sources;
  }

  buildSegments(): TimelineSegment[] {
    const segments: TimelineSegment[] = [];
    const totalDuration = Math.max(...this.sources.map(s => s.duration));

    // Add implicit start point if not present
    const points = [{ timestamp: 0, focusedPeerId: null, type: 'focus-change' as const }, ...this.editPoints];

    for (let i = 0; i < points.length; i++) {
      const current = points[i];
      const next = points[i + 1];
      const endTime = next?.timestamp ?? totalDuration;

      const mainSource = this.getSourceForPeer(current.focusedPeerId);
      const pipSources = this.sources
        .filter(s => s.filename !== mainSource)
        .map(s => s.filename);

      segments.push({
        startTime: current.timestamp,
        endTime,
        mainSource,
        pipSources
      });
    }

    return segments;
  }

  private getSourceForPeer(peerId: string | null): string {
    if (peerId === null) {
      // Return host's video (first source by convention)
      return this.sources[0]?.filename ?? '';
    }

    const source = this.sources.find(s => s.peerId === peerId);
    return source?.filename ?? this.sources[0]?.filename ?? '';
  }

  // Generate FFmpeg filter_complex for a segment
  generateFilterComplex(segment: TimelineSegment, outputWidth = 1920, outputHeight = 1080): string {
    const pipWidth = Math.floor(outputWidth * 0.2);
    const pipHeight = Math.floor(outputHeight * 0.2);
    const pipPadding = 20;

    let filter = '';
    let inputIndex = 0;

    // Scale main video
    filter += `[${inputIndex}:v]scale=${outputWidth}:${outputHeight}:force_original_aspect_ratio=decrease,`;
    filter += `pad=${outputWidth}:${outputHeight}:(ow-iw)/2:(oh-ih)/2[main];`;
    inputIndex++;

    // Create PIP overlays
    let currentOverlay = 'main';

    for (let i = 0; i < segment.pipSources.length; i++) {
      const pipX = pipPadding + (pipWidth + pipPadding) * i;
      const pipY = outputHeight - pipHeight - pipPadding;

      filter += `[${inputIndex}:v]scale=${pipWidth}:${pipHeight}[pip${i}];`;
      filter += `[${currentOverlay}][pip${i}]overlay=${pipX}:${pipY}[out${i}];`;

      currentOverlay = `out${i}`;
      inputIndex++;
    }

    // Final output
    filter += `[${currentOverlay}]format=yuv420p[v]`;

    return filter;
  }
}
```

## Chunked Composite Service

```typescript
// src/services/compositing/CompositeService.ts
import { FFmpegService } from './FFmpegService';
import { TimelineBuilder, TimelineSegment, VideoSource, EditPoint } from './TimelineBuilder';

const SEGMENT_DURATION = 600000; // 10 minutes in ms

export class CompositeService {
  private ffmpeg: FFmpegService;
  private timelineBuilder: TimelineBuilder;
  private onProgress: ((stage: string, progress: number) => void) | null = null;

  constructor() {
    this.ffmpeg = new FFmpegService();
    this.timelineBuilder = new TimelineBuilder();
  }

  async initialize(): Promise<void> {
    await this.ffmpeg.load();
  }

  setProgressCallback(callback: (stage: string, progress: number) => void): void {
    this.onProgress = callback;
    this.ffmpeg.setProgressCallback((p) => callback('Processing', p));
  }

  async composite(
    recordings: Map<string, Blob>,
    editPoints: EditPoint[],
    outputFormat: 'webm' | 'mp4' = 'webm'
  ): Promise<Blob> {
    this.onProgress?.('Loading FFmpeg', 0);
    await this.initialize();

    // Write all recordings to virtual filesystem
    this.onProgress?.('Loading files', 0);
    const sources: VideoSource[] = [];

    let index = 0;
    for (const [peerId, blob] of recordings) {
      const filename = `input_${index}.webm`;
      await this.ffmpeg.writeFile(filename, blob);

      // Get duration (simplified - in production, probe the file)
      sources.push({
        peerId,
        filename,
        duration: 0 // Will be determined by FFmpeg
      });
      index++;
    }

    // Setup timeline
    this.timelineBuilder.setEditPoints(editPoints);
    this.timelineBuilder.setSources(sources);
    const segments = this.timelineBuilder.buildSegments();

    // Process in chunks for memory management
    const totalDuration = Math.max(...segments.map(s => s.endTime));
    const chunkCount = Math.ceil(totalDuration / SEGMENT_DURATION);
    const chunkOutputs: string[] = [];

    for (let i = 0; i < chunkCount; i++) {
      this.onProgress?.('Compositing', i / chunkCount);

      const startTime = i * SEGMENT_DURATION;
      const endTime = Math.min((i + 1) * SEGMENT_DURATION, totalDuration);

      const relevantSegments = segments.filter(
        s => s.endTime > startTime && s.startTime < endTime
      );

      const chunkOutput = `chunk_${i}.${outputFormat}`;
      await this.processChunk(relevantSegments, startTime, endTime, chunkOutput, outputFormat);
      chunkOutputs.push(chunkOutput);
    }

    // Concatenate chunks
    this.onProgress?.('Finalizing', 0.9);

    let finalOutput: string;
    if (chunkOutputs.length === 1) {
      finalOutput = chunkOutputs[0];
    } else {
      finalOutput = `output.${outputFormat}`;
      await this.concatenateChunks(chunkOutputs, finalOutput);
    }

    // Read output
    this.onProgress?.('Preparing download', 0.95);
    const outputData = await this.ffmpeg.readFile(finalOutput);
    const mimeType = outputFormat === 'mp4' ? 'video/mp4' : 'video/webm';
    const blob = new Blob([outputData], { type: mimeType });

    // Cleanup
    for (const filename of [...chunkOutputs, ...sources.map(s => s.filename)]) {
      try {
        await this.ffmpeg.deleteFile(filename);
      } catch {}
    }

    this.onProgress?.('Complete', 1);
    return blob;
  }

  private async processChunk(
    segments: TimelineSegment[],
    startTime: number,
    endTime: number,
    outputFilename: string,
    format: 'webm' | 'mp4'
  ): Promise<void> {
    // Build FFmpeg command for this chunk
    const inputs: string[] = [];
    const filterComplex = this.buildChunkFilter(segments, inputs);

    const args = [
      ...inputs.flatMap(i => ['-i', i]),
      '-filter_complex', filterComplex,
      '-map', '[v]',
      '-map', '[a]',
      '-ss', String(startTime / 1000),
      '-t', String((endTime - startTime) / 1000)
    ];

    if (format === 'mp4') {
      args.push('-c:v', 'libx264', '-preset', 'fast', '-crf', '23');
      args.push('-c:a', 'aac', '-b:a', '128k');
    } else {
      args.push('-c:v', 'libvpx-vp9', '-crf', '30', '-b:v', '0');
      args.push('-c:a', 'libopus', '-b:a', '128k');
    }

    args.push(outputFilename);

    await this.ffmpeg.exec(args);
  }

  private buildChunkFilter(segments: TimelineSegment[], inputs: string[]): string {
    // Simplified: use first segment's main source for the whole chunk
    const segment = segments[0];
    if (!segment) return '';

    inputs.push(segment.mainSource);

    let filter = `[0:v]scale=1920:1080:force_original_aspect_ratio=decrease,`;
    filter += `pad=1920:1080:(ow-iw)/2:(oh-ih)/2,format=yuv420p[v];`;
    filter += `[0:a]anull[a]`;

    return filter;
  }

  private async concatenateChunks(chunks: string[], output: string): Promise<void> {
    // Create concat file
    const concatContent = chunks.map(c => `file '${c}'`).join('\n');
    const encoder = new TextEncoder();
    await this.ffmpeg.writeFile('concat.txt', encoder.encode(concatContent));

    await this.ffmpeg.exec([
      '-f', 'concat',
      '-safe', '0',
      '-i', 'concat.txt',
      '-c', 'copy',
      output
    ]);

    await this.ffmpeg.deleteFile('concat.txt');
  }
}
```

## Composite Store

```typescript
// src/store/compositeStore.ts
import { create } from 'zustand';

interface CompositeState {
  isCompositing: boolean;
  stage: string;
  progress: number;
  outputBlob: Blob | null;
  error: string | null;

  setIsCompositing: (compositing: boolean) => void;
  setStage: (stage: string) => void;
  setProgress: (progress: number) => void;
  setOutputBlob: (blob: Blob | null) => void;
  setError: (error: string | null) => void;
  reset: () => void;
}

export const useCompositeStore = create<CompositeState>((set) => ({
  isCompositing: false,
  stage: '',
  progress: 0,
  outputBlob: null,
  error: null,

  setIsCompositing: (isCompositing) => set({ isCompositing }),
  setStage: (stage) => set({ stage }),
  setProgress: (progress) => set({ progress }),
  setOutputBlob: (outputBlob) => set({ outputBlob }),
  setError: (error) => set({ error }),
  reset: () => set({
    isCompositing: false,
    stage: '',
    progress: 0,
    outputBlob: null,
    error: null
  })
}));
```

## useComposite Hook

```typescript
// src/hooks/useComposite.ts
import { useCallback, useRef } from 'react';
import { useCompositeStore } from '../store/compositeStore';
import { useRecordingStore } from '../store/recordingStore';
import { CompositeService } from '../services/compositing/CompositeService';

export function useComposite() {
  const serviceRef = useRef(new CompositeService());
  const {
    isCompositing,
    stage,
    progress,
    outputBlob,
    error,
    setIsCompositing,
    setStage,
    setProgress,
    setOutputBlob,
    setError,
    reset
  } = useCompositeStore();
  const { editPoints } = useRecordingStore();

  const startComposite = useCallback(async (
    recordings: Map<string, Blob>,
    format: 'webm' | 'mp4' = 'webm'
  ) => {
    reset();
    setIsCompositing(true);

    serviceRef.current.setProgressCallback((stg, prog) => {
      setStage(stg);
      setProgress(prog);
    });

    try {
      const blob = await serviceRef.current.composite(
        recordings,
        editPoints,
        format
      );
      setOutputBlob(blob);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Compositing failed');
    } finally {
      setIsCompositing(false);
    }
  }, [editPoints, reset, setIsCompositing, setStage, setProgress, setOutputBlob, setError]);

  const downloadOutput = useCallback(() => {
    if (!outputBlob) return;

    const url = URL.createObjectURL(outputBlob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `composite-${Date.now()}.${outputBlob.type.includes('mp4') ? 'mp4' : 'webm'}`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [outputBlob]);

  return {
    isCompositing,
    stage,
    progress,
    outputBlob,
    error,
    startComposite,
    downloadOutput,
    reset
  };
}
```

## CompositeProgress Component

```typescript
// src/components/compositing/CompositeProgress.tsx
import { useCompositeStore } from '../../store/compositeStore';

export function CompositeProgress() {
  const { isCompositing, stage, progress } = useCompositeStore();

  if (!isCompositing) return null;

  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50">
      <div className="bg-dark-lighter rounded-xl p-8 max-w-md w-full mx-4">
        <h3 className="text-xl font-bold text-white mb-4">
          Creating Composite Video
        </h3>

        <div className="space-y-4">
          <div>
            <div className="flex justify-between text-sm mb-1">
              <span className="text-gray-300">{stage}</span>
              <span className="text-gray-400">{Math.round(progress * 100)}%</span>
            </div>

            <div className="h-3 bg-gray-700 rounded-full overflow-hidden">
              <div
                className="h-full bg-primary transition-all duration-300"
                style={{ width: `${progress * 100}%` }}
              />
            </div>
          </div>

          <p className="text-gray-500 text-sm">
            This may take several minutes for longer recordings.
            Please don't close this window.
          </p>
        </div>
      </div>
    </div>
  );
}
```

## CompositeEditor Component

```typescript
// src/components/compositing/CompositeEditor.tsx
import { useRecordingStore } from '../../store/recordingStore';
import { useComposite } from '../../hooks/useComposite';

interface CompositeEditorProps {
  recordings: Map<string, Blob>;
  onClose: () => void;
}

export function CompositeEditor({ recordings, onClose }: CompositeEditorProps) {
  const { editPoints } = useRecordingStore();
  const { startComposite, isCompositing } = useComposite();
  const [format, setFormat] = useState<'webm' | 'mp4'>('webm');

  const handleComposite = () => {
    startComposite(recordings, format);
  };

  return (
    <div className="bg-dark-lighter rounded-xl p-6">
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-xl font-bold text-white">Composite Editor</h2>
        <button
          onClick={onClose}
          className="text-gray-400 hover:text-white"
        >
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* Timeline Preview */}
      <div className="bg-dark rounded-lg p-4 mb-6">
        <h3 className="text-sm font-medium text-gray-300 mb-3">Timeline</h3>

        <div className="relative h-12 bg-gray-800 rounded">
          {editPoints.map((point, i) => (
            <div
              key={i}
              className="absolute top-0 bottom-0 w-0.5 bg-primary"
              style={{
                left: `${(point.timestamp / (editPoints[editPoints.length - 1]?.timestamp || 1)) * 100}%`
              }}
              title={`${point.type} at ${(point.timestamp / 1000).toFixed(1)}s`}
            />
          ))}
        </div>

        <p className="text-xs text-gray-500 mt-2">
          {editPoints.length} edit points • {recordings.size} video sources
        </p>
      </div>

      {/* Format Selection */}
      <div className="mb-6">
        <label className="text-sm font-medium text-gray-300 block mb-2">
          Output Format
        </label>
        <div className="flex gap-3">
          <button
            onClick={() => setFormat('webm')}
            className={`px-4 py-2 rounded-lg ${
              format === 'webm'
                ? 'bg-primary text-white'
                : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
            }`}
          >
            WebM (VP9)
          </button>
          <button
            onClick={() => setFormat('mp4')}
            className={`px-4 py-2 rounded-lg ${
              format === 'mp4'
                ? 'bg-primary text-white'
                : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
            }`}
          >
            MP4 (H.264)
          </button>
        </div>
      </div>

      {/* Actions */}
      <div className="flex justify-end gap-3">
        <button
          onClick={onClose}
          className="px-6 py-2 text-gray-300 hover:text-white"
        >
          Cancel
        </button>
        <button
          onClick={handleComposite}
          disabled={isCompositing}
          className="px-6 py-2 bg-primary hover:bg-primary/80 text-white rounded-lg disabled:opacity-50"
        >
          Create Composite
        </button>
      </div>
    </div>
  );
}
```

## DownloadButton Component

```typescript
// src/components/compositing/DownloadButton.tsx
import { useComposite } from '../../hooks/useComposite';

export function DownloadButton() {
  const { outputBlob, downloadOutput } = useComposite();

  if (!outputBlob) return null;

  const sizeMB = (outputBlob.size / (1024 * 1024)).toFixed(1);

  return (
    <button
      onClick={downloadOutput}
      className="flex items-center gap-2 px-6 py-3 bg-green-500 hover:bg-green-600 text-white rounded-lg font-medium"
    >
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
      </svg>
      Download ({sizeMB} MB)
    </button>
  );
}
```

## Files to Create

1. `public/coi-serviceworker.js` (download from GitHub)
2. `src/services/compositing/FFmpegService.ts`
3. `src/services/compositing/TimelineBuilder.ts`
4. `src/services/compositing/CompositeService.ts`
5. `src/store/compositeStore.ts`
6. `src/hooks/useComposite.ts`
7. `src/components/compositing/CompositeProgress.tsx`
8. `src/components/compositing/CompositeEditor.tsx`
9. `src/components/compositing/DownloadButton.tsx`

## Dependencies to Install

```bash
npm install @ffmpeg/ffmpeg @ffmpeg/util
```
