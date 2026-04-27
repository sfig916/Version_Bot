/**
 * FFmpeg command builder
 * Generates explicit, readable FFmpeg commands from render jobs
 */

import path from 'path';
import { RenderJob, ScalingMode } from '../models/types';

export interface FFmpegCommand {
  /** Program name */
  program: string;
  /** Array of arguments */
  args: string[];
  /** Full command for logging/debugging */
  fullCommand: string;
  /** Description of what this command does */
  description: string;
}

/**
 * Build scaling filter based on scaling mode and resolutions
 */
function buildScaleFilter(
  sourceWidth: number,
  sourceHeight: number,
  targetWidth: number,
  targetHeight: number,
  mode: ScalingMode
): string {
  const sourceAR = sourceWidth / sourceHeight;
  const targetAR = targetWidth / targetHeight;

  switch (mode) {
    case 'scale':
      // Simple scale without letterbox/pillarbox
      return `scale=${targetWidth}:${targetHeight}`;

    case 'pillarbox':
      // Add vertical bars if source is narrower than target
      if (sourceAR < targetAR) {
        return `scale=${targetWidth}:trunc(${targetWidth}/${sourceAR}/2)*2,pad=${targetWidth}:${targetHeight}:(ow-iw)/2:(oh-ih)/2`;
      }
      return `scale=${targetWidth}:${targetHeight}`;

    case 'letterbox':
      // Add horizontal bars if source is wider than target
      if (sourceAR > targetAR) {
        return `scale=trunc(${targetHeight}*${sourceAR}/2)*2:${targetHeight},pad=${targetWidth}:${targetHeight}:(ow-iw)/2:(oh-ih)/2`;
      }
      return `scale=${targetWidth}:${targetHeight}`;

    case 'crop':
      // Crop to fill frame while maintaining aspect ratio
      return `scale=${targetWidth}:${targetHeight}:force_original_aspect_ratio=increase,crop=${targetWidth}:${targetHeight}`;

    default:
      return `scale=${targetWidth}:${targetHeight}`;
  }
}

/**
 * Build overlay filter string for ESRB overlay placement
 * Overlays are pre-positioned at 3840x2160 resolution with transparency
 * and need to be scaled to match the output resolution
 */
function buildOverlayFilter(
  videoFilter: string,
  outputWidth: number,
  outputHeight: number
): string {
  // Calculate scale factor based on output resolution
  // Input overlay is always 3840x2160, scale to match output
  const scaleFactor = outputWidth / 3840;
  const scaledHeight = Math.round(2160 * scaleFactor);
  
  // Overlay is already positioned in the image file, so overlay at 0:0
  // Scale the overlay to match output resolution, then overlay at top-left
  return `${videoFilter}[v];[1:v]scale=${outputWidth}:${scaledHeight}[ov];[v][ov]overlay=0:0[vout]`;
}

/**
 * Generate FFmpeg command for a render job
 */
export function buildFFmpegCommand(job: RenderJob): FFmpegCommand {
  const preset = job.preset;
  const source = job.source;
  const outputPath = job.outputPath;

  const args: string[] = ['-i', source.filePath];

  // Video filter chain
  let videoFilter = buildScaleFilter(
    source.width,
    source.height,
    preset.width,
    preset.height,
    preset.scalingMode
  );

  // Apply overlay if configured
  if (preset.overlay?.enabled && preset.overlay.assetPath) {
    args.push('-i', preset.overlay.assetPath);
    videoFilter = buildOverlayFilter(
      videoFilter,
      preset.width,
      preset.height
    );
  }

  // Add filter graph
  args.push('-filter:v', videoFilter);

  // Video encoding — always h264 CBR (no CRF)
  const bitrate = job.adjustedBitrate || preset.bitrate;
  args.push('-c:v', 'libx264');
  args.push('-b:v', `${bitrate}k`);
  args.push('-preset', 'medium');
  args.push('-r', '60000/1001');

  // Audio encoding — always AAC, 320 kbps, 48 kHz
  const audioBitrate = preset.audioBitrate || 320;
  args.push('-c:a', 'aac');
  args.push('-b:a', `${audioBitrate}k`);
  args.push('-ar', '48000');

  // Container-specific settings
  if (preset.container === 'mp4') {
    args.push('-movflags', '+faststart'); // Web-friendly MP4
  } else if (preset.container === 'webm') {
    // WebM defaults are fine
  } else if (preset.container === 'mov') {
    // MOV specific settings
  }

  // Output settings
  args.push('-y'); // Overwrite output file
  args.push(outputPath);

  const fullCommand = `ffmpeg ${args.join(' ')}`;
  const description = `Encode ${preset.width}x${preset.height} @ 59.94fps (h264 CBR ${bitrate}kbps / aac 320k 48kHz) with preset ${preset.name}`;

  return {
    program: 'ffmpeg',
    args,
    fullCommand,
    description,
  };
}

/**
 * Build probe command to detect video properties
 */
export function buildFFprobeCommand(filePath: string): FFmpegCommand {
  const args = [
    '-v',
    'error',
    '-select_streams',
    'v:0',
    '-show_entries',
    'stream=width,height,avg_frame_rate,duration,bit_rate,codec_name',
    '-of',
    'json',
    filePath,
  ];

  return {
    program: 'ffprobe',
    args,
    fullCommand: `ffprobe ${args.join(' ')}`,
    description: `Probe video properties from ${path.basename(filePath)}`,
  };
}

/**
 * Validate that required audio codec is available
 */
export function validateAudioCodec(codec: string): boolean {
  // Common audio codecs we support
  const supportedCodecs = ['aac', 'libopus', 'libvorbis', 'mp3'];
  return supportedCodecs.includes(codec);
}

/**
 * Validate that required video codec is available
 */
export function validateVideoCodec(codec: string): boolean {
  const supportedCodecs = ['h264', 'h265', 'hevc', 'vp9', 'av1'];
  return supportedCodecs.includes(codec.toLowerCase());
}
