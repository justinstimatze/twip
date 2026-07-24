/*
 * Copyright 2020 WICKLETS LLC
 *
 * This file is part of Wick Editor.
 *
 * Wick Editor is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * Wick Editor is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with Wick Editor.  If not, see <https://www.gnu.org/licenses/>.
 */

/**
 * Whether the primary pointer cannot hover — a touchscreen, in practice.
 *
 * Replaces `react-device-detect`'s `isMobile`, which sniffs the user-agent and so
 * answers the wrong question: a touchscreen laptop reports desktop, and a desktop-class
 * tablet browser reports mobile. `(hover: none)` asks the capability directly, which is
 * what a hover-only affordance like a tooltip actually depends on.
 *
 * Evaluated per call rather than cached — a device can gain or lose a pointer (a tablet
 * with a keyboard case attached), and the call is cheap.
 *
 * @returns {boolean} true when the primary pointer has no hover state.
 */
export function pointerCannotHover () {
  return typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia('(hover: none)').matches;
}
