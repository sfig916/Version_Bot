/**
 * Video file selector component
 */

import React, { useState } from 'react';
import { VideoMetadata } from '../../core/models/types';
import { AppError } from '../utils/errorHandler';
import './VideoSelector.css';

interface VideoSelectorProps {
  onVideoSelected: (metadata: VideoMetadata) => void;
  onError: (error: string) => void;
  error: AppError | null;
  onManagePresets: () => void;
  onManageAssets: () => void;
}

export default function VideoSelector({
  onVideoSelected,
  onError,
  error,
  onManagePresets,
  onManageAssets,
}: VideoSelectorProps) {
  const [isLoading, setIsLoading] = useState(false);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);

  const handleSelectFile = async () => {
    setIsLoading(true);
    setSelectedFile(null);
    onError('');

    try {
      console.log('[VideoSelector] Starting file selection...');
      const filePath = await window.versionBotAPI.selectVideoFile();
      console.log('[VideoSelector] File path selected:', filePath);
      
      if (!filePath) {
        setIsLoading(false);
        return;
      }

      setSelectedFile(filePath);

      const result = await window.versionBotAPI.probeVideo(filePath);
      setIsLoading(false);

      if (result.success && result.data) {
        onVideoSelected(result.data);
      } else {
        const errorMsg = result.error || 'Failed to probe video';
        console.error('[VideoSelector] Probe failed:', errorMsg);
        onError(errorMsg);
      }
    } catch (error) {
      setIsLoading(false);
      const errorMsg = error instanceof Error ? error.message : 'Unknown error occurred';
      const errorStack = error instanceof Error ? error.stack : undefined;
      console.error('[VideoSelector] Error caught:', { message: errorMsg, stack: errorStack, fullError: error });
      onError(errorMsg);
    }
  };

  return (
    <div className="video-selector">
      <div className="video-selector-content">
        <div className="selector-content">
          <div className="icon">🎬</div>
          <h2>Select Master Video</h2>
          <p>Choose a video file to create versions from</p>

          <button
            className="btn btn-primary"
            onClick={handleSelectFile}
            disabled={isLoading}
          >
            {isLoading ? 'Analyzing...' : 'Select Video File'}
          </button>

          {selectedFile && (
            <p className="selected-file">{selectedFile}</p>
          )}
        </div>

        <div className="video-selector-actions">
          <button
            className="btn btn-nav"
            onClick={onManagePresets}
            title="Manage rendering presets and output formats"
          >
            ⚙️ Manage Presets
          </button>
          <button
            className="btn btn-nav"
            onClick={onManageAssets}
            title="Manage prepend, append, and overlay assets"
          >
            📁 Manage Assets
          </button>
        </div>
      </div>
    </div>
  );
}
