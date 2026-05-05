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

const FPS_OPTIONS = [60, 59.94, 30, 29.97] as const;

// Must match ffmpeg output frame rate (fps=60000/1001)
const OUTPUT_FPS = 59.94;

function normalizeFps(value: number | undefined): OutputPreset['fps'] {
  if (value === 60 || value === 59.94 || value === 30 || value === 29.97) {
    return value;
  }
  return 59.94;
}

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

function hasMatchingAspectRatio(sourceAspectRatio: number, width: number, height: number): boolean {
  if (!sourceAspectRatio || !Number.isFinite(sourceAspectRatio) || width <= 0 || height <= 0) {
    return true;
  }

  return Math.abs(sourceAspectRatio - (width / height)) < 0.01;
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
  fps: string;
  videoCodec: OutputPreset['videoCodec'];
  audioBitrate: string;
  audioCodec: OutputPreset['audioCodec'];
  maxFileSizeMB: string;
  introEnabled: boolean;
  introLibraryId: string;
  outroEnabled: boolean;
  outroLibraryId: string;
  overlayEnabled: boolean;
}

const INITIAL_DRAFT: PresetDraft = {
  id: '',
  name: '',
  width: '',
  height: '',
  scalingMode: 'scale',
  bitrate: '50',
  fps: '59.94',
  videoCodec: 'h264',
  audioBitrate: '320',
  audioCodec: 'aac',
  maxFileSizeMB: '',
  introEnabled: false,
  introLibraryId: '',
  outroEnabled: false,
  outroLibraryId: '',
  overlayEnabled: false,
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
  const [batchOverlayOverrideSecondsPart, setBatchOverlayOverrideSecondsPart] = useState('4');
  const [batchOverlayOverrideFramesPart, setBatchOverlayOverrideFramesPart] = useState('0');
  const [batchOverlayAssetLibraryId, setBatchOverlayAssetLibraryId] = useState('');
  const [hoveredPresetId, setHoveredPresetId] = useState<string | null>(null);
  const [pinnedDetailsPresetIds, setPinnedDetailsPresetIds] = useState<string[]>([]);
  const [showPreflightDetails, setShowPreflightDetails] = useState(false);
  const hasMaxFileSize = Number(draft.maxFileSizeMB || 0) > 0;
  const sortedPresets = presets.slice().sort((a, b) => a.name.localeCompare(b.name));
  const selectedPresets = sortedPresets.filter((preset) => selectedPresetIds.includes(preset.id));
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

    const overlayDurationOverrideSeconds = combineDurationPartsToSeconds(
      batchOverlayOverrideSecondsPart,
      batchOverlayOverrideFramesPart
    );

    onCreatePlan(
      outputDir,
      filenamePattern,
      constraints,
      true,
      overlayDurationOverrideSeconds > 0 ? overlayDurationOverrideSeconds : undefined,
      batchOverlayAssetLibraryId || undefined
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
    const fps = normalizeFps(Number(draft.fps));
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
    const preset: OutputPreset = {
      id: generatedPresetId,
      name: draft.name.trim(),
      width,
      height,
      scalingMode: 'scale',
      bitrate,
      fps,
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
    setDraft({
      id: preset.id,
      name: preset.name,
      width: String(preset.width),
      height: String(preset.height),
      scalingMode: 'scale',
      bitrate: formatVideoBitrateMbps(preset.bitrate),
      fps: String(normalizeFps(preset.fps)),
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
    return preset.overlay?.enabled ? 'Enabled' : 'Disabled';
  };

  const isOverlayAssetMissing = (preset: OutputPreset): boolean => {
    if (!preset.overlay?.enabled) {
      return false;
    }

    return !preset.overlay.assetPath && !preset.overlay.assetRef?.key;
  };

  const preflightIssues: Array<{ presetId?: string; message: string }> = (() => {
    const warnings: Array<{ presetId?: string; message: string }> = [];

    for (const preset of selectedPresets) {
      if (
        preset.scalingMode === 'scale'
        && !hasMatchingAspectRatio(video.aspectRatio, preset.width, preset.height)
      ) {
        warnings.push({
          presetId: preset.id,
          message: `${preset.name}: source aspect ratio ${formatAspectRatioLabel(video.width, video.height)} does not match output ${formatAspectRatioLabel(preset.width, preset.height)}.`,
        });
      }

      if (isSlateMissing(preset.introSlate)) {
        warnings.push({
          presetId: preset.id,
          message: `${preset.name}: prepend is enabled but no prepend asset is selected.`,
        });
      }

      if (isSlateMissing(preset.outroSlate)) {
        warnings.push({
          presetId: preset.id,
          message: `${preset.name}: append is enabled but no append asset is selected.`,
        });
      }
    }

    const overlayEnabledCount = selectedPresets.filter((preset) => preset.overlay?.enabled).length;
    if (overlayEnabledCount > 0 && !batchOverlayAssetLibraryId) {
      warnings.push({
        message: `Overlay is enabled on ${overlayEnabledCount} selected preset(s), but no export-time overlay asset is selected.`,
      });
    }

    if (batchOverlayAssetLibraryId && !overlayLibrary.some((item) => item.id === batchOverlayAssetLibraryId)) {
      warnings.push({
        message: 'Selected export-time overlay asset is not available in the current overlay library.',
      });
    }

    return warnings;
  })();

  const preflightAffectedPresetCount = new Set(
    preflightIssues
      .map((issue) => issue.presetId)
      .filter((presetId): presetId is string => Boolean(presetId))
  ).size;

  const renderPresetSpecs = (preset: OutputPreset) => {
    const targetBitrate = preset.maxFileSizeMB && preset.maxFileSizeMB > 0
      ? 'Auto'
      : `${formatVideoBitrateMbps(preset.bitrate)} Mbps`;
    const maxFileSize = preset.maxFileSizeMB && preset.maxFileSizeMB > 0
      ? `${preset.maxFileSizeMB} MB`
      : 'No limit';

    return (
      <div className="preset-specs-grid">
        <div className={`preset-spec-item ${isSlateMissing(preset.introSlate) ? 'overlay-missing' : ''}`}>
          <span>Prepend</span>
          <strong>{getIntroDisplay(preset.introSlate)}</strong>
        </div>
        <div className={`preset-spec-item ${isSlateMissing(preset.outroSlate) ? 'overlay-missing' : ''}`}>
          <span>Append</span>
          <strong>{getOutroDisplay(preset.outroSlate)}</strong>
        </div>
        <div className={`preset-spec-item ${isOverlayAssetMissing(preset) ? 'overlay-missing' : ''}`}>
          <span>ESRB Overlay</span>
          <strong>{getOverlayDisplay(preset)}</strong>
        </div>
        <div className="preset-spec-item">
          <span>Aspect Ratio</span>
          <strong>{formatAspectRatioLabel(preset.width, preset.height)}</strong>
        </div>
        <div className="preset-spec-item">
          <span>Resolution</span>
          <strong>{preset.width}x{preset.height}</strong>
        </div>
        <div className="preset-spec-item">
          <span>Target Bitrate</span>
          <strong>{targetBitrate}</strong>
        </div>
        <div className="preset-spec-item">
          <span>Max Filesize</span>
          <strong>{maxFileSize}</strong>
        </div>
        <div className="preset-spec-item">
          <span>FPS</span>
          <strong>{normalizeFps(preset.fps)}</strong>
        </div>
        <div className="preset-spec-item">
          <span>Codec/Format</span>
          <strong>{preset.videoCodec.toUpperCase()} / {preset.container.toUpperCase()}</strong>
        </div>
        <div className="preset-spec-item">
          <span>Audio Specs</span>
          <strong>{preset.audioCodec.toUpperCase()} @ {preset.audioBitrate || 320} kbps</strong>
        </div>
      </div>
    );
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
          <label>FPS</label>
          <select
            value={draft.fps}
            onChange={(e) => updateDraft('fps', e.target.value)}
          >
            {FPS_OPTIONS.map((fps) => (
              <option key={fps} value={String(fps)}>
                {fps}
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
            <p className="help-text">
              Overlay asset and duration are configured at export time.
            </p>
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
                <th className="preset-col-select">
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
                <th className="preset-col-name"><div className="preset-cell">Preset Name</div></th>
                <th className="preset-col-actions">
                  <div className="preset-cell preset-cell-actions">Actions</div>
                </th>
              </tr>
            </thead>
            <tbody>
              {sortedPresets.map((preset) => {
                const isSelected = selectedPresetIds.includes(preset.id);
                const isPinned = pinnedDetailsPresetIds.includes(preset.id);
                const showSpecs = isPinned || hoveredPresetId === preset.id;
                return (
                  <React.Fragment key={preset.id}>
                    <tr
                      className={isSelected ? 'row-selected' : ''}
                      onMouseEnter={() => setHoveredPresetId(preset.id)}
                      onMouseLeave={() => setHoveredPresetId((current) => (current === preset.id ? null : current))}
                    >
                      <td className="preset-col-select">
                        <div className="preset-cell preset-cell-select">
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => onPresetToggle(preset.id)}
                          />
                        </div>
                      </td>
                      <td className="preset-col-name">
                        <button
                          type="button"
                          className="preset-name-button"
                          onClick={() => {
                            setPinnedDetailsPresetIds((current) =>
                              current.includes(preset.id)
                                ? current.filter((id) => id !== preset.id)
                                : [...current, preset.id]
                            );
                          }}
                        >
                          <span className="preset-name-main">{preset.name}</span>
                          <span className="preset-name-hint">
                            {(isPinned ? 'Pinned (click to collapse)' : 'Hover or click to pin exact specs')}
                          </span>
                        </button>
                      </td>
                      <td className="preset-col-actions preset-row-actions-cell">
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
                    {showSpecs && (
                      <tr className="preset-specs-row">
                        <td colSpan={3}>
                          <div className="preset-specs-card">
                            {renderPresetSpecs(preset)}
                          </div>
                        </td>
                      </tr>
                    )}
                    {showBuilder && editingPresetId === preset.id && (
                      <tr className="preset-inline-editor-row">
                        <td colSpan={3}>{renderPresetBuilder('edit')}</td>
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
            <label>ESRB Overlay (applies to presets with Enable Overlay checked)</label>
            <div className="form-group" style={{ marginTop: '0.5rem' }}>
              <label>Overlay Asset</label>
              <select
                value={batchOverlayAssetLibraryId}
                onChange={(e) => setBatchOverlayAssetLibraryId(e.target.value)}
              >
                <option value="">— Select overlay asset —</option>
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
            <span className="help-text">
              Applies only to this export run for presets with Enable Overlay turned on, and does not save into presets.
            </span>
          </div>

        </div>

        {preflightIssues.length > 0 && (
          <div className="preflight-warning-panel" role="alert">
            <h3>Warning: potential asset mismatch</h3>
            <p>
              Export can still run, but {preflightAffectedPresetCount > 0 ? `${preflightAffectedPresetCount} selected preset(s)` : 'selected settings'} may fail or produce unexpected results.
            </p>
            <button
              type="button"
              className="preflight-toggle"
              onClick={() => setShowPreflightDetails((prev) => !prev)}
            >
              {showPreflightDetails ? 'Hide details' : `Show details (${preflightIssues.length})`}
            </button>
            {showPreflightDetails && (
              <ul>
                {preflightIssues.map((issue) => (
                  <li key={issue.message}>{issue.message}</li>
                ))}
              </ul>
            )}
          </div>
        )}

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
