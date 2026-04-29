#!/usr/bin/env node

/**
 * Packaging script: Creates a proper portable distribution
 * 
 * Usage: npm run package:portable
 * Output: dist/release/Version-Bot-portable/ (folder)
 *         dist/release/Version-Bot-portable.zip (archive)
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// Colors for console output
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  blue: '\x1b[34m',
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

function logStep(step, message) {
  log(`\n[${step}] ${message}`, 'blue');
}

function logSuccess(message) {
  log(`✓ ${message}`, 'green');
}

function logError(message) {
  log(`✗ ${message}`, 'red');
  process.exit(1);
}

async function archiveFolder(sourceDir, outputPath) {
  const archiver = require('archiver');
  const output = fs.createWriteStream(outputPath);
  const archive = archiver('zip', { zlib: { level: 6 } });

  return new Promise((resolve, reject) => {
    output.on('close', () => {
      const sizeInMB = (archive.pointer() / 1024 / 1024).toFixed(2);
      logSuccess(`Created ${path.basename(outputPath)} (${sizeInMB} MB)`);
      resolve();
    });

    archive.on('error', (err) => {
      logError(`Archive error: ${err.message}`);
      reject(err);
    });

    archive.pipe(output);
    archive.directory(sourceDir, 'Version-Bot-portable');
    archive.finalize();
  });
}

function getSourceUserDataDir(projectRoot) {
  const YAML = require('yaml');
  const appDataDir = process.env.APPDATA;
  const candidates = [];

  if (appDataDir) {
    candidates.push(path.join(appDataDir, 'version-bot'));
    candidates.push(path.join(appDataDir, 'Electron'));
  }

  candidates.push(path.join(projectRoot, 'portable-user-data'));

  function scoreCandidate(sourceUserData) {
    let configured = 0;
    let existing = 0;

    const resolveConfiguredAssetPath = (assetPath) => (
      path.isAbsolute(assetPath) ? assetPath : path.resolve(sourceUserData, assetPath)
    );

    const register = (assetPath) => {
      if (!assetPath || typeof assetPath !== 'string') return;
      configured++;
      if (fs.existsSync(resolveConfiguredAssetPath(assetPath))) {
        existing++;
      }
    };

    const presetsPath = path.join(sourceUserData, 'presets', 'user-presets.yaml');
    if (fs.existsSync(presetsPath)) {
      try {
        const doc = YAML.parse(fs.readFileSync(presetsPath, 'utf-8'));
        const presets = doc?.presets || [];
        for (const preset of presets) {
          for (const slot of ['introSlate', 'outroSlate', 'overlay']) {
            register(preset?.[slot]?.assetPath);
          }
        }
      } catch {
        // ignore parse errors for scoring
      }
    }

    for (const fileName of [
      'version-bot-prepend-library.json',
      'version-bot-append-library.json',
      'version-bot-overlay-library.json',
    ]) {
      const filePath = path.join(sourceUserData, fileName);
      if (!fs.existsSync(filePath)) continue;
      try {
        const items = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
        if (!Array.isArray(items)) continue;
        for (const item of items) {
          register(item?.path);
        }
      } catch {
        // ignore parse errors for scoring
      }
    }

    return { configured, existing };
  }

  const existingCandidates = candidates.filter((candidateDir) => fs.existsSync(candidateDir));
  if (!existingCandidates.length) {
    return undefined;
  }

  let best = existingCandidates[0];
  let bestScore = scoreCandidate(best);

  for (const candidate of existingCandidates.slice(1)) {
    const score = scoreCandidate(candidate);
    if (
      score.existing > bestScore.existing
      || (score.existing === bestScore.existing && score.configured > bestScore.configured)
    ) {
      best = candidate;
      bestScore = score;
    }
  }

  return best;
}

/**
 * Bundle user data (presets + asset libraries) and copy all referenced media
 * assets into the portable distribution's user-data/ directory.
 *
 * The main process detects user-data/ next to the exe and uses it as userData,
 * and resolves relative asset paths from that directory.
 */
