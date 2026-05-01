import React, { useState, useEffect } from 'react';
import { OutputPreset } from '../../core/models/types';
import './UpdatePanel.css';

interface UpdateStatus {
  available: boolean;
  currentVersion: string;
  newVersion?: string;
  status: 'idle' | 'checking' | 'downloading' | 'ready' | 'error';
  downloadProgress?: number;
  message?: string;
}

interface BundleStatus {
  checking: boolean;
  available: boolean;
  currentVersion?: string;
  bundleVersion?: string;
  message?: string;
  releaseNotes?: string;
}

interface BundleUpdateResultView {
  bundleVersion: string;
  presetsAdded: number;
  presetsUpdated: number;
  assetsAdded: number;
  message: string;
  releaseNotes?: string;
}

export function UpdatePanel() {
  const [appUpdate, setAppUpdate] = useState<UpdateStatus | null>(null);
  const [bundleStatus, setBundleStatus] = useState<BundleStatus>({
    checking: false,
    available: false,
  });
  const [bundleUrl] = useState<string>(import.meta.env.VITE_BUNDLE_URL || '');
  const [storedBundleVersion, setStoredBundleVersion] = useState<string | undefined>(() => {
    return localStorage.getItem('bundleVersion') || undefined;
  });

  // Load app update status on mount
  useEffect(() => {
    loadUpdateStatus();
  }, []);

  const loadUpdateStatus = async () => {
    try {
      const result = await window.versionBotAPI.getAppUpdateStatus();
      if (result.success && result.data) {
        setAppUpdate(result.data as UpdateStatus);
      }
    } catch (error) {
      console.error('Failed to get update status:', error);
    }
  };

  const handleCheckAppUpdates = async () => {
    setAppUpdate((prev) =>
      prev ? { ...prev, status: 'checking' } : { available: false, currentVersion: '0.0.0', status: 'checking' }
    );

    try {
      const result = await window.versionBotAPI.checkAppUpdates();
      if (result.success && result.data) {
        setAppUpdate(result.data as UpdateStatus);
      } else {
        setAppUpdate((prev) =>
          prev ? { ...prev, status: 'error', message: result.error } : null
        );
      }
    } catch (error) {
      setAppUpdate((prev) =>
        prev ? { ...prev, status: 'error', message: String(error) } : null
      );
    }
  };

  const handleInstallUpdate = () => {
    if (appUpdate?.status === 'ready') {
      window.versionBotAPI.quitAndInstallUpdate();
    }
  };

  const handleCheckBundleUpdates = async () => {
    if (!bundleUrl) {
      setBundleStatus({
        checking: false,
        available: false,
        message: 'Bundle URL not configured',
      });
      return;
    }

    setBundleStatus({ checking: true, available: false });

    try {
      const result = await window.versionBotAPI.checkBundleUpdates(bundleUrl, storedBundleVersion);
      if (result.success && result.data) {
        const data = result.data as BundleStatus;
        const { available, bundleVersion, releaseNotes } = data;
        setBundleStatus({
          checking: false,
          available,
          bundleVersion,
          currentVersion: storedBundleVersion,
          releaseNotes,
          message: available ? `Bundle update available: v${bundleVersion}` : 'You have the latest presets',
        });
      } else {
        setBundleStatus({
          checking: false,
          available: false,
          message: result.error || 'Failed to check for updates',
        });
      }
    } catch (error) {
      setBundleStatus({
        checking: false,
        available: false,
        message: String(error),
      });
    }
  };

  const handleDownloadBundle = async () => {
    if (!bundleUrl || !bundleStatus.available) return;

    setBundleStatus((prev) => ({ ...prev, checking: true }));

    try {
      // Get current presets and assets to merge with
      const presetsResult = await window.versionBotAPI.listPresets();
      const presetsAssets = (presetsResult.success ? presetsResult.data : []) as OutputPreset[];

      let assetsLibrary: Record<string, unknown> = {};
      try {
        const prepend = await window.versionBotAPI.getAssetLibrary('version-bot-prepend-library');
        const append = await window.versionBotAPI.getAssetLibrary('version-bot-append-library');
        const overlay = await window.versionBotAPI.getAssetLibrary('version-bot-overlay-library');

        if (prepend.success) assetsLibrary['version-bot-prepend-library'] = prepend.data;
        if (append.success) assetsLibrary['version-bot-append-library'] = append.data;
        if (overlay.success) assetsLibrary['version-bot-overlay-library'] = overlay.data;
      } catch {
        // Ignore asset library errors
      }

      const result = await window.versionBotAPI.downloadAndMergeBundle(
        bundleUrl,
        Object.fromEntries(presetsAssets.map((preset) => [preset.id, preset])),
        assetsLibrary
      );

      if (result.success && result.data) {
        const data = result.data as BundleUpdateResultView;
        const { bundleVersion, presetsAdded, presetsUpdated, assetsAdded, message, releaseNotes } = data;
        setStoredBundleVersion(bundleVersion);
        localStorage.setItem('bundleVersion', bundleVersion);

        setBundleStatus({
          checking: false,
          available: false,
          message: `✓ ${message}`,
          releaseNotes,
        });

        // Reload presets in parent component by dispatching custom event
        window.dispatchEvent(new CustomEvent('bundleUpdated', { detail: { presetsAdded, presetsUpdated, assetsAdded } }));
      } else {
        setBundleStatus({
          checking: false,
          available: false,
          message: `Failed: ${result.error || 'Bundle merge failed'}`,
        });
      }
    } catch (error) {
      setBundleStatus({
        checking: false,
        available: false,
        message: `Error: ${String(error)}`,
      });
    }
  };

  return (
    <div className="update-panel">
      <div className="update-section">
        <h3>App Updates</h3>
        {appUpdate && (
          <div className="update-status">
            <div className="status-info">
              <span>Current: v{appUpdate.currentVersion}</span>
              {appUpdate.newVersion && <span className="new-version">New: v{appUpdate.newVersion}</span>}
            </div>

            {appUpdate.status === 'downloading' && appUpdate.downloadProgress !== undefined && (
              <div className="progress-bar">
                <div className="progress-fill" style={{ width: `${appUpdate.downloadProgress}%` }}>
                  {Math.round(appUpdate.downloadProgress)}%
                </div>
              </div>
            )}

            {appUpdate.status === 'ready' && (
              <div className="action-buttons">
                <button onClick={handleInstallUpdate} className="btn-primary">
                  Restart & Install Update
                </button>
              </div>
            )}

            {appUpdate.status === 'idle' || appUpdate.status === 'error' ? (
              <button onClick={handleCheckAppUpdates} className="btn-secondary" disabled={appUpdate.status === 'checking'}>
                {appUpdate.status === 'checking' ? 'Checking...' : 'Check for Updates'}
              </button>
            ) : null}

            {appUpdate.message && <p className="status-message">{appUpdate.message}</p>}
          </div>
        )}
      </div>

      {bundleUrl && (
        <div className="update-section">
          <h3>Preset Bundles</h3>
          <div className="bundle-status">
            <div className="status-info">
              {storedBundleVersion && <span>Current Bundle: v{storedBundleVersion}</span>}
              {bundleStatus.bundleVersion && <span className="new-version">Available: v{bundleStatus.bundleVersion}</span>}
            </div>

            <div className="action-buttons">
              <button
                onClick={handleCheckBundleUpdates}
                disabled={bundleStatus.checking}
                className="btn-secondary"
              >
                {bundleStatus.checking ? 'Checking...' : 'Check for Updates'}
              </button>

              {bundleStatus.available && (
                <button
                  onClick={handleDownloadBundle}
                  disabled={bundleStatus.checking}
                  className="btn-primary"
                >
                  {bundleStatus.checking ? 'Downloading...' : 'Download & Merge'}
                </button>
              )}
            </div>

            {bundleStatus.message && <p className="status-message">{bundleStatus.message}</p>}
            {bundleStatus.releaseNotes && (
              <details className="release-notes">
                <summary>Release Notes</summary>
                <p>{bundleStatus.releaseNotes}</p>
              </details>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
