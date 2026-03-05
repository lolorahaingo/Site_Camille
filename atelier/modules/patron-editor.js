// ============================================================
// PatronEditor — Drawing tools for pattern creation
// Contours are persistent objects on the canvas.
// Échap = park the current drawing (contour stays, can be resumed).
// Clicking an endpoint of a parked contour resumes it.
// When the path closes (click near start point), it becomes a patron.
// Two parked contours that share an endpoint merge automatically.
// ============================================================

import { drawGrid, saveHistoryState, showToast, setActiveTool } from '../atelier.js';

// Distance in screen-pixels to snap to an endpoint
const CLOSE_THRESHOLD = 14;

// ---- Helper: distance between two points ----
function dist(a, b) {
	return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);
}

// ---- Helper: approximate length of a quadratic Bézier curve ----
function bezierLength(p0, cp, p1, steps = 20) {
	let length = 0;
	let prev = p0;
	for (let i = 1; i <= steps; i++) {
		const t = i / steps;
		const mt = 1 - t;
		const x = mt * mt * p0.x + 2 * mt * t * cp.x + t * t * p1.x;
		const y = mt * mt * p0.y + 2 * mt * t * cp.y + t * t * p1.y;
		length += dist(prev, { x, y });
		prev = { x, y };
	}
	return length;
}

// ---- Helper: midpoint of a quadratic Bézier at t=0.5 ----
function bezierMidpoint(p0, cp, p1) {
	const t = 0.5, mt = 0.5;
	return {
		x: mt * mt * p0.x + 2 * mt * t * cp.x + t * t * p1.x,
		y: mt * mt * p0.y + 2 * mt * t * cp.y + t * t * p1.y,
	};
}

// ---- Helper: compute label position (midpoint + perpendicular offset) ----
function labelPosition(from, to, offset) {
	const mx = (from.x + to.x) / 2;
	const my = (from.y + to.y) / 2;
	const dx = to.x - from.x;
	const dy = to.y - from.y;
	const len = Math.sqrt(dx * dx + dy * dy) || 1;
	// Perpendicular direction (pointing "above" the segment)
	const nx = -dy / len;
	const ny = dx / len;
	return { x: mx + nx * offset, y: my + ny * offset };
}

// ---- Helper: create a dimension label fabric.Text ----
function makeDimensionLabel(canvas, text, pos, zoom) {
	return new fabric.Text(text, {
		left: pos.x,
		top: pos.y,
		fontSize: 11 / zoom,
		fontFamily: 'Inter, sans-serif',
		fill: '#666',
		originX: 'center',
		originY: 'bottom',
		selectable: false,
		evented: false,
		_isDimensionLabel: true,
		excludeFromExport: true,
	});
}

// ---- A single open contour living on the canvas ----
class OpenContour {
	constructor(canvas, state) {
		this.canvas = canvas;
		this.state = state;
		this.id = 'contour_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
		this.points = [];      // {x,y}[] — ordered vertices
		this.segments = [];    // fabric objects (Line | Path) between consecutive points
		this.anchors = [];     // fabric circles for each point
		this.labels = [];      // fabric.Text dimension labels (one per segment)
	}

	// -- First / last point --
	get startPoint() { return this.points[0] || null; }
	get endPoint() { return this.points[this.points.length - 1] || null; }

	// -- Add a point at the END and draw the segment from previous end --
	addPointEnd(point, segmentObj) {
		this.points.push(point);
		if (segmentObj) {
			this.segments.push(segmentObj);
			this.canvas.add(segmentObj);
			this._addLabel(segmentObj, this.points.length - 2, this.points.length - 1);
		}
		this._addAnchor(point);
		this._refreshEndpointStyles();
	}

	// -- Add a point at the START and draw the segment to previous start --
	addPointStart(point, segmentObj) {
		this.points.unshift(point);
		if (segmentObj) {
			this.segments.unshift(segmentObj);
			this.canvas.add(segmentObj);
			this._addLabelAtStart(segmentObj, 0, 1);
		}
		this._addAnchorAtStart(point);
		this._refreshEndpointStyles();
	}

	// -- Visual: anchor circle --
	_addAnchor(point) {
		const a = this._makeAnchor(point);
		this.canvas.add(a);
		this.anchors.push(a);
	}

	_addAnchorAtStart(point) {
		const a = this._makeAnchor(point);
		this.canvas.add(a);
		this.anchors.unshift(a);
	}

	_makeAnchor(point) {
		const zoom = this.canvas.getZoom();
		const r = 5 / zoom;
		return new fabric.Circle({
			left: point.x - r,
			top: point.y - r,
			radius: r,
			fill: '#fff',
			stroke: '#4a90d9',
			strokeWidth: 1.5 / zoom,
			selectable: false,
			evented: false,
			_isAnchor: true,
			_contourId: this.id,
		});
	}

	// Endpoints get a special look so the user knows they're clickable
	_refreshEndpointStyles() {
		const zoom = this.canvas.getZoom();
		this.anchors.forEach((a, i) => {
			const isEndpoint = (i === 0 || i === this.anchors.length - 1);
			const r = isEndpoint ? 6 / zoom : 4 / zoom;
			a.set({
				radius: r,
				left: this.points[i].x - r,
				top: this.points[i].y - r,
				fill: isEndpoint ? '#4a90d9' : '#fff',
				stroke: '#4a90d9',
				strokeWidth: (isEndpoint ? 2 : 1.5) / zoom,
			});
		});
		this.canvas.renderAll();
	}

	// Highlight an endpoint on hover
	highlightEndpoint(index, on) {
		const a = this.anchors[index];
		if (!a) return;
		const zoom = this.canvas.getZoom();
		const r = on ? 9 / zoom : 6 / zoom;
		a.set({
			radius: r,
			left: this.points[index].x - r,
			top: this.points[index].y - r,
			fill: on ? '#2ecc71' : '#4a90d9',
			strokeWidth: (on ? 2.5 : 2) / zoom,
		});
		this.canvas.renderAll();
	}

	// -- Dimension labels --
	_addLabel(segmentObj, fromIdx, toIdx) {
		const label = this._makeLabelForSegment(segmentObj, fromIdx, toIdx);
		this.canvas.add(label);
		this.labels.push(label);
	}

	_addLabelAtStart(segmentObj, fromIdx, toIdx) {
		const label = this._makeLabelForSegment(segmentObj, fromIdx, toIdx);
		this.canvas.add(label);
		this.labels.unshift(label);
	}

	_makeLabelForSegment(segmentObj, fromIdx, toIdx) {
		const zoom = this.canvas.getZoom();
		const from = this.points[fromIdx];
		const to = this.points[toIdx];
		const pxPerCm = this.state.pxPerCm;
		const offset = 12 / zoom;

		let lengthCm, pos;
		if (segmentObj.type === 'line') {
			lengthCm = dist(from, to) / pxPerCm;
			pos = labelPosition(from, to, offset);
		} else if (segmentObj.type === 'path' && segmentObj.path) {
			// Extract control point from Q command
			let cp = null;
			for (const cmd of segmentObj.path) {
				if (cmd[0] === 'Q') { cp = { x: cmd[1], y: cmd[2] }; break; }
			}
			if (cp) {
				lengthCm = bezierLength(from, cp, to) / pxPerCm;
				const mid = bezierMidpoint(from, cp, to);
				pos = labelPosition(from, to, offset);
				pos.x = mid.x + (pos.x - (from.x + to.x) / 2);
				pos.y = mid.y + (pos.y - (from.y + to.y) / 2);
			} else {
				lengthCm = dist(from, to) / pxPerCm;
				pos = labelPosition(from, to, offset);
			}
		} else {
			lengthCm = dist(from, to) / pxPerCm;
			pos = labelPosition(from, to, offset);
		}

		const text = lengthCm.toFixed(1) + ' cm';
		return makeDimensionLabel(this.canvas, text, pos, zoom);
	}

	// Remove all fabric objects from canvas
	removeFromCanvas() {
		this.segments.forEach(s => this.canvas.remove(s));
		this.anchors.forEach(a => this.canvas.remove(a));
		this.labels.forEach(l => this.canvas.remove(l));
	}

