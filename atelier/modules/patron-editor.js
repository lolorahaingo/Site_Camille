// ============================================================
// PatronEditor — Drawing tools for pattern creation
// ============================================================

import { drawGrid, saveHistoryState, showToast, setActiveTool } from '../atelier.js';

export class PatronEditor {
	constructor(canvas, state) {
		this.canvas = canvas;
		this.state = state;
		
		// Drawing state
		this.isDrawing = false;
		this.currentPath = []; // Array of {x, y} points in canvas coords
		this.currentSegments = []; // Fabric objects for current path segments
		this.currentPoints = []; // Fabric objects for anchor points
		this.tempLine = null; // Preview line while drawing
		this.tempCurve = null;
		
		// Rectangle drawing
		this.rectStart = null;
		this.tempRect = null;
		
		// Arc drawing
		this.arcPoints = []; // Collect 3 points for arc
		this.tempArcMarkers = [];
		
		// Curve drawing
		this.curveState = 'idle'; // idle, placed-start, placed-end, adjusting
		this.curveStart = null;
		this.curveEnd = null;
		this.curveCP1 = null;
		this.curveCP2 = null;
		this.tempCurveHandles = [];
		
		// Calibration
		this.isCalibrating = false;
		this.calibrationLine = null;
		this.calibrationStart = null;
		
		// Patron counter
		this.patronCount = 0;
	}
	
	// ---- Tool delegation from main app ----
	setTool(tool) {
		// Only cancel drawing if switching to a non-drawing tool
		// When switching between drawing tools (line/curve/arc), preserve the current path
		const drawingTools = ['line', 'curve', 'arc'];
		const wasDrawingTool = drawingTools.includes(this.state.activeTool);
		const isDrawingTool = drawingTools.includes(tool);
		
		if (this.isDrawing && wasDrawingTool && isDrawingTool) {
			// Switching between drawing tools — keep the path, just clean up temp previews
			if (this.tempLine) { this.canvas.remove(this.tempLine); this.tempLine = null; }
			if (this.tempCurve) { this.canvas.remove(this.tempCurve); this.tempCurve = null; }
			this.tempCurveHandles.forEach(h => this.canvas.remove(h));
			this.tempCurveHandles = [];
			this.tempArcMarkers.forEach(m => this.canvas.remove(m));
			this.tempArcMarkers = [];
			
			// Reset sub-tool state without clearing the path
			this.curveState = 'idle';
			this.curveStart = this.currentPath.length > 0 ? this.currentPath[this.currentPath.length - 1] : null;
			this.curveEnd = null;
			this.arcPoints = [];
			this.rectStart = null;
			
			this.canvas.renderAll();
		} else if (!isDrawingTool && tool !== 'select') {
			// Switching to a non-drawing, non-select tool — cancel
			this.cancelDrawing();
		}
		// If switching to 'select' while drawing, keep the path visible
		// (user might want to inspect, then come back to drawing)
		// If switching to 'rect', cancel since rect creates its own patron directly
		if (tool === 'rect') {
			this.cancelDrawing();
		}
	}
	
