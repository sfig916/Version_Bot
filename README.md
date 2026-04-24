# Version Bot - Video Versioning & Batch Export Tool

A cross-platform desktop application for creating multiple versions of videos with different resolutions, codecs, and formats. Perfect for video editors and content creators who need to export content for different platforms and devices.

## Architecture Overview

### Tech Stack
- **Frontend**: React 18 + TypeScript + Vite
- **Desktop Framework**: Electron 26
- **Backend**: Node.js + TypeScript
- **Video Processing**: FFmpeg + FFprobe
- **Data Validation**: Zod
- **Configuration**: YAML/JSON presets
- **Testing**: Vitest

### Project Structure

```
version-bot/
├── src/
│   ├── main/                    # Electron main process
│   │   ├── index.ts            # Main process entry
│   │   └── preload.ts          # Secure IPC bridge
│   ├── renderer/               # React UI
│   │   ├── index.tsx           # Entry point
│   │   └── components/         # React components
│   └── core/                   # Core business logic
│       ├── models/             # Type definitions
│       ├── presets/            # Preset loading & validation
│       ├── probing/            # Video metadata detection
│       ├── rendering/          # FFmpeg command generation
│       └── logging/            # Structured logging
├── tests/                      # Unit tests
├── presets/                    # Example preset files
└── assets/                     # Application assets
```

### Architecture Principles

1. **Separation of Concerns**
   - **Core Logic**: Pure business logic in `src/core/` with no UI dependencies
   - **IPC Layer**: Secure communication through main process
   - **UI Layer**: React components that consume core logic via IPC

2. **Data-Driven Design**
   - Presets are YAML/JSON files, not hardcoded
   - Type-safe validation with Zod schemas
   - Configuration-driven render plan generation

3. **Explicit FFmpeg Commands**
   - All FFmpeg commands are generated as readable strings
   - Filters and codec settings are transparent
   - Easy to debug and audit

4. **Local-First Workflow**
   - All presets and configs stored as files
   - No cloud dependencies
   - Portable across machines

## Core Concepts

### Render Job
A single export task that converts one video using a specific preset.

```typescript
interface RenderJob {
  id: string;                  // Unique identifier
  source: VideoMetadata;       // Input video info
  preset: OutputPreset;        // Export configuration
  outputPath: string;          // Where to save
  maxFileSizeMB: number;       // Optional file size limit
  adjustedBitrate?: number;    // Recalculated if constrained
  status: JobStatus;           // pending | running | completed | failed
  progress: number;            // 0-100
}
```

### Render Plan
A collection of related render jobs (e.g., exporting one video to multiple formats).

```typescript
interface RenderPlan {
  id: string;
  source: VideoMetadata;       // Source video
  jobs: RenderJob[];           // All jobs in plan
  outputDirTemplate: string;   // Output directory
  filenameTemplate: string;    // Filename pattern
  status: PlanStatus;          // Overall status
  progress: number;            // Overall progress
  logs: LogEntry[];            // Execution logs
}
```

### Output Preset
A reusable configuration template for video export.

```typescript
interface OutputPreset {
  id: string;                  // Unique identifier
  name: string;                // Human-readable name
  width: number;               // Output resolution
  height: number;
  scalingMode: ScalingMode;    // scale | pillarbox | letterbox | crop
  bitrate: number;             // Target video bitrate (kbps)
  videoCodec: string;          // h264 | h265 | vp9 | av1
  crf?: number;                // Quality (0-51, lower=better)
  audioBitrate: number;        // Audio bitrate (kbps)
  audioCodec: string;          // aac | libopus | libvorbis
  container: string;           // mp4 | webm | mov | mkv
  introSlate?: SlateConfig;    // Prepend video/image
  outroSlate?: SlateConfig;    // Append video/image
  overlay?: OverlayConfig;     // Add watermark/rating card
}
```

## Key Features

### 1. Video Probing
Detects source video properties using FFprobe:
- Resolution and aspect ratio
- Codec and bitrate
- Duration and frame rate
- Audio properties

### 2. Preset System
Data-driven preset management:
- YAML/JSON format for easy editing
- Zod validation for type safety
- Reusable export configurations
- Support for multiple codecs and containers

