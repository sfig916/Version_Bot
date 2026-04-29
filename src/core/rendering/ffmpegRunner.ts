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
  const command = buildFFmpegCommand(job);
  const startTime = Date.now();

  // Ensure output directory exists
  const outputDir = path.dirname(job.outputPath);
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  let proc: ChildProcess | null = null;
  let cancelled = false;

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

    if (code === 0) {
      onComplete?.({
        jobId: job.id,
        success: true,
        outputPath: job.outputPath,
        durationMs,
      });
    } else {
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
    }
  });

  proc.on('error', (err) => {
    onComplete?.({
      jobId: job.id,
      success: false,
      error: err.message,
      durationMs: Date.now() - startTime,
    });
  });

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
