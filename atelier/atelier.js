// ============================================================
// Atelier — Main Application
// Fur pelt placement tool
// ============================================================

import { PatronEditor } from './modules/patron-editor.js';
import { PeltManager } from './modules/pelt-manager.js';
import { PlacementEngine } from './modules/placement-engine.js';
import { Stats } from './modules/stats.js';
import { ContourDetector } from './modules/contour-detector.js';

// ---- Constants ----
const BASE_PX_PER_CM = 30;
const CUSTOM_PROPS = [
    '_isGrid', '_isBackground', '_isPatron', '_isStrip',
    '_patronId', '_patronName', '_patronVertices', '_patronSegments',
    '_stripData', 'excludeFromExport',
    '_isAnchor', '_isEndpointAnchor', '_isPathSegment', '_isDimensionLabel',
    '_contourId', '_endpointIndex',
    // Edit mode (needed for orphan detection after save/load)
    '_isEditVertex', '_isEditSegment', '_isEditCP',
    '_patronIndex', '_vertexIndex', '_segmentIndex',
    '_isDetectionPreview',
];
const MIN_ZOOM = 0.1;
const MAX_ZOOM = 10;
const GRID_COLOR_MAJOR = '#d0d0d0';
const GRID_COLOR_MINOR = '#e8e8e8';
const CANVAS_BG = '#f5f5f5';

// ---- App State ----
const state = {
	canvas: null,
	pxPerCm: BASE_PX_PER_CM,
	zoom: 1,
	activeTool: 'select',
	gridVisible: true,

	isPanning: false,
	panStart: null,
	spaceHeld: false,
	history: [],
	historyIndex: -1,
	maxHistory: 50,
	projectName: 'Nouveau projet',
	backgroundImage: null,
};

// ---- Expose state globally for modules ----
window.atelierState = state;

// ============================================================
// Canvas Initialization
// ============================================================
function initCanvas() {
	const container = document.getElementById('canvas-container');
	const canvasEl = document.getElementById('main-canvas');

	// Size canvas to container
	const rect = container.getBoundingClientRect();
	canvasEl.width = rect.width;
	canvasEl.height = rect.height;

	state.canvas = new fabric.Canvas('main-canvas', {
		backgroundColor: CANVAS_BG,
		selection: true,
		preserveObjectStacking: true,
		stopContextMenu: true,
		fireRightClick: true,
		fireMiddleClick: true,
	});

	state.canvas.setWidth(rect.width);
	state.canvas.setHeight(rect.height);

	// Set initial viewport to center the canvas
	// Put origin roughly in the center-left area so there's room to work
	const vpt = state.canvas.viewportTransform;
	vpt[4] = rect.width * 0.15; // translateX
	vpt[5] = rect.height * 0.1; // translateY

	// Draw grid
	drawGrid();

	// Resize handler
	window.addEventListener('resize', handleResize);

	// Canvas events
	state.canvas.on('mouse:wheel', handleMouseWheel);
	state.canvas.on('mouse:down', handleMouseDown);
	state.canvas.on('mouse:move', handleMouseMove);
	state.canvas.on('mouse:up', handleMouseUp);
	state.canvas.on('mouse:dblclick', handleMouseDblClick);
	state.canvas.on('selection:created', handleSelectionChange);
	state.canvas.on('selection:updated', handleSelectionChange);
	state.canvas.on('selection:cleared', handleSelectionCleared);
	state.canvas.on('object:modified', handleObjectModified);
	state.canvas.on('object:moving', handleObjectMoving);
	state.canvas.on('object:scaling', handleObjectTransforming);
	state.canvas.on('object:rotating', handleObjectTransforming);

	// Set initial cursor
	updateCanvasCursor();

	return state.canvas;
}

// ============================================================
// Grid Drawing
// ============================================================
function drawGrid() {
	// Remove existing grid objects
	const gridObjects = state.canvas.getObjects().filter(o => o._isGrid);
	gridObjects.forEach(o => state.canvas.remove(o));

	if (!state.gridVisible) {
		state.canvas.renderAll();
		return;
	}

	const vpt = state.canvas.viewportTransform;
	const zoom = state.canvas.getZoom();
	const effectivePxPerCm = state.pxPerCm * zoom;

	// Calculate visible area in canvas coordinates
	const canvasWidth = state.canvas.getWidth();
	const canvasHeight = state.canvas.getHeight();

	// Convert screen bounds to canvas coordinates
	const topLeft = fabric.util.transformPoint(
		new fabric.Point(0, 0),
		fabric.util.invertTransform(vpt)
	);
	const bottomRight = fabric.util.transformPoint(
		new fabric.Point(canvasWidth, canvasHeight),
		fabric.util.invertTransform(vpt)
	);

	// Determine grid spacing based on zoom
	let gridCm = 1; // 1 cm minor grid
	if (effectivePxPerCm < 8) gridCm = 10;
	else if (effectivePxPerCm < 15) gridCm = 5;
	else if (effectivePxPerCm < 30) gridCm = 2;

	const majorEvery = gridCm >= 5 ? 2 : 5; // Major line every 5cm or 10cm
	const gridPx = gridCm * state.pxPerCm;

	const startX = Math.floor(topLeft.x / gridPx) * gridPx;
	const endX = Math.ceil(bottomRight.x / gridPx) * gridPx;
	const startY = Math.floor(topLeft.y / gridPx) * gridPx;
	const endY = Math.ceil(bottomRight.y / gridPx) * gridPx;

	const gridLines = [];

	// Vertical lines
	for (let x = startX; x <= endX; x += gridPx) {
		const cmVal = x / state.pxPerCm;
		const isMajor = Math.abs(cmVal % (gridCm * majorEvery)) < 0.01;
		gridLines.push(new fabric.Line([x, startY, x, endY], {
			stroke: isMajor ? GRID_COLOR_MAJOR : GRID_COLOR_MINOR,
			strokeWidth: isMajor ? 0.8 / zoom : 0.4 / zoom,
			selectable: false,
			evented: false,
			_isGrid: true,
			excludeFromExport: true,
		}));
	}

	// Horizontal lines
	for (let y = startY; y <= endY; y += gridPx) {
		const cmVal = y / state.pxPerCm;
		const isMajor = Math.abs(cmVal % (gridCm * majorEvery)) < 0.01;
		gridLines.push(new fabric.Line([startX, y, endX, y], {
			stroke: isMajor ? GRID_COLOR_MAJOR : GRID_COLOR_MINOR,
			strokeWidth: isMajor ? 0.8 / zoom : 0.4 / zoom,
			selectable: false,
			evented: false,
			_isGrid: true,
			excludeFromExport: true,
		}));
	}

	// Add all grid lines at the bottom
	gridLines.forEach(line => {
		state.canvas.add(line);
		state.canvas.sendToBack(line);
	});

	// Make sure background image stays behind grid if it exists
	if (state.backgroundImage) {
		state.canvas.sendToBack(state.backgroundImage);
	}

	state.canvas.renderAll();
}

