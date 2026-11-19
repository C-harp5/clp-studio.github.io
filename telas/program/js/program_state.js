(function () {
    'use strict';

    const app = window.ProgramApp = window.ProgramApp || {};

    const MIN_COLS = 9;
    const COLS = MIN_COLS;
    const SCAN_MS = 20;

    const state = {
        rungs: [],
        activeTool: 'SELECT',
        selectedCell: null,
        editingTarget: null,
        cellWidth: 96,

        hardware: {
            mode: 'adaptive',
            cpu: { model: 'CLP Modular Adaptativo', power: '24V DC', di: 8, do: 6, ai: 0, ao: 0, maxModules: 7 },
            modules: []
        },
        hwValidation: {
            hasLimitations: false,
            issues: [],
            invalidAddrs: new Set()
        },

        bits: {},
        prevBits: {},
        momentary: {},
        latched: {},
        externalInputs: {},
        forces: {},
        timers: {},
        counters: {},
        tags: {},

        energizedMap: {},
        rungRightRail: {}
    };

    const cache = {
        lastMappedSignature: '',
        lastBroadcastSig: ''
    };

    function escapeHtml(str) {
        return String(str ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    function showToast(msg) {
        const el = document.getElementById('toast');
        if (!el) return;
        el.textContent = msg;
        el.classList.add('show');
        clearTimeout(el._timer);
        el._timer = setTimeout(() => el.classList.remove('show'), 2300);
    }

    function getRungCols(rung) {
        return Math.max(MIN_COLS, rung?.rows?.[0]?.length || MIN_COLS);
    }

    function syncCellWidth(tableEl = null) {
        const table = tableEl || document.querySelector('.ladder-cells-table');
        if (!table) return state.cellWidth;
        const colCount = table.rows[0]?.cells.length || MIN_COLS;
        const tw = table.getBoundingClientRect().width;
        if (tw > 0) state.cellWidth = tw / colCount;
        return state.cellWidth;
    }

    function normalizeAddress(raw) {
        if (!raw) return '';
        let s = String(raw).trim().toUpperCase().replace(/\s+/g, '');
        if (!s) return '';
        if (/^\d+$/.test(s)) s = 'I' + s;
        return s;
    }

    function classifyAddress(addr) {
        const clean = addr.replace(/^%/, '');
        if (/^(AI|IW)/.test(clean)) return 'AI';
        if (/^(AQ|QW)/.test(clean)) return 'AO';
        if (clean.startsWith('I')) return 'I';
        if (clean.startsWith('Q')) return 'Q';
        return 'VAR';
    }

    function extractChannelIndex(addr) {
        const clean = String(addr || '').replace(/^%/, '').toUpperCase();
        const dotMatch = clean.match(/\.(\d+)$/);
        if (dotMatch) return Number(dotMatch[1]);
        const numMatch = clean.match(/(\d+)$/);
        return numMatch ? Number(numMatch[1]) : 0;
    }

    function isTimerAddr(addr) {
        const clean = addr.replace(/^%/, '');
        return /^T(M)?\d+/.test(clean) && !clean.endsWith('.Q');
    }

    function isCounterAddr(addr) {
        const clean = addr.replace(/^%/, '');
        return /^C\d+/.test(clean) && !clean.endsWith('.Q');
    }

    function naturalSort(a, b) {
        return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
    }

    function createEmptyCell() {
        return {
            type: 'EMPTY',
            addr: '',
            preset: 2000,
            branchDown: false
        };
    }

    function createEmptyRung(comment = '') {
        const rows = [Array.from({ length: MIN_COLS }, () => createEmptyCell())];
        return {
            id: 'r_' + Math.random().toString(36).slice(2, 9),
            comment,
            rows
        };
    }

    function ensureRowExists(rung, rowIdx) {
        const cols = getRungCols(rung);
        while (rung.rows.length <= rowIdx) {
            rung.rows.push(Array.from({ length: cols }, () => createEmptyCell()));
        }
    }

    // Insere uma coluna em toda a Rung preservando conexões horizontais e derivação em U
    function insertColumnInRung(rung, insertCol, keepLeftLegAtInsert = false) {
        const cols = getRungCols(rung);
        const idx = Math.max(0, Math.min(cols, insertCol));

        rung.rows.forEach((rowCells, rIdx) => {
            const newCell = createEmptyCell();

            if (rIdx === 0) {
                const hasAnyContent = rowCells.some(c => c.type !== 'EMPTY');
                if (hasAnyContent) newCell.type = 'WIRE';
            } else {
                const prevCell = idx > 0 ? rowCells[idx - 1] : null;
                const nextCell = idx < rowCells.length ? rowCells[idx] : null;
                const hasLeftLegHere = Boolean(rung.rows[rIdx - 1]?.[idx]?.branchDown);
                if (prevCell && prevCell.type !== 'EMPTY' && nextCell && nextCell.type !== 'EMPTY' && !hasLeftLegHere) {
                    newCell.type = 'WIRE';
                }
            }

            rowCells.splice(idx, 0, newCell);

            // Se inseriu exatamente sobre a perna esquerda de um U, mantém a perna esquerda na coluna inserida
            if (keepLeftLegAtInsert && rowCells[idx + 1]?.branchDown) {
                newCell.branchDown = true;
                rowCells[idx + 1].branchDown = false;
            }
        });

        // Se havia colunas sobrando apenas com FIO antes da coluna de saída, remove uma para manter o layout enxuto
        trimTrailingWireColumns(rung);
    }

    function trimTrailingWireColumns(rung) {
        let cols = getRungCols(rung);
        while (cols > MIN_COLS) {
            const checkCol = cols - 2; // coluna imediatamente antes da bobina/saída
            const topCell = rung.rows[0]?.[checkCol];
            const isRemovable =
                topCell &&
                ['EMPTY', 'WIRE'].includes(topCell.type) &&
                !topCell.branchDown &&
                rung.rows.slice(1).every(r => r[checkCol]?.type === 'EMPTY' && !r[checkCol]?.branchDown);

            if (!isRemovable) break;
            rung.rows.forEach(r => r.splice(checkCol, 1));
            cols--;
        }
    }

    function trimEmptyBottomRows(rung) {
        while (rung.rows.length > 1) {
            const lastIdx = rung.rows.length - 1;
            const aboveIdx = lastIdx - 1;
            const lastEmpty = rung.rows[lastIdx].every(c => c.type === 'EMPTY' && !c.branchDown);
            const hasBranchIntoLast = rung.rows[aboveIdx].some(c => c.branchDown);
            if (lastEmpty && !hasBranchIntoLast) {
                rung.rows.pop();
            } else {
                break;
            }
        }
    }

    function clearCell(cell) {
        const bd = cell.branchDown;
        Object.assign(cell, createEmptyCell(), { branchDown: bd });
    }

    function scanUsedAddresses() {
        const digitalInputs = new Set();
        const digitalOutputs = new Set();
        const analogInputs = new Set();
        const analogOutputs = new Set();
        const vars = new Set();

        for (const rung of state.rungs) {
            for (const row of rung.rows) {
                for (const cell of row) {
                    if (!cell.addr || cell.type === 'EMPTY' || cell.type === 'WIRE') continue;
                    const baseAddr = cell.addr.replace(/\.Q$/i, '');
                    const kind = classifyAddress(baseAddr);

                    if (kind === 'I') digitalInputs.add(baseAddr);
                    else if (kind === 'AI') analogInputs.add(baseAddr);
                    else if (kind === 'Q') digitalOutputs.add(baseAddr);
                    else if (kind === 'AO') analogOutputs.add(baseAddr);
                    else vars.add(baseAddr);

                    if (cell.type === 'TON' || isTimerAddr(baseAddr)) {
                        if (!state.timers[baseAddr]) {
                            state.timers[baseAddr] = { pt: cell.preset || 2000, et: 0, q: false, inPrev: false };
                        } else if (cell.type === 'TON' && cell.preset) {
                            state.timers[baseAddr].pt = cell.preset;
                        }
                    } else if (cell.type === 'CTU' || isCounterAddr(baseAddr)) {
                        if (!state.counters[baseAddr]) {
                            state.counters[baseAddr] = { pv: cell.preset || 5, cv: 0, q: false, cuPrev: false };
                        } else if (cell.type === 'CTU' && cell.preset) {
                            state.counters[baseAddr].pv = cell.preset;
                        }
                    } else {
                        if (state.bits[baseAddr] === undefined) state.bits[baseAddr] = false;
                    }
                }
            }
        }

        const diArr = Array.from(digitalInputs).sort(naturalSort);
        const aiArr = Array.from(analogInputs).sort(naturalSort);
        const doArr = Array.from(digitalOutputs).sort(naturalSort);
        const aoArr = Array.from(analogOutputs).sort(naturalSort);

        return {
            inputs: [...diArr, ...aiArr],
            outputs: [...doArr, ...aoArr],
            digitalInputs: diArr,
            digitalOutputs: doArr,
            analogInputs: aiArr,
            analogOutputs: aoArr,
            vars: Array.from(vars).sort(naturalSort)
        };
    }

    function evaluateHardwareLimits(mapped) {
        if (!state.hardware || state.hardware.mode !== 'fixed') {
            state.hwValidation = { hasLimitations: false, issues: [], invalidAddrs: new Set() };
            return state.hwValidation;
        }

        const cpu = state.hardware.cpu || {};
        const modules = state.hardware.modules || [];
        const totalDi = Number(cpu.di || 0) + modules.reduce((s, m) => s + Number(m.di || 0), 0);
        const totalDo = Number(cpu.do || 0) + modules.reduce((s, m) => s + Number(m.do || 0), 0);
        const totalAi = Number(cpu.ai || 0) + modules.reduce((s, m) => s + Number(m.ai || 0), 0);
        const totalAo = Number(cpu.ao || 0) + modules.reduce((s, m) => s + Number(m.ao || 0), 0);

        const issues = [];
        const invalidAddrs = new Set();

        mapped.digitalInputs.forEach(addr => {
            if (extractChannelIndex(addr) >= totalDi) invalidAddrs.add(addr);
        });
        if (mapped.digitalInputs.some(a => invalidAddrs.has(a))) {
            issues.push(`Entradas DI excedem o limite (${totalDi} canais disponíveis)`);
        }

        mapped.digitalOutputs.forEach(addr => {
            if (extractChannelIndex(addr) >= totalDo) invalidAddrs.add(addr);
        });
        if (mapped.digitalOutputs.some(a => invalidAddrs.has(a))) {
            issues.push(`Saídas DO excedem o limite (${totalDo} canais disponíveis)`);
        }

        mapped.analogInputs.forEach(addr => {
            if (extractChannelIndex(addr) >= totalAi) invalidAddrs.add(addr);
        });
        if (mapped.analogInputs.some(a => invalidAddrs.has(a))) {
            issues.push(`Entradas Analógicas AI excedem o limite (${totalAi} canais disponíveis)`);
        }

        mapped.analogOutputs.forEach(addr => {
            if (extractChannelIndex(addr) >= totalAo) invalidAddrs.add(addr);
        });
        if (mapped.analogOutputs.some(a => invalidAddrs.has(a))) {
            issues.push(`Saídas Analógicas AQ excedem o limite (${totalAo} canais disponíveis)`);
        }

        if (modules.length > Number(cpu.maxModules || 0)) {
            issues.push(`Quantidade de módulos de expansão (${modules.length}) excede o limite da CPU (${cpu.maxModules})`);
        }

        state.hwValidation = {
            hasLimitations: issues.length > 0,
            issues,
            invalidAddrs
        };
        return state.hwValidation;
    }

    function resetPlcStates() {
        Object.keys(state.bits).forEach(k => { state.bits[k] = false; });
        state.prevBits = {};
        state.momentary = {};
        state.latched = {};
        state.externalInputs = {};
        state.forces = {};
        Object.values(state.timers).forEach(t => { t.et = 0; t.q = false; t.inPrev = false; });
        Object.values(state.counters).forEach(c => { c.cv = 0; c.q = false; c.cuPrev = false; });
        cache.lastMappedSignature = '';
        if (typeof app.syncStateToMain === 'function') {
            app.syncStateToMain(scanUsedAddresses(), true);
        }
    }

    function initBlankProject() {
        state.rungs = [createEmptyRung('')];
        state.selectedCell = null;
        state.bits = {};
        state.prevBits = {};
        state.momentary = {};
        state.latched = {};
        state.externalInputs = {};
        state.forces = {};
        state.timers = {};
        state.counters = {};
        state.tags = {};
        cache.lastMappedSignature = '';
        if (typeof app.renderRungs === 'function') {
            app.renderRungs();
        }
    }

    Object.assign(app, {
        MIN_COLS,
        COLS,
        SCAN_MS,
        state,
        cache,
        escapeHtml,
        showToast,
        getRungCols,
        syncCellWidth,
        normalizeAddress,
        classifyAddress,
        extractChannelIndex,
        isTimerAddr,
        isCounterAddr,
        naturalSort,
        createEmptyCell,
        createEmptyRung,
        ensureRowExists,
        insertColumnInRung,
        trimTrailingWireColumns,
        trimEmptyBottomRows,
        clearCell,
        scanUsedAddresses,
        evaluateHardwareLimits,
        resetPlcStates,
        initBlankProject
    });
})();