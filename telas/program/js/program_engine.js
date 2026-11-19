(function () {
    'use strict';

    const app = window.ProgramApp;
    const { COLS, SCAN_MS, state, cache } = app;

    function syncStateToMain(mapped, forceSend = false) {
        if (!window.parent || window.parent === window) return;
        const snapshot = {
            mapped,
            bits: state.bits,
            timers: state.timers,
            counters: state.counters,
            tags: state.tags
        };
        const sig = JSON.stringify(snapshot);
        if (!forceSend && sig === cache.lastBroadcastSig) return;
        cache.lastBroadcastSig = sig;

        window.parent.postMessage({
            type: 'PROGRAM_STATE_SYNC',
            payload: {
                ...snapshot,
                rungs: state.rungs
            }
        }, '*');
    }

    function readBit(rawAddr) {
        if (!rawAddr) return false;
        const addr = rawAddr.toUpperCase();

        // Em modo CLP Pronto, portas físicas inexistentes não fornecem sinal
        if (state.hwValidation?.invalidAddrs?.has(addr)) return false;

        const f = state.forces[addr];
        if (f === 'F1') return true;
        if (f === 'F0') return false;

        const base = addr.replace(/\.Q$/i, '');
        if (state.timers[base]) return Boolean(state.timers[base].q);
        if (state.counters[base]) return Boolean(state.counters[base].q);

        return Boolean(state.bits[addr]);
    }

    function writeBit(rawAddr, val) {
        if (!rawAddr) return;
        const addr = rawAddr.toUpperCase();

        // Em modo CLP Pronto, saídas além do limite físico não energizam hardware
        if (state.hwValidation?.invalidAddrs?.has(addr)) {
            state.bits[addr] = false;
            return;
        }

        state.bits[addr] = Boolean(val);
    }

    function executePlcScan() {
        const mapped = app.scanUsedAddresses();
        app.evaluateHardwareLimits(mapped);

        for (const inAddr of mapped.inputs) {
            if (state.hwValidation?.invalidAddrs?.has(inAddr)) {
                state.bits[inAddr] = false;
                continue;
            }
            const f = state.forces[inAddr];
            if (f === 'F1') state.bits[inAddr] = true;
            else if (f === 'F0') state.bits[inAddr] = false;
            else {
                state.bits[inAddr] = Boolean(
                    state.momentary[inAddr] ||
                    state.latched[inAddr] ||
                    state.externalInputs[inAddr]
                );
            }
        }

        const nextEnergized = {};
        const nextRightRail = {};

        state.rungs.forEach((rung, rIdx) => {
            const numRows = rung.rows.length;
            const nodePower = Array.from({ length: numRows }, () => Array(COLS + 1).fill(false));

            for (let r = 0; r < numRows; r++) {
                nodePower[r][0] = true;
            }

            let rungHasOutputPower = false;

            for (let c = 0; c < COLS; c++) {
                let changed = true;
                while (changed) {
                    changed = false;
                    for (let r = 0; r < numRows - 1; r++) {
                        if (rung.rows[r][c].branchDown) {
                            if (nodePower[r][c] && !nodePower[r + 1][c]) {
                                nodePower[r + 1][c] = true;
                                changed = true;
                            }
                            if (nodePower[r + 1][c] && !nodePower[r][c]) {
                                nodePower[r][c] = true;
                                changed = true;
                            }
                        }
                    }
                }

                for (let r = 0; r < numRows; r++) {
                    const cell = rung.rows[r][c];
                    const inP = nodePower[r][c];
                    let outP = false;

                    if (cell.type === 'WIRE') {
                        outP = inP;
                    } else if (cell.type === 'NO') {
                        outP = Boolean(cell.addr) && inP && readBit(cell.addr);
                    } else if (cell.type === 'NC') {
                        outP = Boolean(cell.addr) && inP && !readBit(cell.addr);
                    } else if (cell.type === 'P') {
                        const cur = readBit(cell.addr);
                        const prev = Boolean(state.prevBits[cell.addr]);
                        outP = Boolean(cell.addr) && inP && cur && !prev;
                    } else if (cell.type === 'N') {
                        const cur = readBit(cell.addr);
                        const prev = Boolean(state.prevBits[cell.addr]);
                        outP = Boolean(cell.addr) && inP && !cur && prev;
                    } else if (cell.type === 'COIL') {
                        writeBit(cell.addr, inP);
                        outP = inP && !state.hwValidation?.invalidAddrs?.has(cell.addr);
                        if (outP) rungHasOutputPower = true;
                    } else if (cell.type === 'COIL_NC') {
                        writeBit(cell.addr, !inP);
                        outP = !inP && !state.hwValidation?.invalidAddrs?.has(cell.addr);
                        if (outP) rungHasOutputPower = true;
                    } else if (cell.type === 'SET') {
                        if (inP) writeBit(cell.addr, true);
                        outP = readBit(cell.addr);
                        if (inP && outP) rungHasOutputPower = true;
                    } else if (cell.type === 'RESET') {
                        if (inP) {
                            if (state.timers[cell.addr]) {
                                state.timers[cell.addr].et = 0;
                                state.timers[cell.addr].q = false;
                            } else if (state.counters[cell.addr]) {
                                state.counters[cell.addr].cv = 0;
                                state.counters[cell.addr].q = false;
                            } else {
                                writeBit(cell.addr, false);
                            }
                        }
                        outP = inP;
                        if (inP) rungHasOutputPower = true;
                    } else if (cell.type === 'TON') {
                        const tm = state.timers[cell.addr];
                        if (tm) {
                            if (inP) {
                                tm.et = Math.min(tm.pt, tm.et + SCAN_MS);
                                tm.q = tm.et >= tm.pt;
                            } else {
                                tm.et = 0;
                                tm.q = false;
                            }
                            outP = tm.q;
                            if (tm.q) rungHasOutputPower = true;
                        }
                    } else if (cell.type === 'CTU') {
                        const ct = state.counters[cell.addr];
                        if (ct) {
                            if (inP && !ct.cuPrev) {
                                ct.cv += 1;
                            }
                            ct.cuPrev = inP;
                            ct.q = ct.cv >= ct.pv;
                            outP = ct.q;
                            if (ct.q) rungHasOutputPower = true;
                        }
                    }

                    nodePower[r][c + 1] = outP;
                    nextEnergized[`${rIdx}:${r}:${c}`] = {
                        left: inP,
                        right: outP,
                        down: Boolean(cell.branchDown && (inP || (r + 1 < numRows && nodePower[r + 1][c])))
                    };
                }
            }

            let tailChanged = true;
            while (tailChanged) {
                tailChanged = false;
                for (let r = 0; r < numRows - 1; r++) {
                    if (rung.rows[r][COLS - 1].branchDown) {
                        if (nodePower[r][COLS] && !nodePower[r + 1][COLS]) {
                            nodePower[r + 1][COLS] = true;
                            tailChanged = true;
                        }
                    }
                }
            }

            nextRightRail[rIdx] = rungHasOutputPower || nodePower.some(row => row[COLS]);
        });

        for (const [addr, mode] of Object.entries(state.forces)) {
            if (state.hwValidation?.invalidAddrs?.has(addr)) continue;
            if (mode === 'F1') state.bits[addr] = true;
            else if (mode === 'F0') state.bits[addr] = false;
        }

        state.prevBits = { ...state.bits };
        state.energizedMap = nextEnergized;
        state.rungRightRail = nextRightRail;

        if (typeof app.updateLiveVisuals === 'function') {
            app.updateLiveVisuals(mapped);
        }
        syncStateToMain(mapped, false);
    }

    Object.assign(app, {
        syncStateToMain,
        readBit,
        writeBit,
        executePlcScan
    });
})();