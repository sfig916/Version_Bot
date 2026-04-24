/**
 * Video file selector component
 */

import React, { useState } from 'react';
import { VideoMetadata } from '../../core/models/types';
import './VideoSelector.css';

interface VideoSelectorProps {
  onVideoSelected: (metadata: VideoMetadata) => void;
  onError: (error: string) => void;
  error: string | null;
}

export default function VideoSelector({
  onVideoSelected,
  onError,
  error,
}: VideoSelectorProps) {
  const [isLoading, setIsLoading] = useState(false);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);

  const handleSelectFile = async () => {
    setIsLoading(true);
    setSelectedFile(null);
    onError('');

    try {
      const filePath = await window.versionBotAPI.selectVideoFile();
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
        onError(result.error || 'Failed to probe video');
      }
    } catch (error) {
      setIsLoading(false);
      onError(
        error instanceof Error ? error.message : 'Unknown error occurred'
      );
    }
  };

  return (
    <div className="video-selector">
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

        {error && (
          <div className="error-message">
            <strong>Error:</strong> {error}
          </div>
        )}
      </div>
    </div>
  );
}
