/**
 * Main App component
 */

import React, { useState, useEffect } from 'react';
import { VideoMetadata, OutputPreset, RenderPlan } from '../../core/models/types';
import { hasMatchingAspectRatio } from '../../core/rendering/aspectRatio';
import VideoSelector from './VideoSelector';
import PresetSelector from './PresetSelector';
import PresetManager from './PresetManager';
import RenderPlanner from './RenderPlanner';
import './App.css';

type AppView = 'video-select' | 'preset-select' | 'render-plan' | 'exporting' | 'preset-manager';

interface JobProgressEvent {
  jobId: string;
  progress: number;
  currentTime: number;
  fps: number;
  speed: string;
}

interface JobCompleteEvent {
  jobId: string;
  success: boolean;
  outputPath?: string;
  error?: string;
  durationMs: number;
}

function calculatePlanProgress(plan: RenderPlan): number {
  if (plan.jobs.length === 0) {
    return 0;
  }

  const total = plan.jobs.reduce((sum, job) => sum + job.progress, 0);
  return Math.round(total / plan.jobs.length);
}

function derivePlanStatus(plan: RenderPlan): RenderPlan['status'] {
  if (plan.jobs.length === 0) {
    return 'pending';
  }

  const statuses = plan.jobs.map((job) => job.status);
  if (statuses.includes('failed')) {
    return 'failed';
  }

  if (statuses.includes('running')) {
    return 'running';
  }

  if (statuses.every((status) => status === 'completed')) {
    return 'completed';
  }

  if (statuses.includes('cancelled')) {
    return 'cancelled';
  }

  return 'pending';
}

function getCompatiblePresetIds(
  video: VideoMetadata,
  presets: OutputPreset[]
): string[] {
  return presets
    .filter((preset) =>
      hasMatchingAspectRatio(video.aspectRatio, preset.width, preset.height)
    )
    .map((preset) => preset.id);
}

interface AppState {
  currentView: AppView;
  selectedVideo: VideoMetadata | null;
  videoError: string | null;
  availablePresets: OutputPreset[];
  selectedPresets: Set<string>;
  renderPlan: RenderPlan | null;
  isRendering: boolean;
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
    isRendering: false,
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
    const compatiblePresetIds = getCompatiblePresetIds(
      metadata,
      state.availablePresets
    );

