/**
 * Bundle loader for preset and asset updates
 * Manages fetching and merging preset/asset bundles from remote sources
 */

import { z } from 'zod';

// Schema for bundled presets/assets
export const presetBundleSchema = z.object({
  version: z.string(),
  presets: z.array(
    z.object({
      id: z.string().min(1),
      name: z.string().min(1),
      resolutionWidth: z.number().positive(),
      resolutionHeight: z.number().positive(),
      aspectRatio: z.string(),
      slatesEnabled: z.boolean(),
      slateConfig: z
        .object({
          prepend: z.array(z.string()).optional(),
          append: z.array(z.string()).optional(),
        })
        .optional(),
      overlaysEnabled: z.boolean(),
      overlayConfig: z
        .array(
          z.object({
            id: z.string(),
            nicknames: z.array(z.string()).optional(),
          })
        )
        .optional(),
      filenamePattern: z.string().optional(),
    })
  ),
  assetLibraries: z
    .object({
      'version-bot-prepend-library': z
        .array(
          z.object({
            id: z.string().min(1),
            name: z.string().min(1),
            key: z.string().min(1),
            source: z.enum(['local', 'mediasilo']),
            mediaSiloId: z.string().min(1).optional(),
            path: z.string().min(1).optional(),
            duration: z.coerce.number().positive(),
          })
        )
        .optional(),
      'version-bot-append-library': z
        .array(
          z.object({
            id: z.string().min(1),
            name: z.string().min(1),
            key: z.string().min(1),
            source: z.enum(['local', 'mediasilo']),
            mediaSiloId: z.string().min(1).optional(),
            path: z.string().min(1).optional(),
            duration: z.coerce.number().positive(),
          })
        )
        .optional(),
      'version-bot-overlay-library': z
        .array(
          z.object({
            id: z.string().min(1),
            name: z.string().min(1),
            key: z.string().min(1),
            source: z.enum(['local', 'mediasilo']),
            mediaSiloId: z.string().min(1).optional(),
            path: z.string().min(1).optional(),
          })
        )
        .optional(),
    })
    .optional(),
  releaseNotes: z.string().optional(),
  releasedAt: z.string().datetime().optional(),
});

export type PresetBundle = z.infer<typeof presetBundleSchema>;

export interface BundleUpdateResult {
  success: boolean;
  bundleVersion: string;
  presetsAdded: number;
  presetsUpdated: number;
  assetsAdded: number;
  assetsUpdated: number;
  message: string;
  releaseNotes?: string;
}

/**
 * Fetch and validate a preset bundle from a remote URL
 */
export async function fetchPresetBundle(bundleUrl: string): Promise<PresetBundle> {
  const response = await fetch(bundleUrl);
  if (!response.ok) {
    throw new Error(`Failed to fetch preset bundle: ${response.statusText}`);
  }

  const json = await response.json();
  return presetBundleSchema.parse(json);
}

/**
 * Merge a remote bundle into local presets/assets
 * Preserves existing user data, adds new presets/assets, updates only unmodified entries
 */
export function mergeBundle(
  existingPresets: Record<string, any>,
  existingAssets: Record<string, any>,
  bundle: PresetBundle
): BundleUpdateResult {
  let presetsAdded = 0;
  let presetsUpdated = 0;
  let assetsAdded = 0;
  let assetsUpdated = 0;

  const updatedPresets = { ...existingPresets };
  const updatedAssets = { ...existingAssets };

  // Merge presets
  for (const bundledPreset of bundle.presets) {
    const existing = updatedPresets[bundledPreset.id];
    if (!existing) {
      // New preset - always add
      updatedPresets[bundledPreset.id] = bundledPreset;
      presetsAdded++;
    } else {
      // Preset exists - only update if it looks like a default (not heavily customized)
      // Simple heuristic: if the preset has default naming pattern or was created by us
      if (existing.name === bundledPreset.name || !existing._userModified) {
        updatedPresets[bundledPreset.id] = { ...bundledPreset, _userModified: false };
        presetsUpdated++;
      }
    }
  }

  // Merge asset libraries (only add, never remove)
  if (bundle.assetLibraries) {
    for (const [libraryName, bundledAssets] of Object.entries(bundle.assetLibraries)) {
      if (Array.isArray(bundledAssets)) {
        const existingLibrary = updatedAssets[libraryName] || [];
        const assetIds = new Set(existingLibrary.map((a: any) => a.id));

        for (const bundledAsset of bundledAssets) {
          if (!assetIds.has(bundledAsset.id)) {
            existingLibrary.push(bundledAsset);
            assetsAdded++;
          } else {
            // Asset exists - only update MediaSilo references if not already set
            const existingAsset = existingLibrary.find((a: any) => a.id === bundledAsset.id);
            if (
              bundledAsset.source === 'mediasilo' &&
              bundledAsset.mediaSiloId &&
              !existingAsset.mediaSiloId
            ) {
              existingAsset.mediaSiloId = bundledAsset.mediaSiloId;
              assetsUpdated++;
            }
          }
        }

        updatedAssets[libraryName] = existingLibrary;
      }
    }
  }

  return {
    success: true,
    bundleVersion: bundle.version as string,
    presetsAdded,
    presetsUpdated,
    assetsAdded,
    assetsUpdated,
    message: `Updated to bundle v${bundle.version}: ${presetsAdded} presets added, ${presetsUpdated} updated, ${assetsAdded} assets added`,
    releaseNotes: bundle.releaseNotes as string | undefined,
  };
}
