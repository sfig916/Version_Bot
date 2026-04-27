/**
 * Preset selector component
 */

import React, { useEffect, useState } from 'react';
import { VideoMetadata, OutputPreset, AssetReference } from '../../core/models/types';
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
  position: 'tl' | 'tr' | 'bl' | 'br';
  source: 'local' | 'mediasilo';
  mediaSiloId?: string;
  path?: string;
}

const PREPEND_LIBRARY_STORAGE_KEY = 'version-bot-prepend-library';
const APPEND_LIBRARY_STORAGE_KEY = 'version-bot-append-library';
const OVERLAY_LIBRARY_STORAGE_KEY = 'version-bot-overlay-library';

const RESOLUTION_OPTIONS = [
  { value: '3840x2160', label: '16:9 4K', width: 3840, height: 2160 },
  { value: '1920x1080', label: '16:9', width: 1920, height: 1080 },
  { value: '1080x1920', label: '9:16', width: 1080, height: 1920 },
  { value: '1080x1080', label: '1:1', width: 1080, height: 1080 },
  { value: '1080x1350', label: '4:5', width: 1080, height: 1350 },
] as const;

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

function getBaseFilename(filePath: string): string {
  const normalized = filePath.replace(/\\/g, '/');
  const filename = normalized.split('/').pop() || filePath;
  const extensionIndex = filename.lastIndexOf('.');
  return extensionIndex > 0 ? filename.slice(0, extensionIndex) : filename;
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

interface PresetSelectorProps {
  video: VideoMetadata;
  presets: OutputPreset[];
  selectedPresetIds: string[];
  onPresetToggle: (presetId: string) => void;
  onCreatePlan: (
    outputDir: string,
    filenameTemplate: string,
    fileSizeConstraints: Record<string, number>,
    autoRun?: boolean
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
  const [filenameTemplate, setFilenameTemplate] = useState(
    '{source}_{preset}.{ext}'
  );
  const [isSelectingDir, setIsSelectingDir] = useState(false);
  const [draft, setDraft] = useState<PresetDraft>(INITIAL_DRAFT);
  const [editingPresetId, setEditingPresetId] = useState<string | null>(null);
  const [showBuilder, setShowBuilder] = useState(false);
  const [prependLibrary, setPrependLibrary] = useState<SlateAssetOption[]>([]);
  const [appendLibrary, setAppendLibrary] = useState<SlateAssetOption[]>([]);
  const [overlayLibrary, setOverlayLibrary] = useState<OverlayAssetOption[]>([]);
  const [assetOverrides, setAssetOverrides] = useState<Record<string, string>>({});
  const hasMaxFileSize = Number(draft.maxFileSizeMB || 0) > 0;

  const toAssetKey = (value: string): string =>
    value
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '');

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
  };

  useEffect(() => {
    try {
      const prependRaw = window.localStorage.getItem(PREPEND_LIBRARY_STORAGE_KEY);
      const appendRaw = window.localStorage.getItem(APPEND_LIBRARY_STORAGE_KEY);
      const overlayRaw = window.localStorage.getItem(OVERLAY_LIBRARY_STORAGE_KEY);

      if (prependRaw) {
        setPrependLibrary(
          (JSON.parse(prependRaw) as Partial<SlateAssetOption>[]).map(
            normalizeLibraryItem
          )
        );
      }

      if (appendRaw) {
        setAppendLibrary(
          (JSON.parse(appendRaw) as Partial<SlateAssetOption>[]).map(
            normalizeLibraryItem
          )
        );
      }

      if (overlayRaw) {
        setOverlayLibrary(
          (JSON.parse(overlayRaw) as Partial<OverlayAssetOption>[]).map(
            normalizeOverlayItem
          )
        );
      }
    } catch (error) {
      console.warn('Failed to load local asset libraries', error);
    }
  }, []);

  useEffect(() => {
    const loadOverrides = async () => {
      try {
        const result = await window.versionBotAPI.getAssetOverrides();
        if (result.success && result.data) {
          setAssetOverrides(result.data);
        }
      } catch (error) {
        console.warn('Failed to load asset overrides', error);
      }
    };

    loadOverrides();
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

    onCreatePlan(outputDir, filenameTemplate, constraints, true);
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

  const persistPrependLibrary = (next: SlateAssetOption[]) => {
    setPrependLibrary(next);
    window.localStorage.setItem(PREPEND_LIBRARY_STORAGE_KEY, JSON.stringify(next));
  };

  const persistAppendLibrary = (next: SlateAssetOption[]) => {
    setAppendLibrary(next);
    window.localStorage.setItem(APPEND_LIBRARY_STORAGE_KEY, JSON.stringify(next));
  };

  const persistOverlayLibrary = (next: OverlayAssetOption[]) => {
    setOverlayLibrary(next);
    window.localStorage.setItem(OVERLAY_LIBRARY_STORAGE_KEY, JSON.stringify(next));
  };

  const getDefaultAssetName = (filePath: string): string => {
    const normalized = filePath.replace(/\\/g, '/');
    const filename = normalized.split('/').pop() || filePath;
    const extensionIndex = filename.lastIndexOf('.');
    return extensionIndex > 0 ? filename.slice(0, extensionIndex) : filename;
  };

  const detectAssetDuration = async (filePath: string): Promise<number> => {
    try {
      const result = await window.versionBotAPI.probeVideo(filePath);
      if (result.success && result.data?.duration) {
        return Math.max(1, result.data.duration);
      }
    } catch {
      // Images and unsupported formats should gracefully fall back.
    }

    return 3;
  };

  const addAssetToLibrary = async (type: 'intro' | 'outro') => {
    const selectedPath = await window.versionBotAPI.selectAssetFile('video');
    if (!selectedPath) {
      return;
    }

    const suggestedName = getDefaultAssetName(selectedPath);
    const chosenName = window.prompt('Asset name', suggestedName)?.trim() || suggestedName;
    const duration = await detectAssetDuration(selectedPath);
    const suggestedKey = toAssetKey(chosenName) || toAssetKey(suggestedName);
    const chosenKey = window.prompt('Shared asset key', suggestedKey)?.trim() || suggestedKey;

    const option: SlateAssetOption = {
      id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      name: chosenName,
      key: chosenKey,
      source: 'local',
      path: selectedPath,
      duration,
    };

    if (type === 'intro') {
      const next = [...prependLibrary, option];
      persistPrependLibrary(next);
      setDraft((prev) => ({
        ...prev,
        introEnabled: true,
        introAssetKey: option.key,
        introAssetSource: option.source,
        introMediaSiloId: '',
        introPath: option.path,
        introDuration: String(option.duration),
      }));
      return;
    }

    const next = [...appendLibrary, option];
    persistAppendLibrary(next);
    setDraft((prev) => ({
      ...prev,
      outroEnabled: true,
      outroAssetKey: option.key,
      outroAssetSource: option.source,
      outroMediaSiloId: '',
      outroPath: option.path,
      outroDuration: String(option.duration),
    }));
  };

  const addMediaSiloAssetToLibrary = (type: 'intro' | 'outro') => {
    const chosenName = window.prompt('MediaSilo asset name')?.trim();
    if (!chosenName) {
      return;
    }

    const suggestedKey = toAssetKey(chosenName);
    const chosenKey = window.prompt('Shared asset key', suggestedKey)?.trim() || suggestedKey;
    const mediaSiloId = window.prompt('MediaSilo asset ID (optional)')?.trim() || '';

    const option: SlateAssetOption = {
      id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      name: chosenName,
      key: chosenKey,
      source: 'mediasilo',
      mediaSiloId,
      duration: 3,
    };

    if (type === 'intro') {
      const next = [...prependLibrary, option];
      persistPrependLibrary(next);
      setDraft((prev) => ({
        ...prev,
        introEnabled: true,
        introAssetKey: option.key,
        introAssetSource: option.source,
        introMediaSiloId: option.mediaSiloId || '',
        introPath: '',
      }));
      return;
    }

    const next = [...appendLibrary, option];
    persistAppendLibrary(next);
    setDraft((prev) => ({
      ...prev,
      outroEnabled: true,
      outroAssetKey: option.key,
      outroAssetSource: option.source,
      outroMediaSiloId: option.mediaSiloId || '',
      outroPath: '',
    }));
  };

  const selectAssetFromLibrary = (
    type: 'intro' | 'outro',
    assetId: string
  ) => {
    const library = type === 'intro' ? prependLibrary : appendLibrary;
    const selectedAsset = library.find((item) => item.id === assetId);
    if (!selectedAsset) {
      return;
    }

    if (type === 'intro') {
      setDraft((prev) => ({
        ...prev,
        introEnabled: true,
        introAssetKey: selectedAsset.key,
        introAssetSource: selectedAsset.source,
        introMediaSiloId: selectedAsset.mediaSiloId || '',
        introPath: selectedAsset.path || '',
      }));
      return;
    }

    setDraft((prev) => ({
      ...prev,
      outroEnabled: true,
      outroAssetKey: selectedAsset.key,
      outroAssetSource: selectedAsset.source,
      outroMediaSiloId: selectedAsset.mediaSiloId || '',
      outroPath: selectedAsset.path || '',
    }));
  };

  const setLocalAssetOverride = async (type: 'intro' | 'outro' | 'overlay') => {
    let key = '';
    if (type === 'intro') {
      key = draft.introAssetKey.trim();
    } else if (type === 'outro') {
      key = draft.outroAssetKey.trim();
    } else {
      key = draft.overlayAssetKey.trim();
    }

    if (!key) {
      alert('Set a shared asset key first');
      return;
    }

    const fileType = type === 'overlay' ? 'image' : 'video';
    const selectedPath = await window.versionBotAPI.selectAssetFile(fileType);
    if (!selectedPath) {
      return;
    }

    const overrideResult = await window.versionBotAPI.setAssetOverride(key, selectedPath);
    if (!overrideResult.success || !overrideResult.data) {
      alert(`Failed to save local override: ${overrideResult.error || 'unknown error'}`);
      return;
    }

    setAssetOverrides(overrideResult.data);

    if (type === 'intro') {
      setDraft((prev) => ({
        ...prev,
        introPath: selectedPath,
      }));
      return;
    }

    if (type === 'outro') {
      setDraft((prev) => ({
        ...prev,
        outroPath: selectedPath,
      }));
      return;
    }

    setDraft((prev) => ({
      ...prev,
      overlayPath: selectedPath,
    }));
  };

  const createAssetRef = (
    key: string,
    source: 'local' | 'mediasilo',
    mediaSiloId?: string
  ): AssetReference | undefined => {
    const normalizedKey = key.trim();
    if (!normalizedKey) {
      return undefined;
    }

    return {
      key: normalizedKey,
      source,
      mediaSiloId: mediaSiloId?.trim() || undefined,
    };
  };

  const browseOverlayAsset = async () => {
    const selectedPath = await window.versionBotAPI.selectAssetFile('image');
    if (!selectedPath) {
      return;
    }

    setDraft((prev) => ({
      ...prev,
      overlayEnabled: true,
      overlayPath: selectedPath,
    }));
  };

  const addOverlayToLibrary = async (position: 'tl' | 'tr' | 'bl' | 'br') => {
    const selectedPath = await window.versionBotAPI.selectAssetFile('image');
    if (!selectedPath) {
      return;
    }

    const positionName = {
      tl: 'Top Left',
      tr: 'Top Right',
      bl: 'Bottom Left',
      br: 'Bottom Right',
    }[position];

    const suggestedName = `ESRB - ${positionName}`;
    const chosenName = window.prompt('Overlay name', suggestedName)?.trim() || suggestedName;
    const suggestedKey = toAssetKey(chosenName) || toAssetKey(positionName);
    const chosenKey = window.prompt('Shared asset key', suggestedKey)?.trim() || suggestedKey;

    const option: OverlayAssetOption = {
      id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      name: chosenName,
      key: chosenKey,
      position,
      source: 'local',
      path: selectedPath,
    };

    const next = [...overlayLibrary, option];
    persistOverlayLibrary(next);
    setDraft((prev) => ({
      ...prev,
      overlayEnabled: true,
      overlayAssetKey: option.key,
      overlayAssetSource: option.source,
      overlayMediaSiloId: '',
      overlayPath: option.path,
      overlayPosition: option.position,
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
    const suggestedKey = toAssetKey(chosenName);
    const chosenKey = window.prompt('Shared asset key', suggestedKey)?.trim() || suggestedKey;
    const mediaSiloId = window.prompt('MediaSilo asset ID (optional)')?.trim() || '';

    const option: OverlayAssetOption = {
      id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      name: chosenName,
      key: chosenKey,
      position,
      source: 'mediasilo',
      mediaSiloId,
    };

    const next = [...overlayLibrary, option];
    persistOverlayLibrary(next);
    setDraft((prev) => ({
      ...prev,
      overlayEnabled: true,
      overlayAssetKey: option.key,
      overlayAssetSource: option.source,
      overlayMediaSiloId: option.mediaSiloId || '',
      overlayPath: '',
      overlayPosition: option.position,
    }));
  };

  const selectOverlayFromLibrary = (overlayId: string) => {
    const selectedOverlay = overlayLibrary.find((item) => item.id === overlayId);
    if (!selectedOverlay) {
      return;
    }

    setDraft((prev) => ({
      ...prev,
      overlayEnabled: true,
      overlayAssetKey: selectedOverlay.key,
      overlayAssetSource: selectedOverlay.source,
      overlayMediaSiloId: selectedOverlay.mediaSiloId || '',
      overlayPath: selectedOverlay.path || '',
      overlayPosition: selectedOverlay.position,
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
            assetPath:
              draft.introAssetSource === 'local'
                ? draft.introPath.trim() || undefined
                : undefined,
            assetRef: createAssetRef(
              draft.introAssetKey,
              draft.introAssetSource,
              draft.introMediaSiloId
            ),
          }
        : undefined,
      outroSlate: draft.outroEnabled
        ? {
            enabled: true,
            assetPath:
              draft.outroAssetSource === 'local'
                ? draft.outroPath.trim() || undefined
                : undefined,
            assetRef: createAssetRef(
              draft.outroAssetKey,
              draft.outroAssetSource,
              draft.outroMediaSiloId
            ),
          }
        : undefined,
      overlay: draft.overlayEnabled
        ? {
            enabled: true,
            assetPath:
              draft.overlayAssetSource === 'local'
                ? draft.overlayPath.trim() || undefined
                : undefined,
            assetRef: createAssetRef(
              draft.overlayAssetKey,
              draft.overlayAssetSource,
              draft.overlayMediaSiloId
            ),
            position: draft.overlayPosition,
            duration: Number(draft.overlayDuration) || 4,
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
    setEditingPresetId(preset.id);
    setShowBuilder(true);
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
      introAssetKey:
        preset.introSlate?.assetRef?.key ||
        toAssetKey(getBasename(preset.introSlate?.assetPath)) ||
        '',
      introAssetSource: preset.introSlate?.assetRef?.source || 'local',
      introMediaSiloId: preset.introSlate?.assetRef?.mediaSiloId || '',
      introPath: preset.introSlate?.assetPath || '',
      outroEnabled: !!preset.outroSlate?.enabled,
      outroAssetKey:
        preset.outroSlate?.assetRef?.key ||
        toAssetKey(getBasename(preset.outroSlate?.assetPath)) ||
        '',
      outroAssetSource: preset.outroSlate?.assetRef?.source || 'local',
      outroMediaSiloId: preset.outroSlate?.assetRef?.mediaSiloId || '',
      outroPath: preset.outroSlate?.assetPath || '',
      overlayEnabled: !!preset.overlay?.enabled,
      overlayAssetKey:
        preset.overlay?.assetRef?.key ||
        toAssetKey(getBasename(preset.overlay?.assetPath)) ||
        '',
      overlayAssetSource: preset.overlay?.assetRef?.source || 'local',
      overlayMediaSiloId: preset.overlay?.assetRef?.mediaSiloId || '',
      overlayPath: preset.overlay?.assetPath || '',
      overlayPosition: preset.overlay?.position || 'br',
      overlayDuration: String(preset.overlay?.duration || 4),
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

  const getSlateDisplay = (slate?: OutputPreset['introSlate']): string => {
    if (!slate?.enabled) {
      return 'None';
    }

    if (slate.assetPath) {
      return getBasename(slate.assetPath);
    }

    if (slate.assetRef?.key) {
      return slate.assetRef.key;
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

    if (!preset.overlay.assetPath && !preset.overlay.assetRef?.key) {
      const positionMap: Record<string, string> = {
        tl: 'Top Left',
        tr: 'Top Right',
        bl: 'Bottom Left',
        br: 'Bottom Right',
      };

      return `${positionMap[preset.overlay.position] || preset.overlay.position} (Not selected)`;
    }

    const positionMap: Record<string, string> = {
      tl: 'Top Left',
      tr: 'Top Right',
      bl: 'Bottom Left',
      br: 'Bottom Right',
    };

    const overlayAsset = preset.overlay.assetPath
      ? getBasename(preset.overlay.assetPath)
      : preset.overlay.assetRef?.key || 'Not selected';
    return `${positionMap[preset.overlay.position] || preset.overlay.position} (${overlayAsset})`;
  };

  const isOverlayAssetMissing = (preset: OutputPreset): boolean => {
    if (!preset.overlay?.enabled) {
      return false;
    }

    return !preset.overlay.assetPath && !preset.overlay.assetRef?.key;
  };

  const getOutputFilenamePreview = (preset: OutputPreset): string => {
    const timestamp = new Date().toISOString().split('T')[0];
    return filenameTemplate
      .replace(/{source}/g, getBaseFilename(video.filePath))
      .replace(/{presetId}/g, preset.id)
      .replace(/{preset}/g, preset.id)
      .replace(/{name}/g, preset.name)
      .replace(/{width}x{height}/g, `${preset.width}x${preset.height}`)
      .replace(/{timestamp}/g, timestamp)
      .replace(/{ext}/g, preset.container);
  };

  return (
    <div className="preset-selector">
      <button className="btn btn-secondary" onClick={onBack}>
        ← Back
      </button>

      <div className="preset-selector-content">
        <h2>Select Export Presets</h2>
        <p className="preset-summary">
          Showing {presets.length} presets matching the source aspect ratio. Matching presets are preselected.
        </p>

        <div className="video-info">
          <h3>Source Video</h3>
          <div className="video-stats-row">
            <span>
              <strong>Resolution:</strong> {video.width}x{video.height}
            </span>
            <span>
              <strong>Aspect Ratio:</strong> {formatAspectRatioLabel(video.width, video.height)}
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
                <th>Select</th>
                <th>Output Filename</th>
                <th>Resolution</th>
                <th>Target Bitrate</th>
                <th>Max Filesize</th>
                <th>Output FPS</th>
                <th>Upfront Card</th>
                <th>Endcard</th>
                <th>Codec/Format</th>
                <th>Audio Specs</th>
                <th>ESRB Overlay</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {presets.map((preset) => {
                const isSelected = selectedPresetIds.includes(preset.id);
                return (
                  <tr key={preset.id} className={isSelected ? 'row-selected' : ''}>
                    <td>
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => onPresetToggle(preset.id)}
                      />
                    </td>
                    <td className="filename-cell" title={getOutputFilenamePreview(preset)}>
                      {getOutputFilenamePreview(preset)}
                    </td>
                    <td>{preset.width}x{preset.height}</td>
                    <td>{formatVideoBitrateMbps(preset.bitrate)} Mbps</td>
                    <td>
                      {preset.maxFileSizeMB && preset.maxFileSizeMB > 0
                        ? `${preset.maxFileSizeMB} MB`
                        : 'No limit'}
                    </td>
                    <td>59.94</td>
                    <td className={isSlateMissing(preset.introSlate) ? 'overlay-missing' : ''}>
                      {getSlateDisplay(preset.introSlate)}
                    </td>
                    <td className={isSlateMissing(preset.outroSlate) ? 'overlay-missing' : ''}>
                      {getSlateDisplay(preset.outroSlate)}
                    </td>
                    <td>{preset.videoCodec.toUpperCase()} / {preset.container.toUpperCase()}</td>
                    <td>AAC @ {preset.audioBitrate || 320} kbps / 48kHz</td>
                    <td className={isOverlayAssetMissing(preset) ? 'overlay-missing' : ''}>
                      {getOverlayDisplay(preset)}
                    </td>
                    <td className="preset-row-actions">
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
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {showBuilder && (
          <div className="preset-builder">
            <h3>{editingPresetId ? 'Update Preset' : 'Create Custom Preset'}</h3>

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
              <label>Resolution</label>
              <select
                value={getResolutionOptionValue(draft.width, draft.height)}
                onChange={(e) => setResolutionOption(e.target.value)}
              >
                {RESOLUTION_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
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
                <>
                  <div className="input-group">
                    <select
                      value={
                        prependLibrary.find(
                          (asset) =>
                            (draft.introAssetKey &&
                              asset.key === draft.introAssetKey &&
                              asset.source === draft.introAssetSource) ||
                            (!draft.introAssetKey && asset.path === draft.introPath)
                        )?.id || ''
                      }
                      onChange={(event) =>
                        selectAssetFromLibrary('intro', event.target.value)
                      }
                    >
                      <option value="">Select from prepend library</option>
                      {prependLibrary.map((asset) => (
                        <option key={asset.id} value={asset.id}>
                          {asset.name} ({asset.source === 'mediasilo' ? 'MediaSilo' : 'Local'})
                        </option>
                      ))}
                    </select>
                    <button
                      className="btn btn-small btn-secondary"
                      type="button"
                      onClick={() => addAssetToLibrary('intro')}
                    >
                      Add File
                    </button>
                    <button
                      className="btn btn-small btn-secondary"
                      type="button"
                      onClick={() => addMediaSiloAssetToLibrary('intro')}
                    >
                      Add MediaSilo
                    </button>
                  </div>
                  <input
                    type="text"
                    placeholder="Shared asset key"
                    value={draft.introAssetKey}
                    onChange={(e) => updateDraft('introAssetKey', e.target.value)}
                  />
                  <select
                    value={draft.introAssetSource}
                    onChange={(e) =>
                      updateDraft('introAssetSource', e.target.value as 'local' | 'mediasilo')
                    }
                  >
                    <option value="local">Local</option>
                    <option value="mediasilo">MediaSilo</option>
                  </select>
                  {draft.introAssetSource === 'mediasilo' && (
                    <input
                      type="text"
                      placeholder="MediaSilo asset ID (optional)"
                      value={draft.introMediaSiloId}
                      onChange={(e) => updateDraft('introMediaSiloId', e.target.value)}
                    />
                  )}
                  <input
                    type="text"
                    placeholder="Intro asset path"
                    value={draft.introPath}
                    readOnly
                  />
                  {draft.introAssetKey && (
                    <div className="local-override-row">
                      <span>
                        Local override: {assetOverrides[draft.introAssetKey] || 'Not set'}
                      </span>
                      <button
                        className="btn btn-small btn-secondary"
                        type="button"
                        onClick={() => setLocalAssetOverride('intro')}
                      >
                        Set Local Path
                      </button>
                    </div>
                  )}
                </>
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
                <>
                  <div className="input-group">
                    <select
                      value={
                        appendLibrary.find(
                          (asset) =>
                            (draft.outroAssetKey &&
                              asset.key === draft.outroAssetKey &&
                              asset.source === draft.outroAssetSource) ||
                            (!draft.outroAssetKey && asset.path === draft.outroPath)
                        )?.id || ''
                      }
                      onChange={(event) =>
                        selectAssetFromLibrary('outro', event.target.value)
                      }
                    >
                      <option value="">Select from append library</option>
                      {appendLibrary.map((asset) => (
                        <option key={asset.id} value={asset.id}>
                          {asset.name} ({asset.source === 'mediasilo' ? 'MediaSilo' : 'Local'})
                        </option>
                      ))}
                    </select>
                    <button
                      className="btn btn-small btn-secondary"
                      type="button"
                      onClick={() => addAssetToLibrary('outro')}
                    >
                      Add File
                    </button>
                    <button
                      className="btn btn-small btn-secondary"
                      type="button"
                      onClick={() => addMediaSiloAssetToLibrary('outro')}
                    >
                      Add MediaSilo
                    </button>
                  </div>
                  <input
                    type="text"
                    placeholder="Shared asset key"
                    value={draft.outroAssetKey}
                    onChange={(e) => updateDraft('outroAssetKey', e.target.value)}
                  />
                  <select
                    value={draft.outroAssetSource}
                    onChange={(e) =>
                      updateDraft('outroAssetSource', e.target.value as 'local' | 'mediasilo')
                    }
                  >
                    <option value="local">Local</option>
                    <option value="mediasilo">MediaSilo</option>
                  </select>
                  {draft.outroAssetSource === 'mediasilo' && (
                    <input
                      type="text"
                      placeholder="MediaSilo asset ID (optional)"
                      value={draft.outroMediaSiloId}
                      onChange={(e) => updateDraft('outroMediaSiloId', e.target.value)}
                    />
                  )}
                  <input
                    type="text"
                    placeholder="Outro asset path"
                    value={draft.outroPath}
                    readOnly
                  />
                  {draft.outroAssetKey && (
                    <div className="local-override-row">
                      <span>
                        Local override: {assetOverrides[draft.outroAssetKey] || 'Not set'}
                      </span>
                      <button
                        className="btn btn-small btn-secondary"
                        type="button"
                        onClick={() => setLocalAssetOverride('outro')}
                      >
                        Set Local Path
                      </button>
                    </div>
                  )}
                </>
              )}!
            </div>

            <div className="asset-card">
              <label className="toggle-label">
                <input
                  type="checkbox"
                  checked={draft.overlayEnabled}
                  onChange={(e) =>
                    updateDraft('overlayEnabled', e.target.checked)
                  }
                />
                Enable Overlay
              </label>
              {draft.overlayEnabled && (
                <>
                  <div className="asset-grid">
                    <select
                      value={draft.overlayPosition}
                      onChange={(e) =>
                        updateDraft(
                          'overlayPosition',
                          e.target.value as 'tl' | 'tr' | 'bl' | 'br'
                        )
                      }
                    >
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
                      onChange={(e) => updateDraft('overlayDuration', e.target.value)}
                    />
                  </div>
                  <div className="input-group">
                    <select
                      value={
                        overlayLibrary.find(
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
                      {overlayLibrary
                        .filter((asset) => asset.position === draft.overlayPosition)
                        .map((asset) => (
                          <option key={asset.id} value={asset.id}>
                            {asset.name} ({asset.source === 'mediasilo' ? 'MediaSilo' : 'Local'})
                          </option>
                        ))}
                    </select>
                    <button
                      className="btn btn-small btn-secondary"
                      type="button"
                      onClick={() => addOverlayToLibrary(draft.overlayPosition)}
                    >
                      Add File
                    </button>
                    <button
                      className="btn btn-small btn-secondary"
                      type="button"
                      onClick={() => addMediaSiloOverlayToLibrary(draft.overlayPosition)}
                    >
                      Add MediaSilo
                    </button>
                  </div>
                  <input
                    type="text"
                    placeholder="Shared asset key"
                    value={draft.overlayAssetKey}
                    onChange={(e) => updateDraft('overlayAssetKey', e.target.value)}
                  />
                  <select
                    value={draft.overlayAssetSource}
                    onChange={(e) =>
                      updateDraft('overlayAssetSource', e.target.value as 'local' | 'mediasilo')
                    }
                  >
                    <option value="local">Local</option>
                    <option value="mediasilo">MediaSilo</option>
                  </select>
                  {draft.overlayAssetSource === 'mediasilo' && (
                    <input
                      type="text"
                      placeholder="MediaSilo asset ID (optional)"
                      value={draft.overlayMediaSiloId}
                      onChange={(e) => updateDraft('overlayMediaSiloId', e.target.value)}
                    />
                  )}
                  <input
                    type="text"
                    placeholder="Overlay asset path"
                    value={draft.overlayPath}
                    readOnly
                  />
                  {draft.overlayAssetKey && (
                    <div className="local-override-row">
                      <span>
                        Local override: {assetOverrides[draft.overlayAssetKey] || 'Not set'}
                      </span>
                      <button
                        className="btn btn-small btn-secondary"
                        type="button"
                        onClick={() => setLocalAssetOverride('overlay')}
                      >
                        Set Local Path
                      </button>
                    </div>
                  )}
                </>
              )}
            </div>
            </div>

            <div className="builder-actions">
              <button className="btn btn-secondary" onClick={handleSavePreset}>
                {editingPresetId ? 'Save Preset Changes' : 'Add Preset'}
              </button>
              <button className="btn" onClick={handleCancelEdit}>
                Cancel
              </button>
            </div>
          </div>
        )}

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
            <label>
              Filename Template
              <span className="help-text">
                Tokens: {'{source}'} = uploaded filename, {'{preset}'} = preset ID (snake_case), {'{ext}'} = file extension
              </span>
            </label>
            <input
              type="text"
              value={filenameTemplate}
              onChange={(e) => setFilenameTemplate(e.target.value)}
            />
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
