// ============================================================
// PlacementEngine — Strip placement, snapping, and validation
// ============================================================

import { updateStats } from '../atelier.js';

export class PlacementEngine {
	constructor(canvas, state) {
		this.canvas = canvas;
		this.state = state;
		this.snapThreshold = 6; // pixels - magnetic snap distance
	}
	
	// ============================================================
	// Event handlers (called from main app)
	// ============================================================
	handleObjectMoving(opt) {
		const obj = opt.target;
		if (!obj || !obj._isStrip) return;
		
		// Magnetic snapping to other strips
		if (this.state.snapEnabled) {
			this.snapToNearbyStrips(obj);
		}
		
		// Check if strip is inside any patron
		this.validateStripPlacement(obj);
		
		// Update stats in real-time
		updateStats();
	}
	
	handleObjectModified(opt) {
		const obj = opt.target;
		if (!obj) return;
		
		if (obj._isStrip) {
			this.validateStripPlacement(obj);
		}
		
		updateStats();
	}
	
	handleSelectionChange(opt) {
		// Could highlight the patron that contains the selected strip
	}
	
	// ============================================================
	// Magnetic Snapping
	// ============================================================
	snapToNearbyStrips(movingStrip) {
		const strips = this.canvas.getObjects().filter(o => 
			o._isStrip && o !== movingStrip
		);
		
		if (strips.length === 0) return;
		
		const movingBounds = this.getRotatedBounds(movingStrip);
		let snappedX = false;
		let snappedY = false;
		
		for (const strip of strips) {
			const targetBounds = this.getRotatedBounds(strip);
			
			// Check horizontal snapping (left/right edges)
			// Moving strip's right edge to target's left edge
			const rightToLeft = Math.abs(movingBounds.right - targetBounds.left);
			if (rightToLeft < this.snapThreshold && !snappedX) {
				movingStrip.set('left', movingStrip.left - (movingBounds.right - targetBounds.left));
				snappedX = true;
			}
			
			// Moving strip's left edge to target's right edge
			const leftToRight = Math.abs(movingBounds.left - targetBounds.right);
			if (leftToRight < this.snapThreshold && !snappedX) {
				movingStrip.set('left', movingStrip.left + (targetBounds.right - movingBounds.left));
				snappedX = true;
			}
			
			// Moving strip's left edge to target's left edge (alignment)
			const leftToLeft = Math.abs(movingBounds.left - targetBounds.left);
			if (leftToLeft < this.snapThreshold && !snappedX) {
				movingStrip.set('left', movingStrip.left + (targetBounds.left - movingBounds.left));
				snappedX = true;
			}
			
			// Check vertical snapping (top/bottom edges)
			// Moving strip's bottom edge to target's top edge
			const bottomToTop = Math.abs(movingBounds.bottom - targetBounds.top);
			if (bottomToTop < this.snapThreshold && !snappedY) {
				movingStrip.set('top', movingStrip.top - (movingBounds.bottom - targetBounds.top));
				snappedY = true;
			}
			
			// Moving strip's top edge to target's bottom edge
			const topToBottom = Math.abs(movingBounds.top - targetBounds.bottom);
			if (topToBottom < this.snapThreshold && !snappedY) {
				movingStrip.set('top', movingStrip.top + (targetBounds.bottom - movingBounds.top));
				snappedY = true;
			}
			
			// Moving strip's top edge to target's top edge (alignment)
			const topToTop = Math.abs(movingBounds.top - targetBounds.top);
			if (topToTop < this.snapThreshold && !snappedY) {
				movingStrip.set('top', movingStrip.top + (targetBounds.top - movingBounds.top));
				snappedY = true;
			}
			
			if (snappedX && snappedY) break;
		}
		
		// Also snap to grid if enabled
		if (this.state.snapEnabled) {
			const gridSize = this.state.pxPerCm; // 1cm grid
			if (!snappedX) {
				const snappedLeft = Math.round(movingStrip.left / gridSize) * gridSize;
				if (Math.abs(snappedLeft - movingStrip.left) < this.snapThreshold) {
					movingStrip.set('left', snappedLeft);
				}
			}
			if (!snappedY) {
				const snappedTop = Math.round(movingStrip.top / gridSize) * gridSize;
				if (Math.abs(snappedTop - movingStrip.top) < this.snapThreshold) {
					movingStrip.set('top', snappedTop);
				}
			}
		}
	}
	
