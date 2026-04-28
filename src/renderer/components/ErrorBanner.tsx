import React from 'react';
import { AppError } from '../utils/errorHandler';
import './ErrorBanner.css';

interface ErrorBannerProps {
  error: AppError | null;
  onDismiss: () => void;
}

export default function ErrorBanner({ error, onDismiss }: ErrorBannerProps) {
  if (!error) return null;

  return (
    <div className="error-banner" role="alert">
      <div className="error-banner-content">
        <div className="error-banner-header">
          <h3 className="error-banner-title">⚠️ {error.title}</h3>
          <button className="error-banner-close" onClick={onDismiss} aria-label="Dismiss error">
            ✕
          </button>
        </div>

        <p className="error-banner-message">{error.message}</p>

        {error.recoverySteps && error.recoverySteps.length > 0 && (
          <div className="error-banner-recovery">
            <p className="recovery-label">Try these steps:</p>
            <ul className="recovery-steps">
              {error.recoverySteps.map((step, idx) => (
                <li key={idx}>{step}</li>
              ))}
            </ul>
          </div>
        )}

        {error.details && (
          <details className="error-banner-details">
            <summary>Technical Details</summary>
            <pre>{error.details}</pre>
          </details>
        )}
      </div>
    </div>
  );
}
