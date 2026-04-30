/**
 * Electron main process entry point
 */

import { app, BrowserWindow, ipcMain, dialog, safeStorage, shell } from 'electron';
import path from 'path';
import fs from 'fs';
import { z } from 'zod';
import { getLogger } from '../core/logging/logger';
import { probeVideo } from '../core/probing/videoProber';
import {
  loadPresetsFromDirectory,
  loadPresetsFromFile,
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
  MediaSiloConfig,
  MediaSiloAuthStatus,
  MediaSiloSyncSummary,
} from '../core/models/types';
import { runPlan, JobProgress, JobResult } from '../core/rendering/ffmpegRunner';

const logger = getLogger('main');
let mainWindow: BrowserWindow | null = null;

// Store current plan in memory for IPC communication
let currentPlan: RenderPlan | null = null;

// === Portable mode detection ===
// If a 'user-data' folder exists next to the executable or app bundle, use it
// as userData. This supports self-contained Windows and macOS zip builds.
(function detectPortableMode() {
  function getPortableUserDataDir(): string | undefined {
    const exeDir = path.dirname(app.getPath('exe'));
    const candidateDirs: string[] = [];

    // In packaged mode, app.getPath('exe') returns the Electron binary inside resources.
    // Walk up the directory tree to find the portable root and look for user-data there.
    let walkDir = exeDir;
    for (let i = 0; i < 6; i++) {
      const candidate = path.join(walkDir, 'user-data');
      if (fs.existsSync(candidate)) {
        candidateDirs.push(candidate);
      }
      const parentDir = path.dirname(walkDir);
      if (parentDir === walkDir) break; // Reached filesystem root
      walkDir = parentDir;
    }

    if (process.platform === 'darwin') {
      candidateDirs.push(path.resolve(exeDir, '..', '..', '..', 'user-data'));
    }

    return candidateDirs.find((candidateDir) => fs.existsSync(candidateDir));
  }

  try {
    const portableDataDir = getPortableUserDataDir();
    if (portableDataDir) {
      app.setPath('userData', portableDataDir);
    }
  } catch {
    // Ignore - portable detection is best-effort
  }
})();

function getPresetsDir(presetsDir?: string): string {
  return presetsDir || path.join(app.getPath('userData'), 'presets');
}

function getLegacyUserDataDir(): string {
  return path.join(app.getPath('appData'), 'Electron');
}

function copyFileIfMissing(sourcePath: string, destinationPath: string): void {
  if (!fs.existsSync(sourcePath) || fs.existsSync(destinationPath)) {
    return;
  }

  const destinationDir = path.dirname(destinationPath);
  if (!fs.existsSync(destinationDir)) {
    fs.mkdirSync(destinationDir, { recursive: true });
  }

  fs.copyFileSync(sourcePath, destinationPath);
}