// ============================================================
// Rulers
// ============================================================
function drawRulers() {
	const hRuler = document.getElementById('ruler-horizontal');
	const vRuler = document.getElementById('ruler-vertical');

	// Clear existing
	hRuler.innerHTML = '';
	vRuler.innerHTML = '';

	const vpt = state.canvas.viewportTransform;
	const zoom = state.canvas.getZoom();
	const effectivePxPerCm = state.pxPerCm * zoom;

	// Determine tick spacing
	let tickCm = 1;
	if (effectivePxPerCm < 8) tickCm = 10;
	else if (effectivePxPerCm < 15) tickCm = 5;
	else if (effectivePxPerCm < 30) tickCm = 2;

	const labelEvery = tickCm >= 5 ? 2 : 5;

	// Horizontal ruler
	const hWidth = hRuler.getBoundingClientRect().width;
	const offsetX = vpt[4];

	const hCanvas = document.createElement('canvas');
	hCanvas.width = hWidth;
	hCanvas.height = 24;
	hCanvas.style.display = 'block';
	const hCtx = hCanvas.getContext('2d');

	hCtx.fillStyle = '#f5f5f5';
	hCtx.fillRect(0, 0, hWidth, 24);

	const startCmH = Math.floor(-offsetX / (state.pxPerCm * zoom) / tickCm) * tickCm;
	const endCmH = Math.ceil((hWidth - offsetX) / (state.pxPerCm * zoom) / tickCm) * tickCm;

	for (let cm = startCmH; cm <= endCmH; cm += tickCm) {
		const screenX = cm * state.pxPerCm * zoom + offsetX;
		if (screenX < 0 || screenX > hWidth) continue;

		const isLabel = Math.abs(cm % (tickCm * labelEvery)) < 0.01;

		hCtx.beginPath();
		hCtx.moveTo(screenX, isLabel ? 8 : 16);
		hCtx.lineTo(screenX, 24);
		hCtx.strokeStyle = isLabel ? '#999' : '#ccc';
		hCtx.lineWidth = isLabel ? 1 : 0.5;
		hCtx.stroke();

		if (isLabel) {
			hCtx.fillStyle = '#666';
			hCtx.font = '9px Inter, sans-serif';
			hCtx.textAlign = 'center';
			hCtx.fillText(cm.toString(), screenX, 7);
		}
	}

	hRuler.appendChild(hCanvas);

	// Vertical ruler
	const vHeight = vRuler.getBoundingClientRect().height;
	const offsetY = vpt[5];

	const vCanvas = document.createElement('canvas');
	vCanvas.width = 24;
	vCanvas.height = vHeight;
	vCanvas.style.display = 'block';
	const vCtx = vCanvas.getContext('2d');

	vCtx.fillStyle = '#f5f5f5';
	vCtx.fillRect(0, 0, 24, vHeight);

	const startCmV = Math.floor(-offsetY / (state.pxPerCm * zoom) / tickCm) * tickCm;
	const endCmV = Math.ceil((vHeight - offsetY) / (state.pxPerCm * zoom) / tickCm) * tickCm;

	for (let cm = startCmV; cm <= endCmV; cm += tickCm) {
		const screenY = cm * state.pxPerCm * zoom + offsetY;
		if (screenY < 0 || screenY > vHeight) continue;

		const isLabel = Math.abs(cm % (tickCm * labelEvery)) < 0.01;

		vCtx.beginPath();
		vCtx.moveTo(isLabel ? 8 : 16, screenY);
		vCtx.lineTo(24, screenY);
		vCtx.strokeStyle = isLabel ? '#999' : '#ccc';
		vCtx.lineWidth = isLabel ? 1 : 0.5;
		vCtx.stroke();

		if (isLabel) {
			vCtx.save();
			vCtx.fillStyle = '#666';
			vCtx.font = '9px Inter, sans-serif';
			vCtx.textAlign = 'center';
			vCtx.translate(7, screenY);
			vCtx.rotate(-Math.PI / 2);
			vCtx.fillText(cm.toString(), 0, 0);
			vCtx.restore();
		}
	}

	vRuler.appendChild(vCanvas);
}

// ============================================================
// Event Handlers
// ============================================================
function handleResize() {
	const container = document.getElementById('canvas-container');
	const rect = container.getBoundingClientRect();
	state.canvas.setWidth(rect.width);
	state.canvas.setHeight(rect.height);
	drawGrid();
	drawRulers();
	state.canvas.renderAll();
}

function handleMouseWheel(opt) {
	const e = opt.e;
	e.preventDefault();
	e.stopPropagation();

	const delta = e.deltaY;
	let newZoom = state.canvas.getZoom() * (delta > 0 ? 0.92 : 1.08);
	newZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, newZoom));

	state.canvas.zoomToPoint(new fabric.Point(e.offsetX, e.offsetY), newZoom);
	state.zoom = newZoom;

	drawGrid();
	drawRulers();
	updateZoomDisplay();
}

function handleMouseDown(opt) {
	const e = opt.e;

	// Middle click or space+click = pan
	if (e.button === 1 || state.spaceHeld || state.activeTool === 'pan') {
		state.isPanning = true;
		state.panStart = { x: e.clientX, y: e.clientY };
		state.canvas.selection = false;
		state.canvas.setCursor('grabbing');
		return;
	}

	// Right click = context menu
	if (e.button === 2 || opt.button === 3) {
		handleContextMenu(opt);
		return;
	}

	// Delegate to active tool module
	if (window.atelierModules?.patronEditor) {
		window.atelierModules.patronEditor.handleMouseDown(opt);
	}
}

function handleMouseMove(opt) {
	const e = opt.e;

	// Update cursor position display
	const pointer = state.canvas.getPointer(e);
	const cmX = (pointer.x / state.pxPerCm).toFixed(1);
	const cmY = (pointer.y / state.pxPerCm).toFixed(1);
	document.getElementById('status-cursor').textContent = `X: ${cmX} cm   Y: ${cmY} cm`;

	// Panning
	if (state.isPanning) {
		const vpt = state.canvas.viewportTransform;
		vpt[4] += e.clientX - state.panStart.x;
		vpt[5] += e.clientY - state.panStart.y;
		state.panStart = { x: e.clientX, y: e.clientY };
		state.canvas.requestRenderAll();
		drawGrid();
		drawRulers();
		return;
	}

	// Delegate to active tool module
	if (window.atelierModules?.patronEditor) {
		window.atelierModules.patronEditor.handleMouseMove(opt);
	}
}

function handleMouseUp(opt) {
	if (state.isPanning) {
		state.isPanning = false;
		state.canvas.selection = (state.activeTool === 'select');
		updateCanvasCursor();
		return;
	}

	const pe = window.atelierModules?.patronEditor;
	if (pe) {
		// Edit mode: check if a vertex was dropped on another patron's vertex (drag-snap merge)
		if (pe.editMode.active) {
			pe.handleEditModeDropMerge();
		}
		// Open contour: check if an endpoint was dropped on another endpoint (drag-snap merge)
		pe.handleEndpointDropMerge();

		// Delegate to active tool module
		pe.handleMouseUp(opt);
	}
}

function handleSelectionChange(opt) {
	updatePropertiesPanel(opt.selected);

	// Highlight selected edit segment (orange), reset previous
	_resetSegmentHighlight();
	if (opt.selected && opt.selected.length === 1 && opt.selected[0]._isEditSegment) {
		const seg = opt.selected[0];
		seg.set({ stroke: '#e67e22' });
		state._highlightedSegment = seg;
		state.canvas.renderAll();
	}

	// Show dimension labels on selected patron
	const pe = window.atelierModules?.patronEditor;
	if (pe && !pe.editMode.active) {
		pe.clearSelectionLabels();
		if (opt.selected && opt.selected.length === 1 && opt.selected[0]._isPatron) {
			pe.showSelectionLabels(opt.selected[0]);
		}
	}

	// Delegate to placement engine
	if (window.atelierModules?.placementEngine) {
		window.atelierModules.placementEngine.handleSelectionChange(opt);
	}
}

function _resetSegmentHighlight() {
	if (state._highlightedSegment) {
		state._highlightedSegment.set({ stroke: '#4a90d9' });
		state._highlightedSegment = null;
	}
}

function handleSelectionCleared() {
	clearPropertiesPanel();

	// Reset segment highlight
	_resetSegmentHighlight();

	// Clear dimension labels (but don't exit edit mode — that's done via Escape or double-click)
	const pe = window.atelierModules?.patronEditor;
	if (pe && !pe.editMode.active) {
		pe.clearSelectionLabels();
	}
}

function handleObjectModified(opt) {
	saveHistoryState();
	updateStats();

	// Refresh dimension labels after any transform (move/scale/rotate)
	if (opt.target && opt.target._isPatron) {
		const pe = window.atelierModules?.patronEditor;
		if (pe && !pe.editMode.active && pe._selectionLabels.length > 0) {
			pe.showSelectionLabels(opt.target);
		}
	}

	if (window.atelierModules?.placementEngine) {
		window.atelierModules.placementEngine.handleObjectModified(opt);
	}
}

function handleObjectMoving(opt) {
	// Edit mode: handle vertex/CP dragging
	if (opt.target && (opt.target._isEditVertex || opt.target._isEditCP)) {
		if (window.atelierModules?.patronEditor) {
			window.atelierModules.patronEditor.handleEditModeDrag(opt.target);
		}
		return;
	}

	// Open contour: handle endpoint dragging (move + snap detection)
	if (opt.target && opt.target._isEndpointAnchor) {
		if (window.atelierModules?.patronEditor) {
			window.atelierModules.patronEditor.handleEndpointDrag(opt.target);
		}
		return;
	}

	// Update dimension labels when dragging a patron
	if (opt.target && opt.target._isPatron) {
		const pe = window.atelierModules?.patronEditor;
		if (pe && !pe.editMode.active && pe._selectionLabels.length > 0) {
			pe.showSelectionLabels(opt.target);
		}
	}

	if (window.atelierModules?.placementEngine) {
		window.atelierModules.placementEngine.handleObjectMoving(opt);
	}

	updateStats();
}

function handleObjectTransforming(opt) {
	// Update dimension labels during scaling/rotation of a patron
	if (opt.target && opt.target._isPatron) {
		const pe = window.atelierModules?.patronEditor;
		if (pe && !pe.editMode.active && pe._selectionLabels.length > 0) {
			pe.showSelectionLabels(opt.target);
		}
	}

	updateStats();
}

