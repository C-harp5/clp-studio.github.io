(function () {
    'use strict';

    const app = window.SimulateApp;
    const {
        LED_COLORS,
        state,
        posKey,
        formatResistance,
        getPlcTerminalSpecs,
        getComponentPins
    } = app;

    function escapeXml(str) {
        return String(str ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    function buildResistorColorBands(ohms) {
        const palette = ['#0f172a', '#78350f', '#dc2626', '#ea580c', '#eab308', '#16a34a', '#2563eb', '#9333ea', '#64748b', '#f8fafc'];
        const v = Math.max(1, Math.round(Number(ohms) || 1000));
        const s = String(v);
        const d1 = Number(s[0]) || 1;
        const d2 = Number(s[1] ?? 0) || 0;
        const mult = Math.max(0, Math.min(9, s.length - 2));
        return [palette[d1], palette[d2], palette[mult], '#eab308'];
    }

    function getWireVisualStroke(wireId, isSelected) {
        const info = state.simResults.wireEnergized[wireId] || {};
        if (info.energized) return '#10b981';
        if (info.activeLow) return '#34d399';
        return isSelected ? '#38bdf8' : '#64748b';
    }

    function renderPlc() {
        const layer = document.getElementById('plcLayer');
        const spec = getPlcTerminalSpecs();
        const isSelected = state.selectedId === 'PLC';
        const plcBits = state.program?.bits || {};
        const sentInputs = state.simResults?.sentInputs || {};
        const plcTags = state.program?.tags || {};

        let svg = `
      <g class="plc-group ${isSelected ? 'selected' : ''}" data-entity-id="PLC" transform="translate(${spec.x}, ${spec.y})">
        <rect class="plc-sel-box" x="-6" y="-6" width="${spec.width + 12}" height="${spec.height + 12}" rx="14"
              fill="none" stroke="#38bdf8" stroke-width="2" stroke-dasharray="5 3" />

        <rect x="0" y="0" width="${spec.width}" height="${spec.height}" rx="10"
              fill="#131c2e" stroke="#38bdf8" stroke-width="2" />

        <rect x="0" y="0" width="${spec.width}" height="28" rx="10" fill="#090e1a" />
        <rect x="0" y="18" width="${spec.width}" height="10" fill="#090e1a" />
        <text x="12" y="18" fill="#f8fafc" font-family="monospace" font-size="11" font-weight="800">
          ${escapeXml(spec.modelName.slice(0, 20))}
        </text>
        <circle cx="${spec.width - 14}" cy="14" r="4" fill="#10b981" />

        <line x1="0" y1="60" x2="${spec.width}" y2="60" stroke="#334155" stroke-width="1.2" />
        <text x="12" y="74" fill="#64748b" font-family="sans-serif" font-size="9" font-weight="700">ENTRADAS (I)</text>
        <text x="${spec.width - 12}" y="74" text-anchor="end" fill="#64748b" font-family="sans-serif" font-size="9" font-weight="700">SAÍDAS (Q)</text>
    `;

        spec.pins.forEach(p => {
            const lx = p.x - spec.x;
            const ly = p.y - spec.y;
            const isLeft = p.side === 'left';

            let ledColor = '#334155';
            let labelColor = '#cbd5e1';

            if (p.kind === 'POWER_24') {
                ledColor = '#f43f5e';
                labelColor = '#fda4af';
            } else if (p.kind === 'POWER_0') {
                ledColor = '#38bdf8';
                labelColor = '#7dd3fc';
            } else if (p.kind === 'PLC_IN') {
                const active = Boolean(plcBits[p.addr] || sentInputs[p.addr]);
                ledColor = active ? '#10b981' : '#334155';
                labelColor = active ? '#34d399' : '#e2e8f0';
            } else if (p.kind === 'PLC_OUT') {
                const active = Boolean(plcBits[p.addr]);
                ledColor = active ? '#f59e0b' : '#334155';
                labelColor = active ? '#fcd34d' : '#e2e8f0';
            }

            const tag = p.addr && plcTags[p.addr] ? plcTags[p.addr] : '';

            if (isLeft) {
                svg += `
          <circle class="plc-pin-led" data-plc-pin="${p.id}" cx="${lx + 14}" cy="${ly}" r="3.5" fill="${ledColor}" />
          <text class="plc-pin-lbl" data-plc-pin-lbl="${p.id}" x="${lx + 23}" y="${ly + 3.5}" fill="${labelColor}" font-family="monospace" font-size="10.5" font-weight="800">${escapeXml(p.label)}</text>
          ${tag ? `<text x="${lx + 46}" y="${ly + 3}" fill="#64748b" font-family="sans-serif" font-size="8.5">${escapeXml(tag.slice(0, 7))}</text>` : ''}
        `;
            } else {
                svg += `
          <circle class="plc-pin-led" data-plc-pin="${p.id}" cx="${lx - 14}" cy="${ly}" r="3.5" fill="${ledColor}" />
          <text class="plc-pin-lbl" data-plc-pin-lbl="${p.id}" x="${lx - 23}" y="${ly + 3.5}" text-anchor="end" fill="${labelColor}" font-family="monospace" font-size="10.5" font-weight="800">${escapeXml(p.label)}</text>
          ${tag ? `<text x="${lx - 46}" y="${ly + 3}" text-anchor="end" fill="#64748b" font-family="sans-serif" font-size="8.5">${escapeXml(tag.slice(0, 7))}</text>` : ''}
        `;
            }

            svg += `
        <circle class="pin-hit-area" cx="${lx}" cy="${ly}" r="10" fill="transparent"
                data-pin-x="${p.x}" data-pin-y="${p.y}" data-pin-label="${escapeXml(p.label)}" />
        <circle class="pin-dot" cx="${lx}" cy="${ly}" r="4.5" fill="#0f172a" stroke="#38bdf8" stroke-width="1.8" pointer-events="none" />
      `;
        });

        svg += `</g>`;
        layer.innerHTML = svg;
    }

    function renderComponentSvg(comp) {
        const isSelected = state.selectedId === comp.id;
        const rot = comp.rotation || 0;
        const metrics = state.simResults.compMetrics[comp.id] || {};
        const pins = getComponentPins(comp);

        let bodySvg = '';

        if (comp.type === 'RESISTOR') {
            const bands = buildResistorColorBands(comp.resistance);
            const valText = formatResistance(comp.resistance);
            bodySvg = `
        <g transform="rotate(${rot})">
          <rect class="comp-sel-box" x="-44" y="-22" width="88" height="44" rx="8" fill="none" stroke="#38bdf8" stroke-width="1.8" stroke-dasharray="4 3" />
          <line x1="-40" y1="0" x2="-22" y2="0" stroke="#94a3b8" stroke-width="2.5" />
          <line x1="22" y1="0" x2="40" y2="0" stroke="#94a3b8" stroke-width="2.5" />
          <rect x="-22" y="-9" width="44" height="18" rx="4" fill="#d6c5a9" stroke="#78716c" stroke-width="1.5" />
          <rect x="-15" y="-8.5" width="3.5" height="17" fill="${bands[0]}" />
          <rect x="-7" y="-8.5" width="3.5" height="17" fill="${bands[1]}" />
          <rect x="1" y="-8.5" width="3.5" height="17" fill="${bands[2]}" />
          <rect x="12" y="-8.5" width="3" height="17" fill="${bands[3]}" />
        </g>
        <text x="0" y="-16" text-anchor="middle" fill="#7dd3fc" font-family="monospace" font-size="11" font-weight="800" class="comp-val-label">
          ${escapeXml(valText)}
        </text>
        ${comp.label ? `<text x="0" y="24" text-anchor="middle" fill="#94a3b8" font-family="sans-serif" font-size="9.5">${escapeXml(comp.label)}</text>` : ''}
      `;
        } else if (comp.type === 'LED') {
            const colorInfo = LED_COLORS[comp.color] || LED_COLORS.green;
            const brightness = metrics.brightness || 0;
            const isLit = brightness > 0.05;
            const over = metrics.overcurrent;

            bodySvg = `
        <g transform="rotate(${rot})">
          <rect class="comp-sel-box" x="-44" y="-24" width="88" height="48" rx="8" fill="none" stroke="#38bdf8" stroke-width="1.8" stroke-dasharray="4 3" />
          <line x1="-40" y1="0" x2="-14" y2="0" stroke="#94a3b8" stroke-width="2.5" />
          <line x1="14" y1="0" x2="40" y2="0" stroke="#94a3b8" stroke-width="2.5" />
          <circle class="led-halo" cx="0" cy="0" r="${14 + brightness * 10}" fill="${colorInfo.glow}"
                  opacity="${isLit ? (0.25 + brightness * 0.55) : 0}" filter="url(#ledGlowFilter)" pointer-events="none" />
          <polygon class="led-body" points="-12,-11 -12,11 10,0" fill="${isLit ? colorInfo.hex : '#1e293b'}" stroke="${colorInfo.hex}" stroke-width="2.2" />
          <line x1="10" y1="-11" x2="10" y2="11" stroke="${colorInfo.hex}" stroke-width="2.5" />
          <line x1="2" y1="-14" x2="8" y2="-20" stroke="${colorInfo.hex}" stroke-width="1.6" />
          <line x1="8" y1="-11" x2="14" y2="-17" stroke="${colorInfo.hex}" stroke-width="1.6" />
          <text x="-23" y="-6" fill="#94a3b8" font-family="monospace" font-size="10" font-weight="800">+</text>
          <text x="20" y="-6" fill="#94a3b8" font-family="monospace" font-size="10" font-weight="800">-</text>
        </g>
        <text class="led-status-lbl" x="0" y="-22" text-anchor="middle" fill="${over ? '#fda4af' : '#e2e8f0'}" font-family="monospace" font-size="10" font-weight="800">
          ${over ? `⚠ ${(metrics.currentMa || 0).toFixed(0)}mA!` : escapeXml(comp.label || `LED ${colorInfo.label}`)}
        </text>
      `;
        } else if (comp.type === 'BUTTON') {
            const closed = Boolean(comp.pressed);
            bodySvg = `
        <g transform="rotate(${rot})">
          <rect class="comp-sel-box" x="-44" y="-24" width="88" height="48" rx="8" fill="none" stroke="#38bdf8" stroke-width="1.8" stroke-dasharray="4 3" />
          <line x1="-40" y1="0" x2="-16" y2="0" stroke="#94a3b8" stroke-width="2.5" />
          <line x1="16" y1="0" x2="40" y2="0" stroke="#94a3b8" stroke-width="2.5" />
          <circle cx="-16" cy="0" r="3.5" fill="#38bdf8" />
          <circle cx="16" cy="0" r="3.5" fill="#38bdf8" />
          <line class="btn-bar" x1="-18" y1="${closed ? -2 : -11}" x2="18" y2="${closed ? -2 : -11}" stroke="${closed ? '#10b981' : '#38bdf8'}" stroke-width="2.8" />
          <line class="btn-stem" x1="0" y1="${closed ? -11 : -20}" x2="0" y2="${closed ? -2 : -11}" stroke="${closed ? '#10b981' : '#38bdf8'}" stroke-width="2.5" />
          <rect class="btn-cap" x="-12" y="${closed ? -15 : -24}" width="24" height="5" rx="2" fill="${closed ? '#10b981' : '#38bdf8'}" />
        </g>
        <text x="0" y="21" text-anchor="middle" fill="#94a3b8" font-family="sans-serif" font-size="10" font-weight="700">
          ${escapeXml(comp.label || 'Botão (Segure)')}
        </text>
      `;
        } else if (comp.type === 'SWITCH') {
            const closed = Boolean(comp.closed);
            bodySvg = `
        <g transform="rotate(${rot})">
          <rect class="comp-sel-box" x="-44" y="-24" width="88" height="48" rx="8" fill="none" stroke="#38bdf8" stroke-width="1.8" stroke-dasharray="4 3" />
          <line x1="-40" y1="0" x2="-16" y2="0" stroke="#94a3b8" stroke-width="2.5" />
          <line x1="16" y1="0" x2="40" y2="0" stroke="#94a3b8" stroke-width="2.5" />
          <circle cx="-16" cy="0" r="3.5" fill="#10b981" />
          <circle cx="16" cy="0" r="3.5" fill="#10b981" />
          <line class="sw-lever" x1="-16" y1="0" x2="${closed ? 16 : 12}" y2="${closed ? 0 : -15}" stroke="${closed ? '#10b981' : '#f59e0b'}" stroke-width="3" stroke-linecap="round" />
        </g>
        <text class="sw-lbl" x="0" y="21" text-anchor="middle" fill="${closed ? '#34d399' : '#94a3b8'}" font-family="sans-serif" font-size="10" font-weight="700">
          ${escapeXml(comp.label || (closed ? 'Chave ON' : 'Chave OFF'))}
        </text>
      `;
        } else if (comp.type === 'VCC') {
            bodySvg = `
        <rect class="comp-sel-box" x="-24" y="-28" width="48" height="42" rx="8" fill="none" stroke="#38bdf8" stroke-width="1.8" stroke-dasharray="4 3" />
        <line x1="0" y1="0" x2="0" y2="-14" stroke="#f43f5e" stroke-width="2.5" />
        <line x1="-12" y1="-14" x2="12" y2="-14" stroke="#f43f5e" stroke-width="3" />
        <text x="0" y="-19" text-anchor="middle" fill="#fda4af" font-family="monospace" font-size="10.5" font-weight="800">+24V</text>
      `;
        } else if (comp.type === 'GND') {
            bodySvg = `
        <rect class="comp-sel-box" x="-24" y="-14" width="48" height="42" rx="8" fill="none" stroke="#38bdf8" stroke-width="1.8" stroke-dasharray="4 3" />
        <line x1="0" y1="0" x2="0" y2="12" stroke="#38bdf8" stroke-width="2.5" />
        <line x1="-14" y1="12" x2="14" y2="12" stroke="#38bdf8" stroke-width="2.5" />
        <line x1="-9" y1="17" x2="9" y2="17" stroke="#38bdf8" stroke-width="2.2" />
        <line x1="-4" y1="22" x2="4" y2="22" stroke="#38bdf8" stroke-width="2" />
      `;
        }

        let pinsSvg = '';
        pins.forEach(p => {
            const lx = p.x - comp.x;
            const ly = p.y - comp.y;
            pinsSvg += `
        <circle class="pin-hit-area" cx="${lx}" cy="${ly}" r="10" fill="transparent"
                data-pin-x="${p.x}" data-pin-y="${p.y}" data-pin-label="${escapeXml(p.label)}" />
        <circle class="pin-dot" cx="${lx}" cy="${ly}" r="4.2" fill="#0f172a" stroke="#38bdf8" stroke-width="1.8" pointer-events="none" />
      `;
        });

        return `
      <g class="sim-comp-group ${isSelected ? 'selected' : ''}"
         data-entity-id="${comp.id}"
         data-comp-type="${comp.type}"
         transform="translate(${comp.x}, ${comp.y})">
        ${bodySvg}
        ${pinsSvg}
      </g>
    `;
    }

    function renderComponents() {
        const layer = document.getElementById('componentsLayer');
        layer.innerHTML = state.components.map(renderComponentSvg).join('');
    }

    function renderWires() {
        const layer = document.getElementById('wiresLayer');
        const endpointCounts = new Map();

        let svg = '';
        state.wires.forEach(w => {
            if (!w.points || w.points.length < 2) return;
            const ptsStr = w.points.map(p => `${p.x},${p.y}`).join(' ');
            const isSelected = state.selectedId === w.id;
            const strokeColor = getWireVisualStroke(w.id, isSelected);

            [w.points[0], w.points[w.points.length - 1]].forEach(pt => {
                const k = posKey(pt.x, pt.y);
                endpointCounts.set(k, (endpointCounts.get(k) || 0) + 1);
            });

            let hitSegmentsSvg = '';
            for (let i = 0; i < w.points.length - 1; i++) {
                const a = w.points[i];
                const b = w.points[i + 1];
                const dirClass = a.y === b.y ? 'seg-h' : (a.x === b.x ? 'seg-v' : '');
                hitSegmentsSvg += `
          <line class="wire-hit-seg ${dirClass}"
                x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}"
                data-wire-id="${w.id}" data-seg-idx="${i}" />
        `;
            }

            let handlesSvg = '';
            if (isSelected && w.points.length > 2) {
                for (let i = 1; i < w.points.length - 1; i++) {
                    const pt = w.points[i];
                    handlesSvg += `
            <circle class="wire-vertex-handle"
                    cx="${pt.x}" cy="${pt.y}" r="5"
                    data-wire-id="${w.id}" data-vertex-idx="${i}" />
          `;
                }
            }

            svg += `
        <g data-wire-group="${w.id}">
          ${isSelected ? `<polyline points="${ptsStr}" fill="none" stroke="rgba(56, 189, 248, 0.35)" stroke-width="7" stroke-linecap="round" stroke-linejoin="round" pointer-events="none" />` : ''}
          <polyline class="wire-visible-path" points="${ptsStr}" stroke="${strokeColor}" stroke-width="${isSelected ? 3.4 : 2.6}" />
          ${hitSegmentsSvg}
          ${handlesSvg}
        </g>
      `;
        });

        endpointCounts.forEach((count, k) => {
            if (count >= 3) {
                const [x, y] = k.split(',').map(Number);
                const v = state.simResults.nodeVoltages[k] || 0;
                svg += `<circle cx="${x}" cy="${y}" r="4.5" fill="${v >= 12 ? '#10b981' : (v >= 1.5 ? '#34d399' : '#94a3b8')}" pointer-events="none" />`;
            }
        });

        layer.innerHTML = svg;
    }

    function buildOrthogonalPath(p1, p2, bendFirst = 'H') {
        if (p1.x === p2.x || p1.y === p2.y) {
            return [p1, p2];
        }
        const corner = bendFirst === 'V'
            ? { x: p1.x, y: p2.y }
            : { x: p2.x, y: p1.y };
        return [p1, corner, p2];
    }

    function renderWiringOverlay() {
        const layer = document.getElementById('overlayLayer');
        if (!state.wiring) {
            layer.innerHTML = '';
            return;
        }

        const { waypoints, cursorPos, bendFirst, snapPin } = state.wiring;
        const lastPt = waypoints[waypoints.length - 1];
        const targetPt = snapPin ? { x: snapPin.x, y: snapPin.y } : cursorPos;
        const previewSeg = buildOrthogonalPath(lastPt, targetPt, bendFirst);
        const fullPts = [...waypoints.slice(0, -1), ...previewSeg];
        const ptsStr = fullPts.map(p => `${p.x},${p.y}`).join(' ');

        let svg = `
      <polyline points="${ptsStr}" fill="none" stroke="#34d399" stroke-width="2.5" stroke-dasharray="6 4" stroke-linejoin="round" pointer-events="none" />
      <circle cx="${waypoints[0].x}" cy="${waypoints[0].y}" r="5" fill="#10b981" pointer-events="none" />
    `;

        if (snapPin) {
            svg += `<circle cx="${snapPin.x}" cy="${snapPin.y}" r="8" fill="none" stroke="#38bdf8" stroke-width="2" pointer-events="none" />`;
        }

        layer.innerHTML = svg;
    }

    function updateLiveSimulationVisuals() {
        const plcLayer = document.getElementById('plcLayer');
        const compLayer = document.getElementById('componentsLayer');
        const wiresLayer = document.getElementById('wiresLayer');

        if (
            compLayer.children.length !== state.components.length ||
            wiresLayer.querySelectorAll('[data-wire-group]').length !== state.wires.length
        ) {
            renderAll();
            return;
        }

        // 1. Atualiza LEDs dos pinos do CLP
        const spec = getPlcTerminalSpecs();
        const plcBits = state.program?.bits || {};
        const sentInputs = state.simResults?.sentInputs || {};
        spec.pins.forEach(p => {
            if (p.kind !== 'PLC_IN' && p.kind !== 'PLC_OUT') return;
            const active = p.kind === 'PLC_IN'
                ? Boolean(plcBits[p.addr] || sentInputs[p.addr])
                : Boolean(plcBits[p.addr]);
            const ledEl = plcLayer.querySelector(`[data-plc-pin="${p.id}"]`);
            const lblEl = plcLayer.querySelector(`[data-plc-pin-lbl="${p.id}"]`);
            if (ledEl) {
                ledEl.setAttribute('fill', active ? (p.kind === 'PLC_IN' ? '#10b981' : '#f59e0b') : '#334155');
            }
            if (lblEl) {
                lblEl.setAttribute('fill', active ? (p.kind === 'PLC_IN' ? '#34d399' : '#fcd34d') : '#e2e8f0');
            }
        });

        // 2. Atualiza componentes
        state.components.forEach(comp => {
            const g = compLayer.querySelector(`[data-entity-id="${comp.id}"]`);
            if (!g) return;

            if (comp.type === 'LED') {
                const colorInfo = LED_COLORS[comp.color] || LED_COLORS.green;
                const m = state.simResults.compMetrics[comp.id] || {};
                const brightness = m.brightness || 0;
                const isLit = brightness > 0.05;
                const over = m.overcurrent;

                const halo = g.querySelector('.led-halo');
                const body = g.querySelector('.led-body');
                const lbl = g.querySelector('.led-status-lbl');
                if (halo) {
                    halo.setAttribute('r', String(14 + brightness * 10));
                    halo.setAttribute('opacity', String(isLit ? (0.25 + brightness * 0.55) : 0));
                }
                if (body) {
                    body.setAttribute('fill', isLit ? colorInfo.hex : '#1e293b');
                }
                if (lbl) {
                    lbl.setAttribute('fill', over ? '#fda4af' : '#e2e8f0');
                    lbl.textContent = over ? `⚠ ${(m.currentMa || 0).toFixed(0)}mA!` : (comp.label || `LED ${colorInfo.label}`);
                }
            } else if (comp.type === 'BUTTON') {
                const closed = Boolean(comp.pressed);
                const c = closed ? '#10b981' : '#38bdf8';
                const bar = g.querySelector('.btn-bar');
                const stem = g.querySelector('.btn-stem');
                const cap = g.querySelector('.btn-cap');
                if (bar) {
                    bar.setAttribute('y1', String(closed ? -2 : -11));
                    bar.setAttribute('y2', String(closed ? -2 : -11));
                    bar.setAttribute('stroke', c);
                }
                if (stem) {
                    stem.setAttribute('y1', String(closed ? -11 : -20));
                    stem.setAttribute('y2', String(closed ? -2 : -11));
                    stem.setAttribute('stroke', c);
                }
                if (cap) {
                    cap.setAttribute('y', String(closed ? -15 : -24));
                    cap.setAttribute('fill', c);
                }
            } else if (comp.type === 'SWITCH') {
                const closed = Boolean(comp.closed);
                const lever = g.querySelector('.sw-lever');
                const lbl = g.querySelector('.sw-lbl');
                if (lever) {
                    lever.setAttribute('x2', String(closed ? 16 : 12));
                    lever.setAttribute('y2', String(closed ? 0 : -15));
                    lever.setAttribute('stroke', closed ? '#10b981' : '#f59e0b');
                }
                if (lbl) {
                    lbl.setAttribute('fill', closed ? '#34d399' : '#94a3b8');
                    lbl.textContent = comp.label || (closed ? 'Chave ON' : 'Chave OFF');
                }
            }
        });

        // 3. Atualiza energização visual dos fios
        state.wires.forEach(w => {
            const wg = wiresLayer.querySelector(`[data-wire-group="${w.id}"]`);
            if (!wg) return;
            const poly = wg.querySelector('.wire-visible-path');
            if (!poly) return;
            const isSelected = state.selectedId === w.id;
            poly.setAttribute('stroke', getWireVisualStroke(w.id, isSelected));
            poly.setAttribute('stroke-width', isSelected ? '3.4' : '2.6');
        });
    }

    function updateSelectionClasses() {
        document.querySelectorAll('.plc-group, .sim-comp-group').forEach(el => {
            el.classList.toggle('selected', el.dataset.entityId === state.selectedId);
        });
    }

    function renderAll() {
        renderPlc();
        renderComponents();
        renderWires();
        renderWiringOverlay();
    }

    Object.assign(app, {
        buildOrthogonalPath,
        renderPlc,
        renderComponents,
        renderWires,
        renderWiringOverlay,
        updateLiveSimulationVisuals,
        updateSelectionClasses,
        renderAll
    });
})();