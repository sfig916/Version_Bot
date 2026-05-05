/**
 * FFmpeg execution runner
 * Runs FFmpeg commands for render jobs with progress tracking and cancellation
 */

import { spawn, ChildProcess } from 'child_process';
import path from 'path';
import fs from 'fs';
import { RenderJob, RenderPlan } from '../models/types';
import { buildFFmpegCommand } from './ffmpegCommandBuilder';

export interface JobProgress {
  jobId: string;
  progress: number;
  currentTime: number;
  fps: number;
  speed: string;
}

export interface JobResult {
  jobId: string;
  success: boolean;
  outputPath?: string;
  error?: string;
  durationMs: number;
}

export type ProgressCallback = (progress: JobProgress) => void;
export type CompleteCallback = (result: JobResult) => void;

const MAX_FILESIZE_RETRIES = 2;
const RETRY_BITRATE_SAFETY_MARGIN = 0.985;
const MIN_RETRY_VIDEO_BITRATE_KBPS = 500;

/**
 * Get ffmpeg binary path (prefers bundled ffmpeg-static)
 */
function getFFmpegPath(): string {
  function resolvePackagedBinaryPath(candidatePath: string): string {
    if (candidatePath.includes('app.asar')) {
      const unpackedPath = candidatePath.replace('app.asar', 'app.asar.unpacked');
      if (unpackedPath !== candidatePath && fs.existsSync(unpackedPath)) {
        return unpackedPath;
      }
    }

    if (fs.existsSync(candidatePath)) {
      return candidatePath;
    }

    return candidatePath;
  }

  try {
    const staticPath = require('ffmpeg-static') as string;
    return resolvePackagedBinaryPath(staticPath);
  } catch {
    return 'ffmpeg';
  }
}

/**
 * Parse FFmpeg progress line to extract current time in seconds
 * e.g. "frame=  30 fps=30 q=-1.0 size=     64kB time=00:00:01.00 ..."
 */
function parseProgress(line: string, duration: number): JobProgress | null {
  const timeMatch = line.match(/time=(\d{2}):(\d{2}):(\d{2})\.(\d{2})/);
  if (!timeMatch) return null;

  const h = parseInt(timeMatch[1], 10);
  const m = parseInt(timeMatch[2], 10);
  const s = parseInt(timeMatch[3], 10);
  const cs = parseInt(timeMatch[4], 10);
  const currentTime = h * 3600 + m * 60 + s + cs / 100;

  const fpsMatch = line.match(/fps=\s*([\d.]+)/);
  const fps = fpsMatch ? parseFloat(fpsMatch[1]) : 0;

  const speedMatch = line.match(/speed=\s*([\w.]+)/);
  const speed = speedMatch ? speedMatch[1] : '';

  const progress = duration > 0 ? Math.min(100, Math.round((currentTime / duration) * 100)) : 0;

  return { jobId: '', currentTime, fps, speed, progress };
}

/**
 * Run a single render job using FFmpeg
 */
