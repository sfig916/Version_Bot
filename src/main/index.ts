/**
 * Electron main process entry point
 */

import { app, BrowserWindow, ipcMain, dialog } from 'electron';
import path from 'path';
import fs from 'fs';
import { getLogger } from '../core/logging/logger';
import { probeVideo } from '../core/probing/videoProber';
import {
  loadPresetsFromDirectory,
  savePresetsToFile,
  createExamplePresets,
  listPresetFiles,
} from '../core/presets/presetLoader';
import { createRenderPlan, updatePlanStatus } from '../core/rendering/renderPlanGenerator';
import { buildFFmpegCommand } from '../core/rendering/ffmpegCommandBuilder';
import {
  RenderPlan,
  VideoMetadata,
  OutputPreset,
  RenderJob,
  SlateConfig,
  OverlayConfig,
  AssetReference,
} from '../core/models/types';
import { runPlan, JobProgress, JobResult } from '../core/rendering/ffmpegRunner';

const logger = getLogger('main');
let mainWindow: BrowserWindow | null = null;

// Store current plan in memory for IPC communication
let currentPlan: RenderPlan | null = null;

function getPresetsDir(presetsDir?: string): string {
  return presetsDir || path.join(app.getPath('userData'), 'presets');
}

function getUserPresetsFilePath(presetsDir?: string): string {
  return path.join(getPresetsDir(presetsDir), 'user-presets.yaml');
}

function getAssetOverridesFilePath(): string {
  return path.join(app.getPath('userData'), 'asset-overrides.json');
}

type AssetOverrideMap = Record<string, string>;

function readAssetOverrides(): AssetOverrideMap {
  const filePath = getAssetOverridesFilePath();
  if (!fs.existsSync(filePath)) {
    return {};
  }

  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    const parsed = JSON.parse(raw) as AssetOverrideMap;
    return Object.fromEntries(
      Object.entries(parsed).filter(
        ([key, value]) => typeof key === 'string' && typeof value === 'string'
      )
    );
  } catch (error) {
    logger.warn('Failed to read asset overrides, using empty map', {
      error: error instanceof Error ? error.message : String(error),
    });
    return {};
  }
}

function writeAssetOverrides(overrides: AssetOverrideMap): void {
  const filePath = getAssetOverridesFilePath();
  fs.writeFileSync(filePath, JSON.stringify(overrides, null, 2), 'utf-8');
}

function resolveAssetPath(
  explicitPath: string | undefined,
  assetRef: AssetReference | undefined,
  overrides: AssetOverrideMap
): string | undefined {
  const directPath = explicitPath?.trim();
  if (directPath) {
    return directPath;
  }

  if (!assetRef) {
    return undefined;
  }

  const overridePath = overrides[assetRef.key]?.trim();
  if (overridePath) {
    return overridePath;
  }

  if (assetRef.fallbackRelativePath) {
    return path.resolve(process.cwd(), assetRef.fallbackRelativePath);
  }

  return undefined;
}

function resolveSlateConfig(
  slate: SlateConfig | undefined,
  overrides: AssetOverrideMap,
  slotName: 'prepend' | 'append'
): SlateConfig | undefined {
  if (!slate?.enabled) {
    return slate;
  }

  const resolvedPath = resolveAssetPath(slate.assetPath, slate.assetRef, overrides);
  if (!resolvedPath) {
    const referenceHint = slate.assetRef?.key
      ? `"${slate.assetRef.key}"`
      : 'an asset path';

    throw new Error(
      `Unable to resolve ${slotName} asset ${referenceHint}. Set a local override for this asset key.`
    );
  }

  return {
    ...slate,
    assetPath: resolvedPath,
  };
}

function resolveOverlayConfig(
  overlay: OverlayConfig | undefined,
  overrides: AssetOverrideMap
): OverlayConfig | undefined {
  if (!overlay?.enabled) {
    return overlay;
  }

  const resolvedPath = resolveAssetPath(overlay.assetPath, overlay.assetRef, overrides);
  if (!resolvedPath) {
    const referenceHint = overlay.assetRef?.key
      ? `"${overlay.assetRef.key}"`
      : 'an asset path';

    throw new Error(
      `Unable to resolve overlay asset ${referenceHint}. Set a local override for this asset key.`
    );
  }

  return {
    ...overlay,
    assetPath: resolvedPath,
  };
}

function resolvePresetAssetsForRender(
  preset: OutputPreset,
  overrides: AssetOverrideMap
): OutputPreset {
  return {
    ...preset,
    introSlate: resolveSlateConfig(preset.introSlate, overrides, 'prepend'),
    outroSlate: resolveSlateConfig(preset.outroSlate, overrides, 'append'),
    overlay: resolveOverlayConfig(preset.overlay, overrides),
  };
}

async function ensurePresetStoreInitialized(presetsDir?: string): Promise<void> {
  const dir = getPresetsDir(presetsDir);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const presetFiles = listPresetFiles(dir);
  if (presetFiles.length === 0) {
    const defaultPresets = createExamplePresets();
    await savePresetsToFile(defaultPresets, getUserPresetsFilePath(presetsDir), 'yaml');
  }
}

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
    mainWindow.loadFile(path.join(__dirname, '../../renderer/index.html'));
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
 * Select generic asset file (video/image/any)
 */
