/**
 * Electron main process entry point
 */

import { app, BrowserWindow, ipcMain, dialog } from 'electron';
import path from 'path';
import { getLogger } from '../core/logging/logger';
import { probeVideo } from '../core/probing/videoProber';
import { loadPresetsFromDirectory } from '../core/presets/presetLoader';
import { createRenderPlan, updatePlanStatus } from '../core/rendering/renderPlanGenerator';
import { buildFFmpegCommand } from '../core/rendering/ffmpegCommandBuilder';
import { RenderPlan, VideoMetadata, OutputPreset, RenderJob } from '../core/models/types';

const logger = getLogger('main');
let mainWindow: BrowserWindow | null = null;

// Store current plan in memory for IPC communication
let currentPlan: RenderPlan | null = null;

/**
 * Create main window
 */
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  const isDev = process.env.NODE_ENV === 'development';
  if (isDev) {
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  logger.info('Main window created');
}

app.on('ready', createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (mainWindow === null) {
    createWindow();
  }
});

// ============================================================================
// IPC HANDLERS
// ============================================================================

/**
 * Select video file
 */
ipcMain.handle('select-video-file', async () => {
  const result = await dialog.showOpenDialog(mainWindow!, {
    title: 'Select Video File',
    properties: ['openFile'],
    filters: [
      {
        name: 'Video Files',
        extensions: [
          'mp4',
          'mkv',
          'mov',
          'avi',
          'flv',
          'wmv',
          'webm',
          'ts',
          'm3u8',
        ],
      },
      { name: 'All Files', extensions: ['*'] },
    ],
  });

  return result.filePaths.length > 0 ? result.filePaths[0] : null;
});

/**
 * Probe video and return metadata
 */
ipcMain.handle('probe-video', async (event, filePath: string) => {
  try {
    logger.info(`Probing video: ${filePath}`);
    const metadata = await probeVideo(filePath);
    logger.info('Probe successful', { resolution: `${metadata.width}x${metadata.height}` });
    return { success: true, data: metadata };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error('Probe failed', { error: message });
    return { success: false, error: message };
  }
});

/**
 * List available presets
 */
ipcMain.handle('list-presets', async (event, presetsDir?: string) => {
  try {
    const dir =
      presetsDir ||
      path.join(app.getPath('userData'), 'presets');
    logger.info(`Loading presets from: ${dir}`);
    const presets = await loadPresetsFromDirectory(dir);
    logger.info(`Loaded ${presets.length} presets`);
    return { success: true, data: presets };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error('Failed to list presets', { error: message });
    return { success: false, error: message };
  }
});

/**
 * Create render plan
 */
ipcMain.handle(
  'create-render-plan',
  async (
    event,
    metadata: VideoMetadata,
    selectedPresetIds: string[],
    allPresets: OutputPreset[],
    outputDir: string,
    filenameTemplate: string
  ) => {
    try {
      const selectedPresets = allPresets.filter((p) =>
        selectedPresetIds.includes(p.id)
      );

      if (selectedPresets.length === 0) {
        throw new Error('No presets selected');
      }

      logger.info(`Creating render plan for ${selectedPresets.length} presets`);

      const plan = createRenderPlan(
        metadata,
        selectedPresets,
        outputDir,
        filenameTemplate
      );

      currentPlan = plan;

      logger.info('Render plan created', {
        jobs: plan.jobs.length,
      });

      return { success: true, data: plan };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error('Failed to create render plan', { error: message });
      return { success: false, error: message };
    }
  }
);

/**
 * Get render plan (current in-memory plan)
 */
ipcMain.handle('get-render-plan', async () => {
  return currentPlan || null;
});

/**
 * Get FFmpeg command for a job (for preview/logging)
 */
ipcMain.handle('get-ffmpeg-command', async (event, jobId: string) => {
  if (!currentPlan) {
    return { success: false, error: 'No active plan' };
  }

  const job = currentPlan.jobs.find((j) => j.id === jobId);
  if (!job) {
    return { success: false, error: 'Job not found' };
  }

  try {
    const command = buildFFmpegCommand(job);
    return { success: true, data: command };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { success: false, error: message };
  }
});

/**
 * Select output directory
 */
ipcMain.handle('select-output-directory', async () => {
  const result = await dialog.showOpenDialog(mainWindow!, {
    title: 'Select Output Directory',
    properties: ['openDirectory', 'createDirectory'],
  });

  return result.filePaths.length > 0 ? result.filePaths[0] : null;
});

/**
 * Open directory in explorer/finder
 */
ipcMain.handle('open-directory', async (event, dirPath: string) => {
  try {
    const { shell } = require('electron');
    shell.openPath(dirPath);
    return { success: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error('Failed to open directory', { error: message });
    return { success: false, error: message };
  }
});

logger.info('Electron main process initialized');
