(function () {
    'use strict';

    const app = window.SimulateApp = window.SimulateApp || {};

    const GRID = 20;
    const SIM_MS = 30;
    const MAX_HISTORY = 60;

    const LED_COLORS = {
        red: { label: 'Vermelho', hex: '#f43f5e', glow: 'rgba(244, 63, 94, 0.85)' },
        green: { label: 'Verde', hex: '#10b981', glow: 'rgba(16, 185, 129, 0.85)' },
        amber: { label: 'Amarelo', hex: '#f59e0b', glow: 'rgba(245, 158, 11, 0.85)' },
        blue: { label: 'Azul', hex: '#38bdf8', glow: 'rgba(56, 189, 248, 0.85)' }
    };

    const state = {
        tool: 'SELECT', // 'SELECT' | 'WIRE' | 'DELETE'
        placingType: null,
        selectedId: null,

        // CLP sempre presente na bancada (móvel e protegido contra exclusão)
        plc: {
            id: 'PLC',
            x: 460,
            y: 120
        },

        components: [],
        wires: [],

        // Pilha de histórico exclusivo do simulador (Ctrl+Z / Ctrl+Y)
        history: {
            current: null,
            past: [],
            future: []
        },

        wiring: null,

        hardware: {
            mode: 'adaptive',
            cpu: { model: 'CLP Modular Adaptativo', power: '24V DC', di: 8, do: 6, ai: 0, ao: 0, maxModules: 7 },
            modules: []
        },
        program: {
            mapped: { inputs: [], outputs: [], vars: [], digitalInputs: [], digitalOutputs: [], analogInputs: [], analogOutputs: [] },
            bits: {},
            tags: {}
        },

        simResults: {
            nodeVoltages: {},
            compMetrics: {},
            wireEnergized: {},
            sentInputs: {}
        }
    };

    function snapToGrid(val) {
        return Math.round(val / GRID) * GRID;
    }

    function posKey(x, y) {
        return `${snapToGrid(x)},${snapToGrid(y)}`;
    }

    function showToast(msg) {
        const el = document.getElementById('toast');
        if (!el) return;
        el.textContent = msg;
        el.classList.add('show');
        clearTimeout(el._timer);
        el._timer = setTimeout(() => el.classList.remove('show'), 2300);
    }

    // Serializa apenas a estrutura editável do circuito (ignorando pulsos transitórios)
    function captureCircuitSnapshot() {
        return JSON.stringify({
            plc: {
                x: snapToGrid(state.plc.x),
                y: snapToGrid(state.plc.y)
            },
            components: state.components.map(c => {
                const clean = {
                    id: c.id,
                    type: c.type,
                    x: snapToGrid(c.x),
                    y: snapToGrid(c.y),
                    rotation: c.rotation || 0,
                    label: c.label || ''
                };
                if (c.type === 'RESISTOR') clean.resistance = Number(c.resistance) || 1000;
                if (c.type === 'LED') clean.color = c.color || 'green';
                return clean;
            }),
            wires: state.wires.map(w => ({
                id: w.id,
                points: (w.points || []).map(p => ({ x: snapToGrid(p.x), y: snapToGrid(p.y) }))
            }))
        });
    }

    function applyCircuitSnapshot(snapJson) {
        if (!snapJson) return;
        const data = JSON.parse(snapJson);
        const prevSwitchStates = new Map();
        state.components.forEach(c => {
            if (c.type === 'SWITCH') prevSwitchStates.set(c.id, Boolean(c.closed));
        });

        state.plc = {
            id: 'PLC',
            x: data.plc?.x ?? 460,
            y: data.plc?.y ?? 120
        };

        state.components = (data.components || []).map(c => {
            const restored = { ...c };
            if (restored.type === 'BUTTON') restored.pressed = false;
            if (restored.type === 'SWITCH') restored.closed = prevSwitchStates.get(restored.id) || false;
            return restored;
        });

        state.wires = (data.wires || []).map(w => ({
            id: w.id,
            points: (w.points || []).map(p => ({ x: p.x, y: p.y }))
        }));

        if (state.selectedId && state.selectedId !== 'PLC') {
            const exists = state.components.some(c => c.id === state.selectedId) ||
                state.wires.some(w => w.id === state.selectedId);
            if (!exists) state.selectedId = null;
        }
    }

    function updateHistoryButtons() {
        const btnUndo = document.getElementById('btnUndoSim');
        const btnRedo = document.getElementById('btnRedoSim');
        if (btnUndo) btnUndo.disabled = state.history.past.length === 0;
        if (btnRedo) btnRedo.disabled = state.history.future.length === 0;
    }

    function resetHistory() {
        state.history.current = captureCircuitSnapshot();
        state.history.past = [];
        state.history.future = [];
        updateHistoryButtons();
    }

    function recordHistory() {
        const nextSnap = captureCircuitSnapshot();
        if (state.history.current === null) {
            state.history.current = nextSnap;
            updateHistoryButtons();
            return;
        }
        if (nextSnap === state.history.current) return;

        state.history.past.push(state.history.current);
        if (state.history.past.length > MAX_HISTORY) {
            state.history.past.shift();
        }
        state.history.current = nextSnap;
        state.history.future = [];
        updateHistoryButtons();
    }

    function undo() {
        if (state.history.past.length === 0) return false;
        state.history.future.push(state.history.current);
        const prevSnap = state.history.past.pop();
        state.history.current = prevSnap;
        applyCircuitSnapshot(prevSnap);
        updateHistoryButtons();
        syncCircuitToMain();
        if (typeof app.renderAll === 'function') app.renderAll();
        if (typeof app.runElectricalSimulation === 'function') app.runElectricalSimulation();
        return true;
    }

    function redo() {
        if (state.history.future.length === 0) return false;
        state.history.past.push(state.history.current);
        const nextSnap = state.history.future.pop();
        state.history.current = nextSnap;
        applyCircuitSnapshot(nextSnap);
        updateHistoryButtons();
        syncCircuitToMain();
        if (typeof app.renderAll === 'function') app.renderAll();
        if (typeof app.runElectricalSimulation === 'function') app.runElectricalSimulation();
        return true;
    }

    function parseResistance(raw) {
        if (raw === null || raw === undefined) return null;
        const str = String(raw).trim().toLowerCase().replace(',', '.').replace(/ω|ohm|ohms/g, '');
        const match = str.match(/^([0-9]*\.?[0-9]+)\s*([kmg]?)$/);
        if (!match) return null;
        const num = parseFloat(match[1]);
        if (isNaN(num) || num <= 0) return null;
        const multMap = { '': 1, k: 1e3, m: 1e6, g: 1e9 };
        return Math.max(1, Math.min(1e9, num * (multMap[match[2]] || 1)));
    }

    function formatResistance(ohms) {
        const v = Number(ohms) || 1000;
        if (v >= 1e6) return `${+(v / 1e6).toFixed(2)}MΩ`;
        if (v >= 1e3) return `${+(v / 1e3).toFixed(2)}kΩ`;
        return `${Math.round(v)}Ω`;
    }

    function getPlcTerminalSpecs() {
        const hw = state.hardware || {};
        const mapped = state.program?.mapped || {};

        let diCount = 8;
        let doCount = 6;
        let modelName = 'CLP Modular Adaptativo';

        if (hw.mode === 'fixed' && hw.cpu) {
            const cpu = hw.cpu;
            const mods = hw.modules || [];
            diCount = Number(cpu.di || 0) + mods.reduce((s, m) => s + Number(m.di || 0), 0);
            doCount = Number(cpu.do || 0) + mods.reduce((s, m) => s + Number(m.do || 0), 0);
            modelName = cpu.model || 'CLP Pronto';
        } else {
            const diList = mapped.digitalInputs || [];
            const doList = mapped.digitalOutputs || [];
            const maxDi = diList.reduce((mx, a) => Math.max(mx, Number(String(a).replace(/\D/g, '')) || 0), 3);
            const maxDo = doList.reduce((mx, a) => Math.max(mx, Number(String(a).replace(/\D/g, '')) || 0), 3);
            diCount = Math.max(4, Math.min(16, maxDi + 1));
            doCount = Math.max(4, Math.min(16, maxDo + 1));
        }

        const rows = Math.max(diCount, doCount, 4);
        const width = 180;
        const height = 100 + rows * GRID;

        const pins = [];
        const px = snapToGrid(state.plc.x);
        const py = snapToGrid(state.plc.y);

        pins.push({ id: 'VCC_24', label: '+24V', kind: 'POWER_24', x: px, y: py + 40, side: 'left' });
        pins.push({ id: 'GND_0', label: '0V', kind: 'POWER_0', x: px + width, y: py + 40, side: 'right' });

        for (let i = 0; i < diCount; i++) {
            pins.push({
                id: `I${i}`,
                label: `I${i}`,
                kind: 'PLC_IN',
                addr: `I${i}`,
                x: px,
                y: py + 80 + i * GRID,
                side: 'left'
            });
        }

        for (let q = 0; q < doCount; q++) {
            pins.push({
                id: `Q${q}`,
                label: `Q${q}`,
                kind: 'PLC_OUT',
                addr: `Q${q}`,
                x: px + width,
                y: py + 80 + q * GRID,
                side: 'right'
            });
        }

        return {
            x: px,
            y: py,
            width,
            height,
            modelName,
            mode: hw.mode || 'adaptive',
            diCount,
            doCount,
            pins
        };
    }

    function rotateOffset(dx, dy, rotation) {
        const rot = ((rotation % 360) + 360) % 360;
        if (rot === 90) return { dx: -dy, dy: dx };
        if (rot === 180) return { dx: -dx, dy: -dy };
        if (rot === 270) return { dx: dy, dy: -dx };
        return { dx, dy };
    }

    function getComponentPins(comp) {
        const cx = snapToGrid(comp.x);
        const cy = snapToGrid(comp.y);
        const rot = comp.rotation || 0;

        if (comp.type === 'VCC') {
            return [{ id: 'p1', label: '+24V', kind: 'POWER_24', x: cx, y: cy }];
        }
        if (comp.type === 'GND') {
            return [{ id: 'p1', label: '0V', kind: 'POWER_0', x: cx, y: cy }];
        }

        const p1Off = rotateOffset(-40, 0, rot);
        const p2Off = rotateOffset(40, 0, rot);

        if (comp.type === 'LED') {
            return [
                { id: 'a', label: 'Anodo (+)', kind: 'COMP_PIN', x: cx + p1Off.dx, y: cy + p1Off.dy },
                { id: 'k', label: 'Catodo (-)', kind: 'COMP_PIN', x: cx + p2Off.dx, y: cy + p2Off.dy }
            ];
        }

        return [
            { id: 'p1', label: 'Terminal 1', kind: 'COMP_PIN', x: cx + p1Off.dx, y: cy + p1Off.dy },
            { id: 'p2', label: 'Terminal 2', kind: 'COMP_PIN', x: cx + p2Off.dx, y: cy + p2Off.dy }
        ];
    }

    function getAllPins() {
        const list = [];
        const plcSpec = getPlcTerminalSpecs();
        plcSpec.pins.forEach(p => list.push({ ...p, ownerId: 'PLC', ownerName: plcSpec.modelName }));

        state.components.forEach(comp => {
            getComponentPins(comp).forEach(p => {
                list.push({ ...p, ownerId: comp.id, ownerName: comp.label || comp.type });
            });
        });
        return list;
    }

    function createComponent(type, x, y) {
        const id = 'c_' + Math.random().toString(36).slice(2, 9);
        const base = {
            id,
            type,
            x: snapToGrid(x),
            y: snapToGrid(y),
            rotation: 0,
            label: ''
        };

        if (type === 'RESISTOR') return { ...base, resistance: 1000 };
        if (type === 'LED') return { ...base, color: 'green' };
        if (type === 'BUTTON') return { ...base, pressed: false };
        if (type === 'SWITCH') return { ...base, closed: false };
        return base;
    }

    function syncCircuitToMain() {
        if (!window.parent || window.parent === window) return;
        window.parent.postMessage({
            type: 'CIRCUIT_STATE_SYNC',
            payload: {
                plc: { x: state.plc.x, y: state.plc.y },
                components: state.components,
                wires: state.wires
            }
        }, '*');
    }

    function initBlankCircuit() {
        state.plc = { id: 'PLC', x: 460, y: 120 };
        state.components = [];
        state.wires = [];
        state.wiring = null;
        state.selectedId = null;
        state.simResults.sentInputs = {};
        resetHistory();
        if (typeof app.renderAll === 'function') {
            app.renderAll();
        }
        syncCircuitToMain();
    }

    Object.assign(app, {
        GRID,
        SIM_MS,
        LED_COLORS,
        state,
        snapToGrid,
        posKey,
        showToast,
        resetHistory,
        recordHistory,
        undo,
        redo,
        updateHistoryButtons,
        parseResistance,
        formatResistance,
        getPlcTerminalSpecs,
        getComponentPins,
        getAllPins,
        createComponent,
        syncCircuitToMain,
        initBlankCircuit
    });
})();