    setState((prev) => ({
      ...prev,
      selectedVideo: metadata,
      selectedPresets: new Set(compatiblePresetIds),
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
    filenameTemplate: string,
    fileSizeConstraints: Record<string, number>,
    autoRun = false
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
        filenameTemplate,
        fileSizeConstraints
      );

      if (result.success && result.data) {
        setState((prev) => ({
          ...prev,
          renderPlan: result.data!,
          currentView: 'render-plan',
          isRendering: false,
          isLoading: false,
        }));

        if (autoRun) {
          await handleStartRender(result.data!);
        }
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
    window.versionBotAPI.removeRenderListeners();

    setState({
      currentView: 'video-select',
      selectedVideo: null,
      videoError: null,
      availablePresets: state.availablePresets,
      selectedPresets: new Set(),
      renderPlan: null,
      isRendering: false,
      isLoading: false,
    });
  };

  const handleUpsertPreset = async (
    preset: OutputPreset,
    previousPresetId?: string
  ) => {
    const nextPresets = (() => {
      const matchId = previousPresetId || preset.id;
      const existingIndex = state.availablePresets.findIndex(
        (existing) => existing.id === matchId
      );

      if (existingIndex === -1) {
        return [...state.availablePresets, preset];
      }

      return state.availablePresets.map((existing) =>
        existing.id === matchId ? preset : existing
      );
    })();

    try {
      const result = await window.versionBotAPI.savePresets(nextPresets);
      if (!result.success || !result.data) {
        alert(`Failed to save preset: ${result.error || 'unknown error'}`);
        return;
      }

      setState((prev) => ({
        ...prev,
        availablePresets: result.data!,
        selectedPresets: (() => {
          const next = new Set(prev.selectedPresets);
          if (previousPresetId && previousPresetId !== preset.id) {
            next.delete(previousPresetId);
          }
          next.add(preset.id);
          return next;
        })(),
      }));
    } catch (error) {
      console.error('Failed to persist preset:', error);
      alert('Failed to persist preset');
    }
  };

  const handleStartRender = async (planOverride?: RenderPlan) => {
    const plan = planOverride || state.renderPlan;
    if (!plan || state.isRendering) {
      return;
    }

    window.versionBotAPI.removeRenderListeners();

    window.versionBotAPI.onRenderProgress((progress: JobProgressEvent) => {
      setState((prev) => {
        if (!prev.renderPlan) {
          return prev;
        }

        const jobs = prev.renderPlan.jobs.map((job) => {
          if (job.id !== progress.jobId) {
            return job;
          }

          return {
            ...job,
            progress: progress.progress,
            status: progress.progress >= 100 ? job.status : 'running',
          };
        });

        const updatedPlan: RenderPlan = {
          ...prev.renderPlan,
          jobs,
        };

        updatedPlan.progress = calculatePlanProgress(updatedPlan);
        updatedPlan.status = derivePlanStatus(updatedPlan);

        return {
          ...prev,
          renderPlan: updatedPlan,
        };
      });
    });

    window.versionBotAPI.onJobComplete((result: JobCompleteEvent) => {
      setState((prev) => {
        if (!prev.renderPlan) {
          return prev;
        }

        const jobs = prev.renderPlan.jobs.map((job) => {
          if (job.id !== result.jobId) {
            return job;
          }

          return {
            ...job,
            progress: result.success ? 100 : job.progress,
            status: result.success ? 'completed' : 'failed',
            error: result.error,
            completedAt: new Date(),
          };
        });

        const updatedPlan: RenderPlan = {
          ...prev.renderPlan,
          jobs,
        };

        updatedPlan.progress = calculatePlanProgress(updatedPlan);
        updatedPlan.status = derivePlanStatus(updatedPlan);

        return {
          ...prev,
          renderPlan: updatedPlan,
        };
      });
    });

    setState((prev) => ({
      ...prev,
      isRendering: true,
      currentView: 'render-plan',
      renderPlan: prev.renderPlan
        ? {
            ...prev.renderPlan,
            status: 'running',
          }
        : {
            ...plan,
            status: 'running',
          },
    }));

    try {
      const result = await window.versionBotAPI.startRender();
      if (!result.success) {
        alert(`Render failed: ${result.error || 'unknown error'}`);
      }
    } catch (error) {
      console.error('Failed to start render:', error);
      alert('Failed to start render');
    } finally {
      setState((prev) => ({ ...prev, isRendering: false }));
      window.versionBotAPI.removeRenderListeners();
    }
  };

  const handleDeletePreset = async (presetId: string) => {
    const nextPresets = state.availablePresets.filter((p) => p.id !== presetId);
    try {
      const result = await window.versionBotAPI.savePresets(nextPresets);
      if (!result.success || !result.data) {
        alert(`Failed to delete preset: ${result.error || 'unknown error'}`);
        return;
      }
      setState((prev) => ({
        ...prev,
        availablePresets: result.data!,
        selectedPresets: new Set([...prev.selectedPresets].filter((id) => id !== presetId)),
      }));
    } catch (error) {
      console.error('Failed to delete preset:', error);
      alert('Failed to delete preset');
    }
  };

  const handleCancelRender = async () => {
    try {
      await window.versionBotAPI.cancelRender();
      setState((prev) => ({
        ...prev,
        isRendering: false,
        renderPlan: prev.renderPlan
          ? {
              ...prev.renderPlan,
              status: 'cancelled',
            }
          : prev.renderPlan,
      }));
    } catch (error) {
      console.error('Failed to cancel render:', error);
      alert('Failed to cancel render');
    }
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
            onManagePresets={() => setState((prev) => ({ ...prev, currentView: 'preset-manager' }))}
          />
        )}

        {state.currentView === 'preset-manager' && (
          <PresetManager
            presets={state.availablePresets}
            onUpsertPreset={handleUpsertPreset}
            onDeletePreset={handleDeletePreset}
            onBack={() => setState((prev) => ({ ...prev, currentView: 'video-select' }))}
          />
        )}

        {state.currentView === 'preset-select' && state.selectedVideo && (
          <PresetSelector
            video={state.selectedVideo}
            presets={state.availablePresets.filter((preset) =>
              hasMatchingAspectRatio(
                state.selectedVideo!.aspectRatio,
                preset.width,
                preset.height
              )
            )}
            selectedPresetIds={Array.from(state.selectedPresets)}
            onPresetToggle={handlePresetToggle}
            onCreatePlan={handleCreatePlan}
            onUpsertPreset={handleUpsertPreset}
            onBack={handleReset}
          />
        )}

        {state.currentView === 'render-plan' && state.renderPlan && (
          <RenderPlanner
            plan={state.renderPlan}
            isRendering={state.isRendering}
            onStartRender={handleStartRender}
            onCancelRender={handleCancelRender}
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