ipcMain.handle('select-asset-file', async (_event, kind: 'video' | 'image' | 'any' = 'any') => {
  const videoExtensions = ['mp4', 'mkv', 'mov', 'avi', 'flv', 'wmv', 'webm', 'ts', 'm3u8'];
  const imageExtensions = ['png', 'jpg', 'jpeg', 'webp', 'bmp', 'tif', 'tiff'];

  const filters = (() => {
    if (kind === 'video') {
      return [
        { name: 'Video Files', extensions: videoExtensions },
        { name: 'All Files', extensions: ['*'] },
      ];
    }

    if (kind === 'image') {
      return [
        { name: 'Image Files', extensions: imageExtensions },
        { name: 'All Files', extensions: ['*'] },
      ];
    }

    return [
      { name: 'Media Files', extensions: [...videoExtensions, ...imageExtensions] },
      { name: 'All Files', extensions: ['*'] },
    ];
  })();

  const result = await dialog.showOpenDialog(mainWindow!, {
    title: 'Select Asset File',
    properties: ['openFile'],
    filters,
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
    await ensurePresetStoreInitialized(presetsDir);
    const dir = getPresetsDir(presetsDir);
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
 * Persist all presets to user preset file
 */
ipcMain.handle('save-presets', async (event, presets: OutputPreset[], presetsDir?: string) => {
  try {
    await ensurePresetStoreInitialized(presetsDir);
    const filePath = getUserPresetsFilePath(presetsDir);

    await savePresetsToFile(presets, filePath, 'yaml');
    logger.info(`Saved ${presets.length} presets to ${filePath}`);

    return { success: true, data: presets };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error('Failed to save presets', { error: message });
    return { success: false, error: message };
  }
});

ipcMain.handle('get-asset-overrides', async () => {
  try {
    return { success: true, data: readAssetOverrides() };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { success: false, error: message };
  }
});

ipcMain.handle('set-asset-override', async (_event, key: string, filePath: string | null) => {
  try {
    const normalizedKey = key.trim();
    if (!normalizedKey) {
      throw new Error('Asset override key is required');
    }

    const overrides = readAssetOverrides();
    if (!filePath || !filePath.trim()) {
      delete overrides[normalizedKey];
    } else {
      overrides[normalizedKey] = filePath.trim();
    }

    writeAssetOverrides(overrides);
    return { success: true, data: overrides };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
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
    filenameTemplate: string,
    fileSizeConstraints?: Record<string, number>
  ) => {
    try {
      const selectedPresets = allPresets.filter((p) =>
        selectedPresetIds.includes(p.id)
      );

      if (selectedPresets.length === 0) {
        throw new Error('No presets selected');
      }

      const overrides = readAssetOverrides();
      const resolvedPresets = selectedPresets.map((preset) => ({
        ...resolvePresetAssetsForRender(preset, overrides),
        scalingMode: 'scale' as const,
      }));

      logger.info(`Creating render plan for ${resolvedPresets.length} presets`);

      const plan = createRenderPlan(
        metadata,
        resolvedPresets,
        outputDir,
        filenameTemplate,
        fileSizeConstraints
          ? new Map(
              Object.entries(fileSizeConstraints).map(([presetId, size]) => [
                presetId,
                Number(size),
              ])
            )
          : undefined
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

// ============================================================================
// RENDER EXECUTION
// ============================================================================

// Cancellation signal shared between start-render and cancel-render
let cancelSignal: { cancelled: boolean } | null = null;

/**
 * Start executing the current render plan
 */
ipcMain.handle('start-render', async () => {
  if (!currentPlan) {
    return { success: false, error: 'No active render plan' };
  }

  cancelSignal = { cancelled: false };

  try {
    logger.info('Starting render execution', { jobs: currentPlan.jobs.length });

    const results = await runPlan(
      currentPlan,
      (progress: JobProgress) => {
        // Forward progress to renderer
        mainWindow?.webContents.send('render-progress', progress);

        // Update job in current plan
        const job = currentPlan?.jobs.find((j) => j.id === progress.jobId);
        if (job) {
          job.progress = progress.progress;
          job.status = 'running';
        }
      },
      (result: JobResult) => {
        // Update job status in current plan
        const job = currentPlan?.jobs.find((j) => j.id === result.jobId);
        if (job) {
          job.status = result.success ? 'completed' : 'failed';
          job.progress = result.success ? 100 : job.progress;
          job.error = result.error;
          job.completedAt = new Date();
        }
        mainWindow?.webContents.send('job-complete', result);
      },
      cancelSignal
    );

    logger.info('Render execution finished', {
      total: results.length,
      succeeded: results.filter((r) => r.success).length,
      failed: results.filter((r) => !r.success).length,
    });

    return { success: true, data: results };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error('Render execution failed', { error: message });
    return { success: false, error: message };
  }
});

/**
 * Cancel the running render
 */
ipcMain.handle('cancel-render', async () => {
  if (cancelSignal) {
    cancelSignal.cancelled = true;
    logger.info('Render cancelled by user');
  }
  return { success: true };
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
 * Open a directory in the system file explorer
 */
ipcMain.handle('open-directory', async (_event, dirPath: string) => {
  const { shell } = await import('electron');
  await shell.openPath(dirPath);
  return { success: true };
});

logger.info('Electron main process initialized');
