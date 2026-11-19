(function () {
    'use strict';

    const app = window.SimulateApp;
    const { state, posKey, getPlcTerminalSpecs, getComponentPins } = app;

    class DisjointSet {
        constructor() {
            this.parent = new Map();
        }
        find(k) {
            if (!this.parent.has(k)) this.parent.set(k, k);
            let root = k;
            while (this.parent.get(root) !== root) {
                root = this.parent.get(root);
            }
            let curr = k;
            while (curr !== root) {
                const nxt = this.parent.get(curr);
                this.parent.set(curr, root);
                curr = nxt;
            }
            return root;
        }
        union(a, b) {
            const ra = this.find(a);
            const rb = this.find(b);
            if (ra !== rb) this.parent.set(ra, rb);
        }
    }

    function pointOnOrthogonalSegment(px, py, a, b) {
        if (a.x === b.x && px === a.x) {
            const minY = Math.min(a.y, b.y);
            const maxY = Math.max(a.y, b.y);
            return py >= minY && py <= maxY;
        }
        if (a.y === b.y && py === a.y) {
            const minX = Math.min(a.x, b.x);
            const maxX = Math.max(a.x, b.x);
            return px >= minX && px <= maxX;
        }
        return false;
    }

    function solveLinearSystem(G, I) {
        const n = I.length;
        const A = G.map((row, idx) => [...row, I[idx]]);

        for (let col = 0; col < n; col++) {
            let maxRow = col;
            let maxVal = Math.abs(A[col][col]);
            for (let row = col + 1; row < n; row++) {
                const v = Math.abs(A[row][col]);
                if (v > maxVal) {
                    maxVal = v;
                    maxRow = row;
                }
            }

            if (maxVal < 1e-12) continue;
            if (maxRow !== col) {
                [A[col], A[maxRow]] = [A[maxRow], A[col]];
            }

            const pivot = A[col][col];
            for (let row = col + 1; row < n; row++) {
                const factor = A[row][col] / pivot;
                if (factor === 0) continue;
                for (let k = col; k <= n; k++) {
                    A[row][k] -= factor * A[col][k];
                }
            }
        }

        const x = new Array(n).fill(0);
        for (let row = n - 1; row >= 0; row--) {
            if (Math.abs(A[row][row]) < 1e-12) {
                x[row] = 0;
                continue;
            }
            let sum = A[row][n];
            for (let col = row + 1; col < n; col++) {
                sum -= A[row][col] * x[col];
            }
            x[row] = sum / A[row][row];
        }
        return x;
    }

    function runElectricalSimulation() {
        const dsu = new DisjointSet();
        const allCoordKeys = new Set();
        const anchorPoints = [];

        const registerPoint = (x, y) => {
            const k = posKey(x, y);
            if (!allCoordKeys.has(k)) {
                allCoordKeys.add(k);
                const [sx, sy] = k.split(',').map(Number);
                anchorPoints.push({ x: sx, y: sy, key: k });
            }
            dsu.find(k);
            return k;
        };

        const plcSpec = getPlcTerminalSpecs();
        plcSpec.pins.forEach(p => registerPoint(p.x, p.y));

        state.components.forEach(comp => {
            getComponentPins(comp).forEach(p => registerPoint(p.x, p.y));
        });

        // Conecta todos os vértices de cada fio
        state.wires.forEach(w => {
            if (!w.points || w.points.length < 2) return;
            const firstKey = registerPoint(w.points[0].x, w.points[0].y);
            for (let i = 1; i < w.points.length; i++) {
                const k = registerPoint(w.points[i].x, w.points[i].y);
                dsu.union(firstKey, k);
            }
        });

        // Garante condução elétrica quando qualquer pino ou derivação toca o meio de um fio
        state.wires.forEach(w => {
            if (!w.points || w.points.length < 2) return;
            const wireRootKey = posKey(w.points[0].x, w.points[0].y);
            for (let i = 0; i < w.points.length - 1; i++) {
                const a = w.points[i];
                const b = w.points[i + 1];
                for (let j = 0; j < anchorPoints.length; j++) {
                    const ap = anchorPoints[j];
                    if (pointOnOrthogonalSegment(ap.x, ap.y, a, b)) {
                        dsu.union(wireRootKey, ap.key);
                    }
                }
            }
        });

        // Identifica nós de referência 0V (GND)
        const gndRoots = new Set();
        plcSpec.pins.forEach(p => {
            if (p.kind === 'POWER_0') gndRoots.add(dsu.find(posKey(p.x, p.y)));
        });
        state.components.forEach(comp => {
            if (comp.type === 'GND') {
                const p = getComponentPins(comp)[0];
                gndRoots.add(dsu.find(posKey(p.x, p.y)));
            }
        });

        // Mapeia cada raiz elétrica para um índice de nó (0 = GND)
        const rootToNode = new Map();
        let nextNodeIdx = 1;
        allCoordKeys.forEach(k => {
            const r = dsu.find(k);
            if (gndRoots.has(r)) {
                rootToNode.set(r, 0);
            } else if (!rootToNode.has(r)) {
                rootToNode.set(r, nextNodeIdx++);
            }
        });

        const nodeOfKey = (k) => rootToNode.get(dsu.find(k)) ?? 0;
        const M = nextNodeIdx - 1;

        let V = new Array(nextNodeIdx).fill(0);
        const leds = state.components.filter(c => c.type === 'LED');
        const iterations = leds.length > 0 ? 5 : 1;

        for (let iter = 0; iter < iterations; iter++) {
            if (M <= 0) break;
            const G = Array.from({ length: M }, () => new Array(M).fill(0));
            const I = new Array(M).fill(0);

            const stampConductance = (n1, n2, g) => {
                if (n1 > 0) G[n1 - 1][n1 - 1] += g;
                if (n2 > 0) G[n2 - 1][n2 - 1] += g;
                if (n1 > 0 && n2 > 0) {
                    G[n1 - 1][n2 - 1] -= g;
                    G[n2 - 1][n1 - 1] -= g;
                }
            };

            const stampSource = (nPos, voltage, rInt = 0.1) => {
                const g = 1 / rInt;
                stampConductance(nPos, 0, g);
                if (nPos > 0) I[nPos - 1] += voltage * g;
            };

            // 1. Fontes e I/O do CLP
            const plcBits = state.program?.bits || {};
            plcSpec.pins.forEach(p => {
                const n = nodeOfKey(posKey(p.x, p.y));
                if (p.kind === 'POWER_24') {
                    stampSource(n, 24.0, 0.1);
                } else if (p.kind === 'PLC_OUT') {
                    if (plcBits[p.addr]) {
                        stampSource(n, 24.0, 0.2);
                    } else {
                        stampConductance(n, 0, 1e-8);
                    }
                } else if (p.kind === 'PLC_IN') {
                    stampConductance(n, 0, 1 / 2400);
                }
            });

            // 2. Componentes da Bancada
            state.components.forEach(comp => {
                const pins = getComponentPins(comp);
                if (comp.type === 'VCC') {
                    stampSource(nodeOfKey(posKey(pins[0].x, pins[0].y)), 24.0, 0.1);
                } else if (comp.type === 'RESISTOR') {
                    const n1 = nodeOfKey(posKey(pins[0].x, pins[0].y));
                    const n2 = nodeOfKey(posKey(pins[1].x, pins[1].y));
                    const r = Math.max(0.1, Number(comp.resistance) || 1000);
                    stampConductance(n1, n2, 1 / r);
                } else if (comp.type === 'BUTTON') {
                    const n1 = nodeOfKey(posKey(pins[0].x, pins[0].y));
                    const n2 = nodeOfKey(posKey(pins[1].x, pins[1].y));
                    stampConductance(n1, n2, comp.pressed ? 100 : 1e-9);
                } else if (comp.type === 'SWITCH') {
                    const n1 = nodeOfKey(posKey(pins[0].x, pins[0].y));
                    const n2 = nodeOfKey(posKey(pins[1].x, pins[1].y));
                    stampConductance(n1, n2, comp.closed ? 100 : 1e-9);
                } else if (comp.type === 'LED') {
                    const nA = nodeOfKey(posKey(pins[0].x, pins[0].y));
                    const nK = nodeOfKey(posKey(pins[1].x, pins[1].y));
                    const vd = V[nA] - V[nK];
                    const vf = 2.0;
                    const rd = 20.0;
                    if (vd > vf) {
                        const gLed = 1 / rd;
                        stampConductance(nA, nK, gLed);
                        const iEq = vf * gLed;
                        if (nA > 0) I[nA - 1] += iEq;
                        if (nK > 0) I[nK - 1] -= iEq;
                    } else {
                        stampConductance(nA, nK, 1e-9);
                    }
                }
            });

            const solved = solveLinearSystem(G, I);
            V = [0, ...solved];
        }

        const nodeVoltages = {};
        allCoordKeys.forEach(k => {
            const n = nodeOfKey(k);
            nodeVoltages[k] = Number((V[n] || 0).toFixed(2));
        });

        const compMetrics = {};
        state.components.forEach(comp => {
            const pins = getComponentPins(comp);
            if (comp.type === 'RESISTOR') {
                const v1 = nodeVoltages[posKey(pins[0].x, pins[0].y)] || 0;
                const v2 = nodeVoltages[posKey(pins[1].x, pins[1].y)] || 0;
                const r = Math.max(0.1, Number(comp.resistance) || 1000);
                const currentMa = (Math.abs(v1 - v2) / r) * 1000;
                compMetrics[comp.id] = { currentMa, voltageDrop: Math.abs(v1 - v2) };
            } else if (comp.type === 'LED') {
                const va = nodeVoltages[posKey(pins[0].x, pins[0].y)] || 0;
                const vk = nodeVoltages[posKey(pins[1].x, pins[1].y)] || 0;
                const vd = va - vk;
                const currentMa = vd > 2.0 ? ((vd - 2.0) / 20.0) * 1000 : 0;
                const brightness = Math.min(1, currentMa / 15.0);
                compMetrics[comp.id] = {
                    currentMa,
                    voltageDrop: vd,
                    brightness,
                    overcurrent: currentMa > 45
                };
            }
        });

        // Atualiza estado das entradas digitais do CLP e sincroniza com a aba Programação
        plcSpec.pins.forEach(p => {
            if (p.kind !== 'PLC_IN') return;
            const vIn = nodeVoltages[posKey(p.x, p.y)] || 0;
            const isHigh = vIn >= 12.0;
            if (state.simResults.sentInputs[p.addr] !== isHigh) {
                state.simResults.sentInputs[p.addr] = isHigh;
                if (window.parent && window.parent !== window) {
                    window.parent.postMessage({
                        type: 'EXTERNAL_INPUT_STATE',
                        addr: p.addr,
                        value: isHigh
                    }, '*');
                }
            }
        });

        // Energização visual dos fios (inclui trechos de 24V e trechos ativos de carga >= 1.5V)
        const wireEnergized = {};
        state.wires.forEach(w => {
            if (!w.points || w.points.length === 0) return;
            let maxV = 0;
            w.points.forEach(pt => {
                const v = nodeVoltages[posKey(pt.x, pt.y)] || 0;
                if (v > maxV) maxV = v;
            });
            wireEnergized[w.id] = {
                energized: maxV >= 12.0,
                activeLow: maxV >= 1.5 && maxV < 12.0,
                voltage: maxV
            };
        });

        state.simResults.nodeVoltages = nodeVoltages;
        state.simResults.compMetrics = compMetrics;
        state.simResults.wireEnergized = wireEnergized;

        if (typeof app.updateLiveSimulationVisuals === 'function') {
            app.updateLiveSimulationVisuals();
        }
    }

    Object.assign(app, {
        runElectricalSimulation
    });
})();