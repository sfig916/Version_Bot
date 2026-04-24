/**
 * Core data types for the video versioning tool
 */

export interface VideoMetadata {
  /** Source file path */
  filePath: string;
  /** Video width in pixels */
  width: number;
  /** Video height in pixels */
  height: number;
  /** Aspect ratio as decimal (16:9 = 1.777...) */
  aspectRatio: number;
  /** Duration in seconds */
  duration: number;
  /** Video bitrate in kbps */
  bitrate: number;
  /** Codec name (h264, vp9, etc.) */
  codec: string;
  /** Frames per second */
  fps: number;
  /** Audio codec */
  audioCodec: string;
  /** Audio sample rate in Hz */
  sampleRate: number;
}

export type ScalingMode = 'scale' | 'pillarbox' | 'letterbox' | 'crop';

export interface OverlayConfig {
  /** Whether to add an overlay */
  enabled: boolean;
  /** Path to overlay image/video */
  assetPath?: string;
  /** Corner position: tl, tr, bl, br */
  position: 'tl' | 'tr' | 'bl' | 'br';
  /** Overlay width as percentage of output */
  widthPercent: number;
  /** Overlay duration in seconds (for video overlays) */
  duration?: number;
  /** When to place overlay: start, end, or full */
  timing: 'start' | 'end' | 'full';
}

export interface SlateConfig {
  /** Whether to prepend slate */
  enabled: boolean;
  /** Path to slate video/image */
  assetPath?: string;
  /** Duration if it's a static image */
  duration: number;
}

export interface OutputPreset {
  /** Unique preset ID */
  id: string;
  /** Human-readable name */
  name: string;
  /** Output resolution width */
  width: number;
  /** Output resolution height */
  height: number;
  /** How to handle aspect ratio mismatch */
  scalingMode: ScalingMode;
  /** Target bitrate in kbps */
  bitrate: number;
  /** Video codec (h264, vp9, etc.) */
  videoCodec: string;
  /** CRF quality (0-51 for h264, lower = better) */
  crf?: number;
  /** Audio bitrate in kbps */
  audioBitrate: number;
  /** Audio codec */
  audioCodec: string;
  /** Container format (mp4, webm, mov) */
  container: string;
  /** Intro slate configuration */
  introSlate?: SlateConfig;
  /** Outro slate configuration */
  outroSlate?: SlateConfig;
  /** Overlay configuration */
  overlay?: OverlayConfig;
}

export interface RenderJob {
  /** Job unique ID */
  id: string;
  /** Source video metadata */
  source: VideoMetadata;
  /** Preset to use */
  preset: OutputPreset;
  /** Output file path */
  outputPath: string;
  /** Maximum output file size in MB (0 = no limit) */
  maxFileSizeMB: number;
  /** Actual bitrate to use (may be adjusted from preset) */
  adjustedBitrate?: number;
  /** Job status */
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  /** Progress 0-100 */
  progress: number;
  /** Error message if failed */
  error?: string;
  /** Start time */
  startedAt?: Date;
  /** End time */
  completedAt?: Date;
}

export interface RenderPlan {
  /** Plan unique ID */
  id: string;
  /** Source video metadata */
  source: VideoMetadata;
  /** All render jobs in this plan */
  jobs: RenderJob[];
  /** Output directory template */
  outputDirTemplate: string;
  /** Filename template with placeholders: {preset}, {width}x{height}, {timestamp} */
  filenameTemplate: string;
  /** Overall plan status */
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  /** Overall progress 0-100 */
  progress: number;
  /** When plan was created */
  createdAt: Date;
  /** When plan started */
  startedAt?: Date;
  /** When plan completed */
  completedAt?: Date;
  /** Log entries */
  logs: LogEntry[];
}

export interface LogEntry {
  timestamp: Date;
  level: 'info' | 'warn' | 'error' | 'debug';
  source: string;
  message: string;
  details?: unknown;
}

/** Configuration for bitrate adjustment based on file size */
export interface FileSizeConstraint {
  /** Maximum file size in MB */
  maxSizeMB: number;
  /** Duration in seconds */
  duration: number;
  /** Current bitrate in kbps */
  currentBitrate: number;
  /** Target bitrate in kbps (calculated) */
  targetBitrate: number;
}
