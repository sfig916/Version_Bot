/**
 * Video file selector component
 */

import React, { useState } from 'react';
import { VideoMetadata } from '../../core/models/types';
import { AppError } from '../utils/errorHandler';
import './VideoSelector.css';

interface VideoSelectorProps {
  selectedVideo: VideoMetadata | null;
  onVideoSelected: (metadata: VideoMetadata) => void;
  onError: (error: string) => void;
  error: AppError | null;
  onContinueWithSelected: () => void;
  onClearSelectedVideo: () => void;
  onManagePresets: () => void;
  onManageAssets: () => void;
}

export default function VideoSelector({
  selectedVideo,
  onVideoSelected,
  onError,
  error,
  onContinueWithSelected,
  onClearSelectedVideo,
  onManagePresets,
  onManageAssets,
}: VideoSelectorProps) {
  const [isLoading, setIsLoading] = useState(false);

  const handleSelectFile = async () => {
    setIsLoading(true);
    onError('');

    try {
      console.log('[VideoSelector] Starting file selection...');
      const filePath = await window.versionBotAPI.selectVideoFile();
      console.log('[VideoSelector] File path selected:', filePath);
      
      if (!filePath) {
        setIsLoading(false);
        return;
      }

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
        <div className={`selector-content ${selectedVideo ? 'has-selected-video' : 'no-selected-video'}`}>
          <div className="icon">🎬</div>
          <h2>Select Master Video</h2>
          <p>Choose a video file to create versions from</p>

          <button
            className="btn btn-primary"
            onClick={handleSelectFile}
            disabled={isLoading}
          >
            {isLoading
              ? 'Analyzing...'
              : selectedVideo
                ? 'Change Video File'
                : 'Select Video File'}
          </button>

          {selectedVideo && (
            <>
              <div className="selected-video-card">
                <p className="selected-file-label">Current source video</p>
                <p className="selected-file">{selectedVideo.filePath}</p>
              </div>

              <div className="selected-video-actions">
                <button
                  className="btn btn-secondary"
                  onClick={onContinueWithSelected}
                  disabled={isLoading}
                >
                  Continue With This Video
                </button>
                <button
                  className="btn btn-clear"
                  onClick={onClearSelectedVideo}
                  disabled={isLoading}
                >
                  Remove Source Video
                </button>
              </div>
            </>
          )}
        </div>

        <div className="video-selector-actions">
          <button
            className="btn btn-nav"
            onClick={onManagePresets}
            title="Manage rendering presets and output formats"
          >
            <span className="btn-icon" aria-hidden="true">⚙️</span>
            <span className="btn-text">Manage Presets</span>
          </button>
          <button
            className="btn btn-nav"
            onClick={onManageAssets}
            title="Manage prepend, append, and overlay assets"
          >
            <span className="btn-icon" aria-hidden="true">📁</span>
            <span className="btn-text">Manage Assets</span>
          </button>
        </div>
      </div>
    </div>
  );
}
