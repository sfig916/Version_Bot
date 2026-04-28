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

async function main() {
  const projectRoot = path.resolve(__dirname, '..');
  const distDir = path.join(projectRoot, 'dist');
  const releaseDir = path.join(distDir, 'release');
  const winUnpackedDir = path.join(distDir, 'win-unpacked');
  const portableDir = path.join(releaseDir, 'Version-Bot-portable');
  const zipPath = path.join(releaseDir, 'Version-Bot-portable.zip');

  try {
    // Step 1: Build the app
    logStep('1/4', 'Building application...');
    execSync('npm run build', { cwd: projectRoot, stdio: 'inherit' });
    logSuccess('Build completed');

    // Step 2: Verify build output
    logStep('2/4', 'Verifying build output...');
    if (!fs.existsSync(winUnpackedDir)) {
      logError(`Build output not found: ${winUnpackedDir}`);
    }
    logSuccess('Build output verified');

    // Step 3: Create portable folder
    logStep('3/4', 'Creating portable distribution folder...');

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

    // Step 4: Create zip archive
    logStep('4/4', 'Creating zip archive...');

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
    log(`  2. They extract the zip file`, 'yellow');
    log(`  3. Run: Version-Bot-portable/Version Bot.exe`, 'yellow');
    log('='.repeat(60) + '\n', 'green');

  } catch (error) {
    logError(error.message);
  }
}

main();
