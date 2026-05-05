/**
 * Preset selector component
 */

import React, { useEffect, useState } from 'react';
import { VideoMetadata, OutputPreset } from '../../core/models/types';
import './PresetSelector.css';

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

const PREPEND_LIBRARY_STORAGE_KEY = 'version-bot-prepend-library';
const APPEND_LIBRARY_STORAGE_KEY = 'version-bot-append-library';
const OVERLAY_LIBRARY_STORAGE_KEY = 'version-bot-overlay-library';

const RESOLUTION_OPTIONS = [
  { value: '3840x2160', aspect: '16:9', width: 3840, height: 2160 },
  { value: '1920x1080', aspect: '16:9', width: 1920, height: 1080 },
  { value: '1080x1920', aspect: '9:16', width: 1080, height: 1920 },
  { value: '1080x1080', aspect: '1:1', width: 1080, height: 1080 },
  { value: '1080x1350', aspect: '4:5', width: 1080, height: 1350 },
] as const;

// Must match ffmpeg output frame rate (fps=60000/1001)
const OUTPUT_FPS = 59.94;

function getDefaultOutputDir(filePath: string): string {
  const lastSeparatorIndex = Math.max(
    filePath.lastIndexOf('\\'),
    filePath.lastIndexOf('/')
  );

  if (lastSeparatorIndex === -1) {
    return 'Versioning';
  }

  return `${filePath.slice(0, lastSeparatorIndex + 1)}Versioning`;
}

function formatAspectRatioLabel(width: number, height: number): string {
  const ratio = width / height;
  const presets = [
    { value: 16 / 9, label: '16:9' },
    { value: 9 / 16, label: '9:16' },
    { value: 1, label: '1:1' },
    { value: 4 / 5, label: '4:5' },
  ];

  const matchingPreset = presets.find(
    (preset) => Math.abs(preset.value - ratio) < 0.01
  );

  return matchingPreset?.label || ratio.toFixed(3);
}

function formatVideoBitrateMbps(kbps: number): string {
  const mbps = kbps / 1000;
  return Number.isInteger(mbps) ? String(mbps) : mbps.toFixed(2).replace(/\.?0+$/, '');
}

function parseVideoBitrateMbps(value: string): number {
  return Math.round(Number(value) * 1000);
}

function splitDurationToParts(durationSeconds: number): { seconds: string; frames: string } {
  const normalized = Math.max(0, Number(durationSeconds) || 0);
  let seconds = Math.floor(normalized);
  let frames = Math.round((normalized - seconds) * OUTPUT_FPS);

  const roundedFps = Math.round(OUTPUT_FPS);
  if (frames >= roundedFps) {
    seconds += 1;
    frames = 0;
  }

  return {
    seconds: String(seconds),
    frames: String(frames),
  };
}

function combineDurationPartsToSeconds(secondsPart: string, framesPart: string): number {
  const seconds = Math.max(0, parseInt(secondsPart, 10) || 0);
  const frames = Math.max(0, parseInt(framesPart, 10) || 0);
  return seconds + (frames / OUTPUT_FPS);
}

function formatDurationWithFrames(durationSeconds: number): string {
  const parts = splitDurationToParts(durationSeconds);
  return ` (${parts.seconds}s ${parts.frames}f)`;
}

function formatResolutionOption(option: (typeof RESOLUTION_OPTIONS)[number]): string {
  return `${option.aspect} (${option.width}×${option.height})`;
}


interface PresetSelectorProps {
  video: VideoMetadata;
  presets: OutputPreset[];
  selectedPresetIds: string[];
  onPresetToggle: (presetId: string) => void;
  onCreatePlan: (
    outputDir: string,
    filenamePattern: string,
    fileSizeConstraints: Record<string, number>,
    autoRun?: boolean,
    overlayDurationOverrideSeconds?: number,
    overlayAssetOverrideLibraryId?: string
  ) => void;
  onUpsertPreset: (preset: OutputPreset, previousPresetId?: string) => void;
  onBack: () => void;
}

interface PresetDraft {
  id: string;
  name: string;
  width: string;
  height: string;
  scalingMode: OutputPreset['scalingMode'];
  bitrate: string;
  videoCodec: OutputPreset['videoCodec'];
  audioBitrate: string;
  audioCodec: OutputPreset['audioCodec'];
  maxFileSizeMB: string;
  introEnabled: boolean;
  introLibraryId: string;
  outroEnabled: boolean;
  outroLibraryId: string;
  overlayEnabled: boolean;
  overlayLibraryId: string;
  overlayDurationSeconds: string;
  overlayDurationFrames: string;
}

