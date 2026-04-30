/**
 * Tests for render plan generator
 */

import { describe, it, expect } from 'vitest';
import path from 'path';
import {
  createRenderPlan,
  calculateAdjustedBitrate,
  hasMatchingAspectRatio,
  isCompatibleResolution,
  calculatePlanProgress,
  updatePlanStatus,
} from '../src/core/rendering/renderPlanGenerator';
import { VideoMetadata, OutputPreset } from '../src/core/models/types';

const mockVideoMetadata: VideoMetadata = {
  filePath: '/test/video.mp4',
  width: 1920,
  height: 1080,
  aspectRatio: 16 / 9,
  duration: 120,
  bitrate: 10000,
  codec: 'h264',
  fps: 30,
  audioCodec: 'aac',
  sampleRate: 48000,
};

const mockPreset: OutputPreset = {
  id: '1080p',
  name: 'HD 1080p',
  width: 1920,
  height: 1080,
  scalingMode: 'scale',
  bitrate: 5000,
  videoCodec: 'h264',
  audioBitrate: 128,
  audioCodec: 'aac',
  container: 'mp4',
};

describe('Render Plan Generator', () => {
  describe('calculateAdjustedBitrate', () => {
    it('should calculate bitrate from file size constraint', () => {
      const constraint = {
        maxSizeMB: 100,
        duration: 120,
        currentBitrate: 5000,
        audioBitrate: 128,
        targetBitrate: 0,
      };

      const bitrate = calculateAdjustedBitrate(constraint);
      expect(bitrate).toBeGreaterThan(0);
      expect(bitrate).toBe(5000);
    });

    it('should enforce minimum bitrate of 500 kbps', () => {
      const constraint = {
        maxSizeMB: 1, // Very small
        duration: 3600, // 1 hour
        currentBitrate: 5000,
        audioBitrate: 320,
        targetBitrate: 0,
      };

      const bitrate = calculateAdjustedBitrate(constraint);
      expect(bitrate).toBeGreaterThanOrEqual(500);
      expect(bitrate).toBe(500);
    });

    it('should reserve the configured audio bitrate from the size budget', () => {
      const bitrate = calculateAdjustedBitrate({
        maxSizeMB: 100,
        duration: 120,
        currentBitrate: 10000,
        audioBitrate: 320,
        targetBitrate: 0,
      });

      expect(bitrate).toBe(6671);
    });
  });

  describe('isCompatibleResolution', () => {
    it('should detect matching aspect ratios within tolerance', () => {
      expect(hasMatchingAspectRatio(16 / 9, 3840, 2160)).toBe(true);
      expect(hasMatchingAspectRatio(16 / 9, 1080, 1920)).toBe(false);
    });

    it('should accept matching aspect ratios for scale mode', () => {
      const sourceAR = 16 / 9; // 1.777...
      const result = isCompatibleResolution(
        sourceAR,
        1920,
        1080,
        'scale'
      );
      expect(result).toBe(true);
    });

    it('should accept different aspect ratios for letterbox mode', () => {
      const sourceAR = 4 / 3; // 1.333...
      const result = isCompatibleResolution(
        sourceAR,
        1920,
        1080,
        'letterbox'
      );
      expect(result).toBe(true);
    });

    it('should accept different aspect ratios for pillarbox mode', () => {
      const sourceAR = 21 / 9; // Ultra-wide
      const result = isCompatibleResolution(
        sourceAR,
        1920,
        1080,
        'pillarbox'
      );
      expect(result).toBe(true);
    });
  });

  describe('createRenderPlan', () => {
    it('should create plan with specified presets', () => {
      const presets = [mockPreset];
      const plan = createRenderPlan(
        mockVideoMetadata,
        presets,
        '/output'
      );

      expect(plan.jobs).toHaveLength(1);
      expect(plan.jobs[0].preset.id).toBe('1080p');
      expect(plan.status).toBe('pending');
    });

    it('should generate output paths from filename pattern', () => {
      const presets = [mockPreset];
      const pattern = '{preset}_{width}x{height}.{ext}';
      const plan = createRenderPlan(
        mockVideoMetadata,
        presets,
        '/output',
        pattern
      );

      expect(plan.jobs[0].outputPath).toContain('1080p');
      expect(plan.jobs[0].outputPath).toContain('1920x1080');
      expect(plan.jobs[0].outputPath).toContain('.mp4');
    });

    it('should apply file size constraints', () => {
      const presets = [mockPreset];
      const constraints = new Map([['1080p', 50]]);
      const plan = createRenderPlan(
        mockVideoMetadata,
        presets,
        '/output',
        '{preset}.{ext}',
        constraints
      );

      expect(plan.jobs[0].maxFileSizeMB).toBe(50);
      expect(plan.jobs[0].adjustedBitrate).toBeDefined();
    });

    it('should sanitize invalid filename characters for output paths', () => {
      const presetWithInvalidName: OutputPreset = {
        ...mockPreset,
        id: 'social_16x9',
        name: 'Social: 16/9? *Final*',
      };

      const plan = createRenderPlan(
        mockVideoMetadata,
        [presetWithInvalidName],
        '/output',
        '{name}.{ext}'
      );

      const outputFilename = path.basename(plan.jobs[0].outputPath);
      expect(outputFilename).not.toMatch(/[<>:"/\\|?*]/);
      expect(outputFilename.endsWith('.mp4')).toBe(true);
    });
  });

  describe('calculatePlanProgress', () => {
    it('should return 0 for empty plan', () => {
      const plan = createRenderPlan(mockVideoMetadata, [], '/output');
      expect(calculatePlanProgress(plan)).toBe(0);
    });

    it('should calculate average job progress', () => {
      const plan = createRenderPlan(
        mockVideoMetadata,
        [mockPreset, mockPreset],
        '/output'
      );

      plan.jobs[0].progress = 50;
      plan.jobs[1].progress = 100;

      const progress = calculatePlanProgress(plan);
      expect(progress).toBe(75);
    });
  });

  describe('updatePlanStatus', () => {
    it('should keep empty plan in pending status', () => {
      const plan = createRenderPlan(mockVideoMetadata, [], '/output');

      updatePlanStatus(plan);
      expect(plan.status).toBe('pending');
      expect(plan.progress).toBe(0);
    });

    it('should mark plan as completed when all jobs completed', () => {
      const plan = createRenderPlan(
        mockVideoMetadata,
        [mockPreset, mockPreset],
        '/output'
      );

      plan.jobs.forEach((job) => {
        job.status = 'completed';
        job.progress = 100;
      });

      updatePlanStatus(plan);
      expect(plan.status).toBe('completed');
      expect(plan.progress).toBe(100);
    });

    it('should mark plan as running when any job running', () => {
      const plan = createRenderPlan(
        mockVideoMetadata,
        [mockPreset, mockPreset],
        '/output'
      );

      plan.jobs[0].status = 'running';
      plan.jobs[0].progress = 50;
      plan.jobs[1].status = 'pending';

      updatePlanStatus(plan);
      expect(plan.status).toBe('running');
    });

    it('should mark plan as failed when any job failed', () => {
      const plan = createRenderPlan(
        mockVideoMetadata,
        [mockPreset, mockPreset],
        '/output'
      );

      plan.jobs[0].status = 'failed';
      plan.jobs[0].error = 'Encoding error';
      plan.jobs[1].status = 'completed';

      updatePlanStatus(plan);
      expect(plan.status).toBe('failed');
    });
  });
});