	handleMouseDown(opt) {
		const tool = this.state.activeTool;
		if (tool === 'select' || tool === 'pan') return;
		
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
		if (tool === 'select' || tool === 'pan') return;
		
		const pointer = this.canvas.getPointer(opt.e);
		const point = this.snapPoint(pointer);
		
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
	// Snap to grid
	// ============================================================
	snapPoint(point) {
		if (!this.state.snapEnabled) return { x: point.x, y: point.y };
		
		const gridSize = this.state.pxPerCm; // Snap to 1cm grid
		return {
			x: Math.round(point.x / gridSize) * gridSize,
			y: Math.round(point.y / gridSize) * gridSize,
		};
	}
	
	// ============================================================
	// LINE TOOL
	// ============================================================
	handleLineClick(point, event) {
		// Check for double-click to close path
		const now = Date.now();
		if (this._lastClickTime && (now - this._lastClickTime) < 350 && this.currentPath.length >= 3) {
			this.closePath();
			this._lastClickTime = 0;
			return;
		}
		this._lastClickTime = now;
		
		if (!this.isDrawing) {
			// Start new path
			this.isDrawing = true;
			this.currentPath.push(point);
			this.addAnchorPoint(point);
			document.getElementById('status-info').textContent = 'Cliquez pour ajouter des points. Double-clic ou "Fermer" pour créer le patron.';
		} else {
			// Constrain to angles if Shift held
			const constrainedPoint = event.shiftKey 
				? this.constrainAngle(this.currentPath[this.currentPath.length - 1], point) 
				: point;
			
			// Add line segment
			const lastPoint = this.currentPath[this.currentPath.length - 1];
			const line = new fabric.Line(
				[lastPoint.x, lastPoint.y, constrainedPoint.x, constrainedPoint.y],
				{
					stroke: '#333',
					strokeWidth: 2 / this.canvas.getZoom(),
					selectable: false,
					evented: false,
					_isPathSegment: true,
				}
			);
			this.canvas.add(line);
			this.currentSegments.push(line);
			this.currentPath.push(constrainedPoint);
			this.addAnchorPoint(constrainedPoint);
			
			// Enable close path button
			if (this.currentPath.length >= 3) {
				document.getElementById('btn-close-path').disabled = false;
				document.getElementById('status-info').textContent = `${this.currentPath.length} points. Double-clic ou "Fermer" pour créer le patron. Changez d'outil (C/A) pour ajouter des courbes.`;
			}
		}
		
		this.canvas.renderAll();
	}
	
	updateLinePreview(point, event) {
		if (!this.isDrawing || this.currentPath.length === 0) return;
		
		const lastPoint = this.currentPath[this.currentPath.length - 1];
		const constrainedPoint = event?.shiftKey 
			? this.constrainAngle(lastPoint, point) 
			: point;
		
		// Remove old preview
		if (this.tempLine) {
			this.canvas.remove(this.tempLine);
		}
		
		this.tempLine = new fabric.Line(
			[lastPoint.x, lastPoint.y, constrainedPoint.x, constrainedPoint.y],
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
	// CURVE TOOL (Quadratic Bézier - simplified)
	// ============================================================
	handleCurveClick(point, event) {
		if (this.curveState === 'idle') {
			// First click: start point
			if (!this.isDrawing) {
				// Brand new path — use click position as start
				this.isDrawing = true;
				this.currentPath.push(point);
				this.addAnchorPoint(point);
				this.curveStart = point;
			} else {
				// Continuing an existing path — start from the last point
				this.curveStart = this.currentPath[this.currentPath.length - 1];
			}
			this.curveState = 'placed-start';
		} else if (this.curveState === 'placed-start') {
			// Second click: end point
			const constrainedPoint = event.shiftKey 
				? this.constrainAngle(this.curveStart, point) 
				: point;
			this.curveEnd = constrainedPoint;
			this.curveState = 'adjusting';
			
			// Show control point hint
			this.state._statusHint = 'Cliquez pour placer le point de contrôle de la courbe';
			document.getElementById('status-info').textContent = 'Cliquez pour placer le point de contrôle';
		} else if (this.curveState === 'adjusting') {
			// Third click: control point - finalize curve
			const cp = point;
			
			// Create quadratic bezier path
			const pathStr = `M ${this.curveStart.x} ${this.curveStart.y} Q ${cp.x} ${cp.y} ${this.curveEnd.x} ${this.curveEnd.y}`;
			const curvePath = new fabric.Path(pathStr, {
				fill: '',
				stroke: '#333',
				strokeWidth: 2 / this.canvas.getZoom(),
				selectable: false,
				evented: false,
				_isPathSegment: true,
			});
			
			this.canvas.add(curvePath);
			this.currentSegments.push(curvePath);
			this.currentPath.push(this.curveEnd);
			this.addAnchorPoint(this.curveEnd);
			
			// Clean up temp objects
			this.tempCurveHandles.forEach(h => this.canvas.remove(h));
			this.tempCurveHandles = [];
			if (this.tempCurve) {
				this.canvas.remove(this.tempCurve);
				this.tempCurve = null;
			}
			
			// Reset curve state
			this.curveState = 'idle';
			this.curveStart = this.curveEnd; // Continue from end point
			document.getElementById('status-info').textContent = '';
			
			if (this.currentPath.length >= 3) {
				document.getElementById('btn-close-path').disabled = false;
			}
			
			this.canvas.renderAll();
		}
	}
	
	updateCurvePreview(point, event) {
		if (this.curveState === 'placed-start' && this.curveStart) {
			// Preview line from start to cursor
			if (this.tempLine) this.canvas.remove(this.tempLine);
			
			const constrainedPoint = event?.shiftKey 
				? this.constrainAngle(this.curveStart, point) 
				: point;
			
			this.tempLine = new fabric.Line(
				[this.curveStart.x, this.curveStart.y, constrainedPoint.x, constrainedPoint.y],
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
		} else if (this.curveState === 'adjusting' && this.curveStart && this.curveEnd) {
			// Preview curve with control point at cursor
			if (this.tempCurve) this.canvas.remove(this.tempCurve);
			this.tempCurveHandles.forEach(h => this.canvas.remove(h));
			this.tempCurveHandles = [];
			
			const pathStr = `M ${this.curveStart.x} ${this.curveStart.y} Q ${point.x} ${point.y} ${this.curveEnd.x} ${this.curveEnd.y}`;
			this.tempCurve = new fabric.Path(pathStr, {
				fill: '',
				stroke: '#999',
				strokeWidth: 1.5 / this.canvas.getZoom(),
				strokeDashArray: [6, 4],
				selectable: false,
				evented: false,
			});
			this.canvas.add(this.tempCurve);
			
			// Draw control point handle lines
			const handleLine1 = new fabric.Line(
				[this.curveStart.x, this.curveStart.y, point.x, point.y],
				{
					stroke: '#aaa',
					strokeWidth: 0.8 / this.canvas.getZoom(),
					strokeDashArray: [3, 3],
					selectable: false,
					evented: false,
				}
			);
			const handleLine2 = new fabric.Line(
				[this.curveEnd.x, this.curveEnd.y, point.x, point.y],
				{
					stroke: '#aaa',
					strokeWidth: 0.8 / this.canvas.getZoom(),
					strokeDashArray: [3, 3],
					selectable: false,
					evented: false,
				}
			);
			const cpMarker = new fabric.Circle({
				left: point.x - 4 / this.canvas.getZoom(),
				top: point.y - 4 / this.canvas.getZoom(),
				radius: 4 / this.canvas.getZoom(),
				fill: '#e74c3c',
				stroke: '#fff',
				strokeWidth: 1 / this.canvas.getZoom(),
				selectable: false,
				evented: false,
			});
			
			this.canvas.add(handleLine1, handleLine2, cpMarker);
			this.tempCurveHandles.push(handleLine1, handleLine2, cpMarker);
			
			this.canvas.renderAll();
		}
	}
	
	// ============================================================
	// ARC TOOL (3-point arc)
	// ============================================================
	handleArcClick(point, event) {
		if (this.arcPoints.length === 0 && this.isDrawing && this.currentPath.length > 0) {
			// Continuing an existing path — use last point as arc start
			const lastPoint = this.currentPath[this.currentPath.length - 1];
			this.arcPoints.push(lastPoint);
			// Don't add a marker for the implicit start point, go straight to asking for point 2
			document.getElementById('status-info').textContent = 'Point 2/3 : cliquez sur un point de l\'arc';
		}
		
		this.arcPoints.push(point);
		
		// Add marker
		const marker = new fabric.Circle({
			left: point.x - 4 / this.canvas.getZoom(),
			top: point.y - 4 / this.canvas.getZoom(),
			radius: 4 / this.canvas.getZoom(),
			fill: '#e74c3c',
			stroke: '#fff',
			strokeWidth: 1 / this.canvas.getZoom(),
			selectable: false,
			evented: false,
		});
		this.canvas.add(marker);
		this.tempArcMarkers.push(marker);
		
		if (this.arcPoints.length === 1) {
			if (!this.isDrawing) {
				this.isDrawing = true;
				this.currentPath.push(point);
				this.addAnchorPoint(point);
			}
			document.getElementById('status-info').textContent = 'Point 2/3 : cliquez sur un point de l\'arc';
		} else if (this.arcPoints.length === 2) {
			document.getElementById('status-info').textContent = 'Point 3/3 : cliquez sur le point final';
		} else if (this.arcPoints.length === 3) {
			// Create arc from 3 points
			const [p1, p2, p3] = this.arcPoints;
			
			// Calculate quadratic bezier control point from 3 points
			// The middle point should be on the curve, so we need to find CP
			// For a quadratic bezier: B(0.5) = 0.25*P0 + 0.5*CP + 0.25*P2 = P1
			// So CP = 2*P1 - 0.5*P0 - 0.5*P2
			const cp = {
				x: 2 * p2.x - 0.5 * p1.x - 0.5 * p3.x,
				y: 2 * p2.y - 0.5 * p1.y - 0.5 * p3.y,
			};
			
			const pathStr = `M ${p1.x} ${p1.y} Q ${cp.x} ${cp.y} ${p3.x} ${p3.y}`;
			const arcPath = new fabric.Path(pathStr, {
				fill: '',
				stroke: '#333',
				strokeWidth: 2 / this.canvas.getZoom(),
				selectable: false,
				evented: false,
				_isPathSegment: true,
			});
			
			this.canvas.add(arcPath);
			this.currentSegments.push(arcPath);
			this.currentPath.push(p3);
			this.addAnchorPoint(p3);
			
			// Clean up
			this.tempArcMarkers.forEach(m => this.canvas.remove(m));
			this.tempArcMarkers = [];
			this.arcPoints = [];
			document.getElementById('status-info').textContent = '';
			
			if (this.currentPath.length >= 3) {
				document.getElementById('btn-close-path').disabled = false;
			}
			
			this.canvas.renderAll();
		}
	}
	
	updateArcPreview(point) {
		// Show preview line from last arc point to cursor
		if (this.arcPoints.length > 0 && this.arcPoints.length < 3) {
			if (this.tempLine) this.canvas.remove(this.tempLine);
			
			const lastPoint = this.arcPoints[this.arcPoints.length - 1];
			this.tempLine = new fabric.Line(
				[lastPoint.x, lastPoint.y, point.x, point.y],
				{
					stroke: '#999',
					strokeWidth: 1.5 / this.canvas.getZoom(),
					strokeDashArray: [6, 4],
					selectable: false,
					evented: false,
				}
			);
			this.canvas.add(this.tempLine);
			
			// If we have 2 points, show arc preview
			if (this.arcPoints.length === 2) {
				if (this.tempCurve) this.canvas.remove(this.tempCurve);
				
				const [p1, p2] = this.arcPoints;
				const p3 = point;
				const cp = {
					x: 2 * p2.x - 0.5 * p1.x - 0.5 * p3.x,
					y: 2 * p2.y - 0.5 * p1.y - 0.5 * p3.y,
				};
				
				const pathStr = `M ${p1.x} ${p1.y} Q ${cp.x} ${cp.y} ${p3.x} ${p3.y}`;
				this.tempCurve = new fabric.Path(pathStr, {
					fill: '',
					stroke: '#999',
					strokeWidth: 1.5 / this.canvas.getZoom(),
					strokeDashArray: [6, 4],
					selectable: false,
					evented: false,
				});
				this.canvas.add(this.tempCurve);
			}
			
			this.canvas.renderAll();
		}
	}
	
	// ============================================================
	// RECTANGLE TOOL
	// ============================================================
	handleRectStart(point, event) {
		this.rectStart = point;
		this.tempRect = new fabric.Rect({
			left: point.x,
			top: point.y,
			width: 0,
			height: 0,
			fill: 'rgba(51, 51, 51, 0.05)',
			stroke: '#333',
			strokeWidth: 2 / this.canvas.getZoom(),
			selectable: false,
			evented: false,
		});
		this.canvas.add(this.tempRect);
	}
	
	updateRectPreview(point, event) {
		if (!this.rectStart || !this.tempRect) return;
		
		let width = point.x - this.rectStart.x;
		let height = point.y - this.rectStart.y;
		
		// Shift = square
		if (event?.shiftKey) {
			const size = Math.max(Math.abs(width), Math.abs(height));
			width = Math.sign(width) * size;
			height = Math.sign(height) * size;
		}
		
		this.tempRect.set({
			left: width >= 0 ? this.rectStart.x : this.rectStart.x + width,
			top: height >= 0 ? this.rectStart.y : this.rectStart.y + height,
			width: Math.abs(width),
			height: Math.abs(height),
		});
		
		this.canvas.renderAll();
	}
	
	handleRectEnd(opt) {
		if (!this.rectStart || !this.tempRect) return;
		
		const width = this.tempRect.width;
		const height = this.tempRect.height;
		
		// Ignore tiny rectangles (accidental clicks)
		if (width < 5 && height < 5) {
			this.canvas.remove(this.tempRect);
			this.tempRect = null;
			this.rectStart = null;
			return;
		}
		
		// Convert temp rect to a patron
		this.canvas.remove(this.tempRect);
		
		this.patronCount++;
		const patronName = `Patron ${this.patronCount}`;
		
		const rect = new fabric.Rect({
			left: this.tempRect.left,
			top: this.tempRect.top,
			width: width,
			height: height,
			fill: 'rgba(100, 149, 237, 0.1)',
			stroke: '#4a90d9',
			strokeWidth: 2 / this.canvas.getZoom(),
			selectable: true,
			evented: true,
			_isPatron: true,
			_patronId: 'patron_' + Date.now(),
			_patronName: patronName,
			cornerColor: '#4a90d9',
			cornerStyle: 'circle',
			cornerSize: 8,
			transparentCorners: false,
			borderColor: '#4a90d9',
		});
		
		this.canvas.add(rect);
		this.canvas.setActiveObject(rect);
		
		this.tempRect = null;
		this.rectStart = null;
		
		setActiveTool('select');
		saveHistoryState();
		showToast(`${patronName} créé`);
		
		// Update stats
		if (window.atelierModules?.stats) {
			window.atelierModules.stats.update();
		}
		
		this.canvas.renderAll();
	}
	
	// ============================================================
	// CLOSE PATH → Create Patron
	// ============================================================
	closePath() {
		if (this.currentPath.length < 3) {
			showToast('Il faut au moins 3 points pour fermer un contour');
			return;
		}
		
		// Build SVG path string from all segments
		let pathStr = `M ${this.currentPath[0].x} ${this.currentPath[0].y}`;
		
		// For each segment, check if it's a line or curve
		for (let i = 0; i < this.currentSegments.length; i++) {
			const seg = this.currentSegments[i];
			if (seg.type === 'line') {
				pathStr += ` L ${seg.x2} ${seg.y2}`;
			} else if (seg.type === 'path') {
				// Extract the path data after the M command
				const pathData = seg.path;
				// Skip the M command, take the rest
				for (let j = 1; j < pathData.length; j++) {
					const cmd = pathData[j];
					pathStr += ` ${cmd.join(' ')}`;
				}
			}
		}
		
		// Close the path
		pathStr += ' Z';
		
		// Remove temporary drawing objects
		this.currentSegments.forEach(s => this.canvas.remove(s));
		this.currentPoints.forEach(p => this.canvas.remove(p));
		if (this.tempLine) { this.canvas.remove(this.tempLine); this.tempLine = null; }
		
		// Create patron
		this.patronCount++;
		const patronName = `Patron ${this.patronCount}`;
		
		const patronPath = new fabric.Path(pathStr, {
			fill: 'rgba(100, 149, 237, 0.1)',
			stroke: '#4a90d9',
			strokeWidth: 2 / this.canvas.getZoom(),
			selectable: true,
			evented: true,
			_isPatron: true,
			_patronId: 'patron_' + Date.now(),
			_patronName: patronName,
			cornerColor: '#4a90d9',
			cornerStyle: 'circle',
			cornerSize: 8,
			transparentCorners: false,
			borderColor: '#4a90d9',
		});
		
		this.canvas.add(patronPath);
		this.canvas.setActiveObject(patronPath);
		
		// Reset drawing state
		this.currentPath = [];
		this.currentSegments = [];
		this.currentPoints = [];
		this.isDrawing = false;
		this.curveState = 'idle';
		
		document.getElementById('btn-close-path').disabled = true;
		document.getElementById('status-info').textContent = '';
		
		setActiveTool('select');
		saveHistoryState();
		showToast(`${patronName} créé`);
		
		if (window.atelierModules?.stats) {
			window.atelierModules.stats.update();
		}
		
		this.canvas.renderAll();
	}
	
	// ============================================================
	// CANCEL DRAWING
	// ============================================================
	cancelDrawing() {
		// Remove all temporary objects
		this.currentSegments.forEach(s => this.canvas.remove(s));
		this.currentPoints.forEach(p => this.canvas.remove(p));
		this.tempArcMarkers.forEach(m => this.canvas.remove(m));
		this.tempCurveHandles.forEach(h => this.canvas.remove(h));
		
		if (this.tempLine) { this.canvas.remove(this.tempLine); this.tempLine = null; }
		if (this.tempCurve) { this.canvas.remove(this.tempCurve); this.tempCurve = null; }
		if (this.tempRect) { this.canvas.remove(this.tempRect); this.tempRect = null; }
		if (this.calibrationLine) { this.canvas.remove(this.calibrationLine); this.calibrationLine = null; }
		
		this.currentPath = [];
		this.currentSegments = [];
		this.currentPoints = [];
		this.arcPoints = [];
		this.tempArcMarkers = [];
		this.tempCurveHandles = [];
		this.isDrawing = false;
		this.rectStart = null;
		this.curveState = 'idle';
		this.curveStart = null;
		this.curveEnd = null;
		this.isCalibrating = false;
		this.calibrationStart = null;
		
		document.getElementById('btn-close-path').disabled = true;
		document.getElementById('status-info').textContent = '';
		
		this.canvas.renderAll();
	}
	
	// ============================================================
	// ANCHOR POINTS (visual markers)
	// ============================================================
	addAnchorPoint(point) {
		const zoom = this.canvas.getZoom();
		const size = 5 / zoom;
		
		const anchor = new fabric.Rect({
			left: point.x - size,
			top: point.y - size,
			width: size * 2,
			height: size * 2,
			fill: '#fff',
			stroke: '#4a90d9',
			strokeWidth: 1.5 / zoom,
			selectable: false,
			evented: false,
			_isAnchor: true,
		});
		
		this.canvas.add(anchor);
		this.currentPoints.push(anchor);
	}
	
	// ============================================================
	// ANGLE CONSTRAINT (Shift key)
	// ============================================================
	constrainAngle(from, to) {
		const dx = to.x - from.x;
		const dy = to.y - from.y;
		const angle = Math.atan2(dy, dx);
		const dist = Math.sqrt(dx * dx + dy * dy);
		
		// Snap to nearest 45° increment
		const snappedAngle = Math.round(angle / (Math.PI / 4)) * (Math.PI / 4);
		
		return {
			x: from.x + dist * Math.cos(snappedAngle),
			y: from.y + dist * Math.sin(snappedAngle),
		};
	}
	
	// ============================================================
	// CALIBRATION
	// ============================================================
	startCalibration() {
		this.cancelDrawing();
		this.isCalibrating = true;
		this.calibrationStart = null;
		
		document.getElementById('status-info').textContent = 'Calibration : tracez une ligne sur la photo dont vous connaissez la mesure';
		showToast('Cliquez sur deux points de la photo pour calibrer l\'échelle');
	}
	
	handleCalibrationClick(point) {
		if (!this.calibrationStart) {
			this.calibrationStart = point;
			
			// Add start marker
			const marker = new fabric.Circle({
				left: point.x - 5,
				top: point.y - 5,
				radius: 5,
				fill: '#e74c3c',
				stroke: '#fff',
				strokeWidth: 2,
				selectable: false,
				evented: false,
			});
			this.canvas.add(marker);
			this.tempArcMarkers.push(marker);
			
			document.getElementById('status-info').textContent = 'Cliquez sur le deuxième point';
		} else {
			// Calculate pixel distance
			const dx = point.x - this.calibrationStart.x;
			const dy = point.y - this.calibrationStart.y;
			const pxDist = Math.sqrt(dx * dx + dy * dy);
			
			// Ask user for real measurement
			const realCm = prompt('Quelle est la mesure réelle de cette ligne en centimètres ?');
			if (realCm && !isNaN(parseFloat(realCm)) && parseFloat(realCm) > 0) {
				const newPxPerCm = pxDist / parseFloat(realCm);
				this.state.pxPerCm = newPxPerCm;
				
				drawGrid();
				showToast(`Échelle calibrée : 1 cm = ${Math.round(newPxPerCm)} pixels`);
			}
			
			// Clean up
			this.tempArcMarkers.forEach(m => this.canvas.remove(m));
			this.tempArcMarkers = [];
			if (this.calibrationLine) {
				this.canvas.remove(this.calibrationLine);
				this.calibrationLine = null;
			}
			
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
			{
				stroke: '#e74c3c',
				strokeWidth: 2,
				strokeDashArray: [6, 3],
				selectable: false,
				evented: false,
			}
		);
		this.canvas.add(this.calibrationLine);
		
		// Show distance in status
		const dx = point.x - this.calibrationStart.x;
		const dy = point.y - this.calibrationStart.y;
		const pxDist = Math.sqrt(dx * dx + dy * dy);
		const cmDist = (pxDist / this.state.pxPerCm).toFixed(1);
		document.getElementById('status-info').textContent = `Distance : ${cmDist} cm (actuelle)`;
		
		this.canvas.renderAll();
	}
}
