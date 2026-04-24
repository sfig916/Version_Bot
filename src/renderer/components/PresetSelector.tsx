/**
 * Preset selector component
 */

import React, { useState } from 'react';
import { VideoMetadata, OutputPreset } from '../../core/models/types';
import './PresetSelector.css';

interface PresetSelectorProps {
  video: VideoMetadata;
  presets: OutputPreset[];
  selectedPresetIds: string[];
  onPresetToggle: (presetId: string) => void;
  onCreatePlan: (outputDir: string, filenameTemplate: string) => void;
  onBack: () => void;
}

export default function PresetSelector({
  video,
  presets,
  selectedPresetIds,
  onPresetToggle,
  onCreatePlan,
  onBack,
}: PresetSelectorProps) {
  const [outputDir, setOutputDir] = useState<string | null>(null);
  const [filenameTemplate, setFilenameTemplate] = useState(
    '{preset}_{width}x{height}_{timestamp}.{ext}'
  );
  const [isSelectingDir, setIsSelectingDir] = useState(false);

  const handleSelectOutputDir = async () => {
    setIsSelectingDir(true);
    try {
      const dir = await window.versionBotAPI.selectOutputDirectory();
      if (dir) {
        setOutputDir(dir);
      }
    } catch (error) {
      console.error('Error selecting output directory:', error);
    }
    setIsSelectingDir(false);
  };

  const handleCreatePlan = () => {
    if (!outputDir) {
      alert('Please select an output directory');
      return;
    }
    onCreatePlan(outputDir, filenameTemplate);
  };

  return (
    <div className="preset-selector">
      <button className="btn btn-secondary" onClick={onBack}>
        ← Back
      </button>

      <div className="selector-content">
        <h2>Select Export Presets</h2>

        <div className="video-info">
          <h3>Source Video</h3>
          <ul>
            <li>
              <strong>Resolution:</strong> {video.width}x{video.height}
            </li>
            <li>
              <strong>Aspect Ratio:</strong> {video.aspectRatio.toFixed(3)}
            </li>
            <li>
              <strong>Duration:</strong> {Math.floor(video.duration / 60)}:
              {String(video.duration % 60).padStart(2, '0')}
            </li>
            <li>
              <strong>Codec:</strong> {video.codec}
            </li>
          </ul>
        </div>

        <div className="presets-grid">
          {presets.map((preset) => (
            <div
              key={preset.id}
              className={`preset-card ${selectedPresetIds.includes(preset.id) ? 'selected' : ''}`}
              onClick={() => onPresetToggle(preset.id)}
            >
              <div className="preset-checkbox">
                <input
                  type="checkbox"
                  checked={selectedPresetIds.includes(preset.id)}
                  onChange={() => {}}
                />
              </div>
              <h4>{preset.name}</h4>
              <p className="preset-resolution">
                {preset.width}x{preset.height}
              </p>
              <p className="preset-codec">
                {preset.videoCodec} @ {preset.bitrate}kbps
              </p>
              <p className="preset-audio">
                {preset.audioCodec} @ {preset.audioBitrate}kbps
              </p>
            </div>
          ))}
        </div>

        <div className="output-settings">
          <h3>Output Settings</h3>

          <div className="form-group">
            <label>Output Directory</label>
            <div className="input-group">
              <input
                type="text"
                value={outputDir || ''}
                disabled
                placeholder="Select output directory"
              />
              <button
                className="btn btn-secondary"
                onClick={handleSelectOutputDir}
                disabled={isSelectingDir}
              >
                Browse
              </button>
            </div>
          </div>

          <div className="form-group">
            <label>
              Filename Template
              <span className="help-text">
                Use {'{preset}'} {'{width}x{height}'} {'{timestamp}'} {'{ext}'}
              </span>
            </label>
            <input
              type="text"
              value={filenameTemplate}
              onChange={(e) => setFilenameTemplate(e.target.value)}
            />
          </div>
        </div>

        <div className="actions">
          <button
            className="btn btn-primary"
            onClick={handleCreatePlan}
            disabled={selectedPresetIds.length === 0 || !outputDir}
          >
            Create Render Plan ({selectedPresetIds.length} presets)
          </button>
        </div>
      </div>
    </div>
  );
}
