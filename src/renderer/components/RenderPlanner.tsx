/**
 * Render planner component - shows render jobs and plan details
 */

import React, { useState } from 'react';
import { RenderPlan } from '../../core/models/types';
import './RenderPlanner.css';

interface RenderPlannerProps {
  plan: RenderPlan;
  isRendering: boolean;
  onStartRender: () => void;
  onCancelRender: () => void;
  onReset: () => void;
}

export default function RenderPlanner({
  plan,
  isRendering,
  onStartRender,
  onCancelRender,
  onReset,
}: RenderPlannerProps) {
  const [expandedJobId, setExpandedJobId] = useState<string | null>(null);

  const handleViewFFmpegCommand = async (jobId: string) => {
    try {
      const result = await window.versionBotAPI.getFFmpegCommand(jobId);
      if (result.success && result.data) {
        alert(`FFmpeg Command:\n\n${result.data.fullCommand}`);
      } else {
        alert(`Error: ${result.error}`);
      }
    } catch (error) {
      console.error('Error getting FFmpeg command:', error);
      alert('Failed to get FFmpeg command');
    }
  };

  const handleOpenOutputDir = async () => {
    try {
      await window.versionBotAPI.openDirectory(plan.outputDirTemplate);
    } catch (error) {
      console.error('Error opening directory:', error);
    }
  };

  return (
    <div className="render-planner">
      <button className="btn btn-secondary" onClick={onReset}>
        ← Start Over
      </button>

      <div className="planner-content">
        <h2>Render Plan</h2>

        <div className="planner-actions">
          <button
            className="btn btn-primary"
            onClick={onStartRender}
            disabled={isRendering || plan.jobs.length === 0}
          >
            {isRendering ? 'Rendering...' : 'Start Render'}
          </button>
          <button
            className="btn btn-secondary"
            onClick={onCancelRender}
            disabled={!isRendering}
          >
            Cancel Render
          </button>
        </div>

        <div className="plan-summary">
          <div className="summary-item">
            <span className="label">Output Directory:</span>
            <span className="value">{plan.outputDirTemplate}</span>
            <button className="btn btn-small" onClick={handleOpenOutputDir}>
              Open
            </button>
          </div>

          <div className="summary-item">
            <span className="label">Jobs:</span>
            <span className="value">{plan.jobs.length}</span>
          </div>

          <div className="summary-item">
            <span className="label">Status:</span>
            <span className={`status status-${plan.status}`}>
              {plan.status.toUpperCase()}
            </span>
          </div>

          <div className="summary-item">
            <span className="label">Progress:</span>
            <div className="progress-bar">
              <div className="progress-fill" style={{
                width: `${plan.progress}%`
              }}></div>
            </div>
            <span className="value">{plan.progress}%</span>
          </div>
        </div>

        <div className="jobs-section">
          <h3>Render Jobs</h3>

          <div className="jobs-list">
            {plan.jobs.map((job) => (
              <div
                key={job.id}
                className={`job-item status-${job.status}`}
              >
                <div
                  className="job-header"
                  onClick={() =>
                    setExpandedJobId(
                      expandedJobId === job.id ? null : job.id
                    )
                  }
                >
                  <div className="job-title">
                    <span className="preset-name">
                      {job.preset.name}
                    </span>
                    <span className="job-resolution">
                      {job.preset.width}x{job.preset.height}
                    </span>
                  </div>
                  <div className="job-status">
                    <span className="status-badge">
                      {job.status.toUpperCase()}
                    </span>
                    <span className="progress">{job.progress}%</span>
                  </div>
                </div>

                {expandedJobId === job.id && (
                  <div className="job-details">
                    <div className="detail-row">
                      <span className="label">Codec:</span>
                      <span className="value">
                        {job.preset.videoCodec} @ {job.adjustedBitrate || job.preset.bitrate}kbps
                      </span>
                    </div>
                    {job.maxFileSizeMB > 0 && (
                      <div className="detail-row">
                        <span className="label">Max Filesize:</span>
                        <span className="value">{job.maxFileSizeMB} MB</span>
                      </div>
                    )}
                    {(job.preset.introSlate?.enabled ||
                      job.preset.outroSlate?.enabled ||
                      job.preset.overlay?.enabled) && (
                      <div className="detail-row">
                        <span className="label">Assets:</span>
                        <span className="value">
                          {job.preset.introSlate?.enabled ? 'prepend ' : ''}
                          {job.preset.outroSlate?.enabled ? 'append ' : ''}
                          {job.preset.overlay?.enabled ? 'overlay' : ''}
                        </span>
                      </div>
                    )}
                    <div className="detail-row">
                      <span className="label">Output:</span>
                      <span className="value">{job.outputPath}</span>
                    </div>
                    {job.error && (
                      <div className="detail-row error">
                        <span className="label">Error:</span>
                        <span className="value">{job.error}</span>
                      </div>
                    )}
                    <button
                      className="btn btn-small"
                      onClick={() => handleViewFFmpegCommand(job.id)}
                    >
                      View FFmpeg Command
                    </button>
                  </div>
                )}

                <div className="job-progress">
                  <div className="progress-bar">
                    <div
                      className="progress-fill"
                      style={{ width: `${job.progress}%` }}
                    ></div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="plan-info">
          <h3>Plan Information</h3>
          <div className="info-box">
            <p>
              <strong>Execution:</strong> Use Start Render to process all jobs in sequence.
            </p>
            <p>
              You can cancel an active run and inspect FFmpeg command details for each job.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