	// Merge another contour onto the END of this one.
	// Creates a connecting segment from this.endPoint to other.startPoint.
	mergeAtEnd(other) {
		const from = this.endPoint;
		const to = other.startPoint;

		// Create a connecting line segment between the two endpoints
		const zoom = this.canvas.getZoom();
		const connectLine = new fabric.Line([from.x, from.y, to.x, to.y], {
			stroke: '#333',
			strokeWidth: 2 / zoom,
			selectable: false,
			evented: false,
			_isPathSegment: true,
			_contourId: this.id,
		});
		this.canvas.add(connectLine);
		this.segments.push(connectLine);

		// Add a dimension label for the connecting segment
		const pxPerCm = this.state.pxPerCm;
		const lengthCm = dist(from, to) / pxPerCm;
		const offset = 12 / zoom;
		const lPos = labelPosition(from, to, offset);
		const label = makeDimensionLabel(this.canvas, lengthCm.toFixed(1) + ' cm', lPos, zoom);
		this.canvas.add(label);
		this.labels.push(label);

		// Append ALL of other's points (including the first — it's a distinct point)
		for (let i = 0; i < other.points.length; i++) {
			this.points.push(other.points[i]);
		}
		this.segments.push(...other.segments);
		this.labels.push(...other.labels);
		// Keep all of other's anchors
		for (let i = 0; i < other.anchors.length; i++) {
			this.anchors.push(other.anchors[i]);
		}
		this._refreshEndpointStyles();
	}

	// Reverse the contour direction (so we can always append at the end)
	reverse() {
		this.points.reverse();
		this.segments.reverse();
		this.anchors.reverse();
		this.labels.reverse();
		this._refreshEndpointStyles();
	}
}

// ============================================================
// PatronEditor
// ============================================================
export class PatronEditor {
	constructor(canvas, state) {
		this.canvas = canvas;
		this.state = state;

		// All parked open contours
		this.contours = [];

		// The contour currently being drawn (null if idle)
		this.activeContour = null;
		// Which end we're extending: 'end' (default) or 'start'
		this.activeDirection = 'end';

		// Temp preview objects
		this.tempLine = null;
		this.tempCurve = null;
		this.tempCurveHandles = [];
		this.tempArcMarkers = [];

		// Sub-tool state
		this.curveState = 'idle';
		this.curveStart = null;
		this.curveEnd = null;
		this.arcPoints = [];

		// Rectangle
		this.rectStart = null;
		this.tempRect = null;

		// Calibration
		this.isCalibrating = false;
		this.calibrationLine = null;
		this.calibrationStart = null;

		// Hover state
		this._hoveredEndpoint = null; // { contour, index }

		// Patron counter
		this.patronCount = 0;

		// Edit mode state — supports multiple patrons simultaneously
		this.editMode = {
			active: false,
			// Each entry: { patronObj, vertices[], segments[], handles[], cpHandles[] }
			patrons: [],
			// Flat lookup for quick access during drag
			_allHandles: [],    // all vertex handles across all patrons
			_allCPHandles: [],  // all CP handles across all patrons
		};

		// Merge mode: waiting for user to click a target vertex from another patron
		this._mergeSource = null; // { patronIndex, vertexIndex } or null

		// Selection dimension labels (shown when patron is selected but not in edit mode)
		this._selectionLabels = [];
	}

	// ---- Is the user actively drawing? ----
	get isDrawing() { return this.activeContour !== null; }

	// ============================================================
	// Tool delegation
	// ============================================================
	setTool(tool) {
		const drawingTools = ['line', 'curve', 'arc'];
		const isDrawingTool = drawingTools.includes(tool);

		// Clean up sub-tool temp objects (but keep the contour)
		this._cleanupTempObjects();

		if (tool === 'rect' && this.isDrawing) {
			// Park current drawing before switching to rect
			this.parkDrawing();
		}

		if (!isDrawingTool && tool !== 'select' && tool !== 'rect') {
			this.parkDrawing();
		}
	}

	// ============================================================
	// Mouse events
	// ============================================================
	handleMouseDown(opt) {
		const tool = this.state.activeTool;
		if (tool === 'select' || tool === 'pan') {
			// In select mode, check if clicking an endpoint to resume
			this._checkEndpointClick(opt);
			return;
		}

		const pointer = this.canvas.getPointer(opt.e);
		const point = this.snapPoint(pointer);

		if (this.isCalibrating) {
			this.handleCalibrationClick(point);
			return;
		}

		switch (tool) {
			case 'line': this.handleLineClick(point, opt.e); break;
			case 'curve': this.handleCurveClick(point, opt.e); break;
			case 'arc': this.handleArcClick(point, opt.e); break;
			case 'rect': this.handleRectStart(point, opt.e); break;
		}
	}

	handleMouseMove(opt) {
		const tool = this.state.activeTool;
		const pointer = this.canvas.getPointer(opt.e);
		const point = this.snapPoint(pointer);

		// Always check endpoint hover (for visual feedback)
		this._updateEndpointHover(point);

		if (tool === 'select' || tool === 'pan') return;

		if (this.isCalibrating && this.calibrationStart) {
			this.updateCalibrationPreview(point);
			return;
		}

		switch (tool) {
			case 'line': this.updateLinePreview(point, opt.e); break;
			case 'curve': this.updateCurvePreview(point, opt.e); break;
			case 'arc': this.updateArcPreview(point); break;
			case 'rect': this.updateRectPreview(point, opt.e); break;
		}
	}

	handleMouseUp(opt) {
		const tool = this.state.activeTool;
		if (tool === 'rect' && this.rectStart) {
			this.handleRectEnd(opt);
		}
	}

	// ============================================================
	// Endpoint hover & click (resume / close / merge)
	// ============================================================
	_updateEndpointHover(point) {
		const zoom = this.canvas.getZoom();
		const threshold = CLOSE_THRESHOLD / zoom;
		let found = null;

		for (const contour of this.contours) {
			if (contour === this.activeContour) continue; // skip active
			if (contour.points.length < 1) continue;
			if (dist(point, contour.startPoint) < threshold) {
				found = { contour, index: 0 };
				break;
			}
			if (dist(point, contour.endPoint) < threshold) {
				found = { contour, index: contour.points.length - 1 };
				break;
			}
		}

		// Also check active contour's START point for closing
		if (this.activeContour && this.activeContour.points.length >= 3) {
			const checkIdx = this.activeDirection === 'end' ? 0 : this.activeContour.points.length - 1;
			if (dist(point, this.activeContour.points[checkIdx]) < threshold) {
				found = { contour: this.activeContour, index: checkIdx, isClose: true };
			}
		}

		// Update highlight
		if (this._hoveredEndpoint) {
			this._hoveredEndpoint.contour.highlightEndpoint(this._hoveredEndpoint.index, false);
		}
		if (found) {
			found.contour.highlightEndpoint(found.index, true);
		}
		this._hoveredEndpoint = found;
	}

	_checkEndpointClick(opt) {
		const pointer = this.canvas.getPointer(opt.e);
		const point = this.snapPoint(pointer);
		const zoom = this.canvas.getZoom();
		const threshold = CLOSE_THRESHOLD / zoom;

		for (const contour of this.contours) {
			if (contour.points.length < 1) continue;

			// Click on start → resume from start
			if (dist(point, contour.startPoint) < threshold) {
				this._resumeContour(contour, 'start');
				return;
			}
			// Click on end → resume from end
			if (dist(point, contour.endPoint) < threshold) {
				this._resumeContour(contour, 'end');
				return;
			}
		}
	}

	_resumeContour(contour, direction) {
		this.activeContour = contour;
		this.activeDirection = direction;
		// Switch to line tool by default
		setActiveTool('line');
		const ptCount = contour.points.length;
		document.getElementById('status-info').textContent =
			`Tracé repris (${ptCount} points). Continuez à tracer ou rejoignez le point opposé pour fermer.`;
	}

	// ============================================================
	// Snap
	// ============================================================
	snapPoint(point) {
		if (!this.state.snapEnabled) return { x: point.x, y: point.y };
		const gridSize = this.state.pxPerCm;
		return {
			x: Math.round(point.x / gridSize) * gridSize,
			y: Math.round(point.y / gridSize) * gridSize,
		};
	}

	// ============================================================
	// Get the "current tip" — the point we're extending from
	// ============================================================
	_currentTip() {
		if (!this.activeContour) return null;
		return this.activeDirection === 'end'
			? this.activeContour.endPoint
			: this.activeContour.startPoint;
	}

