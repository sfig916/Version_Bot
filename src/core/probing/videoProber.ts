/**
 * Video metadata probing using ffprobe
 */

import { execFileSync } from 'child_process';
import path from 'path';
import { VideoMetadata } from '../models/types';

export interface FFprobeStreamInfo {
  width?: number;
  height?: number;
  avg_frame_rate?: string;
  duration?: string;
  bit_rate?: string;
  codec_name?: string;
  sample_rate?: string;
}

export interface FFprobeOutput {
  streams?: FFprobeStreamInfo[];
}

/**
 * Parse frame rate string like "24/1" or "30000/1001"
 */
function parseFrameRate(fpsStr: string): number {
  if (!fpsStr) return 30; // default
  const [num, denom] = fpsStr.split('/').map(Number);
  if (denom === 0) return 30;
  return num / denom;
}

/**
 * Get ffprobe binary path (cross-platform)
 */
function getFFprobePath(): string {
  // Try to use ffprobe-static if available, otherwise assume in PATH
  try {
    return require('ffprobe-static').path;
  } catch {
    return 'ffprobe';
  }
}

/**
 * Probe video file and extract metadata
 * Requires ffprobe to be installed or available via ffprobe-static
 */
export async function probeVideo(filePath: string): Promise<VideoMetadata> {
  const ffprobePath = getFFprobePath();

  const args = [
    '-v',
    'error',
    '-show_entries',
    'stream=width,height,avg_frame_rate,duration,bit_rate,codec_name,sample_rate',
    '-of',
    'json',
    filePath,
  ];

  let output: string;
  try {
    output = execFileSync(ffprobePath, args, { encoding: 'utf-8' });
  } catch (error) {
    throw new Error(
      `Failed to probe video: ${error instanceof Error ? error.message : String(error)}`
    );
  }

  const probeData: FFprobeOutput = JSON.parse(output);

  if (!probeData.streams || probeData.streams.length === 0) {
    throw new Error('No video streams found in file');
  }

  // Get video stream (first one)
  const videoStream = probeData.streams.find((s) => s.width);
  if (!videoStream) {
    throw new Error('No video stream with dimensions found');
  }

  // Get audio stream if available
  const audioStream = probeData.streams.find((s) => s.sample_rate);

  if (!videoStream.width || !videoStream.height) {
    throw new Error('Could not determine video dimensions');
  }

  const width = videoStream.width;
  const height = videoStream.height;
  const fps = parseFrameRate(videoStream.avg_frame_rate || '');
  const duration = Math.round(Number(videoStream.duration) || 0);
  const bitrate = Math.round((Number(videoStream.bit_rate) || 0) / 1000);
  const codec = videoStream.codec_name || 'unknown';
  const audioCodec = audioStream?.codec_name || 'aac';
  const sampleRate = Number(audioStream?.sample_rate) || 48000;

  const metadata: VideoMetadata = {
    filePath,
    width,
    height,
    aspectRatio: width / height,
    duration,
    bitrate,
    codec,
    fps,
    audioCodec,
    sampleRate,
  };

  return metadata;
}

/**
 * Quick validation that a file looks like a video
 * by checking if ffprobe can read it
 */
export async function isValidVideoFile(filePath: string): Promise<boolean> {
  try {
    await probeVideo(filePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Get human-readable codec name
 */
export function getCodecDisplayName(codec: string): string {
  const names: Record<string, string> = {
    h264: 'H.264 (AVC)',
    hevc: 'H.265 (HEVC)',
    h265: 'H.265 (HEVC)',
    vp8: 'VP8',
    vp9: 'VP9',
    av1: 'AV1',
    mpeg2video: 'MPEG-2',
    aac: 'AAC',
    mp3: 'MP3',
    opus: 'Opus',
    vorbis: 'Vorbis',
    libopus: 'Opus',
    libvorbis: 'Vorbis',
  };
  return names[codec.toLowerCase()] || codec;
}

/**
 * Format metadata for display
 */
export function formatVideoMetadata(metadata: VideoMetadata): string {
  return `
Video Metadata:
  File: ${path.basename(metadata.filePath)}
  Resolution: ${metadata.width}x${metadata.height} (${metadata.aspectRatio.toFixed(3)})
  Duration: ${Math.floor(metadata.duration / 60)}:${String(metadata.duration % 60).padStart(2, '0')}
  FPS: ${metadata.fps.toFixed(2)}
  Video Codec: ${getCodecDisplayName(metadata.codec)}
  Bitrate: ${metadata.bitrate} kbps
  Audio Codec: ${getCodecDisplayName(metadata.audioCodec)}
  Sample Rate: ${metadata.sampleRate} Hz
`;
}
