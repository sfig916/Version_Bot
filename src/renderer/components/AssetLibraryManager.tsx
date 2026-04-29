/**
 * Dedicated asset library manager for prepend, append, and overlay assets
 */

import React, { useEffect, useState } from 'react';
import './AssetLibraryManager.css';

interface SlateAssetOption {
  id: string;
  name: string;
  key: string;
  source: 'local' | 'mediasilo';
  mediaSiloId?: string;
  path?: string;
  duration: number;
}

interface OverlayAssetOption {
  id: string;
  name: string;
  key: string;
  source: 'local' | 'mediasilo';
  mediaSiloId?: string;
  path?: string;
}

interface PromptDialogState {
  isOpen: boolean;
  title: string;
  label: string;
  defaultValue: string;
  onSubmit?: (value: string) => void;
  onCancel?: () => void;
}

const PREPEND_LIBRARY_KEY = 'version-bot-prepend-library';
const APPEND_LIBRARY_KEY = 'version-bot-append-library';
const OVERLAY_LIBRARY_KEY = 'version-bot-overlay-library';

interface AssetLibraryManagerProps {
  onBack: () => void;
}

function getBasename(filePath: string): string {
  const normalized = filePath.replace(/\\/g, '/');
  const filename = normalized.split('/').pop() || filePath;
  const extensionIndex = filename.lastIndexOf('.');
  return extensionIndex > 0 ? filename.slice(0, extensionIndex) : filename;
}

