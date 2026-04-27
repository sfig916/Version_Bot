/**
 * Integration test: probe → plan → execute with a real video file
 * Run with: npx tsx tests/integration.ts
 */

import path from 'path';
import fs from 'fs';
import { probeVideo } from '../src/core/probing/videoProber';
import { createRenderPlan } from '../src/core/rendering/renderPlanGenerator';
import { runPlan } from '../src/core/rendering/ffmpegRunner';
import { OutputPreset } from '../src/core/models/types';

const TEST_VIDEO = path.resolve(__dirname, 'test_video.mp4');
const OUTPUT_DIR = path.resolve(__dirname, 'integration_output');

const TEST_PRESET: OutputPreset = {
  id: '480p_test',
  name: '480p Test',
  width: 854,
  height: 480,
  scalingMode: 'scale',
  bitrate: 1000,
  videoCodec: 'h264',
  crf: 28,
  audioBitrate: 96,
  audioCodec: 'aac',
  container: 'mp4',
};

async function main() {
  console.log('=== Version Bot Integration Test ===\n');

  // ── 1. Check test video exists ─────────────────────────────────────────────
  if (!fs.existsSync(TEST_VIDEO)) {
    console.error(`Test video not found: ${TEST_VIDEO}`);
    console.error('Create tests/test_video.mp4 first, then re-run this integration test.');
    process.exit(1);
  }
  console.log(`Test video: ${TEST_VIDEO}`);

  // ── 2. Probe video ─────────────────────────────────────────────────────────
  console.log('\n[1/3] Probing video...');
  const metadata = await probeVideo(TEST_VIDEO);
  console.log(`  Resolution : ${metadata.width}x${metadata.height}`);
  console.log(`  Duration   : ${metadata.duration}s`);
  console.log(`  Codec      : ${metadata.codec}`);
  console.log(`  Bitrate    : ${metadata.bitrate} kbps`);
  console.log(`  FPS        : ${metadata.fps}`);

  // ── 3. Create render plan ──────────────────────────────────────────────────
  console.log('\n[2/3] Creating render plan...');
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  const plan = createRenderPlan(
    metadata,
    [TEST_PRESET],
    OUTPUT_DIR,
    '{preset}_{width}x{height}.{ext}'
  );

  console.log(`  Plan ID    : ${plan.id}`);
  console.log(`  Jobs       : ${plan.jobs.length}`);
  console.log(`  Output     : ${plan.jobs[0].outputPath}`);

  // ── 4. Execute render ──────────────────────────────────────────────────────
  console.log('\n[3/3] Running FFmpeg...');
  process.stdout.write('  Progress   : ');

  const results = await runPlan(
    plan,
    (progress) => {
      process.stdout.write(`\r  Progress   : ${progress.progress}% (${progress.currentTime.toFixed(1)}s @ ${progress.speed})`);
    },
    (result) => {
      if (!result.success) {
        console.error(`\n  Job failed: ${result.error}`);
      }
    }
  );

  console.log(); // newline after progress

  // ── 5. Report results ──────────────────────────────────────────────────────
  console.log('\n=== Results ===');
  for (const result of results) {
    const job = plan.jobs.find((j) => j.id === result.jobId)!;
    const status = result.success ? '✓ PASSED' : '✗ FAILED';
    const size = result.success && fs.existsSync(job.outputPath)
      ? `${(fs.statSync(job.outputPath).size / 1024).toFixed(1)} KB`
      : 'N/A';

    console.log(`  ${status}  ${path.basename(job.outputPath)}`);
    if (result.success) {
      console.log(`           Output: ${job.outputPath}`);
      console.log(`           Size  : ${size}`);
      console.log(`           Time  : ${(result.durationMs / 1000).toFixed(1)}s`);
    } else {
      console.log(`           Error : ${result.error}`);
    }
  }

  const passed = results.filter((r) => r.success).length;
  const failed = results.filter((r) => !r.success).length;
  console.log(`\nTotal: ${passed} passed, ${failed} failed`);

  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('Integration test error:', err);
  process.exit(1);
});
