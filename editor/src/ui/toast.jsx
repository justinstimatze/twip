/*
 * Toasts on sonner.
 *
 * Replaces react-toastify 5 (2019). The old one carried its own stylesheet plus a block
 * of overrides in _editor.scss — .Toastify__toast for the font, then four pairs of
 * `.<type>-toast-background` / `.<type>-toast-body` classes that every caller threaded
 * through an options object. The four colours survive as tokens; the plumbing does not.
 *
 * The old colours all clear WCAG AA as they stand — 12.29:1 for info, 7.29:1 error,
 * 16.21:1 warning, 14.21:1 success — so unlike the Phase 1a token pass, nothing here
 * needed correcting. They moved to index.css unchanged.
 */
import React from 'react';
import { Toaster as SonnerToaster, toast as sonnerToast } from 'sonner';

const TYPES = ['info', 'success', 'warning', 'error'];

const SURFACE = {
  info: 'bg-toast-info text-white',
  success: 'bg-toast-success text-black',
  warning: 'bg-toast-warning text-black',
  error: 'bg-toast-error text-white',
};

const DEFAULT_DURATION = 3000;

function optionsFor (type, options = {}) {
  return {
    // react-toastify spelled "never close" as `autoClose: false`, and eight call sites in
    // EditorCore pass exactly that for long-running exports.
    duration: options.autoClose === false ? Infinity : (options.autoClose ?? DEFAULT_DURATION),
    // `unstyled` on the Toaster drops sonner's box as well as its palette, so the box is
    // described here: the old .Toastify__toast rule was Nunito Sans / 800 / 24px / 3px.
    className: `${SURFACE[type]} flex w-full items-center gap-3 rounded-sm px-4 py-3 shadow-lg `
      + 'font-ui text-2xl font-extrabold',
  };
}

/**
 * @param {'info'|'success'|'warning'|'error'} type
 * @returns the toast id, which `update` takes.
 */
export function notify (message, type = 'info', options) {
  return sonnerToast(message, optionsFor(TYPES.includes(type) ? type : 'info', options));
}

/**
 * Re-issuing a toast with an existing id replaces it in place, which is how sonner does
 * what react-toastify called toast.update.
 */
export function updateNotification (id, { text, type, ...options } = {}) {
  return sonnerToast(text, { id, ...optionsFor(TYPES.includes(type) ? type : 'info', options) });
}

export function Toaster () {
  return (
    <SonnerToaster
      position="top-right"
      closeButton
      // sonner's own palette would fight the four colours above.
      toastOptions={{ unstyled: true, classNames: { closeButton: 'text-current' } }}
    />
  );
}
