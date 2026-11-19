(function () {
    'use strict';

    const app = window.SimulateApp;
    const {
        LED_COLORS,
        state,
        snapToGrid,
        posKey,
        showToast,
        recordHistory,
        resetHistory,
        undo,
        redo,
        parseResistance,
        formatResistance,
        getPlcTerminalSpecs,
        getComponentPins,
        getAllPins,
        createComponent,
        buildOrthogonalPath
    } = app;

    function setTool(tool, placingType = null) {
        state.tool = tool;
        state.placingType = placingType;

        document.querySelectorAll('[data-sim-tool]').forEach(btn => {
            btn.classList.toggle('active', !placingType && btn.dataset.simTool === tool);
        });
        document.querySelectorAll('.lib-item').forEach(item => {
            item.classList.toggle('active-place', item.dataset.compType === placingType);
        });

        const stage = document.getElementById('canvasStage');
        stage.classList.toggle('mode-wire', tool === 'WIRE' || Boolean(state.wiring));
        stage.classList.toggle('mode-place', Boolean(placingType));
        stage.classList.toggle('mode-delete', tool === 'DELETE');
    }

    function getSvgCoords(e) {
        const svg = document.getElementById('circuitSvg');
        const rect = svg.getBoundingClientRect();
        return {
            x: snapToGrid(e.clientX - rect.left),
            y: snapToGrid(e.clientY - rect.top)
        };
    }

    function simplifyWirePoints(pts) {
        if (!pts || pts.length <= 2) return pts ? pts.map(p => ({ x: p.x, y: p.y })) : [];
        let current = pts.map(p => ({ x: p.x, y: p.y }));
        let changed = true;

        while (changed && current.length > 2) {
            changed = false;
            const dedup = [];
            for (const p of current) {
                const prev = dedup[dedup.length - 1];
                if (!prev || prev.x !== p.x || prev.y !== p.y) {
                    dedup.push(p);
                } else {
                    changed = true;
                }
            }

            if (dedup.length <= 2) {
                current = dedup;
                break;
            }

            const nextList = [dedup[0]];
            for (let i = 1; i < dedup.length - 1; i++) {
                const prev = nextList[nextList.length - 1];
                const curr = dedup[i];
                const next = dedup[i + 1];
                const sameX = prev.x === curr.x && curr.x === next.x;
                const sameY = prev.y === curr.y && curr.y === next.y;
                if (sameX || sameY) {
                    changed = true;
                } else {
                    nextList.push(curr);
                }
            }
            nextList.push(dedup[dedup.length - 1]);
            current = nextList;
        }

        return current;
    }

    function findNearbyPin(x, y, maxDist = 14) {
        const pins = getAllPins();
        let best = null;
        let bestDist = maxDist;
        for (const p of pins) {
            const d = Math.hypot(p.x - x, p.y - y);
            if (d <= bestDist) {
                bestDist = d;
                best = p;
            }
        }
        return best;
    }

    function findWireAtPoint(x, y) {
        for (let wIdx = 0; wIdx < state.wires.length; wIdx++) {
            const w = state.wires[wIdx];
            for (let i = 0; i < w.points.length - 1; i++) {
                const a = w.points[i];
                const b = w.points[i + 1];
                if (a.x === b.x && a.x === x) {
                    const minY = Math.min(a.y, b.y);
                    const maxY = Math.max(a.y, b.y);
                    if (y >= minY && y <= maxY) return { wireIndex: wIdx, segIndex: i, point: { x, y } };
                } else if (a.y === b.y && a.y === y) {
                    const minX = Math.min(a.x, b.x);
                    const maxX = Math.max(a.x, b.x);
                    if (x >= minX && x <= maxX) return { wireIndex: wIdx, segIndex: i, point: { x, y } };
                }
            }
        }
        return null;
    }

    function splitWireAtJunction(hit) {
        const w = state.wires[hit.wireIndex];
        if (!w) return;
        const pt = hit.point;
        const alreadyVertex = w.points.some(p => p.x === pt.x && p.y === pt.y);
        if (alreadyVertex) {
            const idx = w.points.findIndex(p => p.x === pt.x && p.y === pt.y);
            if (idx > 0 && idx < w.points.length - 1) {
                const firstHalf = w.points.slice(0, idx + 1);
                const secondHalf = w.points.slice(idx);
                state.wires.splice(
                    hit.wireIndex,
                    1,
                    { id: 'w_' + Math.random().toString(36).slice(2, 9), points: firstHalf },
                    { id: 'w_' + Math.random().toString(36).slice(2, 9), points: secondHalf }
                );
            }
            return;
        }

        const before = [...w.points.slice(0, hit.segIndex + 1), { x: pt.x, y: pt.y }];
        const after = [{ x: pt.x, y: pt.y }, ...w.points.slice(hit.segIndex + 1)];
        state.wires.splice(
            hit.wireIndex,
            1,
            { id: 'w_' + Math.random().toString(36).slice(2, 9), points: before },
            { id: 'w_' + Math.random().toString(36).slice(2, 9), points: after }
        );
    }

    function startWireAt(pt) {
        state.wiring = {
            waypoints: [{ x: pt.x, y: pt.y }],
            cursorPos: { x: pt.x, y: pt.y },
            bendFirst: 'H',
            snapPin: null
        };
        document.getElementById('canvasStage').classList.add('is-wiring');
        app.renderWiringOverlay();
    }

    function cancelWire() {
        state.wiring = null;
        document.getElementById('canvasStage').classList.remove('is-wiring');
        app.renderWiringOverlay();
    }

    function commitWireTo(endPt, wireHit = null) {
        if (!state.wiring) return;
        const { waypoints, bendFirst } = state.wiring;
        const lastPt = waypoints[waypoints.length - 1];
        const seg = buildOrthogonalPath(lastPt, endPt, bendFirst);
        const cleanPts = simplifyWirePoints([...waypoints.slice(0, -1), ...seg]);

        if (cleanPts.length >= 2) {
            if (wireHit) splitWireAtJunction(wireHit);
            state.wires.push({
                id: 'w_' + Math.random().toString(36).slice(2, 9),
                points: cleanPts
            });
            recordHistory();
            app.syncCircuitToMain();
        }

        cancelWire();
        app.renderAll();
        app.runElectricalSimulation();
    }

    function deleteSelectedEntity() {
        if (!state.selectedId) return;

        if (state.selectedId === 'PLC') {
            showToast('O CLP faz parte da bancada e não pode ser apagado.');
            return;
        }

        const compIdx = state.components.findIndex(c => c.id === state.selectedId);
        if (compIdx !== -1) {
            state.components.splice(compIdx, 1);
            state.selectedId = null;
            recordHistory();
            app.syncCircuitToMain();
            app.renderAll();
            app.runElectricalSimulation();
            return;
        }

        const wireIdx = state.wires.findIndex(w => w.id === state.selectedId);
        if (wireIdx !== -1) {
            state.wires.splice(wireIdx, 1);
            state.selectedId = null;
            recordHistory();
            app.syncCircuitToMain();
            app.renderAll();
            app.runElectricalSimulation();
        }
    }

    function openInlineComponentEditor(comp) {
        closeInlineComponentEditor();
        const stage = document.getElementById('canvasStage');
        const pop = document.createElement('div');
        pop.className = 'inline-sim-editor';
        pop.style.left = `${comp.x}px`;
        pop.style.top = `${Math.max(46, comp.y - 26)}px`;

        if (comp.type === 'RESISTOR') {
            const input = document.createElement('input');
            input.type = 'text';
            input.className = 'inline-sim-input';
            input.value = formatResistance(comp.resistance).replace('Ω', '');
            input.title = 'Digite a resistência (ex: 220, 1k, 4.7k, 10k) e pressione Enter';
            pop.appendChild(input);

            const unitLbl = document.createElement('span');
            unitLbl.textContent = 'Ω';
            unitLbl.style.cssText = 'font-family:var(--font-mono); font-weight:800; color:#7dd3fc;';
            pop.appendChild(unitLbl);

            stage.appendChild(pop);

            let done = false;
            const finish = (save) => {
                if (done) return;
                done = true;
                if (save) {
                    const parsed = parseResistance(input.value);
                    if (!parsed) {
                        done = false;
                        input.setCustomValidity('Valor inválido. Exemplos: 220, 1k, 4.7k, 10k');
                        input.reportValidity();
                        input.focus();
                        return;
                    }
                    if (comp.resistance !== parsed) {
                        comp.resistance = parsed;
                        recordHistory();
                        app.syncCircuitToMain();
                    }
                }
                pop.remove();
                app.renderAll();
                app.runElectricalSimulation();
            };

            input.addEventListener('input', () => input.setCustomValidity(''));
            input.addEventListener('keydown', (ev) => {
                if (ev.key === 'Enter') { ev.preventDefault(); finish(true); }
                else if (ev.key === 'Escape') { ev.preventDefault(); finish(false); }
                ev.stopPropagation();
            });
            input.addEventListener('blur', () => finish(true));
            pop.addEventListener('pointerdown', ev => ev.stopPropagation());
            pop.addEventListener('click', ev => ev.stopPropagation());

            requestAnimationFrame(() => {
                input.focus();
                input.select();
            });
            return;
        }

        if (comp.type === 'LED') {
            const swatchWrap = document.createElement('div');
            swatchWrap.className = 'led-color-picker';

            Object.entries(LED_COLORS).forEach(([key, info]) => {
                const btn = document.createElement('button');
                btn.type = 'button';
                btn.className = `led-swatch ${comp.color === key ? 'active' : ''}`;
                btn.style.backgroundColor = info.hex;
                btn.title = info.label;
                btn.addEventListener('pointerdown', (ev) => {
                    ev.preventDefault();
                    ev.stopPropagation();
                    if (comp.color !== key) {
                        comp.color = key;
                        recordHistory();
                        app.syncCircuitToMain();
                    }
                    pop.remove();
                    app.renderAll();
                    app.runElectricalSimulation();
                });
                swatchWrap.appendChild(btn);
            });

            const input = document.createElement('input');
            input.type = 'text';
            input.className = 'inline-sim-input';
            input.style.width = '90px';
            input.placeholder = 'Rótulo...';
            input.value = comp.label || '';

            pop.appendChild(swatchWrap);
            pop.appendChild(input);
            stage.appendChild(pop);

            let done = false;
            const finish = (save) => {
                if (done) return;
                done = true;
                if (save) {
                    const nextLabel = input.value.trim();
                    if ((comp.label || '') !== nextLabel) {
                        comp.label = nextLabel;
                        recordHistory();
                        app.syncCircuitToMain();
                    }
                }
                pop.remove();
                app.renderAll();
            };

            input.addEventListener('keydown', (ev) => {
                if (ev.key === 'Enter') { ev.preventDefault(); finish(true); }
                else if (ev.key === 'Escape') { ev.preventDefault(); finish(false); }
                ev.stopPropagation();
            });
            input.addEventListener('blur', () => finish(true));
            pop.addEventListener('pointerdown', ev => ev.stopPropagation());
            pop.addEventListener('click', ev => ev.stopPropagation());

            requestAnimationFrame(() => {
                input.focus();
                input.select();
            });
            return;
        }

        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'inline-sim-input';
        input.style.width = '110px';
        input.placeholder = 'Rótulo (ex: S1)';
        input.value = comp.label || '';
        pop.appendChild(input);
        stage.appendChild(pop);

        let done = false;
        const finish = (save) => {
            if (done) return;
            done = true;
            if (save) {
                const nextLabel = input.value.trim();
                if ((comp.label || '') !== nextLabel) {
                    comp.label = nextLabel;
                    recordHistory();
                    app.syncCircuitToMain();
                }
            }
            pop.remove();
            app.renderAll();
        };

        input.addEventListener('keydown', (ev) => {
            if (ev.key === 'Enter') { ev.preventDefault(); finish(true); }
            else if (ev.key === 'Escape') { ev.preventDefault(); finish(false); }
            ev.stopPropagation();
        });
        input.addEventListener('blur', () => finish(true));
        pop.addEventListener('pointerdown', ev => ev.stopPropagation());
        pop.addEventListener('click', ev => ev.stopPropagation());
        requestAnimationFrame(() => {
            input.focus();
            input.select();
        });
    }

    function closeInlineComponentEditor() {
        document.querySelectorAll('.inline-sim-editor').forEach(el => el.remove());
    }

    function captureAttachedWireEnds(pinList) {
        const pinSet = new Set(pinList.map(p => posKey(p.x, p.y)));
        const attached = [];
        state.wires.forEach(w => {
            if (!w.points || w.points.length < 2) return;
            const first = w.points[0];
            const last = w.points[w.points.length - 1];
            if (pinSet.has(posKey(first.x, first.y))) {
                attached.push({
                    wire: w,
                    end: 'start',
                    origPoints: w.points.map(p => ({ x: p.x, y: p.y }))
                });
            }
            if (pinSet.has(posKey(last.x, last.y))) {
                attached.push({
                    wire: w,
                    end: 'end',
                    origPoints: w.points.map(p => ({ x: p.x, y: p.y }))
                });
            }
        });
        return attached;
    }

    function applyAttachedWireRubberBand(attachedList, dx, dy) {
        attachedList.forEach(item => {
            const orig = item.origPoints;
            if (item.end === 'start') {
                const newStart = { x: orig[0].x + dx, y: orig[0].y + dy };
                if (orig.length === 2) {
                    const endPt = { x: orig[1].x, y: orig[1].y };
                    item.wire.points = simplifyWirePoints([newStart, { x: endPt.x, y: newStart.y }, endPt]);
                } else {
                    const pts = orig.map(p => ({ x: p.x, y: p.y }));
                    const wasHorizontal = orig[0].y === orig[1].y;
                    pts[0] = newStart;
                    if (wasHorizontal) pts[1].y = newStart.y;
                    else pts[1].x = newStart.x;
                    item.wire.points = simplifyWirePoints(pts);
                }
            } else {
                const lastIdx = orig.length - 1;
                const newEnd = { x: orig[lastIdx].x + dx, y: orig[lastIdx].y + dy };
                if (orig.length === 2) {
                    const startPt = { x: orig[0].x, y: orig[0].y };
                    item.wire.points = simplifyWirePoints([startPt, { x: startPt.x, y: newEnd.y }, newEnd]);
                } else {
                    const pts = orig.map(p => ({ x: p.x, y: p.y }));
                    const wasHorizontal = orig[lastIdx - 1].y === orig[lastIdx].y;
                    pts[lastIdx] = newEnd;
                    if (wasHorizontal) pts[lastIdx - 1].y = newEnd.y;
                    else pts[lastIdx - 1].x = newEnd.x;
                    item.wire.points = simplifyWirePoints(pts);
                }
            }
        });
    }

    document.addEventListener('DOMContentLoaded', () => {
        const stage = document.getElementById('canvasStage');
        const svg = document.getElementById('circuitSvg');

        let draggingEntity = null;
        let draggingWireSeg = null;
        let draggingWireVertex = null;
        let activeButtonComp = null;
        let lastCompClick = { id: null, time: 0 };

        document.querySelectorAll('[data-sim-tool]').forEach(btn => {
            btn.addEventListener('click', () => {
                cancelWire();
                setTool(btn.dataset.simTool, null);
            });
        });

        document.getElementById('btnUndoSim').addEventListener('click', () => {
            closeInlineComponentEditor();
            cancelWire();
            undo();
        });

        document.getElementById('btnRedoSim').addEventListener('click', () => {
            closeInlineComponentEditor();
            cancelWire();
            redo();
        });

        document.getElementById('btnRotateSelected').addEventListener('click', () => {
            if (!state.selectedId || state.selectedId === 'PLC') return;
            const comp = state.components.find(c => c.id === state.selectedId);
            if (!comp) return;

            const oldPins = getComponentPins(comp);
            const attachedByPinId = {};
            oldPins.forEach(p => {
                attachedByPinId[p.id] = captureAttachedWireEnds([p]);
            });

            comp.rotation = ((comp.rotation || 0) + 90) % 360;

            const newPins = getComponentPins(comp);
            newPins.forEach((np, i) => {
                const op = oldPins[i];
                if (!op) return;
                applyAttachedWireRubberBand(attachedByPinId[op.id] || [], np.x - op.x, np.y - op.y);
            });

            recordHistory();
            app.syncCircuitToMain();
            app.renderAll();
            app.runElectricalSimulation();
        });

        document.getElementById('btnClearWires').addEventListener('click', () => {
            if (state.wires.length === 0) return;
            state.wires = [];
            cancelWire();
            recordHistory();
            app.syncCircuitToMain();
            app.renderAll();
            app.runElectricalSimulation();
            showToast('Todos os fios foram removidos.');
        });

        document.querySelectorAll('.lib-item').forEach(item => {
            const compType = item.dataset.compType;

            item.addEventListener('click', () => {
                cancelWire();
                if (state.placingType === compType) {
                    setTool('SELECT', null);
                } else {
                    setTool('SELECT', compType);
                }
            });

            item.addEventListener('dragstart', (e) => {
                cancelWire();
                setTool('SELECT', compType);
                e.dataTransfer.effectAllowed = 'copy';
                e.dataTransfer.setData('text/plain', compType);
            });

            item.addEventListener('dragend', () => {
                setTool('SELECT', null);
            });
        });

        stage.addEventListener('dragover', (e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'copy';
        });

        stage.addEventListener('drop', (e) => {
            e.preventDefault();
            const compType = e.dataTransfer.getData('text/plain') || state.placingType;
            if (!compType) return;
            const pt = getSvgCoords(e);
            const comp = createComponent(compType, pt.x, pt.y);
            state.components.push(comp);
            state.selectedId = comp.id;
            setTool('SELECT', null);
            recordHistory();
            app.syncCircuitToMain();
            app.renderAll();
            app.runElectricalSimulation();
        });

        svg.addEventListener('pointerdown', (e) => {
            if (e.button === 2) {
                if (state.wiring) {
                    e.preventDefault();
                    cancelWire();
                }
                return;
            }
            if (e.button !== 0) return;

            closeInlineComponentEditor();
            const pt = getSvgCoords(e);

            // 1. Inserção por clique após escolher item na biblioteca
            if (state.placingType) {
                const comp = createComponent(state.placingType, pt.x, pt.y);
                state.components.push(comp);
                state.selectedId = comp.id;
                setTool('SELECT', null);
                recordHistory();
                app.syncCircuitToMain();
                app.renderAll();
                app.runElectricalSimulation();
                return;
            }

            // 2. Finalização ou dobra de fio em construção
            if (state.wiring) {
                const pin = findNearbyPin(pt.x, pt.y);
                if (pin) {
                    commitWireTo({ x: pin.x, y: pin.y });
                    return;
                }
                const wireHit = findWireAtPoint(pt.x, pt.y);
                if (wireHit) {
                    commitWireTo(wireHit.point, wireHit);
                    return;
                }
                const lastPt = state.wiring.waypoints[state.wiring.waypoints.length - 1];
                const seg = buildOrthogonalPath(lastPt, pt, state.wiring.bendFirst);
                state.wiring.waypoints.push(...seg.slice(1));
                app.renderWiringOverlay();
                return;
            }

            // 3. Clique em um Pino -> inicia fio automaticamente
            const pinTarget = e.target.closest('.pin-hit-area');
            if (pinTarget && state.tool !== 'DELETE') {
                const px = Number(pinTarget.dataset.pinX);
                const py = Number(pinTarget.dataset.pinY);
                startWireAt({ x: px, y: py });
                return;
            }

            // 4. Modo Fio ativo -> permite iniciar de pino próximo ou de fio existente (junção T)
            if (state.tool === 'WIRE') {
                const nearPin = findNearbyPin(pt.x, pt.y);
                if (nearPin) {
                    startWireAt({ x: nearPin.x, y: nearPin.y });
                    return;
                }
                const wireHit = findWireAtPoint(pt.x, pt.y);
                if (wireHit) {
                    splitWireAtJunction(wireHit);
                    startWireAt(wireHit.point);
                }
                return;
            }

            // 5. Arraste de vértice interno de um fio selecionado
            const vertexEl = e.target.closest('.wire-vertex-handle');
            if (vertexEl && state.tool === 'SELECT') {
                const wireId = vertexEl.dataset.wireId;
                const vertexIndex = Number(vertexEl.dataset.vertexIdx);
                const wire = state.wires.find(w => w.id === wireId);
                if (wire && wire.points[vertexIndex]) {
                    draggingWireVertex = {
                        wire,
                        vertexIndex,
                        origPoints: wire.points.map(p => ({ x: p.x, y: p.y })),
                        startX: pt.x,
                        startY: pt.y,
                        moved: false
                    };
                }
                return;
            }

            // 6. Clique ou arraste de um segmento de fio existente
            const wireSegEl = e.target.closest('.wire-hit-seg');
            if (wireSegEl) {
                const wireId = wireSegEl.dataset.wireId;
                const segIndex = Number(wireSegEl.dataset.segIdx);
                const wire = state.wires.find(w => w.id === wireId);
                if (!wire) return;

                state.selectedId = wireId;
                if (state.tool === 'DELETE') {
                    deleteSelectedEntity();
                    return;
                }

                draggingWireSeg = {
                    wire,
                    segIndex,
                    origPoints: wire.points.map(p => ({ x: p.x, y: p.y })),
                    startX: pt.x,
                    startY: pt.y,
                    moved: false
                };
                app.renderWires();
                return;
            }

            // 7. Clique no CLP (móvel e protegido contra exclusão)
            const plcEl = e.target.closest('.plc-group');
            if (plcEl) {
                state.selectedId = 'PLC';
                if (state.tool === 'DELETE') {
                    showToast('O CLP faz parte da bancada e não pode ser apagado.');
                    app.updateSelectionClasses();
                    return;
                }

                const attached = captureAttachedWireEnds(getPlcTerminalSpecs().pins);
                draggingEntity = {
                    id: 'PLC',
                    origX: state.plc.x,
                    origY: state.plc.y,
                    startMouseX: pt.x,
                    startMouseY: pt.y,
                    moved: false,
                    attached
                };
                app.renderWires();
                app.updateSelectionClasses();
                return;
            }

            // 8. Clique em um Componente da Bancada
            const compEl = e.target.closest('.sim-comp-group');
            if (compEl) {
                const compId = compEl.dataset.entityId;
                const comp = state.components.find(c => c.id === compId);
                if (!comp) return;

                state.selectedId = compId;
                if (state.tool === 'DELETE') {
                    deleteSelectedEntity();
                    return;
                }

                const now = Date.now();
                if (lastCompClick.id === compId && (now - lastCompClick.time) < 380) {
                    lastCompClick = { id: null, time: 0 };
                    app.updateSelectionClasses();
                    if (!['VCC', 'GND'].includes(comp.type)) {
                        openInlineComponentEditor(comp);
                    }
                    return;
                }
                lastCompClick = { id: compId, time: now };

                if (comp.type === 'BUTTON') {
                    comp.pressed = true;
                    activeButtonComp = comp;
                    app.runElectricalSimulation();
                }

                const attached = captureAttachedWireEnds(getComponentPins(comp));
                draggingEntity = {
                    id: compId,
                    comp,
                    origX: comp.x,
                    origY: comp.y,
                    startMouseX: pt.x,
                    startMouseY: pt.y,
                    moved: false,
                    attached
                };
                app.renderWires();
                app.updateSelectionClasses();
                return;
            }

            // 9. Clique no fundo vazio
            state.selectedId = null;
            app.renderWires();
            app.updateSelectionClasses();
        });

        svg.addEventListener('contextmenu', (e) => {
            if (state.wiring) {
                e.preventDefault();
                cancelWire();
            }
        });

        svg.addEventListener('dblclick', (e) => {
            const compEl = e.target.closest('.sim-comp-group');
            if (!compEl) return;
            const comp = state.components.find(c => c.id === compEl.dataset.entityId);
            if (!comp || ['VCC', 'GND'].includes(comp.type)) return;
            e.preventDefault();
            e.stopPropagation();
            openInlineComponentEditor(comp);
        });

        window.addEventListener('pointermove', (e) => {
            const pt = getSvgCoords(e);

            if (state.wiring) {
                const snapPin = findNearbyPin(pt.x, pt.y);
                state.wiring.cursorPos = pt;
                state.wiring.snapPin = snapPin;
                app.renderWiringOverlay();
                return;
            }

            if (draggingWireSeg) {
                const dx = pt.x - draggingWireSeg.startX;
                const dy = pt.y - draggingWireSeg.startY;
                const orig = draggingWireSeg.origPoints;
                let idx = draggingWireSeg.segIndex;
                const aOrig = orig[idx];
                const bOrig = orig[idx + 1];
                if (!aOrig || !bOrig) return;

                const isHorizontal = aOrig.y === bOrig.y;
                const delta = isHorizontal ? dy : dx;
                if (delta !== 0) draggingWireSeg.moved = true;

                const pts = orig.map(p => ({ x: p.x, y: p.y }));
                const origEnd = { x: orig[orig.length - 1].x, y: orig[orig.length - 1].y };

                if (isHorizontal) {
                    const newY = Math.max(20, aOrig.y + dy);
                    if (idx === 0) {
                        pts.splice(0, 0, { x: aOrig.x, y: aOrig.y });
                        idx += 1;
                    }
                    pts[idx].y = newY;
                    pts[idx + 1].y = newY;
                    if (idx + 1 === pts.length - 1) {
                        pts.push(origEnd);
                    }
                } else {
                    const newX = Math.max(20, aOrig.x + dx);
                    if (idx === 0) {
                        pts.splice(0, 0, { x: aOrig.x, y: aOrig.y });
                        idx += 1;
                    }
                    pts[idx].x = newX;
                    pts[idx + 1].x = newX;
                    if (idx + 1 === pts.length - 1) {
                        pts.push(origEnd);
                    }
                }

                draggingWireSeg.wire.points = simplifyWirePoints(pts);
                app.renderWires();
                return;
            }

            if (draggingWireVertex) {
                const dx = pt.x - draggingWireVertex.startX;
                const dy = pt.y - draggingWireVertex.startY;
                if (dx !== 0 || dy !== 0) draggingWireVertex.moved = true;

                const orig = draggingWireVertex.origPoints;
                const vIdx = draggingWireVertex.vertexIndex;
                const pts = orig.map(p => ({ x: p.x, y: p.y }));
                const newX = Math.max(20, orig[vIdx].x + dx);
                const newY = Math.max(20, orig[vIdx].y + dy);

                if (vIdx > 1) {
                    if (orig[vIdx - 1].x === orig[vIdx].x) pts[vIdx - 1].x = newX;
                    if (orig[vIdx - 1].y === orig[vIdx].y) pts[vIdx - 1].y = newY;
                }
                if (vIdx < orig.length - 2) {
                    if (orig[vIdx + 1].x === orig[vIdx].x) pts[vIdx + 1].x = newX;
                    if (orig[vIdx + 1].y === orig[vIdx].y) pts[vIdx + 1].y = newY;
                }
                pts[vIdx] = { x: newX, y: newY };

                draggingWireVertex.wire.points = simplifyWirePoints(pts);
                app.renderWires();
                return;
            }

            if (draggingEntity) {
                const dx = pt.x - draggingEntity.startMouseX;
                const dy = pt.y - draggingEntity.startMouseY;
                if (dx !== 0 || dy !== 0) draggingEntity.moved = true;

                if (draggingEntity.id === 'PLC') {
                    state.plc.x = Math.max(20, draggingEntity.origX + dx);
                    state.plc.y = Math.max(20, draggingEntity.origY + dy);
                    const actualDx = state.plc.x - draggingEntity.origX;
                    const actualDy = state.plc.y - draggingEntity.origY;
                    applyAttachedWireRubberBand(draggingEntity.attached, actualDx, actualDy);
                } else if (draggingEntity.comp) {
                    draggingEntity.comp.x = Math.max(40, draggingEntity.origX + dx);
                    draggingEntity.comp.y = Math.max(40, draggingEntity.origY + dy);
                    const actualDx = draggingEntity.comp.x - draggingEntity.origX;
                    const actualDy = draggingEntity.comp.y - draggingEntity.origY;
                    applyAttachedWireRubberBand(draggingEntity.attached, actualDx, actualDy);
                }
                app.renderAll();
                return;
            }

            const probeEl = document.getElementById('probeText');
            const pinEl = e.target.closest?.('.pin-hit-area');
            if (pinEl) {
                const px = Number(pinEl.dataset.pinX);
                const py = Number(pinEl.dataset.pinY);
                const v = state.simResults.nodeVoltages[posKey(px, py)] ?? 0;
                probeEl.textContent = `${pinEl.dataset.pinLabel}: ${v.toFixed(2)} V`;
                return;
            }

            const compEl = e.target.closest?.('.sim-comp-group');
            if (compEl) {
                const comp = state.components.find(c => c.id === compEl.dataset.entityId);
                const m = comp ? state.simResults.compMetrics[comp.id] : null;
                if (comp?.type === 'RESISTOR' && m) {
                    probeEl.textContent = `Resistor (${formatResistance(comp.resistance)}): ${m.voltageDrop.toFixed(2)} V | ${m.currentMa.toFixed(2)} mA`;
                    return;
                }
                if (comp?.type === 'LED' && m) {
                    probeEl.textContent = `LED: ${m.currentMa.toFixed(2)} mA (${m.overcurrent ? 'SOBRECORRENTE!' : 'Normal'})`;
                    return;
                }
            }
        });

        window.addEventListener('pointerup', () => {
            if (activeButtonComp) {
                activeButtonComp.pressed = false;
                activeButtonComp = null;
                app.runElectricalSimulation();
            }

            if (draggingWireSeg) {
                if (draggingWireSeg.moved) {
                    recordHistory();
                    app.syncCircuitToMain();
                    app.renderWires();
                    app.runElectricalSimulation();
                }
                draggingWireSeg = null;
            }

            if (draggingWireVertex) {
                if (draggingWireVertex.moved) {
                    recordHistory();
                    app.syncCircuitToMain();
                    app.renderWires();
                    app.runElectricalSimulation();
                }
                draggingWireVertex = null;
            }

            if (draggingEntity) {
                if (!draggingEntity.moved && draggingEntity.comp?.type === 'SWITCH') {
                    draggingEntity.comp.closed = !draggingEntity.comp.closed;
                    app.runElectricalSimulation();
                }
                if (draggingEntity.moved) {
                    recordHistory();
                    app.syncCircuitToMain();
                    app.renderAll();
                    app.runElectricalSimulation();
                }
                draggingEntity = null;
            }
        });

        window.addEventListener('keydown', (e) => {
            if (['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)) return;

            const isMod = (e.ctrlKey || e.metaKey) && !e.altKey;
            const keyLower = e.key.toLowerCase();

            if (isMod && keyLower === 'z') {
                e.preventDefault();
                closeInlineComponentEditor();
                if (state.wiring) {
                    cancelWire();
                    return;
                }
                if (e.shiftKey) redo();
                else undo();
                return;
            }

            if (isMod && keyLower === 'y') {
                e.preventDefault();
                closeInlineComponentEditor();
                if (state.wiring) cancelWire();
                redo();
                return;
            }

            if (isMod) return;

            if (e.key === 'Escape') {
                e.preventDefault();
                cancelWire();
                setTool('SELECT', null);
                state.selectedId = null;
                app.renderWires();
                app.updateSelectionClasses();
            } else if (e.key === ' ' && state.wiring) {
                e.preventDefault();
                state.wiring.bendFirst = state.wiring.bendFirst === 'H' ? 'V' : 'H';
                app.renderWiringOverlay();
            } else if (keyLower === 'w') {
                e.preventDefault();
                setTool('WIRE', null);
            } else if (keyLower === 'r') {
                e.preventDefault();
                document.getElementById('btnRotateSelected').click();
            } else if (e.key === 'Delete' || e.key === 'Backspace') {
                e.preventDefault();
                deleteSelectedEntity();
            }
        });

        window.addEventListener('message', (e) => {
            const msg = e.data;
            if (!msg || typeof msg !== 'object') return;

            if (msg.type === 'PROGRAM_STATE_SYNC') {
                state.program = { ...state.program, ...msg.payload };
                app.renderPlc();
                app.runElectricalSimulation();
            } else if (msg.type === 'HARDWARE_STATE_SYNC') {
                if (msg.payload) {
                    state.hardware = msg.payload;
                    app.renderAll();
                    app.runElectricalSimulation();
                }
            } else if (msg.type === 'LOAD_CIRCUIT_DATA') {
                if (msg.payload) {
                    state.plc = msg.payload.plc || { id: 'PLC', x: 460, y: 120 };
                    state.components = Array.isArray(msg.payload.components) ? msg.payload.components : [];
                    state.wires = Array.isArray(msg.payload.wires) ? msg.payload.wires : [];
                    state.selectedId = null;
                    cancelWire();
                    resetHistory();
                    app.renderAll();
                    app.runElectricalSimulation();
                }
            } else if (msg.type === 'CMD_RESET_PLC') {
                state.components.forEach(c => {
                    if (c.type === 'BUTTON') c.pressed = false;
                    if (c.type === 'SWITCH') c.closed = false;
                });
                state.simResults.sentInputs = {};
                app.renderAll();
                app.runElectricalSimulation();
            } else if (msg.type === 'CMD_NEW_PROJECT') {
                app.initBlankCircuit();
            }
        });

        resetHistory();
        app.renderAll();
        app.runElectricalSimulation();
        if (window.parent && window.parent !== window) {
            window.parent.postMessage({ type: 'REQUEST_INITIAL_SYNC' }, '*');
        }
        setInterval(app.runElectricalSimulation, SIM_MS);
    });
})();