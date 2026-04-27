/**
 * Tests for preset loading and validation
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import { describe, it, expect } from 'vitest';
import {
  validatePreset,
  createExamplePresets,
  loadPresetsFromFile,
} from '../src/core/presets/presetLoader';
import { OutputPreset } from '../src/core/models/types';

describe('Preset Loader', () => {
  it('should validate a valid preset', () => {
    const preset: OutputPreset = {
      id: 'test-1080p',
      name: 'Test 1080p',
      width: 1920,
      height: 1080,
      scalingMode: 'letterbox',
      bitrate: 5000,
      videoCodec: 'h264',
      audioBitrate: 128,
      audioCodec: 'aac',
      container: 'mp4',
    };

    const validated = validatePreset(preset);
    expect(validated.id).toBe('test-1080p');
    expect(validated.width).toBe(1920);
  });

  it('should reject preset with invalid codec', () => {
    const preset = {
      id: 'test-invalid',
      name: 'Invalid',
      width: 1920,
      height: 1080,
      scalingMode: 'letterbox' as const,
      bitrate: 5000,
      videoCodec: 'invalid-codec',
      audioBitrate: 128,
      audioCodec: 'aac',
      container: 'mp4',
    };

    expect(() => validatePreset(preset)).toThrow();
  });

  it('should create example presets', () => {
    const presets = createExamplePresets();
    expect(presets.length).toBeGreaterThan(0);
    expect(presets[0].id).toBeDefined();
    expect(presets[0].width).toBeGreaterThan(0);
    expect(presets[0].height).toBeGreaterThan(0);
  });

  it('should validate CRF values', () => {
    const preset: OutputPreset = {
      id: 'test-crf',
      name: 'Test CRF',
      width: 1920,
      height: 1080,
      scalingMode: 'scale',
      bitrate: 5000,
      videoCodec: 'h264',
      crf: 23,
      audioBitrate: 128,
      audioCodec: 'aac',
      container: 'mp4',
    };

    const validated = validatePreset(preset);
    expect(validated.crf).toBe(23);
  });

  it('should reject invalid CRF value', () => {
    const preset = {
      id: 'test-crf-invalid',
      name: 'Invalid CRF',
      width: 1920,
      height: 1080,
      scalingMode: 'scale' as const,
      bitrate: 5000,
      videoCodec: 'h264',
      crf: 100, // Invalid: must be 0-51
      audioBitrate: 128,
      audioCodec: 'aac',
      container: 'mp4',
    };

    expect(() => validatePreset(preset)).toThrow();
  });

  it('should accept legacy overlay fields and ignore unknown keys', () => {
    const preset = {
      id: 'legacy-overlay',
      name: 'Legacy Overlay',
      width: 1920,
      height: 1080,
      scalingMode: 'scale' as const,
      bitrate: 5000,
      videoCodec: 'h264' as const,
      audioBitrate: 320,
      audioCodec: 'aac' as const,
      container: 'mp4' as const,
      overlay: {
        enabled: true,
        assetPath: 'overlay.png',
        position: 'br' as const,
        duration: 4,
        widthPercent: 20,
        timing: 'start',
      },
    };

    const validated = validatePreset(preset);
    expect(validated.overlay?.enabled).toBe(true);
    expect(validated.overlay?.position).toBe('br');
    expect(validated.overlay?.duration).toBe(4);
  });

  it('should keep valid presets when one preset in file is invalid', async () => {
    const tempFile = path.join(
      os.tmpdir(),
      `version-bot-preset-loader-${Date.now()}-${Math.random().toString(16).slice(2)}.yaml`
    );

    const content = `metadata:\n  version: "1.0"\npresets:\n  - id: valid\n    name: Valid\n    width: 1920\n    height: 1080\n    scalingMode: scale\n    bitrate: 5000\n    videoCodec: h264\n    audioBitrate: 320\n    audioCodec: aac\n    container: mp4\n  - id: invalid\n    name: Invalid\n    width: 1920\n    height: 1080\n    scalingMode: scale\n    bitrate: 5000\n    videoCodec: not-a-codec\n    audioBitrate: 320\n    audioCodec: aac\n    container: mp4\n`;

    fs.writeFileSync(tempFile, content, 'utf-8');
    try {
      const presets = await loadPresetsFromFile(tempFile);
      expect(presets).toHaveLength(1);
      expect(presets[0].id).toBe('valid');
    } finally {
      fs.unlinkSync(tempFile);
    }
  });
});