	// ============================================================
	// Add a segment + point to the active contour
	// ============================================================
	_addSegment(point, segmentObj) {
		if (this.activeDirection === 'end') {
			this.activeContour.addPointEnd(point, segmentObj);
		} else {
			this.activeContour.addPointStart(point, segmentObj);
		}
	}

	// ============================================================
	// Check if a click should close or merge
	// Returns true if handled (closed/merged), false otherwise
	// ============================================================
	_tryCloseOrMerge(point) {
		const zoom = this.canvas.getZoom();
		const threshold = CLOSE_THRESHOLD / zoom;

		if (!this.activeContour) return false;

		// 1) Close: clicking near the opposite end of the SAME contour
		const oppositeIdx = this.activeDirection === 'end' ? 0 : this.activeContour.points.length - 1;
		const oppositePoint = this.activeContour.points[oppositeIdx];
		if (this.activeContour.points.length >= 3 && dist(point, oppositePoint) < threshold) {
			this._closeContour(this.activeContour);
			return true;
		}

		// 2) Merge: clicking near an endpoint of ANOTHER contour
		for (const other of this.contours) {
			if (other === this.activeContour) continue;
			if (other.points.length < 1) continue;

			if (dist(point, other.startPoint) < threshold) {
				this._mergeContours(this.activeContour, this.activeDirection, other, 'start');
				return true;
			}
			if (dist(point, other.endPoint) < threshold) {
				this._mergeContours(this.activeContour, this.activeDirection, other, 'end');
				return true;
			}
		}

		return false;
	}

	// ============================================================
	// LINE TOOL
	// ============================================================
	handleLineClick(point, event) {
		// If no active contour, check if clicking an existing endpoint
		if (!this.activeContour) {
			const resumed = this._tryResumeAtPoint(point);
			if (!resumed) {
				// Start a brand new contour
				this.activeContour = new OpenContour(this.canvas, this.state);
				this.activeDirection = 'end';
				this.contours.push(this.activeContour);
				this.activeContour.addPointEnd(point, null);
				document.getElementById('status-info').textContent =
					'Tracez le contour. Échap pour mettre en pause. Rejoignez le point de départ pour fermer.';
			}
			return;
		}

		// Check close / merge
		if (this._tryCloseOrMerge(point)) return;

		// Constrain angle
		const tip = this._currentTip();
		const constrainedPoint = event.shiftKey ? this.constrainAngle(tip, point) : point;

		// Create line segment
		const from = this.activeDirection === 'end' ? tip : constrainedPoint;
		const to = this.activeDirection === 'end' ? constrainedPoint : tip;
		const line = new fabric.Line([from.x, from.y, to.x, to.y], {
			stroke: '#333',
			strokeWidth: 2 / this.canvas.getZoom(),
			selectable: false,
			evented: false,
			_isPathSegment: true,
			_contourId: this.activeContour.id,
		});

		this._addSegment(constrainedPoint, line);
		this._updateStatusInfo();
		this.canvas.renderAll();
	}

	updateLinePreview(point, event) {
		if (!this.activeContour) return;
		const tip = this._currentTip();
		if (!tip) return;

		const constrainedPoint = event?.shiftKey ? this.constrainAngle(tip, point) : point;

		if (this.tempLine) this.canvas.remove(this.tempLine);
		this.tempLine = new fabric.Line(
			[tip.x, tip.y, constrainedPoint.x, constrainedPoint.y],
			{
				stroke: '#999',
				strokeWidth: 1.5 / this.canvas.getZoom(),
				strokeDashArray: [6, 4],
				selectable: false,
				evented: false,
			}
		);
		this.canvas.add(this.tempLine);
		this.canvas.renderAll();
	}

	// ============================================================
	// CURVE TOOL (Quadratic Bézier)
	// ============================================================
	handleCurveClick(point, event) {
		if (this.curveState === 'idle') {
			if (!this.activeContour) {
				const resumed = this._tryResumeAtPoint(point);
				if (!resumed) {
					this.activeContour = new OpenContour(this.canvas, this.state);
					this.activeDirection = 'end';
					this.contours.push(this.activeContour);
					this.activeContour.addPointEnd(point, null);
				}
			}
			this.curveStart = this._currentTip();
			this.curveState = 'placed-start';
			document.getElementById('status-info').textContent = 'Cliquez le point d\'arrivée de la courbe';
		} else if (this.curveState === 'placed-start') {
			const constrainedPoint = event.shiftKey
				? this.constrainAngle(this.curveStart, point) : point;
			this.curveEnd = constrainedPoint;
			this.curveState = 'adjusting';
			document.getElementById('status-info').textContent = 'Cliquez pour placer le point de contrôle de la courbe';
		} else if (this.curveState === 'adjusting') {
			const cp = point;
			const start = this.curveStart;
			const end = this.curveEnd;

			// Check close/merge with the end point
			if (this._tryCloseOrMerge(end)) {
				this._cleanupTempObjects();
				this.curveState = 'idle';
				return;
			}

			const pathStr = `M ${start.x} ${start.y} Q ${cp.x} ${cp.y} ${end.x} ${end.y}`;
			const curvePath = new fabric.Path(pathStr, {
				fill: '',
				stroke: '#333',
				strokeWidth: 2 / this.canvas.getZoom(),
				selectable: false,
				evented: false,
				_isPathSegment: true,
				_contourId: this.activeContour.id,
			});

			this._addSegment(end, curvePath);
			this._cleanupTempObjects();
			this.curveState = 'idle';
			this._updateStatusInfo();
			this.canvas.renderAll();
		}
	}

	updateCurvePreview(point, event) {
		if (this.curveState === 'placed-start' && this.curveStart) {
			if (this.tempLine) this.canvas.remove(this.tempLine);
			const constrainedPoint = event?.shiftKey
				? this.constrainAngle(this.curveStart, point) : point;
			this.tempLine = new fabric.Line(
				[this.curveStart.x, this.curveStart.y, constrainedPoint.x, constrainedPoint.y],
				{ stroke: '#999', strokeWidth: 1.5 / this.canvas.getZoom(), strokeDashArray: [6, 4], selectable: false, evented: false }
			);
			this.canvas.add(this.tempLine);
			this.canvas.renderAll();
		} else if (this.curveState === 'adjusting' && this.curveStart && this.curveEnd) {
			if (this.tempCurve) this.canvas.remove(this.tempCurve);
			this.tempCurveHandles.forEach(h => this.canvas.remove(h));
			this.tempCurveHandles = [];

			const pathStr = `M ${this.curveStart.x} ${this.curveStart.y} Q ${point.x} ${point.y} ${this.curveEnd.x} ${this.curveEnd.y}`;
			this.tempCurve = new fabric.Path(pathStr, {
				fill: '', stroke: '#999', strokeWidth: 1.5 / this.canvas.getZoom(), strokeDashArray: [6, 4], selectable: false, evented: false,
			});
			this.canvas.add(this.tempCurve);

			const h1 = new fabric.Line([this.curveStart.x, this.curveStart.y, point.x, point.y], {
				stroke: '#aaa', strokeWidth: 0.8 / this.canvas.getZoom(), strokeDashArray: [3, 3], selectable: false, evented: false,
			});
			const h2 = new fabric.Line([this.curveEnd.x, this.curveEnd.y, point.x, point.y], {
				stroke: '#aaa', strokeWidth: 0.8 / this.canvas.getZoom(), strokeDashArray: [3, 3], selectable: false, evented: false,
			});
			const cpMarker = new fabric.Circle({
				left: point.x - 4 / this.canvas.getZoom(), top: point.y - 4 / this.canvas.getZoom(),
				radius: 4 / this.canvas.getZoom(), fill: '#e74c3c', stroke: '#fff',
				strokeWidth: 1 / this.canvas.getZoom(), selectable: false, evented: false,
			});
			this.canvas.add(h1, h2, cpMarker);
			this.tempCurveHandles.push(h1, h2, cpMarker);
			this.canvas.renderAll();
		}
	}

