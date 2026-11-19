(function () {
    'use strict';

    const app = window.DescribeApp = window.DescribeApp || {};

    const CPU_PRESETS = {
        compact_14: { model: 'CLP Compacto 14 I/O', power: '24V DC', di: 8, do: 6, ai: 0, ao: 0, maxModules: 4 },
        mid_20_ai: { model: 'CLP Intermediário 20 I/O + AI', power: '24V DC', di: 12, do: 8, ai: 2, ao: 0, maxModules: 7 },
        adv_40_aio: { model: 'CLP Avançado 40 I/O + AI/AO', power: '110/220V AC', di: 24, do: 16, ai: 2, ao: 2, maxModules: 7 }
    };

    const MODULE_PRESETS = {
        di_8: { name: 'Expansão 8 DI', di: 8, do: 0, ai: 0, ao: 0 },
        do_8: { name: 'Expansão 8 DO', di: 0, do: 8, ai: 0, ao: 0 },
        dio_8: { name: 'Expansão Mista 4 DI / 4 DO', di: 4, do: 4, ai: 0, ao: 0 },
        ai_2: { name: 'Expansão Analógica 2 AI', di: 0, do: 0, ai: 2, ao: 0 },
        ao_2: { name: 'Expansão Analógica 2 AO', di: 0, do: 0, ai: 0, ao: 2 },
        aio_3: { name: 'Expansão Analógica 2 AI / 1 AO', di: 0, do: 0, ai: 2, ao: 1 }
    };

    const state = {
        hardware: {
            mode: 'adaptive', // 'adaptive' | 'fixed'
            cpu: {
                model: 'CLP Modular Adaptativo',
                power: '24V DC',
                di: 8,
                do: 6,
                ai: 0,
                ao: 0,
                maxModules: 7
            },
            modules: []
        },
        program: {
            mapped: {
                inputs: [],
                outputs: [],
                vars: [],
                digitalInputs: [],
                digitalOutputs: [],
                analogInputs: [],
                analogOutputs: []
            },
            bits: {},
            tags: {}
        }
    };

    function escapeHtml(str) {
        return String(str ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    function extractChannelIndex(addr) {
        const clean = String(addr || '').replace(/^%/, '').toUpperCase();
        const dotMatch = clean.match(/\.(\d+)$/);
        if (dotMatch) return Number(dotMatch[1]);
        const numMatch = clean.match(/(\d+)$/);
        return numMatch ? Number(numMatch[1]) : 0;
    }

    function classifyProgramUsage() {
        const m = state.program.mapped || {};
        const diList = Array.isArray(m.digitalInputs) ? m.digitalInputs : (m.inputs || []).filter(a => !/^(%?(AI|IW))/i.test(a));
        const doList = Array.isArray(m.digitalOutputs) ? m.digitalOutputs : (m.outputs || []).filter(a => !/^(%?(AQ|QW))/i.test(a));
        const aiList = Array.isArray(m.analogInputs) ? m.analogInputs : (m.inputs || []).filter(a => /^(%?(AI|IW))/i.test(a));
        const aoList = Array.isArray(m.analogOutputs) ? m.analogOutputs : (m.outputs || []).filter(a => /^(%?(AQ|QW))/i.test(a));

        const maxDiIdx = diList.length ? Math.max(...diList.map(extractChannelIndex)) : -1;
        const maxDoIdx = doList.length ? Math.max(...doList.map(extractChannelIndex)) : -1;
        const maxAiIdx = aiList.length ? Math.max(...aiList.map(extractChannelIndex)) : -1;
        const maxAoIdx = aoList.length ? Math.max(...aoList.map(extractChannelIndex)) : -1;

        return {
            diList,
            doList,
            aiList,
            aoList,
            maxDiIdx,
            maxDoIdx,
            maxAiIdx,
            maxAoIdx
        };
    }

    function buildAdaptiveRack(usage) {
        const baseDi = Math.max(8, Math.ceil((usage.maxDiIdx + 1) / 4) * 4);
        const baseDo = Math.max(6, Math.ceil((usage.maxDoIdx + 1) / 2) * 2);

        const cpuDi = Math.min(12, baseDi);
        const cpuDo = Math.min(8, baseDo);
        const modules = [];

        // Expansão digital automática se o programa usar além da CPU base
        if (baseDi > cpuDi) {
            const extraDi = Math.ceil((baseDi - cpuDi) / 8) * 8;
            modules.push({
                id: 'auto_di',
                name: `Exp. Digital +${extraDi} DI`,
                category: 'DIGITAL',
                di: extraDi,
                do: 0,
                ai: 0,
                ao: 0,
                auto: true
            });
        }

        if (baseDo > cpuDo) {
            const extraDo = Math.ceil((baseDo - cpuDo) / 8) * 8;
            modules.push({
                id: 'auto_do',
                name: `Exp. Digital +${extraDo} DO`,
                category: 'DIGITAL',
                di: 0,
                do: extraDo,
                ai: 0,
                ao: 0,
                auto: true
            });
        }

        // Expansão analógica automática quando variáveis AI ou AQ são detectadas no programa
        if (usage.aiList.length > 0) {
            const neededAi = Math.max(2, Math.ceil((usage.maxAiIdx + 1) / 2) * 2);
            modules.push({
                id: 'auto_ai',
                name: `Exp. Analógica ${neededAi} AI`,
                category: 'ANALOG',
                di: 0,
                do: 0,
                ai: neededAi,
                ao: 0,
                auto: true
            });
        }

        if (usage.aoList.length > 0) {
            const neededAo = Math.max(2, Math.ceil((usage.maxAoIdx + 1) / 2) * 2);
            modules.push({
                id: 'auto_ao',
                name: `Exp. Analógica ${neededAo} AO`,
                category: 'ANALOG',
                di: 0,
                do: 0,
                ai: 0,
                ao: neededAo,
                auto: true
            });
        }

        return {
            cpu: {
                model: 'CLP Modular Adaptativo',
                power: '24V DC',
                di: cpuDi,
                do: cpuDo,
                ai: 0,
                ao: 0
            },
            modules
        };
    }

    function evaluateHardware() {
        const usage = classifyProgramUsage();

        if (state.hardware.mode === 'adaptive') {
            const adaptive = buildAdaptiveRack(usage);
            const totalDi = adaptive.cpu.di + adaptive.modules.reduce((s, m) => s + m.di, 0);
            const totalDo = adaptive.cpu.do + adaptive.modules.reduce((s, m) => s + m.do, 0);
            const totalAi = adaptive.modules.reduce((s, m) => s + m.ai, 0);
            const totalAo = adaptive.modules.reduce((s, m) => s + m.ao, 0);

            return {
                mode: 'adaptive',
                usage,
                rack: adaptive,
                totals: { di: totalDi, do: totalDo, ai: totalAi, ao: totalAo },
                issues: [],
                hasLimitations: false
            };
        }

        // Modo CLP Pronto (Especificação Fixa)
        const cpu = state.hardware.cpu;
        const modules = state.hardware.modules || [];

        const totalDi = Number(cpu.di || 0) + modules.reduce((s, m) => s + Number(m.di || 0), 0);
        const totalDo = Number(cpu.do || 0) + modules.reduce((s, m) => s + Number(m.do || 0), 0);
        const totalAi = Number(cpu.ai || 0) + modules.reduce((s, m) => s + Number(m.ai || 0), 0);
        const totalAo = Number(cpu.ao || 0) + modules.reduce((s, m) => s + Number(m.ao || 0), 0);

        const issues = [];
        const reqDi = Math.max(usage.diList.length, usage.maxDiIdx + 1);
        const reqDo = Math.max(usage.doList.length, usage.maxDoIdx + 1);
        const reqAi = Math.max(usage.aiList.length, usage.maxAiIdx + 1);
        const reqAo = Math.max(usage.aoList.length, usage.maxAoIdx + 1);

        if (reqDi > totalDi) {
            issues.push(`Entradas Digitais (DI): programa exige até I${reqDi - 1} (${reqDi} canais), mas o hardware possui ${totalDi} DI.`);
        }
        if (reqDo > totalDo) {
            issues.push(`Saídas Digitais (DO): programa exige até Q${reqDo - 1} (${reqDo} canais), mas o hardware possui ${totalDo} DO.`);
        }
        if (reqAi > totalAi) {
            issues.push(`Entradas Analógicas (AI): programa exige até AI${reqAi - 1} (${reqAi} canais), mas o hardware possui ${totalAi} AI.`);
        }
        if (reqAo > totalAo) {
            issues.push(`Saídas Analógicas (AO): programa exige até AQ${reqAo - 1} (${reqAo} canais), mas o hardware possui ${totalAo} AO.`);
        }
        if (modules.length > Number(cpu.maxModules || 0)) {
            issues.push(`Módulos de Expansão: ${modules.length} instalados, limite da CPU é ${cpu.maxModules}.`);
        }

        return {
            mode: 'fixed',
            usage,
            rack: { cpu, modules },
            totals: { di: totalDi, do: totalDo, ai: totalAi, ao: totalAo },
            issues,
            hasLimitations: issues.length > 0
        };
    }

    function syncHardwareToMain() {
        if (!window.parent || window.parent === window) return;
        window.parent.postMessage({
            type: 'HARDWARE_STATE_SYNC',
            payload: JSON.parse(JSON.stringify(state.hardware))
        }, '*');
    }

    Object.assign(app, {
        CPU_PRESETS,
        MODULE_PRESETS,
        state,
        escapeHtml,
        extractChannelIndex,
        evaluateHardware,
        syncHardwareToMain
    });
})();