/**
 * FFmpeg command builder
 * Generates explicit, readable FFmpeg commands from render jobs
 */

import path from 'path';
import { RenderJob, OutputPreset, ScalingMode } from '../models/types';

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
      return `scale=${targetWidth}:${targetHeight}:force_original_aspect_ratio=decrease,pad=${targetWidth}:${targetHeight}:(ow-iw)/2:(oh-ih)/2`;

    default:
      return `scale=${targetWidth}:${targetHeight}`;
  }
}

/**
 * Build overlay filter string for rating/slate placement
 */
function buildOverlayFilter(
  videoFilter: string,
  overlayWidth: string,
  overlayPosition: 'tl' | 'tr' | 'bl' | 'br'
): string {
  const positionMap = {
    tl: 'x=0:y=0',
    tr: `x=W-w:y=0`,
    bl: `x=0:y=H-h`,
    br: `x=W-w:y=H-h`,
  };

  const positionStr = positionMap[overlayPosition];
  const scaledOverlay = `scale=${overlayWidth}:-1`;

  return `${videoFilter}[v];[1:v]${scaledOverlay}[ov];[v][ov]overlay=${positionStr}[vout]`;
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
    const overlayWidthPercent = preset.overlay.widthPercent;
    const overlayWidth = Math.round((preset.width * overlayWidthPercent) / 100);
    videoFilter = buildOverlayFilter(
      videoFilter,
      overlayWidth.toString(),
      preset.overlay.position
    );
  }

  // Add filter graph
  args.push('-filter:v', videoFilter);

  // Video encoding
  const bitrate = job.adjustedBitrate || preset.bitrate;

  if (preset.videoCodec === 'h264') {
    args.push('-c:v', 'libx264');
    if (preset.crf) {
      args.push('-crf', preset.crf.toString());
    } else {
      args.push('-b:v', `${bitrate}k`);
    }
    args.push('-preset', 'medium'); // fast, medium, slow
  } else if (preset.videoCodec === 'h265' || preset.videoCodec === 'hevc') {
    args.push('-c:v', 'libx265');
    if (preset.crf) {
      args.push('-crf', preset.crf.toString());
    } else {
      args.push('-b:v', `${bitrate}k`);
    }
    args.push('-preset', 'medium');
  } else if (preset.videoCodec === 'vp9') {
    args.push('-c:v', 'libvpx-vp9');
    args.push('-b:v', `${bitrate}k`);
    args.push('-tile-columns', '6');
    args.push('-frame-parallel', '1');
  } else if (preset.videoCodec === 'av1') {
    args.push('-c:v', 'libaom-av1');
    args.push('-b:v', `${bitrate}k`);
    args.push('-cpu-used', '4'); // 0-8, higher = faster but lower quality
  }

  // Audio encoding
  args.push('-c:a', `lib${preset.audioCodec}`);
  args.push('-b:a', `${preset.audioBitrate}k`);

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
  const description = `Encode ${preset.width}x${preset.height} (${preset.videoCodec}/${preset.audioCodec}) with preset ${preset.name}`;

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
