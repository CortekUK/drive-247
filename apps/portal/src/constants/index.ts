/**
 * Constants Index
 *
 * Central export point for all application constants.
 * Import from this file to access any constant in the application.
 *
 * @example
 * ```typescript
 * import { PAGINATION_DEFAULTS, PNL_CATEGORIES } from '@/constants';
 * ```
 */

// ============================================
// SHARED CONSTANTS
// ============================================
// Shared constants (defaults, general constants, PNL, CMS defaults)
export * from './shared';

// ============================================
// CMS / WEBSITE CONTENT CONSTANTS
// ============================================
// Website Content (CMS) constants - actually used in cms/* pages
export * from './website-content';
