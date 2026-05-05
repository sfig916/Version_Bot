/**
 * Preset loader and validator
 * Loads presets from JSON/YAML files with validation
 */

import fs from 'fs';
import path from 'path';
import yaml from 'yaml';
import { z } from 'zod';
import { OutputPreset, SlateConfig, OverlayConfig } from '../models/types';

const ALLOWED_OUTPUT_FPS = [60, 59.94, 30, 29.97] as const;

function normalizeLoadedFps(value: number): OutputPreset['fps'] {
  if (value === 60 || value === 59.94 || value === 30 || value === 29.97) {
    return value;
  }
  return 59.94;
}

// Zod validation schemas
const slateConfigSchema = z
  .object({
    enabled: z.boolean().default(false),
    assetPath: z.string().optional(),
    assetRef: z
      .object({
        key: z.string().min(1),
        source: z.enum(['mediasilo', 'local']),
        mediaSiloId: z.string().optional(),
        fallbackRelativePath: z.string().optional(),
      })
      .optional(),
    duration: z.number().positive().optional(),
  });

const overlayConfigSchema = z
  .object({
    enabled: z.boolean().default(false),
    assetPath: z.string().optional(),
    assetRef: z
      .object({
        key: z.string().min(1),
        source: z.enum(['mediasilo', 'local']),
        mediaSiloId: z.string().optional(),
        fallbackRelativePath: z.string().optional(),
      })
      .optional(),
    duration: z.number().positive().default(4),
  });

const outputPresetSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    width: z.coerce.number().positive().int().default(1920),
    height: z.coerce.number().positive().int().default(1080),
    scalingMode: z.enum(['scale', 'pillarbox', 'letterbox', 'crop']).default('scale'),
    bitrate: z.coerce.number().positive().default(50000),
    videoCodec: z.enum(['h264', 'h265', 'hevc', 'vp9', 'av1']).default('h264'),
    crf: z.number().min(0).max(51).optional(),
    audioBitrate: z.coerce.number().positive().default(320),
    audioCodec: z.enum(['aac', 'libopus', 'libvorbis', 'mp3']).default('aac'),
    container: z.enum(['mp4', 'webm', 'mov', 'mkv']).default('mp4'),
    fps: z.coerce
      .number()
      .refine((value) => ALLOWED_OUTPUT_FPS.includes(value as (typeof ALLOWED_OUTPUT_FPS)[number]), {
        message: 'fps must be one of: 60, 59.94, 30, 29.97',
      })
      .default(59.94),
    maxFileSizeMB: z.coerce.number().min(0).optional(),
    introSlate: slateConfigSchema.optional(),
    outroSlate: slateConfigSchema.optional(),
    overlay: overlayConfigSchema.optional(),
  });

const presetsFileSchema = z.object({
  presets: z.array(outputPresetSchema),
  metadata: z
    .object({
      version: z.string(),
      description: z.string().optional(),
    })
    .optional(),
});

export type PresetsFileSchema = z.infer<typeof presetsFileSchema>;

/**
 * Load presets from JSON or YAML file
 */
export async function loadPresetsFromFile(
  filePath: string
): Promise<OutputPreset[]> {
  const extension = path.extname(filePath).toLowerCase();
  const content = fs.readFileSync(filePath, 'utf-8');

  let data: unknown;

  if (extension === '.json') {
    data = JSON.parse(content);
  } else if (extension === '.yaml' || extension === '.yml') {
    data = yaml.parse(content);
  } else {
    throw new Error(`Unsupported preset file format: ${extension}`);
  }

  const topLevel = z
    .object({
      presets: z.array(z.unknown()),
      metadata: z
        .object({
          version: z.string(),
          description: z.string().optional(),
        })
        .optional(),
    })
    .parse(data);

  const validPresets: OutputPreset[] = [];
  const invalidSummaries: string[] = [];

  topLevel.presets.forEach((rawPreset, index) => {
    const parsedPreset = outputPresetSchema.safeParse(rawPreset);
    if (parsedPreset.success) {
      validPresets.push({
        ...parsedPreset.data,
        fps: normalizeLoadedFps(parsedPreset.data.fps),
      });
      return;
    }

    const firstIssue = parsedPreset.error.issues[0];
    const issuePath = firstIssue?.path?.length
      ? `[${firstIssue.path.join('.')}] `
      : '';
    invalidSummaries.push(
      `index ${index}: ${issuePath}${firstIssue?.message || 'invalid preset'}`
    );
  });

  if (invalidSummaries.length > 0) {
    console.warn(
      `[presetLoader] Skipped ${invalidSummaries.length} invalid preset(s) from ${filePath}: ${invalidSummaries.join('; ')}`
    );
  }

  if (topLevel.presets.length > 0 && validPresets.length === 0) {
    throw new Error(`All presets in ${filePath} are invalid`);
  }

  return validPresets;
}

