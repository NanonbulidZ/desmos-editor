// ========================================
// Desmos Equation Editor - Main Application
// ========================================

(function() {
  'use strict';

  // ===== STATE =====
  const state = {
    lang: localStorage.getItem('desmos-editor-lang') || 'en',
    tool: 'pen',
    color: '#e94560',
    strokeWidth: 2,
    fill: 'transparent',
    opacity: 1,
    smooth: 0.5,
    snapEnabled: false,
    snapSize: 20,
    gridVisible: true,
    zoom: 1,
    panX: 0,
    panY: 0,
    shapes: [],
    selectedShape: null,
    undoStack: [],
    redoStack: [],
    isDrawing: false,
    currentPath: [],
    isPanning: false,
    panStart: { x: 0, y: 0 },
    isDragging: false,
    dragStart: { x: 0, y: 0 },
    dragShapeStart: { x: 0, y: 0 },
    mouseX: 0,
    mouseY: 0,
    rectStart: null,
    circleStart: null,
    stats: loadStats()
  };

  // ===== I18N =====
  let i18nData = {};

  async function loadLanguage(lang) {
    try {
      const res = await fetch(`i18n/${lang}.json`);
      i18nData = await res.json();
      state.lang = lang;
      localStorage.setItem('desmos-editor-lang', lang);
      applyTranslations();
      document.getElementById('langSelect').value = lang;
    } catch (e) {
      console.error('Failed to load language:', e);
    }
  }

  function t(key) {
    return i18nData[key] || key;
  }

  function applyTranslations() {
    document.querySelectorAll('[data-i18n]').forEach(el => {
      const key = el.getAttribute('data-i18n');
      if (el.tagName === 'INPUT' && el.type !== 'button') {
        el.placeholder = t(key);
      } else {
        el.textContent = t(key);
      }
    });
    document.querySelectorAll('[data-i18n-title]').forEach(el => {
      el.title = t(el.getAttribute('data-i18n-title'));
    });
    document.querySelectorAll('[data-i18n-tooltip]').forEach(el => {
      el.setAttribute('data-tooltip', t(el.getAttribute('data-i18n-tooltip')));
    });
    // Update page title
    document.title = t('app_title') + ' - Desmos Editor';
  }

  // ===== STATS =====
  function loadStats() {
    try {
      const s = JSON.parse(localStorage.getItem('desmos-editor-stats'));
      return s || { visitors: 1, drawings: 0, exports: 0 };
    } catch {
      return { visitors: 1, drawings: 0, exports: 0 };
    }
  }

  function saveStats() {
    localStorage.setItem('desmos-editor-stats', JSON.stringify(state.stats));
    updateStatsDisplay();
  }

  function updateStatsDisplay() {
    document.getElementById('statVisitors').textContent = state.stats.visitors;
    document.getElementById('statDrawings').textContent = state.stats.drawings;
    document.getElementById('statExports').textContent = state.stats.exports;
  }

  function trackVisit() {
    const today = new Date().toDateString();
    const lastVisit = localStorage.getItem('desmos-editor-last-visit');
    if (lastVisit !== today) {
      state.stats.visitors++;
      localStorage.setItem('desmos-editor-last-visit', today);
      saveStats();
    }
  }

  // ===== CANVAS SETUP =====
  let canvas, ctx, overlayCanvas, overlayCtx;
  let canvasWidth, canvasHeight;

  function initCanvas() {
    canvas = document.getElementById('drawingCanvas');
    ctx = canvas.getContext('2d');
    overlayCanvas = document.getElementById('overlayCanvas');
    overlayCtx = overlayCanvas.getContext('2d');
    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);
    render();
  }

  function resizeCanvas() {
    const area = document.querySelector('.canvas-area');
    canvasWidth = area.clientWidth;
    canvasHeight = area.clientHeight;
    canvas.width = canvasWidth * devicePixelRatio;
    canvas.height = canvasHeight * devicePixelRatio;
    canvas.style.width = canvasWidth + 'px';
    canvas.style.height = canvasHeight + 'px';
    overlayCanvas.width = canvasWidth * devicePixelRatio;
    overlayCanvas.height = canvasHeight * devicePixelRatio;
    overlayCanvas.style.width = canvasWidth + 'px';
    overlayCanvas.style.height = canvasHeight + 'px';
    ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
    overlayCtx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
    render();
  }

  // ===== COORDINATE HELPERS =====
  function screenToWorld(sx, sy) {
    return {
      x: (sx - state.panX) / state.zoom,
      y: (sy - state.panY) / state.zoom
    };
  }

  function worldToScreen(wx, wy) {
    return {
      x: wx * state.zoom + state.panX,
      y: wy * state.zoom + state.panY
    };
  }

  function snapPoint(x, y) {
    if (!state.snapEnabled) return { x, y };
    const s = state.snapSize;
    return {
      x: Math.round(x / s) * s,
      y: Math.round(y / s) * s
    };
  }

  // ===== GRID DRAWING =====
  function drawGrid() {
    if (!state.gridVisible) return;
    const size = state.snapSize * state.zoom;
    if (size < 4) return; // Too dense, don't draw

    ctx.save();
    ctx.strokeStyle = state.snapEnabled ? 'rgba(93,173,226,0.12)' : 'rgba(255,255,255,0.04)';
    ctx.lineWidth = 1;

    const offsetX = state.panX % size;
    const offsetY = state.panY % size;

    ctx.beginPath();
    for (let x = offsetX; x < canvasWidth; x += size) {
      ctx.moveTo(x, 0);
      ctx.lineTo(x, canvasHeight);
    }
    for (let y = offsetY; y < canvasHeight; y += size) {
      ctx.moveTo(0, y);
      ctx.lineTo(canvasWidth, y);
    }
    ctx.stroke();

    // Draw axes
    if (state.zoom >= 0.5) {
      ctx.strokeStyle = state.snapEnabled ? 'rgba(93,173,226,0.25)' : 'rgba(255,255,255,0.08)';
      ctx.lineWidth = 1.5;
      const origin = worldToScreen(0, 0);
      ctx.beginPath();
      ctx.moveTo(0, origin.y);
      ctx.lineTo(canvasWidth, origin.y);
      ctx.moveTo(origin.x, 0);
      ctx.lineTo(origin.x, canvasHeight);
      ctx.stroke();
    }

    ctx.restore();
  }

  // ===== SHAPE RENDERING =====
  function drawShape(shape, ctx2, selected) {
    ctx2.save();
    ctx2.globalAlpha = shape.opacity;

    // Stroke
    ctx2.strokeStyle = shape.color;
    ctx2.lineWidth = shape.strokeWidth;
    ctx2.lineCap = 'round';
    ctx2.lineJoin = 'round';

    switch (shape.type) {
      case 'path':
        drawPath(shape, ctx2);
        break;
      case 'line':
        drawLine(shape, ctx2);
        break;
      case 'rect':
        drawRect(shape, ctx2);
        break;
      case 'ellipse':
        drawEllipse(shape, ctx2);
        break;
    }

    // Selection indicator
    if (selected) {
      drawSelectionBox(shape, ctx2);
    }

    ctx2.restore();
  }

  function drawPath(shape, ctx2) {
    if (shape.points.length < 2) return;
    ctx2.beginPath();
    const pts = smoothPath(shape.points, shape.smooth || state.smooth);
    const s0 = worldToScreen(pts[0].x, pts[0].y);
    ctx2.moveTo(s0.x, s0.y);
    for (let i = 1; i < pts.length; i++) {
      const s = worldToScreen(pts[i].x, pts[i].y);
      ctx2.lineTo(s.x, s.y);
    }
    ctx2.stroke();
  }

  function drawLine(shape, ctx2) {
    const s1 = worldToScreen(shape.x1, shape.y1);
    const s2 = worldToScreen(shape.x2, shape.y2);
    ctx2.beginPath();
    ctx2.moveTo(s1.x, s1.y);
    ctx2.lineTo(s2.x, s2.y);
    ctx2.stroke();
  }

  function drawRect(shape, ctx2) {
    const s = worldToScreen(shape.x, shape.y);
    const w = shape.width * state.zoom;
    const h = shape.height * state.zoom;
    if (shape.fill && shape.fill !== 'transparent') {
      ctx2.fillStyle = shape.fill;
      ctx2.globalAlpha *= 0.3;
      ctx2.fillRect(s.x, s.y, w, h);
      ctx2.globalAlpha = shape.opacity;
    }
    ctx2.strokeRect(s.x, s.y, w, h);
  }

  function drawEllipse(shape, ctx2) {
    const s = worldToScreen(shape.cx, shape.cy);
    const rx = shape.rx * state.zoom;
    const ry = shape.ry * state.zoom;
    ctx2.beginPath();
    ctx2.ellipse(s.x, s.y, Math.abs(rx), Math.abs(ry), 0, 0, Math.PI * 2);
    if (shape.fill && shape.fill !== 'transparent') {
      ctx2.fillStyle = shape.fill;
      ctx2.globalAlpha *= 0.3;
      ctx2.fill();
      ctx2.globalAlpha = shape.opacity;
    }
    ctx2.stroke();
  }

  function drawSelectionBox(shape, ctx2) {
    ctx2.save();
    ctx2.strokeStyle = '#5dade2';
    ctx2.lineWidth = 1.5;
    ctx2.setLineDash([4, 4]);
    const b = getShapeBounds(shape);
    const s = worldToScreen(b.x, b.y);
    ctx2.strokeRect(s.x - 4, s.y - 4, b.w * state.zoom + 8, b.h * state.zoom + 8);
    ctx2.setLineDash([]);
    // Draw handles
    const handles = [
      { x: b.x, y: b.y },
      { x: b.x + b.w, y: b.y },
      { x: b.x + b.w, y: b.y + b.h },
      { x: b.x, y: b.y + b.h },
    ];
    handles.forEach(h => {
      const hs = worldToScreen(h.x, h.y);
      ctx2.fillStyle = '#fff';
      ctx2.strokeStyle = '#5dade2';
      ctx2.lineWidth = 1.5;
      ctx2.beginPath();
      ctx2.arc(hs.x, hs.y, 4, 0, Math.PI * 2);
      ctx2.fill();
      ctx2.stroke();
    });
    ctx2.restore();
  }

  function smoothPath(points, smoothFactor) {
    if (points.length < 3 || smoothFactor === 0) return points;
    const result = [points[0]];
    for (let i = 1; i < points.length - 1; i++) {
      const prev = points[i - 1];
      const curr = points[i];
      const next = points[i + 1];
      result.push({
        x: curr.x + (next.x - prev.x) * smoothFactor * 0.15,
        y: curr.y + (next.y - prev.y) * smoothFactor * 0.15
      });
    }
    result.push(points[points.length - 1]);
    return result;
  }

  function getShapeBounds(shape) {
    switch (shape.type) {
      case 'path': {
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        shape.points.forEach(p => {
          minX = Math.min(minX, p.x);
          minY = Math.min(minY, p.y);
          maxX = Math.max(maxX, p.x);
          maxY = Math.max(maxY, p.y);
        });
        return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
      }
      case 'line': {
        const minX = Math.min(shape.x1, shape.x2);
        const minY = Math.min(shape.y1, shape.y2);
        return { x: minX, y: minY, w: Math.abs(shape.x2 - shape.x1), h: Math.abs(shape.y2 - shape.y1) };
      }
      case 'rect':
        return { x: shape.x, y: shape.y, w: shape.width, h: shape.height };
      case 'ellipse':
        return { x: shape.cx - Math.abs(shape.rx), y: shape.cy - Math.abs(shape.ry), w: Math.abs(shape.rx) * 2, h: Math.abs(shape.ry) * 2 };
      default:
        return { x: 0, y: 0, w: 0, h: 0 };
    }
  }

  // ===== MAIN RENDER =====
  function render() {
    ctx.clearRect(0, 0, canvasWidth, canvasHeight);
    // Background
    ctx.fillStyle = '#0d1117';
    ctx.fillRect(0, 0, canvasWidth, canvasHeight);

    drawGrid();

    // Draw shapes
    state.shapes.forEach((shape, i) => {
      drawShape(shape, ctx, state.selectedShape === i);
    });

    // Draw current drawing preview
    if (state.isDrawing && state.currentPath.length > 0) {
      ctx.save();
      ctx.strokeStyle = state.color;
      ctx.lineWidth = state.strokeWidth;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.globalAlpha = 0.8;
      ctx.beginPath();
      const pts = smoothPath(state.currentPath, state.smooth);
      const s0 = worldToScreen(pts[0].x, pts[0].y);
      ctx.moveTo(s0.x, s0.y);
      for (let i = 1; i < pts.length; i++) {
        const s = worldToScreen(pts[i].x, pts[i].y);
        ctx.lineTo(s.x, s.y);
      }
      ctx.stroke();
      ctx.restore();
    }

    // Preview line
    if (state.tool === 'line' && state.rectStart) {
      ctx.save();
      ctx.strokeStyle = state.color;
      ctx.lineWidth = state.strokeWidth;
      ctx.setLineDash([6, 4]);
      ctx.globalAlpha = 0.6;
      const s1 = worldToScreen(state.rectStart.x, state.rectStart.y);
      const s2 = worldToScreen(state.mouseX, state.mouseY);
      ctx.beginPath();
      ctx.moveTo(s1.x, s1.y);
      ctx.lineTo(s2.x, s2.y);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();
    }

    // Preview rect
    if ((state.tool === 'rect' || state.tool === 'ellipse') && state.rectStart) {
      ctx.save();
      ctx.strokeStyle = state.color;
      ctx.lineWidth = state.strokeWidth;
      ctx.setLineDash([6, 4]);
      ctx.globalAlpha = 0.6;
      const s1 = worldToScreen(state.rectStart.x, state.rectStart.y);
      const s2 = worldToScreen(state.mouseX, state.mouseY);
      const x = Math.min(s1.x, s2.x);
      const y = Math.min(s1.y, s2.y);
      const w = Math.abs(s2.x - s1.x);
      const h = Math.abs(s2.y - s1.y);
      if (state.tool === 'rect') {
        ctx.strokeRect(x, y, w, h);
      } else {
        ctx.beginPath();
        ctx.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.setLineDash([]);
      ctx.restore();
    }

    // Crosshair info
    updateCanvasInfo();
  }

  function updateCanvasInfo() {
    const world = screenToWorld(state.mouseX, state.mouseY);
    document.getElementById('infoCoords').textContent =
      `X: ${Math.round(world.x)} Y: ${Math.round(world.y)}`;
    document.getElementById('infoZoom').textContent =
      `Zoom: ${Math.round(state.zoom * 100)}%`;
  }

  // ===== INPUT HANDLING =====
  function initInput() {
    canvas.addEventListener('mousedown', onMouseDown);
    canvas.addEventListener('mousemove', onMouseMove);
    canvas.addEventListener('mouseup', onMouseUp);
    canvas.addEventListener('mouseleave', onMouseUp);
    canvas.addEventListener('wheel', onWheel, { passive: false });
    canvas.addEventListener('contextmenu', onContextMenu);

    // Touch events
    canvas.addEventListener('touchstart', onTouchStart, { passive: false });
    canvas.addEventListener('touchmove', onTouchMove, { passive: false });
    canvas.addEventListener('touchend', onTouchEnd);

    // Keyboard
    document.addEventListener('keydown', onKeyDown);
  }

  function onMouseDown(e) {
    const rect = canvas.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    const world = screenToWorld(sx, sy);
    const snapped = snapPoint(world.x, world.y);

    // Pan with middle mouse
    if (e.button === 1) {
      state.isPanning = true;
      state.panStart = { x: e.clientX - state.panX, y: e.clientY - state.panY };
      canvas.style.cursor = 'grabbing';
      return;
    }

    // Pan tool
    if (state.tool === 'pan') {
      state.isPanning = true;
      state.panStart = { x: e.clientX - state.panX, y: e.clientY - state.panY };
      canvas.style.cursor = 'grabbing';
      return;
    }

    // Select tool
    if (state.tool === 'select') {
      const idx = findShapeAt(sx, sy);
      state.selectedShape = idx;
      if (idx !== null) {
        state.isDragging = true;
        state.dragStart = { x: world.x, y: world.y };
        state.dragShapeStart = getShapePosition(state.shapes[idx]);
      }
      updateLayersList();
      updateProperties();
      render();
      return;
    }

    // Zoom tools
    if (state.tool === 'zoomIn') {
      const newZoom = Math.min(5, state.zoom * 1.3);
      const ratio = newZoom / state.zoom;
      state.panX = sx - (sx - state.panX) * ratio;
      state.panY = sy - (sy - state.panY) * ratio;
      state.zoom = newZoom;
      render();
      return;
    }
    if (state.tool === 'zoomOut') {
      const newZoom = Math.max(0.1, state.zoom / 1.3);
      const ratio = newZoom / state.zoom;
      state.panX = sx - (sx - state.panX) * ratio;
      state.panY = sy - (sy - state.panY) * ratio;
      state.zoom = newZoom;
      render();
      return;
    }

    // Eraser
    if (state.tool === 'erase') {
      const idx = findShapeAt(sx, sy);
      if (idx !== null) {
        pushUndo();
        state.shapes.splice(idx, 1);
        state.selectedShape = null;
        state.stats.drawings = Math.max(0, state.stats.drawings - 1);
        saveStats();
        updateLayersList();
        render();
      }
      return;
    }

    // Drawing tools
    state.isDrawing = true;
    state.currentPath = [];

    if (state.tool === 'pen') {
      state.currentPath.push({ x: snapped.x, y: snapped.y });
    } else if (state.tool === 'line' || state.tool === 'rect' || state.tool === 'ellipse') {
      state.rectStart = { x: snapped.x, y: snapped.y };
    }
  }

  function onMouseMove(e) {
    const rect = canvas.getBoundingClientRect();
    state.mouseX = e.clientX - rect.left;
    state.mouseY = e.clientY - rect.top;

    if (state.isPanning) {
      state.panX = e.clientX - state.panStart.x;
      state.panY = e.clientY - state.panStart.y;
      render();
      return;
    }

    if (state.isDragging && state.selectedShape !== null) {
      const world = screenToWorld(state.mouseX, state.mouseY);
      const dx = world.x - state.dragStart.x;
      const dy = world.y - state.dragStart.y;
      moveShape(state.shapes[state.selectedShape], state.dragShapeStart, dx, dy);
      render();
      return;
    }

    if (state.isDrawing) {
      const world = screenToWorld(state.mouseX, state.mouseY);
      const snapped = snapPoint(world.x, world.y);

      if (state.tool === 'pen') {
        // Thinning: skip if too close
        const last = state.currentPath[state.currentPath.length - 1];
        if (last) {
          const dist = Math.hypot(snapped.x - last.x, snapped.y - last.y);
          if (dist < 2) return;
        }
        state.currentPath.push({ x: snapped.x, y: snapped.y });
      }
      render();
    }
  }

  function onMouseUp(e) {
    if (state.isPanning) {
      state.isPanning = false;
      canvas.style.cursor = getCursorForTool();
      return;
    }

    if (state.isDragging) {
      state.isDragging = false;
      return;
    }

    if (!state.isDrawing) return;
    state.isDrawing = false;

    const rect = canvas.getBoundingClientRect();
    const sx = (e.clientX || 0) - rect.left;
    const sy = (e.clientY || 0) - rect.top;
    const world = screenToWorld(sx, sy);
    const snapped = snapPoint(world.x, world.y);

    pushUndo();

    if (state.tool === 'pen' && state.currentPath.length >= 2) {
      state.shapes.push({
        type: 'path',
        points: [...state.currentPath],
        color: state.color,
        strokeWidth: state.strokeWidth,
        fill: 'transparent',
        opacity: state.opacity,
        smooth: state.smooth,
        name: `Path ${state.shapes.length + 1}`,
        visible: true
      });
      state.stats.drawings++;
    } else if (state.tool === 'line' && state.rectStart) {
      state.shapes.push({
        type: 'line',
        x1: state.rectStart.x,
        y1: state.rectStart.y,
        x2: snapped.x,
        y2: snapped.y,
        color: state.color,
        strokeWidth: state.strokeWidth,
        opacity: state.opacity,
        name: `Line ${state.shapes.length + 1}`,
        visible: true
      });
      state.stats.drawings++;
    } else if (state.tool === 'rect' && state.rectStart) {
      const x = Math.min(state.rectStart.x, snapped.x);
      const y = Math.min(state.rectStart.y, snapped.y);
      state.shapes.push({
        type: 'rect',
        x, y,
        width: Math.abs(snapped.x - state.rectStart.x),
        height: Math.abs(snapped.y - state.rectStart.y),
        color: state.color,
        strokeWidth: state.strokeWidth,
        fill: 'transparent',
        opacity: state.opacity,
        name: `Rect ${state.shapes.length + 1}`,
        visible: true
      });
      state.stats.drawings++;
    } else if (state.tool === 'ellipse' && state.rectStart) {
      const cx = (state.rectStart.x + snapped.x) / 2;
      const cy = (state.rectStart.y + snapped.y) / 2;
      state.shapes.push({
        type: 'ellipse',
        cx, cy,
        rx: Math.abs(snapped.x - state.rectStart.x) / 2,
        ry: Math.abs(snapped.y - state.rectStart.y) / 2,
        color: state.color,
        strokeWidth: state.strokeWidth,
        fill: 'transparent',
        opacity: state.opacity,
        name: `Ellipse ${state.shapes.length + 1}`,
        visible: true
      });
      state.stats.drawings++;
    }

    state.rectStart = null;
    state.currentPath = [];
    saveStats();
    updateLayersList();
    render();
  }

  function onWheel(e) {
    e.preventDefault();
    const rect = canvas.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    const newZoom = Math.max(0.1, Math.min(5, state.zoom * delta));
    const ratio = newZoom / state.zoom;
    state.panX = sx - (sx - state.panX) * ratio;
    state.panY = sy - (sy - state.panY) * ratio;
    state.zoom = newZoom;
    render();
  }

  function onContextMenu(e) {
    e.preventDefault();
    const rect = canvas.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    const idx = findShapeAt(sx, sy);
    if (idx !== null) {
      state.selectedShape = idx;
      showContextMenu(e.clientX, e.clientY, idx);
    }
  }

  // Touch events
  function onTouchStart(e) {
    e.preventDefault();
    const touch = e.touches[0];
    const mouseEvent = new MouseEvent('mousedown', {
      clientX: touch.clientX,
      clientY: touch.clientY,
      button: 0
    });
    canvas.dispatchEvent(mouseEvent);
  }

  function onTouchMove(e) {
    e.preventDefault();
    const touch = e.touches[0];
    const mouseEvent = new MouseEvent('mousemove', {
      clientX: touch.clientX,
      clientY: touch.clientY
    });
    canvas.dispatchEvent(mouseEvent);
  }

  function onTouchEnd(e) {
    const mouseEvent = new MouseEvent('mouseup', {});
    canvas.dispatchEvent(mouseEvent);
  }

  function onKeyDown(e) {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

    if (e.ctrlKey || e.metaKey) {
      if (e.key === 'z') { e.preventDefault(); undo(); }
      else if (e.key === 'y') { e.preventDefault(); redo(); }
      else if (e.key === 's') { e.preventDefault(); saveProject(); }
    } else {
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (state.selectedShape !== null) {
          pushUndo();
          state.shapes.splice(state.selectedShape, 1);
          state.selectedShape = null;
          updateLayersList();
          render();
        }
      }
      if (e.key === 'v') setTool('select');
      if (e.key === 'p') setTool('pen');
      if (e.key === 'l') setTool('line');
      if (e.key === 'r') setTool('rect');
      if (e.key === 'o') setTool('ellipse');
      if (e.key === 'e') setTool('erase');
      if (e.key === 'h') setTool('pan');
      if (e.key === 'g') toggleGrid();
      if (e.key === 's') toggleSnap();
      if (e.key === 'Escape') {
        state.selectedShape = null;
        state.isDrawing = false;
        state.currentPath = [];
        render();
        updateLayersList();
      }
    }
  }

  // ===== SHAPE HELPERS =====
  function findShapeAt(sx, sy) {
    for (let i = state.shapes.length - 1; i >= 0; i--) {
      const shape = state.shapes[i];
      if (!shape.visible) continue;
      const b = getShapeBounds(shape);
      const s = worldToScreen(b.x, b.y);
      const margin = 8;
      if (sx >= s.x - margin && sx <= s.x + b.w * state.zoom + margin &&
          sy >= s.y - margin && sy <= s.y + b.h * state.zoom + margin) {
        return i;
      }
    }
    return null;
  }

  function getShapePosition(shape) {
    switch (shape.type) {
      case 'path': return { x: shape.points[0].x, y: shape.points[0].y };
      case 'line': return { x: shape.x1, y: shape.y1 };
      case 'rect': return { x: shape.x, y: shape.y };
      case 'ellipse': return { x: shape.cx, y: shape.cy };
    }
  }

  function moveShape(shape, startPos, dx, dy) {
    switch (shape.type) {
      case 'path': {
        const baseX = shape.points[0].x;
        const baseY = shape.points[0].y;
        const offsetX = startPos.x + dx - baseX;
        const offsetY = startPos.y + dy - baseY;
        shape.points.forEach(p => {
          p.x += offsetX;
          p.y += offsetY;
        });
        break;
      }
      case 'line':
        shape.x1 += dx;
        shape.y1 += dy;
        shape.x2 += dx;
        shape.y2 += dy;
        break;
      case 'rect':
        shape.x += dx;
        shape.y += dy;
        break;
      case 'ellipse':
        shape.cx += dx;
        shape.cy += dy;
        break;
    }
  }

  // ===== UNDO/REDO =====
  function pushUndo() {
    state.undoStack.push(JSON.parse(JSON.stringify(state.shapes)));
    state.redoStack = [];
    if (state.undoStack.length > 50) state.undoStack.shift();
  }

  function undo() {
    if (state.undoStack.length === 0) return;
    state.redoStack.push(JSON.parse(JSON.stringify(state.shapes)));
    state.shapes = state.undoStack.pop();
    state.selectedShape = null;
    updateLayersList();
    render();
  }

  function redo() {
    if (state.redoStack.length === 0) return;
    state.undoStack.push(JSON.parse(JSON.stringify(state.shapes)));
    state.shapes = state.redoStack.pop();
    state.selectedShape = null;
    updateLayersList();
    render();
  }

  // ===== TOOL MANAGEMENT =====
  function setTool(tool) {
    state.tool = tool;
    document.querySelectorAll('.tool-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.tool === tool);
    });
    canvas.style.cursor = getCursorForTool();
  }

  function getCursorForTool() {
    switch (state.tool) {
      case 'select': return 'default';
      case 'pan': return 'grab';
      case 'erase': return 'crosshair';
      case 'zoomIn': return 'zoom-in';
      case 'zoomOut': return 'zoom-out';
      default: return 'crosshair';
    }
  }

  // ===== TOGGLE FUNCTIONS =====
  function toggleGrid() {
    state.gridVisible = !state.gridVisible;
    document.getElementById('gridToggle').classList.toggle('active', state.gridVisible);
    render();
  }

  function toggleSnap() {
    state.snapEnabled = !state.snapEnabled;
    document.getElementById('snapToggle').classList.toggle('active', state.snapEnabled);
    document.getElementById('snapSwitch').classList.toggle('active', state.snapEnabled);
    render();
  }

  // ===== EQUATION CONVERSION =====
  function shapeToLatex(shape) {
    switch (shape.type) {
      case 'line': {
        const x1 = shape.x1 / 20;
        const y1 = -shape.y1 / 20;
        const x2 = shape.x2 / 20;
        const y2 = -shape.y2 / 20;
        const m = (y2 - y1) / (x2 - x1 || 0.001);
        const b = y1 - m * x1;
        if (Math.abs(x2 - x1) < 0.01) {
          return `x = ${x1.toFixed(2)}`;
        }
        return `y = ${m.toFixed(3)}x + ${b.toFixed(3)}`;
      }
      case 'rect': {
        const x = shape.x / 20;
        const y = -shape.y / 20;
        const w = shape.width / 20;
        const h = shape.height / 20;
        const left = Math.min(x, x + w);
        const right = Math.max(x, x + w);
        const top = Math.min(y, y - h);
        const bottom = Math.max(y, y - h);
        return `\\operatorname{polygon}([(${left},${top}),(${right},${top}),(${right},${bottom}),(${left},${bottom})])`;
      }
      case 'ellipse': {
        const cx = shape.cx / 20;
        const cy = -shape.cy / 20;
        const rx = Math.abs(shape.rx) / 20;
        const ry = Math.abs(shape.ry) / 20;
        return `\\frac{(x-${cx.toFixed(2)})^2}{${(rx*rx).toFixed(2)}} + \\frac{(y-${cy.toFixed(2)})^2}{${(ry*ry).toFixed(2)}} = 1`;
      }
      case 'path': {
        // Approximate path with parametric or line segments
        const pts = shape.points.map(p => ({ x: p.x / 20, y: -p.y / 20 }));
        if (pts.length <= 2) {
          return `y = ${pts[0].y.toFixed(2)} + (${(pts[pts.length-1].y - pts[0].y).toFixed(3)})/((${pts[pts.length-1].x - pts[0].x}).toFixed(3)) * (x - ${pts[0].x.toFixed(2)})`;
        }
        // Try polynomial fit for simple curves
        const xs = pts.map(p => p.x);
        const ys = pts.map(p => p.y);
        const minX = Math.min(...xs);
        const maxX = Math.max(...xs);
        const range = maxX - minX || 1;

        // Fit quadratic: y = ax^2 + bx + c
        let a = 0, b = 0, c = 0;
        try {
          const n = pts.length;
          let sx2 = 0, sx = 0, sy = 0, sxy = 0, sx2y = 0, sx3 = 0, sx4 = 0;
          for (const p of pts) {
            sx2 += p.x * p.x;
            sx += p.x;
            sy += p.y;
            sxy += p.x * p.y;
            sx2y += p.x * p.x * p.y;
            sx3 += p.x * p.x * p.x;
            sx4 += p.x * p.x * p.x * p.x;
          }
          // Simple least squares for y = ax^2 + bx + c
          const det = n * (sx2 * sx4 - sx3 * sx3) - sx * (sx * sx4 - sx2 * sx3) + sx2 * (sx * sx3 - sx2 * sx2);
          if (Math.abs(det) > 0.0001) {
            a = (n * (sx2y * sx4 - sx3 * (sx2 * sy / n)) - sy * (sx * sx4 - sx2 * sx3) + sx2 * (sx * (sx2 * sy / n) - sx2y * n)) / det;
            b = (n * (sx2 * (sx2y) - sx3 * sy) - sx * (n * (sx4 * sy / n) - sx3 * (sx2 * sy / n)) + sx2 * (sx * sy - sx2 * (sx2y))) / det;
            c = sy / n - a * sx2 / n - b * sx / n;
          }
        } catch (e) {
          // Fallback
        }

        if (Math.abs(a) > 0.001) {
          return `y = ${a.toFixed(4)}x^2 + ${b.toFixed(4)}x + ${c.toFixed(4)}`;
        }
        // Line segments
        const segments = [];
        for (let i = 0; i < pts.length - 1; i++) {
          const p1 = pts[i];
          const p2 = pts[i + 1];
          const m = (p2.y - p1.y) / (p2.x - p1.x || 0.001);
          const bb = p1.y - m * p1.x;
          if (Math.abs(p2.x - p1.x) < 0.01) {
            segments.push(`x = ${p1.x.toFixed(2)}\\left\\{${Math.min(p1.y,p2.y).toFixed(1)}\\le y\\le${Math.max(p1.y,p2.y).toFixed(1)}\\right\\}`);
          } else {
            segments.push(`${m.toFixed(3)}x+${bb.toFixed(3)}\\left\\{${Math.min(p1.x,p2.x).toFixed(1)}\\le x\\le${Math.max(p1.x,p2.x).toFixed(1)}\\right\\}`);
          }
        }
        return segments.join(', ');
      }
      default:
        return '';
    }
  }

  function exportToDesmos() {
    if (state.shapes.length === 0) {
      showToast(t('toast_export_failed'), 'error');
      return;
    }

    state.stats.exports++;
    saveStats();

    // Copy all equations to clipboard as LaTeX
    const equations = state.shapes.map(s => shapeToLatex(s)).filter(l => l);

    // Try Desmos API integration
    if (window.Desmos) {
      try {
        const elt = document.getElementById('desmosCalculator');
        elt.style.display = 'block';
        const calc = Desmos.GraphingCalculator(elt, {
          expressions: true,
          settingsMenu: false,
          zoomButtons: true
        });
        equations.forEach(eq => {
          calc.setExpression({ latex: eq });
        });
        showToast(t('toast_exported'), 'success');
      } catch (e) {
        // Fallback: copy to clipboard
        navigator.clipboard.writeText(equations.join('\n')).then(() => {
          showToast(t('toast_copied'), 'success');
        });
      }
    } else {
      // No Desmos API, copy LaTeX
      navigator.clipboard.writeText(equations.join('\n')).then(() => {
        showToast(t('toast_copied'), 'success');
      }).catch(() => {
        // Manual copy
        const ta = document.createElement('textarea');
        ta.value = equations.join('\n');
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
        showToast(t('toast_copied'), 'success');
      });
    }
  }

  function copyLaTeX() {
    const equations = state.shapes.map(s => shapeToLatex(s)).filter(l => l);
    navigator.clipboard.writeText(equations.join('\n')).then(() => {
      showToast(t('toast_copied'), 'success');
    }).catch(() => {
      showToast(t('toast_export_failed'), 'error');
    });
  }

  function exportSVG() {
    if (state.shapes.length === 0) return;
    let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600" viewBox="0 0 800 600">\n`;
    svg += `<rect width="800" height="600" fill="#0d1117"/>\n`;
    state.shapes.forEach(shape => {
      switch (shape.type) {
        case 'path': {
          const pts = shape.points.map(p => `${p.x},${p.y}`).join(' ');
          svg += `<polyline points="${pts}" fill="none" stroke="${shape.color}" stroke-width="${shape.strokeWidth}" stroke-linecap="round"/>\n`;
          break;
        }
        case 'line':
          svg += `<line x1="${shape.x1}" y1="${shape.y1}" x2="${shape.x2}" y2="${shape.y2}" stroke="${shape.color}" stroke-width="${shape.strokeWidth}" stroke-linecap="round"/>\n`;
          break;
        case 'rect':
          svg += `<rect x="${shape.x}" y="${shape.y}" width="${shape.width}" height="${shape.height}" fill="${shape.fill || 'none'}" stroke="${shape.color}" stroke-width="${shape.strokeWidth}"/>\n`;
          break;
        case 'ellipse':
          svg += `<ellipse cx="${shape.cx}" cy="${shape.cy}" rx="${shape.rx}" ry="${shape.ry}" fill="${shape.fill || 'none'}" stroke="${shape.color}" stroke-width="${shape.strokeWidth}"/>\n`;
          break;
      }
    });
    svg += `</svg>`;

    const blob = new Blob([svg], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'desmos-drawing.svg';
    a.click();
    URL.revokeObjectURL(url);
  }

  // ===== LAYERS PANEL =====
  function updateLayersList() {
    const list = document.getElementById('layersList');
    list.innerHTML = '';
    state.shapes.forEach((shape, i) => {
      const item = document.createElement('div');
      item.className = 'layer-item' + (state.selectedShape === i ? ' selected' : '');
      item.innerHTML = `
        <span class="layer-color" style="background:${shape.color}"></span>
        <span class="layer-name">${shape.name}</span>
        <span class="layer-visibility ${shape.visible ? '' : 'hidden'}" data-idx="${i}">
          ${shape.visible ? '👁' : '👁‍🗨'}
        </span>
      `;
      item.addEventListener('click', (e) => {
        if (e.target.closest('.layer-visibility')) {
          shape.visible = !shape.visible;
          updateLayersList();
          render();
          return;
        }
        state.selectedShape = i;
        updateLayersList();
        updateProperties();
        render();
      });
      list.appendChild(item);
    });
  }

  // ===== PROPERTIES PANEL =====
  function updateProperties() {
    if (state.selectedShape === null) return;
    const shape = state.shapes[state.selectedShape];
    if (!shape) return;
    document.getElementById('propStrokeColor').value = shape.color;
    document.getElementById('propStrokeWidth').value = shape.strokeWidth;
    document.getElementById('propOpacity').value = shape.opacity * 100;
    document.getElementById('propSmoothVal').textContent = (shape.smooth || state.smooth).toFixed(1);
    document.getElementById('propSmooth').value = (shape.smooth || state.smooth) * 100;
    document.getElementById('propWidthVal').textContent = shape.strokeWidth;
  }

  function applyPropertyChange() {
    if (state.selectedShape === null) return;
    const shape = state.shapes[state.selectedShape];
    if (!shape) return;
    shape.color = document.getElementById('propStrokeColor').value;
    shape.strokeWidth = parseFloat(document.getElementById('propStrokeWidth').value);
    shape.opacity = parseFloat(document.getElementById('propOpacity').value) / 100;
    shape.smooth = parseFloat(document.getElementById('propSmooth').value) / 100;
    render();
  }

  // ===== CONTEXT MENU =====
  function showContextMenu(x, y, idx) {
    const menu = document.getElementById('contextMenu');
    menu.style.left = x + 'px';
    menu.style.top = y + 'px';
    menu.classList.add('active');
    menu.dataset.idx = idx;

    const closeMenu = (e) => {
      if (!menu.contains(e.target)) {
        menu.classList.remove('active');
        document.removeEventListener('click', closeMenu);
      }
    };
    setTimeout(() => document.addEventListener('click', closeMenu), 10);
  }

  // ===== PRESETS =====
  function addPreset(type) {
    pushUndo();
    const cx = (canvasWidth / 2 - state.panX) / state.zoom;
    const cy = (canvasHeight / 2 - state.panY) / state.zoom;

    switch (type) {
      case 'line':
        state.shapes.push({
          type: 'line', x1: cx - 100, y1: cy, x2: cx + 100, y2: cy,
          color: state.color, strokeWidth: state.strokeWidth, opacity: state.opacity,
          name: `Line ${state.shapes.length + 1}`, visible: true
        });
        break;
      case 'circle':
        state.shapes.push({
          type: 'ellipse', cx, cy, rx: 80, ry: 80,
          color: state.color, strokeWidth: state.strokeWidth, fill: 'transparent', opacity: state.opacity,
          name: `Circle ${state.shapes.length + 1}`, visible: true
        });
        break;
      case 'ellipse':
        state.shapes.push({
          type: 'ellipse', cx, cy, rx: 100, ry: 60,
          color: state.color, strokeWidth: state.strokeWidth, fill: 'transparent', opacity: state.opacity,
          name: `Ellipse ${state.shapes.length + 1}`, visible: true
        });
        break;
      case 'rect':
        state.shapes.push({
          type: 'rect', x: cx - 80, y: cy - 60, width: 160, height: 120,
          color: state.color, strokeWidth: state.strokeWidth, fill: 'transparent', opacity: state.opacity,
          name: `Rect ${state.shapes.length + 1}`, visible: true
        });
        break;
      case 'triangle':
        state.shapes.push({
          type: 'path', points: [
            { x: cx, y: cy - 80 },
            { x: cx - 80, y: cy + 60 },
            { x: cx + 80, y: cy + 60 },
            { x: cx, y: cy - 80 }
          ],
          color: state.color, strokeWidth: state.strokeWidth, fill: 'transparent', opacity: state.opacity, smooth: 0,
          name: `Triangle ${state.shapes.length + 1}`, visible: true
        });
        break;
      case 'sine':
        const sinePoints = [];
        for (let i = 0; i <= 200; i++) {
          const t = (i / 200) * Math.PI * 4 - Math.PI * 2;
          sinePoints.push({ x: cx + t * 40, y: cy - Math.sin(t) * 60 });
        }
        state.shapes.push({
          type: 'path', points: sinePoints,
          color: state.color, strokeWidth: state.strokeWidth, fill: 'transparent', opacity: state.opacity, smooth: 0.3,
          name: `Sine ${state.shapes.length + 1}`, visible: true
        });
        break;
      case 'cosine':
        const cosPoints = [];
        for (let i = 0; i <= 200; i++) {
          const t = (i / 200) * Math.PI * 4 - Math.PI * 2;
          cosPoints.push({ x: cx + t * 40, y: cy - Math.cos(t) * 60 });
        }
        state.shapes.push({
          type: 'path', points: cosPoints,
          color: state.color, strokeWidth: state.strokeWidth, fill: 'transparent', opacity: state.opacity, smooth: 0.3,
          name: `Cosine ${state.shapes.length + 1}`, visible: true
        });
        break;
      case 'parabola':
        const paraPoints = [];
        for (let i = 0; i <= 200; i++) {
          const t = (i / 200 - 0.5) * 8;
          paraPoints.push({ x: cx + t * 40, y: cy - t * t * 10 });
        }
        state.shapes.push({
          type: 'path', points: paraPoints,
          color: state.color, strokeWidth: state.strokeWidth, fill: 'transparent', opacity: state.opacity, smooth: 0.1,
          name: `Parabola ${state.shapes.length + 1}`, visible: true
        });
        break;
    }

    state.stats.drawings++;
    saveStats();
    updateLayersList();
    render();
  }

  // ===== SAVE/LOAD PROJECT =====
  function saveProject() {
    const data = {
      version: 1,
      shapes: state.shapes,
      settings: {
        zoom: state.zoom,
        panX: state.panX,
        panY: state.panY,
        gridVisible: state.gridVisible,
        snapEnabled: state.snapEnabled
      }
    };
    localStorage.setItem('desmos-editor-project', JSON.stringify(data));
    showToast(t('toast_saved'), 'success');
  }

  function loadProject() {
    try {
      const data = JSON.parse(localStorage.getItem('desmos-editor-project'));
      if (data && data.shapes) {
        state.shapes = data.shapes;
        if (data.settings) {
          state.zoom = data.settings.zoom || 1;
          state.panX = data.settings.panX || 0;
          state.panY = data.settings.panY || 0;
          state.gridVisible = data.settings.gridVisible !== false;
          state.snapEnabled = data.settings.snapEnabled || false;
        }
        updateLayersList();
        render();
        showToast(t('toast_loaded'), 'success');
      }
    } catch (e) {
      console.error('Failed to load project:', e);
    }
  }

  function clearAll() {
    pushUndo();
    state.shapes = [];
    state.selectedShape = null;
    updateLayersList();
    updateEquationsList();
    render();
    showToast(t('toast_cleared'), 'success');
  }

  // ===== FEEDBACK =====
  function sendFeedback(name, email, message) {
    // Store feedback locally (in real app, send to server)
    const feedback = {
      name, email, message,
      timestamp: new Date().toISOString(),
      lang: state.lang,
      userAgent: navigator.userAgent
    };
    const feedbackList = JSON.parse(localStorage.getItem('desmos-editor-feedback') || '[]');
    feedbackList.push(feedback);
    localStorage.setItem('desmos-editor-feedback', JSON.stringify(feedbackList));
    return true;
  }

  // ===== TOAST =====
  function showToast(msg, type = 'info') {
    const container = document.getElementById('toastContainer');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = msg;
    container.appendChild(toast);
    setTimeout(() => toast.remove(), 3000);
  }

  // ===== EQUATIONS LIST =====
  function updateEquationsList() {
    const list = document.getElementById('equationsList');
    list.innerHTML = '';
    state.shapes.forEach((shape, i) => {
      const latex = shapeToLatex(shape);
      if (!latex) return;
      const item = document.createElement('div');
      item.className = 'equation-item';
      item.innerHTML = `
        <button class="eq-delete" data-idx="${i}" title="Delete">✕</button>
        ${latex}
      `;
      item.querySelector('.eq-delete').addEventListener('click', () => {
        pushUndo();
        state.shapes.splice(i, 1);
        state.selectedShape = null;
        updateLayersList();
        updateEquationsList();
        render();
      });
      list.appendChild(item);
    });
  }

  // ===== INIT =====
  function init() {
    initCanvas();
    initInput();

    // Load saved language
    loadLanguage(state.lang);

    // Track visit
    trackVisit();
    updateStatsDisplay();

    // Load saved project
    const hasProject = localStorage.getItem('desmos-editor-project');
    if (hasProject) {
      loadProject();
    }

    // Tool buttons
    document.querySelectorAll('.tool-btn[data-tool]').forEach(btn => {
      btn.addEventListener('click', () => setTool(btn.dataset.tool));
    });

    // Preset buttons
    document.querySelectorAll('.preset-btn[data-preset]').forEach(btn => {
      btn.addEventListener('click', () => addPreset(btn.dataset.preset));
    });

    // Snap toggle
    document.getElementById('snapSwitch').addEventListener('click', toggleSnap);
    document.getElementById('snapToggle').addEventListener('click', toggleSnap);

    // Grid toggle
    document.getElementById('gridToggle').addEventListener('click', toggleGrid);

    // Action buttons
    document.getElementById('btnUndo').addEventListener('click', undo);
    document.getElementById('btnRedo').addEventListener('click', redo);
    document.getElementById('btnClear').addEventListener('click', clearAll);
    document.getElementById('btnExport').addEventListener('click', exportToDesmos);
    document.getElementById('btnCopyLatex').addEventListener('click', copyLaTeX);
    document.getElementById('btnExportSvg').addEventListener('click', exportSVG);
    document.getElementById('btnSave').addEventListener('click', saveProject);

    // Language select
    document.getElementById('langSelect').addEventListener('change', (e) => {
      loadLanguage(e.target.value);
    });

    // Properties
    document.getElementById('propStrokeColor').addEventListener('input', applyPropertyChange);
    document.getElementById('propStrokeWidth').addEventListener('input', applyPropertyChange);
    document.getElementById('propOpacity').addEventListener('input', applyPropertyChange);
    document.getElementById('propSmooth').addEventListener('input', (e) => {
      document.getElementById('propSmoothVal').textContent = (e.target.value / 100).toFixed(1);
      applyPropertyChange();
    });

    // Snap strength slider
    document.getElementById('snapStrength').addEventListener('input', (e) => {
      state.snapSize = parseInt(e.target.value);
    });

    // Update equations on shape change
    const origPushUndo = pushUndo;
    pushUndo = function() {
      origPushUndo();
      updateEquationsList();
    };

    // Context menu actions
    document.getElementById('ctxDelete').addEventListener('click', () => {
      const idx = parseInt(document.getElementById('contextMenu').dataset.idx);
      pushUndo();
      state.shapes.splice(idx, 1);
      state.selectedShape = null;
      updateLayersList();
      render();
      document.getElementById('contextMenu').classList.remove('active');
    });

    document.getElementById('ctxDuplicate').addEventListener('click', () => {
      const idx = parseInt(document.getElementById('contextMenu').dataset.idx);
      pushUndo();
      const clone = JSON.parse(JSON.stringify(state.shapes[idx]));
      clone.name += ' Copy';
      state.shapes.push(clone);
      updateLayersList();
      render();
      document.getElementById('contextMenu').classList.remove('active');
    });

    document.getElementById('ctxBringFront').addEventListener('click', () => {
      const idx = parseInt(document.getElementById('contextMenu').dataset.idx);
      pushUndo();
      const shape = state.shapes.splice(idx, 1)[0];
      state.shapes.push(shape);
      state.selectedShape = state.shapes.length - 1;
      updateLayersList();
      render();
      document.getElementById('contextMenu').classList.remove('active');
    });

    document.getElementById('ctxSendBack').addEventListener('click', () => {
      const idx = parseInt(document.getElementById('contextMenu').dataset.idx);
      pushUndo();
      const shape = state.shapes.splice(idx, 1)[0];
      state.shapes.unshift(shape);
      state.selectedShape = 0;
      updateLayersList();
      render();
      document.getElementById('contextMenu').classList.remove('active');
    });

    // Feedback button
    document.getElementById('btnFeedback').addEventListener('click', () => {
      document.getElementById('feedbackModal').classList.add('active');
    });

    document.getElementById('feedbackCancel').addEventListener('click', () => {
      document.getElementById('feedbackModal').classList.remove('active');
    });

    document.getElementById('feedbackForm').addEventListener('submit', (e) => {
      e.preventDefault();
      const name = document.getElementById('fbName').value;
      const email = document.getElementById('fbEmail').value;
      const message = document.getElementById('fbMessage').value;
      if (message.trim()) {
        sendFeedback(name, email, message);
        document.getElementById('feedbackModal').classList.remove('active');
        document.getElementById('feedbackForm').reset();
        showToast(t('toast_feedback_sent'), 'success');
      }
    });

    // Welcome modal
    document.getElementById('welcomeGotIt').addEventListener('click', () => {
      document.getElementById('welcomeModal').style.display = 'none';
      localStorage.setItem('desmos-editor-welcomed', 'true');
    });

    if (localStorage.getItem('desmos-editor-welcomed')) {
      document.getElementById('welcomeModal').style.display = 'none';
    }

    // Close context menu on outside click
    document.addEventListener('click', (e) => {
      if (!e.target.closest('.context-menu')) {
        document.getElementById('contextMenu').classList.remove('active');
      }
    });

    // Update equations list initially
    updateEquationsList();
    updateLayersList();

    // Set initial tool
    setTool('pen');

    // Auto-save periodically
    setInterval(() => {
      if (state.shapes.length > 0) {
        saveProject();
      }
    }, 30000);
  }

  // Start
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