	// ============================================================
	// Strip Placement Validation
	// ============================================================
	validateStripPlacement(strip) {
		const patrons = this.canvas.getObjects().filter(o => o._isPatron);
		
		if (patrons.length === 0) {
			// No patrons — no validation needed
			this.setStripValid(strip, true);
			return;
		}
		
		// Check if strip corners are inside any patron
		const corners = this.getStripCorners(strip);
		let isInside = false;
		let isPartial = false;
		
		for (const patron of patrons) {
			const cornersInside = corners.map(c => this.isPointInObject(c, patron));
			const allInside = cornersInside.every(v => v);
			const someInside = cornersInside.some(v => v);
			
			if (allInside) {
				isInside = true;
				break;
			} else if (someInside) {
				isPartial = true;
			}
		}
		
		if (isInside) {
			this.setStripValid(strip, true);
		} else if (isPartial) {
			this.setStripPartial(strip);
		} else {
			this.setStripValid(strip, false);
		}
	}
	
	setStripValid(strip, valid) {
		const color = strip._stripData?.color || '#888';
		if (valid) {
			strip.set({
				stroke: color,
				strokeWidth: 1.5 / this.canvas.getZoom(),
				shadow: null,
			});
		} else {
			strip.set({
				stroke: color,
				strokeWidth: 1.5 / this.canvas.getZoom(),
				shadow: null,
			});
		}
		strip._isValid = valid;
	}
	
	setStripPartial(strip) {
		strip.set({
			stroke: '#e74c3c',
			strokeWidth: 2.5 / this.canvas.getZoom(),
			shadow: new fabric.Shadow({
				color: 'rgba(231, 76, 60, 0.3)',
				blur: 8,
			}),
		});
		strip._isValid = false;
	}
	
	// ============================================================
	// Collision Detection
	// ============================================================
	checkCollisions() {
		const strips = this.canvas.getObjects().filter(o => o._isStrip);
		
		// Reset collision state
		strips.forEach(s => { s._hasCollision = false; });
		
		for (let i = 0; i < strips.length; i++) {
			for (let j = i + 1; j < strips.length; j++) {
				if (this.doStripsOverlap(strips[i], strips[j])) {
					strips[i]._hasCollision = true;
					strips[j]._hasCollision = true;
				}
			}
		}
		
		// Visual feedback for collisions
		strips.forEach(strip => {
			if (strip._hasCollision) {
				strip.set({
					stroke: '#e74c3c',
					strokeWidth: 2.5 / this.canvas.getZoom(),
				});
			} else if (strip._isValid !== false) {
				const color = strip._stripData?.color || '#888';
				strip.set({
					stroke: color,
					strokeWidth: 1.5 / this.canvas.getZoom(),
				});
			}
		});
	}
	
	doStripsOverlap(strip1, strip2) {
		// Simple AABB overlap check (works well for non-rotated or similarly-rotated strips)
		const b1 = this.getRotatedBounds(strip1);
		const b2 = this.getRotatedBounds(strip2);
		
		// Add small tolerance to avoid false positives from adjacent strips
		const tolerance = 1;
		
		return !(
			b1.right - tolerance <= b2.left ||
			b2.right - tolerance <= b1.left ||
			b1.bottom - tolerance <= b2.top ||
			b2.bottom - tolerance <= b1.top
		);
	}
	
	// ============================================================
	// Geometry Helpers
	// ============================================================
	getRotatedBounds(obj) {
		const br = obj.getBoundingRect();
		return {
			left: br.left,
			top: br.top,
			right: br.left + br.width,
			bottom: br.top + br.height,
			width: br.width,
			height: br.height,
		};
	}
	
	getStripCorners(strip) {
		// Get the 4 corners of the strip in canvas coordinates
		const coords = strip.getCoords(); // Returns array of 4 points [tl, tr, br, bl]
		return coords.map(p => ({ x: p.x, y: p.y }));
	}
	