function migrateLegacyUserDataIfNeeded(): void {
  const currentUserDataDir = app.getPath('userData');
  const legacyUserDataDir = getLegacyUserDataDir();

  if (
    !fs.existsSync(legacyUserDataDir) ||
    path.resolve(currentUserDataDir) === path.resolve(legacyUserDataDir)
  ) {
    return;
  }

  try {
    const legacyPresetsDir = path.join(legacyUserDataDir, 'presets');
    const currentPresetsDir = path.join(currentUserDataDir, 'presets');
    copyFileIfMissing(
      path.join(legacyPresetsDir, 'user-presets.yaml'),
      path.join(currentPresetsDir, 'user-presets.yaml')
    );

    const legacyDataFiles = [
      'version-bot-prepend-library.json',
      'version-bot-append-library.json',
      'version-bot-overlay-library.json',
      'asset-overrides.json',
    ];

    for (const fileName of legacyDataFiles) {
      copyFileIfMissing(
        path.join(legacyUserDataDir, fileName),
        path.join(currentUserDataDir, fileName)
      );
    }

    logger.info('Checked legacy user data migration', {
      legacyUserDataDir,
      currentUserDataDir,
    });
  } catch (error) {
    logger.warn('Legacy user data migration skipped due to error', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

function getUserPresetsFilePath(presetsDir?: string): string {
  return path.join(getPresetsDir(presetsDir), 'user-presets.yaml');
}

function getAssetOverridesFilePath(): string {
  return path.join(app.getPath('userData'), 'asset-overrides.json');
}

function getMediaSiloConfigPath(): string {
  return path.join(app.getPath('userData'), 'mediasilo-config.json');
}

function getMediaSiloSessionPath(): string {
  return path.join(app.getPath('userData'), 'mediasilo-session.dat');
}

function getMediaSiloCacheIndexPath(): string {
  return path.join(app.getPath('userData'), 'mediasilo-cache-index.json');
}

interface MediaSiloSession {
  provider: 'activision-sso';
  accessToken: string;
  refreshToken?: string;
  expiresAt?: string;
  acquiredAt: string;
}

interface CachedMediaSiloAsset {
  key: string;
  mediaSiloId?: string;
  localPath: string;
  syncedAt: string;
}

type MediaSiloCacheIndex = Record<string, CachedMediaSiloAsset>;

const DEFAULT_MEDIASILO_AUTH_URL = 'https://app.mediasilo.com/desktop-login/initiate';
const DEFAULT_MEDIASILO_TENANT_LABEL = 'Activision';

const assetLibraryNameSchema = z.enum([
  'version-bot-prepend-library',
  'version-bot-append-library',
  'version-bot-overlay-library',
]);

const slateAssetLibraryItemSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  key: z.string().min(1),
  source: z.enum(['local', 'mediasilo']),
  mediaSiloId: z.string().min(1).optional(),
  path: z.string().min(1).optional(),
  duration: z.coerce.number().positive(),
});

const overlayAssetLibraryItemSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  key: z.string().min(1),
  source: z.enum(['local', 'mediasilo']),
  mediaSiloId: z.string().min(1).optional(),
  path: z.string().min(1).optional(),
});

function getAssetLibrarySchema(libraryName: string) {
  const validLibraryName = assetLibraryNameSchema.parse(libraryName);
  return validLibraryName === 'version-bot-overlay-library'
    ? z.array(overlayAssetLibraryItemSchema)
    : z.array(slateAssetLibraryItemSchema);
}

function validateHttpsUrl(rawValue: string, label: string): string {
  let parsedUrl: URL;

  try {
    parsedUrl = new URL(rawValue.trim());
  } catch {
    throw new Error(`${label} must be a valid URL.`);
  }

  if (parsedUrl.protocol !== 'https:') {
    throw new Error(`${label} must use https.`);
  }

  return parsedUrl.toString();
}

function validateMediaSiloAuthUrl(rawValue: string): string {
  const validatedUrl = validateHttpsUrl(rawValue, 'MediaSilo auth URL');
  const hostname = new URL(validatedUrl).hostname.toLowerCase();

  if (hostname !== 'app.mediasilo.com' && !hostname.endsWith('.mediasilo.com')) {
    throw new Error('MediaSilo auth URL must use an approved mediasilo.com host.');
  }

  return validatedUrl;
}

function readMediaSiloConfig(): MediaSiloConfig {
  const defaults: MediaSiloConfig = {
    authUrl: DEFAULT_MEDIASILO_AUTH_URL,
    tenantName: DEFAULT_MEDIASILO_TENANT_LABEL,
  };

  const configPath = getMediaSiloConfigPath();
  if (!fs.existsSync(configPath)) {
    return defaults;
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(configPath, 'utf-8')) as Partial<MediaSiloConfig>;
    const authUrl = typeof parsed.authUrl === 'string'
      ? validateMediaSiloAuthUrl(parsed.authUrl)
      : defaults.authUrl;
    const apiBaseUrl = typeof parsed.apiBaseUrl === 'string'
      ? validateHttpsUrl(parsed.apiBaseUrl, 'MediaSilo API base URL')
      : undefined;

    return {
      authUrl,
      apiBaseUrl,
      tenantName: typeof parsed.tenantName === 'string' ? parsed.tenantName : defaults.tenantName,
    };
  } catch (error) {
    logger.warn('Failed to read MediaSilo config', {
      error: error instanceof Error ? error.message : String(error),
    });
    return defaults;
  }
}

