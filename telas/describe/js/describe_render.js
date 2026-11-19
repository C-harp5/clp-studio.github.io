(function () {
    'use strict';

    const app = window.DescribeApp;
    const { state, escapeHtml, extractChannelIndex } = app;

    function buildPinListHtml(prefix, startIdx, count, usedAddrs, isAnalog = false) {
        if (count <= 0) return '';
        const bits = state.program.bits || {};
        const tags = state.program.tags || {};

        const usedByIndex = {};
        usedAddrs.forEach(addr => {
            usedByIndex[extractChannelIndex(addr)] = addr;
        });

        const items = [];
        for (let i = 0; i < count; i++) {
            const chIdx = startIdx + i;
            const defaultAddr = `${prefix}${chIdx}`;
            const mappedAddr = usedByIndex[chIdx];
            const displayAddr = mappedAddr || defaultAddr;
            const isMapped = Boolean(mappedAddr);
            const isActive = isMapped && Boolean(bits[mappedAddr]);
            const tag = isMapped && tags[mappedAddr] ? tags[mappedAddr] : '';

            const cls = [
                'pin-box',
                isMapped ? 'pin-mapped' : '',
                isAnalog ? 'pin-analog' : '',
                isActive ? 'pin-active' : ''
            ].filter(Boolean).join(' ');

            items.push(`
        <div class="${cls}" title="${escapeHtml(displayAddr)}${tag ? ' — ' + escapeHtml(tag) : ''}">
          <div class="pin-top-row">
            <span class="pin-led"></span>
            <span>${escapeHtml(displayAddr)}</span>
          </div>
          <span class="pin-tag-lbl">${tag ? escapeHtml(tag) : (isMapped ? 'Em uso' : 'Livre')}</span>
        </div>
      `);
        }
        return items.join('');
    }

    function buildOverflowPinsHtml(prefix, totalAvailable, usedAddrs) {
        const overAddrs = usedAddrs.filter(addr => extractChannelIndex(addr) >= totalAvailable);
        if (overAddrs.length === 0) return '';

        return overAddrs.map(addr => `
      <div class="pin-box pin-overflow" title="${escapeHtml(addr)} excede as portas disponíveis no CLP!">
        <div class="pin-top-row">
          <span class="pin-led"></span>
          <span>${escapeHtml(addr)}</span>
        </div>
        <span class="pin-tag-lbl" style="color:#fda4af;">Sem porta!</span>
      </div>
    `).join('');
    }

    function renderPlcRack(evalData) {
        const rackContainer = document.getElementById('plcRackContainer');
        const { rack, usage, totals, hasLimitations, mode } = evalData;
        const { cpu, modules } = rack;

        let diCursor = 0;
        let doCursor = 0;
        let aiCursor = 0;
        let aoCursor = 0;

        // 1. CPU Principal
        const cpuDiHtml = buildPinListHtml('I', diCursor, Number(cpu.di || 0), usage.diList, false);
        diCursor += Number(cpu.di || 0);

        const cpuDoHtml = buildPinListHtml('Q', doCursor, Number(cpu.do || 0), usage.doList, false);
        doCursor += Number(cpu.do || 0);

        const cpuAiHtml = buildPinListHtml('AI', aiCursor, Number(cpu.ai || 0), usage.aiList, true);
        aiCursor += Number(cpu.ai || 0);

        const cpuAoHtml = buildPinListHtml('AQ', aoCursor, Number(cpu.ao || 0), usage.aoList, true);
        aoCursor += Number(cpu.ao || 0);

        let html = `
      <div class="hw-unit hw-cpu-unit">
        <div class="hw-unit-top">
          <div>
            <div class="hw-unit-name">${escapeHtml(cpu.model || 'CPU CLP')}</div>
            <div class="hw-unit-sub">CPU Base &bull; ${escapeHtml(cpu.power || '24V DC')}</div>
          </div>
          <div class="status-leds-box">
            <span class="sys-led run-ok"><i></i>RUN</span>
            <span class="sys-led ${hasLimitations ? 'err-on' : ''}"><i></i>ERR</span>
          </div>
        </div>

        <div class="hw-unit-body">
          <div class="cpu-screen-display">
            <span>${mode === 'adaptive' ? 'MODULAR AUTO' : 'SPEC FIXA'}</span>
            <span>${totals.di}DI / ${totals.do}DO${(totals.ai + totals.ao) > 0 ? ` / ${totals.ai}AI / ${totals.ao}AO` : ''}</span>
          </div>

          ${Number(cpu.di) > 0 ? `
            <div class="io-bank-group">
              <div class="io-bank-title">Entradas Digitais CPU (I0..I${Number(cpu.di) - 1})</div>
              <div class="pins-grid">${cpuDiHtml}</div>
            </div>
          ` : ''}

          ${Number(cpu.do) > 0 ? `
            <div class="io-bank-group">
              <div class="io-bank-title">Saídas Digitais CPU (Q0..Q${Number(cpu.do) - 1})</div>
              <div class="pins-grid">${cpuDoHtml}</div>
            </div>
          ` : ''}

          ${Number(cpu.ai) > 0 ? `
            <div class="io-bank-group">
              <div class="io-bank-title">Entradas Analógicas CPU</div>
              <div class="pins-grid">${cpuAiHtml}</div>
            </div>
          ` : ''}

          ${Number(cpu.ao) > 0 ? `
            <div class="io-bank-group">
              <div class="io-bank-title">Saídas Analógicas CPU</div>
              <div class="pins-grid">${cpuAoHtml}</div>
            </div>
          ` : ''}
        </div>

        <div class="hw-unit-foot">
          <span>SLOT 0 (CPU)</span>
          <span>SCAN 20ms</span>
        </div>
      </div>
    `;

        // 2. Módulos de Expansão no Trilho DIN
        modules.forEach((mod, idx) => {
            const mDi = Number(mod.di || 0);
            const mDo = Number(mod.do || 0);
            const mAi = Number(mod.ai || 0);
            const mAo = Number(mod.ao || 0);
            const isAnalog = (mAi + mAo) > 0;

            const modDiHtml = buildPinListHtml('I', diCursor, mDi, usage.diList, false);
            diCursor += mDi;

            const modDoHtml = buildPinListHtml('Q', doCursor, mDo, usage.doList, false);
            doCursor += mDo;

            const modAiHtml = buildPinListHtml('AI', aiCursor, mAi, usage.aiList, true);
            aiCursor += mAi;

            const modAoHtml = buildPinListHtml('AQ', aoCursor, mAo, usage.aoList, true);
            aoCursor += mAo;

            html += `
        <div class="hw-unit hw-exp-unit ${isAnalog ? 'exp-analog' : ''}">
          <div class="hw-unit-top">
            <div>
              <div class="hw-unit-name">${escapeHtml(mod.name)}</div>
              <div class="hw-unit-sub">${mod.auto ? 'Expansão Automática' : `Slot Expansão #${idx + 1}`}</div>
            </div>
          </div>

          <div class="hw-unit-body">
            ${mDi > 0 ? `
              <div class="io-bank-group">
                <div class="io-bank-title">Entradas DI</div>
                <div class="pins-grid">${modDiHtml}</div>
              </div>
            ` : ''}
            ${mDo > 0 ? `
              <div class="io-bank-group">
                <div class="io-bank-title">Saídas DO</div>
                <div class="pins-grid">${modDoHtml}</div>
              </div>
            ` : ''}
            ${mAi > 0 ? `
              <div class="io-bank-group">
                <div class="io-bank-title">Canais Analógicos AI</div>
                <div class="pins-grid">${modAiHtml}</div>
              </div>
            ` : ''}
            ${mAo > 0 ? `
              <div class="io-bank-group">
                <div class="io-bank-title">Canais Analógicos AQ</div>
                <div class="pins-grid">${modAoHtml}</div>
              </div>
            ` : ''}
          </div>

          <div class="hw-unit-foot">
            <span>SLOT ${idx + 1}</span>
            <span>${isAnalog ? 'ANALÓGICO' : 'DIGITAL'}</span>
          </div>
        </div>
      `;
        });

        // 3. Portas excedidas em Modo Fixo (alerta visual no trilho)
        if (mode === 'fixed' && hasLimitations) {
            const overPins = [
                buildOverflowPinsHtml('I', totals.di, usage.diList),
                buildOverflowPinsHtml('Q', totals.do, usage.doList),
                buildOverflowPinsHtml('AI', totals.ai, usage.aiList),
                buildOverflowPinsHtml('AQ', totals.ao, usage.aoList)
            ].filter(Boolean).join('');

            if (overPins) {
                html += `
          <div class="hw-unit hw-exp-unit" style="border-color: var(--accent-rose); background: rgba(244,63,94,0.08);">
            <div class="hw-unit-top">
              <div>
                <div class="hw-unit-name" style="color:#fda4af;">⚠ Portas Excedidas</div>
                <div class="hw-unit-sub">Sem módulo físico</div>
              </div>
            </div>
            <div class="hw-unit-body">
              <div class="pins-grid">${overPins}</div>
            </div>
            <div class="hw-unit-foot" style="color:#fda4af;">
              <span>LIMITE ATINGIDO</span>
            </div>
          </div>
        `;
            }
        }

        // 4. Botão de adicionar módulo direto no trilho quando em modo CLP Pronto
        if (mode === 'fixed') {
            html += `
        <button type="button" class="rack-add-slot" id="btnRailAddModule" title="Adicionar módulo de expansão ao trilho">
          <span style="font-size: 20px; color: var(--accent-sky);">+</span>
          <span style="font-size: 11px; font-weight: 700;">Adicionar<br/>Expansão</span>
        </button>
      `;
        }

        rackContainer.innerHTML = html;
    }

    function renderModulesList() {
        const container = document.getElementById('modulesListContainer');
        const modules = state.hardware.modules || [];

        if (modules.length === 0) {
            container.innerHTML = `
        <div class="info-callout" style="text-align:center;">
          Nenhum módulo de expansão adicionado.<br/>Clique em <strong>+ Adicionar Módulo</strong> para expandir entradas ou saídas.
        </div>
      `;
            return;
        }

        container.innerHTML = modules.map((mod, idx) => {
            const parts = [];
            if (mod.di) parts.push(`${mod.di} DI`);
            if (mod.do) parts.push(`${mod.do} DO`);
            if (mod.ai) parts.push(`${mod.ai} AI`);
            if (mod.ao) parts.push(`${mod.ao} AO`);

            return `
        <div class="mod-item-row">
          <div class="mod-item-info">
            <div class="mod-item-title">
              <span class="slot-tag">SLOT ${idx + 1}</span>
              <span>${escapeHtml(mod.name)}</span>
            </div>
            <div class="mod-item-specs">${parts.join(' • ') || 'Sem canais'}</div>
          </div>
          <div style="display:flex; gap:4px;">
            <button type="button" class="btn btn-sm" data-mod-up="${idx}" ${idx === 0 ? 'disabled style="opacity:0.4"' : ''} title="Mover para esquerda">←</button>
            <button type="button" class="btn btn-sm" data-mod-down="${idx}" ${idx === modules.length - 1 ? 'disabled style="opacity:0.4"' : ''} title="Mover para direita">→</button>
            <button type="button" class="btn btn-sm btn-rose" data-mod-del="${idx}" title="Remover módulo">✕</button>
          </div>
        </div>
      `;
        }).join('');
    }

    function renderCapacityBalance(evalData) {
        const container = document.getElementById('capacityTableContainer');
        const pill = document.getElementById('balanceStatusPill');
        const { usage, totals, mode, hasLimitations } = evalData;

        const rows = [
            { label: 'Entradas Digitais (DI)', used: Math.max(usage.diList.length, usage.maxDiIdx + 1), cap: totals.di },
            { label: 'Saídas Digitais (DO)', used: Math.max(usage.doList.length, usage.maxDoIdx + 1), cap: totals.do },
            { label: 'Entradas Analógicas (AI)', used: Math.max(usage.aiList.length, usage.maxAiIdx + 1), cap: totals.ai },
            { label: 'Saídas Analógicas (AO)', used: Math.max(usage.aoList.length, usage.maxAoIdx + 1), cap: totals.ao }
        ];

        pill.textContent = mode === 'adaptive' ? 'ADAPTATIVO' : (hasLimitations ? 'EXCEDIDO' : 'DENTRO DO LIMITE');
        pill.style.color = mode === 'adaptive' ? '#34d399' : (hasLimitations ? '#fda4af' : '#34d399');

        container.innerHTML = rows.map(r => {
            const exceeded = mode === 'fixed' && r.used > r.cap;
            const pct = r.cap > 0 ? Math.min(100, Math.round((r.used / r.cap) * 100)) : (r.used > 0 ? 100 : 0);

            return `
        <div class="cap-row ${exceeded ? 'cap-exceeded' : ''}">
          <div class="cap-top">
            <span>${r.label}</span>
            <span class="cap-numbers" style="color:${exceeded ? '#fda4af' : '#e2e8f0'};">
              ${r.used} / ${r.cap} ${exceeded ? '⚠' : ''}
            </span>
          </div>
          <div class="cap-bar-bg">
            <div class="cap-bar-fill" style="width:${pct}%;"></div>
          </div>
        </div>
      `;
        }).join('');
    }

    function renderAll() {
        const evalData = app.evaluateHardware();
        const isAdaptive = evalData.mode === 'adaptive';

        // Topbar & Modo
        document.querySelectorAll('[data-hw-mode]').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.hwMode === evalData.mode);
        });

        const badge = document.getElementById('modeHeaderBadge');
        badge.textContent = isAdaptive ? 'MODO LIVRE / ADAPTATIVO' : 'CLP PRONTO (LIMITADO)';
        badge.className = `mode-badge ${isAdaptive ? 'badge-adaptive' : 'badge-fixed'}`;

        // Banner de diagnóstico
        const diagBanner = document.getElementById('hwDiagnosticBanner');
        const diagTitle = document.getElementById('diagTitle');
        const diagDesc = document.getElementById('diagDesc');

        if (isAdaptive) {
            diagBanner.className = 'diag-banner diag-ok';
            diagTitle.textContent = '✓ Modo Modular Adaptativo Ativo (Sem Limitação de Portas)';
            diagDesc.textContent = 'O controlador e os módulos de expansão (digitais e analógicos) se ajustam automaticamente conforme as variáveis utilizadas no programa Ladder.';
        } else if (evalData.hasLimitations) {
            diagBanner.className = 'diag-banner diag-warn';
            diagTitle.textContent = `⚠ Limitação de Hardware Detectada (${evalData.issues.length} alerta${evalData.issues.length > 1 ? 's' : ''})`;
            diagDesc.textContent = evalData.issues.join(' | ');
        } else {
            diagBanner.className = 'diag-banner diag-ok';
            diagTitle.textContent = '✓ Hardware Pronto Compatível com o Programa';
            diagDesc.textContent = 'Todas as entradas e saídas utilizadas no código Ladder cabem nas especificações da CPU e dos módulos configurados.';
        }

        // Alternância dos painéis de configuração
        document.getElementById('cpuModeTag').textContent = isAdaptive ? 'AUTO' : 'MANUAL';
        document.getElementById('adaptiveCpuNotice').style.display = isAdaptive ? 'block' : 'none';
        document.getElementById('fixedCpuForm').style.display = isAdaptive ? 'none' : 'flex';

        document.getElementById('btnOpenAddModule').style.display = isAdaptive ? 'none' : 'inline-flex';
        document.getElementById('adaptiveModulesNotice').style.display = isAdaptive ? 'block' : 'none';
        document.getElementById('fixedModulesArea').style.display = isAdaptive ? 'none' : 'block';

        if (!isAdaptive) {
            const cpu = state.hardware.cpu;
            document.getElementById('cpuModelInput').value = cpu.model || '';
            document.getElementById('cpuPowerInput').value = cpu.power || '24V DC';
            document.getElementById('cpuDiInput').value = cpu.di ?? 8;
            document.getElementById('cpuDoInput').value = cpu.do ?? 6;
            document.getElementById('cpuAiInput').value = cpu.ai ?? 0;
            document.getElementById('cpuAoInput').value = cpu.ao ?? 0;
            document.getElementById('cpuMaxModInput').value = cpu.maxModules ?? 7;
            renderModulesList();
        }

        renderPlcRack(evalData);
        renderCapacityBalance(evalData);
    }

    Object.assign(app, {
        renderAll
    });
})();