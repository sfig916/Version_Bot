/**
 * Preload script for secure IPC communication
 */

import { contextBridge, ipcRenderer } from 'electron';
import {
  VideoMetadata,
  OutputPreset,
  RenderPlan,
} from '../core/models/types';

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

  openDirectory: (dirPath: string) =>
    ipcRenderer.invoke('open-directory', dirPath) as Promise<
      APIResult<void>
    >,

  // Video probing
  probeVideo: (filePath: string) =>
    ipcRenderer.invoke('probe-video', filePath) as Promise<
      APIResult<VideoMetadata>
    >,

  // Presets
  listPresets: (presetsDir?: string) =>
    ipcRenderer.invoke('list-presets', presetsDir) as Promise<
      APIResult<OutputPreset[]>
    >,

  // Render planning
  createRenderPlan: (
    metadata: VideoMetadata,
    selectedPresetIds: string[],
    allPresets: OutputPreset[],
    outputDir: string,
    filenameTemplate: string
  ) =>
    ipcRenderer.invoke(
      'create-render-plan',
      metadata,
      selectedPresetIds,
      allPresets,
      outputDir,
      filenameTemplate
    ) as Promise<APIResult<RenderPlan>>,

  getRenderPlan: () =>
    ipcRenderer.invoke('get-render-plan') as Promise<RenderPlan | null>,

  // FFmpeg
  getFFmpegCommand: (jobId: string) =>
    ipcRenderer.invoke('get-ffmpeg-command', jobId) as Promise<
      APIResult<FFmpegCommand>
    >,
};

contextBridge.exposeInMainWorld('versionBotAPI', api);

// Type definitions for TypeScript
declare global {
  interface Window {
    versionBotAPI: typeof api;
  }
}