async function bundlePortableUserData(portableDir, projectRoot) {
  const YAML = require('yaml');

  const sourceUserData = getSourceUserDataDir(projectRoot);
  if (!sourceUserData) {
    log('  WARNING: No source user data found (APPDATA or portable-user-data), skipping user data bundling', 'yellow');
    return;
  }
  log(`  Source user data: ${sourceUserData}`);

  const portableUserData = path.join(portableDir, 'user-data');
  const portableAssetsDir = path.join(portableUserData, 'assets');
  fs.mkdirSync(portableAssetsDir, { recursive: true });
  fs.mkdirSync(path.join(portableUserData, 'presets'), { recursive: true });

  // Build a map of source paths → relative destination paths (assets/<filename>)
  // Handles filename collisions by appending a counter suffix.
  const pathMap = new Map(); // absoluteSrcPath → 'assets/filename.ext'
  const configuredPathMap = new Map(); // configured path string → 'assets/filename.ext'
  const usedFilenames = new Set();

  function resolveConfiguredAssetPath(assetPath) {
    if (!assetPath) return undefined;
    return path.isAbsolute(assetPath) ? assetPath : path.resolve(sourceUserData, assetPath);
  }

  function registerAssetPath(configuredPath) {
    if (!configuredPath) return;
    const srcPath = resolveConfiguredAssetPath(configuredPath);
    if (!srcPath) return;

    if (pathMap.has(srcPath)) {
      configuredPathMap.set(configuredPath, pathMap.get(srcPath));
      return;
    }

    let filename = path.basename(srcPath);
    if (usedFilenames.has(filename.toLowerCase())) {
      const ext = path.extname(filename);
      const base = path.basename(filename, ext);
      let counter = 2;
      while (usedFilenames.has(`${base}_${counter}${ext}`.toLowerCase())) counter++;
      filename = `${base}_${counter}${ext}`;
    }
    usedFilenames.add(filename.toLowerCase());
    const relPath = `assets/${filename}`;
    pathMap.set(srcPath, relPath);
    configuredPathMap.set(configuredPath, relPath);
  }

  // ---- Collect paths from live user-presets.yaml ----
  const livePresetsPath = path.join(sourceUserData, 'presets', 'user-presets.yaml');
  let presetsDoc = null;
  if (fs.existsSync(livePresetsPath)) {
    const raw = fs.readFileSync(livePresetsPath, 'utf-8');
    presetsDoc = YAML.parse(raw);
    const presets = presetsDoc?.presets || [];
    for (const preset of presets) {
      for (const slot of ['introSlate', 'outroSlate', 'overlay']) {
        const assetPath = preset[slot]?.assetPath;
        if (assetPath) {
          registerAssetPath(assetPath);
        }
      }
    }
  }

  // ---- Collect paths from asset library JSON files ----
  const libraryNames = [
    'version-bot-prepend-library.json',
    'version-bot-append-library.json',
    'version-bot-overlay-library.json',
  ];
  const liveLibraries = {};
  for (const libName of libraryNames) {
    const libPath = path.join(sourceUserData, libName);
    if (fs.existsSync(libPath)) {
      try {
        const items = JSON.parse(fs.readFileSync(libPath, 'utf-8'));
        liveLibraries[libName] = items;
        for (const item of items) {
          if (item.path) {
            registerAssetPath(item.path);
          }
        }
      } catch {
        log(`  WARNING: Could not parse ${libName}`, 'yellow');
      }
    }
  }

  // ---- Copy asset files ----
  let copied = 0;
  let missing = 0;
  for (const [srcPath, relDst] of pathMap) {
    const dstPath = path.join(portableUserData, relDst);
    if (fs.existsSync(srcPath)) {
      fs.copyFileSync(srcPath, dstPath);
      copied++;
      log(`  Copied: ${path.basename(srcPath)}`);
    } else {
      log(`  WARNING: Asset not found, skipping: ${srcPath}`, 'yellow');
      missing++;
    }
  }
  logSuccess(`Copied ${copied} asset file(s) to user-data/assets/ (${missing} missing)`);

  // ---- Rewrite and write user-presets.yaml ----
  if (presetsDoc) {
    const presets = presetsDoc.presets || [];
    for (const preset of presets) {
      for (const slot of ['introSlate', 'outroSlate', 'overlay']) {
        if (preset[slot]?.assetPath) {
          const rel = configuredPathMap.get(preset[slot].assetPath)
            || pathMap.get(resolveConfiguredAssetPath(preset[slot].assetPath));
          if (rel) preset[slot].assetPath = rel;
        }
      }
    }
    const portablePresetsPath = path.join(portableUserData, 'presets', 'user-presets.yaml');
    fs.writeFileSync(portablePresetsPath, YAML.stringify(presetsDoc), 'utf-8');
    logSuccess('Wrote portable user-presets.yaml with relative asset paths');
  }

  // ---- Rewrite and write asset library JSON files ----
  for (const [libName, items] of Object.entries(liveLibraries)) {
    const rewritten = items.map((item) => {
      const rel = item.path && (
        configuredPathMap.get(item.path)
        || pathMap.get(resolveConfiguredAssetPath(item.path))
      );
      return rel ? { ...item, path: rel } : item;
    });
    const dstPath = path.join(portableUserData, libName);
    fs.writeFileSync(dstPath, JSON.stringify(rewritten, null, 2), 'utf-8');
  }
  logSuccess('Wrote portable asset library files with relative paths');
}

