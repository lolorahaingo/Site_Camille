// ============================================================
// PeltManager — Fur pelt library and strip creation
// ============================================================

import { saveHistoryState, showToast } from '../atelier.js';

export class PeltManager {
	constructor(canvas, state) {
		this.canvas = canvas;
		this.state = state;
		this.pelts = [];
		this.currentPelt = null;
		this.currentSize = null;
		
		this.init();
	}
	
	async init() {
		await this.loadPelts();
		this.bindUI();
	}
	
	// ============================================================
	// Load pelt data
	// ============================================================
	async loadPelts() {
		try {
			const response = await fetch('./data/pelts.json');
			this.pelts = await response.json();
			this.populateTypeDropdown();
		} catch (e) {
			console.error('Failed to load pelts data:', e);
			showToast('Erreur de chargement des données de peaux');
		}
	}
	
	// ============================================================
	// UI Population
	// ============================================================
	populateTypeDropdown() {
		const select = document.getElementById('pelt-type');
		select.innerHTML = this.pelts.map(p => 
			`<option value="${p.id}">${p.name}</option>`
		).join('');
		
		// Trigger initial selection
		this.onTypeChange();
	}
	
	populateSizeDropdown(pelt) {
		const select = document.getElementById('pelt-size');
		select.innerHTML = pelt.sizes.map((s, i) => 
			`<option value="${i}">${s.label} (${s.length_cm} × ${s.width_cm} cm)</option>`
		).join('');
		
		this.onSizeChange();
	}
	
	// ============================================================
	// UI Event Handlers
	// ============================================================
	bindUI() {
		document.getElementById('pelt-type').addEventListener('change', () => this.onTypeChange());
		document.getElementById('pelt-size').addEventListener('change', () => this.onSizeChange());
		document.getElementById('btn-add-strips').addEventListener('click', () => this.addStrips());
	}
	
	onTypeChange() {
		const typeId = document.getElementById('pelt-type').value;
		this.currentPelt = this.pelts.find(p => p.id === typeId);
		
		if (this.currentPelt) {
			this.populateSizeDropdown(this.currentPelt);
			
			// Update color preview
			document.getElementById('pelt-color-preview').style.background = this.currentPelt.color;
			
			// Update default strip width
			document.getElementById('strip-width').value = this.currentPelt.defaultStripWidth_mm;
		}
	}
	
	onSizeChange() {
		const sizeIndex = parseInt(document.getElementById('pelt-size').value);
		if (this.currentPelt && this.currentPelt.sizes[sizeIndex]) {
			this.currentSize = this.currentPelt.sizes[sizeIndex];
			
			// Update strip length to pelt length
			document.getElementById('strip-length').value = this.currentSize.length_cm;
		}
	}
	
	// ============================================================
	// Strip Creation
	// ============================================================
	addStrips() {
		const stripWidthMm = parseFloat(document.getElementById('strip-width').value);
		const stripLengthCm = parseFloat(document.getElementById('strip-length').value);
		const count = parseInt(document.getElementById('strip-count').value) || 1;
		
		if (isNaN(stripWidthMm) || isNaN(stripLengthCm) || stripWidthMm <= 0 || stripLengthCm <= 0) {
			showToast('Veuillez entrer des dimensions valides');
			return;
		}
		
		// Convert to pixels
		const widthPx = (stripWidthMm / 10) * this.state.pxPerCm; // mm to cm to px
		const lengthPx = stripLengthCm * this.state.pxPerCm;
		
		// Find a good starting position (near center of visible area)
		const vpt = this.canvas.viewportTransform;
		const zoom = this.canvas.getZoom();
		const canvasW = this.canvas.getWidth();
		const canvasH = this.canvas.getHeight();
		
		// Center of visible area in canvas coordinates
		const centerX = (canvasW / 2 - vpt[4]) / zoom;
		const centerY = (canvasH / 2 - vpt[5]) / zoom;
		
		const peltColor = this.currentPelt ? this.currentPelt.color : '#888888';
		const peltName = this.currentPelt ? this.currentPelt.name : 'Personnalisé';
		const sizeName = this.currentSize ? this.currentSize.label : '';
		
		for (let i = 0; i < count; i++) {
			// Offset each strip slightly so they don't stack exactly
			const offsetX = i * (widthPx + 4);
			
			const strip = this.createStrip({
				x: centerX + offsetX - (count * widthPx) / 2,
				y: centerY - lengthPx / 2,
				width: widthPx,
				height: lengthPx,
				color: peltColor,
				peltName: peltName,
				sizeName: sizeName,
				stripWidthMm: stripWidthMm,
				stripLengthCm: stripLengthCm,
			});
			
			this.canvas.add(strip);
		}
		
		this.canvas.renderAll();
		saveHistoryState();
		
		const label = count > 1 ? `${count} bandes ajoutées` : 'Bande ajoutée';
		showToast(`${label} (${peltName} ${sizeName})`);
		
		// Update stats
		if (window.atelierModules?.stats) {
			window.atelierModules.stats.update();
		}
	}
	
