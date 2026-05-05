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
  outputHeight: number,
  durationSeconds?: number
): string {
  // Calculate scale factor based on output resolution
  // Input overlay is always 3840x2160, scale to match output
  const scaleFactor = outputWidth / 3840;
  const scaledHeight = Math.round(2160 * scaleFactor);
  const enableClause =
    durationSeconds && durationSeconds > 0
      ? `:enable='between(t,0,${durationSeconds})'`
      : '';
  
  // Overlay is already positioned in the image file, so overlay at 0:0
  // Scale the overlay to match output resolution, then overlay at top-left
  return `${videoFilter}[v];[1:v]scale=${outputWidth}:${scaledHeight}[ov];[v][ov]overlay=0:0${enableClause}[vout]`;
}

function mapAudioCodec(codec: RenderJob['preset']['audioCodec']): string {
  if (codec === 'mp3') {
    return 'libmp3lame';
  }
  return codec;
}

function buildSafeAudioSegment(
  filterParts: string[],
  outputLabel: string,
  inputIndex: number,
  hasAudio: boolean,
  durationSeconds: number
): void {
  if (hasAudio) {
    filterParts.push(`[${inputIndex}:a]aresample=48000,asetpts=PTS-STARTPTS[${outputLabel}]`);
    return;
  }

  const duration = Math.max(0.1, Number(durationSeconds) || 1);
  filterParts.push(
    `anullsrc=channel_layout=stereo:sample_rate=48000,atrim=duration=${duration},asetpts=PTS-STARTPTS[${outputLabel}]`
  );
}

/**
 * Generate FFmpeg command for a render job
 */
export function buildFFmpegCommand(job: RenderJob): FFmpegCommand {
  const preset = job.preset;
  const source = job.source;
  const outputPath = job.outputPath;

  const args: string[] = ['-i', source.filePath];
  let nextInputIndex = 1;

  let overlayInputIndex: number | undefined;
  const hasOverlay = Boolean(preset.overlay?.enabled && preset.overlay.assetPath);
  if (hasOverlay) {
    args.push('-i', preset.overlay!.assetPath!);
    overlayInputIndex = nextInputIndex;
    nextInputIndex += 1;
  }

  let introInputIndex: number | undefined;
  const hasIntro = Boolean(preset.introSlate?.enabled && preset.introSlate.assetPath);
  if (hasIntro) {
    args.push('-i', preset.introSlate!.assetPath!);
    introInputIndex = nextInputIndex;
    nextInputIndex += 1;
  }

  let outroInputIndex: number | undefined;
  const hasOutro = Boolean(preset.outroSlate?.enabled && preset.outroSlate.assetPath);
  if (hasOutro) {
    args.push('-i', preset.outroSlate!.assetPath!);
    outroInputIndex = nextInputIndex;
  }

  const hasSlateConcat = hasIntro || hasOutro;
  const hasComplexGraph = hasSlateConcat || hasOverlay;

  if (hasComplexGraph) {
    const filterParts: string[] = [];
    let outputVideoLabel = 'vout';
    let outputAudioLabel = 'aout';

    const segmentLabels: Array<{ video: string; audio: string }> = [];

    filterParts.push(
      `[0:v]${buildScaleFilter(
        source.width,
        source.height,
        preset.width,
        preset.height,
        preset.scalingMode
      )},fps=60000/1001,setpts=PTS-STARTPTS[src_v_base]`
    );

    let sourceVideoLabel = 'src_v_base';
    if (overlayInputIndex !== undefined) {
      const overlayDuration = preset.overlay?.duration;
      const overlayEnableClause =
        overlayDuration && overlayDuration > 0
          ? `:enable='between(t,0,${overlayDuration})'`
          : '';
      filterParts.push(
        `[${overlayInputIndex}:v]scale=${preset.width}:${preset.height}[overlay_v]`
      );
      filterParts.push(
        `[src_v_base][overlay_v]overlay=0:0${overlayEnableClause}[src_v]`
      );
      sourceVideoLabel = 'src_v';
    }

    if (hasSlateConcat) {
      if (introInputIndex !== undefined) {
        filterParts.push(
          `[${introInputIndex}:v]${buildScaleFilter(
            preset.width,
            preset.height,
            preset.width,
            preset.height,
            'scale'
          )},fps=60000/1001,setpts=PTS-STARTPTS[intro_v]`
        );
        buildSafeAudioSegment(
          filterParts,
          'intro_a',
          introInputIndex,
          preset.introSlate?.hasAudio !== false,
          preset.introSlate?.duration || 1
        );
        segmentLabels.push({ video: 'intro_v', audio: 'intro_a' });
      }

      buildSafeAudioSegment(
        filterParts,
        'src_a',
        0,
        source.hasAudioTrack !== false,
        source.duration
      );
      segmentLabels.push({ video: sourceVideoLabel, audio: 'src_a' });

      if (outroInputIndex !== undefined) {
        filterParts.push(
          `[${outroInputIndex}:v]${buildScaleFilter(
            preset.width,
            preset.height,
            preset.width,
            preset.height,
            'scale'
          )},fps=60000/1001,setpts=PTS-STARTPTS[outro_v]`
        );
        buildSafeAudioSegment(
          filterParts,
          'outro_a',
          outroInputIndex,
          preset.outroSlate?.hasAudio !== false,
          preset.outroSlate?.duration || 1
        );
        segmentLabels.push({ video: 'outro_v', audio: 'outro_a' });
      }

      const concatInputLabels = segmentLabels
        .map((segment) => `[${segment.video}][${segment.audio}]`)
        .join('');
      filterParts.push(
        `${concatInputLabels}concat=n=${segmentLabels.length}:v=1:a=1[vout][aout]`
      );
    } else {
      // Overlay-only complex path: keep source audio (or silence fallback) without concat.
      filterParts.push(`[${sourceVideoLabel}]null[vout]`);
      buildSafeAudioSegment(
        filterParts,
        'aout',
        0,
        source.hasAudioTrack !== false,
        source.duration
      );
    }

    args.push('-filter_complex', filterParts.join(';'));
    args.push('-map', `[${outputVideoLabel}]`);
    args.push('-map', `[${outputAudioLabel}]`);
  } else {
    // Video filter chain for the no-concat path
    let videoFilter = buildScaleFilter(
      source.width,
      source.height,
      preset.width,
      preset.height,
      preset.scalingMode
    );

    // Apply overlay if configured
    if (hasOverlay) {
      videoFilter = buildOverlayFilter(
        videoFilter,
        preset.width,
        preset.height,
        preset.overlay?.duration
      );
    }

    // Add filter graph
    args.push('-filter:v', videoFilter);
  }

  // Video encoding — strict h264 CBR
  const bitrate = job.adjustedBitrate || preset.bitrate;
  args.push('-c:v', 'libx264');
  args.push('-b:v', `${bitrate}k`);
  args.push('-maxrate', `${bitrate}k`);
  args.push('-bufsize', `${Math.floor(bitrate / 2)}k`);
  args.push('-nal-hrd', 'cbr');
  args.push('-pix_fmt', 'yuv420p');
  if (preset.crf !== undefined) {
    args.push('-crf', String(preset.crf));
  }
  args.push('-preset', 'medium');
  args.push('-r', '60000/1001');

  // Audio encoding
  const audioBitrate = preset.audioBitrate || 320;
  args.push('-c:a', mapAudioCodec(preset.audioCodec));
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