function writeMediaSiloConfig(config: MediaSiloConfig): void {
  fs.writeFileSync(getMediaSiloConfigPath(), JSON.stringify(config, null, 2), 'utf-8');
}

function buildManagedMediaSiloConfig(configPatch: Partial<MediaSiloConfig> = {}): MediaSiloConfig {
  const current = readMediaSiloConfig();

  return {
    ...current,
    authUrl: DEFAULT_MEDIASILO_AUTH_URL,
    apiBaseUrl: configPatch.apiBaseUrl
      ? validateHttpsUrl(configPatch.apiBaseUrl, 'MediaSilo API base URL')
      : current.apiBaseUrl,
    tenantName: DEFAULT_MEDIASILO_TENANT_LABEL,
  };
}

function readMediaSiloSession(): MediaSiloSession | null {
  const sessionPath = getMediaSiloSessionPath();
  if (!fs.existsSync(sessionPath)) {
    return null;
  }

  try {
    const raw = fs.readFileSync(sessionPath, 'utf-8');
    let decoded: string;

    if (raw.startsWith('enc:')) {
      if (!safeStorage.isEncryptionAvailable()) {
        return null;
      }
      const encrypted = Buffer.from(raw.slice(4), 'base64');
      decoded = safeStorage.decryptString(encrypted);
    } else if (raw.startsWith('raw:')) {
      decoded = raw.slice(4);
    } else {
      decoded = raw;
    }

    const parsed = JSON.parse(decoded) as MediaSiloSession;
    if (!parsed.accessToken || !parsed.acquiredAt) {
      return null;
    }

    return {
      provider: 'activision-sso',
      accessToken: parsed.accessToken,
      refreshToken: parsed.refreshToken,
      expiresAt: parsed.expiresAt,
      acquiredAt: parsed.acquiredAt,
    };
  } catch (error) {
    logger.warn('Failed to read MediaSilo session', {
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

function writeMediaSiloSession(session: MediaSiloSession): void {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('Secure credential storage is unavailable on this machine. MediaSilo login is disabled.');
  }

  const payload = JSON.stringify(session);
  const toWrite = `enc:${safeStorage.encryptString(payload).toString('base64')}`;
  fs.writeFileSync(getMediaSiloSessionPath(), toWrite, 'utf-8');
}

function clearMediaSiloSession(): void {
  const sessionPath = getMediaSiloSessionPath();
  if (fs.existsSync(sessionPath)) {
    fs.unlinkSync(sessionPath);
  }
}

function readMediaSiloCacheIndex(): MediaSiloCacheIndex {
  const cachePath = getMediaSiloCacheIndexPath();
  if (!fs.existsSync(cachePath)) {
    return {};
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(cachePath, 'utf-8')) as MediaSiloCacheIndex;
    return Object.fromEntries(
      Object.entries(parsed).filter(
        ([key, value]) =>
          typeof key === 'string' &&
          typeof value?.localPath === 'string' &&
          typeof value?.syncedAt === 'string'
      )
    );
  } catch (error) {
    logger.warn('Failed to read MediaSilo cache index', {
      error: error instanceof Error ? error.message : String(error),
    });
    return {};
  }
}

function writeMediaSiloCacheIndex(index: MediaSiloCacheIndex): void {
  fs.writeFileSync(getMediaSiloCacheIndexPath(), JSON.stringify(index, null, 2), 'utf-8');
}

function resolveMediaSiloCachedPath(assetRef: AssetReference): string | undefined {
  const cacheIndex = readMediaSiloCacheIndex();
  const byKey = cacheIndex[assetRef.key];
  if (byKey?.localPath && fs.existsSync(byKey.localPath)) {
    return byKey.localPath;
  }

  if (!assetRef.mediaSiloId) {
    return undefined;
  }

  const byId = Object.values(cacheIndex).find(
    (entry) => entry.mediaSiloId === assetRef.mediaSiloId && fs.existsSync(entry.localPath)
  );
  return byId?.localPath;
}

function getMediaSiloAuthStatus(): MediaSiloAuthStatus {
  const config = readMediaSiloConfig();
  const session = readMediaSiloSession();
  const cacheIndex = readMediaSiloCacheIndex();
  const configured = Boolean(config.authUrl);

  return {
    configured,
    connected: Boolean(session?.accessToken),
    provider: 'activision-sso',
    authUrl: config.authUrl,
    apiBaseUrl: config.apiBaseUrl,
    tenantName: config.tenantName,
    cachedAssets: Object.keys(cacheIndex).length,
    expiresAt: session?.expiresAt,
    message: session?.accessToken
      ? undefined
      : 'Sign in with your Activision account to access the shared Activision MediaSilo project.',
  };
}

type AssetOverrideMap = Record<string, string>;

function readAssetOverrides(): AssetOverrideMap {
  const filePath = getAssetOverridesFilePath();
  if (!fs.existsSync(filePath)) {
    return {};
  }

  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    const parseCandidate = (input: string): AssetOverrideMap | undefined => {
      try {
        return JSON.parse(input) as AssetOverrideMap;
      } catch {
        return undefined;
      }
    };

    const directParsed = parseCandidate(raw);
    const normalizedParsed = directParsed
      ?? parseCandidate(raw.replace(/^\uFEFF/, '').replace(/^[^\{\[]+/, ''));

    if (!normalizedParsed) {
      throw new Error('Asset overrides JSON is invalid.');
    }

    const sanitized = Object.fromEntries(
      Object.entries(normalizedParsed).filter(
        ([key, value]) => typeof key === 'string' && typeof value === 'string'
      )
    );

    // Self-heal any malformed leading bytes/BOM by rewriting clean JSON.
    if (!directParsed) {
      writeAssetOverrides(sanitized);
    }

    return sanitized;
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

function resolveRelativePath(relativePath: string): string {
  return path.resolve(app.getPath('userData'), relativePath);
}

function resolveAssetPath(
  explicitPath: string | undefined,
  assetRef: AssetReference | undefined,
  overrides: AssetOverrideMap
): string | undefined {
  const toResolvedPath = (rawPath: string | undefined): string | undefined => {
    const trimmed = rawPath?.trim();
    if (!trimmed) return undefined;
    return path.isAbsolute(trimmed) ? trimmed : resolveRelativePath(trimmed);
  };

  const pickExistingPath = (...candidates: Array<string | undefined>): string | undefined => {
    for (const candidate of candidates) {
      if (candidate && fs.existsSync(candidate)) {
        return candidate;
      }
    }
    return undefined;
  };

  const normalizeFileName = (filePath: string | undefined): string | undefined => {
    if (!filePath) return undefined;
    const extension = path.extname(filePath).toLowerCase();
    const baseName = path.basename(filePath, extension)
      .toLowerCase()
      .replace(/\s*\(\d+\)$/, '');
    return `${baseName}${extension}`;
  };

  const findMatchingOverrideByFileName = (
    targetPath: string | undefined,
    resolvedOverrides: Array<string | undefined>
  ): string | undefined => {
    const normalizedTargetName = normalizeFileName(targetPath);
    if (!normalizedTargetName) {
      return undefined;
    }

    for (const candidate of resolvedOverrides) {
      if (!candidate || !fs.existsSync(candidate)) {
        continue;
      }
      if (normalizeFileName(candidate) === normalizedTargetName) {
        return candidate;
      }
    }

    return undefined;
  };

  const directPath = explicitPath?.trim();
  const resolvedDirectPath = toResolvedPath(directPath);

  const resolvedOverrideValues = Object.values(overrides).map((value) =>
    toResolvedPath(value)
  );

  if (!assetRef) {
    return resolvedDirectPath;
  }

  const overridePath = overrides[assetRef.key]?.trim();
  const resolvedOverridePath = toResolvedPath(overridePath);

  // Prefer paths that actually exist, so stale absolute preset paths can fall back
  // to current overrides after assets move.
  const existingPath = pickExistingPath(resolvedDirectPath, resolvedOverridePath);
  if (existingPath) {
    return existingPath;
  }

  // Legacy presets may reference a duplicate filename variant (e.g. "(1)") with
  // a key that no longer exists in current libraries. In that case, recover by
  // matching against any existing override with the same normalized filename.
  const matchedOverridePath = findMatchingOverrideByFileName(
    resolvedDirectPath,
    resolvedOverrideValues
  );
  if (matchedOverridePath) {
    return matchedOverridePath;
  }

  if (assetRef.source === 'mediasilo') {
    const cachedPath = resolveMediaSiloCachedPath(assetRef);
    if (cachedPath) {
      return cachedPath;
    }
  }

  if (assetRef.fallbackRelativePath) {
    return path.resolve(process.cwd(), assetRef.fallbackRelativePath);
  }

  // No existing candidate; return the best available path for clearer downstream errors.
  return resolvedDirectPath || resolvedOverridePath;
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

    const mediaSiloHint = slate.assetRef?.source === 'mediasilo'
      ? ' Connect MediaSilo and sync/link this asset to a local cached file path.'
      : ' Set a local override for this asset key.';

    throw new Error(
      `Unable to resolve ${slotName} asset ${referenceHint}.${mediaSiloHint}`
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

    const mediaSiloHint = overlay.assetRef?.source === 'mediasilo'
      ? ' Connect MediaSilo and sync/link this asset to a local cached file path.'
      : ' Set a local override for this asset key.';

    throw new Error(
      `Unable to resolve overlay asset ${referenceHint}.${mediaSiloHint}`
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

async function enrichSlateForRender(
  slate: SlateConfig | undefined,
  slotName: 'prepend' | 'append'
): Promise<SlateConfig | undefined> {
  if (!slate?.enabled || !slate.assetPath) {
    return slate;
  }

  try {
    const metadata = await probeVideo(slate.assetPath);
    return {
      ...slate,
      duration: Math.max(1, slate.duration || metadata.duration || 1),
      hasAudio: metadata.hasAudioTrack !== false,
    };
  } catch (error) {
    logger.warn(`Failed to probe ${slotName} asset, using safe defaults`, {
      assetPath: slate.assetPath,
      error: error instanceof Error ? error.message : String(error),
    });

    return {
      ...slate,
      duration: Math.max(1, slate.duration || 1),
      hasAudio: slate.hasAudio ?? true,
    };
  }
}

async function enrichPresetForRender(preset: OutputPreset): Promise<OutputPreset> {
  const [introSlate, outroSlate] = await Promise.all([
    enrichSlateForRender(preset.introSlate, 'prepend'),
    enrichSlateForRender(preset.outroSlate, 'append'),
  ]);

  return {
    ...preset,
    introSlate,
    outroSlate,
  };
}

async function ensurePresetStoreInitialized(presetsDir?: string): Promise<void> {
  const dir = getPresetsDir(presetsDir);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const presetFiles = listPresetFiles(dir);
  if (presetFiles.length === 0) {
    // Try to load bundled presets from the app resources
    const bundledPresetsPath = path.join(__dirname, '../../presets/user-presets.yaml');
    let presetsToSave = createExamplePresets();

    if (fs.existsSync(bundledPresetsPath)) {
      try {
        logger.info(`Loading bundled presets from: ${bundledPresetsPath}`);
        presetsToSave = await loadPresetsFromFile(bundledPresetsPath);
        logger.info(`Loaded ${presetsToSave.length} bundled presets`);
      } catch (error) {
        logger.warn('Failed to load bundled presets, using defaults', {
          error: error instanceof Error ? error.message : String(error),
        });
        presetsToSave = createExamplePresets();
      }
    }

    await savePresetsToFile(presetsToSave, getUserPresetsFilePath(presetsDir), 'yaml');
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
      sandbox: true,
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

app.on('ready', () => {
  migrateLegacyUserDataIfNeeded();
  createWindow();
});

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

// ---- Asset Libraries -------------------------------------------------------

function getAssetLibraryFilePath(libraryName: string): string {
  const validLibraryName = assetLibraryNameSchema.parse(libraryName);
  return path.join(app.getPath('userData'), `${validLibraryName}.json`);
}

function readAssetLibrary(libraryName: string): unknown[] {
  const filePath = getAssetLibraryFilePath(libraryName);
  if (!fs.existsSync(filePath)) return [];

  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    return getAssetLibrarySchema(libraryName).parse(parsed);
  } catch {
    throw new Error(`Asset library file "${libraryName}" is invalid.`);
  }
}

function writeAssetLibrary(libraryName: string, items: unknown[]): void {
  const validatedItems = getAssetLibrarySchema(libraryName).parse(items);
  const filePath = getAssetLibraryFilePath(libraryName);
  fs.writeFileSync(filePath, JSON.stringify(validatedItems, null, 2), 'utf-8');
}

ipcMain.handle('get-asset-library', (_event, libraryName: string) => {
  try {
    return { success: true, data: readAssetLibrary(libraryName) };
  } catch (error) {
    return { success: false, error: String(error) };
  }
});

ipcMain.handle('save-asset-library', (_event, libraryName: string, items: unknown[]) => {
  try {
    writeAssetLibrary(libraryName, items);
    return { success: true };
  } catch (error) {
    return { success: false, error: String(error) };
  }
});

// Migration: import existing data from renderer localStorage on first run
ipcMain.handle('migrate-asset-library-from-localstorage', (_event, libraryName: string, items: unknown[]) => {
  try {
    const filePath = getAssetLibraryFilePath(libraryName);
    // Only migrate if the file doesn't exist yet (first run)
    if (!fs.existsSync(filePath) && Array.isArray(items) && items.length > 0) {
      writeAssetLibrary(libraryName, items);
      logger.info(`Migrated ${items.length} items for library: ${libraryName}`);
    }
    return { success: true };
  } catch (error) {
    return { success: false, error: String(error) };
  }
});

ipcMain.handle('check-file-exists', (_event, filePath: string) => {
  try {
    if (!filePath || typeof filePath !== 'string') return { success: true, data: false };
    // Resolve relative paths from userData (same logic as asset resolution)
    const resolved = path.isAbsolute(filePath)
      ? filePath
      : path.resolve(app.getPath('userData'), filePath);
    return { success: true, data: fs.existsSync(resolved) };
  } catch (error) {
    return { success: false, error: String(error) };
  }
});

/**
 * Select video file
 */
ipcMain.handle('select-video-file', async (event) => {
  try {
    const ownerWindow = BrowserWindow.fromWebContents(event.sender) || mainWindow;
    if (!ownerWindow) {
      const msg = 'Application window is not ready';
      logger.error(msg);
      throw new Error(msg);
    }

    const result = await dialog.showOpenDialog(ownerWindow, {
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
      ],
    });

    logger.info('File dialog result', {
      canceled: result.canceled,
      pathsCount: result.filePaths.length,
    });

    return result.filePaths.length > 0 ? result.filePaths[0] : null;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const stack = error instanceof Error ? error.stack : undefined;
    logger.error('File dialog error', { error: message, stack });
    throw error;
  }
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
      ];
    }

    if (kind === 'image') {
      return [
        { name: 'Image Files', extensions: imageExtensions },
      ];
    }

    return [
      { name: 'Media Files', extensions: [...videoExtensions, ...imageExtensions] },
    ];
  })();

  const result = await dialog.showOpenDialog(mainWindow!, {
    title: 'Select Asset File',
    properties: ['openFile'],
    filters,
  });

  return result.filePaths.length > 0 ? result.filePaths[0] : null;
});

ipcMain.handle('select-asset-files', async (_event, kind: 'video' | 'image' | 'any' = 'any') => {
  const videoExtensions = ['mp4', 'mkv', 'mov', 'avi', 'flv', 'wmv', 'webm', 'ts', 'm3u8'];
  const imageExtensions = ['png', 'jpg', 'jpeg', 'webp', 'bmp', 'tif', 'tiff'];

  const filters = (() => {
    if (kind === 'video') {
      return [
        { name: 'Video Files', extensions: videoExtensions },
      ];
    }

    if (kind === 'image') {
      return [
        { name: 'Image Files', extensions: imageExtensions },
      ];
    }

    return [
      { name: 'Media Files', extensions: [...videoExtensions, ...imageExtensions] },
    ];
  })();

  const result = await dialog.showOpenDialog(mainWindow!, {
    title: 'Select Asset Files',
    properties: ['openFile', 'multiSelections'],
    filters,
  });

  return result.filePaths;
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

function collectMediaSiloAssetRefs(): Array<{ key: string; mediaSiloId?: string }> {
  const libraryNames = [
    'version-bot-prepend-library',
    'version-bot-append-library',
    'version-bot-overlay-library',
  ];

  const refs = new Map<string, { key: string; mediaSiloId?: string }>();

  for (const libraryName of libraryNames) {
    const items = readAssetLibrary(libraryName) as Array<{
      key?: string;
      source?: string;
      mediaSiloId?: string;
    }>;

    for (const item of items) {
      if (item.source !== 'mediasilo' || !item.key) {
        continue;
      }

      if (!refs.has(item.key)) {
        refs.set(item.key, { key: item.key, mediaSiloId: item.mediaSiloId });
      }
    }
  }

  return Array.from(refs.values());
}

ipcMain.handle('get-mediasilo-status', async () => {
  try {
    return { success: true, data: getMediaSiloAuthStatus() };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { success: false, error: message };
  }
});

ipcMain.handle('set-mediasilo-config', async (_event, configPatch: Partial<MediaSiloConfig>) => {
  try {
    const next = buildManagedMediaSiloConfig(configPatch);
    writeMediaSiloConfig(next);
    return { success: true, data: next };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { success: false, error: message };
  }
});

ipcMain.handle('start-mediasilo-login', async () => {
  try {
    const config = readMediaSiloConfig();
    if (!config.authUrl) {
      throw new Error('MediaSilo auth URL is not configured yet.');
    }

    await shell.openExternal(config.authUrl);
    logger.info('Opened MediaSilo login URL in browser', { authUrl: config.authUrl });
    return { success: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { success: false, error: message };
  }
});

ipcMain.handle(
  'complete-mediasilo-login',
  async (_event, accessToken: string, refreshToken?: string, expiresAt?: string) => {
    try {
      const token = accessToken?.trim();
      if (!token) {
        throw new Error('Access token is required to complete login.');
      }

      const session: MediaSiloSession = {
        provider: 'activision-sso',
        accessToken: token,
        refreshToken: refreshToken?.trim() || undefined,
        expiresAt: expiresAt?.trim() || undefined,
        acquiredAt: new Date().toISOString(),
      };

      writeMediaSiloSession(session);
      return { success: true, data: getMediaSiloAuthStatus() };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { success: false, error: message };
    }
  }
);

ipcMain.handle('logout-mediasilo', async () => {
  try {
    clearMediaSiloSession();
    return { success: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { success: false, error: message };
  }
});

ipcMain.handle('set-mediasilo-cached-asset-path', async (_event, key: string, mediaSiloId: string | null, localPath: string) => {
  try {
    const normalizedKey = key.trim();
    const normalizedLocalPath = localPath.trim();

    if (!normalizedKey) {
      throw new Error('Asset key is required.');
    }

    if (!normalizedLocalPath) {
      throw new Error('Local path is required.');
    }

    if (!fs.existsSync(normalizedLocalPath)) {
      throw new Error(`Local path does not exist: ${normalizedLocalPath}`);
    }

    const cacheIndex = readMediaSiloCacheIndex();
    cacheIndex[normalizedKey] = {
      key: normalizedKey,
      mediaSiloId: mediaSiloId?.trim() || undefined,
      localPath: normalizedLocalPath,
      syncedAt: new Date().toISOString(),
    };
    writeMediaSiloCacheIndex(cacheIndex);

    return { success: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { success: false, error: message };
  }
});

ipcMain.handle('sync-mediasilo-assets', async () => {
  try {
    const refs = collectMediaSiloAssetRefs();
    const cacheIndex = readMediaSiloCacheIndex();
    const cachedKeys = refs.filter((ref) => {
      const entry = cacheIndex[ref.key];
      return entry?.localPath && fs.existsSync(entry.localPath);
    });

    const missing = refs.filter((ref) => !cachedKeys.some((cached) => cached.key === ref.key));

    const summary: MediaSiloSyncSummary = {
      totalRefs: refs.length,
      cached: cachedKeys.length,
      missing: missing.length,
      missingKeys: missing.map((ref) => ref.key),
      message:
        refs.length === 0
          ? 'No MediaSilo assets are referenced yet.'
          : missing.length === 0
            ? 'All referenced MediaSilo assets have local cached paths.'
            : 'Some MediaSilo assets are not cached yet. Link local files or enable API sync when available.',
    };

    return { success: true, data: summary };
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
    filenamePattern: string,
    fileSizeConstraints?: Record<string, number>,
    overlayDurationOverrideSeconds?: number
  ) => {
    try {
      const selectedPresets = allPresets
        .filter((p) => selectedPresetIds.includes(p.id))
        .map((preset) => {
          if (
            typeof overlayDurationOverrideSeconds === 'number' &&
            overlayDurationOverrideSeconds > 0 &&
            preset.overlay?.enabled
          ) {
            return {
              ...preset,
              overlay: {
                ...preset.overlay,
                duration: overlayDurationOverrideSeconds,
              },
            };
          }

          return preset;
        });

      if (selectedPresets.length === 0) {
        throw new Error('No presets selected');
      }

      const overrides = readAssetOverrides();
      const resolvedPresets = await Promise.all(
        selectedPresets.map(async (preset) => {
          const resolved = resolvePresetAssetsForRender(preset, overrides);
          const enriched = await enrichPresetForRender(resolved);
          return {
            ...enriched,
            scalingMode: 'scale' as const,
          };
        })
      );

      logger.info(`Creating render plan for ${resolvedPresets.length} presets`);

      const plan = createRenderPlan(
        metadata,
        resolvedPresets,
        outputDir,
        filenamePattern,
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

    const failedResults = results.filter((result) => !result.success);
    failedResults.forEach((failedResult) => {
      const failedJob = currentPlan?.jobs.find((job) => job.id === failedResult.jobId);
      let commandSummary: string | undefined;

      if (failedJob) {
        try {
          commandSummary = buildFFmpegCommand(failedJob).fullCommand;
        } catch {
          commandSummary = undefined;
        }
      }

      logger.error('Render job failed', {
        jobId: failedResult.jobId,
        presetId: failedJob?.preset.id,
        presetName: failedJob?.preset.name,
        outputPath: failedJob?.outputPath,
        error: failedResult.error,
        command: commandSummary,
      });
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
  await shell.openPath(dirPath);
  return { success: true };
});

logger.info('Electron main process initialized');
