/**
 * Preload script for secure IPC communication
 */

import { contextBridge, ipcRenderer } from 'electron';
import {
  VideoMetadata,
  OutputPreset,
  RenderPlan,
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
  selectVideoFile: () =>
    ipcRenderer.invoke('select-video-file') as Promise<string | null>,

  selectOutputDirectory: () =>
    ipcRenderer.invoke('select-output-directory') as Promise<string | null>,

  selectAssetFile: (kind: 'video' | 'image' | 'any' = 'any') =>
    ipcRenderer.invoke('select-asset-file', kind) as Promise<string | null>,

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

  // Render planning
  createRenderPlan: (
    metadata: VideoMetadata,
    selectedPresetIds: string[],
    allPresets: OutputPreset[],
    outputDir: string,
    filenameTemplate: string,
    fileSizeConstraints?: Record<string, number>
  ) =>
    ipcRenderer.invoke(
      'create-render-plan',
      metadata,
      selectedPresetIds,
      allPresets,
      outputDir,
      filenameTemplate,
      fileSizeConstraints
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
