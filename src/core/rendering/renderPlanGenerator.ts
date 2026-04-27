/**
 * Render plan generator
 * Creates a list of render jobs from video metadata and presets
 */

import { randomUUID } from 'crypto';
import path from 'path';
import {
  VideoMetadata,
  OutputPreset,
  RenderJob,
  RenderPlan,
  FileSizeConstraint,
} from '../models/types';
import { hasMatchingAspectRatio } from './aspectRatio';

export { hasMatchingAspectRatio } from './aspectRatio';

function getBaseFilename(filePath: string): string {
  const parsed = path.parse(filePath);
  return parsed.name;
}

/**
 * Calculate target bitrate based on file size constraint
 * Formula: min(current video bitrate, ((targetSizeMB * 8 * 1024 * 1024) / duration) - audio_bitrate)
 */
export function calculateAdjustedBitrate(
  constraint: FileSizeConstraint
): number {
  // Convert MB to bits
  const totalBits = constraint.maxSizeMB * 8 * 1024 * 1024;
  // Divide by duration to get bits per second (bps)
  const totalBps = totalBits / constraint.duration;
  // Convert to kbps
  const totalKbps = Math.round(totalBps / 1000);
  // Reserve the configured audio bitrate, then only clamp video downward.
  const maxVideoBitrate = Math.max(500, totalKbps - constraint.audioBitrate);
  return Math.min(constraint.currentBitrate, maxVideoBitrate);
}

/**
 * Check if output resolution fits within source aspect ratio
 * allowing for reasonable scaling modes
 */
export function isCompatibleResolution(
  sourceAR: number,
  outputWidth: number,
  outputHeight: number,
  scalingMode: string
): boolean {
  if (scalingMode === 'scale') {
    // Must match aspect ratio exactly
    return hasMatchingAspectRatio(sourceAR, outputWidth, outputHeight);
  }
  // pillarbox, letterbox, crop can use any resolution
  return true;
}

/**
 * Generate render jobs from presets
 */
export function generateRenderJobs(
  source: VideoMetadata,
  presets: OutputPreset[],
  outputDirTemplate: string,
  filenameTemplate: string
): RenderJob[] {
  return presets.map((preset) => {
    const jobId = randomUUID();

    // Validate preset resolution compatibility
    if (
      !isCompatibleResolution(
        source.aspectRatio,
        preset.width,
        preset.height,
        preset.scalingMode
      )
    ) {
      console.warn(
        `Preset ${preset.id} resolution ${preset.width}x${preset.height} may cause letterbox/pillarbox with source AR ${source.aspectRatio}`
      );
    }

    // Generate output filename
    const timestamp = new Date().toISOString().split('T')[0];
    const outputFilename = filenameTemplate
      .replace(/{source}/g, getBaseFilename(source.filePath))
      .replace(/{presetId}/g, preset.id)
      .replace(/{preset}/g, preset.id)
      .replace(/{name}/g, preset.name)
      .replace(/{width}x{height}/g, `${preset.width}x${preset.height}`)
      .replace(/{timestamp}/g, timestamp)
      .replace(/{ext}/g, preset.container);

    const outputPath = path.join(outputDirTemplate, outputFilename);

    const job: RenderJob = {
      id: jobId,
      source,
      preset,
      outputPath,
      maxFileSizeMB: Math.max(0, preset.maxFileSizeMB ?? 0),
      status: 'pending',
      progress: 0,
    };

    if (job.maxFileSizeMB > 0) {
      const constraint: FileSizeConstraint = {
        maxSizeMB: job.maxFileSizeMB,
        duration: job.source.duration,
        currentBitrate: job.preset.bitrate,
        audioBitrate: job.preset.audioBitrate,
        targetBitrate: 0,
      };

      job.adjustedBitrate = calculateAdjustedBitrate(constraint);
    }

    return job;
  });
}

/**
 * Apply file size constraints to render jobs
 */
export function applyFileSizeConstraints(
  jobs: RenderJob[],
  constraints: Map<string, number>
): void {
  jobs.forEach((job) => {
    if (constraints.has(job.preset.id)) {
      const maxSizeMB = constraints.get(job.preset.id)!;
      job.maxFileSizeMB = maxSizeMB;

      if (maxSizeMB > 0) {
        const constraint: FileSizeConstraint = {
          maxSizeMB,
          duration: job.source.duration,
          currentBitrate: job.preset.bitrate,
          audioBitrate: job.preset.audioBitrate,
          targetBitrate: 0,
        };

        const targetBitrate = calculateAdjustedBitrate(constraint);
        job.adjustedBitrate = targetBitrate;
      }
    }
  });
}

/**
 * Create a complete render plan from metadata and presets
 */
export function createRenderPlan(
  source: VideoMetadata,
  presets: OutputPreset[],
  outputDirTemplate: string,
  filenameTemplate: string = '{preset}_{width}x{height}_{timestamp}.{ext}',
  fileSizeConstraints?: Map<string, number>
): RenderPlan {
  const planId = randomUUID();
  const jobs = generateRenderJobs(
    source,
    presets,
    outputDirTemplate,
    filenameTemplate
  );

  if (fileSizeConstraints) {
    applyFileSizeConstraints(jobs, fileSizeConstraints);
  }

  const plan: RenderPlan = {
    id: planId,
    source,
    jobs,
    outputDirTemplate,
    filenameTemplate,
    status: 'pending',
    progress: 0,
    createdAt: new Date(),
    logs: [],
  };

  return plan;
}

/**
 * Calculate overall progress of a render plan
 */
export function calculatePlanProgress(plan: RenderPlan): number {
  if (plan.jobs.length === 0) return 0;
  const totalProgress = plan.jobs.reduce((sum, job) => sum + job.progress, 0);
  return Math.round(totalProgress / plan.jobs.length);
}

/**
 * Update plan status based on job statuses
 */
export function updatePlanStatus(plan: RenderPlan): void {
  if (plan.jobs.length === 0) {
    plan.status = 'pending';
    plan.progress = 0;
    return;
  }

  const statuses = plan.jobs.map((j) => j.status);

  if (statuses.includes('failed')) {
    plan.status = 'failed';
  } else if (statuses.includes('running')) {
    plan.status = 'running';
  } else if (statuses.every((s) => s === 'completed')) {
    plan.status = 'completed';
  } else if (statuses.includes('cancelled')) {
    plan.status = 'cancelled';
  }

  plan.progress = calculatePlanProgress(plan);
}