function handleMouseDblClick(opt) {
	const target = opt.target;
	const pe = window.atelierModules?.patronEditor;
	if (!pe) return;

	if (target && target._isPatron) {
		// Add this patron to the edit session (enterEditMode is additive)
		pe.clearSelectionLabels();
		pe.enterEditMode(target);
	} else if (pe.editMode.active) {
		// Double-click on empty space or non-patron/non-edit object → exit edit mode
		if (!target || (!target._isEditVertex && !target._isEditCP && !target._isEditSegment)) {
			pe.exitEditMode();
		}
	}
}

// ============================================================
// Context Menu
// ============================================================
function handleContextMenu(opt) {
	const e = opt.e;
	e.preventDefault();

	// Remove existing context menu
	removeContextMenu();

	const target = state.canvas.findTarget(opt.e);
	const menu = document.createElement('div');
	menu.className = 'context-menu';
	menu.id = 'context-menu';

	if (target && target._isEditVertex) {
		// Edit mode: right-click on a vertex
		menu.innerHTML = `<div class="context-menu__item context-menu__item--danger" data-action="delete-vertex" data-patron-index="${target._patronIndex}" data-vertex-index="${target._vertexIndex}">Supprimer le point <span class="context-menu__shortcut">Suppr</span></div>`;
	} else if (target && target._isEditSegment) {
		// Edit mode: right-click on a segment
		menu.innerHTML = `<div class="context-menu__item context-menu__item--danger" data-action="delete-segment" data-patron-index="${target._patronIndex}" data-segment-index="${target._segmentIndex}">Supprimer le segment <span class="context-menu__shortcut">Suppr</span></div>`;
	} else if (target && !target._isGrid && !target._isEditCP) {
		menu.innerHTML = `
			<div class="context-menu__item" data-action="duplicate">Dupliquer <span class="context-menu__shortcut">Ctrl+D</span></div>
			<div class="context-menu__item" data-action="bring-front">Mettre devant</div>
			<div class="context-menu__item" data-action="send-back">Mettre derrière</div>
			<div class="context-menu__divider"></div>
			<div class="context-menu__item context-menu__item--danger" data-action="delete">Supprimer <span class="context-menu__shortcut">Suppr</span></div>
		`;
	} else {
		menu.innerHTML = `
			<div class="context-menu__item" data-action="paste">Coller</div>
			<div class="context-menu__item" data-action="select-all">Tout sélectionner <span class="context-menu__shortcut">Ctrl+A</span></div>
			<div class="context-menu__divider"></div>
			<div class="context-menu__item" data-action="zoom-fit">Ajuster à la vue <span class="context-menu__shortcut">0</span></div>
		`;
	}

	menu.style.left = e.clientX + 'px';
	menu.style.top = e.clientY + 'px';
	document.body.appendChild(menu);

	// Handle clicks
	menu.addEventListener('click', (ev) => {
		const item = ev.target.closest('[data-action]');
		if (!item) return;
		const action = item.dataset.action;
		if (action === 'delete-vertex') {
			const pIdx = parseInt(item.dataset.patronIndex, 10);
			const vIdx = parseInt(item.dataset.vertexIndex, 10);
			if (window.atelierModules?.patronEditor) {
				window.atelierModules.patronEditor.deleteEditVertex(pIdx, vIdx);
			}
		} else if (action === 'delete-segment') {
			const pIdx = parseInt(item.dataset.patronIndex, 10);
			const sIdx = parseInt(item.dataset.segmentIndex, 10);
			if (window.atelierModules?.patronEditor) {
				window.atelierModules.patronEditor.deleteEditSegment(pIdx, sIdx);
			}
		} else if (action) {
			handleContextAction(action, target);
		}
		removeContextMenu();
	});

	// Close on click outside
	setTimeout(() => {
		document.addEventListener('click', removeContextMenu, { once: true });
	}, 10);
}

function removeContextMenu() {
	const menu = document.getElementById('context-menu');
	if (menu) menu.remove();
}

function handleContextAction(action, target) {
	switch (action) {
		case 'duplicate':
			duplicateSelection();
			break;
		case 'delete':
			deleteSelection();
			break;
		case 'bring-front':
			if (target) { state.canvas.bringToFront(target); state.canvas.renderAll(); }
			break;
		case 'send-back':
			if (target) { state.canvas.sendToBack(target); state.canvas.renderAll(); }
			break;
		case 'select-all':
			selectAll();
			break;
		case 'zoom-fit':
			zoomToFit();
			break;
		case 'paste':
			// Paste is not yet implemented; silently ignore to avoid unhandled action
			break;
	}
}

// ============================================================
// Tool Management
// ============================================================
function setActiveTool(tool) {
	state.activeTool = tool;

	// Exit edit mode when switching away from select
	if (tool !== 'select') {
		const pe = window.atelierModules?.patronEditor;
		if (pe && pe.editMode.active) {
			pe.exitEditMode();
		}
	}

	// Update toolbar buttons
	document.querySelectorAll('.toolbar__btn[data-tool]').forEach(btn => {
		btn.classList.toggle('active', btn.dataset.tool === tool);
	});

	// Update canvas mode
	const canvasContainer = document.getElementById('canvas-container');
	canvasContainer.setAttribute('data-tool', tool);

	// Configure canvas selection
	state.canvas.selection = (tool === 'select');
	state.canvas.forEachObject(obj => {
		// These objects are NEVER user-selectable
		if (obj._isGrid || obj._isDimensionLabel ||
			obj._isPathSegment) {
			return;
		}
		// Background image: selectable only when unlocked AND in select mode
		if (obj._isBackground) {
			const locked = document.getElementById('image-lock')?.checked ?? true;
			obj.selectable = (!locked && tool === 'select');
			obj.evented = (!locked && tool === 'select');
			return;
		}
		// Interior anchors are never selectable; endpoint anchors are selectable in select mode
		if (obj._isAnchor && !obj._isEndpointAnchor) {
			return;
		}
		// Edit mode objects (vertices, segments, CP handles) are selectable in select mode
		if (obj._isEditVertex || obj._isEditCP || obj._isEditSegment) {
			obj.selectable = (tool === 'select');
			obj.evented = (tool === 'select');
		} else {
			obj.selectable = (tool === 'select');
			obj.evented = (tool === 'select');
		}
	});

	// Notify patron editor
	if (window.atelierModules?.patronEditor) {
		window.atelierModules.patronEditor.setTool(tool);
	}

	updateCanvasCursor();
	state.canvas.discardActiveObject();
	state.canvas.renderAll();
}

function updateCanvasCursor() {
	// Cursor is handled by CSS via data-tool attribute
}

// ============================================================
// History (Undo/Redo)
// ============================================================
function saveHistoryState() {
	const pe = window.atelierModules?.patronEditor;

	// Suspend edit mode during serialization so patron Paths are on canvas
	// and edit handles are not serialized
	const serialize = () => ({
		canvas: state.canvas.toJSON(CUSTOM_PROPS),
		contours: pe ? pe.serializeContours() : [],
	});
	const entry = pe ? pe.withEditModeSuspended(serialize) : serialize();

	// Remove future states if we're not at the end
	if (state.historyIndex < state.history.length - 1) {
		state.history = state.history.slice(0, state.historyIndex + 1);
	}

	state.history.push(JSON.stringify(entry));

	// Limit history size
	if (state.history.length > state.maxHistory) {
		state.history.shift();
	}

	state.historyIndex = state.history.length - 1;
	updateUndoRedoButtons();
}

function undo() {
	if (state.historyIndex <= 0) return;
	state.historyIndex--;
	loadHistoryState(state.historyIndex);
}

function redo() {
	if (state.historyIndex >= state.history.length - 1) return;
	state.historyIndex++;
	loadHistoryState(state.historyIndex);
}

function loadHistoryState(index) {
	const entry = JSON.parse(state.history[index]);
	// Backward compat: old entries are raw canvas JSON, new ones are {canvas, contours}
	const canvasData = entry.canvas || entry;
	const contoursData = entry.contours || [];

	state.canvas.loadFromJSON(canvasData, () => {
		const pe = window.atelierModules?.patronEditor;

		// Force-reset edit mode (don't call exitEditMode — handles are stale after loadFromJSON)
		if (pe) {
			pe.parkDrawing();
			pe.contours.forEach(c => c.removeFromCanvas());
			pe.contours = [];
			pe.editMode = { active: false, patrons: [], _allHandles: [], _allCPHandles: [] };
		}

		// Recover orphaned edit objects as patrons, then clean up remaining orphans
		recoverOrphanedEditObjects();
		const orphans = state.canvas.getObjects().filter(o =>
			o._isAnchor || o._isPathSegment || o._isDimensionLabel ||
			o._isDetectionPreview
		);
		orphans.forEach(o => state.canvas.remove(o));

		restoreObjectsAfterLoad();

		// Restore open contours
		if (pe && contoursData.length > 0) {
			pe.deserializeContours(contoursData);
		}

		drawGrid();
		state.canvas.renderAll();
		updateUndoRedoButtons();
		updateStats();
	});
}

