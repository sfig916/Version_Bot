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
      if (pr.success && pr.data) setPrependLib(pr.data as SlateAssetOption[]);
      if (ar.success && ar.data) setAppendLib(ar.data as SlateAssetOption[]);
      if (or_.success && or_.data) setOverlayLib(or_.data as OverlayAssetOption[]);
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
                        <div className="alm-asset-info">
                          <h4>{asset.name}</h4>
                          <div className="alm-asset-meta">
                            <span className={`badge ${asset.source === 'local' ? 'badge-local' : 'badge-mediasilo'}`}>
                              {asset.source === 'local' ? 'Local' : 'MediaSilo'}
                            </span>
                            <span className="meta-item">Key: <code>{asset.key}</code></span>
                            {asset.duration && <span className="meta-item">Duration: {asset.duration.toFixed(1)}s</span>}
                            {asset.path && <span className="meta-item meta-path" title={asset.path}>Path: {asset.path}</span>}
                            {asset.mediaSiloId && <span className="meta-item">ID: {asset.mediaSiloId}</span>}
                          </div>
                        </div>
                        <div className="alm-asset-actions">
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
                        <div className="alm-asset-info">
                          <h4>{asset.name}</h4>
                          <div className="alm-asset-meta">
                            <span className={`badge ${asset.source === 'local' ? 'badge-local' : 'badge-mediasilo'}`}>
                              {asset.source === 'local' ? 'Local' : 'MediaSilo'}
                            </span>
                            <span className="meta-item">Key: <code>{asset.key}</code></span>
                            {asset.duration && <span className="meta-item">Duration: {asset.duration.toFixed(1)}s</span>}
                            {asset.path && <span className="meta-item meta-path" title={asset.path}>Path: {asset.path}</span>}
                            {asset.mediaSiloId && <span className="meta-item">ID: {asset.mediaSiloId}</span>}
                          </div>
                        </div>
                        <div className="alm-asset-actions">
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
                          <div className="alm-asset-info">
                            <h4>{asset.name}</h4>
                            <div className="alm-asset-meta">
                              <span className={`badge ${asset.source === 'local' ? 'badge-local' : 'badge-mediasilo'}`}>
                                {asset.source === 'local' ? 'Local' : 'MediaSilo'}
                              </span>
                              <span className="meta-item">Key: <code>{asset.key}</code></span>
                              {asset.path && <span className="meta-item meta-path" title={asset.path}>Path: {asset.path}</span>}
                              {asset.mediaSiloId && <span className="meta-item">ID: {asset.mediaSiloId}</span>}
                            </div>
                          </div>
                          <div className="alm-asset-actions">
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
