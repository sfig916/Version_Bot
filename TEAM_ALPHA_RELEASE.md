# Version Bot - Team Alpha Release (v0.1.0)

## What is Version Bot?

**Version Bot** is a cross-platform desktop application for video versioning and batch export. Select a master video and create multiple versions in different formats (resolutions, codecs, bitrates) with optional prepend, append, and overlay assets.

## Getting Started

### Installation (Windows)

1. Download `Version Bot.exe` from the release folder
2. No installation needed - just run the executable
3. The app will create configuration folders in `%APPDATA%\Electron\` on first run

### Usage

1. **Select Video**: Click "Select Video File" and choose your source video
2. **Choose Output Format**: Pick one or more presets for different versions
3. **Create Render Plan**: Specify output directory and filename template
4. **Start Rendering**: Review the render plan and click "Start Render"

### Key Features

- **Presets**: Predefined output formats (720p, 1080p, 4K with various codecs/bitrates)
- **Asset Management**: Add prepend (intro), append (outro), and overlay videos/images
- **Batch Export**: Create multiple versions from a single source video
- **Real-time Progress**: Monitor rendering progress with per-job status
- **Cross-platform**: Built with Electron - works on Windows, macOS, Linux

## What to Test (Alpha Focus)

### Critical Path
- [ ] Select a video file (try different formats: .mp4, .mov, .mkv, .webm)
- [ ] Select one or more output presets
- [ ] Set output directory
- [ ] Create render plan
- [ ] Start rendering
- [ ] Verify output files are created and playable

### Error Handling (NEW)
- [ ] Select a missing or invalid video file → should show friendly error message
- [ ] Try to render without selecting presets → should show validation error
- [ ] Try to render with missing asset file → should show asset resolution error
- [ ] Monitor error banner for user-friendly messages and recovery steps

### Asset Management
- [ ] Go to "Manage Assets" from the welcome screen
- [ ] Add prepend (intro) video/image
- [ ] Add append (outro) video/image
- [ ] Add overlay video/image
- [ ] Delete and re-add assets
- [ ] All changes persist after closing the app

### Preset Management
- [ ] Go to "Manage Presets" from welcome or settings
- [ ] Create a new preset with custom resolution and bitrate
- [ ] Edit an existing preset
- [ ] Delete a preset
- [ ] Verify presets appear in the selection list

### UI Improvements (This Release)
- [ ] Overlay duration simplified to single decimal input (seconds with 0.1 precision)
- [ ] Asset selection uses dropdown lists populated from Asset Library
- [ ] "Manage Assets" screen contains all complex asset management UI
- [ ] Preset editor is simpler and focused on preset selection/export settings
- [ ] Error banner shows at top of screen with friendly messages and recovery steps

## Known Limitations (Alpha)

- **MediaSilo integration** is planned but not yet available (buttons are hidden)
- **Code signing** is not enabled (app will show security warning on first run - click "Run" to proceed)
- **macOS/Linux builds** require running on those systems (currently only Windows exe available)
- **Settings panel** not yet implemented (all files are in standard Electron userData folders)
- **Logging** writes to console and Pino logger (check console for detailed errors)

## Troubleshooting

### App Won't Start
- Check Windows Defender/antivirus isn't blocking the exe
- Try running as Administrator
- Check that you have at least 100MB free disk space

### "Rendering Failed" Errors
- Verify your video file is valid (try playing it in another app)
- Check output directory exists and is writable
- Ensure you have enough free disk space for output files
- Try with a simpler preset first (lower resolution/bitrate)

### Missing or Corrupted Output Files
- Check the output directory path in the render plan is correct
- Verify disk space didn't run out during rendering
- Check file permissions on the output directory

### Video Probing Issues
- Try with different video formats (.mp4 works best)
- Ensure the video is not in use by another application
- Check that ffprobe (bundled with the app) isn't blocked by antivirus

## File Locations

- **Presets**: `%APPDATA%\Electron\presets\` (YAML files)
- **Assets**: `%APPDATA%\Electron\` (JSON library files)
- **Logs**: Console output (open browser dev tools with F12)
- **Temporary files**: `%TEMP%\` (cleaned up after rendering)

## System Requirements

- **Windows 10+** (other platforms coming soon)
- **1 GB RAM** (4GB+ recommended for 4K video)
- **2 GB disk space** (for ffmpeg binaries)
- **Additional space** for output videos (depends on duration and bitrate)

## Feedback

Please report issues, feature requests, and user experience feedback to the team. Focus areas for this alpha:

1. **Error message clarity**: Do the error messages help you understand what went wrong?
2. **Ease of use**: Can you easily complete the main workflow?
3. **Preset variety**: Do the default presets cover your needs?
4. **Performance**: How fast are renders on your machine?
5. **Asset management**: Is managing assets intuitive?

## Technical Details

- **Renderer**: ffmpeg (version 5.2.0, bundled)
- **UI**: React 18 + TypeScript + Vite
- **Main process**: Node.js + Electron 26
- **Video probing**: ffprobe
- **Storage**: YAML (presets), JSON (assets)

## Next Steps (Post-Alpha)

- [ ] Packaging as NSIS installer for Windows
- [ ] macOS dmg/zip builds with code signing
- [ ] Linux AppImage/deb packages
- [ ] Settings panel for customization
- [ ] MediaSilo cloud asset integration
- [ ] Batch processing from CLI
- [ ] Advanced color grading/effects
- [ ] Progress notifications and background rendering

---

**Release Date**: April 28, 2026
**Version**: 0.1.0-alpha
**Status**: Team Alpha Testing
