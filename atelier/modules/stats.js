// ============================================================
// Stats — Real-time statistics display
// ============================================================

export class Stats {
	constructor(canvas, state) {
		this.canvas = canvas;
		this.state = state;
		
		// Cache DOM elements
		this.els = {
			patronArea: document.getElementById('stat-patron-area'),
			coveredArea: document.getElementById('stat-covered-area'),
			wasteArea: document.getElementById('stat-waste-area'),
			wastePct: document.getElementById('stat-waste-pct'),
			progressBar: document.getElementById('stat-progress-bar'),
			stripCount: document.getElementById('stat-strip-count'),
			peltCount: document.getElementById('stat-pelt-count'),
		};
		
		// Throttle updates for performance
		this._updateTimeout = null;
	}
	
	update() {
		// Throttle to max 10 updates per second
		if (this._updateTimeout) return;
		
		this._updateTimeout = setTimeout(() => {
			this._updateTimeout = null;
			this._doUpdate();
		}, 100);
	}
	
	_doUpdate() {
		const engine = window.atelierModules?.placementEngine;
		if (!engine) {
			this.displayEmpty();
			return;
		}
		
		const stats = engine.getPlacementStats();
		
		// Update DOM
		this.els.patronArea.textContent = stats.patronAreaCm2 > 0 
			? `${stats.patronAreaCm2.toLocaleString('fr-FR')} cm²` 
			: '— cm²';
		
		this.els.coveredArea.textContent = stats.coveredAreaCm2 > 0 
			? `${stats.coveredAreaCm2.toLocaleString('fr-FR')} cm²` 
			: '— cm²';
		
		this.els.wasteArea.textContent = stats.patronAreaCm2 > 0 
			? `${stats.wasteAreaCm2.toLocaleString('fr-FR')} cm²` 
			: '— cm²';
		
		// Waste percentage with color coding
		const wastePctEl = this.els.wastePct;
		const highlightEl = wastePctEl.closest('.stats__item--highlight');
		
		if (stats.patronAreaCm2 > 0) {
			wastePctEl.textContent = `${stats.wastePct} %`;
			
			// Color coding
			if (highlightEl) {
				highlightEl.classList.remove('warning', 'danger');
				if (stats.wastePct > 30) {
					highlightEl.classList.add('danger');
				} else if (stats.wastePct > 20) {
					highlightEl.classList.add('warning');
				}
			}
		} else {
			wastePctEl.textContent = '— %';
			if (highlightEl) {
				highlightEl.classList.remove('warning', 'danger');
			}
		}
		
		// Progress bar (shows coverage, not waste)
		const coveragePct = stats.patronAreaCm2 > 0 
			? Math.min(100, ((stats.coveredAreaCm2 / stats.patronAreaCm2) * 100)) 
			: 0;
		
		this.els.progressBar.style.width = coveragePct + '%';
		this.els.progressBar.classList.remove('warning', 'danger');
		
		if (stats.wastePct > 30) {
			this.els.progressBar.classList.add('danger');
		} else if (stats.wastePct > 20) {
			this.els.progressBar.classList.add('warning');
		}
		
		// Strip and pelt counts
		this.els.stripCount.textContent = stats.stripCount.toString();
		this.els.peltCount.textContent = stats.peltCount.toString();
	}
	
	displayEmpty() {
		this.els.patronArea.textContent = '— cm²';
		this.els.coveredArea.textContent = '— cm²';
		this.els.wasteArea.textContent = '— cm²';
		this.els.wastePct.textContent = '— %';
		this.els.progressBar.style.width = '0%';
		this.els.stripCount.textContent = '0';
		this.els.peltCount.textContent = '0';
	}
}
