/**
 * Tests for preset loading and validation
 */

import { describe, it, expect } from 'vitest';
import {
  validatePreset,
  createExamplePresets,
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
});