/**
 * Save presets to file
 */
export async function savePresetsToFile(
  presets: OutputPreset[],
  filePath: string,
  format: 'json' | 'yaml' = 'json'
): Promise<void> {
  const normalizedPresets = presets.map((preset) => outputPresetSchema.parse(preset));

  const data: PresetsFileSchema = {
    metadata: {
      version: '1.0',
      description: 'Video export presets for Version Bot',
    },
    presets: normalizedPresets,
  };

  let content: string;
  if (format === 'json') {
    content = JSON.stringify(data, null, 2);
  } else {
    content = yaml.stringify(data, { indent: 2 });
  }

  fs.writeFileSync(filePath, content, 'utf-8');
}

/**
 * Validate a single preset
 */
export function validatePreset(preset: unknown): OutputPreset {
  const parsed = outputPresetSchema.parse(preset);
  return {
    ...parsed,
    fps: normalizeLoadedFps(parsed.fps),
  };
}

/**
 * List all preset files in a directory
 */
export function listPresetFiles(dirPath: string): string[] {
  if (!fs.existsSync(dirPath)) {
    return [];
  }

  return fs
    .readdirSync(dirPath)
    .filter(
      (file) =>
        file.endsWith('.json') ||
        file.endsWith('.yaml') ||
        file.endsWith('.yml')
    )
    .map((file) => path.join(dirPath, file));
}

/**
 * Load all presets from a directory
 */
export async function loadPresetsFromDirectory(
  dirPath: string
): Promise<OutputPreset[]> {
  const files = listPresetFiles(dirPath);
  const allPresets: OutputPreset[] = [];

  for (const file of files) {
    const presets = await loadPresetsFromFile(file);
    allPresets.push(...presets);
  }

  // Ensure unique IDs
  const seen = new Set<string>();
  for (const preset of allPresets) {
    if (seen.has(preset.id)) {
      throw new Error(`Duplicate preset ID: ${preset.id}`);
    }
    seen.add(preset.id);
  }

  return allPresets;
}

/**
 * Create default example presets
 */
export function createExamplePresets(): OutputPreset[] {
  return [
    {
      id: 'landscape_16_9',
      name: '16:9',
      width: 1920,
      height: 1080,
      scalingMode: 'scale',
      bitrate: 50000,
      videoCodec: 'h264',
      audioBitrate: 320,
      audioCodec: 'aac',
      container: 'mp4',
      fps: 59.94,
    },
    {
      id: 'vertical_9_16',
      name: '9:16',
      width: 1080,
      height: 1920,
      scalingMode: 'scale',
      bitrate: 50000,
      videoCodec: 'h264',
      audioBitrate: 320,
      audioCodec: 'aac',
      container: 'mp4',
      fps: 59.94,
    },
    {
      id: 'square_1_1',
      name: '1:1',
      width: 1080,
      height: 1080,
      scalingMode: 'scale',
      bitrate: 50000,
      videoCodec: 'h264',
      audioBitrate: 320,
      audioCodec: 'aac',
      container: 'mp4',
      fps: 59.94,
    },
    {
      id: 'portrait_4_5',
      name: '4:5',
      width: 1080,
      height: 1350,
      scalingMode: 'scale',
      bitrate: 50000,
      videoCodec: 'h264',
      audioBitrate: 320,
      audioCodec: 'aac',
      container: 'mp4',
      fps: 59.94,
    },
  ];
}
