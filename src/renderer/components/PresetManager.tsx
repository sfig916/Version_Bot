/**
 * Standalone preset manager — add, edit, delete presets without a loaded video.
 */

import React, { useEffect, useState } from 'react';
import { OutputPreset, AssetReference } from '../../core/models/types';
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
  position: 'tl' | 'tr' | 'bl' | 'br';
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
  introAssetKey: string;
  introAssetSource: 'local' | 'mediasilo';
  introMediaSiloId: string;
  introPath: string;
  outroEnabled: boolean;
  outroAssetKey: string;
  outroAssetSource: 'local' | 'mediasilo';
  outroMediaSiloId: string;
  outroPath: string;
  overlayEnabled: boolean;
  overlayAssetKey: string;
  overlayAssetSource: 'local' | 'mediasilo';
  overlayMediaSiloId: string;
  overlayPath: string;
  overlayPosition: 'tl' | 'tr' | 'bl' | 'br';
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
  introAssetKey: '',
  introAssetSource: 'local',
  introMediaSiloId: '',
  introPath: '',
  outroEnabled: false,
  outroAssetKey: '',
  outroAssetSource: 'local',
  outroMediaSiloId: '',
  outroPath: '',
  overlayEnabled: false,
  overlayAssetKey: '',
  overlayAssetSource: 'local',
  overlayMediaSiloId: '',
  overlayPath: '',
  overlayPosition: 'br',
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
  const position = item.position || 'br';

  return {
    id: item.id || `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    name,
    key,
    position,
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
  const [overrides, setOverrides] = useState<Record<string, string>>({});
  const hasMaxFileSize = Number(draft.maxFileSizeMB || 0) > 0;

  useEffect(() => {
    try {
      const pr = window.localStorage.getItem(PREPEND_LIBRARY_KEY);
      const ar = window.localStorage.getItem(APPEND_LIBRARY_KEY);
      const or = window.localStorage.getItem(OVERLAY_LIBRARY_KEY);
      if (pr) setPrependLib((JSON.parse(pr) as Partial<SlateAssetOption>[]).map(normalizeLibItem));
      if (ar) setAppendLib((JSON.parse(ar) as Partial<SlateAssetOption>[]).map(normalizeLibItem));
      if (or) setOverlayLib((JSON.parse(or) as Partial<OverlayAssetOption>[]).map(normalizeOverlayItem));
    } catch { /* ignore */ }

    window.versionBotAPI.getAssetOverrides().then((r) => {
      if (r.success && r.data) setOverrides(r.data);
    }).catch(() => {});
  }, []);

  const persistPrepend = (next: SlateAssetOption[]) => {
    setPrependLib(next);
    window.localStorage.setItem(PREPEND_LIBRARY_KEY, JSON.stringify(next));
  };

  const persistAppend = (next: SlateAssetOption[]) => {
    setAppendLib(next);
    window.localStorage.setItem(APPEND_LIBRARY_KEY, JSON.stringify(next));
  };

  const persistOverlay = (next: OverlayAssetOption[]) => {
    setOverlayLib(next);
    window.localStorage.setItem(OVERLAY_LIBRARY_KEY, JSON.stringify(next));
  };

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

  const detectDuration = async (path: string) => {
    try {
      const r = await window.versionBotAPI.probeVideo(path);
      if (r.success && r.data?.duration) return Math.max(1, r.data.duration);
    } catch { /* fall through */ }
    return 3;
  };

  const addFileToLib = async (type: 'intro' | 'outro') => {
    const path = await window.versionBotAPI.selectAssetFile('video');
    if (!path) return;
    const defaultName = getBasename(path);
    const name = window.prompt('Asset name', defaultName)?.trim() || defaultName;
    const key = window.prompt('Shared asset key', toKey(name))?.trim() || toKey(name);
    const duration = await detectDuration(path);
    const item: SlateAssetOption = {
      id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      name, key, source: 'local', path, duration,
    };
    if (type === 'intro') {
      persistPrepend([...prependLib, item]);
      setDraft((p) => ({ ...p, introEnabled: true, introAssetKey: key, introAssetSource: 'local', introMediaSiloId: '', introPath: path }));
    } else {
      persistAppend([...appendLib, item]);
      setDraft((p) => ({ ...p, outroEnabled: true, outroAssetKey: key, outroAssetSource: 'local', outroMediaSiloId: '', outroPath: path }));
    }
  };

  const addMediaSiloToLib = (type: 'intro' | 'outro') => {
    const name = window.prompt('MediaSilo asset name')?.trim();
    if (!name) return;
    const key = window.prompt('Shared asset key', toKey(name))?.trim() || toKey(name);
    const mediaSiloId = window.prompt('MediaSilo asset ID (optional)')?.trim() || '';
    const item: SlateAssetOption = {
      id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      name, key, source: 'mediasilo', mediaSiloId, duration: 3,
    };
    if (type === 'intro') {
      persistPrepend([...prependLib, item]);
      setDraft((p) => ({ ...p, introEnabled: true, introAssetKey: key, introAssetSource: 'mediasilo', introMediaSiloId: mediaSiloId, introPath: '' }));
    } else {
      persistAppend([...appendLib, item]);
      setDraft((p) => ({ ...p, outroEnabled: true, outroAssetKey: key, outroAssetSource: 'mediasilo', outroMediaSiloId: mediaSiloId, outroPath: '' }));
    }
  };

  const selectFromLib = (type: 'intro' | 'outro', assetId: string) => {
    const lib = type === 'intro' ? prependLib : appendLib;
    const a = lib.find((x) => x.id === assetId);
    if (!a) return;
    if (type === 'intro') {
      setDraft((p) => ({ ...p, introEnabled: true, introAssetKey: a.key, introAssetSource: a.source, introMediaSiloId: a.mediaSiloId || '', introPath: a.path || '' }));
    } else {
      setDraft((p) => ({ ...p, outroEnabled: true, outroAssetKey: a.key, outroAssetSource: a.source, outroMediaSiloId: a.mediaSiloId || '', outroPath: a.path || '' }));
    }
  };

  const setLocalOverride = async (type: 'intro' | 'outro' | 'overlay') => {
    let key = '';
    if (type === 'intro') {
      key = draft.introAssetKey.trim();
    } else if (type === 'outro') {
      key = draft.outroAssetKey.trim();
    } else {
      key = draft.overlayAssetKey.trim();
    }
    if (!key) { alert('Set a shared asset key first'); return; }
    
    const fileType = type === 'overlay' ? 'image' : 'video';
    const path = await window.versionBotAPI.selectAssetFile(fileType);
    if (!path) return;
    
    const result = await window.versionBotAPI.setAssetOverride(key, path);
    if (result.success && result.data) setOverrides(result.data);
    
    if (type === 'intro') setDraft((p) => ({ ...p, introPath: path }));
    else if (type === 'outro') setDraft((p) => ({ ...p, outroPath: path }));
    else setDraft((p) => ({ ...p, overlayPath: path }));
  };

  const addOverlayToLibrary = async (position: 'tl' | 'tr' | 'bl' | 'br') => {
    const selectedPath = await window.versionBotAPI.selectAssetFile('image');
    if (!selectedPath) return;

    const positionName = {
      tl: 'Top Left',
      tr: 'Top Right',
      bl: 'Bottom Left',
      br: 'Bottom Right',
    }[position];

    const suggestedName = `ESRB - ${positionName}`;
    const chosenName = window.prompt('Overlay name', suggestedName)?.trim() || suggestedName;
    const suggestedKey = toKey(chosenName) || toKey(positionName);
    const chosenKey = window.prompt('Shared asset key', suggestedKey)?.trim() || suggestedKey;

    const item: OverlayAssetOption = {
      id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      name: chosenName,
      key: chosenKey,
      position,
      source: 'local',
      path: selectedPath,
    };

    const next = [...overlayLib, item];
    persistOverlay(next);
    setDraft((p) => ({
      ...p,
      overlayEnabled: true,
      overlayAssetKey: item.key,
      overlayAssetSource: item.source,
      overlayMediaSiloId: '',
      overlayPath: item.path,
      overlayPosition: item.position,
    }));
  };

  const addMediaSiloOverlayToLibrary = (position: 'tl' | 'tr' | 'bl' | 'br') => {
    const positionName = {
      tl: 'Top Left',
      tr: 'Top Right',
      bl: 'Bottom Left',
      br: 'Bottom Right',
    }[position];

    const chosenName = window.prompt('Overlay name')?.trim() || `ESRB - ${positionName}`;
    const suggestedKey = toKey(chosenName);
    const chosenKey = window.prompt('Shared asset key', suggestedKey)?.trim() || suggestedKey;
    const mediaSiloId = window.prompt('MediaSilo asset ID (optional)')?.trim() || '';

    const item: OverlayAssetOption = {
      id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      name: chosenName,
      key: chosenKey,
      position,
      source: 'mediasilo',
      mediaSiloId,
    };

    const next = [...overlayLib, item];
    persistOverlay(next);
    setDraft((p) => ({
      ...p,
      overlayEnabled: true,
      overlayAssetKey: item.key,
      overlayAssetSource: item.source,
      overlayMediaSiloId: item.mediaSiloId || '',
      overlayPath: '',
      overlayPosition: item.position,
    }));
  };

  const selectOverlayFromLibrary = (overlayId: string) => {
    const selectedOverlay = overlayLib.find((item) => item.id === overlayId);
    if (!selectedOverlay) return;

    setDraft((p) => ({
      ...p,
      overlayEnabled: true,
      overlayAssetKey: selectedOverlay.key,
      overlayAssetSource: selectedOverlay.source,
      overlayMediaSiloId: selectedOverlay.mediaSiloId || '',
      overlayPath: selectedOverlay.path || '',
      overlayPosition: selectedOverlay.position,
    }));
  };

  const makeAssetRef = (key: string, source: 'local' | 'mediasilo', mediaSiloId?: string): AssetReference | undefined => {
    const k = key.trim();
    if (!k) return undefined;
    return { key: k, source, mediaSiloId: mediaSiloId?.trim() || undefined };
  };

  const openNew = () => {
    setEditingId(null);
    setDraft(BLANK_DRAFT);
    setShowForm(true);
  };

  const openEdit = (preset: OutputPreset) => {
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
      introAssetKey: preset.introSlate?.assetRef?.key || toKey(getBasename(preset.introSlate?.assetPath)) || '',
      introAssetSource: preset.introSlate?.assetRef?.source || 'local',
      introMediaSiloId: preset.introSlate?.assetRef?.mediaSiloId || '',
      introPath: preset.introSlate?.assetPath || '',
      outroEnabled: !!preset.outroSlate?.enabled,
      outroAssetKey: preset.outroSlate?.assetRef?.key || toKey(getBasename(preset.outroSlate?.assetPath)) || '',
      outroAssetSource: preset.outroSlate?.assetRef?.source || 'local',
      outroMediaSiloId: preset.outroSlate?.assetRef?.mediaSiloId || '',
      outroPath: preset.outroSlate?.assetPath || '',
      overlayEnabled: !!preset.overlay?.enabled,
      overlayAssetKey: preset.overlay?.assetRef?.key || toKey(getBasename(preset.overlay?.assetPath)) || '',
      overlayAssetSource: preset.overlay?.assetRef?.source || 'local',
      overlayMediaSiloId: preset.overlay?.assetRef?.mediaSiloId || '',
      overlayPath: preset.overlay?.assetPath || '',
      overlayPosition: preset.overlay?.position || 'br',
      overlayDuration: String(preset.overlay?.duration || 4),
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
        assetPath: draft.introAssetSource === 'local' ? draft.introPath.trim() || undefined : undefined,
        assetRef: makeAssetRef(draft.introAssetKey, draft.introAssetSource, draft.introMediaSiloId),
      } : undefined,
      outroSlate: draft.outroEnabled ? {
        enabled: true,
        assetPath: draft.outroAssetSource === 'local' ? draft.outroPath.trim() || undefined : undefined,
        assetRef: makeAssetRef(draft.outroAssetKey, draft.outroAssetSource, draft.outroMediaSiloId),
      } : undefined,
      overlay: draft.overlayEnabled ? {
        enabled: true,
        assetPath:
          draft.overlayAssetSource === 'local'
            ? draft.overlayPath.trim() || undefined
            : undefined,
        assetRef: makeAssetRef(draft.overlayAssetKey, draft.overlayAssetSource, draft.overlayMediaSiloId),
        position: draft.overlayPosition,
        duration: Number(draft.overlayDuration) || 4,
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
            <th>Name</th>
            <th>Aspect Ratio</th>
            <th>Resolution</th>
            <th>Bitrate</th>
            <th>Max Size</th>
            <th>Upfront Card</th>
            <th>Endcard</th>
            <th>ESRB Overlay</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {presets.length === 0 && (
            <tr><td colSpan={9} className="pm-empty">No presets yet. Create one above.</td></tr>
          )}
          {presets.map((p) => (
            <tr key={p.id}>
              <td><strong>{p.name}</strong><div className="pm-id">{p.id}</div></td>
              <td>{formatAspectLabel(p.width, p.height)}</td>
              <td>{p.width}×{p.height}</td>
              <td>{formatVideoBitrateMbps(p.bitrate)} Mbps</td>
              <td>{p.maxFileSizeMB && p.maxFileSizeMB > 0 ? `${p.maxFileSizeMB} MB` : 'No limit'}</td>
              <td>{p.introSlate?.enabled ? (p.introSlate.assetRef?.key || getBasename(p.introSlate.assetPath) || 'Not selected') : 'None'}</td>
              <td>{p.outroSlate?.enabled ? (p.outroSlate.assetRef?.key || getBasename(p.outroSlate.assetPath) || 'Not selected') : 'None'}</td>
              <td>{p.overlay?.enabled ? (p.overlay.assetPath ? getBasename(p.overlay.assetPath) : (p.overlay.assetRef?.key || 'Not selected')) : 'None'}</td>
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
                <>
                  <div className="input-group">
                    <select value={prependLib.find((a) => a.key === draft.introAssetKey && a.source === draft.introAssetSource)?.id || ''}
                      onChange={(e) => selectFromLib('intro', e.target.value)}>
                      <option value="">Select from prepend library</option>
                      {prependLib.map((a) => <option key={a.id} value={a.id}>{a.name} ({a.source === 'mediasilo' ? 'MediaSilo' : 'Local'})</option>)}
                    </select>
                    <button className="btn btn-small btn-secondary" onClick={() => addFileToLib('intro')}>Add File</button>
                    <button className="btn btn-small btn-secondary" onClick={() => addMediaSiloToLib('intro')}>Add MediaSilo</button>
                  </div>
                  <input type="text" placeholder="Shared asset key" value={draft.introAssetKey} onChange={(e) => set('introAssetKey', e.target.value)} />
                  <select value={draft.introAssetSource} onChange={(e) => set('introAssetSource', e.target.value as 'local' | 'mediasilo')}>
                    <option value="local">Local</option>
                    <option value="mediasilo">MediaSilo</option>
                  </select>
                  {draft.introAssetSource === 'mediasilo' && (
                    <input type="text" placeholder="MediaSilo asset ID (optional)" value={draft.introMediaSiloId} onChange={(e) => set('introMediaSiloId', e.target.value)} />
                  )}
                  <input type="text" placeholder="Local path" value={draft.introPath} readOnly />
                  {draft.introAssetKey && (
                    <div className="local-override-row">
                      <span>Local override: {overrides[draft.introAssetKey] || 'Not set'}</span>
                      <button className="btn btn-small btn-secondary" onClick={() => setLocalOverride('intro')}>Set Local Path</button>
                    </div>
                  )}
                </>
              )}
            </div>

            {/* Append */}
            <div className="asset-card">
              <label className="toggle-label">
                <input type="checkbox" checked={draft.outroEnabled} onChange={(e) => set('outroEnabled', e.target.checked)} />
                Enable Append
              </label>
              {draft.outroEnabled && (
                <>
                  <div className="input-group">
                    <select value={appendLib.find((a) => a.key === draft.outroAssetKey && a.source === draft.outroAssetSource)?.id || ''}
                      onChange={(e) => selectFromLib('outro', e.target.value)}>
                      <option value="">Select from append library</option>
                      {appendLib.map((a) => <option key={a.id} value={a.id}>{a.name} ({a.source === 'mediasilo' ? 'MediaSilo' : 'Local'})</option>)}
                    </select>
                    <button className="btn btn-small btn-secondary" onClick={() => addFileToLib('outro')}>Add File</button>
                    <button className="btn btn-small btn-secondary" onClick={() => addMediaSiloToLib('outro')}>Add MediaSilo</button>
                  </div>
                  <input type="text" placeholder="Shared asset key" value={draft.outroAssetKey} onChange={(e) => set('outroAssetKey', e.target.value)} />
                  <select value={draft.outroAssetSource} onChange={(e) => set('outroAssetSource', e.target.value as 'local' | 'mediasilo')}>
                    <option value="local">Local</option>
                    <option value="mediasilo">MediaSilo</option>
                  </select>
                  {draft.outroAssetSource === 'mediasilo' && (
                    <input type="text" placeholder="MediaSilo asset ID (optional)" value={draft.outroMediaSiloId} onChange={(e) => set('outroMediaSiloId', e.target.value)} />
                  )}
                  <input type="text" placeholder="Local path" value={draft.outroPath} readOnly />
                  {draft.outroAssetKey && (
                    <div className="local-override-row">
                      <span>Local override: {overrides[draft.outroAssetKey] || 'Not set'}</span>
                      <button className="btn btn-small btn-secondary" onClick={() => setLocalOverride('outro')}>Set Local Path</button>
                    </div>
                  )}
                </>
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
                  <div className="asset-grid">
                    <select value={draft.overlayPosition} onChange={(e) => set('overlayPosition', e.target.value as Draft['overlayPosition'])}>
                      <option value="tl">Top Left</option>
                      <option value="tr">Top Right</option>
                      <option value="bl">Bottom Left</option>
                      <option value="br">Bottom Right</option>
                    </select>
                    <input
                      type="number"
                      min={1}
                      placeholder="Duration (seconds)"
                      value={draft.overlayDuration}
                      onChange={(e) => set('overlayDuration', e.target.value)}
                    />
                  </div>
                  <div className="input-group">
                    <select
                      value={
                        overlayLib.find(
                          (asset) =>
                            asset.key === draft.overlayAssetKey &&
                            asset.source === draft.overlayAssetSource &&
                            asset.position === draft.overlayPosition
                        )?.id || ''
                      }
                      onChange={(event) =>
                        selectOverlayFromLibrary(event.target.value)
                      }
                    >
                      <option value="">Select from overlay library</option>
                      {overlayLib
                        .filter((asset) => asset.position === draft.overlayPosition)
                        .map((asset) => (
                          <option key={asset.id} value={asset.id}>
                            {asset.name} ({asset.source === 'mediasilo' ? 'MediaSilo' : 'Local'})
                          </option>
                        ))}
                    </select>
                    <button className="btn btn-small btn-secondary" onClick={() => addOverlayToLibrary(draft.overlayPosition)}>Add File</button>
                    <button className="btn btn-small btn-secondary" onClick={() => addMediaSiloOverlayToLibrary(draft.overlayPosition)}>Add MediaSilo</button>
                  </div>
                  <input type="text" placeholder="Shared asset key" value={draft.overlayAssetKey} onChange={(e) => set('overlayAssetKey', e.target.value)} />
                  <select value={draft.overlayAssetSource} onChange={(e) => set('overlayAssetSource', e.target.value as 'local' | 'mediasilo')}>
                    <option value="local">Local</option>
                    <option value="mediasilo">MediaSilo</option>
                  </select>
                  {draft.overlayAssetSource === 'mediasilo' && (
                    <input type="text" placeholder="MediaSilo asset ID (optional)" value={draft.overlayMediaSiloId} onChange={(e) => set('overlayMediaSiloId', e.target.value)} />
                  )}
                  <input type="text" placeholder="Overlay asset path" value={draft.overlayPath} readOnly />
                  {draft.overlayAssetKey && (
                    <div className="local-override-row">
                      <span>Local override: {overrides[draft.overlayAssetKey] || 'Not set'}</span>
                      <button className="btn btn-small btn-secondary" onClick={() => setLocalOverride('overlay')}>Set Local Path</button>
                    </div>
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
