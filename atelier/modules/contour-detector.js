// ============================================================
// ContourDetector — Automatic contour detection from image
// Uses OpenCV.js (lazy-loaded from CDN)
// ============================================================

import { showToast } from '../atelier.js';

export class ContourDetector {
    constructor(canvas, state) {
        this.canvas = canvas;
        this.state = state;
        this.cvReady = false;
        this.cvLoading = false;
        this.previewObjects = []; // Fabric objects for contour preview
        this.detectedContours = []; // Array of [{points: [{x,y}...], area: number}]
        this.settings = {
            cannyLow: 50,
            cannyHigh: 150,
            minAreaCm2: 5,        // Minimum contour area in cm² to keep
            epsilon: 2,           // Douglas-Peucker simplification tolerance (pixels)
            dilateIterations: 1,  // Morphological dilation to connect broken lines
            blurSize: 5,          // Gaussian blur kernel size
        };
    }

    // ============================================================
    // OpenCV.js Lazy Loading
    // ============================================================
    async loadOpenCV() {
        if (this.cvReady) return;
        if (this.cvLoading) {
            // Wait for existing load
            return new Promise((resolve) => {
                const check = setInterval(() => {
                    if (this.cvReady) { clearInterval(check); resolve(); }
                }, 100);
            });
        }

        this.cvLoading = true;
        showToast('Chargement d\'OpenCV.js...');

        return new Promise((resolve, reject) => {
            // Check if already loaded
            if (typeof cv !== 'undefined' && cv.Mat) {
                this.cvReady = true;
                this.cvLoading = false;
                resolve();
                return;
            }

            const script = document.createElement('script');
            script.src = 'https://docs.opencv.org/4.9.0/opencv.js';
            script.async = true;

            // OpenCV.js sets up a Module object and calls onRuntimeInitialized
            window.Module = window.Module || {};
            const origOnReady = window.Module.onRuntimeInitialized;
            window.Module.onRuntimeInitialized = () => {
                if (origOnReady) origOnReady();
                this.cvReady = true;
                this.cvLoading = false;
                showToast('OpenCV.js chargé');
                resolve();
            };

            script.onerror = () => {
                this.cvLoading = false;
                showToast('Erreur de chargement d\'OpenCV.js');
                reject(new Error('Failed to load OpenCV.js'));
            };

            document.head.appendChild(script);
        });
    }

    // ============================================================
    // Image Extraction from Fabric.js canvas
    // ============================================================
    _getImageData() {
        const bgImg = this.state.backgroundImage;
        if (!bgImg) return null;

        const imgEl = bgImg.getElement();
        const w = imgEl.naturalWidth || imgEl.width;
        const h = imgEl.naturalHeight || imgEl.height;

        // Draw image to an offscreen canvas at full resolution
        const offscreen = document.createElement('canvas');
        offscreen.width = w;
        offscreen.height = h;
        const ctx = offscreen.getContext('2d');
        ctx.drawImage(imgEl, 0, 0, w, h);

        return {
            imageData: ctx.getImageData(0, 0, w, h),
            width: w,
            height: h,
            // Scale factor: how the image is scaled on the Fabric canvas
            scaleX: bgImg.scaleX,
            scaleY: bgImg.scaleY,
            left: bgImg.left,
            top: bgImg.top,
        };
    }

