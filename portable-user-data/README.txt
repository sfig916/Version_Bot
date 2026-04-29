portable-user-data seed bundle

Purpose:
- Source-controlled user-data seed used by packaging scripts when local app data is missing.
- Enables macOS builds from a zipped project root to include presets, libraries, and media assets.

Expected structure:
- portable-user-data/presets/user-presets.yaml
- portable-user-data/version-bot-prepend-library.json
- portable-user-data/version-bot-append-library.json
- portable-user-data/version-bot-overlay-library.json
- portable-user-data/assets/*

Notes:
- Asset paths in presets/libraries should be relative (assets/<filename>).
- Packaging scripts prioritize live user data when present, then fall back to this folder.