async function main() {
  const projectRoot = path.resolve(__dirname, '..');
  const distDir = path.join(projectRoot, 'dist');
  const releaseDir = path.join(distDir, 'release');
  const winUnpackedDir = path.join(distDir, 'win-unpacked');
  const portableDir = path.join(releaseDir, 'Version-Bot-portable');
  const zipPath = path.join(releaseDir, 'Version-Bot-portable.zip');

  try {
    // Step 1: Build the app
    logStep('1/6', 'Building application...');
    execSync('npm run build', { cwd: projectRoot, stdio: 'inherit' });
    logSuccess('Build completed');

    // Step 2: Create win-unpacked app bundle
    logStep('2/6', 'Creating win-unpacked app bundle...');
    execSync('npx electron-builder --dir --win --publish never', {
      cwd: projectRoot,
      stdio: 'inherit',
    });
    logSuccess('win-unpacked bundle created');

    // Step 3: Verify build output
    logStep('3/6', 'Verifying build output...');
    if (!fs.existsSync(winUnpackedDir)) {
      logError(`Build output not found: ${winUnpackedDir}`);
    }
    logSuccess('Build output verified');

    // Step 4: Create portable folder
    logStep('4/6', 'Creating portable distribution folder...');

    // Clean up old portable folder if it exists
    if (fs.existsSync(portableDir)) {
      fs.rmSync(portableDir, { recursive: true, force: true });
      log('Cleaned up previous portable folder');
    }

    // Ensure release directory exists
    if (!fs.existsSync(releaseDir)) {
      fs.mkdirSync(releaseDir, { recursive: true });
    }

    // Copy win-unpacked to portable folder
    function copyDir(src, dst) {
      if (!fs.existsSync(dst)) {
        fs.mkdirSync(dst, { recursive: true });
      }
      const files = fs.readdirSync(src);
      files.forEach((file) => {
        const srcPath = path.join(src, file);
        const dstPath = path.join(dst, file);
        if (fs.statSync(srcPath).isDirectory()) {
          copyDir(srcPath, dstPath);
        } else {
          fs.copyFileSync(srcPath, dstPath);
        }
      });
    }

    copyDir(winUnpackedDir, portableDir);
    logSuccess(`Portable folder created at ${path.relative(projectRoot, portableDir)}`);

    // Step 5: Bundle user data (presets + asset libraries + media files)
    logStep('5/6', 'Bundling presets, asset libraries, and media files...');
    await bundlePortableUserData(portableDir, projectRoot);

    // Step 6: Create zip archive
    logStep('6/6', 'Creating zip archive...');

    // Clean up old zip if it exists
    if (fs.existsSync(zipPath)) {
      fs.unlinkSync(zipPath);
    }

    await archiveFolder(portableDir, zipPath);

    // Final summary
    log('\n' + '='.repeat(60), 'green');
    logSuccess('Packaging complete!');
    log('\nDistributable files:', 'yellow');
    log(`  📁 Folder: dist/release/Version-Bot-portable/`, 'yellow');
    log(`  📦 Archive: dist/release/Version-Bot-portable.zip`, 'yellow');
    log('\nInstructions for distribution:', 'yellow');
    log(`  1. Share Version-Bot-portable.zip with team members`, 'yellow');
    log(`  2. They extract the zip to any folder`, 'yellow');
    log(`  3. Run: Version-Bot-portable/Version Bot.exe`, 'yellow');
    log(`  4. Presets and assets are pre-configured in user-data/`, 'yellow');
    log('='.repeat(60) + '\n', 'green');

  } catch (error) {
    logError(error.message);
  }
}

main();
