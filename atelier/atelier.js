// ============================================================
// Atelier — Main Application
// Fur pelt placement tool
// ============================================================

import { PatronEditor } from './modules/patron-editor.js';
import { PeltManager } from './modules/pelt-manager.js';
import { PlacementEngine } from './modules/placement-engine.js';
import { Stats } from './modules/stats.js';

// ---- Constants ----
const BASE_PX_PER_CM = 30;
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
	snapEnabled: false,
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

	// Delegate to active tool module
	if (window.atelierModules?.patronEditor) {
		window.atelierModules.patronEditor.handleMouseUp(opt);
	}
}

function handleSelectionChange(opt) {
	updatePropertiesPanel(opt.selected);

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

function handleSelectionCleared() {
	clearPropertiesPanel();

	// Clear dimension labels
	const pe = window.atelierModules?.patronEditor;
	if (pe) {
		pe.clearSelectionLabels();
		// If in edit mode and user clicks empty space, exit edit mode
		if (pe.editMode.active) {
			pe.exitEditMode();
		}
	}
}

function handleObjectModified(opt) {
	saveHistoryState();
	updateStats();

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

	if (window.atelierModules?.placementEngine) {
		window.atelierModules.placementEngine.handleObjectMoving(opt);
	}
}

function handleMouseDblClick(opt) {
	const target = opt.target;
	const pe = window.atelierModules?.patronEditor;
	if (!pe) return;

	if (target && target._isPatron && !pe.editMode.active) {
		// Enter edit mode on the patron
		pe.clearSelectionLabels();
		pe.enterEditMode(target);
	} else if (pe.editMode.active) {
		// Double-click elsewhere or on non-patron → exit edit mode
		if (!target || (!target._isEditVertex && !target._isEditCP)) {
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
		menu.innerHTML = `
			<div class="context-menu__item context-menu__item--danger" data-action="delete-vertex" data-vertex-index="${target._vertexIndex}">Supprimer le point <span class="context-menu__shortcut">Suppr</span></div>
		`;
	} else if (target && !target._isGrid && !target._isEditSegment && !target._isEditCP) {
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
			const idx = parseInt(item.dataset.vertexIndex, 10);
			if (window.atelierModules?.patronEditor) {
				window.atelierModules.patronEditor.deleteEditVertex(idx);
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
		if (obj._isGrid || obj._isBackground || obj._isDimensionLabel || obj._isEditSegment) {
			// These objects are never user-selectable
			return;
		}
		if (obj._isEditVertex || obj._isEditCP) {
			// Edit handles must stay interactive while edit mode is active (tool is always 'select' then)
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
	const json = state.canvas.toJSON(['_isGrid', '_isBackground', '_isPatron', '_isStrip', '_patronId', '_patronName', '_patronVertices', '_patronSegments', '_stripData', 'excludeFromExport']);

	// Remove future states if we're not at the end
	if (state.historyIndex < state.history.length - 1) {
		state.history = state.history.slice(0, state.historyIndex + 1);
	}

	state.history.push(JSON.stringify(json));

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
	const json = JSON.parse(state.history[index]);
	state.canvas.loadFromJSON(json, () => {
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
	if (obj._isPatron) typeLabel = 'Patron';
	else if (obj._isStrip) typeLabel = 'Bande';
	else if (obj._isBackground) typeLabel = 'Image de fond';

	content.innerHTML = `
		<div class="panel__field">
			<label>Type</label>
			<span style="font-size:0.85rem;font-weight:500;color:#111">${typeLabel}</span>
		</div>
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

	// Never delete edit-mode handles or dimension labels through this path
	const isProtected = obj =>
		obj._isGrid || obj._isBackground || obj._isDimensionLabel ||
		obj._isEditVertex || obj._isEditCP || obj._isEditSegment;

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
		o.selectable
	);
	if (objects.length === 0) return;

	const selection = new fabric.ActiveSelection(objects, { canvas: state.canvas });
	state.canvas.setActiveObject(selection);
	state.canvas.renderAll();
}

// ============================================================
// Save / Load / Export
// ============================================================
function saveProject() {
	const name = state.projectName;
	const data = {
		name,
		date: new Date().toISOString(),
		canvas: state.canvas.toJSON(['_isGrid', '_isBackground', '_isPatron', '_isStrip', '_patronId', '_patronName', '_patronVertices', '_patronSegments', '_stripData', 'excludeFromExport']),
		zoom: state.zoom,
	};

	const projects = JSON.parse(localStorage.getItem('atelier_projects') || '{}');
	projects[name] = data;
	localStorage.setItem('atelier_projects', JSON.stringify(projects));

	showToast('Projet sauvegardé');
}

function loadProject(name) {
	const projects = JSON.parse(localStorage.getItem('atelier_projects') || '{}');
	const data = projects[name];
	if (!data) return;

	state.canvas.loadFromJSON(data.canvas, () => {
		state.projectName = data.name;
		state.zoom = data.zoom || 1;
		state.canvas.setZoom(state.zoom);

		document.querySelector('.app-header__project-name').textContent = data.name;

		drawGrid();
		drawRulers();
		updateZoomDisplay();
		state.canvas.renderAll();

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

	state.canvas.clear();
	state.canvas.backgroundColor = CANVAS_BG;
	state.projectName = 'Nouveau projet';
	document.querySelector('.app-header__project-name').textContent = state.projectName;
	state.backgroundImage = null;
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
				case 'a': setActiveTool('arc'); break;
				case 'r': setActiveTool('rect'); break;
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
			// In edit mode, only delete a selected vertex — never fall through to deleteSelection
			const pe = window.atelierModules?.patronEditor;
			if (pe && pe.editMode.active) {
				const active = state.canvas.getActiveObject();
				if (active && active._isEditVertex) {
					pe.deleteEditVertex(active._vertexIndex);
				}
				// No-op for any other key press while in edit mode
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

	// Snap toggle
	document.getElementById('btn-toggle-snap').addEventListener('click', () => {
		state.snapEnabled = !state.snapEnabled;
		document.getElementById('btn-toggle-snap').classList.toggle('toggled', state.snapEnabled);
	});

	// Zoom buttons
	document.getElementById('btn-zoom-in').addEventListener('click', zoomIn);
	document.getElementById('btn-zoom-out').addEventListener('click', zoomOut);
	document.getElementById('btn-zoom-fit').addEventListener('click', zoomToFit);

	// Header buttons
	document.getElementById('btn-new').addEventListener('click', newProject);
	document.getElementById('btn-save').addEventListener('click', saveProject);
	document.getElementById('btn-export').addEventListener('click', exportPNG);
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
			state.backgroundImage.set({
				selectable: !locked,
				evented: !locked,
			});
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
}

// ============================================================
// Background Image Import
// ============================================================
function importBackgroundImage(file) {
	const reader = new FileReader();
	reader.onload = (e) => {
		fabric.Image.fromURL(e.target.result, (img) => {
			// Remove existing background image
			if (state.backgroundImage) {
				state.canvas.remove(state.backgroundImage);
			}

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
			});

			state.backgroundImage = img;
			state.canvas.add(img);
			state.canvas.sendToBack(img);

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

	// Save initial state
	saveHistoryState();

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