	// ============================================================
	// ARC TOOL (3-point arc)
	// ============================================================
	handleArcClick(point, event) {
		if (this.arcPoints.length === 0) {
			if (!this.activeContour) {
				const resumed = this._tryResumeAtPoint(point);
				if (!resumed) {
					this.activeContour = new OpenContour(this.canvas, this.state);
					this.activeDirection = 'end';
					this.contours.push(this.activeContour);
					this.activeContour.addPointEnd(point, null);
				}
			}
			// Use current tip as arc start
			this.arcPoints.push(this._currentTip());
			document.getElementById('status-info').textContent = 'Arc : cliquez un point sur l\'arc (2/3)';
		}

		if (this.arcPoints.length < 3) {
			this.arcPoints.push(point);
			const marker = new fabric.Circle({
				left: point.x - 4 / this.canvas.getZoom(), top: point.y - 4 / this.canvas.getZoom(),
				radius: 4 / this.canvas.getZoom(), fill: '#e74c3c', stroke: '#fff',
				strokeWidth: 1 / this.canvas.getZoom(), selectable: false, evented: false,
			});
			this.canvas.add(marker);
			this.tempArcMarkers.push(marker);
		}

		if (this.arcPoints.length === 2) {
			document.getElementById('status-info').textContent = 'Arc : cliquez le point final (3/3)';
		} else if (this.arcPoints.length === 3) {
			const [p1, p2, p3] = this.arcPoints;
			const cp = {
				x: 2 * p2.x - 0.5 * p1.x - 0.5 * p3.x,
				y: 2 * p2.y - 0.5 * p1.y - 0.5 * p3.y,
			};

			// Check close/merge
			if (this._tryCloseOrMerge(p3)) {
				this._cleanupTempObjects();
				this.arcPoints = [];
				return;
			}

			const pathStr = `M ${p1.x} ${p1.y} Q ${cp.x} ${cp.y} ${p3.x} ${p3.y}`;
			const arcPath = new fabric.Path(pathStr, {
				fill: '', stroke: '#333', strokeWidth: 2 / this.canvas.getZoom(),
				selectable: false, evented: false, _isPathSegment: true, _contourId: this.activeContour.id,
			});

			this._addSegment(p3, arcPath);
			this._cleanupTempObjects();
			this.arcPoints = [];
			this._updateStatusInfo();
			this.canvas.renderAll();
		}
	}

	updateArcPreview(point) {
		if (this.arcPoints.length > 0 && this.arcPoints.length < 3) {
			if (this.tempLine) this.canvas.remove(this.tempLine);
			const lastPoint = this.arcPoints[this.arcPoints.length - 1];
			this.tempLine = new fabric.Line(
				[lastPoint.x, lastPoint.y, point.x, point.y],
				{ stroke: '#999', strokeWidth: 1.5 / this.canvas.getZoom(), strokeDashArray: [6, 4], selectable: false, evented: false }
			);
			this.canvas.add(this.tempLine);

			if (this.arcPoints.length === 2) {
				if (this.tempCurve) this.canvas.remove(this.tempCurve);
				const [p1, p2] = this.arcPoints;
				const p3 = point;
				const cp = { x: 2 * p2.x - 0.5 * p1.x - 0.5 * p3.x, y: 2 * p2.y - 0.5 * p1.y - 0.5 * p3.y };
				const pathStr = `M ${p1.x} ${p1.y} Q ${cp.x} ${cp.y} ${p3.x} ${p3.y}`;
				this.tempCurve = new fabric.Path(pathStr, {
					fill: '', stroke: '#999', strokeWidth: 1.5 / this.canvas.getZoom(), strokeDashArray: [6, 4], selectable: false, evented: false,
				});
				this.canvas.add(this.tempCurve);
			}
			this.canvas.renderAll();
		}
	}

	// ============================================================
	// RECTANGLE TOOL (creates patron directly)
	// ============================================================
	handleRectStart(point, event) {
		this.rectStart = point;
		this.tempRect = new fabric.Rect({
			left: point.x, top: point.y, width: 0, height: 0,
			fill: 'rgba(51, 51, 51, 0.05)', stroke: '#333',
			strokeWidth: 2 / this.canvas.getZoom(), selectable: false, evented: false,
		});
		this.canvas.add(this.tempRect);
	}

	updateRectPreview(point, event) {
		if (!this.rectStart || !this.tempRect) return;
		let width = point.x - this.rectStart.x;
		let height = point.y - this.rectStart.y;
		if (event?.shiftKey) {
			const size = Math.max(Math.abs(width), Math.abs(height));
			width = Math.sign(width) * size;
			height = Math.sign(height) * size;
		}
		this.tempRect.set({
			left: width >= 0 ? this.rectStart.x : this.rectStart.x + width,
			top: height >= 0 ? this.rectStart.y : this.rectStart.y + height,
			width: Math.abs(width), height: Math.abs(height),
		});
		this.canvas.renderAll();
	}

	handleRectEnd(opt) {
		if (!this.rectStart || !this.tempRect) return;
		const width = this.tempRect.width;
		const height = this.tempRect.height;
		if (width < 5 && height < 5) {
			this.canvas.remove(this.tempRect);
			this.tempRect = null;
			this.rectStart = null;
			return;
		}
		this.canvas.remove(this.tempRect);
		this._createPatronFromRect(this.tempRect.left, this.tempRect.top, width, height);
		this.tempRect = null;
		this.rectStart = null;
	}

	// ============================================================
	// Close a contour → create patron
	// ============================================================
	_closeContour(contour) {
		// Build SVG path and extract segment metadata for later editing
		const vertices = contour.points.map(p => ({ x: p.x, y: p.y }));
		const segmentsMeta = [];
		let pathStr = `M ${contour.points[0].x} ${contour.points[0].y}`;

		for (let i = 0; i < contour.segments.length; i++) {
			const seg = contour.segments[i];
			if (seg.type === 'line') {
				pathStr += ` L ${seg.x2} ${seg.y2}`;
				segmentsMeta.push({ type: 'L' });
			} else if (seg.type === 'path') {
				const pathData = seg.path;
				// Extract control point from Q command
				let cp = null;
				for (let j = 1; j < pathData.length; j++) {
					pathStr += ` ${pathData[j].join(' ')}`;
					if (pathData[j][0] === 'Q') {
						cp = { x: pathData[j][1], y: pathData[j][2] };
					}
				}
				segmentsMeta.push({ type: 'Q', cp });
			}
		}
		pathStr += ' Z';

		// Remove contour objects from canvas
		contour.removeFromCanvas();
		this.contours = this.contours.filter(c => c !== contour);

		// Create patron with metadata
		this._createPatronFromPath(pathStr, vertices, segmentsMeta);

		// Reset active
		if (this.activeContour === contour) {
			this.activeContour = null;
		}
		this._cleanupTempObjects();
	}

	// ============================================================
	// Merge two contours
	// ============================================================
	_mergeContours(active, activeDir, other, otherEnd) {
		// We want to connect activeDir of active to otherEnd of other
		// Strategy: make sure we can append other to the end of active

		// If we're extending from the start of active, reverse active first
		if (activeDir === 'start') {
			active.reverse();
			// Now we're always appending at the end
		}

		// If we're connecting to the END of other, reverse other so its start matches
		if (otherEnd === 'end') {
			other.reverse();
		}

		// Now: active.endPoint ≈ other.startPoint → merge
		active.mergeAtEnd(other);

		// Remove other from contours list (its fabric objects are now owned by active)
		this.contours = this.contours.filter(c => c !== other);

		// Check if the merged contour is now closed
		const zoom = this.canvas.getZoom();
		const threshold = CLOSE_THRESHOLD / zoom;
		if (active.points.length >= 3 && dist(active.startPoint, active.endPoint) < threshold) {
			this._closeContour(active);
		} else {
			this.activeContour = active;
			this.activeDirection = 'end';
			this._updateStatusInfo();
		}
	}

	// ============================================================
	// Park drawing (Échap) — contour stays on canvas, user can resume later
	// ============================================================
	parkDrawing() {
		this._cleanupTempObjects();
		this.activeContour = null;
		this.activeDirection = 'end';
		this.curveState = 'idle';
		this.curveStart = null;
		this.curveEnd = null;
		this.arcPoints = [];

		document.getElementById('status-info').textContent =
			this.contours.length > 0
				? 'Tracé en pause. Cliquez sur un point bleu pour reprendre.'
				: '';
	}

