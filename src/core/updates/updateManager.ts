import { app } from 'electron';
import { autoUpdater } from 'electron-updater';
import { getLogger } from '../logging/logger';
import { BundleUpdateResult, fetchPresetBundle, mergeBundle } from './bundleLoader';

const logger = getLogger('updater');

export interface AppUpdateStatus {
  available: boolean;
  currentVersion: string;
  newVersion?: string;
  downloadProgress?: number;
  status: 'idle' | 'checking' | 'downloading' | 'ready' | 'error';
  message?: string;
}

export interface BundleCheckResult {
  available: boolean;
  currentVersion: string;
  bundleVersion?: string;
  url?: string;
  releaseNotes?: string;
  message?: string;
}

let appUpdateStatus: AppUpdateStatus = {
  available: false,
  currentVersion: app.getVersion(),
  status: 'idle',
};

export function initializeAutoUpdater(): void {
  if (!app.isPackaged) {
    logger.info('Auto-updater disabled in development mode');
    return;
  }

  autoUpdater.on('checking-for-update', () => {
    appUpdateStatus = { ...appUpdateStatus, status: 'checking' };
  });

  autoUpdater.on('update-available', (info) => {
    appUpdateStatus = {
      ...appUpdateStatus,
      status: 'downloading',
      available: true,
      newVersion: info.version,
      message: 'Downloading update...',
    };
  });

  autoUpdater.on('update-not-available', () => {
    appUpdateStatus = {
      ...appUpdateStatus,
      status: 'idle',
      available: false,
      message: 'You are up to date.',
    };
  });

  autoUpdater.on('download-progress', (progress) => {
    appUpdateStatus = {
      ...appUpdateStatus,
      status: 'downloading',
      downloadProgress: progress.percent,
    };
  });

  autoUpdater.on('update-downloaded', () => {
    appUpdateStatus = {
      ...appUpdateStatus,
      status: 'ready',
      available: true,
      message: 'Update downloaded. Restart to install.',
    };
  });

  autoUpdater.on('error', (error) => {
    appUpdateStatus = {
      ...appUpdateStatus,
      status: 'error',
      message: error.message,
    };
  });

  void autoUpdater.checkForUpdates().catch((error: unknown) => {
    logger.warn('Initial update check failed', { error: String(error) });
  });
}

export function getAppUpdateStatus(): AppUpdateStatus {
  return { ...appUpdateStatus };
}

export async function checkForAppUpdates(): Promise<AppUpdateStatus> {
  if (!app.isPackaged) {
    return {
      ...appUpdateStatus,
      message: 'Auto-update checks run in packaged builds.',
    };
  }

  try {
    await autoUpdater.checkForUpdates();
  } catch (error) {
    appUpdateStatus = {
      ...appUpdateStatus,
      status: 'error',
      message: error instanceof Error ? error.message : String(error),
    };
  }

  return { ...appUpdateStatus };
}

export function quitAndInstallUpdate(): void {
  autoUpdater.quitAndInstall();
}

export async function checkForBundleUpdates(
  bundleUrl: string,
  currentBundleVersion?: string
): Promise<BundleCheckResult> {
  const bundle = await fetchPresetBundle(bundleUrl);

  if (currentBundleVersion && currentBundleVersion === bundle.version) {
    return {
      available: false,
      currentVersion: currentBundleVersion,
      message: 'Preset bundle is up to date.',
    };
  }

  return {
    available: true,
    currentVersion: currentBundleVersion || 'none',
    bundleVersion: bundle.version,
    releaseNotes: bundle.releaseNotes,
    url: bundleUrl,
  };
}

export async function downloadAndMergeBundle(
  bundleUrl: string,
  existingPresets: Record<string, unknown>,
  existingAssets: Record<string, unknown>
): Promise<BundleUpdateResult> {
  const bundle = await fetchPresetBundle(bundleUrl);
  return mergeBundle(existingPresets, existingAssets, bundle);
}