const INITIAL_DRAFT: PresetDraft = {
  id: '',
  name: '',
  width: '',
  height: '',
  scalingMode: 'scale',
  bitrate: '50',
  videoCodec: 'h264',
  audioBitrate: '320',
  audioCodec: 'aac',
  maxFileSizeMB: '',
  introEnabled: false,
  introLibraryId: '',
  outroEnabled: false,
  outroLibraryId: '',
  overlayEnabled: false,
  overlayLibraryId: '',
  overlayDurationSeconds: '4',
  overlayDurationFrames: '0',
};

export default function PresetSelector({
  video,
  presets,
  selectedPresetIds,
  onPresetToggle,
  onCreatePlan,
  onUpsertPreset,
  onBack,
}: PresetSelectorProps) {
  const [outputDir, setOutputDir] = useState<string>(
    getDefaultOutputDir(video.filePath)
  );
  const filenamePattern = '{source}_{preset}.{ext}';
  const [isSelectingDir, setIsSelectingDir] = useState(false);
  const [draft, setDraft] = useState<PresetDraft>(INITIAL_DRAFT);
  const [editingPresetId, setEditingPresetId] = useState<string | null>(null);
  const [showBuilder, setShowBuilder] = useState(false);
  const [prependLibrary, setPrependLibrary] = useState<SlateAssetOption[]>([]);
  const [appendLibrary, setAppendLibrary] = useState<SlateAssetOption[]>([]);
  const [overlayLibrary, setOverlayLibrary] = useState<OverlayAssetOption[]>([]);
  const [batchOverlayOverrideEnabled, setBatchOverlayOverrideEnabled] = useState(false);
  const [batchOverlayOverrideSecondsPart, setBatchOverlayOverrideSecondsPart] = useState('4');
  const [batchOverlayOverrideFramesPart, setBatchOverlayOverrideFramesPart] = useState('0');
  const [batchOverlayAssetLibraryId, setBatchOverlayAssetLibraryId] = useState('');
  const hasMaxFileSize = Number(draft.maxFileSizeMB || 0) > 0;
  const sortedPresets = presets.slice().sort((a, b) => a.name.localeCompare(b.name));
  const allPresetsSelected = sortedPresets.length > 0
    && sortedPresets.every((preset) => selectedPresetIds.includes(preset.id));
  const somePresetsSelected = sortedPresets.some((preset) => selectedPresetIds.includes(preset.id));

  const toAssetKey = (value: string): string =>
    value
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '');

  const tokenizeAssetKey = (value?: string): string[] => {
    if (!value) return [];

    return toAssetKey(value)
      .split('_')
      .filter(Boolean)
      .filter((token) => !['toolkit', 'mgfx', 'png', 'jpg', 'jpeg', 'webp', 'bmp', '4k', 'v01', 'v1'].includes(token));
  };

  const isTokenSubsetMatch = (candidate: string | undefined, reference: string | undefined): boolean => {
    const candidateTokens = tokenizeAssetKey(candidate);
    const referenceTokens = tokenizeAssetKey(reference);

    return referenceTokens.length > 0
      && referenceTokens.every((token) => candidateTokens.includes(token));
  };

  const normalizeLibraryItem = (item: Partial<SlateAssetOption>): SlateAssetOption => {
    const name = item.name?.trim() || 'Untitled Asset';
    const path = item.path?.trim();
    const key = item.key?.trim() || toAssetKey(name) || `asset_${Date.now()}`;

    return {
      id: item.id || `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      name,
      key,
      source: item.source === 'mediasilo' ? 'mediasilo' : 'local',
      mediaSiloId: item.mediaSiloId,
      path,
      duration: Math.max(1, Number(item.duration) || 3),
    };
  };

  const normalizeOverlayItem = (item: Partial<OverlayAssetOption>): OverlayAssetOption => {
    const name = item.name?.trim() || 'Untitled Overlay';
    const path = item.path?.trim();
    const key = item.key?.trim() || toAssetKey(name) || `overlay_${Date.now()}`;

    return {
      id: item.id || `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      name,
      key,
      source: item.source === 'mediasilo' ? 'mediasilo' : 'local',
      mediaSiloId: item.mediaSiloId,
      path,
    };
  };

  useEffect(() => {
    Promise.all([
      window.versionBotAPI.getAssetLibrary(PREPEND_LIBRARY_STORAGE_KEY),
      window.versionBotAPI.getAssetLibrary(APPEND_LIBRARY_STORAGE_KEY),
      window.versionBotAPI.getAssetLibrary(OVERLAY_LIBRARY_STORAGE_KEY),
    ]).then(([pr, ar, or_]) => {
      if (pr.success && pr.data) setPrependLibrary((pr.data as Partial<SlateAssetOption>[]).map(normalizeLibraryItem));
      if (ar.success && ar.data) setAppendLibrary((ar.data as Partial<SlateAssetOption>[]).map(normalizeLibraryItem));
      if (or_.success && or_.data) setOverlayLibrary((or_.data as Partial<OverlayAssetOption>[]).map(normalizeOverlayItem));
    }).catch((error) => {
      console.warn('Failed to load local asset libraries', error);
    });
  }, []);

  const handleSelectOutputDir = async () => {
    setIsSelectingDir(true);
    try {
      const dir = await window.versionBotAPI.selectOutputDirectory();
      if (dir) {
        setOutputDir(dir);
      }
    } catch (error) {
      console.error('Error selecting output directory:', error);
    }
    setIsSelectingDir(false);
  };

  const handleToggleAllPresets = () => {
    const nextSelectedState = !allPresetsSelected;

    for (const preset of sortedPresets) {
      const isSelected = selectedPresetIds.includes(preset.id);
      if (isSelected !== nextSelectedState) {
        onPresetToggle(preset.id);
      }
    }
  };

  const handleCreatePlan = () => {
    const constraints: Record<string, number> = {};
    for (const preset of presets) {
      if (!selectedPresetIds.includes(preset.id)) {
        continue;
      }

      const maxSize = Number(preset.maxFileSizeMB || 0);
      if (maxSize > 0) {
        constraints[preset.id] = maxSize;
      }
    }

    let overlayDurationOverrideSeconds: number | undefined;
    if (batchOverlayOverrideEnabled) {
      overlayDurationOverrideSeconds = combineDurationPartsToSeconds(
        batchOverlayOverrideSecondsPart,
        batchOverlayOverrideFramesPart
      );
    }

    onCreatePlan(
      outputDir,
      filenamePattern,
      constraints,
      true,
      overlayDurationOverrideSeconds,
      batchOverlayOverrideEnabled && batchOverlayAssetLibraryId ? batchOverlayAssetLibraryId : undefined
    );
  };

  const updateDraft = <K extends keyof PresetDraft>(
    key: K,
    value: PresetDraft[K]
  ) => {
    setDraft((prev) => ({ ...prev, [key]: value }));
  };

  const handleDraftNameChange = (value: string) => {
    setDraft((prev) => ({
      ...prev,
      name: value,
      id: toAssetKey(value),
    }));
  };

  const getResolutionOptionValue = (width: string, height: string): string => {
    const matchingOption = RESOLUTION_OPTIONS.find(
      (option) => option.width === Number(width) && option.height === Number(height)
    );

    return matchingOption?.value || RESOLUTION_OPTIONS[1].value;
  };

  const setResolutionOption = (value: string) => {
    const selectedOption = RESOLUTION_OPTIONS.find((option) => option.value === value);
    if (!selectedOption) {
      return;
    }

    setDraft((prev) => ({
      ...prev,
      width: String(selectedOption.width),
      height: String(selectedOption.height),
    }));
  };




  const handleSavePreset = () => {
    if (!draft.name.trim()) {
      alert('Preset name is required');
      return;
    }

    const generatedPresetId = toAssetKey(draft.name);

    if (!generatedPresetId) {
      alert('Preset name must include letters or numbers');
      return;
    }

    if (
      presets.some(
        (preset) =>
          preset.id === generatedPresetId &&
          preset.id !== editingPresetId
      )
    ) {
      alert(`Preset ID "${generatedPresetId}" already exists`);
      return;
    }

    const width = Number(draft.width);
    const height = Number(draft.height);
    const bitrate = parseVideoBitrateMbps(draft.bitrate);
    const audioBitrate = Number(draft.audioBitrate);
    const crf = draft.crf ? Number(draft.crf) : undefined;

    if (
      Number.isNaN(width) ||
      Number.isNaN(height) ||
      Number.isNaN(bitrate) ||
      Number.isNaN(audioBitrate) ||
      width <= 0 ||
      height <= 0 ||
      bitrate <= 0 ||
      audioBitrate <= 0
    ) {
      alert('Width, height, bitrate, and audio bitrate must be positive numbers');
      return;
    }

    const maxFileSizeMB = draft.maxFileSizeMB ? Number(draft.maxFileSizeMB) : 0;
    if (Number.isNaN(maxFileSizeMB) || maxFileSizeMB < 0) {
      alert('Max filesize must be zero/empty or a positive number');
      return;
    }

    const introItem = prependLibrary.find((a) => a.id === draft.introLibraryId);
    const outroItem = appendLibrary.find((a) => a.id === draft.outroLibraryId);
    const overlayItem = overlayLibrary.find((a) => a.id === draft.overlayLibraryId);

    const preset: OutputPreset = {
      id: generatedPresetId,
      name: draft.name.trim(),
      width,
      height,
      scalingMode: 'scale',
      bitrate,
      videoCodec: draft.videoCodec,
      crf,
      audioBitrate,
      audioCodec: draft.audioCodec,
      container: 'mp4',
      maxFileSizeMB,
      introSlate: draft.introEnabled
        ? {
            enabled: true,
            assetPath: introItem?.source === 'local' ? introItem.path : undefined,
            assetRef: introItem ? { key: introItem.key, source: introItem.source, mediaSiloId: introItem.mediaSiloId } : undefined,
          }
        : undefined,
      outroSlate: draft.outroEnabled
        ? {
            enabled: true,
            assetPath: outroItem?.source === 'local' ? outroItem.path : undefined,
            assetRef: outroItem ? { key: outroItem.key, source: outroItem.source, mediaSiloId: outroItem.mediaSiloId } : undefined,
          }
        : undefined,
      overlay: draft.overlayEnabled
        ? {
            enabled: true,
            assetPath: overlayItem?.source === 'local' ? overlayItem.path : undefined,
            assetRef: overlayItem ? { key: overlayItem.key, source: overlayItem.source, mediaSiloId: overlayItem.mediaSiloId } : undefined,
            duration: combineDurationPartsToSeconds(
              draft.overlayDurationSeconds,
              draft.overlayDurationFrames
            ),
          }
        : undefined,
    };

    onUpsertPreset(preset, editingPresetId || undefined);
    setEditingPresetId(null);
    setShowBuilder(false);
    setDraft({
      ...INITIAL_DRAFT,
      width: String(video.width),
      height: String(video.height),
    });
  };

  const handleEditPreset = (preset: OutputPreset) => {
    const findSlateId = (lib: SlateAssetOption[], key?: string, path?: string) =>
      lib.find((a) => key && a.key === key)?.id ||
      lib.find((a) => path && a.path === path)?.id ||
      '';

    setEditingPresetId(preset.id);
    setShowBuilder(true);
    const overlayDurationParts = splitDurationToParts(preset.overlay?.duration || 4);
    setDraft({
      id: preset.id,
      name: preset.name,
      width: String(preset.width),
      height: String(preset.height),
      scalingMode: 'scale',
      bitrate: formatVideoBitrateMbps(preset.bitrate),
      videoCodec: preset.videoCodec,
      audioBitrate: String(preset.audioBitrate || 320),
      audioCodec: preset.audioCodec,
      maxFileSizeMB:
        preset.maxFileSizeMB && preset.maxFileSizeMB > 0
          ? String(preset.maxFileSizeMB)
          : '',
      introEnabled: !!preset.introSlate?.enabled,
      introLibraryId: findSlateId(prependLibrary, preset.introSlate?.assetRef?.key, preset.introSlate?.assetPath),
      outroEnabled: !!preset.outroSlate?.enabled,
      outroLibraryId: findSlateId(appendLibrary, preset.outroSlate?.assetRef?.key, preset.outroSlate?.assetPath),
      overlayEnabled: !!preset.overlay?.enabled,
      overlayLibraryId:
        overlayLibrary.find((a) => preset.overlay?.assetRef?.key && a.key === preset.overlay.assetRef.key)?.id ||
        overlayLibrary.find((a) => preset.overlay?.assetPath && a.path === preset.overlay.assetPath)?.id ||
        '',
      overlayDurationSeconds: overlayDurationParts.seconds,
      overlayDurationFrames: overlayDurationParts.frames,
    });
  };

  const handleDuplicatePreset = (preset: OutputPreset) => {
    const baseName = `${preset.name} Copy`;
    let candidateName = baseName;
    let suffix = 2;

    while (presets.some((existing) => toAssetKey(existing.name) === toAssetKey(candidateName))) {
      candidateName = `${baseName} ${suffix}`;
      suffix += 1;
    }

    const duplicatedPreset: OutputPreset = {
      ...preset,
      id: toAssetKey(candidateName),
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

  const handleCancelEdit = () => {
    setEditingPresetId(null);
    setShowBuilder(false);
    setDraft({
      ...INITIAL_DRAFT,
      width: String(video.width),
      height: String(video.height),
    });
  };

  const handleStartCreatePreset = () => {
    setEditingPresetId(null);
    setShowBuilder((prev) => !prev);
    setDraft((prev) =>
      prev.id || prev.name
        ? {
            ...INITIAL_DRAFT,
            width: String(video.width),
            height: String(video.height),
          }
        : prev
    );
  };

  const getBasename = (assetPath?: string): string => {
    if (!assetPath) {
      return 'No';
    }

    const normalized = assetPath.replace(/\\/g, '/');
    const lastSlash = normalized.lastIndexOf('/');
    return lastSlash >= 0 ? normalized.slice(lastSlash + 1) : normalized;
  };

  const getIntroDisplay = (slate?: OutputPreset['introSlate']): string => {
    if (!slate?.enabled) {
      return 'None';
    }

    if (!slate.assetPath && !slate.assetRef?.key) {
      return 'Not selected';
    }

    // Look up friendly name from prepend library by key, then by path
    if (slate.assetRef?.key) {
      const byKey = prependLibrary.find((a) => a.key === slate.assetRef?.key);
      if (byKey) return byKey.name;
    }
    if (slate.assetPath) {
      const byPath = prependLibrary.find((a) => a.path === slate.assetPath);
      if (byPath) return byPath.name;
      return getBasename(slate.assetPath);
    }

    return 'Not selected';
  };

  const getOutroDisplay = (slate?: OutputPreset['introSlate']): string => {
    if (!slate?.enabled) {
      return 'None';
    }

    if (!slate.assetPath && !slate.assetRef?.key) {
      return 'Not selected';
    }

    // Look up friendly name from append library by key, then by path
    if (slate.assetRef?.key) {
      const byKey = appendLibrary.find((a) => a.key === slate.assetRef?.key);
      if (byKey) return byKey.name;
    }
    if (slate.assetPath) {
      const byPath = appendLibrary.find((a) => a.path === slate.assetPath);
      if (byPath) return byPath.name;
      return getBasename(slate.assetPath);
    }

    return 'Not selected';
  };

  const isSlateMissing = (slate?: OutputPreset['introSlate']): boolean => {
    if (!slate?.enabled) {
      return false;
    }

    return !slate.assetPath && !slate.assetRef?.key;
  };

  const getOverlayDisplay = (preset: OutputPreset): string => {
    if (!preset.overlay?.enabled) {
      return 'None';
    }

    const duration =
      preset.overlay.duration && preset.overlay.duration > 0
        ? formatDurationWithFrames(preset.overlay.duration)
        : '';

    if (!preset.overlay.assetPath && !preset.overlay.assetRef?.key) {
      return 'Not selected';
    }

    // Look up friendly name from overlay library by key, then by path
    if (preset.overlay.assetRef?.key) {
      const byKey = overlayLibrary.find((a) => a.key === preset.overlay?.assetRef?.key);
      if (byKey) return `${byKey.name}${duration}`;

      const fuzzyByKey = overlayLibrary.find(
        (a) => isTokenSubsetMatch(preset.overlay?.assetRef?.key, a.key) || isTokenSubsetMatch(preset.overlay?.assetRef?.key, a.name)
      );
      if (fuzzyByKey) return `${fuzzyByKey.name}${duration}`;
    }
    if (preset.overlay.assetPath) {
      const byPath = overlayLibrary.find((a) => a.path === preset.overlay?.assetPath);
      if (byPath) return `${byPath.name}${duration}`;

      const fuzzyByPath = overlayLibrary.find(
        (a) => isTokenSubsetMatch(getBasename(preset.overlay?.assetPath), a.key) || isTokenSubsetMatch(getBasename(preset.overlay?.assetPath), a.name)
      );
      if (fuzzyByPath) return `${fuzzyByPath.name}${duration}`;

      return `${getBasename(preset.overlay.assetPath)}${duration}`;
    }

    return 'Not selected';
  };

  const isOverlayAssetMissing = (preset: OutputPreset): boolean => {
    if (!preset.overlay?.enabled) {
      return false;
    }

    return !preset.overlay.assetPath && !preset.overlay.assetRef?.key;
  };

  const renderPresetBuilder = (mode: 'new' | 'edit') => (
    <div className={`preset-builder ${mode === 'edit' ? 'preset-builder-inline' : ''}`}>
      <h3>{mode === 'edit' ? 'Update Preset' : 'Create Custom Preset'}</h3>

      <div className="builder-grid">
        <div className="form-group">
          <label>Preset Name</label>
          <input
            type="text"
            value={draft.name}
            placeholder="Social 1080p"
            onChange={(e) => handleDraftNameChange(e.target.value)}
          />
        </div>

        <div className="form-group">
          <label>Aspect Ratio / Resolution</label>
          <select
            value={getResolutionOptionValue(draft.width, draft.height)}
            onChange={(e) => setResolutionOption(e.target.value)}
          >
            {RESOLUTION_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {formatResolutionOption(option)}
              </option>
            ))}
          </select>
        </div>

        <div className="form-group">
          <label>Bitrate (Mbps)</label>
          <input
            type="text"
            inputMode="decimal"
            value={hasMaxFileSize ? 'Auto' : draft.bitrate}
            placeholder="Auto"
            disabled={hasMaxFileSize}
            readOnly={hasMaxFileSize}
            onChange={(e) => updateDraft('bitrate', e.target.value)}
          />
        </div>

        <div className="form-group">
          <label>Audio Bitrate (kbps)</label>
          <input
            type="number"
            min={1}
            value={draft.audioBitrate}
            onChange={(e) => updateDraft('audioBitrate', e.target.value)}
          />
        </div>

        <div className="form-group">
          <label>Max Filesize (MB, optional)</label>
          <input
            type="number"
            min={0}
            placeholder="0 = no limit"
            value={draft.maxFileSizeMB}
            onChange={(e) => updateDraft('maxFileSizeMB', e.target.value)}
          />
        </div>
      </div>

      <div className="asset-sections">
        <div className="asset-card">
          <label className="toggle-label">
            <input
              type="checkbox"
              checked={draft.introEnabled}
              onChange={(e) => updateDraft('introEnabled', e.target.checked)}
            />
            Enable Prepend
          </label>
          {draft.introEnabled && (
            prependLibrary.length === 0 ? (
              <p className="help-text">No prepend assets in library. Add some in Manage Assets.</p>
            ) : (
              <select
                value={draft.introLibraryId}
                onChange={(e) => updateDraft('introLibraryId', e.target.value)}
              >
                <option value="">— Select prepend asset —</option>
                {prependLibrary.map((asset) => (
                  <option key={asset.id} value={asset.id}>{asset.name}</option>
                ))}
              </select>
            )
          )}
        </div>

        <div className="asset-card">
          <label className="toggle-label">
            <input
              type="checkbox"
              checked={draft.outroEnabled}
              onChange={(e) => updateDraft('outroEnabled', e.target.checked)}
            />
            Enable Append
          </label>
          {draft.outroEnabled && (
            appendLibrary.length === 0 ? (
              <p className="help-text">No append assets in library. Add some in Manage Assets.</p>
            ) : (
              <select
                value={draft.outroLibraryId}
                onChange={(e) => updateDraft('outroLibraryId', e.target.value)}
              >
                <option value="">— Select append asset —</option>
                {appendLibrary.map((asset) => (
                  <option key={asset.id} value={asset.id}>{asset.name}</option>
                ))}
              </select>
            )
          )}
        </div>

        <div className="asset-card">
          <label className="toggle-label">
            <input
              type="checkbox"
              checked={draft.overlayEnabled}
              onChange={(e) => updateDraft('overlayEnabled', e.target.checked)}
            />
            Enable Overlay
          </label>
          {draft.overlayEnabled && (
            <>
              <div className="duration-grid">
                <div className="duration-field">
                  <label>Seconds</label>
                  <input
                    type="number"
                    min={0}
                    step={1}
                    value={draft.overlayDurationSeconds}
                    onChange={(e) => updateDraft('overlayDurationSeconds', e.target.value)}
                  />
                </div>
                <div className="duration-field">
                  <label>Frames</label>
                  <input
                    type="number"
                    min={0}
                    step={1}
                    value={draft.overlayDurationFrames}
                    onChange={(e) => updateDraft('overlayDurationFrames', e.target.value)}
                  />
                </div>
              </div>
              {overlayLibrary.length === 0 ? (
                <p className="help-text">No overlay assets in library. Add some in Manage Assets.</p>
              ) : (
                <select
                  value={draft.overlayLibraryId}
                  onChange={(e) => updateDraft('overlayLibraryId', e.target.value)}
                >
                  <option value="">— Select overlay asset —</option>
                  {overlayLibrary.map((asset) => (
                    <option key={asset.id} value={asset.id}>{asset.name}</option>
                  ))}
                </select>
              )}
            </>
          )}
        </div>
      </div>

      <div className="builder-actions">
        <button className="btn btn-secondary" onClick={handleSavePreset}>
          {mode === 'edit' ? 'Save Preset Changes' : 'Add Preset'}
        </button>
        <button className="btn" onClick={handleCancelEdit}>
          Cancel
        </button>
      </div>
    </div>
  );

  return (
    <div className="preset-selector">
      <div className="ps-header">
        <button className="btn btn-secondary" onClick={onBack}>← Back</button>
        <h2>Select Export Presets</h2>
      </div>

      <div className="preset-selector-content">
        <p className="preset-summary">
          Showing {presets.length} saved presets. Presets that match the source aspect ratio are preselected.
        </p>

        <div className="video-info">
          <h3>Source Video: {video.filePath.split(/[\/\\]/).pop()}</h3>
          <div className="video-stats-row">
            <span>
              <strong>Aspect Ratio:</strong> {formatAspectRatioLabel(video.width, video.height)}
            </span>
            <span>
              <strong>Resolution:</strong> {video.width}x{video.height}
            </span>
            <span>
              <strong>Duration:</strong> {Math.floor(video.duration / 60)}:
              {String(video.duration % 60).padStart(2, '0')}
            </span>
            <span>
              <strong>FPS:</strong> {video.fps.toFixed(2)}
            </span>
            <span>
              <strong>Codec:</strong> {video.codec}
            </span>
          </div>
        </div>

        <div className="preset-table-wrapper">
          <table className="preset-table">
            <thead>
              <tr>
                <th className="sticky-column sticky-column-select">
                  <div className="preset-cell preset-cell-select select-all-header">
                    <span>Select</span>
                    <input
                      type="checkbox"
                      checked={allPresetsSelected}
                      ref={(element) => {
                        if (element) {
                          element.indeterminate = somePresetsSelected && !allPresetsSelected;
                        }
                      }}
                      onChange={handleToggleAllPresets}
                      aria-label={allPresetsSelected ? 'Deselect all presets' : 'Select all presets'}
                    />
                  </div>
                </th>
                <th className="sticky-column sticky-column-name">
                  <div className="preset-cell">Preset Name</div>
                </th>
                <th><div className="preset-cell">Prepend</div></th>
                <th><div className="preset-cell">Append</div></th>
                <th><div className="preset-cell">ESRB Overlay</div></th>
                <th><div className="preset-cell">Aspect Ratio</div></th>
                <th><div className="preset-cell">Resolution</div></th>
                <th><div className="preset-cell">Target Bitrate</div></th>
                <th><div className="preset-cell">Max Filesize</div></th>
                <th><div className="preset-cell">FPS</div></th>
                <th><div className="preset-cell">Codec/Format</div></th>
                <th><div className="preset-cell">Audio Specs</div></th>
                <th className="sticky-column sticky-column-actions">
                  <div className="preset-cell preset-cell-actions">Actions</div>
                </th>
              </tr>
            </thead>
            <tbody>
              {sortedPresets.map((preset) => {
                const isSelected = selectedPresetIds.includes(preset.id);
                return (
                  <React.Fragment key={preset.id}>
                    <tr className={isSelected ? 'row-selected' : ''}>
                      <td className="sticky-column sticky-column-select">
                        <div className="preset-cell preset-cell-select">
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => onPresetToggle(preset.id)}
                          />
                        </div>
                      </td>
                      <td className="sticky-column sticky-column-name">
                        <div className="preset-cell">{preset.name}</div>
                      </td>
                      <td className={isSlateMissing(preset.introSlate) ? 'overlay-missing' : ''}>
                        <div className="preset-cell">{getIntroDisplay(preset.introSlate)}</div>
                      </td>
                      <td className={isSlateMissing(preset.outroSlate) ? 'overlay-missing' : ''}>
                        <div className="preset-cell">{getOutroDisplay(preset.outroSlate)}</div>
                      </td>
                      <td className={isOverlayAssetMissing(preset) ? 'overlay-missing' : ''}>
                        <div className="preset-cell">{getOverlayDisplay(preset)}</div>
                      </td>
                      <td><div className="preset-cell">{formatAspectRatioLabel(preset.width, preset.height)}</div></td>
                      <td><div className="preset-cell">{preset.width}x{preset.height}</div></td>
                      <td>
                        <div className="preset-cell">
                          {preset.maxFileSizeMB && preset.maxFileSizeMB > 0
                            ? 'Auto'
                            : `${formatVideoBitrateMbps(preset.bitrate)} Mbps`}
                        </div>
                      </td>
                      <td>
                        <div className="preset-cell">
                          {preset.maxFileSizeMB && preset.maxFileSizeMB > 0
                            ? `${preset.maxFileSizeMB} MB`
                            : 'No limit'}
                        </div>
                      </td>
                      <td><div className="preset-cell">59.94</div></td>
                      <td><div className="preset-cell">{preset.videoCodec.toUpperCase()} / {preset.container.toUpperCase()}</div></td>
                      <td><div className="preset-cell">{preset.audioCodec.toUpperCase()} @ {preset.audioBitrate || 320} kbps</div></td>
                      <td className="sticky-column sticky-column-actions preset-row-actions-cell">
                        <div className="preset-cell preset-cell-actions">
                          <div className="preset-row-actions">
                            <button
                              className="btn btn-small btn-secondary"
                              onClick={() => handleDuplicatePreset(preset)}
                            >
                              Duplicate
                            </button>
                            <button
                              className="btn btn-small btn-secondary"
                              onClick={() => handleEditPreset(preset)}
                            >
                              Edit
                            </button>
                          </div>
                        </div>
                      </td>
                    </tr>
                    {showBuilder && editingPresetId === preset.id && (
                      <tr className="preset-inline-editor-row">
                        <td colSpan={13}>{renderPresetBuilder('edit')}</td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>

        {showBuilder && !editingPresetId && renderPresetBuilder('new')}

        <div className="output-settings">
          <h3>Output Settings</h3>

          <div className="form-group">
            <label>Output Directory</label>
            <div className="input-group">
              <input
                type="text"
                value={outputDir}
                disabled
                placeholder="Output directory"
              />
              <button
                className="btn btn-secondary"
                onClick={handleSelectOutputDir}
                disabled={isSelectingDir}
              >
                Browse
              </button>
            </div>
          </div>

          <div className="form-group">
            <label className="toggle-label">
              <input
                type="checkbox"
                checked={batchOverlayOverrideEnabled}
                onChange={(e) => setBatchOverlayOverrideEnabled(e.target.checked)}
              />
              <span className="batch-overlay-override-label">Override ESRB Overlay For This Batch</span>
            </label>
            {batchOverlayOverrideEnabled && (
              <>
                <div className="form-group" style={{ marginTop: '0.5rem' }}>
                  <label>Overlay Asset</label>
                  <select
                    value={batchOverlayAssetLibraryId}
                    onChange={(e) => setBatchOverlayAssetLibraryId(e.target.value)}
                  >
                    <option value="">— Keep preset default —</option>
                    {overlayLibrary.map((item) => (
                      <option key={item.id} value={item.id}>{item.name}</option>
                    ))}
                  </select>
                </div>
                <div className="duration-grid">
                  <div className="duration-field">
                    <label>Overlay Duration (Seconds)</label>
                    <input
                      type="number"
                      min={0}
                      step={1}
                      value={batchOverlayOverrideSecondsPart}
                      onChange={(e) => setBatchOverlayOverrideSecondsPart(e.target.value)}
                    />
                  </div>
                  <div className="duration-field">
                    <label>Frames</label>
                    <input
                      type="number"
                      min={0}
                      step={1}
                      value={batchOverlayOverrideFramesPart}
                      onChange={(e) => setBatchOverlayOverrideFramesPart(e.target.value)}
                    />
                  </div>
                </div>
              </>
            )}
            <span className="help-text">
              Applies only to this export run and does not save into presets.
            </span>
          </div>

        </div>

        <div className="actions">
          <button className="btn btn-secondary" onClick={handleStartCreatePreset}>
            {showBuilder && !editingPresetId ? 'Hide New Preset' : 'Create New Preset'}
          </button>
          <button
            className="btn btn-primary"
            onClick={handleCreatePlan}
            disabled={selectedPresetIds.length === 0}
          >
            Run Selected Exports ({selectedPresetIds.length})
          </button>
        </div>
      </div>
    </div>
  );
}