	// ============================================================
	// Cancel drawing (delete the active contour entirely)
	// Not currently bound to any UI — kept for future use
	// (e.g. right-click "Supprimer le contour" context menu)
	// ============================================================
	cancelDrawing() {
		if (this.activeContour) {
			this.activeContour.removeFromCanvas();
			this.contours = this.contours.filter(c => c !== this.activeContour);
			this.activeContour = null;
		}
		this._cleanupTempObjects();
		this.activeDirection = 'end';
		this.curveState = 'idle';
		this.curveStart = null;
		this.curveEnd = null;
		this.arcPoints = [];
		this.rectStart = null;
		if (this.tempRect) { this.canvas.remove(this.tempRect); this.tempRect = null; }
		if (this.calibrationLine) { this.canvas.remove(this.calibrationLine); this.calibrationLine = null; }
		this.isCalibrating = false;
		this.calibrationStart = null;

		document.getElementById('status-info').textContent = '';
		this.canvas.renderAll();
	}

	// ============================================================
	// Try to resume a contour by clicking near one of its endpoints
	// Returns true if resumed
	// ============================================================
	_tryResumeAtPoint(point) {
		const zoom = this.canvas.getZoom();
		const threshold = CLOSE_THRESHOLD / zoom;

		for (const contour of this.contours) {
			if (contour.points.length < 1) continue;
			if (dist(point, contour.endPoint) < threshold) {
				this.activeContour = contour;
				this.activeDirection = 'end';
				this._updateStatusInfo();
				return true;
			}
			if (dist(point, contour.startPoint) < threshold) {
				this.activeContour = contour;
				this.activeDirection = 'start';
				this._updateStatusInfo();
				return true;
			}
		}
		return false;
	}

	// ============================================================
	// Helpers
	// ============================================================
	_cleanupTempObjects() {
		if (this.tempLine) { this.canvas.remove(this.tempLine); this.tempLine = null; }
		if (this.tempCurve) { this.canvas.remove(this.tempCurve); this.tempCurve = null; }
		this.tempCurveHandles.forEach(h => this.canvas.remove(h));
		this.tempCurveHandles = [];
		this.tempArcMarkers.forEach(m => this.canvas.remove(m));
		this.tempArcMarkers = [];
	}

	_updateStatusInfo() {
		if (!this.activeContour) return;
		const n = this.activeContour.points.length;
		document.getElementById('status-info').textContent =
			`${n} points. Rejoignez le point opposé pour fermer le patron. Échap = pause.`;
	}

	_createPatronFromPath(pathStr, vertices, segmentsMeta) {
		this.patronCount++;
		const patronName = `Patron ${this.patronCount}`;
		const patronPath = new fabric.Path(pathStr, {
			fill: 'rgba(100, 149, 237, 0.1)',
			stroke: '#4a90d9',
			strokeWidth: 2 / this.canvas.getZoom(),
			selectable: true, evented: true,
			_isPatron: true,
			_patronId: 'patron_' + Date.now(),
			_patronName: patronName,
			_patronVertices: vertices || [],
			_patronSegments: segmentsMeta || [],
			cornerColor: '#4a90d9', cornerStyle: 'circle', cornerSize: 8,
			transparentCorners: false, borderColor: '#4a90d9',
		});
		this.canvas.add(patronPath);
		this.canvas.setActiveObject(patronPath);
		setActiveTool('select');
		saveHistoryState();
		showToast(`${patronName} créé`);
		if (window.atelierModules?.stats) window.atelierModules.stats.update();
		this.canvas.renderAll();
	}

	_createPatronFromRect(left, top, width, height) {
		this.patronCount++;
		const patronName = `Patron ${this.patronCount}`;

		// Build as a Path (not Rect) so edit mode works uniformly
		const vertices = [
			{ x: left, y: top },
			{ x: left + width, y: top },
			{ x: left + width, y: top + height },
			{ x: left, y: top + height },
		];
		const segmentsMeta = [
			{ type: 'L' }, { type: 'L' }, { type: 'L' }, { type: 'L' },
		];
		const pathStr = `M ${left} ${top} L ${left + width} ${top} L ${left + width} ${top + height} L ${left} ${top + height} Z`;

		const patronPath = new fabric.Path(pathStr, {
			fill: 'rgba(100, 149, 237, 0.1)',
			stroke: '#4a90d9',
			strokeWidth: 2 / this.canvas.getZoom(),
			selectable: true, evented: true,
			_isPatron: true,
			_patronId: 'patron_' + Date.now(),
			_patronName: patronName,
			_patronVertices: vertices,
			_patronSegments: segmentsMeta,
			cornerColor: '#4a90d9', cornerStyle: 'circle', cornerSize: 8,
			transparentCorners: false, borderColor: '#4a90d9',
		});
		this.canvas.add(patronPath);
		this.canvas.setActiveObject(patronPath);
		setActiveTool('select');
		saveHistoryState();
		showToast(`${patronName} créé`);
		if (window.atelierModules?.stats) window.atelierModules.stats.update();
		this.canvas.renderAll();
	}

	constrainAngle(from, to) {
		const dx = to.x - from.x;
		const dy = to.y - from.y;
		const angle = Math.atan2(dy, dx);
		const d = Math.sqrt(dx * dx + dy * dy);
		const snapped = Math.round(angle / (Math.PI / 4)) * (Math.PI / 4);
		return { x: from.x + d * Math.cos(snapped), y: from.y + d * Math.sin(snapped) };
	}

	// ============================================================
	// EDIT MODE — vertex editing of closed patrons (multi-patron)
	// ============================================================

	// Add a patron to the current edit session (or start one)
	enterEditMode(patronObj) {
		this.parkDrawing();
		this.clearSelectionLabels();

		// Check if this patron is already being edited
		if (this.editMode.patrons.some(p => p.patronObj === patronObj)) return;

		// Get vertices and segments from patron metadata
		let vertices = patronObj._patronVertices;
		let segmentsMeta = patronObj._patronSegments;

		// Fallback: parse from fabric path data if metadata is missing
		if (!vertices || vertices.length === 0) {
			const parsed = this._parsePatronPath(patronObj);
			vertices = parsed.vertices;
			segmentsMeta = parsed.segments;
		}

		if (!vertices || vertices.length < 3) {
			showToast('Ce patron ne peut pas être édité');
			return;
		}

		// Transform vertices from patron-local to world coordinates
		const matrix = patronObj.calcTransformMatrix();
		const po = patronObj.pathOffset || { x: 0, y: 0 };
		const worldVertices = vertices.map(v => {
			const pt = fabric.util.transformPoint(
				new fabric.Point(v.x - po.x, v.y - po.y), matrix
			);
			return { x: pt.x, y: pt.y };
		});

		// Transform control points too
		const worldSegments = segmentsMeta.map(s => {
			if (s.type === 'Q' && s.cp) {
				const pt = fabric.util.transformPoint(
					new fabric.Point(s.cp.x - po.x, s.cp.y - po.y), matrix
				);
				return { type: 'Q', cp: { x: pt.x, y: pt.y } };
			}
			return { type: s.type };
		});

		// Remove the patron from canvas during editing (re-created on exit)
		this.canvas.discardActiveObject();
		this.canvas.remove(patronObj);

		// Create the patron edit record
		const patronIdx = this.editMode.patrons.length;
		const record = {
			patronObj,
			vertices: worldVertices,
			segments: [],
			handles: [],
			cpHandles: [],
		};

		const zoom = this.canvas.getZoom();

		// Create vertex handles
		for (let i = 0; i < worldVertices.length; i++) {
			const v = worldVertices[i];
			const handle = new fabric.Circle({
				left: v.x, top: v.y,
				radius: 6 / zoom,
				originX: 'center', originY: 'center',
				fill: '#4a90d9', stroke: '#fff',
				strokeWidth: 2 / zoom,
				selectable: true, evented: true,
				hasBorders: false, hasControls: false,
				_isEditVertex: true,
				_patronIndex: patronIdx,
				_vertexIndex: i,
				hoverCursor: 'move', moveCursor: 'move',
			});
			this.canvas.add(handle);
			record.handles.push(handle);
		}

		// Create segments, labels, and CP handles
		for (let i = 0; i < worldSegments.length; i++) {
			const from = worldVertices[i];
			const to = worldVertices[(i + 1) % worldVertices.length];
			const sMeta = worldSegments[i];

			let segObj, label, cpHandle = null;
			const offset = 12 / zoom;

			if (sMeta.type === 'Q' && sMeta.cp) {
				const pathStr = `M ${from.x} ${from.y} Q ${sMeta.cp.x} ${sMeta.cp.y} ${to.x} ${to.y}`;
				segObj = new fabric.Path(pathStr, {
					fill: '', stroke: '#4a90d9', strokeWidth: 1.5 / zoom,
					selectable: false, evented: false, _isEditSegment: true,
				});
				cpHandle = new fabric.Circle({
					left: sMeta.cp.x, top: sMeta.cp.y,
					radius: 5 / zoom,
					originX: 'center', originY: 'center',
					fill: '#e74c3c', stroke: '#fff',
					strokeWidth: 1.5 / zoom,
					selectable: true, evented: true,
					hasBorders: false, hasControls: false,
					_isEditCP: true,
					_patronIndex: patronIdx,
					_segmentIndex: i,
					hoverCursor: 'move', moveCursor: 'move',
				});
				this.canvas.add(cpHandle);
				record.cpHandles.push(cpHandle);

				const lengthCm = bezierLength(from, sMeta.cp, to) / this.state.pxPerCm;
				const mid = bezierMidpoint(from, sMeta.cp, to);
				const lPos = labelPosition(from, to, offset);
				lPos.x = mid.x + (lPos.x - (from.x + to.x) / 2);
				lPos.y = mid.y + (lPos.y - (from.y + to.y) / 2);
				label = makeDimensionLabel(this.canvas, lengthCm.toFixed(1) + ' cm', lPos, zoom);
			} else {
				segObj = new fabric.Line([from.x, from.y, to.x, to.y], {
					stroke: '#4a90d9', strokeWidth: 1.5 / zoom,
					selectable: false, evented: false, _isEditSegment: true,
				});
				const lengthCm = dist(from, to) / this.state.pxPerCm;
				const lPos = labelPosition(from, to, offset);
				label = makeDimensionLabel(this.canvas, lengthCm.toFixed(1) + ' cm', lPos, zoom);
			}

			this.canvas.add(segObj);
			this.canvas.add(label);
			record.segments.push({
				type: sMeta.type, obj: segObj, label,
				cp: sMeta.cp ? { ...sMeta.cp } : null,
				cpHandle,
			});
		}

		// Add record
		this.editMode.patrons.push(record);
		this.editMode.active = true;
		this._rebuildEditHandleLookups();

		// Bring all handles to front
		this._bringEditHandlesToFront();
		this.canvas.renderAll();

		const count = this.editMode.patrons.length;
		document.getElementById('status-info').textContent =
			count === 1
				? 'Mode édition — Déplacez les points. Double-cliquez un autre patron pour l\'ajouter. Échap pour quitter.'
				: `Mode édition — ${count} patrons. Déplacez les points. Échap pour quitter.`;
	}