	createStrip({ x, y, width, height, color, peltName, sizeName, stripWidthMm, stripLengthCm }) {
		// Create the strip rectangle
		const strip = new fabric.Rect({
			left: x,
			top: y,
			width: width,
			height: height,
			fill: this.hexToRgba(color, 0.35),
			stroke: color,
			strokeWidth: 1.5 / this.canvas.getZoom(),
			selectable: true,
			evented: true,
			_isStrip: true,
			_stripData: {
				peltName,
				sizeName,
				stripWidthMm,
				stripLengthCm,
				color,
			},
			cornerColor: color,
			cornerStyle: 'circle',
			cornerSize: 7,
			transparentCorners: false,
			borderColor: color,
			hasRotatingPoint: true,
			rotatingPointOffset: 20,
		});
		
		// Add fur direction arrow
		this.addFurArrow(strip);
		
		return strip;
	}
	
	addFurArrow(strip) {
		// We'll draw the arrow as part of the strip's rendering
		// Using Fabric.js custom rendering via object.on('after:render')
		strip.on('after:render', (opt) => {
			const ctx = opt.ctx || this.canvas.getElement().getContext('2d');
			if (!ctx) return;
			
			const center = strip.getCenterPoint();
			const zoom = this.canvas.getZoom();
			const vpt = this.canvas.viewportTransform;
			
			// Transform to screen coordinates
			const screenX = center.x * zoom + vpt[4];
			const screenY = center.y * zoom + vpt[5];
			
			const angle = (strip.angle || 0) * Math.PI / 180;
			const arrowLength = Math.min(strip.height * strip.scaleY * zoom * 0.3, 20);
			
			ctx.save();
			ctx.translate(screenX, screenY);
			ctx.rotate(angle);
			
			// Draw arrow pointing up (default fur direction)
			ctx.beginPath();
			ctx.moveTo(0, arrowLength / 2);
			ctx.lineTo(0, -arrowLength / 2);
			ctx.strokeStyle = strip._stripData?.color || '#666';
			ctx.lineWidth = 1.5;
			ctx.stroke();
			
			// Arrow head
			ctx.beginPath();
			ctx.moveTo(-4, -arrowLength / 2 + 6);
			ctx.lineTo(0, -arrowLength / 2);
			ctx.lineTo(4, -arrowLength / 2 + 6);
			ctx.strokeStyle = strip._stripData?.color || '#666';
			ctx.lineWidth = 1.5;
			ctx.stroke();
			
			ctx.restore();
		});
	}
	
	// ============================================================
	// Utility
	// ============================================================
	hexToRgba(hex, alpha) {
		const r = parseInt(hex.slice(1, 3), 16);
		const g = parseInt(hex.slice(3, 5), 16);
		const b = parseInt(hex.slice(5, 7), 16);
		return `rgba(${r}, ${g}, ${b}, ${alpha})`;
	}
}
