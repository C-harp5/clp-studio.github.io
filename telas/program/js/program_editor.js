(function () {
    'use strict';

    const app = window.ProgramApp;
    const { state, cache } = app;

    const OUTPUT_TYPES = ['COIL', 'COIL_NC', 'SET', 'RESET', 'TON', 'CTU'];
    const CONTACT_TYPES = ['NO', 'NC', 'P', 'N'];

    function setActiveTool(tool) {
        state.activeTool = tool;
        document.querySelectorAll('.tool-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.tool === tool);
        });
    }

    // Identifica todos os ramos paralelos em U [lo, hi] existentes na linha `branchRow` (branchRow > 0)
    function getBranchSpansOnRow(rung, branchRow) {
        if (!rung || branchRow <= 0 || !rung.rows[branchRow] || !rung.rows[branchRow - 1]) return [];
        const cols = app.getRungCols(rung);
        const rowCells = rung.rows[branchRow];
        const aboveCells = rung.rows[branchRow - 1];
        const spans = [];

        let c = 0;
        while (c < cols) {
            if (rowCells[c].type !== 'EMPTY') {
                const start = c;
                while (c + 1 < cols && rowCells[c + 1].type !== 'EMPTY' && !aboveCells[c + 1]?.branchDown) {
                    c++;
                }
                const end = c;
                const lo = start;
                const hi = end + 1;
                if (aboveCells[lo]?.branchDown && aboveCells[hi]?.branchDown) {
                    spans.push({ lo, hi, row: branchRow });
                }
            }
            c++;
        }
        return spans;
    }

    // Retorna o ramo em U ao qual a célula (row, col) pertence (tanto na parte de cima quanto na de baixo)
    function findEnclosingBranch(rung, row, col) {
        if (row > 0) {
            const spans = getBranchSpansOnRow(rung, row);
            return spans.find(s => col >= s.lo && col < s.hi) || null;
        }
        if (row === 0 && rung.rows.length > 1) {
            const spans = getBranchSpansOnRow(rung, 1);
            return spans.find(s => col >= s.lo && col < s.hi) || null;
        }
        return null;
    }

    function createParallelBranch(rungIdx, sourceRow, a, b) {
        const rung = state.rungs[rungIdx];
        if (!rung) return false;

        let cols = app.getRungCols(rung);
        let lo = Math.max(0, Math.min(a, b));
        let hi = Math.max(0, Math.max(a, b));
        if (hi <= lo) return false;

        // Se o ramo atingir a coluna da saída/bobina, abre espaço automaticamente antes da saída
        while (hi >= cols - 1) {
            app.insertColumnInRung(rung, cols - 1, false);
            cols = app.getRungCols(rung);
        }

        const src = rung.rows[sourceRow];
        if (!src) return false;

        for (let c = lo; c < hi; c++) {
            if (OUTPUT_TYPES.includes(src[c].type)) {
                app.showToast('Solte o ramo antes da bobina ou do bloco de saída.');
                return false;
            }
        }
        const crosses = row => {
            for (let c = lo + 1; c < hi; c++) if (row[c]?.branchDown) return true;
            return false;
        };
        if (crosses(src)) {
            app.showToast('O ramo cruzaria outra derivação. Escolha um trecho que não a atravesse.');
            return false;
        }

        app.ensureRowExists(rung, sourceRow + 1);
        let below = rung.rows[sourceRow + 1];
        const reusable = below.slice(lo, hi).every(c => c.type === 'EMPTY') && !crosses(below);
        if (!reusable) {
            const newRow = Array.from({ length: cols }, () => app.createEmptyCell());
            src.forEach((c, i) => { if (c.branchDown) newRow[i].branchDown = true; });
            rung.rows.splice(sourceRow + 1, 0, newRow);
            below = newRow;
        }
        for (let c = lo; c < hi; c++) {
            below[c].type = 'WIRE';
            below[c].addr = '';
        }
        src[lo].branchDown = true;
        src[hi].branchDown = true;

        state.selectedCell = null;
        cache.lastMappedSignature = '';
        app.renderRungs();
        return true;
    }

    // Ajusta a perna esquerda ou direita de um U-branch existente para [newLo, newHi]
    function resizeParallelBranch(rungIdx, branchRow, oldLo, oldHi, newLo, newHi) {
        const rung = state.rungs[rungIdx];
        if (!rung || branchRow <= 0) return false;
        let cols = app.getRungCols(rung);

        newLo = Math.max(0, newLo);
        newHi = Math.max(newLo + 1, newHi);

        while (newHi >= cols - 1) {
            app.insertColumnInRung(rung, cols - 1, false);
            cols = app.getRungCols(rung);
        }

        const above = rung.rows[branchRow - 1];
        const rowCells = rung.rows[branchRow];

        // Impede encolher sobre células que contêm contatos ativos
        for (let c = oldLo; c < newLo; c++) {
            if (!['EMPTY', 'WIRE'].includes(rowCells[c].type)) return false;
        }
        for (let c = newHi; c < oldHi; c++) {
            if (!['EMPTY', 'WIRE'].includes(rowCells[c].type)) return false;
        }

        // Impede invadir outro ramo adjacente na mesma linha
        for (let c = newLo; c < oldLo; c++) {
            if (rowCells[c].type !== 'EMPTY' || above[c].branchDown) return false;
        }
        for (let c = oldHi; c < newHi; c++) {
            if (rowCells[c].type !== 'EMPTY' || (c > oldHi && above[c].branchDown)) return false;
        }

        // Limpa trechos removidos e preenche trechos expandidos com FIO
        for (let c = oldLo; c < newLo; c++) {
            app.clearCell(rowCells[c]);
        }
        for (let c = newHi; c < oldHi; c++) {
            app.clearCell(rowCells[c]);
        }
        for (let c = newLo; c < oldLo; c++) {
            rowCells[c].type = 'WIRE';
            rowCells[c].addr = '';
        }
        for (let c = oldHi; c < newHi; c++) {
            rowCells[c].type = 'WIRE';
            rowCells[c].addr = '';
        }

        if (newLo !== oldLo) {
            above[oldLo].branchDown = false;
            above[newLo].branchDown = true;
        }
        if (newHi !== oldHi) {
            above[oldHi].branchDown = false;
            above[newHi].branchDown = true;
        }

        app.trimTrailingWireColumns(rung);
        cache.lastMappedSignature = '';
        app.renderRungs();
        return true;
    }

    function applyToolToCell(cell, tool) {
        cell.type = tool;
        cell.addr = '';
        if (tool === 'TON') {
            cell.preset = 2000;
        } else if (tool === 'CTU') {
            cell.preset = 5;
        }
    }

    function handleCellDelete(rung, row, col) {
        const cell = rung.rows[row]?.[col];
        if (!cell) return;
        const cols = app.getRungCols(rung);

        // Ao apagar qualquer componente, coloca um fio no lugar
        if (!['EMPTY', 'WIRE'].includes(cell.type)) {
            cell.type = 'WIRE';
            cell.addr = '';
            cache.lastMappedSignature = '';
            app.renderRungs();
            return;
        }

        // Ao clicar em Limpar sobre o fio de uma linha paralela (row > 0), remove o ramo em U inteiro
        if (row > 0 && cell.type === 'WIRE') {
            let startC = col;
            let endC = col;
            while (startC > 0 && rung.rows[row][startC - 1].type !== 'EMPTY' && !rung.rows[row - 1][startC].branchDown) {
                startC--;
            }
            while (endC + 1 < cols && rung.rows[row][endC + 1].type !== 'EMPTY' && !rung.rows[row - 1][endC + 1].branchDown) {
                endC++;
            }

            for (let c = startC; c <= endC; c++) {
                app.clearCell(rung.rows[row][c]);
            }

            [startC, endC + 1].forEach(n => {
                if (n >= 0 && n < cols) {
                    const stillUsed =
                        rung.rows[row][n].type !== 'EMPTY' ||
                        (n > 0 && rung.rows[row][n - 1].type !== 'EMPTY') ||
                        rung.rows[row][n].branchDown;
                    if (!stillUsed) {
                        rung.rows[row - 1][n].branchDown = false;
                    }
                }
            });

            app.trimEmptyBottomRows(rung);
            app.trimTrailingWireColumns(rung);
            cache.lastMappedSignature = '';
            app.renderRungs();
            return;
        }

        app.clearCell(cell);
        app.trimEmptyBottomRows(rung);
        app.trimTrailingWireColumns(rung);
        cache.lastMappedSignature = '';
        app.renderRungs();
    }

    function handleCellClick(rungIdx, row, col, toolOverride = null, insertSide = 'right') {
        const rung = state.rungs[rungIdx];
        if (!rung || !rung.rows[row] || !rung.rows[row][col]) return;
        const cell = rung.rows[row][col];
        let cols = app.getRungCols(rung);
        state.selectedCell = { rungIdx, row, col };

        const tool = toolOverride || state.activeTool;

        if (tool === 'SELECT') {
            document.querySelectorAll('.ladder-cell.selected').forEach(td => td.classList.remove('selected'));
            const selectedTd = document.querySelector(`.ladder-cell[data-rung="${rungIdx}"][data-row="${row}"][data-col="${col}"]`);
            selectedTd?.classList.add('selected');
            return;
        }

        if (tool === 'DELETE') {
            handleCellDelete(rung, row, col);
            return;
        }

        if (tool === 'WIRE') {
            cell.type = 'WIRE';
            cell.addr = '';
            app.renderRungs();
            return;
        }

        if (tool === 'BRANCH') {
            if (col < cols - 1) {
                createParallelBranch(rungIdx, row, col, col + 1);
            } else {
                app.insertColumnInRung(rung, cols - 1, false);
                createParallelBranch(rungIdx, row, cols - 1, cols);
            }
            return;
        }

        const isCoilLike = OUTPUT_TYPES.includes(tool);
        if (isCoilLike) {
            const targetCol = cols - 1;
            let targetRow = row;
            if (targetRow > 0 && !rung.rows[targetRow - 1]?.[targetCol]?.branchDown) {
                targetRow = 0;
            }
            const targetCell = rung.rows[targetRow][targetCol];
            applyToolToCell(targetCell, tool);

            for (let c = 0; c < targetCol; c++) {
                if (rung.rows[targetRow][c].type === 'EMPTY') rung.rows[targetRow][c].type = 'WIRE';
            }

            cache.lastMappedSignature = '';
            state.selectedCell = { rungIdx, row: targetRow, col: targetCol };
            app.renderRungs();
            return;
        }

        // Inserção de Contatos (NO, NC, P, N) — suporta múltiplos itens em cima e embaixo no ramo em U
        const isContact = CONTACT_TYPES.includes(tool);
        const enclosing = findEnclosingBranch(rung, row, col);

        // Caso 1: Célula já ocupada dentro de um ramo paralelo em U (parte de cima OU parte de baixo)
        // Abre espaço automaticamente e desloca a perna direita do U para caber quantos itens quiser!
        if (isContact && enclosing && !['EMPTY', 'WIRE'].includes(cell.type)) {
            const insertAt = insertSide === 'left' ? col : col + 1;
            const keepLeft = insertSide === 'left' && col === enclosing.lo;
            app.insertColumnInRung(rung, insertAt, keepLeft);

            const placedCell = rung.rows[row][insertAt];
            applyToolToCell(placedCell, tool);

            cache.lastMappedSignature = '';
            state.selectedCell = { rungIdx, row, col: insertAt };
            app.renderRungs();
            return;
        }

        // Caso 2: Clique em linha paralela (row > 0) FORA (à direita ou à esquerda) de um U existente
        // Expande automaticamente o U até a célula clicada para adicionar mais itens em série!
        if (isContact && row > 0 && !enclosing) {
            if (col >= cols - 1) {
                app.insertColumnInRung(rung, cols - 1, false);
                cols = app.getRungCols(rung);
            }

            const spans = getBranchSpansOnRow(rung, row);
            const leftNeighbor = spans.filter(s => s.hi <= col).pop();
            const rightNeighbor = spans.find(s => s.lo > col);

            if (leftNeighbor) {
                const newHi = col + 1;
                while (newHi >= cols - 1) {
                    app.insertColumnInRung(rung, cols - 1, false);
                    cols = app.getRungCols(rung);
                }
                const above = rung.rows[row - 1];
                const rowCells = rung.rows[row];
                for (let c = leftNeighbor.hi; c <= col; c++) {
                    rowCells[c].type = 'WIRE';
                    rowCells[c].addr = '';
                }
                above[leftNeighbor.hi].branchDown = false;
                above[newHi].branchDown = true;

                applyToolToCell(rowCells[col], tool);
                cache.lastMappedSignature = '';
                state.selectedCell = { rungIdx, row, col };
                app.renderRungs();
                return;
            }

            if (rightNeighbor) {
                const newLo = col;
                const above = rung.rows[row - 1];
                const rowCells = rung.rows[row];
                for (let c = newLo; c < rightNeighbor.lo; c++) {
                    rowCells[c].type = 'WIRE';
                    rowCells[c].addr = '';
                }
                above[rightNeighbor.lo].branchDown = false;
                above[newLo].branchDown = true;

                applyToolToCell(rowCells[col], tool);
                cache.lastMappedSignature = '';
                state.selectedCell = { rungIdx, row, col };
                app.renderRungs();
                return;
            }

            // Se não havia nenhum U nessa linha ainda, cria o U e já insere o contato
            createParallelBranch(rungIdx, row - 1, col, col + 1);
            const newCell = rung.rows[row]?.[col];
            if (newCell) {
                applyToolToCell(newCell, tool);
                cache.lastMappedSignature = '';
                state.selectedCell = { rungIdx, row, col };
                app.renderRungs();
            }
            return;
        }

        // Caso 3: Inserção padrão em célula livre / fio (tanto na linha 0 quanto dentro de um U)
        if (col >= cols - 1) {
            app.insertColumnInRung(rung, cols - 1, false);
            cols = app.getRungCols(rung);
        }

        const targetCell = rung.rows[row][col];
        applyToolToCell(targetCell, tool);

        if (row === 0) {
            for (let c = 0; c < cols; c++) {
                if (c !== col && rung.rows[0][c].type === 'EMPTY') {
                    rung.rows[0][c].type = 'WIRE';
                }
            }
        } else if (enclosing) {
            for (let c = enclosing.lo; c < enclosing.hi; c++) {
                if (c !== col && rung.rows[row][c].type === 'EMPTY') {
                    rung.rows[row][c].type = 'WIRE';
                }
            }
        }

        cache.lastMappedSignature = '';
        state.selectedCell = { rungIdx, row, col };
        app.renderRungs();
    }

    function openInlineVariableEditor(td) {
        if (!td || td.querySelector('.inline-variable-editor')) return;
        const rungIdx = Number(td.dataset.rung);
        const row = Number(td.dataset.row);
        const col = Number(td.dataset.col);
        const cell = state.rungs[rungIdx]?.rows[row]?.[col];
        if (!cell || ['EMPTY', 'WIRE'].includes(cell.type)) return;

        state.selectedCell = { rungIdx, row, col };
        document.querySelectorAll('.ladder-cell.selected').forEach(el => el.classList.remove('selected'));
        td.classList.add('selected');

        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'inline-variable-editor';
        input.value = cell.addr || '';
        input.setAttribute('aria-label', 'Variável do elemento');
        input.title = 'Digite a variável e pressione Enter';
        td.appendChild(input);
        td.draggable = false;
        td.classList.add('editing-variable');

        let finished = false;
        const finish = (save) => {
            if (finished) return;
            finished = true;
            if (save) {
                const normalized = app.normalizeAddress(input.value);
                if (!normalized) {
                    finished = false;
                    input.setCustomValidity('Informe um endereço válido, por exemplo I0, Q0, AI0, AQ0 ou M0.');
                    input.reportValidity();
                    input.focus();
                    return;
                }
                const oldAddr = cell.addr;
                cell.addr = normalized;
                if (oldAddr !== normalized && state.tags[oldAddr] && !state.tags[normalized]) {
                    state.tags[normalized] = state.tags[oldAddr];
                    delete state.tags[oldAddr];
                }
                cache.lastMappedSignature = '';
            }

            input.remove();
            td.classList.remove('editing-variable');
            td.draggable = !['EMPTY', 'WIRE'].includes(cell.type);
            if (save) {
                const mapped = app.scanUsedAddresses();
                app.evaluateHardwareLimits(mapped);
                const svgEl = td.querySelector('.cell-svg');
                if (svgEl) svgEl.outerHTML = app.buildCellSvg(cell, rungIdx, row, col);
                app.syncStateToMain(mapped, true);
            }
        };

        input.addEventListener('input', () => input.setCustomValidity(''));
        input.addEventListener('keydown', ev => {
            if (ev.key === 'Enter') { ev.preventDefault(); finish(true); }
            else if (ev.key === 'Escape') { ev.preventDefault(); finish(false); }
            ev.stopPropagation();
        });
        input.addEventListener('blur', () => finish(true));
        input.addEventListener('click', ev => ev.stopPropagation());
        input.addEventListener('dblclick', ev => ev.stopPropagation());
        requestAnimationFrame(() => {
            if (!input.isConnected) return;
            input.focus();
            input.select();
        });
    }

    function closeEditModal() {
        document.getElementById('editModalBackdrop').classList.remove('open');
        state.editingTarget = null;
    }

    function saveEditModal() {
        if (!state.editingTarget) return;
        const { rungIdx, row, col } = state.editingTarget;
        const cell = state.rungs[rungIdx]?.rows[row]?.[col];
        if (!cell) return;

        const normAddr = app.normalizeAddress(document.getElementById('inputAddr').value);
        if (!normAddr) {
            app.showToast('Informe um endereço válido (ex: I1, Q1, AI0, AQ0, M1).');
            return;
        }

        cell.addr = normAddr;
        const tagVal = document.getElementById('inputTag').value.trim();
        if (tagVal) state.tags[normAddr] = tagVal;
        else delete state.tags[normAddr];

        if (cell.type === 'TON') {
            const pt = Math.max(20, Number(document.getElementById('inputPreset').value) || 2000);
            cell.preset = pt;
            if (!state.timers[normAddr]) state.timers[normAddr] = { pt, et: 0, q: false, inPrev: false };
            else state.timers[normAddr].pt = pt;
        } else if (cell.type === 'CTU') {
            const pv = Math.max(1, Math.round(Number(document.getElementById('inputPreset').value) || 5));
            cell.preset = pv;
            if (!state.counters[normAddr]) state.counters[normAddr] = { pv, cv: 0, q: false, cuPrev: false };
            else state.counters[normAddr].pv = pv;
        }

        closeEditModal();
        setActiveTool('SELECT');
        cache.lastMappedSignature = '';
        app.renderRungs();
    }

    document.addEventListener('DOMContentLoaded', () => {
        let draggedTool = null;
        let draggedCell = null;
        let wireBranchGesture = null;
        let branchLegDrag = null;
        let ignoreNextCellClick = false;
        const validDragTools = new Set([
            'NO', 'NC', 'P', 'N', 'COIL', 'COIL_NC', 'SET', 'RESET',
            'TON', 'CTU', 'WIRE', 'BRANCH', 'DELETE'
        ]);

        document.querySelectorAll('.tool-btn').forEach(btn => {
            const tool = btn.dataset.tool;
            btn.addEventListener('click', () => setActiveTool(tool));

            btn.draggable = validDragTools.has(tool);
            if (btn.draggable) {
                btn.addEventListener('dragstart', e => {
                    draggedTool = tool;
                    setActiveTool(tool);
                    btn.classList.add('dragging');
                    e.dataTransfer.effectAllowed = 'copy';
                    e.dataTransfer.setData('text/plain', tool);
                });

                btn.addEventListener('dragend', () => {
                    draggedTool = null;
                    btn.classList.remove('dragging');
                    document.querySelectorAll('.ladder-cell.drag-over, .ladder-cell.insert-left, .ladder-cell.insert-right').forEach(cell => {
                        cell.classList.remove('drag-over', 'insert-left', 'insert-right');
                    });
                });
            }
        });

        document.getElementById('btnAddRung').addEventListener('click', () => {
            state.rungs.push(app.createEmptyRung(''));
            app.renderRungs();
        });

        document.getElementById('btnGoHardwareConfig')?.addEventListener('click', () => {
            if (window.parent && window.parent !== window) {
                window.parent.postMessage({ type: 'NAVIGATE_SCREEN', screen: 'describe' }, '*');
            }
        });

        const rungsContainer = document.getElementById('rungsContainer');

        // Detecta hover/clique sobre a perna vertical esquerda ou direita de um U-branch para redimensionar
        function getBranchLegHit(e) {
            const td = e.target.closest?.('.ladder-cell');
            if (!td || e.target.closest('button, input, .inline-variable-editor')) return null;
            const rect = td.getBoundingClientRect();
            const rungIdx = Number(td.dataset.rung);
            const row = Number(td.dataset.row);
            const col = Number(td.dataset.col);
            const rung = state.rungs[rungIdx];
            if (!rung) return null;

            const cols = app.getRungCols(rung);
            let legCol = null;
            if (Math.abs(e.clientX - rect.left) <= 9) legCol = col;
            else if (Math.abs(e.clientX - rect.right) <= 9 && col + 1 < cols) legCol = col + 1;
            if (legCol === null) return null;

            // Verifica perna vertical conectando row -> row+1 ou row-1 -> row
            const candidateRows = [];
            if (row > 0 && rung.rows[row - 1]?.[legCol]?.branchDown) candidateRows.push(row);
            if (rung.rows[row]?.[legCol]?.branchDown) candidateRows.push(row + 1);

            for (const bRow of candidateRows) {
                const spans = getBranchSpansOnRow(rung, bRow);
                const asLeft = spans.find(s => s.lo === legCol);
                if (asLeft) return { td, rungIdx, branchRow: bRow, side: 'lo', oldLo: asLeft.lo, oldHi: asLeft.hi };
                const asRight = spans.find(s => s.hi === legCol);
                if (asRight) return { td, rungIdx, branchRow: bRow, side: 'hi', oldLo: asRight.lo, oldHi: asRight.hi };
            }
            return null;
        }

        function getWireHit(e) {
            const td = e.target.closest?.('.ladder-cell');
            if (!td || e.target.closest('button, input, .inline-variable-editor')) return null;
            const rect = td.getBoundingClientRect();
            if (Math.abs(e.clientY - (rect.top + rect.height / 2)) > 9) return null;
            const rungIdx = Number(td.dataset.rung);
            const row = Number(td.dataset.row);
            const col = Number(td.dataset.col);
            const rung = state.rungs[rungIdx];
            const cols = app.getRungCols(rung);
            const cell = rung?.rows[row]?.[col];
            if (!cell || cell.type === 'EMPTY') return null;
            const distFromCenter = Math.abs(e.clientX - (rect.left + rect.width / 2));
            if (cell.type !== 'WIRE' && distFromCenter < 18) return null;
            const tRect = td.closest('.ladder-cells-table').getBoundingClientRect();
            const cw = tRect.width / cols;
            const startCol = Math.round((e.clientX - tRect.left) / cw);
            if (startCol >= cols - 1) return null;
            return { td, rungIdx, row, startCol: Math.max(0, startCol) };
        }

        function snapEndCol(g, e) {
            const rung = state.rungs[g.rungIdx];
            const cols = app.getRungCols(rung);
            const tRect = g.td.closest('.ladder-cells-table').getBoundingClientRect();
            return Math.max(0, Math.min(cols - 1, Math.round((e.clientX - tRect.left) / (tRect.width / cols))));
        }

        function removeBranchPreview() {
            document.querySelectorAll('.branch-preview').forEach(el => el.remove());
            document.querySelectorAll('.rung-canvas-scroll.branch-drawing').forEach(el => el.classList.remove('branch-drawing'));
        }

        function cancelBranchGesture() {
            if (wireBranchGesture?.sourceTd?.isConnected) wireBranchGesture.sourceTd.draggable = wireBranchGesture.wasDraggable;
            wireBranchGesture = null;
            removeBranchPreview();
        }

        function cancelLegDrag() {
            if (branchLegDrag?.sourceTd?.isConnected) branchLegDrag.sourceTd.draggable = branchLegDrag.wasDraggable;
            branchLegDrag = null;
            removeBranchPreview();
        }

        function drawBranchPreview(g, e) {
            const wrapper = g.td.closest('.ladder-grid-wrapper');
            const tRect = g.td.closest('.ladder-cells-table').getBoundingClientRect();
            const tdRect = g.td.getBoundingClientRect();
            const wRect = wrapper.getBoundingClientRect();
            const rung = state.rungs[g.rungIdx];
            const cols = app.getRungCols(rung);
            const cw = tRect.width / cols;
            const end = snapEndCol(g, e);
            const lo = Math.min(g.startCol, end), hi = Math.max(g.startCol, end);
            let svg = wrapper.querySelector('.branch-preview');
            if (!svg) {
                svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
                svg.setAttribute('class', 'branch-preview');
                svg.innerHTML = '<path fill="none" stroke="#34d399" stroke-width="3" stroke-dasharray="6 4" stroke-linejoin="round"/>';
                wrapper.appendChild(svg);
            }
            if (hi <= lo || (!g.fromBranchTool && e.clientY <= g.startY + 10)) { svg.style.display = 'none'; return; }
            svg.style.display = '';
            const x1 = tRect.left - wRect.left + lo * cw, x2 = tRect.left - wRect.left + hi * cw;
            const y1 = tdRect.top - wRect.top + tdRect.height / 2, y2 = y1 + tdRect.height;
            svg.firstChild.setAttribute('d', `M ${x1} ${y1} V ${y2} H ${x2} V ${y1}`);
        }

        function drawLegResizePreview(leg, e) {
            const wrapper = leg.td.closest('.ladder-grid-wrapper');
            const table = leg.td.closest('.ladder-cells-table');
            const tRect = table.getBoundingClientRect();
            const wRect = wrapper.getBoundingClientRect();
            const rung = state.rungs[leg.rungIdx];
            const cols = app.getRungCols(rung);
            const cw = tRect.width / cols;
            const rawCol = Math.round((e.clientX - tRect.left) / cw);

            const lo = leg.side === 'lo' ? Math.max(0, Math.min(leg.oldHi - 1, rawCol)) : leg.oldLo;
            const hi = leg.side === 'hi' ? Math.max(leg.oldLo + 1, Math.min(cols - 1, rawCol)) : leg.oldHi;

            let svg = wrapper.querySelector('.branch-preview');
            if (!svg) {
                svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
                svg.setAttribute('class', 'branch-preview');
                svg.innerHTML = '<path fill="none" stroke="#38bdf8" stroke-width="3" stroke-dasharray="6 4" stroke-linejoin="round"/>';
                wrapper.appendChild(svg);
            }
            svg.style.display = '';
            const rowTop = table.rows[leg.branchRow - 1].getBoundingClientRect();
            const rowBot = table.rows[leg.branchRow].getBoundingClientRect();
            const x1 = tRect.left - wRect.left + lo * cw;
            const x2 = tRect.left - wRect.left + hi * cw;
            const y1 = rowTop.top - wRect.top + rowTop.height / 2;
            const y2 = rowBot.top - wRect.top + rowBot.height / 2;
            svg.firstChild.setAttribute('d', `M ${x1} ${y1} V ${y2} H ${x2} V ${y1}`);
        }

        rungsContainer.addEventListener('pointerdown', e => {
            if (e.button !== 0 || draggedTool || draggedCell) return;

            if (state.activeTool === 'BRANCH') {
                const td = e.target.closest?.('.ladder-cell');
                if (!td || e.target.closest('button, input, .inline-variable-editor')) return;
                const rungIdx = Number(td.dataset.rung);
                const col = Number(td.dataset.col);
                const cols = app.getRungCols(state.rungs[rungIdx]);
                if (col >= cols - 1) return;
                wireBranchGesture = {
                    td,
                    rungIdx,
                    row: Number(td.dataset.row),
                    startCol: col,
                    fromBranchTool: true,
                    sourceTd: td,
                    wasDraggable: td.draggable,
                    startX: e.clientX,
                    startY: e.clientY,
                    moved: false
                };
                td.draggable = false;
                return;
            }

            // Arrastar perna vertical de um U-branch existente para alargar/encolher
            const legHit = getBranchLegHit(e);
            if (legHit && state.activeTool !== 'DELETE') {
                branchLegDrag = {
                    ...legHit,
                    sourceTd: legHit.td,
                    wasDraggable: legHit.td.draggable,
                    startX: e.clientX,
                    moved: false
                };
                legHit.td.draggable = false;
                return;
            }

            const hit = getWireHit(e);
            if (!hit) return;
            wireBranchGesture = {
                ...hit,
                fromBranchTool: false,
                sourceTd: hit.td,
                wasDraggable: hit.td.draggable,
                startX: e.clientX,
                startY: e.clientY,
                moved: false
            };
            hit.td.draggable = false;
        });

        window.addEventListener('pointermove', e => {
            if (branchLegDrag) {
                if (!branchLegDrag.moved && Math.abs(e.clientX - branchLegDrag.startX) > 6) {
                    branchLegDrag.moved = true;
                }
                if (branchLegDrag.moved) drawLegResizePreview(branchLegDrag, e);
                return;
            }

            if (!wireBranchGesture) {
                const isLeg = Boolean(getBranchLegHit(e));
                rungsContainer.classList.toggle('leg-hover', isLeg);
                rungsContainer.classList.toggle('wire-hover', !isLeg && Boolean(getWireHit(e)));
                return;
            }
            const g = wireBranchGesture;
            if (!g.moved && Math.hypot(e.clientX - g.startX, e.clientY - g.startY) > 7) {
                g.moved = true;
                g.td.closest('.rung-canvas-scroll')?.classList.add('branch-drawing');
            }
            if (g.moved) drawBranchPreview(g, e);
        });

        window.addEventListener('pointerup', e => {
            if (branchLegDrag) {
                const leg = branchLegDrag;
                const table = leg.sourceTd.isConnected ? leg.sourceTd.closest('.ladder-cells-table') : null;
                let targetCol = null;
                if (leg.moved && table) {
                    const tRect = table.getBoundingClientRect();
                    const cols = app.getRungCols(state.rungs[leg.rungIdx]);
                    targetCol = Math.round((e.clientX - tRect.left) / (tRect.width / cols));
                }
                cancelLegDrag();
                if (leg.moved && targetCol !== null) {
                    ignoreNextCellClick = true;
                    setTimeout(() => { ignoreNextCellClick = false; }, 60);
                    const newLo = leg.side === 'lo' ? Math.min(leg.oldHi - 1, targetCol) : leg.oldLo;
                    const newHi = leg.side === 'hi' ? Math.max(leg.oldLo + 1, targetCol) : leg.oldHi;
                    resizeParallelBranch(leg.rungIdx, leg.branchRow, leg.oldLo, leg.oldHi, newLo, newHi);
                }
                return;
            }

            if (!wireBranchGesture) return;
            const g = wireBranchGesture;
            const endCol = g.moved && g.sourceTd.isConnected ? snapEndCol(g, e) : null;
            cancelBranchGesture();
            if (!g.moved) return;
            ignoreNextCellClick = true;
            setTimeout(() => { ignoreNextCellClick = false; }, 60);
            if ((g.fromBranchTool || e.clientY > g.startY + 10) && endCol !== null && endCol !== g.startCol) {
                createParallelBranch(g.rungIdx, g.row, g.startCol, endCol);
            }
        });

        window.addEventListener('pointercancel', () => {
            cancelBranchGesture();
            cancelLegDrag();
        });

        rungsContainer.addEventListener('dragstart', e => {
            const cellTd = e.target.closest('.ladder-cell');
            if (!cellTd || draggedTool) return;
            const fromRung = Number(cellTd.dataset.rung);
            const fromRow = Number(cellTd.dataset.row);
            const fromCol = Number(cellTd.dataset.col);
            const moving = state.rungs[fromRung]?.rows[fromRow]?.[fromCol];
            if (!moving || ['EMPTY', 'WIRE'].includes(moving.type)) { e.preventDefault(); return; }
            draggedCell = { rung: fromRung, row: fromRow, col: fromCol };
            cellTd.classList.add('moving');
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', 'MOVE_CELL');
        });

        rungsContainer.addEventListener('dragend', () => {
            draggedCell = null;
            document.querySelectorAll('.ladder-cell.moving').forEach(cell => cell.classList.remove('moving'));
            document.querySelectorAll('.ladder-cell.drag-over, .ladder-cell.insert-left, .ladder-cell.insert-right').forEach(cell => {
                cell.classList.remove('drag-over', 'insert-left', 'insert-right');
            });
        });

        rungsContainer.addEventListener('dragover', e => {
            const cellTd = e.target.closest('.ladder-cell');
            if (!cellTd || (!draggedTool && !draggedCell)) return;
            e.preventDefault();
            e.dataTransfer.dropEffect = draggedCell ? 'move' : 'copy';

            document.querySelectorAll('.ladder-cell.drag-over, .ladder-cell.insert-left, .ladder-cell.insert-right').forEach(c => {
                if (c !== cellTd) c.classList.remove('drag-over', 'insert-left', 'insert-right');
            });

            const rIdx = Number(cellTd.dataset.rung);
            const row = Number(cellTd.dataset.row);
            const col = Number(cellTd.dataset.col);
            const rung = state.rungs[rIdx];
            const cell = rung?.rows[row]?.[col];
            const rect = cellTd.getBoundingClientRect();
            const isLeftHalf = (e.clientX - rect.left) < (rect.width / 2);

            if (draggedTool && CONTACT_TYPES.includes(draggedTool) && cell && !['EMPTY', 'WIRE'].includes(cell.type) && findEnclosingBranch(rung, row, col)) {
                cellTd.classList.remove('drag-over');
                cellTd.classList.toggle('insert-left', isLeftHalf);
                cellTd.classList.toggle('insert-right', !isLeftHalf);
            } else {
                cellTd.classList.remove('insert-left', 'insert-right');
                cellTd.classList.add('drag-over');
            }
        });

        rungsContainer.addEventListener('dragleave', e => {
            const cellTd = e.target.closest('.ladder-cell');
            if (cellTd && !cellTd.contains(e.relatedTarget)) {
                cellTd.classList.remove('drag-over', 'insert-left', 'insert-right');
            }
        });

        rungsContainer.addEventListener('drop', e => {
            const cellTd = e.target.closest('.ladder-cell');
            if (!cellTd) return;
            e.preventDefault();
            e.stopPropagation();

            const rect = cellTd.getBoundingClientRect();
            const insertSide = (e.clientX - rect.left) < (rect.width / 2) ? 'left' : 'right';

            document.querySelectorAll('.ladder-cell.drag-over, .ladder-cell.moving, .ladder-cell.insert-left, .ladder-cell.insert-right').forEach(cell => {
                cell.classList.remove('drag-over', 'moving', 'insert-left', 'insert-right');
            });

            const to = { rung: Number(cellTd.dataset.rung), row: Number(cellTd.dataset.row), col: Number(cellTd.dataset.col) };
            if (draggedCell) {
                const from = draggedCell;
                draggedCell = null;
                const sourceRung = state.rungs[from.rung];
                const targetRung = state.rungs[to.rung];
                const sourceCols = app.getRungCols(sourceRung);
                const targetCols = app.getRungCols(targetRung);
                const sourceCell = sourceRung?.rows[from.row]?.[from.col];
                const targetCell = targetRung?.rows[to.row]?.[to.col];
                if (!sourceCell || !targetCell || (from.rung === to.rung && from.row === to.row && from.col === to.col)) return;
                const sourceIsOutput = OUTPUT_TYPES.includes(sourceCell.type);
                const targetIsOutput = OUTPUT_TYPES.includes(targetCell.type);
                if (sourceIsOutput && to.col !== targetCols - 1) {
                    app.showToast('Bobinas, temporizadores e contadores devem ficar na última coluna da Rung.');
                    return;
                }
                if (!sourceIsOutput && to.col === targetCols - 1) {
                    app.showToast('A última coluna da Rung é reservada para bobinas e blocos de saída.');
                    return;
                }
                if (targetIsOutput && from.col !== sourceCols - 1) {
                    app.showToast('Não é possível mover um contato para a coluna reservada à saída.');
                    return;
                }
                const bdS = sourceCell.branchDown, bdT = targetCell.branchDown;
                if (['EMPTY', 'WIRE'].includes(targetCell.type)) {
                    targetRung.rows[to.row][to.col] = sourceCell;
                    sourceCell.branchDown = bdT;
                    sourceRung.rows[from.row][from.col] = Object.assign(app.createEmptyCell(), { type: 'WIRE', branchDown: bdS });

                    if (to.row === 0) {
                        for (let c = 0; c < targetCols; c++) {
                            if (c !== to.col && targetRung.rows[0][c].type === 'EMPTY') {
                                targetRung.rows[0][c].type = 'WIRE';
                            }
                        }
                    } else {
                        const enclosing = findEnclosingBranch(targetRung, to.row, to.col);
                        if (enclosing) {
                            for (let c = enclosing.lo; c < enclosing.hi; c++) {
                                if (c !== to.col && targetRung.rows[to.row][c].type === 'EMPTY') {
                                    targetRung.rows[to.row][c].type = 'WIRE';
                                }
                            }
                        } else {
                            // Se soltou numa linha paralela fora do U, expande o U automaticamente para englobar
                            const spans = getBranchSpansOnRow(targetRung, to.row);
                            const leftNeighbor = spans.filter(s => s.hi <= to.col).pop();
                            const rightNeighbor = spans.find(s => s.lo > to.col);
                            if (leftNeighbor) {
                                const newHi = Math.min(targetCols - 1, to.col + 1);
                                for (let c = leftNeighbor.hi; c < newHi; c++) {
                                    if (targetRung.rows[to.row][c].type === 'EMPTY') targetRung.rows[to.row][c].type = 'WIRE';
                                }
                                targetRung.rows[to.row - 1][leftNeighbor.hi].branchDown = false;
                                targetRung.rows[to.row - 1][newHi].branchDown = true;
                            } else if (rightNeighbor) {
                                for (let c = to.col; c < rightNeighbor.lo; c++) {
                                    if (targetRung.rows[to.row][c].type === 'EMPTY') targetRung.rows[to.row][c].type = 'WIRE';
                                }
                                targetRung.rows[to.row - 1][rightNeighbor.lo].branchDown = false;
                                targetRung.rows[to.row - 1][to.col].branchDown = true;
                            }
                        }
                    }
                } else {
                    sourceRung.rows[from.row][from.col] = targetCell;
                    targetRung.rows[to.row][to.col] = sourceCell;
                    targetCell.branchDown = bdS;
                    sourceCell.branchDown = bdT;
                }
                state.selectedCell = to;
                cache.lastMappedSignature = '';
                app.renderRungs();
                return;
            }

            const tool = e.dataTransfer.getData('text/plain') || draggedTool;
            draggedTool = null;
            if (!validDragTools.has(tool)) return;
            setActiveTool(tool);
            handleCellClick(to.rung, to.row, to.col, tool, insertSide);
        });

        rungsContainer.addEventListener('click', (e) => {
            if (ignoreNextCellClick) { ignoreNextCellClick = false; return; }
            if (e.target.closest('.inline-variable-editor')) return;

            const cellTd = e.target.closest('.ladder-cell');
            if (cellTd) {
                const rungIdx = Number(cellTd.dataset.rung);
                const row = Number(cellTd.dataset.row);
                const col = Number(cellTd.dataset.col);
                const rung = state.rungs[rungIdx];
                const cell = rung?.rows[row]?.[col];
                const isOccupied = cell && !['EMPTY', 'WIRE'].includes(cell.type);
                const rect = cellTd.getBoundingClientRect();
                const insertSide = (e.clientX - rect.left) < (rect.width * 0.35) ? 'left' : 'right';

                if (isOccupied && e.detail >= 2) {
                    e.preventDefault();
                    e.stopPropagation();
                    openInlineVariableEditor(cellTd);
                    return;
                }

                // Dentro de um ramo paralelo em U, clicar com ferramenta de contato insere mais um item em série
                const isInsertingInBranch =
                    isOccupied &&
                    CONTACT_TYPES.includes(state.activeTool) &&
                    Boolean(findEnclosingBranch(rung, row, col));

                if (isOccupied && !isInsertingInBranch && !['DELETE', 'WIRE', 'BRANCH'].includes(state.activeTool)) {
                    state.selectedCell = { rungIdx, row, col };
                    document.querySelectorAll('.ladder-cell.selected').forEach(el => el.classList.remove('selected'));
                    cellTd.classList.add('selected');
                    return;
                }

                handleCellClick(rungIdx, row, col, null, insertSide);
                return;
            }

            const upBtn = e.target.closest('[data-rung-up]');
            if (upBtn) {
                const idx = Number(upBtn.dataset.rungUp);
                if (idx > 0) {
                    [state.rungs[idx - 1], state.rungs[idx]] = [state.rungs[idx], state.rungs[idx - 1]];
                    app.renderRungs();
                }
                return;
            }

            const downBtn = e.target.closest('[data-rung-down]');
            if (downBtn) {
                const idx = Number(downBtn.dataset.rungDown);
                if (idx < state.rungs.length - 1) {
                    [state.rungs[idx], state.rungs[idx + 1]] = [state.rungs[idx + 1], state.rungs[idx]];
                    app.renderRungs();
                }
                return;
            }

            const dupBtn = e.target.closest('[data-rung-dup]');
            if (dupBtn) {
                const idx = Number(dupBtn.dataset.rungDup);
                const clone = JSON.parse(JSON.stringify(state.rungs[idx]));
                clone.id = 'r_' + Math.random().toString(36).slice(2, 9);
                state.rungs.splice(idx + 1, 0, clone);
                app.renderRungs();
                return;
            }

            const delBtn = e.target.closest('[data-rung-del]');
            if (delBtn) {
                const idx = Number(delBtn.dataset.rungDel);
                if (state.rungs.length === 1) {
                    state.rungs[0] = app.createEmptyRung('');
                } else {
                    state.rungs.splice(idx, 1);
                }
                cache.lastMappedSignature = '';
                app.renderRungs();
            }
        });

        rungsContainer.addEventListener('input', (e) => {
            const commentInp = e.target.closest('[data-rung-comment]');
            if (commentInp) {
                const idx = Number(commentInp.dataset.rungComment);
                if (state.rungs[idx]) {
                    state.rungs[idx].comment = commentInp.value;
                    app.syncStateToMain(app.scanUsedAddresses(), true);
                }
            }
        });

        const workspace = document.querySelector('.workspace-grid');
        const sidebarToggle = document.getElementById('btnToggleSidebar');
        sidebarToggle?.addEventListener('click', () => {
            const collapsed = workspace.classList.toggle('sidebar-is-collapsed');
            sidebarToggle.setAttribute('aria-expanded', String(!collapsed));
            sidebarToggle.setAttribute('aria-label', collapsed ? 'Expandir barra de módulos' : 'Recolher barra de módulos');
            sidebarToggle.title = collapsed ? 'Expandir módulos' : 'Recolher módulos';
        });

        document.querySelectorAll('[data-toggle-module]').forEach(header => {
            header.addEventListener('click', () => {
                const modId = header.dataset.toggleModule;
                document.getElementById(modId)?.classList.toggle('collapsed');
            });
        });

        const sidebar = document.querySelector('.sidebar-modular');

        sidebar.addEventListener('pointerdown', (e) => {
            const holdBtn = e.target.closest('[data-hold-addr]');
            if (holdBtn) {
                const addr = holdBtn.dataset.holdAddr;
                state.momentary[addr] = true;
                holdBtn.classList.add('pressed');
            }
        });

        const releaseAllMomentary = () => {
            Object.keys(state.momentary).forEach(k => { state.momentary[k] = false; });
            document.querySelectorAll('.btn-momentary.pressed').forEach(b => b.classList.remove('pressed'));
        };
        window.addEventListener('pointerup', releaseAllMomentary);
        window.addEventListener('pointercancel', releaseAllMomentary);

        sidebar.addEventListener('click', (e) => {
            const latchBtn = e.target.closest('[data-latch-addr]');
            if (latchBtn) {
                const addr = latchBtn.dataset.latchAddr;
                state.latched[addr] = !state.latched[addr];
            }
        });

        sidebar.addEventListener('input', (e) => {
            const tagInp = e.target.closest('[data-tag-addr]');
            if (tagInp) {
                const addr = tagInp.dataset.tagAddr;
                const val = tagInp.value.trim();
                if (val) state.tags[addr] = val;
                else delete state.tags[addr];
                app.syncStateToMain(app.scanUsedAddresses(), true);
            }
        });

        sidebar.addEventListener('change', (e) => {
            const forceSel = e.target.closest('[data-force-addr]');
            if (forceSel) {
                const addr = forceSel.dataset.forceAddr;
                state.forces[addr] = forceSel.value;
                forceSel.classList.toggle('forced', forceSel.value !== 'AUTO');
            }
        });

        document.getElementById('btnCloseModal').addEventListener('click', closeEditModal);
        document.getElementById('btnCancelModal').addEventListener('click', closeEditModal);
        document.getElementById('btnSaveModal').addEventListener('click', saveEditModal);
        document.getElementById('btnDeleteFromModal').addEventListener('click', () => {
            if (!state.editingTarget) return;
            const { rungIdx, row, col } = state.editingTarget;
            closeEditModal();
            handleCellDelete(state.rungs[rungIdx], row, col);
        });

        document.getElementById('quickChipsContainer').addEventListener('click', (e) => {
            const chip = e.target.closest('[data-chip]');
            if (chip) {
                const inp = document.getElementById('inputAddr');
                inp.value = chip.dataset.chip;
                document.getElementById('inputTag').value = state.tags[chip.dataset.chip] || '';
                inp.focus();
            }
        });

        document.getElementById('editModalBackdrop').addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                saveEditModal();
            } else if (e.key === 'Escape') {
                closeEditModal();
            }
        });

        window.addEventListener('keydown', (e) => {
            if (document.getElementById('editModalBackdrop').classList.contains('open')) return;
            if (['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)) return;

            if (e.key === 'Escape') {
                e.preventDefault();
                cancelBranchGesture();
                cancelLegDrag();
                draggedTool = null;
                draggedCell = null;
                document.querySelectorAll('.ladder-cell.drag-over, .ladder-cell.moving, .ladder-cell.insert-left, .ladder-cell.insert-right').forEach(c => {
                    c.classList.remove('drag-over', 'moving', 'insert-left', 'insert-right');
                });
                state.selectedCell = null;
                document.querySelectorAll('.ladder-cell.selected').forEach(td => td.classList.remove('selected'));
                setActiveTool('SELECT');
                return;
            }

            const keyMap = {
                F2: 'NO',
                F3: 'NC',
                F4: 'P',
                F5: 'N',
                F6: 'COIL',
                F7: 'COIL_NC',
                F8: 'SET',
                F9: 'RESET'
            };
            if (keyMap[e.key]) {
                e.preventDefault();
                setActiveTool(keyMap[e.key]);
            } else if (e.key === 'Delete' && state.selectedCell) {
                const { rungIdx, row, col } = state.selectedCell;
                handleCellDelete(state.rungs[rungIdx], row, col);
            }
        });

        window.addEventListener('message', (e) => {
            const msg = e.data;
            if (!msg || typeof msg !== 'object') return;

            if (msg.type === 'CMD_RESET_PLC') {
                app.resetPlcStates();
            } else if (msg.type === 'CMD_NEW_PROJECT') {
                app.initBlankProject();
            } else if (msg.type === 'LOAD_PROGRAM_DATA') {
                app.resetPlcStates();
                state.rungs = msg.payload?.rungs?.length ? msg.payload.rungs : [app.createEmptyRung('')];
                state.tags = msg.payload?.tags || {};
                cache.lastMappedSignature = '';
                app.renderRungs();
            } else if (msg.type === 'HARDWARE_STATE_SYNC') {
                if (msg.payload) {
                    state.hardware = msg.payload;
                    cache.lastMappedSignature = '';
                    app.executePlcScan();
                }
            } else if (msg.type === 'EXTERNAL_INPUT_STATE') {
                if (msg.addr) {
                    state.externalInputs[msg.addr.toUpperCase()] = Boolean(msg.value);
                }
            } else if (msg.type === 'REQUEST_SYNC') {
                app.syncStateToMain(app.scanUsedAddresses(), true);
            }
        });

        app.initBlankProject();
        if (window.parent && window.parent !== window) {
            window.parent.postMessage({ type: 'REQUEST_INITIAL_SYNC' }, '*');
        }
        setInterval(app.executePlcScan, app.SCAN_MS);
    });
})();