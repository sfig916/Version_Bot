#!/usr/bin/env node

/**
 * Packaging script: Creates a macOS zip distribution with bundled user-data.
 *
 * Usage: npm run package:macos
 * Output: dist/release/Version-Bot-macOS/ (folder)
 *         dist/release/Version-Bot-macOS.zip (archive)
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execSync } = require('child_process');

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

function copyDir(src, dst) {
  if (!fs.existsSync(dst)) {
    fs.mkdirSync(dst, { recursive: true });
  }

  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const dstPath = path.join(dst, entry.name);
    if (entry.isDirectory()) {
      copyDir(srcPath, dstPath);
    } else {
      fs.copyFileSync(srcPath, dstPath);
    }
  }
}

async function archiveFolder(sourceDir, outputPath, rootName) {
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
    archive.directory(sourceDir, rootName);
    archive.finalize();
  });
}

function getLiveUserDataDir() {
  const appSupportDir = path.join(os.homedir(), 'Library', 'Application Support');
  const candidates = [
    path.join(appSupportDir, 'version-bot'),
    path.join(appSupportDir, 'Version Bot'),
    path.join(appSupportDir, 'Electron'),
  ];

  return candidates.find((candidateDir) => fs.existsSync(candidateDir));
}

function getSourceUserDataDir(projectRoot) {
  const candidates = [];

  // Prefer project seed data so builds from a zipped source tree are deterministic.
  candidates.push(path.join(projectRoot, 'portable-user-data'));

  const liveUserData = getLiveUserDataDir();
  if (liveUserData) {
    candidates.push(liveUserData);
  }

  return candidates.find((candidateDir) => fs.existsSync(candidateDir));
}

async function bundlePortableUserData(distributionDir, projectRoot) {
  const YAML = require('yaml');

  const sourceUserData = getSourceUserDataDir(projectRoot);
  if (!sourceUserData) {
    log('  WARNING: No source user data found (macOS App Support or portable-user-data), skipping user data bundling', 'yellow');
    return;
  }
  log(`  Source user data: ${sourceUserData}`);

  const portableUserData = path.join(distributionDir, 'user-data');
  const portableAssetsDir = path.join(portableUserData, 'assets');
  fs.mkdirSync(portableAssetsDir, { recursive: true });
  fs.mkdirSync(path.join(portableUserData, 'presets'), { recursive: true });

  const pathMap = new Map(); // absoluteSrcPath -> assets/filename.ext
  const configuredPathMap = new Map(); // configured path -> assets/filename.ext
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

  const libraryNames = [
    'version-bot-prepend-library.json',
    'version-bot-append-library.json',
    'version-bot-overlay-library.json',
  ];
  const liveLibraries = {};
  for (const libName of libraryNames) {
    const libPath = path.join(sourceUserData, libName);
    if (!fs.existsSync(libPath)) continue;

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
  if (process.platform !== 'darwin') {
    logError('npm run package:macos must be run on macOS.');
  }

  const projectRoot = path.resolve(__dirname, '..');
  const distDir = path.join(projectRoot, 'dist');
  const releaseDir = path.join(distDir, 'release');
  const macAppSourceDir = path.join(distDir, 'mac', 'Version Bot.app');
  const macReleaseDir = path.join(releaseDir, 'Version-Bot-macOS');
  const macReleaseAppDir = path.join(macReleaseDir, 'Version Bot.app');
  const zipPath = path.join(releaseDir, 'Version-Bot-macOS.zip');

  try {
    logStep('1/5', 'Building application...');
    execSync('npm run build', { cwd: projectRoot, stdio: 'inherit' });
    logSuccess('Build completed');

    logStep('2/5', 'Creating macOS app bundle...');
    execSync('npx electron-builder --dir --mac --publish never', {
      cwd: projectRoot,
      stdio: 'inherit',
    });
    if (!fs.existsSync(macAppSourceDir)) {
      logError(`Build output not found: ${macAppSourceDir}`);
    }
    logSuccess('macOS app bundle verified');

    logStep('3/5', 'Creating macOS distribution folder...');
    if (fs.existsSync(macReleaseDir)) {
      fs.rmSync(macReleaseDir, { recursive: true, force: true });
      log('Cleaned up previous macOS release folder');
    }
    if (!fs.existsSync(releaseDir)) {
      fs.mkdirSync(releaseDir, { recursive: true });
    }
    copyDir(macAppSourceDir, macReleaseAppDir);
    logSuccess(`macOS release folder created at ${path.relative(projectRoot, macReleaseDir)}`);

    logStep('4/5', 'Bundling presets, asset libraries, and media files...');
    await bundlePortableUserData(macReleaseDir, projectRoot);

    logStep('5/5', 'Creating zip archive...');
    if (fs.existsSync(zipPath)) {
      fs.unlinkSync(zipPath);
    }
    await archiveFolder(macReleaseDir, zipPath, 'Version-Bot-macOS');

    log('\n' + '='.repeat(60), 'green');
    logSuccess('Packaging complete!');
    log('\nDistributable files:', 'yellow');
    log('  Folder: dist/release/Version-Bot-macOS/', 'yellow');
    log('  Archive: dist/release/Version-Bot-macOS.zip', 'yellow');
    log('\nInstructions for distribution:', 'yellow');
    log('  1. Run npm run package:macos on a Mac', 'yellow');
    log('  2. Share Version-Bot-macOS.zip with Mac users', 'yellow');
    log('  3. They extract the zip and open Version Bot.app', 'yellow');
    log('  4. If Gatekeeper warns, right-click the app and choose Open', 'yellow');
    log('  5. Presets and assets are pre-configured in user-data/', 'yellow');
    log('='.repeat(60) + '\n', 'green');
  } catch (error) {
    logError(error.message);
  }
}

main();