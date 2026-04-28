/**
 * Standalone preset manager — add, edit, delete presets without a loaded video.
 */

import React, { useEffect, useState } from 'react';
import { OutputPreset } from '../../core/models/types';
import './PresetManager.css';

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

const PREPEND_LIBRARY_KEY = 'version-bot-prepend-library';
const APPEND_LIBRARY_KEY = 'version-bot-append-library';
const OVERLAY_LIBRARY_KEY = 'version-bot-overlay-library';

const RESOLUTION_OPTIONS = [
  { value: '3840x2160', label: '16:9 4K', width: 3840, height: 2160 },
  { value: '1920x1080', label: '16:9', width: 1920, height: 1080 },
  { value: '1080x1920', label: '9:16', width: 1080, height: 1920 },
  { value: '1080x1080', label: '1:1', width: 1080, height: 1080 },
  { value: '1080x1350', label: '4:5', width: 1080, height: 1350 },
] as const;

interface PresetManagerProps {
  presets: OutputPreset[];
  onUpsertPreset: (preset: OutputPreset, previousPresetId?: string) => void;
  onDeletePreset: (presetId: string) => void;
  onBack: () => void;
}

interface Draft {
  id: string;
  name: string;
  width: string;
  height: string;
  bitrate: string;
  audioBitrate: string;
  maxFileSizeMB: string;
  introEnabled: boolean;
  introLibraryId: string;
  outroEnabled: boolean;
  outroLibraryId: string;
  overlayEnabled: boolean;
  overlayLibraryId: string;
  overlayDuration: string;
}

const BLANK_DRAFT: Draft = {
  id: '',
  name: '',
  width: '1920',
  height: '1080',
  bitrate: '50',
  audioBitrate: '320',
  maxFileSizeMB: '',
  introEnabled: false,
  introLibraryId: '',
  outroEnabled: false,
  outroLibraryId: '',
  overlayEnabled: false,
  overlayLibraryId: '',
  overlayDuration: '4',
};

function getBasename(filePath?: string): string {
  if (!filePath) return '';
  const normalized = filePath.replace(/\\/g, '/');
  const last = normalized.split('/').pop() || filePath;
  const dot = last.lastIndexOf('.');
  return dot > 0 ? last.slice(0, dot) : last;
}

