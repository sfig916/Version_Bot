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
  /** Whether the media has an audio stream */
  hasAudioTrack?: boolean;
}

export type ScalingMode = 'scale' | 'pillarbox' | 'letterbox' | 'crop';

export interface AssetReference {
  /** Stable cross-team key for this asset (e.g. brand_intro_v2) */
  key: string;
  /** Where the canonical asset is expected to come from */
  source: 'mediasilo' | 'local';
  /** Optional MediaSilo identifier for team users */
  mediaSiloId?: string;
  /** Optional repo-relative fallback path when available */
  fallbackRelativePath?: string;
}

export interface OverlayConfig {
  /** Whether to add an overlay */
  enabled: boolean;
  /** Path to overlay image/video (3840x2160 with transparency, pre-positioned) */
  assetPath?: string;
  /** Shared reference for cross-user resolution */
  assetRef?: AssetReference;
  /** Duration overlay appears on screen in seconds (default 4) */
  duration: number;
}

export interface SlateConfig {
  /** Whether to prepend slate */
  enabled: boolean;
  /** Path to slate video/image */
  assetPath?: string;
  /** Shared reference for cross-user resolution */
  assetRef?: AssetReference;
  /** Duration if it's a static image (auto-detected at render time) */
  duration?: number;
  /** Whether this slate has an audio stream (used for safe concat fallback) */
  hasAudio?: boolean;
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
  videoCodec: 'h264' | 'h265' | 'hevc' | 'vp9' | 'av1';
  /** CRF quality (0-51 for h264, lower = better) */
  crf?: number;
  /** Audio bitrate in kbps */
  audioBitrate: number;
  /** Audio codec */
  audioCodec: 'aac' | 'libopus' | 'libvorbis' | 'mp3';
  /** Container format (mp4, webm, mov) */
  container: 'mp4' | 'webm' | 'mov' | 'mkv';
  /** Default max output size for this preset in MB (0 = no limit) */
  maxFileSizeMB?: number;
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
  /** Internal filename pattern used to generate output names */
  filenamePattern: string;
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
  /** Audio bitrate in kbps reserved from the total budget */
  audioBitrate: number;
  /** Target bitrate in kbps (calculated) */
  targetBitrate: number;
}

export interface MediaSiloConfig {
  authUrl?: string;
  apiBaseUrl?: string;
  tenantName?: string;
}

export interface MediaSiloAuthStatus {
  configured: boolean;
  connected: boolean;
  provider: 'activision-sso';
  authUrl?: string;
  apiBaseUrl?: string;
  tenantName?: string;
  cachedAssets: number;
  expiresAt?: string;
  message?: string;
}

export interface MediaSiloSyncSummary {
  totalRefs: number;
  cached: number;
  missing: number;
  missingKeys: string[];
  message: string;
}
