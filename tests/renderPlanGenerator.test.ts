/**
 * Tests for render plan generator
 */

import { describe, it, expect } from 'vitest';
import {
  createRenderPlan,
  calculateAdjustedBitrate,
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
        targetBitrate: 0,
      };

      const bitrate = calculateAdjustedBitrate(constraint);
      expect(bitrate).toBeGreaterThan(0);
      expect(bitrate).toBe(6863);
    });

    it('should enforce minimum bitrate of 500 kbps', () => {
      const constraint = {
        maxSizeMB: 1, // Very small
        duration: 3600, // 1 hour
        currentBitrate: 5000,
        targetBitrate: 0,
      };

      const bitrate = calculateAdjustedBitrate(constraint);
      expect(bitrate).toBeGreaterThanOrEqual(500);
    });
  });

  describe('isCompatibleResolution', () => {
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

    it('should generate output paths from filename template', () => {
      const presets = [mockPreset];
      const template = '{preset}_{width}x{height}.{ext}';
      const plan = createRenderPlan(
        mockVideoMetadata,
        presets,
        '/output',
        template
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