export function runJob(
  job: RenderJob,
  onProgress?: ProgressCallback,
  onComplete?: CompleteCallback
): () => void {
  const ffmpegPath = getFFmpegPath();
  const targetMaxBytes =
    job.maxFileSizeMB > 0 ? Math.floor(job.maxFileSizeMB * 1024 * 1024) : 0;
  const initialBitrate = job.adjustedBitrate || job.preset.bitrate;
  const startTime = Date.now();

  // Ensure output directory exists
  const outputDir = path.dirname(job.outputPath);
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  let proc: ChildProcess | null = null;
  let cancelled = false;

  const startAttempt = (bitrateKbps: number, retryCount: number): void => {
    const attemptJob: RenderJob = {
      ...job,
      adjustedBitrate: bitrateKbps,
    };
    const command = buildFFmpegCommand(attemptJob);

    proc = spawn(ffmpegPath, command.args, { stdio: ['ignore', 'pipe', 'pipe'] });

    let stderr = '';

    proc.stderr?.on('data', (chunk: Buffer) => {
      const text = chunk.toString();
      stderr += text;

      // Emit progress from each progress line
      const lines = text.split('\r');
      for (const line of lines) {
        const progress = parseProgress(line, job.source.duration);
        if (progress && onProgress) {
          onProgress({ ...progress, jobId: job.id });
        }
      }
    });

    proc.on('close', (code) => {
      const durationMs = Date.now() - startTime;
      if (cancelled) return;

      if (code !== 0) {
        // Extract last meaningful error from stderr
        const errorLine = stderr
          .split('\n')
          .filter((l) => l.includes('Error') || l.includes('Invalid') || l.includes('No such'))
          .pop() ?? `FFmpeg exited with code ${code}`;

        onComplete?.({
          jobId: job.id,
          success: false,
          error: errorLine.trim(),
          durationMs,
        });
        return;
      }

      if (targetMaxBytes <= 0) {
        onComplete?.({
          jobId: job.id,
          success: true,
          outputPath: job.outputPath,
          durationMs,
        });
        return;
      }

      const outputSizeBytes = fs.existsSync(job.outputPath)
        ? fs.statSync(job.outputPath).size
        : 0;

      if (outputSizeBytes <= targetMaxBytes) {
        onComplete?.({
          jobId: job.id,
          success: true,
          outputPath: job.outputPath,
          durationMs,
        });
        return;
      }

      if (retryCount >= MAX_FILESIZE_RETRIES) {
        onComplete?.({
          jobId: job.id,
          success: false,
          error: `Output exceeded max size (${job.maxFileSizeMB} MB): ${Math.ceil(outputSizeBytes / (1024 * 1024))} MB after ${retryCount + 1} attempt(s).`,
          durationMs,
        });
        return;
      }

      const ratio = targetMaxBytes / outputSizeBytes;
      const nextBitrate = Math.max(
        MIN_RETRY_VIDEO_BITRATE_KBPS,
        Math.floor(bitrateKbps * ratio * RETRY_BITRATE_SAFETY_MARGIN)
      );

      if (nextBitrate >= bitrateKbps) {
        onComplete?.({
          jobId: job.id,
          success: false,
          error: `Unable to reduce bitrate enough to satisfy max size (${job.maxFileSizeMB} MB).`,
          durationMs,
        });
        return;
      }

      try {
        if (fs.existsSync(job.outputPath)) {
          fs.unlinkSync(job.outputPath);
        }
      } catch (unlinkError) {
        onComplete?.({
          jobId: job.id,
          success: false,
          error: unlinkError instanceof Error
            ? unlinkError.message
            : 'Failed to remove oversized output before retry',
          durationMs,
        });
        return;
      }

      startAttempt(nextBitrate, retryCount + 1);
    });

    proc.on('error', (err) => {
      onComplete?.({
        jobId: job.id,
        success: false,
        error: err.message,
        durationMs: Date.now() - startTime,
      });
    });
  };

  startAttempt(initialBitrate, 0);

  // Return cancel function
  return () => {
    cancelled = true;
    proc?.kill('SIGTERM');
  };
}

/**
 * Run all jobs in a render plan sequentially
 */
export async function runPlan(
  plan: RenderPlan,
  onProgress?: ProgressCallback,
  onJobComplete?: CompleteCallback,
  signal?: { cancelled: boolean }
): Promise<JobResult[]> {
  const results: JobResult[] = [];

  for (const job of plan.jobs) {
    if (signal?.cancelled) break;

    const result = await new Promise<JobResult>((resolve) => {
      let settled = false;

      const interval = setInterval(() => {
        if (!settled && signal?.cancelled) {
          settled = true;
          cancel();
          clearInterval(interval);
          resolve({
            jobId: job.id,
            success: false,
            error: 'Cancelled',
            durationMs: 0,
          });
        }
      }, 250);

      const cancel = runJob(job, onProgress, (r) => {
        if (settled) {
          return;
        }

        settled = true;
        clearInterval(interval);
        onJobComplete?.(r);
        resolve(r);
      });
    });

    results.push(result);
  }

  return results;
}
