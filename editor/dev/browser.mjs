/*
 * One place that decides which Chrome the dev scripts drive.
 *
 * Locally that is the system Chrome, so nobody pays a ~150MB browser download to run
 * smoke.mjs, and the page renders in the same engine the editor is developed against. CI has
 * no system Chrome it can rely on, so it installs Playwright's own chromium and sets
 * PLAYWRIGHT_CHANNEL='' to select it — empty string, not unset, since unset means 'chrome'.
 */
import { chromium } from 'playwright';

export function launch (options = {}) {
  const channel = process.env.PLAYWRIGHT_CHANNEL ?? 'chrome';
  return chromium.launch({ ...options, channel: channel || undefined });
}

export const URL_ = process.env.SMOKE_URL ?? 'http://localhost:3000';
