(function () {
    'use strict';

    const app = window.ProgramApp;
    const { state, cache, escapeHtml } = app;

    function buildCellSvg(cell, rIdx, row, col) {
        const key = `${rIdx}:${row}:${col}`;
        const en = state.energizedMap[key] || { left: false, right: false, down: false };
        const isHwInvalid = Boolean(cell.addr && state.hwValidation?.invalidAddrs?.has(cell.addr));
        const cLeft = en.left ? '#10b981' : '#475569';
        const cRight = isHwInvalid ? '#f43f5e' : (en.right ? '#10b981' : '#475569');
        const cDown = en.down ? '#10b981' : '#475569';
        const tag = cell.addr && state.tags[cell.addr] ? state.tags[cell.addr] : '';
        const w = state.cellWidth || 96;
        const mid = w / 2;

        let svg = `<svg class="cell-svg" viewBox="0 0 ${w} 76">`;

        if (cell.branchDown) {
            svg += `<line x1="0" y1="38" x2="0" y2="76" stroke="${cDown}" stroke-width="2.5" />`;
            svg += `<circle cx="0" cy="38" r="3" fill="${cDown}" />`;
        }
        if (row > 0 && state.rungs[rIdx].rows[row - 1][col].branchDown) {
            const aboveEn = state.energizedMap[`${rIdx}:${row - 1}:${col}`]?.down;
            svg += `<line x1="0" y1="0" x2="0" y2="38" stroke="${aboveEn ? '#10b981' : '#475569'}" stroke-width="2.5" />`;
        }

        if (cell.type === 'EMPTY') {
            if (row === 0) {
                svg += `<line x1="0" y1="38" x2="${w}" y2="38" stroke="#1e293b" stroke-width="1.5" stroke-dasharray="3 3" />`;
            }
            svg += `</svg>`;
            return svg;
        }

        if (cell.type === 'WIRE') {
            svg += `<line x1="0" y1="38" x2="${w}" y2="38" stroke="${cLeft}" stroke-width="2.5" />`;
            svg += `</svg>`;
            return svg;
        }

        svg += `<line x1="0" y1="38" x2="${mid - 12}" y2="38" stroke="${cLeft}" stroke-width="2.5" />`;
        svg += `<line x1="${mid + 12}" y1="38" x2="${w}" y2="38" stroke="${cRight}" stroke-width="2.5" />`;

        const addrColor = isHwInvalid ? '#fda4af' : (en.right ? '#34d399' : '#e2e8f0');
        svg += `<text x="${mid}" y="16" text-anchor="middle" fill="${addrColor}" font-family="monospace" font-size="11.5" font-weight="800">${escapeHtml(cell.addr)}</text>`;

        if (isHwInvalid) {
            svg += `<text x="${mid}" y="68" text-anchor="middle" fill="#fda4af" font-family="monospace" font-size="9" font-weight="800">⚠ SEM PORTA</text>`;
        } else if (tag) {
            svg += `<text x="${mid}" y="68" text-anchor="middle" fill="#94a3b8" font-family="sans-serif" font-size="9.5">${escapeHtml(tag.slice(0, 14))}</text>`;
        }

        const symColor = isHwInvalid ? '#f43f5e' : (en.right ? '#10b981' : '#cbd5e1');
        if (['NO', 'NC', 'P', 'N'].includes(cell.type)) {
            svg += `<line x1="${mid - 12}" y1="26" x2="${mid - 12}" y2="50" stroke="${symColor}" stroke-width="2.6" />`;
            svg += `<line x1="${mid + 12}" y1="26" x2="${mid + 12}" y2="50" stroke="${symColor}" stroke-width="2.6" />`;
            if (cell.type === 'NC') {
                svg += `<line x1="${mid - 9}" y1="49" x2="${mid + 9}" y2="27" stroke="${symColor}" stroke-width="2.2" />`;
            } else if (cell.type === 'P') {
                svg += `<text x="${mid}" y="42" text-anchor="middle" fill="${symColor}" font-family="monospace" font-size="12" font-weight="800">P</text>`;
            } else if (cell.type === 'N') {
                svg += `<text x="${mid}" y="42" text-anchor="middle" fill="${symColor}" font-family="monospace" font-size="12" font-weight="800">N</text>`;
            }
        } else if (['COIL', 'COIL_NC', 'SET', 'RESET'].includes(cell.type)) {
            svg += `<path d="M ${mid - 9} 26 A 14 14 0 0 0 ${mid - 9} 50" fill="none" stroke="${symColor}" stroke-width="2.6" />`;
            svg += `<path d="M ${mid + 9} 26 A 14 14 0 0 1 ${mid + 9} 50" fill="none" stroke="${symColor}" stroke-width="2.6" />`;
            if (cell.type === 'COIL_NC') {
                svg += `<line x1="${mid - 8}" y1="49" x2="${mid + 8}" y2="27" stroke="${symColor}" stroke-width="2.2" />`;
            } else if (cell.type === 'SET') {
                svg += `<text x="${mid}" y="42" text-anchor="middle" fill="${symColor}" font-family="monospace" font-size="12" font-weight="800">S</text>`;
            } else if (cell.type === 'RESET') {
                svg += `<text x="${mid}" y="42" text-anchor="middle" fill="${symColor}" font-family="monospace" font-size="12" font-weight="800">R</text>`;
            }
        } else if (cell.type === 'TON' || cell.type === 'CTU') {
            const isTon = cell.type === 'TON';
            const info = isTon
                ? `${((state.timers[cell.addr]?.pt ?? cell.preset) / 1000).toFixed(1)}s`
                : `PV:${state.counters[cell.addr]?.pv ?? cell.preset}`;
            svg += `<rect x="${mid - 22}" y="23" width="44" height="30" rx="5" fill="#0f172a" stroke="${symColor}" stroke-width="2.2" />`;
            svg += `<text x="${mid}" y="36" text-anchor="middle" fill="${symColor}" font-family="monospace" font-size="10" font-weight="800">${cell.type}</text>`;
            svg += `<text x="${mid}" y="48" text-anchor="middle" fill="#94a3b8" font-family="monospace" font-size="9">${info}</text>`;
        }

        svg += `</svg>`;
        return svg;
    }

    function updateHardwareWarningBanner() {
        const banner = document.getElementById('hwLimitBanner');
        const details = document.getElementById('hwLimitDetails');
        if (!banner || !details) return;

        const val = state.hwValidation;
        if (val && val.hasLimitations) {
            banner.style.display = 'flex';
            details.textContent = val.issues.join(' • ');
        } else {
            banner.style.display = 'none';
        }
    }

    function renderRungs() {
        const container = document.getElementById('rungsContainer');
        container.innerHTML = '';

        state.rungs.forEach((rung, rIdx) => {
            const card = document.createElement('div');
            card.className = 'rung-card';

            const rungNum = String(rIdx).padStart(3, '0');
            card.innerHTML = `
        <div class="rung-header">
          <div class="rung-title-group">
            <span class="rung-num-badge">RUNG ${rungNum}</span>
            <input type="text" class="rung-comment-input" data-rung-comment="${rIdx}" value="${escapeHtml(rung.comment)}" placeholder="Comentário da linha (ex: Selo do Motor, Botão Toggle)..." />
          </div>
          <div class="rung-actions">
            <button type="button" class="btn btn-sm" data-rung-up="${rIdx}" title="Mover Rung para cima" ${rIdx === 0 ? 'disabled style="opacity:0.4"' : ''}>↑</button>
            <button type="button" class="btn btn-sm" data-rung-down="${rIdx}" title="Mover Rung para baixo" ${rIdx === state.rungs.length - 1 ? 'disabled style="opacity:0.4"' : ''}>↓</button>
            <button type="button" class="btn btn-sm" data-rung-dup="${rIdx}" title="Duplicar Rung">⧉</button>
            <button type="button" class="btn btn-sm btn-rose" data-rung-del="${rIdx}" title="Excluir Rung">🗑</button>
          </div>
        </div>
        <div class="rung-canvas-scroll">
          <div class="ladder-grid-wrapper">
            <div class="power-rail left"></div>
            <table class="ladder-cells-table" data-rung-table="${rIdx}"></table>
            <div class="power-rail right ${state.rungRightRail[rIdx] ? 'energized' : ''}" data-right-rail="${rIdx}"></div>
          </div>
        </div>
      `;

            container.appendChild(card);
            app.syncCellWidth();

            const table = card.querySelector('table');
            rung.rows.forEach((rowCells, rowIdx) => {
                const tr = document.createElement('tr');
                rowCells.forEach((cell, colIdx) => {
                    const td = document.createElement('td');
                    td.className = 'ladder-cell';
                    td.dataset.rung = rIdx;
                    td.dataset.row = rowIdx;
                    td.dataset.col = colIdx;
                    td.draggable = !['EMPTY', 'WIRE'].includes(cell.type);
                    td.title = td.draggable ? 'Arraste para reposicionar • Duplo clique para editar a variável' : 'Clique para selecionar';

                    if (
                        state.selectedCell &&
                        state.selectedCell.rungIdx === rIdx &&
                        state.selectedCell.row === rowIdx &&
                        state.selectedCell.col === colIdx
                    ) {
                        td.classList.add('selected');
                    }

                    td.innerHTML = `<div class="cell-hover-ring"></div>${buildCellSvg(cell, rIdx, rowIdx, colIdx)}`;
                    tr.appendChild(td);
                });
                table.appendChild(tr);
            });
        });

        const mapped = app.scanUsedAddresses();
        app.evaluateHardwareLimits(mapped);
        updateHardwareWarningBanner();
        app.syncStateToMain(mapped, true);
    }

    function renderModularSidebar(mapped) {
        const invalidAddrs = state.hwValidation?.invalidAddrs || new Set();

        document.getElementById('countInputs').textContent = mapped.inputs.length;
        const bodyInputs = document.getElementById('bodyInputs');
        if (mapped.inputs.length === 0) {
            bodyInputs.innerHTML = `<div class="empty-module-hint">Nenhuma entrada no diagrama.<br />Insira um contato <strong>I0</strong>, <strong>I1</strong> ou <strong>AI0</strong> para mapear automaticamente.</div>`;
        } else {
            bodyInputs.innerHTML = mapped.inputs.map(addr => {
                const tag = state.tags[addr] || '';
                const f = state.forces[addr] || 'AUTO';
                const isAnalog = app.classifyAddress(addr) === 'AI';
                const isOver = invalidAddrs.has(addr);
                return `
          <div class="io-row ${isOver ? 'hw-overflow-row' : ''}" data-io-row="${addr}">
            <span class="io-addr-badge ${isAnalog ? 'badge-analog-in' : 'badge-in'}">${escapeHtml(addr)}</span>
            <input type="text" class="io-tag-input" data-tag-addr="${addr}" value="${escapeHtml(tag)}" placeholder="Tag entrada..." />
            <div class="io-controls">
              ${isOver ? '<span class="hw-over-tag" title="Porta excede limite do CLP">⚠</span>' : ''}
              <button type="button" class="btn-momentary" data-hold-addr="${addr}" title="Segurar pulsador (1 enquanto pressionado)">Pulso</button>
              <button type="button" class="btn-latch ${state.latched[addr] ? 'latched' : ''}" data-latch-addr="${addr}" title="Chave com retenção (Alterna 0/1)">Chave</button>
              <select class="force-select ${f !== 'AUTO' ? 'forced' : ''}" data-force-addr="${addr}" title="Forçar estado">
                <option value="AUTO" ${f === 'AUTO' ? 'selected' : ''}>AUTO</option>
                <option value="F1" ${f === 'F1' ? 'selected' : ''}>F1</option>
                <option value="F0" ${f === 'F0' ? 'selected' : ''}>F0</option>
              </select>
              <span class="state-pill">0</span>
            </div>
          </div>
        `;
            }).join('');
        }

        document.getElementById('countOutputs').textContent = mapped.outputs.length;
        const bodyOutputs = document.getElementById('bodyOutputs');
        if (mapped.outputs.length === 0) {
            bodyOutputs.innerHTML = `<div class="empty-module-hint">Nenhuma saída no diagrama.<br />Insira uma bobina <strong>Q0</strong>, <strong>Q1</strong> ou <strong>AQ0</strong> para mapear automaticamente.</div>`;
        } else {
            bodyOutputs.innerHTML = mapped.outputs.map(addr => {
                const tag = state.tags[addr] || '';
                const f = state.forces[addr] || 'AUTO';
                const isAnalog = app.classifyAddress(addr) === 'AO';
                const isOver = invalidAddrs.has(addr);
                return `
          <div class="io-row ${isOver ? 'hw-overflow-row' : ''}" data-io-row="${addr}">
            <span class="io-addr-badge ${isAnalog ? 'badge-analog-out' : 'badge-out'}">${escapeHtml(addr)}</span>
            <input type="text" class="io-tag-input" data-tag-addr="${addr}" value="${escapeHtml(tag)}" placeholder="Tag saída..." />
            <div class="io-controls">
              ${isOver ? '<span class="hw-over-tag" title="Porta excede limite do CLP">⚠</span>' : ''}
              <select class="force-select ${f !== 'AUTO' ? 'forced' : ''}" data-force-addr="${addr}" title="Forçar saída">
                <option value="AUTO" ${f === 'AUTO' ? 'selected' : ''}>AUTO</option>
                <option value="F1" ${f === 'F1' ? 'selected' : ''}>F1</option>
                <option value="F0" ${f === 'F0' ? 'selected' : ''}>F0</option>
              </select>
              <span class="output-led"></span>
              <span class="state-pill">OFF</span>
            </div>
          </div>
        `;
            }).join('');
        }

        document.getElementById('countVars').textContent = mapped.vars.length;
        const bodyVars = document.getElementById('bodyVars');
        if (mapped.vars.length === 0) {
            bodyVars.innerHTML = `<div class="empty-module-hint">Nenhuma memória ou bloco no diagrama.<br />Use <strong>M0</strong>, <strong>T0</strong> ou <strong>C0</strong> nas linhas Ladder.</div>`;
        } else {
            bodyVars.innerHTML = mapped.vars.map(addr => {
                const tag = state.tags[addr] || '';
                if (state.timers[addr]) {
                    return `
            <div class="io-row" data-io-row="${addr}">
              <span class="io-addr-badge badge-blk">${escapeHtml(addr)}</span>
              <input type="text" class="io-tag-input" data-tag-addr="${addr}" value="${escapeHtml(tag)}" placeholder="Tag timer..." />
              <div class="io-controls">
                <div class="timer-mini-bar"><div class="timer-mini-fill"></div></div>
                <span data-blk-readout style="font-family:var(--font-mono); font-size:10px; color:var(--text-secondary);">0.0/2.0s</span>
                <span class="state-pill">0</span>
              </div>
            </div>
          `;
                }
                if (state.counters[addr]) {
                    return `
            <div class="io-row" data-io-row="${addr}">
              <span class="io-addr-badge badge-blk">${escapeHtml(addr)}</span>
              <input type="text" class="io-tag-input" data-tag-addr="${addr}" value="${escapeHtml(tag)}" placeholder="Tag contador..." />
              <div class="io-controls">
                <span data-blk-readout style="font-family:var(--font-mono); font-size:10px; color:var(--text-secondary);">0/5</span>
                <span class="state-pill">0</span>
              </div>
            </div>
          `;
                }
                const f = state.forces[addr] || 'AUTO';
                return `
          <div class="io-row" data-io-row="${addr}">
            <span class="io-addr-badge badge-mem">${escapeHtml(addr)}</span>
            <input type="text" class="io-tag-input" data-tag-addr="${addr}" value="${escapeHtml(tag)}" placeholder="Tag memória..." />
            <div class="io-controls">
              <select class="force-select ${f !== 'AUTO' ? 'forced' : ''}" data-force-addr="${addr}" title="Forçar bit">
                <option value="AUTO" ${f === 'AUTO' ? 'selected' : ''}>AUTO</option>
                <option value="F1" ${f === 'F1' ? 'selected' : ''}>F1</option>
                <option value="F0" ${f === 'F0' ? 'selected' : ''}>F0</option>
              </select>
              <span class="state-pill">0</span>
            </div>
          </div>
        `;
            }).join('');
        }
    }

    function updateLiveVisuals(mapped) {
        app.syncCellWidth();
        updateHardwareWarningBanner();

        document.querySelectorAll('.ladder-cell').forEach(td => {
            const rIdx = Number(td.dataset.rung);
            const row = Number(td.dataset.row);
            const col = Number(td.dataset.col);
            const cell = state.rungs[rIdx]?.rows[row]?.[col];
            if (!cell) return;
            const svgEl = td.querySelector('.cell-svg');
            if (svgEl) {
                svgEl.outerHTML = buildCellSvg(cell, rIdx, row, col);
            }
        });

        document.querySelectorAll('[data-right-rail]').forEach(rail => {
            const rIdx = Number(rail.dataset.rightRail);
            rail.classList.toggle('energized', Boolean(state.rungRightRail[rIdx]));
        });

        const sig = JSON.stringify({
            mapped,
            invalid: Array.from(state.hwValidation?.invalidAddrs || [])
        });
        if (sig !== cache.lastMappedSignature) {
            cache.lastMappedSignature = sig;
            renderModularSidebar(mapped);
        }

        mapped.inputs.forEach(addr => {
            const on = Boolean(state.bits[addr]);
            const rowEl = document.querySelector(`[data-io-row="${addr}"]`);
            if (rowEl) {
                rowEl.classList.toggle('active-row', on);
                const pill = rowEl.querySelector('.state-pill');
                if (pill) {
                    pill.textContent = on ? '1' : '0';
                    pill.classList.toggle('on', on);
                }
                const latchBtn = rowEl.querySelector('.btn-latch');
                if (latchBtn) {
                    latchBtn.classList.toggle('latched', Boolean(state.latched[addr]));
                }
            }
        });

        mapped.outputs.forEach(addr => {
            const on = Boolean(state.bits[addr]);
            const rowEl = document.querySelector(`[data-io-row="${addr}"]`);
            if (rowEl) {
                rowEl.classList.toggle('active-row', on);
                const led = rowEl.querySelector('.output-led');
                if (led) led.classList.toggle('on', on);
                const pill = rowEl.querySelector('.state-pill');
                if (pill) {
                    pill.textContent = on ? 'ON' : 'OFF';
                    pill.classList.toggle('on', on);
                }
            }
        });

        mapped.vars.forEach(addr => {
            const rowEl = document.querySelector(`[data-io-row="${addr}"]`);
            if (!rowEl) return;

            if (state.timers[addr]) {
                const tm = state.timers[addr];
                rowEl.classList.toggle('active-row', tm.q);
                const fill = rowEl.querySelector('.timer-mini-fill');
                if (fill) {
                    const pct = tm.pt > 0 ? Math.min(100, (tm.et / tm.pt) * 100) : 0;
                    fill.style.width = `${pct}%`;
                }
                const txt = rowEl.querySelector('[data-blk-readout]');
                if (txt) txt.textContent = `${(tm.et / 1000).toFixed(1)}/${(tm.pt / 1000).toFixed(1)}s`;
                const pill = rowEl.querySelector('.state-pill');
                if (pill) {
                    pill.textContent = tm.q ? '1' : '0';
                    pill.classList.toggle('on', tm.q);
                }
            } else if (state.counters[addr]) {
                const ct = state.counters[addr];
                rowEl.classList.toggle('active-row', ct.q);
                const txt = rowEl.querySelector('[data-blk-readout]');
                if (txt) txt.textContent = `${ct.cv}/${ct.pv}`;
                const pill = rowEl.querySelector('.state-pill');
                if (pill) {
                    pill.textContent = ct.q ? '1' : '0';
                    pill.classList.toggle('on', ct.q);
                }
            } else {
                const on = Boolean(state.bits[addr]);
                rowEl.classList.toggle('active-row', on);
                const pill = rowEl.querySelector('.state-pill');
                if (pill) {
                    pill.textContent = on ? '1' : '0';
                    pill.classList.toggle('on', on);
                }
            }
        });
    }

    Object.assign(app, {
        buildCellSvg,
        renderRungs,
        renderModularSidebar,
        updateLiveVisuals
    });
})();