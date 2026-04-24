/**
 * Main App component
 */

import React, { useState, useEffect } from 'react';
import { VideoMetadata, OutputPreset, RenderPlan } from '../../core/models/types';
import VideoSelector from './VideoSelector';
import PresetSelector from './PresetSelector';
import RenderPlanner from './RenderPlanner';
import './App.css';

type AppView = 'video-select' | 'preset-select' | 'render-plan' | 'exporting';

interface AppState {
  currentView: AppView;
  selectedVideo: VideoMetadata | null;
  videoError: string | null;
  availablePresets: OutputPreset[];
  selectedPresets: Set<string>;
  renderPlan: RenderPlan | null;
  isLoading: boolean;
}

export default function App() {
  const [state, setState] = useState<AppState>({
    currentView: 'video-select',
    selectedVideo: null,
    videoError: null,
    availablePresets: [],
    selectedPresets: new Set(),
    renderPlan: null,
    isLoading: false,
  });

  // Load presets on mount
  useEffect(() => {
    loadPresets();
  }, []);

  const loadPresets = async () => {
    setState((prev) => ({ ...prev, isLoading: true }));
    try {
      const result = await window.versionBotAPI.listPresets();
      if (result.success && result.data) {
        setState((prev) => ({
          ...prev,
          availablePresets: result.data!,
          isLoading: false,
        }));
      } else {
        console.error('Failed to load presets:', result.error);
        setState((prev) => ({ ...prev, isLoading: false }));
      }
    } catch (error) {
      console.error('Error loading presets:', error);
      setState((prev) => ({ ...prev, isLoading: false }));
    }
  };

  const handleVideoSelected = async (metadata: VideoMetadata) => {
    setState((prev) => ({
      ...prev,
      selectedVideo: metadata,
      selectedPresets: new Set(),
      videoError: null,
      currentView: 'preset-select',
    }));
  };

  const handleVideoError = (error: string) => {
    setState((prev) => ({
      ...prev,
      videoError: error,
      selectedVideo: null,
    }));
  };

  const handlePresetToggle = (presetId: string) => {
    setState((prev) => {
      const newSelected = new Set(prev.selectedPresets);
      if (newSelected.has(presetId)) {
        newSelected.delete(presetId);
      } else {
        newSelected.add(presetId);
      }
      return { ...prev, selectedPresets: newSelected };
    });
  };

  const handleCreatePlan = async (
    outputDir: string,
    filenameTemplate: string
  ) => {
    if (!state.selectedVideo) {
      console.error('No video selected');
      return;
    }

    if (state.selectedPresets.size === 0) {
      console.error('No presets selected');
      return;
    }

    setState((prev) => ({ ...prev, isLoading: true }));

    try {
      const result = await window.versionBotAPI.createRenderPlan(
        state.selectedVideo,
        Array.from(state.selectedPresets),
        state.availablePresets,
        outputDir,
        filenameTemplate
      );

      if (result.success && result.data) {
        setState((prev) => ({
          ...prev,
          renderPlan: result.data!,
          currentView: 'render-plan',
          isLoading: false,
        }));
      } else {
        console.error('Failed to create render plan:', result.error);
        setState((prev) => ({ ...prev, isLoading: false }));
      }
    } catch (error) {
      console.error('Error creating render plan:', error);
      setState((prev) => ({ ...prev, isLoading: false }));
    }
  };

  const handleReset = () => {
    setState({
      currentView: 'video-select',
      selectedVideo: null,
      videoError: null,
      availablePresets: state.availablePresets,
      selectedPresets: new Set(),
      renderPlan: null,
      isLoading: false,
    });
  };

  return (
    <div className="app">
      <header className="app-header">
        <h1>Version Bot</h1>
        <p>Video Versioning & Batch Export Tool</p>
      </header>

      <main className="app-main">
        {state.isLoading && (
          <div className="loading-overlay">
            <div className="spinner"></div>
            <p>Loading...</p>
          </div>
        )}

        {state.currentView === 'video-select' && (
          <VideoSelector
            onVideoSelected={handleVideoSelected}
            onError={handleVideoError}
            error={state.videoError}
          />
        )}

        {state.currentView === 'preset-select' && state.selectedVideo && (
          <PresetSelector
            video={state.selectedVideo}
            presets={state.availablePresets}
            selectedPresetIds={Array.from(state.selectedPresets)}
            onPresetToggle={handlePresetToggle}
            onCreatePlan={handleCreatePlan}
            onBack={handleReset}
          />
        )}

        {state.currentView === 'render-plan' && state.renderPlan && (
          <RenderPlanner
            plan={state.renderPlan}
            onReset={handleReset}
          />
        )}
      </main>

      <footer className="app-footer">
        <p>Version Bot v0.1.0</p>
      </footer>
    </div>
  );
}