function updateUndoRedoButtons() {
	document.getElementById('btn-undo').disabled = state.historyIndex <= 0;
	document.getElementById('btn-redo').disabled = state.historyIndex >= state.history.length - 1;
}

// ============================================================
// Properties Panel
// ============================================================
function updatePropertiesPanel(objects) {
	const content = document.getElementById('content-properties');
	if (!objects || objects.length === 0) {
		clearPropertiesPanel();
		return;
	}

	const obj = objects[0];
	const cmX = (obj.left / state.pxPerCm).toFixed(1);
	const cmY = (obj.top / state.pxPerCm).toFixed(1);
	const cmW = ((obj.width * obj.scaleX) / state.pxPerCm).toFixed(1);
	const cmH = ((obj.height * obj.scaleY) / state.pxPerCm).toFixed(1);
	const angle = (obj.angle || 0).toFixed(1);

	let typeLabel = 'Objet';
	let subtypeLabel = '';
	if (obj._isPatron) {
		typeLabel = 'Patron';
		subtypeLabel = obj._patronName || '';
	} else if (obj._isStrip) {
		typeLabel = 'Bande';
		if (obj._stripData) {
			subtypeLabel = `${obj._stripData.furType || ''} — ${obj._stripData.widthCm || '?'}×${obj._stripData.lengthCm || '?'} cm`;
		}
	} else if (obj._isBackground) {
		typeLabel = 'Image de fond';
	} else if (obj._isEditVertex) {
		const pe = window.atelierModules?.patronEditor;
		const record = pe?.editMode?.patrons?.[obj._patronIndex];
		const patronName = record?.patronObj?._patronName || 'Patron';
		typeLabel = 'Point';
		subtypeLabel = `${patronName} — sommet ${(obj._vertexIndex ?? 0) + 1}`;
	} else if (obj._isEditSegment) {
		const pe = window.atelierModules?.patronEditor;
		const record = pe?.editMode?.patrons?.[obj._patronIndex];
		const patronName = record?.patronObj?._patronName || 'Patron';
		const segType = record?.segments?.[obj._segmentIndex]?.type === 'Q' ? 'courbe' : 'ligne';
		typeLabel = 'Segment';
		subtypeLabel = `${patronName} — ${segType} ${(obj._segmentIndex ?? 0) + 1}`;
	} else if (obj._isEditCP) {
		const pe = window.atelierModules?.patronEditor;
		const record = pe?.editMode?.patrons?.[obj._patronIndex];
		const patronName = record?.patronObj?._patronName || 'Patron';
		typeLabel = 'Point de contrôle';
		subtypeLabel = `${patronName} — segment ${(obj._segmentIndex ?? 0) + 1}`;
	}

	// For edit mode objects, show contextual info instead of generic dimensions
	if (obj._isEditVertex || obj._isEditSegment || obj._isEditCP) {
		const ptX = (obj._isEditVertex || obj._isEditCP)
			? (obj.left / state.pxPerCm).toFixed(1)
			: '';
		const ptY = (obj._isEditVertex || obj._isEditCP)
			? (obj.top / state.pxPerCm).toFixed(1)
			: '';

		let editInfo = `
			<div class="panel__field">
				<label>Type</label>
				<span style="font-size:0.85rem;font-weight:500;color:#111">${typeLabel}</span>
			</div>`;
		if (subtypeLabel) {
			editInfo += `
			<div class="panel__field">
				<span style="font-size:0.8rem;color:#666">${subtypeLabel}</span>
			</div>`;
		}
		if (ptX) {
			editInfo += `
			<div class="panel__field-row">
				<div class="panel__field">
					<label>X (cm)</label>
					<span style="font-size:0.85rem">${ptX}</span>
				</div>
				<div class="panel__field">
					<label>Y (cm)</label>
					<span style="font-size:0.85rem">${ptY}</span>
				</div>
			</div>`;
		}
		if (obj._isEditSegment) {
			const pe = window.atelierModules?.patronEditor;
			const record = pe?.editMode?.patrons?.[obj._patronIndex];
			if (record) {
				const seg = record.segments[obj._segmentIndex];
				if (seg?.label) {
					editInfo += `
			<div class="panel__field">
				<label>Longueur</label>
				<span style="font-size:0.85rem">${seg.label.text}</span>
			</div>`;
				}
			}
		}
		editInfo += `
			<div class="panel__field">
				<p class="panel__hint" style="margin-top:4px">Suppr pour supprimer. Clic droit pour plus d'options.</p>
			</div>`;

		content.innerHTML = editInfo;
		return;
	}

	content.innerHTML = `
		<div class="panel__field">
			<label>Type</label>
			<span style="font-size:0.85rem;font-weight:500;color:#111">${typeLabel}</span>
		</div>
		${subtypeLabel ? `<div class="panel__field"><span style="font-size:0.8rem;color:#666">${subtypeLabel}</span></div>` : ''}
		<div class="panel__field-row">
			<div class="panel__field">
				<label>X (cm)</label>
				<input type="number" class="prop-input" data-prop="left" value="${cmX}" step="0.1">
			</div>
			<div class="panel__field">
				<label>Y (cm)</label>
				<input type="number" class="prop-input" data-prop="top" value="${cmY}" step="0.1">
			</div>
		</div>
		<div class="panel__field-row">
			<div class="panel__field">
				<label>Largeur (cm)</label>
				<input type="number" class="prop-input" data-prop="width" value="${cmW}" step="0.1">
			</div>
			<div class="panel__field">
				<label>Hauteur (cm)</label>
				<input type="number" class="prop-input" data-prop="height" value="${cmH}" step="0.1">
			</div>
		</div>
		<div class="panel__field">
			<label>Rotation (°)</label>
			<input type="number" class="prop-input" data-prop="angle" value="${angle}" step="1">
		</div>
	`;

	// Bind property inputs
	content.querySelectorAll('.prop-input').forEach(input => {
		input.addEventListener('change', (e) => {
			const prop = e.target.dataset.prop;
			const val = parseFloat(e.target.value);
			if (isNaN(val)) return;

			const activeObj = state.canvas.getActiveObject();
			if (!activeObj) return;

			switch (prop) {
				case 'left':
					activeObj.set('left', val * state.pxPerCm);
					break;
				case 'top':
					activeObj.set('top', val * state.pxPerCm);
					break;
				case 'width':
					activeObj.set('scaleX', (val * state.pxPerCm) / activeObj.width);
					break;
				case 'height':
					activeObj.set('scaleY', (val * state.pxPerCm) / activeObj.height);
					break;
				case 'angle':
					activeObj.set('angle', val);
					break;
			}

			activeObj.setCoords();
			state.canvas.renderAll();
			saveHistoryState();
			updateStats();
		});
	});
}

function clearPropertiesPanel() {
	document.getElementById('content-properties').innerHTML =
		'<p class="panel__empty">Sélectionnez un élément</p>';
}

// ============================================================
// Panel Toggle
// ============================================================
function initPanelToggles() {
	document.querySelectorAll('.panel__header[data-toggle]').forEach(header => {
		const sectionId = header.dataset.toggle;
		const content = document.getElementById(`content-${sectionId}`);
		const chevron = header.querySelector('.panel__chevron');

		// Sync chevron to initial collapsed state set in HTML
		if (content && content.classList.contains('panel__content--collapsed')) {
			chevron.style.transform = 'rotate(-90deg)';
		}

		header.addEventListener('click', () => {
			content.classList.toggle('panel__content--collapsed');
			if (content.classList.contains('panel__content--collapsed')) {
				chevron.style.transform = 'rotate(-90deg)';
			} else {
				chevron.style.transform = 'rotate(0deg)';
			}
		});
	});
}

// ============================================================
// Modals
// ============================================================
function initModals() {
	// Help modal
	document.getElementById('btn-help').addEventListener('click', () => {
		document.getElementById('help-modal').hidden = false;
	});

	// Load modal
	document.getElementById('btn-load').addEventListener('click', () => {
		refreshProjectList();
		document.getElementById('load-modal').hidden = false;
	});

	// Close modals
	document.querySelectorAll('.modal__close, .modal__backdrop').forEach(el => {
		el.addEventListener('click', () => {
			el.closest('.modal').hidden = true;
		});
	});

	// Escape closes modals
	document.addEventListener('keydown', (e) => {
		if (e.key === 'Escape') {
			document.querySelectorAll('.modal:not([hidden])').forEach(m => m.hidden = true);
		}
	});
}