	exitEditMode() {
		if (!this.editMode.active) return;
		this._mergeSource = null;

		const em = this.editMode;

		// Rebuild each patron from its current edit state
		for (const record of em.patrons) {
			const newVertices = record.handles.map(h => ({ x: h.left, y: h.top }));
			const newSegments = record.segments.map(s => {
				if (s.type === 'Q' && s.cpHandle) {
					return { type: 'Q', cp: { x: s.cpHandle.left, y: s.cpHandle.top } };
				}
				return { type: s.type };
			});

			// Build SVG path
			let pathStr = `M ${newVertices[0].x} ${newVertices[0].y}`;
			for (let i = 0; i < newSegments.length; i++) {
				const to = newVertices[(i + 1) % newVertices.length];
				if (newSegments[i].type === 'Q' && newSegments[i].cp) {
					pathStr += ` Q ${newSegments[i].cp.x} ${newSegments[i].cp.y} ${to.x} ${to.y}`;
				} else {
					pathStr += ` L ${to.x} ${to.y}`;
				}
			}
			pathStr += ' Z';

			// Remove edit objects
			record.handles.forEach(h => this.canvas.remove(h));
			record.cpHandles.forEach(h => this.canvas.remove(h));
			record.segments.forEach(s => {
				this.canvas.remove(s.obj);
				this.canvas.remove(s.label);
			});

			// Create new patron
			const newPatron = new fabric.Path(pathStr, {
				fill: record.patronObj.fill || 'rgba(100, 149, 237, 0.1)',
				stroke: record.patronObj.stroke || '#4a90d9',
				strokeWidth: record.patronObj.strokeWidth,
				selectable: true, evented: true,
				_isPatron: true,
				_patronId: record.patronObj._patronId,
				_patronName: record.patronObj._patronName,
				_patronVertices: newVertices,
				_patronSegments: newSegments,
				cornerColor: '#4a90d9', cornerStyle: 'circle', cornerSize: 8,
				transparentCorners: false, borderColor: '#4a90d9',
			});

			// patronObj was already removed from canvas when entering edit mode
			this.canvas.add(newPatron);
		}

		// Reset edit state
		this.editMode = {
			active: false,
			patrons: [],
			_allHandles: [],
			_allCPHandles: [],
		};

		this.canvas.discardActiveObject();
		this.canvas.renderAll();
		saveHistoryState();
		if (window.atelierModules?.stats) window.atelierModules.stats.update();
		document.getElementById('status-info').textContent = '';
	}

	// Handle vertex/CP dragging in edit mode
	handleEditModeDrag(target) {
		if (!this.editMode.active) return;

		if (target._isEditVertex) {
			const pIdx = target._patronIndex;
			const vIdx = target._vertexIndex;
			const record = this.editMode.patrons[pIdx];
			if (!record) return;

			record.vertices[vIdx] = { x: target.left, y: target.top };

			const n = record.vertices.length;
			this._updateEditSegmentQuiet(record, (vIdx - 1 + n) % n);
			this._updateEditSegmentQuiet(record, vIdx);
			this._bringEditHandlesToFront();
			this.canvas.requestRenderAll();
		}

		if (target._isEditCP) {
			const pIdx = target._patronIndex;
			const sIdx = target._segmentIndex;
			const record = this.editMode.patrons[pIdx];
			if (!record) return;

			record.segments[sIdx].cp = { x: target.left, y: target.top };
			this._updateEditSegmentQuiet(record, sIdx);
			this._bringEditHandlesToFront();
			this.canvas.requestRenderAll();
		}
	}

	// Update a segment's fabric objects without triggering render (caller renders)
	_updateEditSegmentQuiet(record, segIdx) {
		const n = record.vertices.length;
		const from = record.vertices[segIdx];
		const to = record.vertices[(segIdx + 1) % n];
		const seg = record.segments[segIdx];
		const zoom = this.canvas.getZoom();
		const offset = 12 / zoom;

		this.canvas.remove(seg.obj);
		this.canvas.remove(seg.label);

		let newObj, lengthCm, lPos;

		if (seg.type === 'Q' && seg.cp) {
			const pathStr = `M ${from.x} ${from.y} Q ${seg.cp.x} ${seg.cp.y} ${to.x} ${to.y}`;
			newObj = new fabric.Path(pathStr, {
				fill: '', stroke: '#4a90d9', strokeWidth: 1.5 / zoom,
				selectable: false, evented: false, _isEditSegment: true,
			});
			lengthCm = bezierLength(from, seg.cp, to) / this.state.pxPerCm;
			const mid = bezierMidpoint(from, seg.cp, to);
			lPos = labelPosition(from, to, offset);
			lPos.x = mid.x + (lPos.x - (from.x + to.x) / 2);
			lPos.y = mid.y + (lPos.y - (from.y + to.y) / 2);
		} else {
			newObj = new fabric.Line([from.x, from.y, to.x, to.y], {
				stroke: '#4a90d9', strokeWidth: 1.5 / zoom,
				selectable: false, evented: false, _isEditSegment: true,
			});
			lengthCm = dist(from, to) / this.state.pxPerCm;
			lPos = labelPosition(from, to, offset);
		}

		const newLabel = makeDimensionLabel(this.canvas, lengthCm.toFixed(1) + ' cm', lPos, zoom);
		this.canvas.add(newObj);
		this.canvas.add(newLabel);
		seg.obj = newObj;
		seg.label = newLabel;
	}

