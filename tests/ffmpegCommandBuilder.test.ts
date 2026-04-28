import { describe, it, expect } from 'vitest';
import { buildFFmpegCommand } from '../src/core/rendering/ffmpegCommandBuilder';
import { RenderJob } from '../src/core/models/types';

const baseJob: RenderJob = {
  id: 'job-1',
  source: {
    filePath: '/test/source.mp4',
    width: 1920,
    height: 1080,
    aspectRatio: 16 / 9,
    duration: 120,
    bitrate: 5000,
    codec: 'h264',
    fps: 30,
    audioCodec: 'aac',
    sampleRate: 48000,
  },
  preset: {
    id: 'preset-1',
    name: 'Preset 1',
    width: 1280,
    height: 720,
    scalingMode: 'crop',
    bitrate: 2500,
    videoCodec: 'h264',
    audioBitrate: 128,
    audioCodec: 'aac',
    container: 'mp4',
  },
  outputPath: '/output/file.mp4',
  maxFileSizeMB: 0,
  status: 'pending',
  progress: 0,
};

describe('FFmpeg Command Builder', () => {
  it('should use crop filter when scaling mode is crop', () => {
    const command = buildFFmpegCommand(baseJob);
    const filterArgIndex = command.args.indexOf('-filter:v');
    expect(filterArgIndex).toBeGreaterThan(-1);
    const filter = command.args[filterArgIndex + 1];
    expect(filter).toContain('force_original_aspect_ratio=increase');
    expect(filter).toContain('crop=1280:720');
  });

  it('should map aac audio codec correctly', () => {
    const command = buildFFmpegCommand(baseJob);
    const codecArgIndex = command.args.indexOf('-c:a');
    expect(codecArgIndex).toBeGreaterThan(-1);
    expect(command.args[codecArgIndex + 1]).toBe('aac');
  });

  it('should force output fps to 59.94', () => {
    const command = buildFFmpegCommand(baseJob);
    const fpsArgIndex = command.args.indexOf('-r');
    expect(fpsArgIndex).toBeGreaterThan(-1);
    expect(command.args[fpsArgIndex + 1]).toBe('60000/1001');
  });

  it('should map mp3 audio codec to libmp3lame', () => {
    const command = buildFFmpegCommand({
      ...baseJob,
      preset: {
        ...baseJob.preset,
        audioCodec: 'mp3',
      },
    });

    const codecArgIndex = command.args.indexOf('-c:a');
    expect(codecArgIndex).toBeGreaterThan(-1);
    expect(command.args[codecArgIndex + 1]).toBe('libmp3lame');
  });

  it('should include crf when crf is zero', () => {
    const command = buildFFmpegCommand({
      ...baseJob,
      preset: {
        ...baseJob.preset,
        crf: 0,
      },
    });

    const crfArgIndex = command.args.indexOf('-crf');
    expect(crfArgIndex).toBeGreaterThan(-1);
    expect(command.args[crfArgIndex + 1]).toBe('0');
  });

  it('should build concat pipeline when prepend and append are enabled', () => {
    const command = buildFFmpegCommand({
      ...baseJob,
      preset: {
        ...baseJob.preset,
        introSlate: {
          enabled: true,
          assetPath: '/test/intro.mov',
        },
        outroSlate: {
          enabled: true,
          assetPath: '/test/outro.mov',
        },
        overlay: {
          enabled: true,
          assetPath: '/test/overlay.png',
          duration: 4,
        },
      },
    });

    const filterComplexIndex = command.args.indexOf('-filter_complex');
    expect(filterComplexIndex).toBeGreaterThan(-1);

    const filterGraph = command.args[filterComplexIndex + 1];
    expect(filterGraph).toContain('overlay=0:0');
    expect(filterGraph).toContain("enable='between(t,0,4)'");
    expect(filterGraph).toContain('concat=n=3:v=1:a=1[vout][aout]');

    expect(command.args).toContain('-map');
    expect(command.args).toContain('[vout]');
    expect(command.args).toContain('[aout]');
  });

  it('should use filter_complex for overlay-only renders', () => {
    const command = buildFFmpegCommand({
      ...baseJob,
      preset: {
        ...baseJob.preset,
        overlay: {
          enabled: true,
          assetPath: '/test/overlay.png',
          duration: 4,
        },
      },
    });

    expect(command.args.includes('-filter:v')).toBe(false);
    const filterComplexIndex = command.args.indexOf('-filter_complex');
    expect(filterComplexIndex).toBeGreaterThan(-1);
    const filterGraph = command.args[filterComplexIndex + 1];
    expect(filterGraph).toContain('[0:v]');
    expect(filterGraph).toContain('overlay=0:0');
    expect(filterGraph).toContain('null[vout]');
    expect(command.args).toContain('[vout]');
    expect(command.args).toContain('[aout]');
  });

  it('should generate silent fallback audio for segments without audio tracks', () => {
    const command = buildFFmpegCommand({
      ...baseJob,
      source: {
        ...baseJob.source,
        hasAudioTrack: false,
      },
      preset: {
        ...baseJob.preset,
        introSlate: {
          enabled: true,
          assetPath: '/test/intro_no_audio.mov',
          duration: 2,
          hasAudio: false,
        },
        outroSlate: {
          enabled: true,
          assetPath: '/test/outro_no_audio.mov',
          duration: 3,
          hasAudio: false,
        },
      },
    });

    const filterComplexIndex = command.args.indexOf('-filter_complex');
    expect(filterComplexIndex).toBeGreaterThan(-1);
    const filterGraph = command.args[filterComplexIndex + 1];

    expect(filterGraph).toContain('anullsrc=channel_layout=stereo:sample_rate=48000');
    expect(filterGraph).toContain('atrim=duration=2');
    expect(filterGraph).toContain('atrim=duration=3');
    expect(filterGraph).toContain('concat=n=3:v=1:a=1[vout][aout]');
  });
});