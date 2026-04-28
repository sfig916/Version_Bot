/**
 * Preload script for secure IPC communication
 */

import { contextBridge, ipcRenderer } from 'electron';
import {
  VideoMetadata,
  OutputPreset,
  RenderPlan,
  MediaSiloConfig,
  MediaSiloAuthStatus,
  MediaSiloSyncSummary,
} from '../core/models/types';

export interface JobProgress {
  jobId: string;
  progress: number;
  currentTime: number;
  fps: number;
  speed: string;
}

export interface JobResult {
  jobId: string;
  success: boolean;
  outputPath?: string;
  error?: string;
  durationMs: number;
}

interface FFmpegCommand {
  program: string;
  args: string[];
  fullCommand: string;
  description: string;
}

interface APIResult<T> {
  success: boolean;
  data?: T;
  error?: string;
}

const api = {
  // File operations
  selectVideoFile: async () => {
    try {
      const result = await ipcRenderer.invoke('select-video-file') as Promise<string | null>;
      console.log('[preload] selectVideoFile result:', result);
      return result;
    } catch (error) {
      console.error('[preload] selectVideoFile error:', error);
      throw error;
    }
  },

  selectOutputDirectory: () =>
    ipcRenderer.invoke('select-output-directory') as Promise<string | null>,

  selectAssetFile: (kind: 'video' | 'image' | 'any' = 'any') =>
    ipcRenderer.invoke('select-asset-file', kind) as Promise<string | null>,

  selectAssetFiles: (kind: 'video' | 'image' | 'any' = 'any') =>
    ipcRenderer.invoke('select-asset-files', kind) as Promise<string[]>,

  openDirectory: (dirPath: string) =>
    ipcRenderer.invoke('open-directory', dirPath) as Promise<APIResult<void>>,

  // Video probing
  probeVideo: (filePath: string) =>
    ipcRenderer.invoke('probe-video', filePath) as Promise<APIResult<VideoMetadata>>,

  // Presets
  listPresets: (presetsDir?: string) =>
    ipcRenderer.invoke('list-presets', presetsDir) as Promise<APIResult<OutputPreset[]>>,

  savePresets: (presets: OutputPreset[], presetsDir?: string) =>
    ipcRenderer.invoke('save-presets', presets, presetsDir) as Promise<APIResult<OutputPreset[]>>,

  getAssetOverrides: () =>
    ipcRenderer.invoke('get-asset-overrides') as Promise<APIResult<Record<string, string>>>,

  setAssetOverride: (key: string, filePath: string | null) =>
    ipcRenderer.invoke('set-asset-override', key, filePath) as Promise<APIResult<Record<string, string>>>,

  // MediaSilo auth and cache
  getMediaSiloStatus: () =>
    ipcRenderer.invoke('get-mediasilo-status') as Promise<APIResult<MediaSiloAuthStatus>>,

  setMediaSiloConfig: (config: Partial<MediaSiloConfig>) =>
    ipcRenderer.invoke('set-mediasilo-config', config) as Promise<APIResult<MediaSiloConfig>>,

  startMediaSiloLogin: () =>
    ipcRenderer.invoke('start-mediasilo-login') as Promise<APIResult<void>>,

  completeMediaSiloLogin: (accessToken: string, refreshToken?: string, expiresAt?: string) =>
    ipcRenderer.invoke(
      'complete-mediasilo-login',
      accessToken,
      refreshToken,
      expiresAt
    ) as Promise<APIResult<MediaSiloAuthStatus>>,

  logoutMediaSilo: () =>
    ipcRenderer.invoke('logout-mediasilo') as Promise<APIResult<void>>,

  syncMediaSiloAssets: () =>
    ipcRenderer.invoke('sync-mediasilo-assets') as Promise<APIResult<MediaSiloSyncSummary>>,

  setMediaSiloCachedAssetPath: (key: string, mediaSiloId: string | null, localPath: string) =>
    ipcRenderer.invoke(
      'set-mediasilo-cached-asset-path',
      key,
      mediaSiloId,
      localPath
    ) as Promise<APIResult<void>>,

  // Asset libraries (file-based, persistent)
  getAssetLibrary: (libraryName: string) =>
    ipcRenderer.invoke('get-asset-library', libraryName) as Promise<APIResult<unknown[]>>,

  saveAssetLibrary: (libraryName: string, items: unknown[]) =>
    ipcRenderer.invoke('save-asset-library', libraryName, items) as Promise<APIResult<void>>,

  migrateAssetLibraryFromLocalStorage: (libraryName: string, items: unknown[]) =>
    ipcRenderer.invoke('migrate-asset-library-from-localstorage', libraryName, items) as Promise<APIResult<void>>,

  // Render planning
  createRenderPlan: (
    metadata: VideoMetadata,
    selectedPresetIds: string[],
    allPresets: OutputPreset[],
    outputDir: string,
    filenameTemplate: string,
    fileSizeConstraints?: Record<string, number>,
    overlayDurationOverrideSeconds?: number
  ) =>
    ipcRenderer.invoke(
      'create-render-plan',
      metadata,
      selectedPresetIds,
      allPresets,
      outputDir,
      filenameTemplate,
      fileSizeConstraints,
      overlayDurationOverrideSeconds
    ) as Promise<APIResult<RenderPlan>>,

  getRenderPlan: () =>
    ipcRenderer.invoke('get-render-plan') as Promise<RenderPlan | null>,

  // FFmpeg command preview
  getFFmpegCommand: (jobId: string) =>
    ipcRenderer.invoke('get-ffmpeg-command', jobId) as Promise<APIResult<FFmpegCommand>>,

  // Render execution
  startRender: () =>
    ipcRenderer.invoke('start-render') as Promise<APIResult<JobResult[]>>,

  cancelRender: () =>
    ipcRenderer.invoke('cancel-render') as Promise<APIResult<void>>,

  // Renderer-side event listeners
  onRenderProgress: (callback: (progress: JobProgress) => void) => {
    ipcRenderer.on('render-progress', (_event, progress) => callback(progress));
  },

  onJobComplete: (callback: (result: JobResult) => void) => {
    ipcRenderer.on('job-complete', (_event, result) => callback(result));
  },

  removeRenderListeners: () => {
    ipcRenderer.removeAllListeners('render-progress');
    ipcRenderer.removeAllListeners('job-complete');
  },
};

contextBridge.exposeInMainWorld('versionBotAPI', api);

// Type definitions for TypeScript
declare global {
  interface Window {
    versionBotAPI: typeof api;
  }
}