    // ============================================================
    // Contour Detection Pipeline
    // ============================================================
    async detect() {
        await this.loadOpenCV();

        const imgInfo = this._getImageData();
        if (!imgInfo) {
            showToast('Aucune image de calque à analyser');
            return [];
        }

        const { imageData, width, height, scaleX, scaleY, left, top } = imgInfo;

        // Create OpenCV Mat from image data
        const src = cv.matFromImageData(imageData);
        const gray = new cv.Mat();
        const blurred = new cv.Mat();
        const edges = new cv.Mat();
        const dilated = new cv.Mat();
        const hierarchy = new cv.Mat();
        const contours = new cv.MatVector();

        try {
            // 1. Convert to grayscale
            cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);

            // 2. Gaussian blur to reduce noise
            const ksize = new cv.Size(this.settings.blurSize, this.settings.blurSize);
            cv.GaussianBlur(gray, blurred, ksize, 0);

            // 3. Canny edge detection
            cv.Canny(blurred, edges, this.settings.cannyLow, this.settings.cannyHigh);

            // 4. Dilate to connect broken edges
            const kernel = cv.Mat.ones(3, 3, cv.CV_8U);
            cv.dilate(edges, dilated, kernel, new cv.Point(-1, -1), this.settings.dilateIterations);
            kernel.delete();

            // 5. Find contours
            cv.findContours(dilated, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);

            // 6. Filter and simplify contours
            const minAreaPx = this.settings.minAreaCm2 * this.state.pxPerCm * this.state.pxPerCm;
            // Adjust minArea for image-to-canvas scale
            const imgToCanvasScale = scaleX; // Assuming uniform scaling
            const minAreaImgPx = minAreaPx / (imgToCanvasScale * imgToCanvasScale);

            const results = [];

            for (let i = 0; i < contours.size(); i++) {
                const contour = contours.get(i);
                const area = cv.contourArea(contour);

                // Filter by minimum area
                if (area < minAreaImgPx) {
                    contour.delete();
                    continue;
                }

                // Simplify with Douglas-Peucker
                const approx = new cv.Mat();
                const perimeter = cv.arcLength(contour, true);
                const epsilon = this.settings.epsilon * (perimeter / 500);
                cv.approxPolyDP(contour, approx, epsilon, true);

                // Need at least 3 points for a polygon
                if (approx.rows < 3) {
                    approx.delete();
                    contour.delete();
                    continue;
                }

                // Extract points and transform to canvas coordinates
                const points = [];
                for (let j = 0; j < approx.rows; j++) {
                    const px = approx.data32S[j * 2];
                    const py = approx.data32S[j * 2 + 1];
                    // Transform from image pixels to canvas coordinates
                    points.push({
                        x: left + px * scaleX,
                        y: top + py * scaleY,
                    });
                }

                results.push({
                    points,
                    area: area * scaleX * scaleY, // area in canvas pixels²
                    areaCm2: (area * scaleX * scaleY) / (this.state.pxPerCm * this.state.pxPerCm),
                    vertexCount: points.length,
                });

                approx.delete();
                contour.delete();
            }

            // Sort by area descending (largest contours first)
            results.sort((a, b) => b.area - a.area);

            this.detectedContours = results;
            return results;

        } finally {
            src.delete();
            gray.delete();
            blurred.delete();
            edges.delete();
            dilated.delete();
            hierarchy.delete();
            contours.delete();
        }
    }

    // ============================================================
    // Preview — show detected contours as overlay on canvas
    // ============================================================
    showPreview() {
        this.clearPreview();

        for (let i = 0; i < this.detectedContours.length; i++) {
            const contour = this.detectedContours[i];
            if (contour.points.length < 3) continue;

            // Build SVG path string
            let pathStr = `M ${contour.points[0].x} ${contour.points[0].y}`;
            for (let j = 1; j < contour.points.length; j++) {
                pathStr += ` L ${contour.points[j].x} ${contour.points[j].y}`;
            }
            pathStr += ' Z';

            const previewPath = new fabric.Path(pathStr, {
                fill: 'rgba(231, 76, 60, 0.15)',
                stroke: '#e74c3c',
                strokeWidth: 2 / this.canvas.getZoom(),
                selectable: false,
                evented: false,
                _isDetectionPreview: true,
            });

            this.canvas.add(previewPath);
            this.previewObjects.push(previewPath);

            // Add vertex dots
            for (const pt of contour.points) {
                const dot = new fabric.Circle({
                    left: pt.x - 3,
                    top: pt.y - 3,
                    radius: 3,
                    fill: '#e74c3c',
                    stroke: '#fff',
                    strokeWidth: 1,
                    selectable: false,
                    evented: false,
                    _isDetectionPreview: true,
                });
                this.canvas.add(dot);
                this.previewObjects.push(dot);
            }
        }

        this.canvas.renderAll();
    }

    clearPreview() {
        for (const obj of this.previewObjects) {
            this.canvas.remove(obj);
        }
        this.previewObjects = [];
        this.canvas.renderAll();
    }

    // ============================================================
    // Update settings and re-detect
    // ============================================================
    updateSettings(newSettings) {
        Object.assign(this.settings, newSettings);
    }

    // ============================================================
    // Convert detected contours to patron Path objects
    // ============================================================
    createPatrons(patronEditor) {
        if (this.detectedContours.length === 0) {
            showToast('Aucun contour détecté');
            return;
        }

        let created = 0;
        for (const contour of this.detectedContours) {
            if (contour.points.length < 3) continue;

            // Build SVG path string
            let pathStr = `M ${contour.points[0].x} ${contour.points[0].y}`;
            for (let j = 1; j < contour.points.length; j++) {
                pathStr += ` L ${contour.points[j].x} ${contour.points[j].y}`;
            }
            pathStr += ' Z';

            // Build vertices array
            const vertices = contour.points.map(p => ({ x: p.x, y: p.y }));

            // Build segments metadata (all straight lines)
            const segmentsMeta = [];
            for (let j = 0; j < contour.points.length; j++) {
                segmentsMeta.push({ type: 'L' });
            }

            // Use patron editor's method to create the patron
            patronEditor._createPatronFromPath(pathStr, vertices, segmentsMeta);
            created++;
        }

        this.clearPreview();
        showToast(`${created} patron${created > 1 ? 's' : ''} créé${created > 1 ? 's' : ''}`);
    }
}
