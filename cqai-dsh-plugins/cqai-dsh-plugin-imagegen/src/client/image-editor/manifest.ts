/**
 * Adapted from Dogwind221/img2img-studio, MIT License.
 * Copyright (c) 2026 img2img-studio contributors.
 * Source: plugins/dsh-img2img-config/src/client/manifest.ts at ff2b2bb.
 */
import type { SizeMode } from './raster.ts'

/** Files produced by one editor session; the base never contains marker pins. */
export interface ExportedFiles {
  edited: string
  marked?: string
  /** White = edit; black = retain. The workflow converts API mask conventions. */
  mask?: string
}

/** Portable facts passed from the local editor to the generation workflow. */
export interface EditManifest {
  version: 1
  createdAt: string
  source: { name: string; width: number; height: number }
  size: { width: number; height: number; mode: SizeMode; changed: boolean }
  bgRemove: { requested: boolean; localPreview: boolean; tolerance: number }
  erase: { strokes: number; prompt: string }
  markers: Array<{ id: number; x: number; y: number; text: string }>
  files: ExportedFiles
}
