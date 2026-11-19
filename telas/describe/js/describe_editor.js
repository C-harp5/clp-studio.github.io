(function () {
    'use strict';

    const app = window.DescribeApp;
    const { CPU_PRESETS, MODULE_PRESETS, state } = app;

    function openAddModuleModal() {
        document.getElementById('modPresetSelect').value = 'di_8';
        applyModulePreset('di_8');
        document.getElementById('addModuleModal').classList.add('open');
    }

    function closeAddModuleModal() {
        document.getElementById('addModuleModal').classList.remove('open');
    }

    function applyModulePreset(key) {
        const preset = MODULE_PRESETS[key];
        if (!preset) return;
        document.getElementById('modNameInput').value = preset.name;
        document.getElementById('modDiInput').value = preset.di;
        document.getElementById('modDoInput').value = preset.do;
        document.getElementById('modAiInput').value = preset.ai;
        document.getElementById('modAoInput').value = preset.ao;
    }

    function commitCpuChanges() {
        state.hardware.cpu = {
            model: document.getElementById('cpuModelInput').value.trim() || 'CLP Pronto',
            power: document.getElementById('cpuPowerInput').value,
            di: Math.max(0, Number(document.getElementById('cpuDiInput').value) || 0),
            do: Math.max(0, Number(document.getElementById('cpuDoInput').value) || 0),
            ai: Math.max(0, Number(document.getElementById('cpuAiInput').value) || 0),
            ao: Math.max(0, Number(document.getElementById('cpuAoInput').value) || 0),
            maxModules: Math.max(0, Number(document.getElementById('cpuMaxModInput').value) || 0)
        };
        app.renderAll();
        app.syncHardwareToMain();
    }

    document.addEventListener('DOMContentLoaded', () => {
        // Alternar modo Adaptativo vs CLP Pronto
        document.querySelectorAll('[data-hw-mode]').forEach(btn => {
            btn.addEventListener('click', () => {
                const newMode = btn.dataset.hwMode;
                if (state.hardware.mode === newMode) return;
                state.hardware.mode = newMode;

                if (newMode === 'fixed' && state.hardware.cpu.model === 'CLP Modular Adaptativo') {
                    state.hardware.cpu.model = 'CLP Pronto 24V DC';
                }
                app.renderAll();
                app.syncHardwareToMain();
            });
        });

        // Presets da CPU no modo CLP Pronto
        document.getElementById('cpuPresetSelect').addEventListener('change', (e) => {
            const preset = CPU_PRESETS[e.target.value];
            if (!preset) return;
            state.hardware.cpu = { ...preset };
            app.renderAll();
            app.syncHardwareToMain();
        });

        // Campos manuais da CPU
        ['cpuModelInput', 'cpuPowerInput', 'cpuDiInput', 'cpuDoInput', 'cpuAiInput', 'cpuAoInput', 'cpuMaxModInput'].forEach(id => {
            document.getElementById(id).addEventListener('input', () => {
                document.getElementById('cpuPresetSelect').value = 'custom';
                commitCpuChanges();
            });
        });

        // Abrir modal de adicionar módulo
        document.getElementById('btnOpenAddModule').addEventListener('click', openAddModuleModal);
        document.getElementById('plcRackContainer').addEventListener('click', (e) => {
            if (e.target.closest('#btnRailAddModule')) {
                openAddModuleModal();
            }
        });

        document.getElementById('btnCloseModModal').addEventListener('click', closeAddModuleModal);
        document.getElementById('btnCancelModModal').addEventListener('click', closeAddModuleModal);

        document.getElementById('modPresetSelect').addEventListener('change', (e) => {
            applyModulePreset(e.target.value);
        });

        document.getElementById('btnConfirmAddModule').addEventListener('click', () => {
            const mod = {
                id: 'mod_' + Math.random().toString(36).slice(2, 8),
                name: document.getElementById('modNameInput').value.trim() || 'Módulo Expansão',
                di: Math.max(0, Number(document.getElementById('modDiInput').value) || 0),
                do: Math.max(0, Number(document.getElementById('modDoInput').value) || 0),
                ai: Math.max(0, Number(document.getElementById('modAiInput').value) || 0),
                ao: Math.max(0, Number(document.getElementById('modAoInput').value) || 0)
            };
            state.hardware.modules.push(mod);
            closeAddModuleModal();
            app.renderAll();
            app.syncHardwareToMain();
        });

        // Gerenciar ordem/exclusão de módulos
        document.getElementById('modulesListContainer').addEventListener('click', (e) => {
            const upBtn = e.target.closest('[data-mod-up]');
            if (upBtn) {
                const idx = Number(upBtn.dataset.modUp);
                if (idx > 0) {
                    const mods = state.hardware.modules;
                    [mods[idx - 1], mods[idx]] = [mods[idx], mods[idx - 1]];
                    app.renderAll();
                    app.syncHardwareToMain();
                }
                return;
            }

            const downBtn = e.target.closest('[data-mod-down]');
            if (downBtn) {
                const idx = Number(downBtn.dataset.modDown);
                const mods = state.hardware.modules;
                if (idx < mods.length - 1) {
                    [mods[idx], mods[idx + 1]] = [mods[idx + 1], mods[idx]];
                    app.renderAll();
                    app.syncHardwareToMain();
                }
                return;
            }

            const delBtn = e.target.closest('[data-mod-del]');
            if (delBtn) {
                const idx = Number(delBtn.dataset.modDel);
                state.hardware.modules.splice(idx, 1);
                app.renderAll();
                app.syncHardwareToMain();
            }
        });

        // Sincronização recebida do main.html
        window.addEventListener('message', (e) => {
            const msg = e.data;
            if (!msg || typeof msg !== 'object') return;

            if (msg.type === 'PROGRAM_STATE_SYNC') {
                state.program = { ...state.program, ...msg.payload };
                app.renderAll();
            } else if (msg.type === 'LOAD_HARDWARE_DATA' || msg.type === 'HARDWARE_STATE_SYNC') {
                if (msg.payload) {
                    state.hardware = {
                        mode: msg.payload.mode || 'adaptive',
                        cpu: { ...state.hardware.cpu, ...(msg.payload.cpu || {}) },
                        modules: Array.isArray(msg.payload.modules) ? msg.payload.modules : []
                    };
                    app.renderAll();
                }
            } else if (msg.type === 'CMD_NEW_PROJECT') {
                state.hardware = {
                    mode: 'adaptive',
                    cpu: { model: 'CLP Modular Adaptativo', power: '24V DC', di: 8, do: 6, ai: 0, ao: 0, maxModules: 7 },
                    modules: []
                };
                app.renderAll();
                app.syncHardwareToMain();
            }
        });

        app.renderAll();
        if (window.parent && window.parent !== window) {
            window.parent.postMessage({ type: 'REQUEST_INITIAL_SYNC' }, '*');
        }
    });
})();