### 3. Render Plan Generation
Intelligent plan creation:
- Multiple presets per source video
- Automatic output filename templating
- File size constraint handling
- Aspect ratio compatibility checks

### 4. FFmpeg Command Building
Explicit command generation:
- Scaling/cropping filters (scale, letterbox, pillarbox, crop)
- Codec-specific settings
- Audio/video sync handling
- Container-specific optimizations

### 5. Scaling Modes
Handle different aspect ratios:
- **scale**: Direct resize (may distort if AR doesn't match)
- **letterbox**: Add horizontal bars
- **pillarbox**: Add vertical bars
- **crop**: Fill frame while maintaining AR

### 6. Advanced Features
- Intro/outro slates (prepend/append videos or images)
- Overlays (watermarks, rating cards, in 4 corners)
- File size constraint handling (auto-adjust bitrate)
- Batch export with progress tracking
- Comprehensive logging

## Key Assumptions & Constraints

### FFmpeg & FFprobe
**Assumption**: FFmpeg and FFprobe are available in the system PATH or bundled via `ffmpeg-static` and `ffprobe-static`.

**Edge Case**: If video uses uncommon codec, ffprobe may fail to detect it. The app validates availability before showing options.

### Aspect Ratio Handling
**Assumption**: Most videos maintain consistent aspect ratio throughout. Presets target specific output aspect ratios.

**Edge Case**: If source has unusual AR (e.g., 1:1 square), some presets may not fit perfectly. Scaling modes handle this, but may require manual preview.

**Decision**: We use a 2% tolerance when comparing aspect ratios in `scale` mode to account for rounding.

### Audio Stream Detection
**Assumption**: Videos have at least one audio stream. Silent videos may have issues.

**Edge Case**: Some video formats (e.g., animated GIFs as MP4) may have no audio. The app falls back to AAC codec without audio content.

**Decision**: Audio codec selection is independent of video codec.

### File Size Constraints
**Formula**: `targetBitrate = (maxSizeMB * 8 * 1024 * 1024) / duration - audiobitrate`

**Edge Case**: Very small file size limits may result in bitrates below 500 kbps (minimum). The app enforces this floor to ensure minimum quality.

**Decision**: Audio bitrate is subtracted from total before calculating video bitrate.

### Output Directory Creation
**Assumption**: The application will create output directories if they don't exist.

**Edge Case**: If the path is invalid or user lacks permissions, FFmpeg will fail at runtime (not during plan creation).

**Decision**: We validate the directory path exists before starting export, but don't create intermediate dirs in preset system.

### Filename Templates
**Supported Placeholders**:
- `{preset}` - Preset ID
- `{name}` - Preset name
- `{width}x{height}` - Output resolution
- `{timestamp}` - ISO date (YYYY-MM-DD)
- `{ext}` - File extension from preset

**Edge Case**: Invalid characters in placeholders may cause filename errors. We sanitize output paths before passing to FFmpeg.

**Decision**: Filenames are generated during render plan creation, allowing preview before export.

### Codec Availability
**Assumption**: Common codecs (h264, h265, vp9) are available in the user's FFmpeg build.

**Edge Case**: Some codec builds may be disabled (e.g., proprietary codecs). We validate codec availability during preset validation.

**Decision**: Presets specify codecs, and we validate before adding to plan. User gets clear error if preset uses unavailable codec.

### Slate & Overlay Assets
**Assumption**: Asset files exist at specified paths. Paths are relative to working directory or absolute.

**Edge Case**: If asset is missing or invalid, FFmpeg will fail at runtime.

**Decision**: Assets are optional in presets. We don't validate asset existence at plan creation time (to allow remote assets or assets added later).

## Development Setup

### Prerequisites
- Node.js 18+
- FFmpeg & FFprobe installed (or auto-installed via npm packages)
- Python (for electron-builder)

### Installation

```bash
cd version-bot
npm install
```

### Development

```bash
# Start dev server with hot reload
npm run dev

# Or separately:
npm run dev:main    # TypeScript compiler in watch mode
npm run dev:renderer # Vite dev server (http://localhost:5173)
```

### Building

```bash
# Build both main and renderer
npm run build

# Package as distributable
npm run dist
```

### Testing

```bash
# Run unit tests
npm test

# Run tests in watch mode
npm test -- --watch

# Run with UI
npm run test:ui
```

## Usage Workflow

1. **Launch App**: Open Version Bot
2. **Select Video**: Click "Select Video File" and choose master video
3. **App Probes**: FFprobe detects resolution, codec, duration, etc.
4. **Review Source**: Confirm source properties
5. **Select Presets**: Check boxes for desired export presets
6. **Set Output**: Choose output directory and filename template
7. **Review Plan**: Inspect render jobs and FFmpeg commands
8. **Export**: Execute batch export (future release)
9. **Monitor**: Watch progress and logs
10. **Review Output**: Open output directory to see results

## Example Presets

See `presets/example.yaml` for complete preset examples including:
- HD 1080p with H.264
- HD 720p with H.264
- 4K 2160p with H.265
- Web VP9 with WebM
- Mobile 360p
- Editorial with intro/outro slates

## Preset Creation Guide

### Basic Template

```yaml
metadata:
  version: '1.0'
  description: 'My custom presets'

presets:
  - id: 'my-preset'
    name: 'My Format'
    width: 1920
    height: 1080
    scalingMode: 'letterbox'
    bitrate: 5000
    videoCodec: 'h264'
    audioBitrate: 128
    audioCodec: 'aac'
    container: 'mp4'
```

### With Slates

```yaml
presets:
  - id: 'with-slates'
    name: 'With Intro/Outro'
    # ... other settings ...
    introSlate:
      enabled: true
      assetPath: 'assets/intro.mov'  # Must exist!
      duration: 3
    outroSlate:
      enabled: true
      assetPath: 'assets/outro.mov'
      duration: 2
```

### With Overlay

```yaml
presets:
  - id: 'with-overlay'
    name: 'With Watermark'
    # ... other settings ...
    overlay:
      enabled: true
      assetPath: 'assets/watermark.png'  # Must exist!
      position: 'br'              # tl, tr, bl, br
      widthPercent: 15            # 1-100
      timing: 'full'              # start, end, full
```

## File Size Constraint Example

Target: 100 MB file for a 2-minute (120 second) video

```
Total bits = 100 MB * 8 * 1024 * 1024 = 838,860,800 bits
Bits per second = 838,860,800 / 120 = 6,990,506 bps
Kilobits per second = 6,990,506 / 1000 = 6,990 kbps
Video bitrate = 6,990 - 128 (audio) = 6,862 kbps
```

## Logging

Logs are structured with timestamp, level, source, and message:

```
[2024-04-23T10:30:45.123Z] [INFO] [main] Main window created
[2024-04-23T10:30:46.456Z] [INFO] [main] Probing video: /path/to/video.mp4
[2024-04-23T10:30:47.789Z] [INFO] [main] Probe successful { resolution: '1920x1080' }
```

## Future Enhancements

- [x] Core architecture and data models
- [x] Preset system with validation
- [x] FFmpeg command generation
- [x] Video probing
- [x] Render plan generation
- [x] MVP UI
- [x] Unit tests
- [ ] Actual FFmpeg execution (requires shell integration)
- [ ] Progress streaming and cancellation
- [ ] Live encoding stats
- [ ] Preset editor UI
- [ ] Asset management UI
- [ ] Output manifest generation
- [ ] Batch template library
- [ ] Encoding presets profiles (speed, quality, file size)
- [ ] GPU acceleration support (NVENC, HEVC)

## Troubleshooting

### "FFprobe command not found"
- Install FFmpeg: `brew install ffmpeg` (macOS) or download from ffmpeg.org
- Or relies on `ffprobe-static` npm package (auto-installed)

### "Invalid preset configuration"
- Check preset YAML for schema violations
- Validate codec names (h264, h265, vp9, av1)
- Ensure resolution is positive integers

### "Render plan creation failed"
- Verify output directory exists and is writable
- Check filename template placeholders are valid
- Ensure presets are compatible with source aspect ratio

### Application won't start
- Clear node_modules and reinstall: `rm -rf node_modules && npm install`
- Rebuild native modules: `npm rebuild`
- Check electron version compatibility

## License

MIT

## Contributing

Contributions welcome! Please submit issues and PRs.
