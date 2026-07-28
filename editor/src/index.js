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

import React from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import Editor from './Editor/Editor';
import * as serviceWorker from './serviceWorker';
import initializeDefaultFileHandlers from './files/filehandler';
import installTauriFileHandlers from './files/tauri-filehandler';

// Creates file handlers in the window.
initializeDefaultFileHandlers();
// Then override saving with a native dialog when running as the desktop app. See
// tauri-filehandler.js for why this comes after rather than before.
installTauriFileHandlers();

// React 18+ root API. Deliberately NOT wrapped in <React.StrictMode>: the editor mounts
// paper.js and the Wick engine imperatively from componentDidMount (Canvas.jsx:52,
// Timeline.jsx:54), and StrictMode's double-invoke would build two of each against one
// canvas. Revisit once those mounts are idempotent.
createRoot(document.getElementById('root')).render(<Editor />);

// If you want your app to work offline and load faster, you can change
// unregister() to register() below. Note this comes with some pitfalls.
// Learn more about service workers: http://bit.ly/CRA-PWA
serviceWorker.unregister();