// ============================================================
// Zoom Controls
// ============================================================
function zoomIn() {
	let newZoom = state.canvas.getZoom() * 1.2;
	newZoom = Math.min(MAX_ZOOM, newZoom);
	const center = state.canvas.getCenter();
	state.canvas.zoomToPoint(new fabric.Point(center.left, center.top), newZoom);
	state.zoom = newZoom;
	drawGrid();
	drawRulers();
	updateZoomDisplay();
}

function zoomOut() {
	let newZoom = state.canvas.getZoom() * 0.8;
	newZoom = Math.max(MIN_ZOOM, newZoom);
	const center = state.canvas.getCenter();
	state.canvas.zoomToPoint(new fabric.Point(center.left, center.top), newZoom);
	state.zoom = newZoom;
	drawGrid();
	drawRulers();
	updateZoomDisplay();
}

function zoomToFit() {
	const objects = state.canvas.getObjects().filter(o => !o._isGrid && !o._isDimensionLabel);
	if (objects.length === 0) {
		state.canvas.setZoom(1);
		const vpt = state.canvas.viewportTransform;
		vpt[4] = state.canvas.getWidth() * 0.15;
		vpt[5] = state.canvas.getHeight() * 0.1;
		state.zoom = 1;
	} else {
		// Get bounding box of all non-grid objects
		const group = new fabric.Group(objects);
		const bounds = group.getBoundingRect();
		group.destroy();

		const canvasW = state.canvas.getWidth();
		const canvasH = state.canvas.getHeight();
		const padding = 40;

		const scaleX = (canvasW - padding * 2) / bounds.width;
		const scaleY = (canvasH - padding * 2) / bounds.height;
		const newZoom = Math.min(scaleX, scaleY, MAX_ZOOM);

		state.canvas.setZoom(newZoom);
		const vpt = state.canvas.viewportTransform;
		vpt[4] = (canvasW - bounds.width * newZoom) / 2 - bounds.left * newZoom;
		vpt[5] = (canvasH - bounds.height * newZoom) / 2 - bounds.top * newZoom;
		state.zoom = newZoom;
	}

	drawGrid();
	drawRulers();
	updateZoomDisplay();
	state.canvas.renderAll();
}

function updateZoomDisplay() {
	document.getElementById('status-zoom').textContent = Math.round(state.zoom * 100) + '%';
}

// ============================================================
// Selection Actions
// ============================================================
function deleteSelection() {
	const active = state.canvas.getActiveObject();
	if (!active) return;

	// Endpoint anchor selected → delete the entire open contour
	if (active._isEndpointAnchor && active._contourId) {
		const pe = window.atelierModules?.patronEditor;
		if (pe) {
			const contour = pe.contours.find(c => c.id === active._contourId);
			if (contour) {
				contour.removeFromCanvas();
				pe.contours = pe.contours.filter(c => c !== contour);
				if (pe.activeContour === contour) {
					pe.activeContour = null;
				}
			}
		}
		state.canvas.discardActiveObject();
		state.canvas.renderAll();
		saveHistoryState();
		updateStats();
		return;
	}

	// Never delete internal objects through this path
	const isProtected = obj =>
		obj._isGrid || obj._isBackground || obj._isDimensionLabel ||
		obj._isEditVertex || obj._isEditCP || obj._isEditSegment ||
		obj._isAnchor || obj._isPathSegment;

	if (active.type === 'activeSelection') {
		active.forEachObject(obj => {
			if (!isProtected(obj)) state.canvas.remove(obj);
		});
	} else if (!isProtected(active)) {
		state.canvas.remove(active);
	}

	state.canvas.discardActiveObject();
	state.canvas.renderAll();
	saveHistoryState();
	updateStats();
}

function duplicateSelection() {
	const active = state.canvas.getActiveObject();
	if (!active) return;

	active.clone((cloned) => {
		cloned.set({
			left: cloned.left + 15,
			top: cloned.top + 15,
		});
		if (cloned.type === 'activeSelection') {
			cloned.forEachObject(obj => state.canvas.add(obj));
		} else {
			state.canvas.add(cloned);
		}
		state.canvas.setActiveObject(cloned);
		state.canvas.renderAll();
		saveHistoryState();
	}, ['_isPatron', '_isStrip', '_patronId', '_patronName', '_patronVertices', '_patronSegments', '_stripData']);
}

function selectAll() {
	const objects = state.canvas.getObjects().filter(o =>
		!o._isGrid && !o._isBackground && !o._isDimensionLabel &&
		!o._isEditVertex && !o._isEditCP && !o._isEditSegment &&
		!o._isAnchor && !o._isPathSegment &&
		o.selectable
	);
	if (objects.length === 0) return;

	const selection = new fabric.ActiveSelection(objects, { canvas: state.canvas });
	state.canvas.setActiveObject(selection);
	state.canvas.renderAll();
}

// ============================================================
// Recover orphaned edit mode objects — rebuild patrons from stale handles.
// This should never happen (withEditModeSuspended prevents it), but if it
// does, we salvage the data instead of silently deleting it.
// ============================================================
function recoverOrphanedEditObjects() {
	const allObjects = state.canvas.getObjects();
	const editVertices = allObjects.filter(o => o._isEditVertex);
	const editSegments = allObjects.filter(o => o._isEditSegment);
	const editCPs = allObjects.filter(o => o._isEditCP);

	if (editVertices.length === 0) return;

	// Group vertices by _patronIndex
	const groups = {};
	for (const v of editVertices) {
		const pIdx = v._patronIndex ?? 0;
		if (!groups[pIdx]) groups[pIdx] = { vertices: [], segments: [], cps: [] };
		groups[pIdx].vertices.push(v);
	}
	for (const s of editSegments) {
		const pIdx = s._patronIndex ?? 0;
		if (groups[pIdx]) groups[pIdx].segments.push(s);
	}
	for (const cp of editCPs) {
		const pIdx = cp._patronIndex ?? 0;
		if (groups[pIdx]) groups[pIdx].cps.push(cp);
	}

	let recovered = 0;
	const pe = window.atelierModules?.patronEditor;

	for (const pIdx of Object.keys(groups)) {
		const group = groups[pIdx];
		// Sort vertices by _vertexIndex
		group.vertices.sort((a, b) => (a._vertexIndex ?? 0) - (b._vertexIndex ?? 0));

		const points = group.vertices.map(v => ({ x: v.left, y: v.top }));
		if (points.length < 3) continue; // Not enough points for a patron

		// Build segment metadata — check for curve CPs
		const segmentsMeta = [];
		for (let i = 0; i < points.length; i++) {
			const cp = group.cps.find(c => (c._segmentIndex ?? -1) === i);
			if (cp) {
				segmentsMeta.push({ type: 'Q', cp: { x: cp.left, y: cp.top } });
			} else {
				segmentsMeta.push({ type: 'L' });
			}
		}

		// Build SVG path
		let pathStr = `M ${points[0].x} ${points[0].y}`;
		for (let i = 0; i < segmentsMeta.length; i++) {
			const to = points[(i + 1) % points.length];
			if (segmentsMeta[i].type === 'Q' && segmentsMeta[i].cp) {
				pathStr += ` Q ${segmentsMeta[i].cp.x} ${segmentsMeta[i].cp.y} ${to.x} ${to.y}`;
			} else {
				pathStr += ` L ${to.x} ${to.y}`;
			}
		}
		pathStr += ' Z';

		// Create patron
		if (pe) {
			pe._createPatronFromPath(pathStr, points, segmentsMeta);
		} else {
			// Fallback: create raw fabric Path
			const patron = new fabric.Path(pathStr, {
				fill: 'rgba(100, 149, 237, 0.1)',
				stroke: '#4a90d9',
				strokeWidth: 2 / state.canvas.getZoom(),
				selectable: true, evented: true,
				_isPatron: true,
				_patronId: 'recovered_' + Date.now() + '_' + pIdx,
				_patronName: `Patron récupéré ${parseInt(pIdx) + 1}`,
				_patronVertices: points,
				_patronSegments: segmentsMeta,
				cornerColor: '#4a90d9', cornerStyle: 'circle', cornerSize: 8,
				transparentCorners: false, borderColor: '#4a90d9',
			});
			state.canvas.add(patron);
		}
		recovered++;
	}

	// Remove all orphaned edit objects from canvas
	[...editVertices, ...editSegments, ...editCPs].forEach(o => state.canvas.remove(o));

	if (recovered > 0) {
		showToast(`${recovered} patron${recovered > 1 ? 's' : ''} récupéré${recovered > 1 ? 's' : ''} depuis des données orphelines`);
		console.warn(`Recovered ${recovered} patron(s) from orphaned edit mode objects`);
	}
}

