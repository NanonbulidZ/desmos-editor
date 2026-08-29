// ========================================
// Desmos Equation Editor - Main Application
// Created by nanon dev & mimo opencode
// ========================================

(function() {
  'use strict';

  // ===== DESMOS COORDINATE SYSTEM =====
  // Desmos uses -10 to 10 on both axes
  // World pixels are scaled so 20px = 1 Desmos unit
  const DESMOS_RANGE = 10;
  const DESMOS_SCALE = 20; // pixels per Desmos unit

  function clampDesmos(v) {
    return Math.max(-DESMOS_RANGE, Math.min(DESMOS_RANGE, v));
  }

  function worldToDesmos(wx, wy) {
    const dx = wx / DESMOS_SCALE;
    const dy = -wy / DESMOS_SCALE;
    return { x: clampDesmos(dx), y: clampDesmos(dy) };
  }

  function desmosToWorld(dx, dy) {
    return { x: dx * DESMOS_SCALE, y: -dy * DESMOS_SCALE };
  }

  // ===== EVENT TRACKING (for Admin Console) =====
  const EVENTS_KEY = 'desmos-editor-events';
  const CANVAS_KEY = 'desmos-editor-canvas-snapshot';
  const EQUATIONS_KEY = 'desmos-editor-equations';
  const USERS_KEY = 'desmos-editor-users';

  // Persistent user ID per browser
  function getUserId() {
    let uid = localStorage.getItem('desmos-editor-uid');
    if (!uid) {
      uid = 'user_' + Date.now().toString(36) + '_' + Math.random().toString(36).substr(2, 5);
      localStorage.setItem('desmos-editor-uid', uid);
    }
    return uid;
  }

  let _syncTimer = null;
  function scheduleCloudSync() {
    if (_syncTimer) return;
    _syncTimer = setTimeout(() => {
      _syncTimer = null;
      try {
        if (typeof CloudStorage !== 'undefined') {
          const data = CloudStorage.getLocalData();
          CloudStorage.save(data);
        }
      } catch (e) {}
    }, 2000);
  }

  function trackEvent(category, icon, msg) {
    try {
      const uid = getUserId();
      const events = JSON.parse(localStorage.getItem(EVENTS_KEY) || '[]');
      events.push({
        ts: new Date().toISOString(),
        category,
        icon,
        msg,
        uid,
        session: sessionId
      });
      if (events.length > 500) events.splice(0, events.length - 500);
      localStorage.setItem(EVENTS_KEY, JSON.stringify(events));

      const users = JSON.parse(localStorage.getItem(USERS_KEY) || '{}');
      users[uid] = { lastSeen: new Date().toISOString(), lang: state.lang };
      localStorage.setItem(USERS_KEY, JSON.stringify(users));

      syncDataToCloud();
    } catch (e) { }
  }

  function syncDataToCloud() {
    // Cloud sync disabled for now
  }

  function saveCanvasSnapshot() {
    try {
      const uid = getUserId();
      const dataUrl = canvas.toDataURL('image/png', 0.3);
      const snapshots = JSON.parse(localStorage.getItem(CANVAS_KEY) || '{}');
      snapshots[uid] = dataUrl;
      localStorage.setItem(CANVAS_KEY, JSON.stringify(snapshots));
      syncDataToCloud();
    } catch (e) { }
  }

  function saveEquationsSnapshot() {
    try {
      const uid = getUserId();
      const eqs = state.shapes.map(s => shapeToLatex(s)).filter(l => l).flat();
      const allEqs = [];
      eqs.forEach(eq => eq.split(', ').forEach(e => { if (e.trim()) allEqs.push(e.trim()); }));
      const equations = JSON.parse(localStorage.getItem(EQUATIONS_KEY) || '{}');
      equations[uid] = allEqs;
      localStorage.setItem(EQUATIONS_KEY, JSON.stringify(equations));
      syncDataToCloud();
    } catch (e) { }
  }

  const sessionId = 'sess_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);

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
    snapSizeX: 20,
    snapSizeY: 20,
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
    return {
      x: Math.round(x / state.snapSizeX) * state.snapSizeX,
      y: Math.round(y / state.snapSizeY) * state.snapSizeY
    };
  }

  // ===== GRID + DESMOS BOUNDS =====
  function drawGrid() {
    if (!state.gridVisible) return;
    const sizeX = state.snapSizeX * state.zoom;
    const sizeY = state.snapSizeY * state.zoom;
    if (sizeX < 4 && sizeY < 4) return;

    ctx.save();
    ctx.strokeStyle = state.snapEnabled ? 'rgba(93,173,226,0.12)' : 'rgba(255,255,255,0.04)';
    ctx.lineWidth = 1;

    const offsetX = state.panX % sizeX;
    const offsetY = state.panY % sizeY;

    ctx.beginPath();
    for (let x = offsetX; x < canvasWidth; x += sizeX) {
      ctx.moveTo(x, 0);
      ctx.lineTo(x, canvasHeight);
    }
    for (let y = offsetY; y < canvasHeight; y += sizeY) {
      ctx.moveTo(0, y);
      ctx.lineTo(canvasWidth, y);
    }
    ctx.stroke();

    // Draw axes
    if (state.zoom >= 0.3) {
      ctx.strokeStyle = state.snapEnabled ? 'rgba(93,173,226,0.25)' : 'rgba(255,255,255,0.08)';
      ctx.lineWidth = 1.5;
      const origin = worldToScreen(0, 0);
      ctx.beginPath();
      ctx.moveTo(0, origin.y);
      ctx.lineTo(canvasWidth, origin.y);
      ctx.moveTo(origin.x, 0);
      ctx.lineTo(origin.x, canvasHeight);
      ctx.stroke();

      // Draw axis labels
      ctx.fillStyle = 'rgba(255,255,255,0.25)';
      ctx.font = '10px Inter, sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText('x', canvasWidth - 14, origin.y - 6);
      ctx.textAlign = 'right';
      ctx.fillText('y', origin.x + 12, 14);
    }

    // Draw Desmos bounds (-10 to 10) as a highlighted rectangle
    drawDesmosBounds();

    ctx.restore();
  }

  function drawDesmosBounds() {
    const tl = worldToScreen(-DESMOS_RANGE * DESMOS_SCALE, -DESMOS_RANGE * DESMOS_SCALE);
    const br = worldToScreen(DESMOS_RANGE * DESMOS_SCALE, DESMOS_RANGE * DESMOS_SCALE);
    const w = br.x - tl.x;
    const h = br.y - tl.y;

    // Light fill inside Desmos area
    ctx.fillStyle = 'rgba(93,173,226,0.03)';
    ctx.fillRect(tl.x, tl.y, w, h);

    // Boundary border
    ctx.strokeStyle = 'rgba(93,173,226,0.2)';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([6, 4]);
    ctx.strokeRect(tl.x, tl.y, w, h);
    ctx.setLineDash([]);

    // Corner labels
    if (state.zoom >= 0.3) {
      ctx.fillStyle = 'rgba(93,173,226,0.35)';
      ctx.font = '9px JetBrains Mono, monospace';
      const corners = [
        { x: tl.x + 3, y: tl.y + 12, text: `(-10, ${DESMOS_RANGE})` },
        { x: br.x - 3, y: tl.y + 12, text: `(${DESMOS_RANGE}, ${DESMOS_RANGE})`, align: 'right' },
        { x: tl.x + 3, y: br.y - 4, text: `(-10, -${DESMOS_RANGE})` },
        { x: br.x - 3, y: br.y - 4, text: `(${DESMOS_RANGE}, -${DESMOS_RANGE})`, align: 'right' }
      ];
      corners.forEach(c => {
        ctx.textAlign = c.align || 'left';
        ctx.fillText(c.text, c.x, c.y);
      });

      // Tick marks at integer positions along axes
      const origin = worldToScreen(0, 0);
      ctx.fillStyle = 'rgba(255,255,255,0.2)';
      ctx.font = '8px JetBrains Mono, monospace';
      ctx.textAlign = 'center';
      const step = DESMOS_SCALE * state.zoom;
      // X axis ticks
      for (let i = -DESMOS_RANGE; i <= DESMOS_RANGE; i++) {
        if (i === 0) continue;
        const sx = origin.x + i * step;
        if (sx < tl.x || sx > br.x) continue;
        ctx.fillText(i, sx, origin.y + 12);
        ctx.beginPath();
        ctx.moveTo(sx, origin.y - 3);
        ctx.lineTo(sx, origin.y + 3);
        ctx.strokeStyle = 'rgba(255,255,255,0.15)';
        ctx.lineWidth = 1;
        ctx.stroke();
      }
      // Y axis ticks
      ctx.textAlign = 'right';
      for (let i = -DESMOS_RANGE; i <= DESMOS_RANGE; i++) {
        if (i === 0) continue;
        const sy = origin.y - i * step;
        if (sy < tl.y || sy > br.y) continue;
        ctx.fillText(i, origin.x - 6, sy + 3);
        ctx.beginPath();
        ctx.moveTo(origin.x - 3, sy);
        ctx.lineTo(origin.x + 3, sy);
        ctx.strokeStyle = 'rgba(255,255,255,0.15)';
        ctx.lineWidth = 1;
        ctx.stroke();
      }
    }
  }

  // ===== SHAPE RENDERING =====
  function drawShape(shape, ctx2, selected) {
    ctx2.save();
    ctx2.globalAlpha = shape.opacity;
    ctx2.strokeStyle = shape.color;
    ctx2.lineWidth = shape.strokeWidth;
    ctx2.lineCap = 'round';
    ctx2.lineJoin = 'round';

    switch (shape.type) {
      case 'path': drawPath(shape, ctx2); break;
      case 'line': drawLine(shape, ctx2); break;
      case 'rect': drawRect(shape, ctx2); break;
      case 'ellipse': drawEllipse(shape, ctx2); break;
    }

    if (selected) drawSelectionBox(shape, ctx2);
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
    // Draw endpoint dots
    ctx2.fillStyle = shape.color;
    ctx2.beginPath();
    ctx2.arc(s1.x, s1.y, 3, 0, Math.PI * 2);
    ctx2.fill();
    ctx2.beginPath();
    ctx2.arc(s2.x, s2.y, 3, 0, Math.PI * 2);
    ctx2.fill();
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

    // Show Desmos coordinates for selected shape
    drawShapeDesmosCoords(shape, ctx2);
    ctx2.restore();
  }

  function drawShapeDesmosCoords(shape, ctx2) {
    ctx2.font = '10px JetBrains Mono, monospace';
    ctx2.textAlign = 'left';

    const drawLabel = (wx, wy, label) => {
      const dm = worldToDesmos(wx, wy);
      const s = worldToScreen(wx, wy);
      const text = `(${dm.x.toFixed(1)}, ${dm.y.toFixed(1)})`;
      const tx = s.x + 8;
      const ty = s.y - 8;
      // Background
      const metrics = ctx2.measureText(text);
      ctx2.fillStyle = 'rgba(13,17,23,0.85)';
      ctx2.fillRect(tx - 2, ty - 10, metrics.width + 4, 14);
      ctx2.fillStyle = '#5dade2';
      ctx2.fillText(text, tx, ty);
    };

    switch (shape.type) {
      case 'line':
        drawLabel(shape.x1, shape.y1, 'start');
        drawLabel(shape.x2, shape.y2, 'end');
        break;
      case 'rect':
        drawLabel(shape.x, shape.y, 'top-left');
        drawLabel(shape.x + shape.width, shape.y + shape.height, 'bottom-right');
        break;
      case 'ellipse':
        drawLabel(shape.cx - shape.rx, shape.cy, 'left');
        drawLabel(shape.cx + shape.rx, shape.cy, 'right');
        break;
      case 'path':
        if (shape.points.length > 0) {
          drawLabel(shape.points[0].x, shape.points[0].y, 'start');
          drawLabel(shape.points[shape.points.length - 1].x, shape.points[shape.points.length - 1].y, 'end');
        }
        break;
    }
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
          minX = Math.min(minX, p.x); minY = Math.min(minY, p.y);
          maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y);
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
    ctx.fillStyle = '#0d1117';
    ctx.fillRect(0, 0, canvasWidth, canvasHeight);

    drawGrid();

    state.shapes.forEach((shape, i) => {
      drawShape(shape, ctx, state.selectedShape === i);
    });

    // Current drawing preview
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
      // Show Desmos coords at start and current
      const dm0 = worldToDesmos(pts[0].x, pts[0].y);
      const dm1 = worldToDesmos(pts[pts.length - 1].x, pts[pts.length - 1].y);
      drawLiveDesmosLabel(s0.x, s0.y, dm0);
      const sLast = worldToScreen(pts[pts.length - 1].x, pts[pts.length - 1].y);
      drawLiveDesmosLabel(sLast.x, sLast.y, dm1);
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
      const mouseWorld = screenToWorld(state.mouseX, state.mouseY);
      const s2 = worldToScreen(mouseWorld.x, mouseWorld.y);
      ctx.beginPath();
      ctx.moveTo(s1.x, s1.y);
      ctx.lineTo(s2.x, s2.y);
      ctx.stroke();
      ctx.setLineDash([]);
      // Show Desmos coords at both endpoints
      const dm1 = worldToDesmos(state.rectStart.x, state.rectStart.y);
      const dm2 = worldToDesmos(mouseWorld.x, mouseWorld.y);
      drawLiveDesmosLabel(s1.x, s1.y, dm1);
      drawLiveDesmosLabel(s2.x, s2.y, dm2);
      ctx.restore();
    }

    // Preview rect / ellipse
    if ((state.tool === 'rect' || state.tool === 'ellipse') && state.rectStart) {
      ctx.save();
      ctx.strokeStyle = state.color;
      ctx.lineWidth = state.strokeWidth;
      ctx.setLineDash([6, 4]);
      ctx.globalAlpha = 0.6;
      const s1 = worldToScreen(state.rectStart.x, state.rectStart.y);
      const mouseWorld = screenToWorld(state.mouseX, state.mouseY);
      const s2 = worldToScreen(mouseWorld.x, mouseWorld.y);
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
      // Show Desmos coords at corners
      const dm1 = worldToDesmos(state.rectStart.x, state.rectStart.y);
      const dm2 = worldToDesmos(mouseWorld.x, mouseWorld.y);
      drawLiveDesmosLabel(s1.x, s1.y, dm1);
      drawLiveDesmosLabel(s2.x, s2.y, dm2);
      ctx.restore();
    }

    updateCanvasInfo();
  }

  function drawLiveDesmosLabel(sx, sy, dm) {
    const text = `(${dm.x.toFixed(1)}, ${dm.y.toFixed(1)})`;
    ctx.save();
    ctx.font = '10px JetBrains Mono, monospace';
    const metrics = ctx.measureText(text);
    const tx = sx + 10;
    const ty = sy - 10;
    ctx.fillStyle = 'rgba(13,17,23,0.9)';
    ctx.fillRect(tx - 3, ty - 11, metrics.width + 6, 15);
    ctx.strokeStyle = 'rgba(93,173,226,0.5)';
    ctx.lineWidth = 1;
    ctx.strokeRect(tx - 3, ty - 11, metrics.width + 6, 15);
    ctx.fillStyle = '#4ecdc4';
    ctx.fillText(text, tx, ty);
    ctx.restore();
  }

  function updateCanvasInfo() {
    const world = screenToWorld(state.mouseX, state.mouseY);
    const dm = worldToDesmos(world.x, world.y);
    document.getElementById('infoCoords').textContent =
      `Pixel: ${Math.round(world.x)}, ${Math.round(world.y)}  |  Desmos: ${dm.x.toFixed(2)}, ${dm.y.toFixed(2)}`;
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
    canvas.addEventListener('touchstart', onTouchStart, { passive: false });
    canvas.addEventListener('touchmove', onTouchMove, { passive: false });
    canvas.addEventListener('touchend', onTouchEnd);
    document.addEventListener('keydown', onKeyDown);
  }

  function onMouseDown(e) {
    const rect = canvas.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    const world = screenToWorld(sx, sy);
    const snapped = snapPoint(world.x, world.y);

    if (e.button === 1) {
      state.isPanning = true;
      state.panStart = { x: e.clientX - state.panX, y: e.clientY - state.panY };
      canvas.style.cursor = 'grabbing';
      return;
    }

    if (state.tool === 'pan') {
      state.isPanning = true;
      state.panStart = { x: e.clientX - state.panX, y: e.clientY - state.panY };
      canvas.style.cursor = 'grabbing';
      return;
    }

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
        const last = state.currentPath[state.currentPath.length - 1];
        if (last) {
          const dist = Math.hypot(snapped.x - last.x, snapped.y - last.y);
          if (dist < 2) return;
        }
        state.currentPath.push({ x: snapped.x, y: snapped.y });
      }
      render();
      return;
    }

    // Not drawing, not panning, not dragging — still render if mouse moves (for hover effects)
    render();
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

    const shapeNames = { path: 'Freehand path', line: 'Line', rect: 'Rectangle', ellipse: 'Ellipse' };

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
      trackEvent('shape', '✏️', `Drew a <strong>freehand path</strong> (${state.currentPath.length} points)`);
    } else if (state.tool === 'line' && state.rectStart) {
      state.shapes.push({
        type: 'line',
        x1: state.rectStart.x, y1: state.rectStart.y,
        x2: snapped.x, y2: snapped.y,
        color: state.color,
        strokeWidth: state.strokeWidth,
        opacity: state.opacity,
        name: `Line ${state.shapes.length + 1}`,
        visible: true
      });
      state.stats.drawings++;
      const d1 = worldToDesmos(state.rectStart.x, state.rectStart.y);
      const d2 = worldToDesmos(snapped.x, snapped.y);
      trackEvent('shape', '📏', `Drew a <strong>line</strong> from (${d1.x.toFixed(1)}, ${d1.y.toFixed(1)}) to (${d2.x.toFixed(1)}, ${d2.y.toFixed(1)})`);
    } else if (state.tool === 'rect' && state.rectStart) {
      const x = Math.min(state.rectStart.x, snapped.x);
      const y = Math.min(state.rectStart.y, snapped.y);
      state.shapes.push({
        type: 'rect', x, y,
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
      trackEvent('shape', '⬜', `Drew a <strong>rectangle</strong>`);
    } else if (state.tool === 'ellipse' && state.rectStart) {
      const cx = (state.rectStart.x + snapped.x) / 2;
      const cy = (state.rectStart.y + snapped.y) / 2;
      state.shapes.push({
        type: 'ellipse', cx, cy,
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
      trackEvent('shape', '⭕', `Drew an <strong>ellipse</strong>`);
    }

    state.rectStart = null;
    state.currentPath = [];
    saveStats();
    saveCanvasSnapshot();
    saveEquationsSnapshot();
    updateLayersList();
    updateEquationsList();
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

  function onTouchStart(e) {
    e.preventDefault();
    const touch = e.touches[0];
    canvas.dispatchEvent(new MouseEvent('mousedown', { clientX: touch.clientX, clientY: touch.clientY, button: 0 }));
  }
  function onTouchMove(e) {
    e.preventDefault();
    const touch = e.touches[0];
    canvas.dispatchEvent(new MouseEvent('mousemove', { clientX: touch.clientX, clientY: touch.clientY }));
  }
  function onTouchEnd() {
    canvas.dispatchEvent(new MouseEvent('mouseup', {}));
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
        shape.points.forEach(p => { p.x += offsetX; p.y += offsetY; });
        break;
      }
      case 'line':
        shape.x1 += dx; shape.y1 += dy;
        shape.x2 += dx; shape.y2 += dy;
        break;
      case 'rect':
        shape.x += dx; shape.y += dy;
        break;
      case 'ellipse':
        shape.cx += dx; shape.cy += dy;
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
    trackEvent('action', '↩', `<strong>Undo</strong> (${state.shapes.length} shapes remaining)`);
    updateLayersList();
    updateEquationsList();
    saveCanvasSnapshot();
    render();
  }

  function redo() {
    if (state.redoStack.length === 0) return;
    state.undoStack.push(JSON.parse(JSON.stringify(state.shapes)));
    state.shapes = state.redoStack.pop();
    state.selectedShape = null;
    trackEvent('action', '↪', `<strong>Redo</strong> (${state.shapes.length} shapes)`);
    updateLayersList();
    updateEquationsList();
    saveCanvasSnapshot();
    render();
  }

  // ===== TOOL MANAGEMENT =====
  function setTool(tool) {
    state.tool = tool;
    document.querySelectorAll('.tool-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.tool === tool);
    });
    canvas.style.cursor = getCursorForTool();
    const toolNames = { select:'Select', pen:'Pen', line:'Line', rect:'Rectangle', ellipse:'Ellipse', erase:'Eraser', pan:'Pan', zoomIn:'Zoom In', zoomOut:'Zoom Out' };
    trackEvent('tool', '🔧', `<strong>${toolNames[tool] || tool}</strong> tool selected`);
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
    trackEvent('action', '⊞', `Grid <strong>${state.gridVisible ? 'shown' : 'hidden'}</strong>`);
    render();
  }

  function toggleSnap() {
    state.snapEnabled = !state.snapEnabled;
    document.getElementById('snapToggle').classList.toggle('active', state.snapEnabled);
    document.getElementById('snapSwitch').classList.toggle('active', state.snapEnabled);
    // Update snap visual indicator
    updateSnapVisual();
    // Show/hide snap status bar
    const snapStatus = document.getElementById('snapStatus');
    if (snapStatus) {
      snapStatus.classList.toggle('visible', state.snapEnabled);
    }
    trackEvent('action', '⊡', `Snap mode <strong>${state.snapEnabled ? 'ENABLED' : 'disabled'}</strong>`);
    render();
  }

  function updateSnapVisual() {
    const snapBtn = document.getElementById('snapToggle');
    const snapLabel = document.getElementById('snapStatusLabel');
    const snapLabel2 = document.getElementById('snapStatusLabel2');
    if (state.snapEnabled) {
      snapBtn.classList.add('snap-on');
      snapBtn.textContent = 'Snap ON';
      if (snapLabel) snapLabel.textContent = i18nData['snap_enable'] || 'Snap ON';
      if (snapLabel2) snapLabel2.textContent = i18nData['snap_enable'] || 'Snap ON';
    } else {
      snapBtn.classList.remove('snap-on');
      snapBtn.textContent = 'Snap';
      if (snapLabel) snapLabel.textContent = i18nData['snap_disable'] || 'Free Draw';
      if (snapLabel2) snapLabel2.textContent = i18nData['snap_disable'] || 'Free Draw';
    }
    // Sync snap status bar visibility
    const snapStatus = document.getElementById('snapStatus');
    if (snapStatus) {
      snapStatus.classList.toggle('visible', state.snapEnabled);
    }
  }

  // ===== EQUATION CONVERSION (with Desmos bounds clamping) =====
  // ===== SIMPLE LINE SEGMENT EQUATIONS =====
  // Format: y = mx+b(xmin<x<xmax) or x = c(ymin<y<ymax)
  function formatLineSeg(x1, y1, x2, y2) {
    return formatSeg(r(x1), r(y1), r(x2), r(y2));
  }

  function formatSeg(x1, y1, x2, y2) {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const OVL = 0.03;

    if (Math.abs(dx) < 0.01) {
      const yA = Math.min(y1,y2) - OVL;
      const yB = Math.max(y1,y2) + OVL;
      return `x = ${x1}\\left\\{${r(yA)}\\le y\\le${r(yB)}\\right\\}`;
    }

    const m = dy / dx;
    const b = y1 - m * x1;
    const xA = Math.min(x1,x2) - OVL;
    const xB = Math.max(x1,x2) + OVL;

    if (Math.abs(m) < 0.001) {
      return `y = ${r(b)}\\left\\{${r(xA)}\\le x\\le${r(xB)}\\right\\}`;
    }

    const sign = b >= 0 ? '+' : '';
    return `y = ${rd(m)}x${sign}${rd(b)}\\left\\{${r(xA)}\\le x\\le${r(xB)}\\right\\}`;
  }

  function r(v) {
    return parseFloat(v.toFixed(2));
  }

  function rd(v) {
    return parseFloat(v.toFixed(6));
  }

  function simplifyPath(pts) {
    // Douglas-Peucker line simplification
    if (pts.length <= 2) return pts;
    const tolerance = 0.3;

    function perpDist(p, a, b) {
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const len = Math.sqrt(dx * dx + dy * dy);
      if (len === 0) return Math.hypot(p.x - a.x, p.y - a.y);
      return Math.abs(dy * p.x - dx * p.y + b.x * a.y - b.y * a.x) / len;
    }

    function simplify(pts, first, last, keep) {
      let maxDist = 0;
      let maxIdx = first;
      for (let i = first + 1; i < last; i++) {
        const d = perpDist(pts[i], pts[first], pts[last]);
        if (d > maxDist) { maxDist = d; maxIdx = i; }
      }
      if (maxDist > tolerance) {
        simplify(pts, first, maxIdx, keep);
        simplify(pts, maxIdx, last, keep);
      } else {
        keep.push(pts[last]);
      }
    }

    const kept = [pts[0]];
    simplify(pts, 0, pts.length - 1, kept);
    return kept;
  }

  function shapeToLatex(shape) {
    switch (shape.type) {
      case 'line': {
        const d1 = worldToDesmos(shape.x1, shape.y1);
        const d2 = worldToDesmos(shape.x2, shape.y2);
        return formatLineSeg(d1.x, d1.y, d2.x, d2.y);
      }
      case 'rect': {
        const tl = worldToDesmos(shape.x, shape.y);
        const br = worldToDesmos(shape.x + shape.width, shape.y + shape.height);
        const L = r(Math.min(tl.x, br.x));
        const R = r(Math.max(tl.x, br.x));
        const T = r(Math.max(tl.y, br.y));
        const B = r(Math.min(tl.y, br.y));
        return [
          formatSeg(L, T, R, T),
          formatSeg(R, T, R, B),
          formatSeg(R, B, L, B),
          formatSeg(L, B, L, T)
        ].join(', ');
      }
      case 'ellipse': {
        const d = worldToDesmos(shape.cx, shape.cy);
        const cx = d.x;
        const cy = d.y;
        const rx = Math.abs(shape.rx / DESMOS_SCALE);
        const ry = Math.abs(shape.ry / DESMOS_SCALE);
        const numSegs = 24;
        let prevX = r(cx + rx);
        let prevY = r(cy);
        const segs = [];
        for (let i = 1; i <= numSegs; i++) {
          const a = (i / numSegs) * Math.PI * 2;
          const curX = r(cx + rx * Math.cos(a));
          const curY = r(cy + ry * Math.sin(a));
          segs.push(formatSeg(prevX, prevY, curX, curY));
          prevX = curX;
          prevY = curY;
        }
        return segs.join(', ');
      }
      case 'path': {
        const pts = shape.points.map(p => worldToDesmos(p.x, p.y));
        const simplified = simplifyPath(pts);
        if (simplified.length < 2) return '';
        const rounded = simplified.map(p => ({ x: r(p.x), y: r(p.y) }));
        const segs = [];
        for (let i = 0; i < rounded.length - 1; i++) {
          segs.push(formatSeg(rounded[i].x, rounded[i].y, rounded[i + 1].x, rounded[i + 1].y));
        }
        return segs.join(', ');
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

    // Each shape may produce comma-separated equations, split them
    const allEqs = [];
    state.shapes.forEach(s => {
      const latex = shapeToLatex(s);
      if (latex) {
        latex.split(', ').forEach(eq => {
          const trimmed = eq.trim();
          if (trimmed) allEqs.push(trimmed);
        });
      }
    });

    trackEvent('export', '📤', `Exported <strong>${allEqs.length} equation${allEqs.length !== 1 ? 's' : ''}</strong> to Desmos`);

    if (window.Desmos) {
      try {
        const elt = document.getElementById('desmosCalculator');
        elt.style.display = 'block';
        const calc = Desmos.GraphingCalculator(elt, {
          expressions: true, settingsMenu: false, zoomButtons: true,
          keypad: false, border: true, lockViewport: false
        });
        let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
        state.shapes.forEach(s => {
          const b = getShapeBounds(s);
          const tl = worldToDesmos(b.x, b.y);
          const br = worldToDesmos(b.x + b.w, b.y + b.h);
          minX = Math.min(minX, tl.x, br.x);
          maxX = Math.max(maxX, tl.x, br.x);
          minY = Math.min(minY, tl.y, br.y);
          maxY = Math.max(maxY, tl.y, br.y);
        });
        if (!isFinite(minX)) { minX = -10; maxX = 10; minY = -10; maxY = 10; }
        const padX = Math.max((maxX - minX) * 0.15, 1);
        const padY = Math.max((maxY - minY) * 0.15, 1);
        calc.setMathBounds({ left: minX - padX, right: maxX + padX, bottom: minY - padY, top: maxY + padY });
        allEqs.forEach(eq => calc.setExpression({ latex: eq }));
        showToast(t('toast_exported'), 'success');
      } catch (e) {
        copyToClipboard(allEqs.join('\n'));
      }
    } else {
      copyToClipboard(allEqs.join('\n'));
    }
  }

  function copyToClipboard(text) {
    navigator.clipboard.writeText(text).then(() => {
      showToast(t('toast_copied'), 'success');
    }).catch(() => {
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      showToast(t('toast_copied'), 'success');
    });
  }

  function copyLaTeX() {
    const allEqs = [];
    state.shapes.forEach(s => {
      const latex = shapeToLatex(s);
      if (latex) {
        latex.split(', ').forEach(eq => {
          const trimmed = eq.trim();
          if (trimmed) allEqs.push(trimmed);
        });
      }
    });
    copyToClipboard(allEqs.join('\n'));
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
    a.href = url; a.download = 'desmos-drawing.svg'; a.click();
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
    updateEquationsList();
    render();
  }

  // ===== SAVE/LOAD PROJECT =====
  function saveProject() {
    const data = {
      version: 1,
      shapes: state.shapes,
      settings: { zoom: state.zoom, panX: state.panX, panY: state.panY, gridVisible: state.gridVisible, snapEnabled: state.snapEnabled }
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
        updateEquationsList();
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
    trackEvent('action', '🗑', `<strong>Cleared all shapes</strong>`);
    saveCanvasSnapshot();
    updateLayersList();
    updateEquationsList();
    render();
    showToast(t('toast_cleared'), 'success');
  }

  // ===== FEEDBACK =====
  function sendFeedback(name, email, message) {
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
      // Split comma-separated equations
      const eqs = latex.split(', ').map(e => e.trim()).filter(e => e);
      const item = document.createElement('div');
      item.className = 'equation-item';
      item.innerHTML = `
        <button class="eq-delete" data-idx="${i}" title="Delete">✕</button>
        <div style="font-size:10px;color:var(--text-muted);margin-bottom:4px;">${shape.name} (${eqs.length} segments)</div>
        ${eqs.map(eq => `<div style="margin-bottom:2px;">${eq}</div>`).join('')}
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
    loadLanguage(state.lang);
    trackVisit();
    updateStatsDisplay();

    // Safe event binding helper
    function bind(id, evt, fn) {
      const el = document.getElementById(id);
      if (el) el.addEventListener(evt, fn);
    }

    const hasProject = localStorage.getItem('desmos-editor-project');
    if (hasProject) {
      try { loadProject(); } catch (e) { console.warn('Project load failed:', e); }
    }

    document.querySelectorAll('.tool-btn[data-tool]').forEach(btn => {
      btn.addEventListener('click', () => setTool(btn.dataset.tool));
    });

    document.querySelectorAll('.preset-btn[data-preset]').forEach(btn => {
      btn.addEventListener('click', () => addPreset(btn.dataset.preset));
    });

    bind('snapSwitch', 'click', toggleSnap);
    bind('snapToggle', 'click', toggleSnap);
    bind('gridToggle', 'click', toggleGrid);

    bind('btnUndo', 'click', undo);
    bind('btnRedo', 'click', redo);
    bind('btnClear', 'click', clearAll);
    bind('btnExport', 'click', exportToDesmos);
    bind('btnCopyLatex', 'click', copyLaTeX);
    bind('btnExportSvg', 'click', exportSVG);
    bind('btnSave', 'click', saveProject);

    bind('langSelect', 'change', (e) => loadLanguage(e.target.value));

    bind('propStrokeColor', 'input', applyPropertyChange);
    bind('propStrokeWidth', 'input', applyPropertyChange);
    bind('propOpacity', 'input', applyPropertyChange);
    bind('propSmooth', 'input', (e) => {
      const el = document.getElementById('propSmoothVal');
      if (el) el.textContent = (e.target.value / 100).toFixed(1);
      applyPropertyChange();
    });

    bind('snapSizeX', 'change', (e) => {
      state.snapSizeX = parseInt(e.target.value);
      const numEl = document.getElementById('snapSizeXNum');
      if (numEl) numEl.value = state.snapSizeX;
      render();
    });
    bind('snapSizeY', 'change', (e) => {
      state.snapSizeY = parseInt(e.target.value);
      const numEl = document.getElementById('snapSizeYNum');
      if (numEl) numEl.value = state.snapSizeY;
      render();
    });
    bind('snapSizeXNum', 'input', (e) => {
      const v = parseInt(e.target.value) || 20;
      state.snapSizeX = Math.max(1, Math.min(100, v));
      const sel = document.getElementById('snapSizeX');
      if (sel) sel.value = state.snapSizeX;
      render();
    });
    bind('snapSizeYNum', 'input', (e) => {
      const v = parseInt(e.target.value) || 20;
      state.snapSizeY = Math.max(1, Math.min(100, v));
      const sel = document.getElementById('snapSizeY');
      if (sel) sel.value = state.snapSizeY;
      render();
    });

    bind('ctxDelete', 'click', () => {
      const idx = parseInt(document.getElementById('contextMenu').dataset.idx);
      pushUndo();
      state.shapes.splice(idx, 1);
      state.selectedShape = null;
      updateLayersList();
      updateEquationsList();
      render();
      document.getElementById('contextMenu').classList.remove('active');
    });

    bind('ctxDuplicate', 'click', () => {
      const idx = parseInt(document.getElementById('contextMenu').dataset.idx);
      pushUndo();
      const clone = JSON.parse(JSON.stringify(state.shapes[idx]));
      clone.name += ' Copy';
      state.shapes.push(clone);
      updateLayersList();
      updateEquationsList();
      render();
      document.getElementById('contextMenu').classList.remove('active');
    });

    bind('ctxBringFront', 'click', () => {
      const idx = parseInt(document.getElementById('contextMenu').dataset.idx);
      pushUndo();
      const shape = state.shapes.splice(idx, 1)[0];
      state.shapes.push(shape);
      state.selectedShape = state.shapes.length - 1;
      updateLayersList();
      render();
      document.getElementById('contextMenu').classList.remove('active');
    });

    bind('ctxSendBack', 'click', () => {
      const idx = parseInt(document.getElementById('contextMenu').dataset.idx);
      pushUndo();
      const shape = state.shapes.splice(idx, 1)[0];
      state.shapes.unshift(shape);
      state.selectedShape = 0;
      updateLayersList();
      render();
      document.getElementById('contextMenu').classList.remove('active');
    });

    bind('btnFeedback', 'click', () => {
      document.getElementById('feedbackModal').classList.add('active');
    });

    bind('feedbackCancel', 'click', () => {
      document.getElementById('feedbackModal').classList.remove('active');
    });

    bind('feedbackForm', 'submit', (e) => {
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

    // Welcome modal - ALWAYS register the click handler first
    bind('welcomeGotIt', 'click', () => {
      const modal = document.getElementById('welcomeModal');
      if (modal) modal.style.display = 'none';
      localStorage.setItem('desmos-editor-welcomed', 'true');
    });

    // Then check if already welcomed
    if (localStorage.getItem('desmos-editor-welcomed')) {
      const modal = document.getElementById('welcomeModal');
      if (modal) modal.style.display = 'none';
    }

    document.addEventListener('click', (e) => {
      if (!e.target.closest('.context-menu')) {
        const ctx = document.getElementById('contextMenu');
        if (ctx) ctx.classList.remove('active');
      }
    });

    updateEquationsList();
    updateLayersList();
    setTool('pen');

    // Periodic save + admin snapshot
    setInterval(() => {
      if (state.shapes.length > 0) {
        saveProject();
        saveCanvasSnapshot();
        saveEquationsSnapshot();
      }
    }, 10000);

    // Track page visit with user ID
    const uid = getUserId();
    trackEvent('system', '👤', `User <strong>${uid}</strong> opened the editor`);
    saveCanvasSnapshot();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
