/**
 * Preset loader and validator
 * Loads presets from JSON/YAML files with validation
 */

import fs from 'fs';
import path from 'path';
import yaml from 'yaml';
import { z } from 'zod';
import { OutputPreset, SlateConfig, OverlayConfig } from '../models/types';

// Zod validation schemas
const slateConfigSchema = z
  .object({
    enabled: z.boolean().default(false),
    assetPath: z.string().optional(),
    duration: z.number().positive(),
  })
  .strict();

const overlayConfigSchema = z
  .object({
    enabled: z.boolean().default(false),
    assetPath: z.string().optional(),
    position: z.enum(['tl', 'tr', 'bl', 'br']),
    widthPercent: z.number().min(1).max(100).default(20),
    duration: z.number().optional(),
    timing: z.enum(['start', 'end', 'full']).default('start'),
  })
  .strict();

const outputPresetSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    width: z.number().positive().int(),
    height: z.number().positive().int(),
    scalingMode: z.enum(['scale', 'pillarbox', 'letterbox', 'crop']),
    bitrate: z.number().positive(),
    videoCodec: z.enum(['h264', 'h265', 'hevc', 'vp9', 'av1']),
    crf: z.number().min(0).max(51).optional(),
    audioBitrate: z.number().positive(),
    audioCodec: z.enum(['aac', 'libopus', 'libvorbis', 'mp3']),
    container: z.enum(['mp4', 'webm', 'mov', 'mkv']),
    introSlate: slateConfigSchema.optional(),
    outroSlate: slateConfigSchema.optional(),
    overlay: overlayConfigSchema.optional(),
  })
  .strict();

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

  // Validate schema
  const validated = presetsFileSchema.parse(data);
  return validated.presets;
}

/**
 * Save presets to file
 */
export async function savePresetsToFile(
  presets: OutputPreset[],
  filePath: string,
  format: 'json' | 'yaml' = 'json'
): Promise<void> {
  const data: PresetsFileSchema = {
    metadata: {
      version: '1.0',
      description: 'Video export presets for Version Bot',
    },
    presets,
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
  return outputPresetSchema.parse(preset);
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
      id: 'hd_1080p',
      name: 'HD 1080p',
      width: 1920,
      height: 1080,
      scalingMode: 'letterbox',
      bitrate: 5000,
      videoCodec: 'h264',
      crf: 23,
      audioBitrate: 128,
      audioCodec: 'aac',
      container: 'mp4',
    },
    {
      id: 'hd_720p',
      name: 'HD 720p',
      width: 1280,
      height: 720,
      scalingMode: 'letterbox',
      bitrate: 2500,
      videoCodec: 'h264',
      crf: 23,
      audioBitrate: 128,
      audioCodec: 'aac',
      container: 'mp4',
    },
    {
      id: '4k_2160p',
      name: '4K 2160p',
      width: 3840,
      height: 2160,
      scalingMode: 'scale',
      bitrate: 15000,
      videoCodec: 'h265',
      crf: 23,
      audioBitrate: 192,
      audioCodec: 'aac',
      container: 'mp4',
    },
    {
      id: 'web_vp9',
      name: 'Web VP9',
      width: 1280,
      height: 720,
      scalingMode: 'letterbox',
      bitrate: 2000,
      videoCodec: 'vp9',
      audioBitrate: 128,
      audioCodec: 'libopus',
      container: 'webm',
      overlay: {
        enabled: true,
        position: 'br',
        widthPercent: 15,
        timing: 'full',
      },
    },
  ];
}