	// Merge two patrons in edit mode by connecting a vertex from each.
	// pIdx1/vIdx1 — the "seam" vertex on the first patron.
	// pIdx2/vIdx2 — the "seam" vertex on the second patron.
	// NOTE: No UI trigger is wired yet. This method is ready for use once
	// a "merge vertices" interaction (e.g. drag-snap or toolbar button) is added.
	mergeEditPatrons(pIdx1, vIdx1, pIdx2, vIdx2) {
		const em = this.editMode;
		const r1 = em.patrons[pIdx1];
		const r2 = em.patrons[pIdx2];
		if (!r1 || !r2) return;

		const zoom = this.canvas.getZoom();
		const offset = 12 / zoom;

		// Remove the closing segments of both patrons (the segment from last vertex back to first).
		// We'll reconnect them as one open polygon, then close it.

		// Strategy: "open" both polygons at the selected vertices, concatenate, close.
		// Rotate r1's arrays so vIdx1 is the last vertex.
		// Rotate r2's arrays so vIdx2 is the first vertex.
		this._rotateRecord(r1, (vIdx1 + 1) % r1.vertices.length);
		this._rotateRecord(r2, vIdx2);

		// Now r1 ends at the connection point, r2 starts at the connection point.
		// Remove the closing segment of r1 (last segment: from last vertex back to first).
		const closingSeg1 = r1.segments.pop();
		this.canvas.remove(closingSeg1.obj);
		this.canvas.remove(closingSeg1.label);
		if (closingSeg1.cpHandle) {
			this.canvas.remove(closingSeg1.cpHandle);
			r1.cpHandles = r1.cpHandles.filter(h => h !== closingSeg1.cpHandle);
		}

		// Remove the closing segment of r2
		const closingSeg2 = r2.segments.pop();
		this.canvas.remove(closingSeg2.obj);
		this.canvas.remove(closingSeg2.label);
		if (closingSeg2.cpHandle) {
			this.canvas.remove(closingSeg2.cpHandle);
			r2.cpHandles = r2.cpHandles.filter(h => h !== closingSeg2.cpHandle);
		}

		// Create connecting segment from r1's last vertex to r2's first vertex
		const from1 = r1.vertices[r1.vertices.length - 1];
		const to2 = r2.vertices[0];
		const connectObj1 = new fabric.Line([from1.x, from1.y, to2.x, to2.y], {
			stroke: '#4a90d9', strokeWidth: 1.5 / zoom,
			selectable: false, evented: false, _isEditSegment: true,
		});
		const connectLen1 = dist(from1, to2) / this.state.pxPerCm;
		const connectLPos1 = labelPosition(from1, to2, offset);
		const connectLabel1 = makeDimensionLabel(this.canvas, connectLen1.toFixed(1) + ' cm', connectLPos1, zoom);
		this.canvas.add(connectObj1);
		this.canvas.add(connectLabel1);
		r1.segments.push({ type: 'L', obj: connectObj1, label: connectLabel1, cp: null, cpHandle: null });

		// Append r2's data to r1
		r1.vertices.push(...r2.vertices);
		r1.segments.push(...r2.segments);
		r1.handles.push(...r2.handles);
		r1.cpHandles.push(...r2.cpHandles);

		// Create closing segment from r2's last vertex back to r1's first vertex
		const fromLast = r1.vertices[r1.vertices.length - 1];
		const toFirst = r1.vertices[0];
		const closeObj = new fabric.Line([fromLast.x, fromLast.y, toFirst.x, toFirst.y], {
			stroke: '#4a90d9', strokeWidth: 1.5 / zoom,
			selectable: false, evented: false, _isEditSegment: true,
		});
		const closeLen = dist(fromLast, toFirst) / this.state.pxPerCm;
		const closeLPos = labelPosition(fromLast, toFirst, offset);
		const closeLabel = makeDimensionLabel(this.canvas, closeLen.toFixed(1) + ' cm', closeLPos, zoom);
		this.canvas.add(closeObj);
		this.canvas.add(closeLabel);
		r1.segments.push({ type: 'L', obj: closeObj, label: closeLabel, cp: null, cpHandle: null });

		// r2's patron object was already removed from canvas when entering edit mode

		// Update r1's patron name
		r1.patronObj._patronName = (r1.patronObj._patronName || 'Patron') + ' (fusionné)';

		// Remove r2 from patrons array
		em.patrons.splice(pIdx2, 1);

		// Re-index all handles
		this._reindexAllHandles();
		this._rebuildEditHandleLookups();
		this._bringEditHandlesToFront();
		this.canvas.renderAll();

		const count = em.patrons.length;
		showToast('Patrons fusionnés');
		document.getElementById('status-info').textContent =
			`Mode édition — ${count} patron${count > 1 ? 's' : ''}. Déplacez les points. Échap pour quitter.`;
	}

	// Start merge: user selected a source vertex, now waiting for target
	startMerge(patronIndex, vertexIndex) {
		this._mergeSource = { patronIndex, vertexIndex };
		// Highlight the source vertex
		const record = this.editMode.patrons[patronIndex];
		if (record && record.handles[vertexIndex]) {
			record.handles[vertexIndex].set({ fill: '#2ecc71', radius: 9 / this.canvas.getZoom() });
			this.canvas.renderAll();
		}
		document.getElementById('status-info').textContent =
			'Cliquez sur un point d\'un autre patron pour connecter les deux patrons.';
	}

	// Handle click during merge mode
	handleMergeClick(target) {
		if (!this._mergeSource) return false;
		if (!target || !target._isEditVertex) {
			// Cancel merge
			this._cancelMerge();
			return true;
		}

		const src = this._mergeSource;
		const dstPIdx = target._patronIndex;
		const dstVIdx = target._vertexIndex;

		if (dstPIdx === src.patronIndex) {
			showToast('Sélectionnez un point d\'un autre patron');
			return true;
		}

		// Reset source highlight
		this._resetMergeHighlight();
		this._mergeSource = null;

		// Perform merge
		this.mergeEditPatrons(src.patronIndex, src.vertexIndex, dstPIdx, dstVIdx);
		return true;
	}

	_cancelMerge() {
		this._resetMergeHighlight();
		this._mergeSource = null;
		document.getElementById('status-info').textContent =
			'Mode édition — Déplacez les points. Échap pour quitter.';
	}

	_resetMergeHighlight() {
		if (!this._mergeSource) return;
		const record = this.editMode.patrons[this._mergeSource.patronIndex];
		if (record && record.handles[this._mergeSource.vertexIndex]) {
			const zoom = this.canvas.getZoom();
			record.handles[this._mergeSource.vertexIndex].set({
				fill: '#4a90d9', radius: 6 / zoom,
			});
			this.canvas.renderAll();
		}
	}

	// Delete a vertex in edit mode
	deleteEditVertex(patronIndex, vertexIndex) {
		const record = this.editMode.patrons[patronIndex];
		if (!record) return;

		if (record.vertices.length <= 3) {
			showToast('Impossible de supprimer : minimum 3 points');
			return;
		}

		const n = record.vertices.length;
		const prevSegIdx = (vertexIndex - 1 + n) % n;
		const nextSegIdx = vertexIndex;
		const fromVertexIdx = (vertexIndex - 1 + n) % n;
		const toVertexIdx = (vertexIndex + 1) % n;

		// Remove vertex handle
		this.canvas.remove(record.handles[vertexIndex]);
		record.handles.splice(vertexIndex, 1);
		record.vertices.splice(vertexIndex, 1);

		// Remove two adjacent segments (descending order to preserve indices)
		const segsToRemove = [prevSegIdx, nextSegIdx].sort((a, b) => b - a);
		for (const si of segsToRemove) {
			const seg = record.segments[si];
			this.canvas.remove(seg.obj);
			this.canvas.remove(seg.label);
			if (seg.cpHandle) {
				this.canvas.remove(seg.cpHandle);
				record.cpHandles = record.cpHandles.filter(h => h !== seg.cpHandle);
			}
			record.segments.splice(si, 1);
		}

		// Insert new bridging segment
		const newN = record.vertices.length;
		const adjFrom = fromVertexIdx >= vertexIndex ? fromVertexIdx - 1 : fromVertexIdx;
		const adjTo = toVertexIdx > vertexIndex ? toVertexIdx - 1 : toVertexIdx;
		const insertIdx = ((adjFrom % newN) + newN) % newN;

		const from = record.vertices[insertIdx];
		const to = record.vertices[(insertIdx + 1) % newN];
		const zoom = this.canvas.getZoom();
		const offset = 12 / zoom;

		const newObj = new fabric.Line([from.x, from.y, to.x, to.y], {
			stroke: '#4a90d9', strokeWidth: 1.5 / zoom,
			selectable: false, evented: false, _isEditSegment: true,
		});
		const lengthCm = dist(from, to) / this.state.pxPerCm;
		const lPos = labelPosition(from, to, offset);
		const newLabel = makeDimensionLabel(this.canvas, lengthCm.toFixed(1) + ' cm', lPos, zoom);

		this.canvas.add(newObj);
		this.canvas.add(newLabel);
		record.segments.splice(insertIdx, 0, {
			type: 'L', obj: newObj, label: newLabel, cp: null, cpHandle: null,
		});

		// Re-index
		this._reindexAllHandles();
		this._rebuildEditHandleLookups();
		this._bringEditHandlesToFront();
		this.canvas.renderAll();
	}