	isPointInObject(point, obj) {
		// Check if a point is inside a Fabric.js object
		if (obj.type === 'rect') {
			return this.isPointInRect(point, obj);
		} else if (obj.type === 'path') {
			return this.isPointInPath(point, obj);
		}
		
		// Fallback: use bounding rect
		const br = obj.getBoundingRect();
		return (
			point.x >= br.left &&
			point.x <= br.left + br.width &&
			point.y >= br.top &&
			point.y <= br.top + br.height
		);
	}
	
	isPointInRect(point, rect) {
		// For rotated rectangles, transform point to rect's local coordinate system
		const center = rect.getCenterPoint();
		const angle = -(rect.angle || 0) * Math.PI / 180;
		
		// Rotate point around rect center
		const dx = point.x - center.x;
		const dy = point.y - center.y;
		const localX = dx * Math.cos(angle) - dy * Math.sin(angle);
		const localY = dx * Math.sin(angle) + dy * Math.cos(angle);
		
		const halfW = (rect.width * rect.scaleX) / 2;
		const halfH = (rect.height * rect.scaleY) / 2;
		
		return (
			localX >= -halfW &&
			localX <= halfW &&
			localY >= -halfH &&
			localY <= halfH
		);
	}
	
	isPointInPath(point, pathObj) {
		// Use canvas 2D context isPointInPath for complex shapes
		// We need to use a temporary canvas for hit testing
		const tempCanvas = document.createElement('canvas');
		tempCanvas.width = this.canvas.getWidth();
		tempCanvas.height = this.canvas.getHeight();
		const ctx = tempCanvas.getContext('2d');
		
		// Build the path
		const pathData = pathObj.path;
		if (!pathData) return false;
		
		const zoom = this.canvas.getZoom();
		const vpt = this.canvas.viewportTransform;
		
		ctx.save();
		ctx.setTransform(zoom, 0, 0, zoom, vpt[4], vpt[5]);
		
		// Apply object transform
		const center = pathObj.getCenterPoint();
		ctx.translate(center.x, center.y);
		ctx.rotate((pathObj.angle || 0) * Math.PI / 180);
		ctx.scale(pathObj.scaleX || 1, pathObj.scaleY || 1);
		ctx.translate(-center.x, -center.y);
		ctx.translate(pathObj.left, pathObj.top);
		
		// Draw path
		ctx.beginPath();
		for (const cmd of pathData) {
			switch (cmd[0]) {
				case 'M': ctx.moveTo(cmd[1], cmd[2]); break;
				case 'L': ctx.lineTo(cmd[1], cmd[2]); break;
				case 'Q': ctx.quadraticCurveTo(cmd[1], cmd[2], cmd[3], cmd[4]); break;
				case 'C': ctx.bezierCurveTo(cmd[1], cmd[2], cmd[3], cmd[4], cmd[5], cmd[6]); break;
				case 'Z': case 'z': ctx.closePath(); break;
			}
		}
		
		// Test point (in screen coordinates)
		const screenX = point.x * zoom + vpt[4];
		const screenY = point.y * zoom + vpt[5];
		const result = ctx.isPointInPath(screenX, screenY);
		
		ctx.restore();
		return result;
	}
	