// ============================================================
// Restore object properties after loadFromJSON
// Fabric.js doesn't serialize visual/interaction properties like
// cornerColor, selectable, etc. — we must reapply them.
// ============================================================
function restoreObjectsAfterLoad() {
	state.canvas.forEachObject(obj => {
		if (obj._isPatron) {
			obj.set({
				fill: obj.fill || 'rgba(100, 149, 237, 0.1)',
				stroke: obj.stroke || '#4a90d9',
				selectable: true, evented: true,
				cornerColor: '#4a90d9', cornerStyle: 'circle', cornerSize: 8,
				transparentCorners: false, borderColor: '#4a90d9',
			});
			obj.setCoords();
		}
		if (obj._isStrip) {
			const color = obj._stripData?.color || obj.stroke || '#888';
			obj.set({
				selectable: true, evented: true,
				cornerColor: color, cornerStyle: 'circle', cornerSize: 7,
				transparentCorners: false, borderColor: color,
				hasRotatingPoint: true, rotatingPointOffset: 20,
			});
			obj.setCoords();
		}
		if (obj._isGrid || obj._isDimensionLabel || obj._isPathSegment) {
			obj.set({ selectable: false, evented: false });
		}
		if (obj._isBackground) {
			const locked = document.getElementById('image-lock')?.checked ?? true;
			obj.set({ selectable: !locked, evented: !locked });
		}
	});

	// Strips always on top of patrons
	state.canvas.getObjects().filter(o => o._isStrip).forEach(s => state.canvas.bringToFront(s));

	// Keep only the last _isBackground object; remove any duplicates
	const bgObjects = state.canvas.getObjects().filter(o => o._isBackground);
	if (bgObjects.length > 1) {
		for (let i = 0; i < bgObjects.length - 1; i++) {
			state.canvas.remove(bgObjects[i]);
		}
	}
	state.backgroundImage = bgObjects.length > 0 ? bgObjects[bgObjects.length - 1] : null;
	updateCalquePreview();
}

// ============================================================
// Save / Load / Export
// ============================================================
function saveProject() {
	const name = state.projectName;
	const pe = window.atelierModules?.patronEditor;

	// Suspend edit mode during serialization
	const serialize = () => ({
		name,
		date: new Date().toISOString(),
		canvas: state.canvas.toJSON(CUSTOM_PROPS),
		zoom: state.zoom,
		contours: pe ? pe.serializeContours() : [],
	});
	const data = pe ? pe.withEditModeSuspended(serialize) : serialize();

	const projects = JSON.parse(localStorage.getItem('atelier_projects') || '{}');
	projects[name] = data;
	localStorage.setItem('atelier_projects', JSON.stringify(projects));
	localStorage.setItem('atelier_active_project', name);

	showToast('Projet sauvegardé');
}

function loadProject(name) {
	const projects = JSON.parse(localStorage.getItem('atelier_projects') || '{}');
	const data = projects[name];
	if (!data) return;

	localStorage.setItem('atelier_active_project', name);

	state.canvas.loadFromJSON(data.canvas, () => {
		state.projectName = data.name;
		state.zoom = data.zoom || 1;
		state.canvas.setZoom(state.zoom);

		document.querySelector('.app-header__project-name').textContent = data.name;

		const pe = window.atelierModules?.patronEditor;
		if (pe) {
			pe.parkDrawing();
			pe.contours.forEach(c => c.removeFromCanvas());
			pe.contours = [];
			// Force-reset edit mode (handles are stale after loadFromJSON)
			pe.editMode = { active: false, patrons: [], _allHandles: [], _allCPHandles: [] };
		}

		// Recover orphaned edit objects as patrons, then clean up remaining orphans
		recoverOrphanedEditObjects();
		const orphans = state.canvas.getObjects().filter(o =>
			o._isAnchor || o._isPathSegment || o._isDimensionLabel ||
			o._isDetectionPreview
		);
		orphans.forEach(o => state.canvas.remove(o));

		restoreObjectsAfterLoad();

		if (pe && data.contours && data.contours.length > 0) {
			pe.deserializeContours(data.contours);
		}

		drawGrid();
		drawRulers();
		zoomToFit();

		// Reset history
		state.history = [];
		state.historyIndex = -1;
		saveHistoryState();

		showToast('Projet chargé');
	});

	document.getElementById('load-modal').hidden = true;
}

function deleteProject(name) {
	const projects = JSON.parse(localStorage.getItem('atelier_projects') || '{}');
	delete projects[name];
	localStorage.setItem('atelier_projects', JSON.stringify(projects));
	refreshProjectList();
}

function refreshProjectList() {
	const container = document.getElementById('project-list');
	const projects = JSON.parse(localStorage.getItem('atelier_projects') || '{}');
	const names = Object.keys(projects);

	if (names.length === 0) {
		container.innerHTML = '<p class="panel__empty">Aucun projet sauvegardé</p>';
		return;
	}

	container.innerHTML = names.map(name => {
		const date = new Date(projects[name].date).toLocaleDateString('fr-FR', {
			day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit'
		});
		return `
			<div class="project-list__item" data-project="${name}">
				<div>
					<div class="project-list__item-name">${name}</div>
					<div class="project-list__item-date">${date}</div>
				</div>
				<button class="project-list__item-delete" data-delete="${name}" title="Supprimer">&times;</button>
			</div>
		`;
	}).join('');

	// Bind events
	container.querySelectorAll('.project-list__item').forEach(item => {
		item.addEventListener('click', (e) => {
			if (e.target.closest('[data-delete]')) {
				e.stopPropagation();
				const delName = e.target.closest('[data-delete]').dataset.delete;
				if (confirm(`Supprimer le projet "${delName}" ?`)) {
					deleteProject(delName);
				}
				return;
			}
			loadProject(item.dataset.project);
		});
	});
}

function newProject() {
	if (!confirm('Créer un nouveau projet ? Les modifications non sauvegardées seront perdues.')) return;

	localStorage.removeItem('atelier_active_project');

	state.canvas.clear();
	state.canvas.backgroundColor = CANVAS_BG;
	state.projectName = 'Nouveau projet';
	document.querySelector('.app-header__project-name').textContent = state.projectName;
	state.backgroundImage = null;
	updateCalquePreview();
	state.history = [];
	state.historyIndex = -1;

	const vpt = state.canvas.viewportTransform;
	state.canvas.setZoom(1);
	vpt[4] = state.canvas.getWidth() * 0.15;
	vpt[5] = state.canvas.getHeight() * 0.1;
	state.zoom = 1;

	drawGrid();
	drawRulers();
	updateZoomDisplay();
	saveHistoryState();
	state.canvas.renderAll();
}

function downloadProjectJSON() {
	const pe = window.atelierModules?.patronEditor;

	// Suspend edit mode during serialization
	const serialize = () => ({
		name: state.projectName,
		date: new Date().toISOString(),
		version: 1,
		pxPerCm: state.pxPerCm,
		zoom: state.zoom,
		viewportTransform: [...state.canvas.viewportTransform],
		canvas: state.canvas.toJSON(CUSTOM_PROPS),
		contours: pe ? pe.serializeContours() : [],
	});
	const data = pe ? pe.withEditModeSuspended(serialize) : serialize();

	const json = JSON.stringify(data, null, 2);
	const blob = new Blob([json], { type: 'application/json' });
	const url = URL.createObjectURL(blob);

	const link = document.createElement('a');
	link.download = `${state.projectName}.json`;
	link.href = url;
	link.click();
	URL.revokeObjectURL(url);

	showToast('Projet téléchargé');
}

