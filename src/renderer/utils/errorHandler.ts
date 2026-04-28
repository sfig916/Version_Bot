/**
 * User-friendly error handling for the renderer
 */

export interface AppError {
  code: 'MISSING_FILE' | 'INVALID_VIDEO' | 'MISSING_ASSET' | 'RENDER_FAILED' | 'UNKNOWN';
  title: string;
  message: string;
  details?: string;
  recoverySteps?: string[];
}

export const errorMessages: Record<string, { title: string; recovery: string[] }> = {
  MISSING_FILE: {
    title: 'Video File Not Found',
    recovery: [
      'Check that the file still exists in the original location',
      'Try re-selecting the video file',
      'Verify the file path is accessible',
    ],
  },
  INVALID_VIDEO: {
    title: 'Invalid or Unsupported Video',
    recovery: [
      'Verify the file is a valid video (mp4, mov, mkv, webm, etc.)',
      'Try opening the video in another player to confirm it works',
      'Check the file is not corrupted',
    ],
  },
  MISSING_ASSET: {
    title: 'Asset File Missing',
    recovery: [
      'Go to "Manage Assets" and verify your prepend/append/overlay files exist',
      'Remove and re-add any missing assets',
      'Ensure all asset files are accessible to the app',
    ],
  },
  RENDER_FAILED: {
    title: 'Rendering Failed',
    recovery: [
      'Check that you have enough disk space',
      'Verify the output directory is writable',
      'Try with a simpler preset (fewer assets) first',
      'Check the logs for more details',
    ],
  },
  UNKNOWN: {
    title: 'An Error Occurred',
    recovery: [
      'Try the operation again',
      'Restart the application',
      'Check the logs for more information',
    ],
  },
};

export function parseError(error: unknown): AppError {
  let message = error instanceof Error ? error.message : String(error);
  const stack = error instanceof Error ? error.stack : undefined;
  
  // If message is empty, provide a fallback
  if (!message || message.trim() === '') {
    message = 'An unknown error occurred';
  }

  // Try to match error messages to known types
  if (message.includes('ENOENT') || message.includes('not found') || message.includes('No such file')) {
    return {
      code: 'MISSING_FILE',
      title: errorMessages.MISSING_FILE.title,
      message: message,
      details: stack,
      recoverySteps: errorMessages.MISSING_FILE.recovery,
    };
  }

  if (message.includes('Unable to resolve') && message.includes('asset')) {
    return {
      code: 'MISSING_ASSET',
      title: errorMessages.MISSING_ASSET.title,
      message: message,
      details: stack,
      recoverySteps: errorMessages.MISSING_ASSET.recovery,
    };
  }

  if (message.includes('Invalid') || message.includes('probe') || message.includes('Stream specifier')) {
    return {
      code: 'INVALID_VIDEO',
      title: errorMessages.INVALID_VIDEO.title,
      message: message,
      details: stack,
      recoverySteps: errorMessages.INVALID_VIDEO.recovery,
    };
  }

  if (message.includes('Rendering failed') || message.includes('exit code')) {
    return {
      code: 'RENDER_FAILED',
      title: errorMessages.RENDER_FAILED.title,
      message: message,
      details: stack,
      recoverySteps: errorMessages.RENDER_FAILED.recovery,
    };
  }

  return {
    code: 'UNKNOWN',
    title: errorMessages.UNKNOWN.title,
    message: message,
    details: stack,
    recoverySteps: errorMessages.UNKNOWN.recovery,
  };
}