function toKey(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

export default function AssetLibraryManager({ onBack }: AssetLibraryManagerProps) {
  const [activeTab, setActiveTab] = useState<'prepend' | 'append' | 'overlay'>('prepend');
  const [prependLib, setPrependLib] = useState<SlateAssetOption[]>([]);
  const [appendLib, setAppendLib] = useState<SlateAssetOption[]>([]);
  const [overlayLib, setOverlayLib] = useState<OverlayAssetOption[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editKey, setEditKey] = useState('');
  const [promptDialog, setPromptDialog] = useState<PromptDialogState>({ isOpen: false, title: '', label: '', defaultValue: '' });
  const [promptInput, setPromptInput] = useState('');
  // Set of asset IDs whose file path no longer resolves on disk
  const [missingPaths, setMissingPaths] = useState<Set<string>>(new Set());

  // Custom prompt dialog helper
  const showPrompt = (title: string, label: string, defaultValue: string = ''): Promise<string | null> => {
    return new Promise((resolve) => {
      setPromptDialog({
        isOpen: true,
        title,
        label,
        defaultValue,
        onSubmit: (value: string) => {
          setPromptDialog((prev) => ({ ...prev, isOpen: false }));
          resolve(value.trim());
        },
        onCancel: () => {
          setPromptDialog((prev) => ({ ...prev, isOpen: false }));
          resolve(null);
        },
      });
      setPromptInput(defaultValue);
    });
  };

  // Load libraries on mount
  useEffect(() => {
    loadLibraries();
  }, []);

  const loadLibraries = async () => {
    try {
      // One-time migration: push any existing localStorage data to file-based storage
      const keys = [PREPEND_LIBRARY_KEY, APPEND_LIBRARY_KEY, OVERLAY_LIBRARY_KEY];
      for (const key of keys) {
        const raw = window.localStorage.getItem(key);
        if (raw) {
          try {
            const parsed = JSON.parse(raw) as unknown[];
            await window.versionBotAPI.migrateAssetLibraryFromLocalStorage(key, parsed);
          } catch { /* ignore parse errors */ }
        }
      }

      const [pr, ar, or_] = await Promise.all([
        window.versionBotAPI.getAssetLibrary(PREPEND_LIBRARY_KEY),
        window.versionBotAPI.getAssetLibrary(APPEND_LIBRARY_KEY),
        window.versionBotAPI.getAssetLibrary(OVERLAY_LIBRARY_KEY),
      ]);
      const prepend = (pr.success && pr.data ? pr.data : []) as SlateAssetOption[];
      const append = (ar.success && ar.data ? ar.data : []) as SlateAssetOption[];
      const overlay = (or_.success && or_.data ? or_.data : []) as OverlayAssetOption[];

      setPrependLib(prepend);
      setAppendLib(append);
      setOverlayLib(overlay);

      // Check which asset paths are missing on disk
      const allAssets = [
        ...prepend.map((a) => ({ id: a.id, path: a.path })),
        ...append.map((a) => ({ id: a.id, path: a.path })),
        ...overlay.map((a) => ({ id: a.id, path: a.path })),
      ];
      const missing = new Set<string>();
      await Promise.all(
        allAssets
          .filter((a) => a.path) // only local-pathed assets
          .map(async (a) => {
            const result = await window.versionBotAPI.checkFileExists(a.path!);
            if (result.success && result.data === false) {
              missing.add(a.id);
            }
          })
      );
      setMissingPaths(missing);
    } catch (error) {
      console.warn('Failed to load asset libraries', error);
    }
  };

  const persistPrepend = (next: SlateAssetOption[]) => {
    setPrependLib(next);
    window.versionBotAPI.saveAssetLibrary(PREPEND_LIBRARY_KEY, next);
  };

  const persistAppend = (next: SlateAssetOption[]) => {
    setAppendLib(next);
    window.versionBotAPI.saveAssetLibrary(APPEND_LIBRARY_KEY, next);
  };

  const persistOverlay = (next: OverlayAssetOption[]) => {
    setOverlayLib(next);
    window.versionBotAPI.saveAssetLibrary(OVERLAY_LIBRARY_KEY, next);
  };

  const getDirectoryPath = (filePath: string): string => {
    const normalized = filePath.replace(/\\/g, '/');
    const index = normalized.lastIndexOf('/');
    return index >= 0 ? normalized.slice(0, index) : '';
  };

  const toOsPath = (filePath: string): string => filePath.replace(/\//g, '\\');

  const normalizePathForCompare = (filePath: string): string =>
    filePath.replace(/\\/g, '/').toLowerCase();

  type RelinkableAsset = {
    id: string;
    key: string;
    path?: string;
  };

  const getAllRelinkableAssets = (): RelinkableAsset[] => [
    ...prependLib.map((a) => ({ id: a.id, key: a.key, path: a.path })),
    ...appendLib.map((a) => ({ id: a.id, key: a.key, path: a.path })),
    ...overlayLib.map((a) => ({ id: a.id, key: a.key, path: a.path })),
  ];

  const relinkAsset = async (id: string, kind: 'video' | 'image' | 'any') => {
    const selected = await window.versionBotAPI.selectAssetFile(kind);
    if (!selected) return;

    const allAssets = getAllRelinkableAssets();
    const targetAsset = allAssets.find((asset) => asset.id === id);
    const oldPath = targetAsset?.path;
    const pathUpdatesById = new Map<string, string>([[id, selected]]);

    let nextPrepend = prependLib;
    let nextAppend = appendLib;
    let nextOverlay = overlayLib;

    const applyPathUpdate = (assetId: string, nextPath: string) => {
      if (nextPrepend.some((a) => a.id === assetId)) {
        nextPrepend = nextPrepend.map((a) => (a.id === assetId ? { ...a, path: nextPath } : a));
      }
      if (nextAppend.some((a) => a.id === assetId)) {
        nextAppend = nextAppend.map((a) => (a.id === assetId ? { ...a, path: nextPath } : a));
      }
      if (nextOverlay.some((a) => a.id === assetId)) {
        nextOverlay = nextOverlay.map((a) => (a.id === assetId ? { ...a, path: nextPath } : a));
      }
    };

    // Always update the single selected asset first.
    applyPathUpdate(id, selected);

    let autoRelinkCount = 0;
    const autoRelinkedIds = new Set<string>();

    if (oldPath) {
      const oldDir = getDirectoryPath(oldPath);
      const newDir = getDirectoryPath(selected);

      const canAttemptBulkRelink = oldDir.length > 0
        && newDir.length > 0
        && normalizePathForCompare(oldDir) !== normalizePathForCompare(newDir);

      if (canAttemptBulkRelink) {
        const updates = await Promise.all(
          allAssets
            .filter((asset) => asset.id !== id && asset.path && missingPaths.has(asset.id))
            .map(async (asset) => {
              const assetPath = asset.path!;
              const normalizedAssetPath = assetPath.replace(/\\/g, '/');
              const normalizedOldDir = oldDir.replace(/\\/g, '/');

              if (!normalizePathForCompare(normalizedAssetPath).startsWith(`${normalizePathForCompare(normalizedOldDir)}/`)) {
                return null;
              }

              const relativeSuffix = normalizedAssetPath.slice(normalizedOldDir.length + 1);

              if (!relativeSuffix) {
                return null;
              }

              const normalizedNewDir = newDir.replace(/\\/g, '/');
              const candidatePath = toOsPath(`${normalizedNewDir}/${relativeSuffix}`);
              const exists = await window.versionBotAPI.checkFileExists(candidatePath);
              if (!exists.success || exists.data !== true) {
                return null;
              }

              return { id: asset.id, path: candidatePath };
            })
        );

        for (const update of updates) {
          if (!update) continue;
          applyPathUpdate(update.id, update.path);
          pathUpdatesById.set(update.id, update.path);
          autoRelinkCount += 1;
          autoRelinkedIds.add(update.id);
        }
      }
    }

    const prependChanged = nextPrepend !== prependLib;
    const appendChanged = nextAppend !== appendLib;
    const overlayChanged = nextOverlay !== overlayLib;

    if (prependChanged) {
      persistPrepend(nextPrepend);
    }
    if (appendChanged) {
      persistAppend(nextAppend);
    }
    if (overlayChanged) {
      persistOverlay(nextOverlay);
    }

    // Persist path updates as asset overrides so stale preset assetPath values can
    // still resolve through the updated key mapping.
    const assetById = new Map(allAssets.map((asset) => [asset.id, asset] as const));
    await Promise.all(
      Array.from(pathUpdatesById.entries()).map(async ([assetId, updatedPath]) => {
        const asset = assetById.get(assetId);
        if (!asset?.key) return;
        await window.versionBotAPI.setAssetOverride(asset.key, updatedPath);
      })
    );

    // Clear missing state for re-linked assets.
    setMissingPaths((prev) => {
      const next = new Set(prev);
      next.delete(id);
      for (const autoId of autoRelinkedIds) {
        next.delete(autoId);
      }
      return next;
    });

    if (autoRelinkCount > 0) {
      alert(`Re-linked selected file and ${autoRelinkCount} additional missing asset path${autoRelinkCount === 1 ? '' : 's'} from the moved folder.`);
    }
  };

  const detectDuration = async (path: string): Promise<number> => {
    try {
      const r = await window.versionBotAPI.probeVideo(path);
      if (r.success && r.data?.duration) return Math.max(1, r.data.duration);
    } catch {
      /* fall through */
    }
    return 3;
  };

  const createSlateAssetFromPath = async (path: string): Promise<SlateAssetOption> => {
    const name = getBasename(path);
    const key = toKey(name);
    const duration = await detectDuration(path);

    return {
      id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      name,
      key,
      source: 'local',
      path,
      duration,
    };
  };

  const createOverlayAssetFromPath = (path: string): OverlayAssetOption => {
    const name = getBasename(path);
    const key = toKey(name);

    return {
      id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      name,
      key,
      source: 'local',
      path,
    };
  };

  const addSlateAsset = async (type: 'prepend' | 'append') => {
    try {
      console.log(`[AssetLibraryManager] addSlateAsset starting for type: ${type}`);

      const paths = await window.versionBotAPI.selectAssetFiles('video');
      console.log('[AssetLibraryManager] selectAssetFiles returned:', paths);

      if (!paths.length) {
        console.log('[AssetLibraryManager] No file selected, canceling');
        return;
      }

      const items = await Promise.all(paths.map((path) => createSlateAssetFromPath(path)));
      console.log('[AssetLibraryManager] Created asset items:', items);

      if (type === 'prepend') {
        const updated = [...prependLib, ...items];
        persistPrepend(updated);
        console.log(`[AssetLibraryManager] Prepend library updated, now has ${updated.length} items`);
      } else {
        const updated = [...appendLib, ...items];
        persistAppend(updated);
        console.log(`[AssetLibraryManager] Append library updated, now has ${updated.length} items`);
      }

      const count = items.length;
      alert(`✓ Added ${count} ${type} asset${count === 1 ? '' : 's'} successfully.`);
    } catch (error) {
      console.error('[AssetLibraryManager] Error adding slate asset:', error);
      alert(`Error adding asset: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const addMediaSiloAsset = async (type: 'prepend' | 'append') => {
    try {
      const name = await showPrompt('MediaSilo Asset Name', 'Enter the name of the MediaSilo asset:');
      if (!name) return;

      // Auto-generate key from name
      const key = toKey(name);

      const mediaSiloId = await showPrompt('MediaSilo Asset ID', 'Enter the MediaSilo asset ID (optional):', '');

      const item: SlateAssetOption = {
        id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
        name,
        key,
        source: 'mediasilo',
        mediaSiloId: mediaSiloId || undefined,
        duration: 3,
      };

      if (type === 'prepend') {
        persistPrepend([...prependLib, item]);
      } else {
        persistAppend([...appendLib, item]);
      }

      alert(`✓ MediaSilo asset "${name}" added successfully!`);
    } catch (error) {
      console.error('[AssetLibraryManager] Error adding mediasilo asset:', error);
      alert(`Error adding asset: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const addOverlayAsset = async () => {
    try {
      console.log('[AssetLibraryManager] addOverlayAsset starting');

      const paths = await window.versionBotAPI.selectAssetFiles('image');
      console.log('[AssetLibraryManager] selectAssetFiles returned:', paths);

      if (!paths.length) {
        console.log('[AssetLibraryManager] No file selected, canceling');
        return;
      }

      const items = paths.map((path) => createOverlayAssetFromPath(path));
      console.log('[AssetLibraryManager] Created overlay items:', items);
      const updated = [...overlayLib, ...items];
      persistOverlay(updated);
      console.log(`[AssetLibraryManager] Overlay library updated, now has ${updated.length} items`);

      const count = items.length;
      alert(`✓ Added ${count} overlay asset${count === 1 ? '' : 's'} successfully.`);
    } catch (error) {
      console.error('[AssetLibraryManager] Error adding overlay asset:', error);
      alert(`Error adding overlay: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const addMediaSiloOverlay = async () => {
    try {
      const name = await showPrompt('Overlay Name', 'Enter the name of the MediaSilo overlay:', 'Overlay');
      if (!name) return;

      const key = toKey(name);

      const mediaSiloId = await showPrompt('MediaSilo Asset ID', 'Enter the MediaSilo asset ID (optional):', '');

      const item: OverlayAssetOption = {
        id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
        name,
        key,
        source: 'mediasilo',
        mediaSiloId: mediaSiloId || undefined,
      };

      persistOverlay([...overlayLib, item]);
      alert(`✓ MediaSilo overlay "${name}" added successfully!`);
    } catch (error) {
      console.error('[AssetLibraryManager] Error adding mediasilo overlay:', error);
      alert(`Error adding overlay: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const linkMediaSiloAssetPath = async (
    key: string,
    mediaSiloId?: string,
    kind: 'video' | 'image' | 'any' = 'any'
  ) => {
    try {
      const selected = await window.versionBotAPI.selectAssetFile(kind);
      if (!selected) {
        return;
      }

      const result = await window.versionBotAPI.setMediaSiloCachedAssetPath(
        key,
        mediaSiloId || null,
        selected
      );
      if (!result.success) {
        alert(result.error || 'Failed to link MediaSilo asset path');
        return;
      }

      alert(`Linked MediaSilo asset key "${key}" to local file:\n${selected}`);
    } catch (error) {
      console.error('[AssetLibraryManager] Error linking mediasilo path:', error);
      alert(`Error linking MediaSilo path: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const deleteSlateAsset = (type: 'prepend' | 'append', id: string) => {
    if (!window.confirm('Delete this asset? This cannot be undone.')) return;
    if (type === 'prepend') {
      persistPrepend(prependLib.filter((a) => a.id !== id));
    } else {
      persistAppend(appendLib.filter((a) => a.id !== id));
    }
  };

  const deleteOverlayAsset = (id: string) => {
    if (!window.confirm('Delete this asset? This cannot be undone.')) return;
    persistOverlay(overlayLib.filter((a) => a.id !== id));
  };

  const startEditSlate = (type: 'prepend' | 'append', asset: SlateAssetOption) => {
    setEditingId(asset.id);
    setEditName(asset.name);
    setEditKey(asset.key);
  };

  const handleEditNameChange = (newName: string) => {
    setEditName(newName);
    // Auto-generate key from name
    setEditKey(toKey(newName));
  };

  const startEditOverlay = (asset: OverlayAssetOption) => {
    setEditingId(asset.id);
    setEditName(asset.name);
    setEditKey(asset.key);
  };

  const saveEditSlate = (type: 'prepend' | 'append') => {
    const lib = type === 'prepend' ? prependLib : appendLib;
    const updated = lib.map((a) =>
      a.id === editingId ? { ...a, name: editName, key: editKey } : a
    );
    if (type === 'prepend') {
      persistPrepend(updated);
    } else {
      persistAppend(updated);
    }
    setEditingId(null);
    setEditName('');
    setEditKey('');
  };

  const saveEditOverlay = () => {
    const updated = overlayLib.map((a) =>
      a.id === editingId ? { ...a, name: editName, key: editKey } : a
    );
    persistOverlay(updated);
    setEditingId(null);
    setEditName('');
    setEditKey('');
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditName('');
    setEditKey('');
  };

  return (
    <div className="alm-container">
      <div className="alm-header">
        <button className="btn btn-secondary" onClick={onBack}>← Back</button>
        <h2>Asset Library Manager</h2>
      </div>

      <div className="alm-tabs">
        <button
          className={`alm-tab ${activeTab === 'prepend' ? 'active' : ''}`}
          onClick={() => setActiveTab('prepend')}
        >
          Prepend ({prependLib.length})
        </button>
        <button
          className={`alm-tab ${activeTab === 'append' ? 'active' : ''}`}
          onClick={() => setActiveTab('append')}
        >
          Append ({appendLib.length})
        </button>
        <button
          className={`alm-tab ${activeTab === 'overlay' ? 'active' : ''}`}
          onClick={() => setActiveTab('overlay')}
        >
          Overlay ({overlayLib.length})
        </button>
      </div>

      <div className="alm-content">
        {activeTab === 'prepend' && (
          <div className="alm-library-section">
            <div className="alm-toolbar">
              <h3>Prepend Assets</h3>
              <div className="alm-actions">
                <button className="btn btn-small btn-secondary" onClick={() => addSlateAsset('prepend')}>
                  Add Local File
                </button>
                <button className="btn btn-small btn-secondary" onClick={() => addMediaSiloAsset('prepend')}>
                  Add MediaSilo
                </button>
              </div>
            </div>

            {prependLib.length === 0 ? (
              <div className="alm-empty">No prepend assets yet. Add one to get started.</div>
            ) : (
              <div className="alm-assets">
                {prependLib.map((asset) => (
                  <div key={asset.id} className="alm-asset-card">
                    {editingId === asset.id ? (
                      <div className="alm-edit-form">
                        <div className="form-group">
                          <label>Name</label>
                          <input
                            type="text"
                            value={editName}
                            onChange={(e) => handleEditNameChange(e.target.value)}
                          />
                        </div>
                        <div className="form-group">
                          <label>Key <span className="help-text">(auto-generated from name)</span></label>
                          <input
                            type="text"
                            value={editKey}
                            disabled
                          />
                        </div>
                        <div className="alm-edit-actions">
                          <button
                            className="btn btn-small btn-primary"
                            onClick={() => saveEditSlate('prepend')}
                          >
                            Save
                          </button>
                          <button
                            className="btn btn-small btn-secondary"
                            onClick={cancelEdit}
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <div className={`alm-asset-info${missingPaths.has(asset.id) ? ' alm-asset-missing' : ''}`}>
                          <div className="alm-asset-title-row">
                            <h4>{asset.name}</h4>
                            {missingPaths.has(asset.id) && (
                              <span className="badge badge-missing" title="File not found at stored path">⚠ File Missing</span>
                            )}
                          </div>
                          <div className="alm-asset-meta">
                            <span className={`badge ${asset.source === 'local' ? 'badge-local' : 'badge-mediasilo'}`}>
                              {asset.source === 'local' ? 'Local' : 'MediaSilo'}
                            </span>
                            <span className="meta-item">Key: <code>{asset.key}</code></span>
                            {asset.duration && <span className="meta-item">Duration: {asset.duration.toFixed(1)}s</span>}
                            {asset.path && <span className={`meta-item meta-path${missingPaths.has(asset.id) ? ' meta-path-missing' : ''}`} title={asset.path}>Path: {asset.path}</span>}
                            {asset.mediaSiloId && <span className="meta-item">ID: {asset.mediaSiloId}</span>}
                          </div>
                        </div>
                        <div className="alm-asset-actions">
                          {missingPaths.has(asset.id) && (
                            <button
                              className="btn btn-small btn-relink"
                              onClick={() => relinkAsset(asset.id, 'video')}
                            >
                              Re-link File
                            </button>
                          )}
                          {asset.source === 'mediasilo' && (
                            <button
                              className="btn btn-small btn-primary"
                              onClick={() => linkMediaSiloAssetPath(asset.key, asset.mediaSiloId, 'video')}
                            >
                              Link Cache File
                            </button>
                          )}
                          <button
                            className="btn btn-small btn-secondary"
                            onClick={() => startEditSlate('prepend', asset)}
                          >
                            Edit
                          </button>
                          <button
                            className="btn btn-small btn-danger"
                            onClick={() => deleteSlateAsset('prepend', asset.id)}
                          >
                            Delete
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {activeTab === 'append' && (
          <div className="alm-library-section">
            <div className="alm-toolbar">
              <h3>Append Assets</h3>
              <div className="alm-actions">
                <button className="btn btn-small btn-secondary" onClick={() => addSlateAsset('append')}>
                  Add Local File
                </button>
                <button className="btn btn-small btn-secondary" onClick={() => addMediaSiloAsset('append')}>
                  Add MediaSilo
                </button>
              </div>
            </div>

            {appendLib.length === 0 ? (
              <div className="alm-empty">No append assets yet. Add one to get started.</div>
            ) : (
              <div className="alm-assets">
                {appendLib.map((asset) => (
                  <div key={asset.id} className="alm-asset-card">
                    {editingId === asset.id ? (
                      <div className="alm-edit-form">
                        <div className="form-group">
                          <label>Name</label>
                          <input
                            type="text"
                            value={editName}
                            onChange={(e) => handleEditNameChange(e.target.value)}
                          />
                        </div>
                        <div className="form-group">
                          <label>Key <span className="help-text">(auto-generated from name)</span></label>
                          <input
                            type="text"
                            value={editKey}
                            disabled
                          />
                        </div>
                        <div className="alm-edit-actions">
                          <button
                            className="btn btn-small btn-primary"
                            onClick={() => saveEditSlate('append')}
                          >
                            Save
                          </button>
                          <button
                            className="btn btn-small btn-secondary"
                            onClick={cancelEdit}
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <div className={`alm-asset-info${missingPaths.has(asset.id) ? ' alm-asset-missing' : ''}`}>
                          <div className="alm-asset-title-row">
                            <h4>{asset.name}</h4>
                            {missingPaths.has(asset.id) && (
                              <span className="badge badge-missing" title="File not found at stored path">⚠ File Missing</span>
                            )}
                          </div>
                          <div className="alm-asset-meta">
                            <span className={`badge ${asset.source === 'local' ? 'badge-local' : 'badge-mediasilo'}`}>
                              {asset.source === 'local' ? 'Local' : 'MediaSilo'}
                            </span>
                            <span className="meta-item">Key: <code>{asset.key}</code></span>
                            {asset.duration && <span className="meta-item">Duration: {asset.duration.toFixed(1)}s</span>}
                            {asset.path && <span className={`meta-item meta-path${missingPaths.has(asset.id) ? ' meta-path-missing' : ''}`} title={asset.path}>Path: {asset.path}</span>}
                            {asset.mediaSiloId && <span className="meta-item">ID: {asset.mediaSiloId}</span>}
                          </div>
                        </div>
                        <div className="alm-asset-actions">
                          {missingPaths.has(asset.id) && (
                            <button
                              className="btn btn-small btn-relink"
                              onClick={() => relinkAsset(asset.id, 'video')}
                            >
                              Re-link File
                            </button>
                          )}
                          {asset.source === 'mediasilo' && (
                            <button
                              className="btn btn-small btn-primary"
                              onClick={() => linkMediaSiloAssetPath(asset.key, asset.mediaSiloId, 'video')}
                            >
                              Link Cache File
                            </button>
                          )}
                          <button
                            className="btn btn-small btn-secondary"
                            onClick={() => startEditSlate('append', asset)}
                          >
                            Edit
                          </button>
                          <button
                            className="btn btn-small btn-danger"
                            onClick={() => deleteSlateAsset('append', asset.id)}
                          >
                            Delete
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {activeTab === 'overlay' && (
          <div className="alm-library-section">
            <div className="alm-toolbar">
              <h3>Overlay Assets</h3>
              <div className="alm-actions">
                <button className="btn btn-small btn-secondary" onClick={() => addOverlayAsset()}>
                  Add Local File
                </button>
                <button className="btn btn-small btn-secondary" onClick={() => addMediaSiloOverlay()}>
                  Add MediaSilo
                </button>
              </div>
            </div>

            {overlayLib.length === 0 ? (
              <div className="alm-empty">No overlay assets yet. Add one to get started.</div>
            ) : (
              <div className="alm-assets">
                {overlayLib.map((asset) => (
                    <div key={asset.id} className="alm-asset-card">
                      {editingId === asset.id ? (
                        <div className="alm-edit-form">
                          <div className="form-group">
                            <label>Name</label>
                            <input
                              type="text"
                              value={editName}
                              onChange={(e) => handleEditNameChange(e.target.value)}
                            />
                          </div>
                          <div className="form-group">
                            <label>Key <span className="help-text">(auto-generated from name)</span></label>
                            <input
                              type="text"
                              value={editKey}
                              disabled
                            />
                          </div>
                          <div className="alm-edit-actions">
                            <button
                              className="btn btn-small btn-primary"
                              onClick={saveEditOverlay}
                            >
                              Save
                            </button>
                            <button
                              className="btn btn-small btn-secondary"
                              onClick={cancelEdit}
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      ) : (
                        <>
                          <div className={`alm-asset-info${missingPaths.has(asset.id) ? ' alm-asset-missing' : ''}`}>
                            <div className="alm-asset-title-row">
                              <h4>{asset.name}</h4>
                              {missingPaths.has(asset.id) && (
                                <span className="badge badge-missing" title="File not found at stored path">⚠ File Missing</span>
                              )}
                            </div>
                            <div className="alm-asset-meta">
                              <span className={`badge ${asset.source === 'local' ? 'badge-local' : 'badge-mediasilo'}`}>
                                {asset.source === 'local' ? 'Local' : 'MediaSilo'}
                              </span>
                              <span className="meta-item">Key: <code>{asset.key}</code></span>
                              {asset.path && <span className={`meta-item meta-path${missingPaths.has(asset.id) ? ' meta-path-missing' : ''}`} title={asset.path}>Path: {asset.path}</span>}
                              {asset.mediaSiloId && <span className="meta-item">ID: {asset.mediaSiloId}</span>}
                            </div>
                          </div>
                          <div className="alm-asset-actions">
                            {missingPaths.has(asset.id) && (
                              <button
                                className="btn btn-small btn-relink"
                                onClick={() => relinkAsset(asset.id, 'image')}
                              >
                                Re-link File
                              </button>
                            )}
                            {asset.source === 'mediasilo' && (
                              <button
                                className="btn btn-small btn-primary"
                                onClick={() => linkMediaSiloAssetPath(asset.key, asset.mediaSiloId, 'image')}
                              >
                                Link Cache File
                              </button>
                            )}
                            <button
                              className="btn btn-small btn-secondary"
                              onClick={() => startEditOverlay(asset)}
                            >
                              Edit
                            </button>
                            <button
                              className="btn btn-small btn-danger"
                              onClick={() => deleteOverlayAsset(asset.id)}
                            >
                              Delete
                            </button>
                          </div>
                        </>
                      )}
                    </div>
                  ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Custom Prompt Dialog */}
      {promptDialog.isOpen && (
        <div className="prompt-dialog-overlay">
          <div className="prompt-dialog">
            <div className="prompt-header">
              <h3>{promptDialog.title}</h3>
            </div>
            <div className="prompt-body">
              <label>{promptDialog.label}</label>
              <input
                type="text"
                value={promptInput}
                onChange={(e) => setPromptInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    promptDialog.onSubmit?.(promptInput);
                  } else if (e.key === 'Escape') {
                    promptDialog.onCancel?.();
                  }
                }}
                autoFocus
              />
            </div>
            <div className="prompt-actions">
              <button
                className="btn btn-small btn-primary"
                onClick={() => promptDialog.onSubmit?.(promptInput)}
              >
                OK
              </button>
              <button
                className="btn btn-small btn-secondary"
                onClick={() => promptDialog.onCancel?.()}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