	// ============================================================
	// Get placement statistics
	// ============================================================
	getPlacementStats() {
		const patrons = this.canvas.getObjects().filter(o => o._isPatron);
		const strips = this.canvas.getObjects().filter(o => o._isStrip);
		
		// Calculate patron area
		let patronArea = 0;
		for (const patron of patrons) {
			if (patron.type === 'rect') {
				patronArea += (patron.width * patron.scaleX) * (patron.height * patron.scaleY);
			} else if (patron.type === 'path') {
				patronArea += this.calculatePathArea(patron);
			}
		}
		
		// Calculate covered area (strips inside patrons)
		let coveredArea = 0;
		for (const strip of strips) {
			const w = strip.width * (strip.scaleX || 1);
			const h = strip.height * (strip.scaleY || 1);
			coveredArea += w * h;
		}
		
		// Convert from px² to cm²
		const pxPerCm = this.state.pxPerCm;
		const patronAreaCm2 = patronArea / (pxPerCm * pxPerCm);
		const coveredAreaCm2 = coveredArea / (pxPerCm * pxPerCm);
		const wasteAreaCm2 = Math.max(0, patronAreaCm2 - coveredAreaCm2);
		const wastePct = patronAreaCm2 > 0 ? (wasteAreaCm2 / patronAreaCm2) * 100 : 0;
		
		// Count pelts needed
		const peltCounts = {};
		for (const strip of strips) {
			const data = strip._stripData;
			if (data) {
				const key = `${data.peltName} ${data.sizeName}`;
				if (!peltCounts[key]) {
					peltCounts[key] = { count: 0, perPelt: 0, peltName: data.peltName, sizeName: data.sizeName };
					
				// Calculate how many strips fit per pelt
				// A pelt has width_cm and length_cm. Strips are cut from it.
				// Number of strips = floor(pelt_length_cm / strip_width_cm)
				peltCounts[key].perPelt = Math.max(1, Math.floor((data.stripLengthCm || 50) / (data.stripWidthMm / 10)));
				}
				peltCounts[key].count++;
			}
		}
		
		let totalPelts = 0;
		for (const key of Object.keys(peltCounts)) {
			const entry = peltCounts[key];
			totalPelts += Math.ceil(entry.count / Math.max(1, entry.perPelt));
		}
		
		return {
			patronAreaCm2: Math.round(patronAreaCm2 * 10) / 10,
			coveredAreaCm2: Math.round(coveredAreaCm2 * 10) / 10,
			wasteAreaCm2: Math.round(wasteAreaCm2 * 10) / 10,
			wastePct: Math.round(wastePct * 10) / 10,
			stripCount: strips.length,
			peltCount: totalPelts,
			peltCounts,
		};
	}
	
	calculatePathArea(pathObj) {
		// Approximate area using the shoelace formula on path points
		const pathData = pathObj.path;
		if (!pathData) return 0;
		
		// Extract points from path (approximate curves as line segments)
		const points = [];
		let currentX = 0, currentY = 0;
		
		for (const cmd of pathData) {
			switch (cmd[0]) {
				case 'M':
				case 'L':
					currentX = cmd[1];
					currentY = cmd[2];
					points.push({ x: currentX, y: currentY });
					break;
				case 'Q':
					// Approximate quadratic bezier with a few points
					for (let t = 0.25; t <= 1; t += 0.25) {
						const x = (1-t)*(1-t)*currentX + 2*(1-t)*t*cmd[1] + t*t*cmd[3];
						const y = (1-t)*(1-t)*currentY + 2*(1-t)*t*cmd[2] + t*t*cmd[4];
						points.push({ x, y });
					}
					currentX = cmd[3];
					currentY = cmd[4];
					break;
				case 'C':
					for (let t = 0.2; t <= 1; t += 0.2) {
						const x = (1-t)*(1-t)*(1-t)*currentX + 3*(1-t)*(1-t)*t*cmd[1] + 3*(1-t)*t*t*cmd[3] + t*t*t*cmd[5];
						const y = (1-t)*(1-t)*(1-t)*currentY + 3*(1-t)*(1-t)*t*cmd[2] + 3*(1-t)*t*t*cmd[4] + t*t*t*cmd[6];
						points.push({ x, y });
					}
					currentX = cmd[5];
					currentY = cmd[6];
					break;
				case 'Z':
				case 'z':
					break;
			}
		}
		
		if (points.length < 3) return 0;
		
		// Shoelace formula
		let area = 0;
		const n = points.length;
		for (let i = 0; i < n; i++) {
			const j = (i + 1) % n;
			area += points[i].x * points[j].y;
			area -= points[j].x * points[i].y;
		}
		
		// Apply object scale
		const scaleX = pathObj.scaleX || 1;
		const scaleY = pathObj.scaleY || 1;
		
		return Math.abs(area / 2) * scaleX * scaleY;
	}
}