function importProjectJSON(file) {
	const reader = new FileReader();
	reader.onload = (e) => {
		try {
			const data = JSON.parse(e.target.result);

			if (!data.canvas) {
				showToast('Fichier invalide : pas de données canvas');
				return;
			}

			// Clear current state
			const pe = window.atelierModules?.patronEditor;
			if (pe) {
				pe.parkDrawing();
				pe.contours.forEach(c => c.removeFromCanvas());
				pe.contours = [];
				// Force-reset edit mode (handles become stale after loadFromJSON)
				pe.editMode = { active: false, patrons: [], _allHandles: [], _allCPHandles: [] };
			}

			state.canvas.loadFromJSON(data.canvas, () => {
				state.projectName = data.name || 'Projet importé';
				state.pxPerCm = data.pxPerCm || BASE_PX_PER_CM;
				state.zoom = data.zoom || 1;
				state.canvas.setZoom(state.zoom);

				if (data.viewportTransform) {
					state.canvas.viewportTransform = data.viewportTransform;
				}

				document.querySelector('.app-header__project-name').textContent = state.projectName;

				// Restore background image reference
				state.backgroundImage = null;
				state.canvas.forEachObject(obj => {
					if (obj._isBackground) {
						state.backgroundImage = obj;
					}
				});

				// Recover orphaned edit objects as patrons, then clean up remaining orphans
				recoverOrphanedEditObjects();
				const orphans = state.canvas.getObjects().filter(o =>
					o._isAnchor || o._isPathSegment || o._isDimensionLabel ||
					o._isDetectionPreview
				);
				orphans.forEach(o => state.canvas.remove(o));

				restoreObjectsAfterLoad();

				// Restore open contours if saved
				if (pe && data.contours && data.contours.length > 0) {
					pe.deserializeContours(data.contours);
				}

				drawGrid();
				drawRulers();
				zoomToFit();

				// Reset history
				state.history = [];
				state.historyIndex = -1;
				saveHistoryState();

				showToast('Projet importé');
			});
		} catch (err) {
			console.error('Import error:', err);
			showToast('Erreur lors de l\'import du fichier');
		}
	};
	reader.readAsText(file);
}

function exportPNG() {
	// Temporarily hide grid
	const gridObjects = state.canvas.getObjects().filter(o => o._isGrid);
	gridObjects.forEach(o => o.set('visible', false));

	const dataURL = state.canvas.toDataURL({
		format: 'png',
		quality: 1,
		multiplier: 2,
	});

	// Restore grid
	gridObjects.forEach(o => o.set('visible', true));
	state.canvas.renderAll();

	// Download
	const link = document.createElement('a');
	link.download = `${state.projectName}.png`;
	link.href = dataURL;
	link.click();

	showToast('Image exportée');
}

// ============================================================
// Auto-save
// ============================================================
function initAutoSave() {
	setInterval(() => {
		if (state.history.length > 0) {
			saveProject();
		}
	}, 30000); // Every 30 seconds
}

// ============================================================
// Toast Notifications
// ============================================================
function showToast(message) {
	// Remove existing toast
	const existing = document.querySelector('.toast');
	if (existing) existing.remove();

	const toast = document.createElement('div');
	toast.className = 'toast';
	toast.textContent = message;
	document.body.appendChild(toast);

	requestAnimationFrame(() => {
		toast.classList.add('visible');
	});

	setTimeout(() => {
		toast.classList.remove('visible');
		setTimeout(() => toast.remove(), 300);
	}, 2000);
}

// ============================================================
// Keyboard Shortcuts
// ============================================================
function initKeyboardShortcuts() {
	document.addEventListener('keydown', (e) => {
		// Don't handle shortcuts when typing in inputs
		if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT' || e.target.isContentEditable) {
			return;
		}

		const ctrl = e.ctrlKey || e.metaKey;

		// Space for panning
		if (e.code === 'Space' && !state.spaceHeld) {
			e.preventDefault();
			state.spaceHeld = true;
			state.canvas.defaultCursor = 'grab';
			state.canvas.setCursor('grab');
		}

		// Tool shortcuts
		if (!ctrl) {
			switch (e.key.toLowerCase()) {
				case 'v': setActiveTool('select'); break;
				case 'l': setActiveTool('line'); break;
				case 'c': setActiveTool('curve'); break;
				}
		}

		// Ctrl shortcuts
		if (ctrl) {
			switch (e.key.toLowerCase()) {
				case 'z':
					e.preventDefault();
					if (e.shiftKey) redo();
					else undo();
					break;
				case 'd':
					e.preventDefault();
					duplicateSelection();
					break;
				case 'a':
					e.preventDefault();
					selectAll();
					break;
				case 's':
					e.preventDefault();
					saveProject();
					break;
			}
		}

		// Delete
		if (e.key === 'Delete' || e.key === 'Backspace') {
			e.preventDefault();
			// In edit mode, delegate to patron-editor for vertex/segment deletion
			const pe = window.atelierModules?.patronEditor;
			if (pe && pe.editMode.active) {
				const active = state.canvas.getActiveObject();
				if (active && active._isEditVertex) {
					pe.deleteEditVertex(active._patronIndex, active._vertexIndex);
					state.canvas.discardActiveObject();
					state.canvas.renderAll();
					saveHistoryState();
				} else if (active && active._isEditSegment) {
					pe.deleteEditSegment(active._patronIndex, active._segmentIndex);
					state.canvas.discardActiveObject();
					state.canvas.renderAll();
					saveHistoryState();
				}
				return;
			}
			deleteSelection();
		}

		// Zoom
		if (e.key === '+' || e.key === '=') zoomIn();
		if (e.key === '-') zoomOut();
		if (e.key === '0' && !ctrl) zoomToFit();

		// Escape — exit edit mode, or park the current drawing
		if (e.key === 'Escape') {
			e.preventDefault();
			// Cancel calibration if active
			const pe = window.atelierModules?.patronEditor;
			if (pe && pe.isCalibrating) {
				pe.tempMarkers.forEach(m => state.canvas.remove(m));
				pe.tempMarkers = [];
				if (pe.calibrationLine) { state.canvas.remove(pe.calibrationLine); pe.calibrationLine = null; }
				pe.isCalibrating = false;
				pe.calibrationStart = null;
				document.getElementById('status-info').textContent = '';
				// Restore previous tool mode
				if (pe._preCalibrationTool) {
					setActiveTool(pe._preCalibrationTool);
					pe._preCalibrationTool = null;
				}
				state.canvas.renderAll();
				return;
			}
			if (window.atelierModules?.patronEditor) {
				const pe = window.atelierModules.patronEditor;
				if (pe.editMode?.active) {
					pe.exitEditMode();
				} else {
					pe.parkDrawing();
				}
			}
			setActiveTool('select');
			removeContextMenu();
		}
	});

	document.addEventListener('keyup', (e) => {
		if (e.code === 'Space') {
			state.spaceHeld = false;
			updateCanvasCursor();
			state.canvas.defaultCursor = '';
		}
	});
}