	// ---- Edit mode helpers ----

	_rotateRecord(record, newStartIdx) {
		if (newStartIdx === 0) return;
		const n = record.vertices.length;
		const idx = newStartIdx % n;
		record.vertices = [...record.vertices.slice(idx), ...record.vertices.slice(0, idx)];
		record.segments = [...record.segments.slice(idx), ...record.segments.slice(0, idx)];
		record.handles  = [...record.handles.slice(idx),  ...record.handles.slice(0, idx)];
		// Rebuild cpHandles in the new segment order so the flat array stays consistent
		// with record.segments (used for bulk canvas operations and _reindexAllHandles).
		record.cpHandles = record.segments.map(s => s.cpHandle).filter(Boolean);
	}

	_reindexAllHandles() {
		this.editMode.patrons.forEach((record, pIdx) => {
			record.handles.forEach((h, vIdx) => {
				h._patronIndex = pIdx;
				h._vertexIndex = vIdx;
			});
			record.cpHandles.forEach(h => {
				h._patronIndex = pIdx;
			});
			record.segments.forEach((s, sIdx) => {
				if (s.cpHandle) s.cpHandle._segmentIndex = sIdx;
			});
		});
	}

	_rebuildEditHandleLookups() {
		this.editMode._allHandles = [];
		this.editMode._allCPHandles = [];
		for (const record of this.editMode.patrons) {
			this.editMode._allHandles.push(...record.handles);
			this.editMode._allCPHandles.push(...record.cpHandles);
		}
	}

	_bringEditHandlesToFront() {
		for (const h of this.editMode._allHandles) this.canvas.bringToFront(h);
		for (const h of this.editMode._allCPHandles) this.canvas.bringToFront(h);
	}

	// Fallback: parse a fabric.Path's internal path data into vertices + segments
	_parsePatronPath(patronObj) {
		const vertices = [];
		const segments = [];
		const pathData = patronObj.path;
		if (!pathData) return { vertices: [], segments: [] };

		for (const cmd of pathData) {
			switch (cmd[0]) {
				case 'M':
					vertices.push({ x: cmd[1], y: cmd[2] });
					break;
				case 'L':
					vertices.push({ x: cmd[1], y: cmd[2] });
					segments.push({ type: 'L' });
					break;
				case 'Q':
					vertices.push({ x: cmd[3], y: cmd[4] });
					segments.push({ type: 'Q', cp: { x: cmd[1], y: cmd[2] } });
					break;
				case 'Z':
				case 'z':
					if (vertices.length >= 2) {
						segments.push({ type: 'L' });
					}
					break;
			}
		}

		return { vertices, segments };
	}

	// Show dimension labels when patron is selected (non-edit mode)
	showSelectionLabels(patronObj) {
		this.clearSelectionLabels();
		if (!patronObj._isPatron) return;

		let vertices = patronObj._patronVertices;
		let segmentsMeta = patronObj._patronSegments;

		if (!vertices || vertices.length === 0) {
			const parsed = this._parsePatronPath(patronObj);
			vertices = parsed.vertices;
			segmentsMeta = parsed.segments;
		}
		if (!vertices || vertices.length < 2) return;

		const matrix = patronObj.calcTransformMatrix();
		const po = patronObj.pathOffset || { x: 0, y: 0 };
		const zoom = this.canvas.getZoom();
		const offset = 12 / zoom;

		for (let i = 0; i < segmentsMeta.length; i++) {
			const fromLocal = vertices[i];
			const toLocal = vertices[(i + 1) % vertices.length];
			const sMeta = segmentsMeta[i];

			const from = fabric.util.transformPoint(
				new fabric.Point(fromLocal.x - po.x, fromLocal.y - po.y), matrix
			);
			const to = fabric.util.transformPoint(
				new fabric.Point(toLocal.x - po.x, toLocal.y - po.y), matrix
			);

			let lengthCm, lPos;
			if (sMeta.type === 'Q' && sMeta.cp) {
				const cpWorld = fabric.util.transformPoint(
					new fabric.Point(sMeta.cp.x - po.x, sMeta.cp.y - po.y), matrix
				);
				lengthCm = bezierLength(from, cpWorld, to) / this.state.pxPerCm;
				const mid = bezierMidpoint(from, cpWorld, to);
				lPos = labelPosition(from, to, offset);
				lPos.x = mid.x + (lPos.x - (from.x + to.x) / 2);
				lPos.y = mid.y + (lPos.y - (from.y + to.y) / 2);
			} else {
				lengthCm = dist(from, to) / this.state.pxPerCm;
				lPos = labelPosition(from, to, offset);
			}

			const label = makeDimensionLabel(this.canvas, lengthCm.toFixed(1) + ' cm', lPos, zoom);
			this.canvas.add(label);
			this._selectionLabels.push(label);
		}
		this.canvas.renderAll();
	}

	clearSelectionLabels() {
		this._selectionLabels.forEach(l => this.canvas.remove(l));
		this._selectionLabels = [];
	}

	// ============================================================
	// CALIBRATION (unchanged)
	// ============================================================
	startCalibration() {
		this.parkDrawing();
		this.isCalibrating = true;
		this.calibrationStart = null;
		document.getElementById('status-info').textContent = 'Calibration : tracez une ligne sur la photo dont vous connaissez la mesure';
		showToast('Cliquez sur deux points de la photo pour calibrer l\'échelle');
	}

	handleCalibrationClick(point) {
		if (!this.calibrationStart) {
			this.calibrationStart = point;
			const marker = new fabric.Circle({
				left: point.x - 5, top: point.y - 5, radius: 5,
				fill: '#e74c3c', stroke: '#fff', strokeWidth: 2,
				selectable: false, evented: false,
			});
			this.canvas.add(marker);
			this.tempArcMarkers.push(marker);
			document.getElementById('status-info').textContent = 'Cliquez sur le deuxième point';
		} else {
			const dx = point.x - this.calibrationStart.x;
			const dy = point.y - this.calibrationStart.y;
			const pxDist = Math.sqrt(dx * dx + dy * dy);
			const realCm = prompt('Quelle est la mesure réelle de cette ligne en centimètres ?');
			if (realCm && !isNaN(parseFloat(realCm)) && parseFloat(realCm) > 0) {
				const newPxPerCm = pxDist / parseFloat(realCm);
				this.state.pxPerCm = newPxPerCm;
				drawGrid();
				showToast(`Échelle calibrée : 1 cm = ${Math.round(newPxPerCm)} pixels`);
			}
			this.tempArcMarkers.forEach(m => this.canvas.remove(m));
			this.tempArcMarkers = [];
			if (this.calibrationLine) { this.canvas.remove(this.calibrationLine); this.calibrationLine = null; }
			this.isCalibrating = false;
			this.calibrationStart = null;
			document.getElementById('status-info').textContent = '';
			this.canvas.renderAll();
		}
	}

	updateCalibrationPreview(point) {
		if (!this.calibrationStart) return;
		if (this.calibrationLine) this.canvas.remove(this.calibrationLine);
		this.calibrationLine = new fabric.Line(
			[this.calibrationStart.x, this.calibrationStart.y, point.x, point.y],
			{ stroke: '#e74c3c', strokeWidth: 2, strokeDashArray: [6, 3], selectable: false, evented: false }
		);
		this.canvas.add(this.calibrationLine);
		const dx = point.x - this.calibrationStart.x;
		const dy = point.y - this.calibrationStart.y;
		const cmDist = (Math.sqrt(dx * dx + dy * dy) / this.state.pxPerCm).toFixed(1);
		document.getElementById('status-info').textContent = `Distance : ${cmDist} cm (actuelle)`;
		this.canvas.renderAll();
	}
}