function toKey(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function formatAspectLabel(width: number, height: number): string {
  const ratio = width / height;
  const known = [
    { v: 16 / 9, l: '16:9' },
    { v: 9 / 16, l: '9:16' },
    { v: 1, l: '1:1' },
    { v: 4 / 5, l: '4:5' },
  ];
  return known.find((k) => Math.abs(k.v - ratio) < 0.01)?.l ?? `${width}×${height}`;
}

function formatVideoBitrateMbps(kbps: number): string {
  const mbps = kbps / 1000;
  return Number.isInteger(mbps) ? String(mbps) : mbps.toFixed(2).replace(/\.?0+$/, '');
}

function parseVideoBitrateMbps(value: string): number {
  return Math.round(Number(value) * 1000);
}

function toDurationParts(durationSeconds: number): string {
  return String(Math.max(0, durationSeconds) || 4);
}

function normalizeLibItem(item: Partial<SlateAssetOption>): SlateAssetOption {
  const name = item.name?.trim() || 'Untitled';
  const key = item.key?.trim() || toKey(name) || `asset_${Date.now()}`;
  return {
    id: item.id || `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    name,
    key,
    source: item.source === 'mediasilo' ? 'mediasilo' : 'local',
    mediaSiloId: item.mediaSiloId,
    path: item.path?.trim(),
    duration: Math.max(1, Number(item.duration) || 3),
  };
}

function normalizeOverlayItem(item: Partial<OverlayAssetOption>): OverlayAssetOption {
  const name = item.name?.trim() || 'Untitled Overlay';
  const path = item.path?.trim();
  const key = item.key?.trim() || toKey(name) || `overlay_${Date.now()}`;

  return {
    id: item.id || `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    name,
    key,
    source: item.source === 'mediasilo' ? 'mediasilo' : 'local',
    mediaSiloId: item.mediaSiloId,
    path,
  };
}

export default function PresetManager({
  presets,
  onUpsertPreset,
  onDeletePreset,
  onBack,
}: PresetManagerProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [draft, setDraft] = useState<Draft>(BLANK_DRAFT);
  const [prependLib, setPrependLib] = useState<SlateAssetOption[]>([]);
  const [appendLib, setAppendLib] = useState<SlateAssetOption[]>([]);
  const [overlayLib, setOverlayLib] = useState<OverlayAssetOption[]>([]);
  const hasMaxFileSize = Number(draft.maxFileSizeMB || 0) > 0;

  const getSlateDisplayName = (
    slate: OutputPreset['introSlate'],
    lib: SlateAssetOption[]
  ): string => {
    if (!slate?.enabled) return 'None';
    if (slate.assetRef?.key) {
      const byKey = lib.find((a) => a.key === slate.assetRef?.key);
      if (byKey) return byKey.name;
    }
    if (slate.assetPath) {
      const byPath = lib.find((a) => a.path === slate.assetPath);
      if (byPath) return byPath.name;
      return getBasename(slate.assetPath);
    }
    return slate.assetRef?.key ? slate.assetRef.key : 'Not selected';
  };

  const getOverlayDisplayName = (overlay: OutputPreset['overlay']): string => {
    if (!overlay?.enabled) return 'None';
    const duration = overlay.duration && overlay.duration > 0 ? ` (${overlay.duration}s)` : '';
    if (overlay.assetRef?.key) {
      const byKey = overlayLib.find((a) => a.key === overlay.assetRef?.key);
      if (byKey) return `${byKey.name}${duration}`;
    }
    if (overlay.assetPath) {
      const byPath = overlayLib.find((a) => a.path === overlay.assetPath);
      if (byPath) return `${byPath.name}${duration}`;
      return `${getBasename(overlay.assetPath)}${duration}`;
    }
    return overlay.assetRef?.key ? `${overlay.assetRef.key}${duration}` : 'Not selected';
  };

  useEffect(() => {
    Promise.all([
      window.versionBotAPI.getAssetLibrary(PREPEND_LIBRARY_KEY),
      window.versionBotAPI.getAssetLibrary(APPEND_LIBRARY_KEY),
      window.versionBotAPI.getAssetLibrary(OVERLAY_LIBRARY_KEY),
    ]).then(([pr, ar, or_]) => {
      if (pr.success && pr.data) setPrependLib((pr.data as Partial<SlateAssetOption>[]).map(normalizeLibItem));
      if (ar.success && ar.data) setAppendLib((ar.data as Partial<SlateAssetOption>[]).map(normalizeLibItem));
      if (or_.success && or_.data) setOverlayLib((or_.data as Partial<OverlayAssetOption>[]).map(normalizeOverlayItem));
    }).catch(() => {});
  }, []);

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) =>
    setDraft((prev) => ({ ...prev, [key]: value }));

  const handleDraftNameChange = (value: string) => {
    setDraft((prev) => ({
      ...prev,
      name: value,
      id: toKey(value),
    }));
  };

  const getResValue = (w: string, h: string) =>
    RESOLUTION_OPTIONS.find((o) => o.width === Number(w) && o.height === Number(h))?.value ??
    RESOLUTION_OPTIONS[0].value;

  const applyRes = (value: string) => {
    const opt = RESOLUTION_OPTIONS.find((o) => o.value === value);
    if (opt) setDraft((prev) => ({ ...prev, width: String(opt.width), height: String(opt.height) }));
  };


  const openNew = () => {
    setEditingId(null);
    setDraft(BLANK_DRAFT);
    setShowForm(true);
  };

  const openEdit = (preset: OutputPreset) => {
    const findSlateId = (lib: SlateAssetOption[], key?: string, path?: string) =>
      lib.find((a) => key && a.key === key)?.id ||
      lib.find((a) => path && a.path === path)?.id ||
      '';

    setEditingId(preset.id);
    setShowForm(true);
    setDraft({
      id: preset.id,
      name: preset.name,
      width: String(preset.width),
      height: String(preset.height),
      bitrate: formatVideoBitrateMbps(preset.bitrate),
      audioBitrate: String(preset.audioBitrate || 320),
      maxFileSizeMB: preset.maxFileSizeMB && preset.maxFileSizeMB > 0 ? String(preset.maxFileSizeMB) : '',
      introEnabled: !!preset.introSlate?.enabled,
      introLibraryId: findSlateId(prependLib, preset.introSlate?.assetRef?.key, preset.introSlate?.assetPath),
      outroEnabled: !!preset.outroSlate?.enabled,
      outroLibraryId: findSlateId(appendLib, preset.outroSlate?.assetRef?.key, preset.outroSlate?.assetPath),
      overlayEnabled: !!preset.overlay?.enabled,
      overlayLibraryId:
        overlayLib.find((a) => preset.overlay?.assetRef?.key && a.key === preset.overlay.assetRef.key)?.id ||
        overlayLib.find((a) => preset.overlay?.assetPath && a.path === preset.overlay.assetPath)?.id ||
        '',
      overlayDuration: toDurationParts(preset.overlay?.duration || 4),
    });
  };

  const duplicatePreset = (preset: OutputPreset) => {
    const baseName = `${preset.name} Copy`;
    let candidateName = baseName;
    let suffix = 2;

    while (presets.some((existing) => existing.id === toKey(candidateName))) {
      candidateName = `${baseName} ${suffix}`;
      suffix += 1;
    }

    const duplicatedPreset: OutputPreset = {
      ...preset,
      id: toKey(candidateName),
      name: candidateName,
      introSlate: preset.introSlate
        ? {
            ...preset.introSlate,
            assetRef: preset.introSlate.assetRef
              ? { ...preset.introSlate.assetRef }
              : undefined,
          }
        : undefined,
      outroSlate: preset.outroSlate
        ? {
            ...preset.outroSlate,
            assetRef: preset.outroSlate.assetRef
              ? { ...preset.outroSlate.assetRef }
              : undefined,
          }
        : undefined,
      overlay: preset.overlay
        ? {
            ...preset.overlay,
            assetRef: preset.overlay.assetRef
              ? { ...preset.overlay.assetRef }
              : undefined,
          }
        : undefined,
    };

    onUpsertPreset(duplicatedPreset);
  };

  const cancelEdit = () => {
    setShowForm(false);
    setEditingId(null);
    setDraft(BLANK_DRAFT);
  };

  const confirmDelete = (preset: OutputPreset) => {
    if (window.confirm(`Delete preset "${preset.name}"? This cannot be undone.`)) {
      onDeletePreset(preset.id);
    }
  };

  const savePreset = () => {
    if (!draft.name.trim()) { alert('Preset name is required'); return; }

    const generatedPresetId = toKey(draft.name);
    if (!generatedPresetId) { alert('Preset name must include letters or numbers'); return; }

    if (presets.some((p) => p.id === generatedPresetId && p.id !== editingId)) {
      alert(`Preset ID "${generatedPresetId}" already exists`); return;
    }
    const width = Number(draft.width);
    const height = Number(draft.height);
    const bitrate = parseVideoBitrateMbps(draft.bitrate);
    const audioBitrate = Number(draft.audioBitrate);
    if (!width || !height || !bitrate || !audioBitrate) {
      alert('Width, height, bitrate and audio bitrate must be positive numbers'); return;
    }
    const maxFileSizeMB = draft.maxFileSizeMB ? Number(draft.maxFileSizeMB) : 0;

    const introItem = prependLib.find((a) => a.id === draft.introLibraryId);
    const outroItem = appendLib.find((a) => a.id === draft.outroLibraryId);
    const overlayItem = overlayLib.find((a) => a.id === draft.overlayLibraryId);

    const preset: OutputPreset = {
      id: generatedPresetId,
      name: draft.name.trim(),
      width, height,
      scalingMode: 'scale',
      bitrate,
      videoCodec: 'h264',
      audioBitrate,
      audioCodec: 'aac',
      container: 'mp4',
      maxFileSizeMB,
      introSlate: draft.introEnabled ? {
        enabled: true,
        assetPath: introItem?.source === 'local' ? introItem.path : undefined,
        assetRef: introItem ? { key: introItem.key, source: introItem.source, mediaSiloId: introItem.mediaSiloId } : undefined,
      } : undefined,
      outroSlate: draft.outroEnabled ? {
        enabled: true,
        assetPath: outroItem?.source === 'local' ? outroItem.path : undefined,
        assetRef: outroItem ? { key: outroItem.key, source: outroItem.source, mediaSiloId: outroItem.mediaSiloId } : undefined,
      } : undefined,
      overlay: draft.overlayEnabled ? {
        enabled: true,
        assetPath: overlayItem?.source === 'local' ? overlayItem.path : undefined,
        assetRef: overlayItem ? { key: overlayItem.key, source: overlayItem.source, mediaSiloId: overlayItem.mediaSiloId } : undefined,
        duration: Math.max(0, parseFloat(draft.overlayDuration) || 4),
      } : undefined,
    };

    onUpsertPreset(preset, editingId || undefined);
    cancelEdit();
  };

  return (
    <div className="preset-manager">
      <div className="pm-header">
        <button className="btn btn-secondary" onClick={onBack}>← Back</button>
        <h2>Manage Presets</h2>
        <button className="btn btn-primary" onClick={openNew}>+ New Preset</button>
      </div>

      <table className="pm-table">
        <thead>
          <tr>
            <th>Preset Name</th>
            <th>Aspect Ratio</th>
            <th>Resolution</th>
            <th>Target Bitrate</th>
            <th>Max Filesize</th>
            <th>Prepend</th>
            <th>Append</th>
            <th>ESRB Overlay</th>
            <th>FPS</th>
            <th>Codec/Format</th>
            <th>Audio Specs</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {presets.length === 0 && (
            <tr><td colSpan={12} className="pm-empty">No presets yet. Create one above.</td></tr>
          )}
          {presets.slice().sort((a, b) => a.name.localeCompare(b.name)).map((p) => (
            <tr key={p.id}>
              <td><strong>{p.name}</strong><div className="pm-id">{p.id}</div></td>
              <td>{formatAspectLabel(p.width, p.height)}</td>
              <td>{p.width}×{p.height}</td>
              <td>{formatVideoBitrateMbps(p.bitrate)} Mbps</td>
              <td>{p.maxFileSizeMB && p.maxFileSizeMB > 0 ? `${p.maxFileSizeMB} MB` : 'No limit'}</td>
              <td>{getSlateDisplayName(p.introSlate, prependLib)}</td>
              <td>{getSlateDisplayName(p.outroSlate, appendLib)}</td>
              <td>{getOverlayDisplayName(p.overlay)}</td>
              <td>59.94</td>
              <td>{p.videoCodec.toUpperCase()} / {p.container.toUpperCase()}</td>
              <td>{p.audioCodec.toUpperCase()} @ {p.audioBitrate || 320} kbps</td>
              <td className="pm-actions-cell">
                <button className="btn btn-small btn-secondary" onClick={() => duplicatePreset(p)}>Duplicate</button>
                <button className="btn btn-small btn-secondary" onClick={() => openEdit(p)}>Edit</button>
                <button className="btn btn-small btn-danger" onClick={() => confirmDelete(p)}>Delete</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {showForm && (
        <div className="pm-form">
          <h3>{editingId ? 'Edit Preset' : 'New Preset'}</h3>

          <div className="pm-form-grid">
            <div className="form-group">
              <label>Preset Name</label>
              <input type="text" value={draft.name} placeholder="Social 16:9"
                onChange={(e) => handleDraftNameChange(e.target.value)} />
            </div>
            <div className="form-group">
              <label>Aspect Ratio / Resolution</label>
              <select value={getResValue(draft.width, draft.height)} onChange={(e) => applyRes(e.target.value)}>
                {RESOLUTION_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label} ({o.width}×{o.height})</option>
                ))}
              </select>
            </div>
            <div className="form-group">
              <label>Bitrate (Mbps)</label>
              <input type="text" inputMode="decimal" value={hasMaxFileSize ? 'Auto' : draft.bitrate}
                placeholder="Auto" disabled={hasMaxFileSize} readOnly={hasMaxFileSize}
                onChange={(e) => set('bitrate', e.target.value)} />
            </div>
            <div className="form-group">
              <label>Audio Bitrate (kbps)</label>
              <input type="number" min={1} value={draft.audioBitrate}
                onChange={(e) => set('audioBitrate', e.target.value)} />
            </div>
            <div className="form-group">
              <label>Max Filesize (MB, optional)</label>
              <input type="number" min={0} placeholder="0 = no limit" value={draft.maxFileSizeMB}
                onChange={(e) => set('maxFileSizeMB', e.target.value)} />
            </div>
          </div>

          <div className="pm-asset-sections">
            {/* Prepend */}
            <div className="asset-card">
              <label className="toggle-label">
                <input type="checkbox" checked={draft.introEnabled} onChange={(e) => set('introEnabled', e.target.checked)} />
                Enable Prepend
              </label>
              {draft.introEnabled && (
                prependLib.length === 0 ? (
                  <p className="help-text">No prepend assets in library. Add some in Manage Assets.</p>
                ) : (
                  <select value={draft.introLibraryId} onChange={(e) => set('introLibraryId', e.target.value)}>
                    <option value="">— Select prepend asset —</option>
                    {prependLib.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                  </select>
                )
              )}
            </div>

            {/* Append */}
            <div className="asset-card">
              <label className="toggle-label">
                <input type="checkbox" checked={draft.outroEnabled} onChange={(e) => set('outroEnabled', e.target.checked)} />
                Enable Append
              </label>
              {draft.outroEnabled && (
                appendLib.length === 0 ? (
                  <p className="help-text">No append assets in library. Add some in Manage Assets.</p>
                ) : (
                  <select value={draft.outroLibraryId} onChange={(e) => set('outroLibraryId', e.target.value)}>
                    <option value="">— Select append asset —</option>
                    {appendLib.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                  </select>
                )
              )}
            </div>

            {/* Overlay */}
            <div className="asset-card">
              <label className="toggle-label">
                <input type="checkbox" checked={draft.overlayEnabled} onChange={(e) => set('overlayEnabled', e.target.checked)} />
                Enable Overlay
              </label>
              {draft.overlayEnabled && (
                <>
                  <div className="form-group">
                    <label>Duration (seconds)</label>
                    <input
                      type="number"
                      min={0}
                      step={0.1}
                      value={draft.overlayDuration}
                      onChange={(e) => set('overlayDuration', e.target.value)}
                    />
                  </div>
                  {overlayLib.length === 0 ? (
                    <p className="help-text">No overlay assets in library. Add some in Manage Assets.</p>
                  ) : (
                    <select value={draft.overlayLibraryId} onChange={(e) => set('overlayLibraryId', e.target.value)}>
                      <option value="">— Select overlay asset —</option>
                      {overlayLib.map((asset) => (
                        <option key={asset.id} value={asset.id}>{asset.name}</option>
                      ))}
                    </select>
                  )}
                </>
              )}
            </div>
          </div>

          <div className="pm-form-actions">
            <button className="btn btn-primary" onClick={savePreset}>
              {editingId ? 'Save Changes' : 'Add Preset'}
            </button>
            <button className="btn btn-secondary" onClick={cancelEdit}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}