// ============================================================
// Toolbar Bindings
// ============================================================
function initToolbar() {
	// Tool buttons
	document.querySelectorAll('.toolbar__btn[data-tool]').forEach(btn => {
		btn.addEventListener('click', () => setActiveTool(btn.dataset.tool));
	});

	// Zoom buttons
	document.getElementById('btn-zoom-in').addEventListener('click', zoomIn);
	document.getElementById('btn-zoom-out').addEventListener('click', zoomOut);
	document.getElementById('btn-zoom-fit').addEventListener('click', zoomToFit);

	// Header buttons
	document.getElementById('btn-new').addEventListener('click', newProject);
	document.getElementById('btn-save').addEventListener('click', saveProject);
	document.getElementById('btn-export').addEventListener('click', exportPNG);
	document.getElementById('btn-download-json').addEventListener('click', downloadProjectJSON);
	document.getElementById('btn-import-json').addEventListener('click', () => {
		document.getElementById('json-input').click();
	});
	document.getElementById('json-input').addEventListener('change', (e) => {
		const file = e.target.files[0];
		if (!file) return;
		importProjectJSON(file);
		e.target.value = ''; // Reset so same file can be re-selected
	});
	document.getElementById('btn-undo').addEventListener('click', undo);
	document.getElementById('btn-redo').addEventListener('click', redo);

	// Import image
	document.getElementById('btn-import-image').addEventListener('click', () => {
		document.getElementById('image-input').click();
	});

	document.getElementById('image-input').addEventListener('change', (e) => {
		const file = e.target.files[0];
		if (!file) return;
		importBackgroundImage(file);
		e.target.value = ''; // Reset so same file can be re-selected
	});

	// Image opacity
	document.getElementById('image-opacity').addEventListener('input', (e) => {
		const val = parseInt(e.target.value);
		document.getElementById('image-opacity-value').textContent = val + '%';
		if (state.backgroundImage) {
			state.backgroundImage.set('opacity', val / 100);
			state.canvas.renderAll();
		}
	});

	// Image lock
	document.getElementById('image-lock').addEventListener('change', (e) => {
		if (state.backgroundImage) {
			const locked = e.target.checked;
			const inSelectMode = state.activeTool === 'select';
			state.backgroundImage.set({
				selectable: !locked && inSelectMode,
				evented: !locked && inSelectMode,
			});
			if (locked) {
				state.canvas.discardActiveObject();
			}
			state.canvas.renderAll();
		}
	});

	// Project name
	const projectNameEl = document.querySelector('.app-header__project-name');
	projectNameEl.addEventListener('blur', () => {
		state.projectName = projectNameEl.textContent.trim() || 'Nouveau projet';
		if (!projectNameEl.textContent.trim()) {
			projectNameEl.textContent = state.projectName;
		}
	});
	projectNameEl.addEventListener('keydown', (e) => {
		if (e.key === 'Enter') {
			e.preventDefault();
			projectNameEl.blur();
		}
	});

	// Calibrate button
	document.getElementById('btn-calibrate').addEventListener('click', () => {
		if (window.atelierModules?.patronEditor) {
			window.atelierModules.patronEditor.startCalibration();
		}
	});

	// Delete calque button
	document.getElementById('btn-delete-calque').addEventListener('click', () => {
		const bgObjects = state.canvas.getObjects().filter(o => o._isBackground);
		if (bgObjects.length > 0) {
			// Cancel calibration if active
			const pe = window.atelierModules?.patronEditor;
			if (pe && pe.isCalibrating) {
				pe.tempMarkers.forEach(m => state.canvas.remove(m));
				pe.tempMarkers = [];
				if (pe.calibrationLine) { state.canvas.remove(pe.calibrationLine); pe.calibrationLine = null; }
				pe.isCalibrating = false;
				pe.calibrationStart = null;
				document.getElementById('status-info').textContent = '';
			}
			bgObjects.forEach(o => state.canvas.remove(o));
			state.backgroundImage = null;
			updateCalquePreview();
			state.canvas.renderAll();
			saveHistoryState();
			showToast('Calque supprimé');
		}
	});

	// Contour detection
	document.getElementById('btn-detect-contours').addEventListener('click', async () => {
		const cd = window.atelierModules?.contourDetector;
		if (!cd) return;
		if (!state.backgroundImage) {
			showToast('Importez d\'abord une image');
			return;
		}

		const btn = document.getElementById('btn-detect-contours');
		btn.disabled = true;
		btn.textContent = 'Détection en cours...';

		try {
			const results = await cd.detect();
			cd.showPreview();

			document.getElementById('detection-settings').style.display = '';
			document.getElementById('detect-count-label').textContent =
				`${results.length} contour${results.length > 1 ? 's' : ''} détecté${results.length > 1 ? 's' : ''}`;

			btn.textContent = 'Détecter les contours';
			btn.disabled = false;
		} catch (err) {
			console.error('Detection error:', err);
			showToast('Erreur lors de la détection');
			btn.textContent = 'Détecter les contours';
			btn.disabled = false;
		}
	});

	document.getElementById('btn-detect-rerun').addEventListener('click', async () => {
		const cd = window.atelierModules?.contourDetector;
		if (!cd) return;

		// Update settings from UI
		const sensitivity = parseInt(document.getElementById('detect-sensitivity').value);
		const minArea = parseFloat(document.getElementById('detect-min-area').value);

		// Map sensitivity slider (20-200) to Canny thresholds
		// Lower sensitivity value = higher thresholds = fewer edges detected
		// Higher sensitivity value = lower thresholds = more edges detected
		cd.updateSettings({
			cannyLow: Math.max(10, 200 - sensitivity),
			cannyHigh: Math.max(30, 350 - sensitivity),
			minAreaCm2: minArea,
		});

		const btn = document.getElementById('btn-detect-rerun');
		btn.disabled = true;
		btn.textContent = 'Détection...';

		try {
			const results = await cd.detect();
			cd.showPreview();

			document.getElementById('detect-count-label').textContent =
				`${results.length} contour${results.length > 1 ? 's' : ''} détecté${results.length > 1 ? 's' : ''}`;

			btn.textContent = 'Relancer';
			btn.disabled = false;
		} catch (err) {
			console.error('Detection error:', err);
			showToast('Erreur lors de la détection');
			btn.textContent = 'Relancer';
			btn.disabled = false;
		}
	});

	document.getElementById('btn-detect-validate').addEventListener('click', () => {
		const cd = window.atelierModules?.contourDetector;
		const pe = window.atelierModules?.patronEditor;
		if (!cd || !pe) return;

		cd.createPatrons(pe);
		document.getElementById('detection-settings').style.display = 'none';
	});

	document.getElementById('btn-detect-cancel').addEventListener('click', () => {
		const cd = window.atelierModules?.contourDetector;
		if (cd) cd.clearPreview();
		document.getElementById('detection-settings').style.display = 'none';
	});
}

// ============================================================
// Calque Preview
// ============================================================
function updateCalquePreview() {
	const container = document.getElementById('calque-preview');
	const thumbnail = document.getElementById('calque-thumbnail');
	if (state.backgroundImage) {
		thumbnail.src = state.backgroundImage.getSrc();
		container.style.display = '';
	} else {
		thumbnail.src = '';
		container.style.display = 'none';
	}
}

// ============================================================
// Background Image Import
// ============================================================
function importBackgroundImage(file) {
	const reader = new FileReader();
	reader.onload = (e) => {
		fabric.Image.fromURL(e.target.result, (img) => {
			// Remove ALL existing background images, not just the tracked one
			state.canvas.getObjects().filter(o => o._isBackground).forEach(o => state.canvas.remove(o));
			state.backgroundImage = null;

			// Scale image to reasonable size (max 80cm in canvas units)
			const maxCm = 80;
			const maxPx = maxCm * state.pxPerCm;
			const scale = Math.min(maxPx / img.width, maxPx / img.height, 1);

			img.set({
				left: 0,
				top: 0,
				scaleX: scale,
				scaleY: scale,
				opacity: 0.3,
				selectable: false,
				evented: false,
				_isBackground: true,
				excludeFromExport: false,
				// Resize controls: lock aspect ratio, allow corner scaling
				lockUniScaling: true,
				cornerColor: '#4a90d9',
				cornerStrokeColor: '#fff',
				cornerSize: 10,
				transparentCorners: false,
				borderColor: '#4a90d9',
				borderDashArray: [4, 4],
			});

			state.backgroundImage = img;
			state.canvas.add(img);
			state.canvas.sendToBack(img);
			updateCalquePreview();

			// Send grid lines behind the image... actually image should be behind grid
			// Re-draw grid so it's on top of the image
			drawGrid();

			// Open image panel section
			const imageContent = document.getElementById('content-image');
			imageContent.classList.remove('panel__content--collapsed');

			showToast('Image importée — ajustez l\'opacité et calibrez l\'échelle');
			saveHistoryState();
		});
	};
	reader.readAsDataURL(file);
}

// ============================================================
// Stats Update (delegated to stats module)
// ============================================================
function updateStats() {
	if (window.atelierModules?.stats) {
		window.atelierModules.stats.update();
	}
}

// ============================================================
// Initialization
// ============================================================
function init() {
	// Initialize canvas
	const canvas = initCanvas();

	// Initialize UI
	initToolbar();
	initPanelToggles();
	initModals();
	initKeyboardShortcuts();

	// Draw initial rulers
	drawRulers();

	// Initialize modules
	window.atelierModules = {};

	try {
		window.atelierModules.patronEditor = new PatronEditor(canvas, state);
	} catch (e) {
		console.warn('PatronEditor module not loaded:', e.message);
	}

	try {
		window.atelierModules.peltManager = new PeltManager(canvas, state);
	} catch (e) {
		console.warn('PeltManager module not loaded:', e.message);
	}

	try {
		window.atelierModules.placementEngine = new PlacementEngine(canvas, state);
	} catch (e) {
		console.warn('PlacementEngine module not loaded:', e.message);
	}

	try {
		window.atelierModules.stats = new Stats(canvas, state);
	} catch (e) {
		console.warn('Stats module not loaded:', e.message);
	}

	try {
		window.atelierModules.contourDetector = new ContourDetector(canvas, state);
	} catch (e) {
		console.warn('ContourDetector module not loaded:', e.message);
	}

	// Restore last active project, or save initial state
	const activeProject = localStorage.getItem('atelier_active_project');
	if (activeProject) {
		const projects = JSON.parse(localStorage.getItem('atelier_projects') || '{}');
		if (projects[activeProject]) {
			loadProject(activeProject);
		} else {
			localStorage.removeItem('atelier_active_project');
			saveHistoryState();
		}
	} else {
		saveHistoryState();
	}

	// Auto-save
	initAutoSave();

	// Set initial zoom display
	updateZoomDisplay();

	console.log('Atelier initialized');
}

// ---- Start ----
document.addEventListener('DOMContentLoaded', init);

// ---- Exports for modules ----
export {
	state,
	drawGrid,
	drawRulers,
	saveHistoryState,
	updateStats,
	showToast,
	setActiveTool,
	updatePropertiesPanel,
	clearPropertiesPanel,
};
