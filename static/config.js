const DEFAULT_SYSTEM_PROMPT = '你是地图数字人讲解员，专注介绍地点、地标、路线、周边设施和到达方式。请优先用中文回答，语气自然、清晰、简洁；如果上下文提供了地图信息，请优先围绕当前地点讲解。';
const DEFAULT_MEMORY = '你是地图讲解型数字人。回答时优先说明地点位置、周边地标、交通方式、适合人群与游览建议，并保持解释简洁自然。';
const DEFAULT_RERANK_CANDIDATE_POOL = 8;
const DEFAULT_RERANK_SIMILARITY_THRESHOLD = 0.3;
const DEFAULT_RERANK_TOP_K = 3;
const DEFAULT_RERANK_INSTRUCTION = 'Given a web search query, retrieve relevant passages that answer the query';
const PROMPT_STORAGE_KEYS = {
    systemPrompt: 'qdh.systemPrompt',
    memory: 'qdh.memory',
    context: 'qdh.context',
    useRagContext: 'qdh.useRagContext',
    ttsMode: 'qdh.ttsMode',
    browserAsrMode: 'qdh.browserAsrMode',
    browserTtsMode: 'qdh.browserTtsMode',
    collapseThink: 'qdh.collapseThink',
    rerankCandidatePool: 'qdh.rerankCandidatePool',
    rerankSimilarityThreshold: 'qdh.rerankSimilarityThreshold',
    rerankTopK: 'qdh.rerankTopK',
    rerankInstruction: 'qdh.rerankInstruction',
};
const OPENCV_STORAGE_KEYS = {
    enabled: 'qdh.opencv.enabled',
    autoStart: 'qdh.opencv.autoStart',
    mirror: 'qdh.opencv.mirror',
    smooth: 'qdh.opencv.smooth',
    yawGain: 'qdh.opencv.yawGain',
    pitchGain: 'qdh.opencv.pitchGain',
    blend: 'qdh.opencv.blend',
    calibration: 'qdh.opencv.calibration',
};
const LEGACY_OPENCV_STORAGE_KEYS = {
    enabled: 'qdh.faceTracking.enabled',
    autoStart: 'qdh.faceTracking.autoStart',
    mirror: 'qdh.faceTracking.mirror',
    smooth: 'qdh.faceTracking.smooth',
    yawGain: 'qdh.faceTracking.yawGain',
    pitchGain: 'qdh.faceTracking.pitchGain',
    blend: 'qdh.faceTracking.blend',
    calibration: 'qdh.faceTracking.calibration',
};
const OPENCV_CONTROL_CHANNEL_NAME = 'qdh-opencv-control';

const legacySystemPrompt = '你是 Qwen Digital Human，一个简洁、友好、会结合上下文回答的数字人助手。请优先用中文回答，除非用户明确要求其他语言。';
const DEFAULT_MAP_PLACE = {
    display_name: '北京天安门广场（默认讲解中心）',
    lat: 39.9087,
    lon: 116.3975,
    bounds: { south: 39.8937, north: 39.9237, west: 116.3775, east: 116.4175 },
    category: 'tourist_attraction',
    kind: 'default',
    importance: 1.0,
    map_url: 'https://www.openstreetmap.org/export/embed.html?bbox=116.3775%2C39.8937%2C116.4175%2C39.9237&layer=mapnik&marker=39.9087%2C116.3975',
    summary: '北京天安门广场（默认讲解中心）\n坐标：39.908700, 116.397500\n类型：default',
};
const MAP_CONTEXT_MARKER = '【地图讲解上下文】';

function normalizeStoredPrompt(value) {
    return value === legacySystemPrompt ? DEFAULT_SYSTEM_PROMPT : value;
}

function loadPromptSetting(key, fallback = '') {
    return localStorage.getItem(key) ?? fallback;
}

function savePromptSetting(key, value) {
    localStorage.setItem(key, value);
}

function loadBooleanSetting(key, fallback = true) {
    const value = localStorage.getItem(key);
    if (value === null) return fallback;
    return value !== 'false';
}

function loadNumberSetting(key, fallback) {
    const raw = localStorage.getItem(key);
    if (raw === null || raw.trim() === '') return fallback;
    const value = Number(raw);
    return Number.isFinite(value) ? value : fallback;
}

function loadIntegerSetting(key, fallback) {
    const raw = localStorage.getItem(key);
    if (raw === null || raw.trim() === '') return fallback;
    const value = Number.parseInt(raw, 10);
    return Number.isFinite(value) ? value : fallback;
}

function loadOpenCvBooleanSetting(key, legacyKey, fallback) {
    const value = localStorage.getItem(key) ?? localStorage.getItem(legacyKey);
    if (value === null) return fallback;
    return value !== 'false';
}

function loadOpenCvNumberSetting(key, legacyKey, fallback, min, max) {
    const raw = localStorage.getItem(key) ?? localStorage.getItem(legacyKey);
    if (raw === null || raw.trim() === '') return fallback;
    const value = Number(raw);
    if (!Number.isFinite(value)) return fallback;
    return Math.min(max, Math.max(min, value));
}

document.addEventListener('DOMContentLoaded', () => {
    const systemPromptInput = document.getElementById('system-prompt');
    const memoryInput = document.getElementById('memory-input');
    const contextInput = document.getElementById('context-input');
    const useRagContextCheckbox = document.getElementById('use-rag-context');
    const ttsModeCheckbox = document.getElementById('tts-mode');
    const browserAsrModeCheckbox = document.getElementById('browser-asr-mode');
    const browserTtsModeCheckbox = document.getElementById('browser-tts-mode');
    const collapseThinkCheckbox = document.getElementById('collapse-think');
    const rerankCandidatePoolInput = document.getElementById('rerank-candidate-pool');
    const rerankThresholdInput = document.getElementById('rerank-threshold');
    const rerankTopKInput = document.getElementById('rerank-topk');
    const rerankInstructionInput = document.getElementById('rerank-instruction');
    const refreshContextBtn = document.getElementById('refresh-context-btn');
    const clearContextBtn = document.getElementById('clear-context-btn');
    const mapStatus = document.getElementById('map-status');
    const mapSummary = document.getElementById('map-summary');
    const mapResults = document.getElementById('map-results');
    const mapFrame = document.getElementById('map-frame');
    const mapSearchInput = document.getElementById('map-search-input');
    const mapSearchBtn = document.getElementById('map-search-btn');
    const applyMapContextBtn = document.getElementById('apply-map-context-btn');
    const clearMapBtn = document.getElementById('clear-map-btn');
    const opencvEnabledCheckbox = document.getElementById('opencv-enabled');
    const opencvAutoStartCheckbox = document.getElementById('opencv-auto-start');
    const opencvMirrorCheckbox = document.getElementById('opencv-mirror');
    const opencvSmoothInput = document.getElementById('opencv-smooth');
    const opencvYawGainInput = document.getElementById('opencv-yaw-gain');
    const opencvPitchGainInput = document.getElementById('opencv-pitch-gain');
    const opencvBlendInput = document.getElementById('opencv-blend');
    const opencvStartBtn = document.getElementById('opencv-start-btn');
    const opencvStopBtn = document.getElementById('opencv-stop-btn');
    const opencvCalibrateBtn = document.getElementById('opencv-calibrate-btn');
    const opencvResetBtn = document.getElementById('opencv-reset-btn');
    const opencvStatus = document.getElementById('opencv-status');

    const clampNumber = (value, min, max, fallback) => {
        const num = Number(value);
        if (!Number.isFinite(num)) return fallback;
        return Math.min(max, Math.max(min, num));
    };

    const getRerankSettings = () => ({
        candidate_pool: Math.max(1, Math.round(clampNumber(
            rerankCandidatePoolInput?.value ?? loadIntegerSetting(PROMPT_STORAGE_KEYS.rerankCandidatePool, DEFAULT_RERANK_CANDIDATE_POOL),
            1,
            64,
            DEFAULT_RERANK_CANDIDATE_POOL,
        ))),
        similarity_threshold: clampNumber(
            rerankThresholdInput?.value ?? loadNumberSetting(PROMPT_STORAGE_KEYS.rerankSimilarityThreshold, DEFAULT_RERANK_SIMILARITY_THRESHOLD),
            0,
            1,
            DEFAULT_RERANK_SIMILARITY_THRESHOLD,
        ),
        top_k: Math.max(0, Math.round(clampNumber(
            rerankTopKInput?.value ?? loadIntegerSetting(PROMPT_STORAGE_KEYS.rerankTopK, DEFAULT_RERANK_TOP_K),
            0,
            32,
            DEFAULT_RERANK_TOP_K,
        ))),
        instruction: normalizeStoredPrompt(
            rerankInstructionInput?.value ?? loadPromptSetting(PROMPT_STORAGE_KEYS.rerankInstruction, DEFAULT_RERANK_INSTRUCTION)
        ).trim() || DEFAULT_RERANK_INSTRUCTION,
    });

    const persistPromptSettings = () => {
        if (systemPromptInput) savePromptSetting(PROMPT_STORAGE_KEYS.systemPrompt, systemPromptInput.value);
        if (memoryInput) savePromptSetting(PROMPT_STORAGE_KEYS.memory, memoryInput.value);
        if (contextInput) savePromptSetting(PROMPT_STORAGE_KEYS.context, contextInput.value);
        if (useRagContextCheckbox) savePromptSetting(PROMPT_STORAGE_KEYS.useRagContext, String(useRagContextCheckbox.checked));
        if (ttsModeCheckbox) savePromptSetting(PROMPT_STORAGE_KEYS.ttsMode, String(ttsModeCheckbox.checked));
        if (browserAsrModeCheckbox) savePromptSetting(PROMPT_STORAGE_KEYS.browserAsrMode, String(browserAsrModeCheckbox.checked));
        if (browserTtsModeCheckbox) savePromptSetting(PROMPT_STORAGE_KEYS.browserTtsMode, String(browserTtsModeCheckbox.checked));
        if (collapseThinkCheckbox) savePromptSetting(PROMPT_STORAGE_KEYS.collapseThink, String(collapseThinkCheckbox.checked));
        if (rerankCandidatePoolInput) savePromptSetting(PROMPT_STORAGE_KEYS.rerankCandidatePool, rerankCandidatePoolInput.value);
        if (rerankThresholdInput) savePromptSetting(PROMPT_STORAGE_KEYS.rerankSimilarityThreshold, rerankThresholdInput.value);
        if (rerankTopKInput) savePromptSetting(PROMPT_STORAGE_KEYS.rerankTopK, rerankTopKInput.value);
        if (rerankInstructionInput) savePromptSetting(PROMPT_STORAGE_KEYS.rerankInstruction, rerankInstructionInput.value);
    };

    if (systemPromptInput) {
        const stored = loadPromptSetting(PROMPT_STORAGE_KEYS.systemPrompt, DEFAULT_SYSTEM_PROMPT);
        systemPromptInput.value = stored === legacySystemPrompt ? DEFAULT_SYSTEM_PROMPT : stored;
    }
    if (memoryInput) {
        const stored = loadPromptSetting(PROMPT_STORAGE_KEYS.memory, DEFAULT_MEMORY);
        memoryInput.value = stored.trim() ? stored : DEFAULT_MEMORY;
    }
    if (contextInput) contextInput.value = loadPromptSetting(PROMPT_STORAGE_KEYS.context, '');
    if (useRagContextCheckbox) useRagContextCheckbox.checked = loadBooleanSetting(PROMPT_STORAGE_KEYS.useRagContext, true);
    if (ttsModeCheckbox) ttsModeCheckbox.checked = loadBooleanSetting(PROMPT_STORAGE_KEYS.ttsMode, true);
    if (browserAsrModeCheckbox) browserAsrModeCheckbox.checked = loadBooleanSetting(PROMPT_STORAGE_KEYS.browserAsrMode, false);
    if (browserTtsModeCheckbox) browserTtsModeCheckbox.checked = loadBooleanSetting(PROMPT_STORAGE_KEYS.browserTtsMode, false);
    if (collapseThinkCheckbox) collapseThinkCheckbox.checked = loadBooleanSetting(PROMPT_STORAGE_KEYS.collapseThink, true);
    if (rerankCandidatePoolInput) rerankCandidatePoolInput.value = String(loadIntegerSetting(PROMPT_STORAGE_KEYS.rerankCandidatePool, DEFAULT_RERANK_CANDIDATE_POOL));
    if (rerankThresholdInput) rerankThresholdInput.value = String(loadNumberSetting(PROMPT_STORAGE_KEYS.rerankSimilarityThreshold, DEFAULT_RERANK_SIMILARITY_THRESHOLD));
    if (rerankTopKInput) rerankTopKInput.value = String(loadIntegerSetting(PROMPT_STORAGE_KEYS.rerankTopK, DEFAULT_RERANK_TOP_K));
    if (rerankInstructionInput) {
        const stored = loadPromptSetting(PROMPT_STORAGE_KEYS.rerankInstruction, DEFAULT_RERANK_INSTRUCTION);
        rerankInstructionInput.value = stored.trim() ? stored : DEFAULT_RERANK_INSTRUCTION;
    }
    persistPromptSettings();

    let opencvControlChannel = null;
    const postOpenCvMessage = (message) => {
        if (opencvControlChannel) {
            opencvControlChannel.postMessage(message);
        }
    };

    const setOpenCvStatus = (message) => {
        if (opencvStatus) {
            opencvStatus.textContent = message;
        }
    };

    const persistOpenCvSettings = () => {
        if (opencvEnabledCheckbox) localStorage.setItem(OPENCV_STORAGE_KEYS.enabled, String(opencvEnabledCheckbox.checked));
        if (opencvAutoStartCheckbox) localStorage.setItem(OPENCV_STORAGE_KEYS.autoStart, String(opencvAutoStartCheckbox.checked));
        if (opencvMirrorCheckbox) localStorage.setItem(OPENCV_STORAGE_KEYS.mirror, String(opencvMirrorCheckbox.checked));
        if (opencvSmoothInput) localStorage.setItem(OPENCV_STORAGE_KEYS.smooth, opencvSmoothInput.value);
        if (opencvYawGainInput) localStorage.setItem(OPENCV_STORAGE_KEYS.yawGain, opencvYawGainInput.value);
        if (opencvPitchGainInput) localStorage.setItem(OPENCV_STORAGE_KEYS.pitchGain, opencvPitchGainInput.value);
        if (opencvBlendInput) localStorage.setItem(OPENCV_STORAGE_KEYS.blend, opencvBlendInput.value);
    };

    const syncOpenCvSettings = () => {
        if (opencvEnabledCheckbox) {
            opencvEnabledCheckbox.checked = loadOpenCvBooleanSetting(OPENCV_STORAGE_KEYS.enabled, LEGACY_OPENCV_STORAGE_KEYS.enabled, false);
        }
        if (opencvAutoStartCheckbox) {
            opencvAutoStartCheckbox.checked = loadOpenCvBooleanSetting(OPENCV_STORAGE_KEYS.autoStart, LEGACY_OPENCV_STORAGE_KEYS.autoStart, true);
        }
        if (opencvMirrorCheckbox) {
            opencvMirrorCheckbox.checked = loadOpenCvBooleanSetting(OPENCV_STORAGE_KEYS.mirror, LEGACY_OPENCV_STORAGE_KEYS.mirror, true);
        }
        if (opencvSmoothInput) {
            opencvSmoothInput.value = String(loadOpenCvNumberSetting(OPENCV_STORAGE_KEYS.smooth, LEGACY_OPENCV_STORAGE_KEYS.smooth, 0.72, 0.05, 0.98));
        }
        if (opencvYawGainInput) {
            opencvYawGainInput.value = String(loadOpenCvNumberSetting(OPENCV_STORAGE_KEYS.yawGain, LEGACY_OPENCV_STORAGE_KEYS.yawGain, 1.8, 0.1, 4.0));
        }
        if (opencvPitchGainInput) {
            opencvPitchGainInput.value = String(loadOpenCvNumberSetting(OPENCV_STORAGE_KEYS.pitchGain, LEGACY_OPENCV_STORAGE_KEYS.pitchGain, 1.6, 0.1, 4.0));
        }
        if (opencvBlendInput) {
            opencvBlendInput.value = String(loadOpenCvNumberSetting(OPENCV_STORAGE_KEYS.blend, LEGACY_OPENCV_STORAGE_KEYS.blend, 0.85, 0, 1));
        }
        persistOpenCvSettings();
    };

    const sendOpenCvApply = ({ start = false, stop = false, calibrate = false, reset = false } = {}) => {
        postOpenCvMessage({
            type: 'apply-settings',
            enabled: opencvEnabledCheckbox?.checked,
            autoStart: opencvAutoStartCheckbox?.checked,
            mirror: opencvMirrorCheckbox?.checked,
        });
        if (start) postOpenCvMessage({ type: 'start-camera' });
        if (stop) postOpenCvMessage({ type: 'stop-camera' });
        if (calibrate) postOpenCvMessage({ type: 'calibrate' });
        if (reset) postOpenCvMessage({ type: 'reset-calibration' });
    };

    try {
        if (typeof BroadcastChannel !== 'undefined') {
            opencvControlChannel = new BroadcastChannel(OPENCV_CONTROL_CHANNEL_NAME);
            opencvControlChannel.addEventListener('message', (event) => {
                const data = event.data || {};
                if (data?.type === 'status') {
                    setOpenCvStatus(data.message || 'OpenCV 状态已更新。');
                }
            });
        }
    } catch (err) {
        console.warn('Failed to initialize OpenCV control channel:', err);
    }

    syncOpenCvSettings();
    setOpenCvStatus(
        opencvEnabledCheckbox?.checked
            ? (opencvAutoStartCheckbox?.checked
                ? 'OpenCV 眼部追踪已启用，主界面会自动使用摄像头追踪人眼。'
                : 'OpenCV 眼部追踪已启用，等待手动启动摄像头。')
            : 'OpenCV 眼部追踪未启用。'
    );

    let selectedMapPlace = DEFAULT_MAP_PLACE;
    let currentMapResults = [DEFAULT_MAP_PLACE];

    const mapContextText = (place) => [
        MAP_CONTEXT_MARKER,
        `地点：${place.display_name}`,
        `坐标：${Number(place.lat).toFixed(6)}, ${Number(place.lon).toFixed(6)}`,
        `类型：${place.kind || 'unknown'}`,
        `分类：${place.category || 'unknown'}`,
        '讲解要求：请以地图数字人讲解员的口吻，优先说明该地点的地理位置、周边地标、交通到达方式、适合人群与游览建议；语言简洁、自然、专业。',
        '如果用户继续追问，请围绕当前地点继续讲解，不要偏离地图主题。',
    ].join('\n');

    const mapFrameUrl = (place) => {
        if (place?.map_url) return place.map_url;
        const lat = Number(place?.lat ?? DEFAULT_MAP_PLACE.lat);
        const lon = Number(place?.lon ?? DEFAULT_MAP_PLACE.lon);
        const bounds = place?.bounds || {};
        const south = Number(bounds.south ?? lat - 0.01);
        const north = Number(bounds.north ?? lat + 0.01);
        const west = Number(bounds.west ?? lon - 0.01);
        const east = Number(bounds.east ?? lon + 0.01);
        return `https://www.openstreetmap.org/export/embed.html?bbox=${west}%2C${south}%2C${east}%2C${north}&layer=mapnik&marker=${lat}%2C${lon}`;
    };

    const setMapStatus = (message) => {
        if (mapStatus) mapStatus.textContent = message;
    };

    const renderMapSummary = (place) => {
        if (mapSummary) {
            mapSummary.textContent = place?.summary || mapContextText(place);
        }
    };

    const renderMapResults = (results) => {
        if (!mapResults) return;
        mapResults.innerHTML = '';
        if (!results || !results.length) {
            const empty = document.createElement('div');
            empty.className = 'map-result';
            empty.style.cursor = 'default';
            empty.textContent = '暂无结果，请输入地点后搜索。';
            mapResults.appendChild(empty);
            return;
        }

        results.forEach((place, index) => {
            const card = document.createElement('div');
            card.className = `map-result${selectedMapPlace?.display_name === place.display_name && selectedMapPlace?.lat === place.lat && selectedMapPlace?.lon === place.lon ? ' selected' : ''}`;
            const title = document.createElement('div');
            const strong = document.createElement('strong');
            strong.textContent = place.display_name;
            title.appendChild(strong);
            const small = document.createElement('small');
            small.textContent = place.summary || `坐标：${Number(place.lat).toFixed(4)}, ${Number(place.lon).toFixed(4)}`;
            card.appendChild(title);
            card.appendChild(small);
            card.addEventListener('click', () => selectMapPlace(place, { announce: true }));
            mapResults.appendChild(card);

            if (index === 0 && results.length === 1) {
                card.classList.add('selected');
            }
        });
    };

    function selectMapPlace(place, { announce = false } = {}) {
        selectedMapPlace = place;
        if (mapFrame) {
            mapFrame.src = mapFrameUrl(place);
        }
        renderMapSummary(place);
        renderMapResults(currentMapResults);
        if (announce) setMapStatus(`已选中：${place.display_name}`);
    }

    function resetMapPanel() {
        selectedMapPlace = DEFAULT_MAP_PLACE;
        currentMapResults = [DEFAULT_MAP_PLACE];
        if (mapSearchInput) mapSearchInput.value = '';
        if (mapFrame) mapFrame.src = mapFrameUrl(DEFAULT_MAP_PLACE);
        renderMapSummary(DEFAULT_MAP_PLACE);
        renderMapResults(currentMapResults);
        setMapStatus('默认定位：北京天安门广场。可搜索地点并写入上下文。');
    }

    function writeMapContext(place) {
        if (!contextInput) return;
        const existing = contextInput.value.trim();
        const cleaned = existing.replace(/(?:^|\n\n)【地图讲解上下文】[\s\S]*?(?=\n\n|$)/g, '').trim();
        const block = mapContextText(place);
        contextInput.value = cleaned ? `${block}\n\n${cleaned}` : block;
        savePromptSetting(PROMPT_STORAGE_KEYS.context, contextInput.value);
        setMapStatus(`已写入上下文：${place.display_name}`);
    }

    async function searchMapPlaces() {
        const query = mapSearchInput?.value.trim() || '';
        if (!query) {
            setMapStatus('请输入地点名称后再搜索。');
            return;
        }

        setMapStatus(`正在搜索：${query} ...`);
        try {
            const res = await fetch('/api/map/search', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ query, limit: 5 }),
            });
            const data = await res.json();
            if (!res.ok) {
                throw new Error(data.error || `HTTP ${res.status}`);
            }

            currentMapResults = Array.isArray(data.results) && data.results.length ? data.results : [DEFAULT_MAP_PLACE];
            selectedMapPlace = currentMapResults[0];
            selectMapPlace(selectedMapPlace, { announce: false });
            setMapStatus(`搜索完成：${query}（${currentMapResults.length} 个结果）`);
        } catch (err) {
            console.error(err);
            setMapStatus(`地图搜索失败：${err.message || err}`);
        }
    }

    const refreshContextFromRag = async () => {
        const query = mapSearchInput?.value.trim() || selectedMapPlace?.display_name || systemPromptInput?.value.trim() || '地图讲解';
        if (!query) {
            setMapStatus('请先输入一段问题再刷新上下文');
            return;
        }

        try {
            const res = await fetch('/api/context/retrieve', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ query, rerank: getRerankSettings() }),
            });
            const data = await res.json();
            if (contextInput) {
                contextInput.value = data.context || '';
                savePromptSetting(PROMPT_STORAGE_KEYS.context, contextInput.value);
            }
            setMapStatus(data.context ? '上下文已刷新' : '上下文为空');
        } catch (err) {
            setMapStatus(`刷新上下文失败：${err.message || err}`);
        }
    };

    const clearContextDraft = () => {
        if (contextInput) contextInput.value = '';
        if (useRagContextCheckbox) useRagContextCheckbox.checked = false;
        savePromptSetting(PROMPT_STORAGE_KEYS.context, '');
        savePromptSetting(PROMPT_STORAGE_KEYS.useRagContext, 'false');
        setMapStatus('上下文已清空');
    };

    const clearMapContext = () => {
        if (contextInput) {
            const cleaned = contextInput.value
                .replace(/(?:^|\n\n)【地图讲解上下文】[\s\S]*?(?=\n\n|$)/g, '')
                .trim();
            contextInput.value = cleaned;
            savePromptSetting(PROMPT_STORAGE_KEYS.context, contextInput.value);
        }
        resetMapPanel();
        setMapStatus('地图已清空，恢复默认定位。');
    };

    if (systemPromptInput) systemPromptInput.addEventListener('input', persistPromptSettings);
    if (memoryInput) memoryInput.addEventListener('input', persistPromptSettings);
    if (contextInput) contextInput.addEventListener('input', persistPromptSettings);
    if (useRagContextCheckbox) useRagContextCheckbox.addEventListener('change', persistPromptSettings);
    if (ttsModeCheckbox) ttsModeCheckbox.addEventListener('change', persistPromptSettings);
    if (browserAsrModeCheckbox) browserAsrModeCheckbox.addEventListener('change', persistPromptSettings);
    if (browserTtsModeCheckbox) browserTtsModeCheckbox.addEventListener('change', persistPromptSettings);
    if (collapseThinkCheckbox) collapseThinkCheckbox.addEventListener('change', persistPromptSettings);
    if (rerankCandidatePoolInput) rerankCandidatePoolInput.addEventListener('input', persistPromptSettings);
    if (rerankThresholdInput) rerankThresholdInput.addEventListener('input', persistPromptSettings);
    if (rerankTopKInput) rerankTopKInput.addEventListener('input', persistPromptSettings);
    if (rerankInstructionInput) rerankInstructionInput.addEventListener('input', persistPromptSettings);
    if (refreshContextBtn) refreshContextBtn.addEventListener('click', () => void refreshContextFromRag());
    if (clearContextBtn) clearContextBtn.addEventListener('click', clearContextDraft);
    if (mapSearchBtn) mapSearchBtn.addEventListener('click', () => void searchMapPlaces());
    if (mapSearchInput) {
        mapSearchInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                void searchMapPlaces();
            }
        });
    }
    if (applyMapContextBtn) applyMapContextBtn.addEventListener('click', () => writeMapContext(selectedMapPlace));
    if (clearMapBtn) clearMapBtn.addEventListener('click', clearMapContext);

    if (opencvEnabledCheckbox) {
        opencvEnabledCheckbox.addEventListener('change', () => {
            persistOpenCvSettings();
            setOpenCvStatus(
                opencvEnabledCheckbox.checked
                    ? (opencvAutoStartCheckbox?.checked
                        ? 'OpenCV 眼部追踪已启用，主界面会自动使用摄像头追踪人眼。'
                        : 'OpenCV 眼部追踪已启用，等待手动启动摄像头。')
                    : 'OpenCV 眼部追踪已关闭。'
            );
            sendOpenCvApply({
                start: opencvEnabledCheckbox.checked && (opencvAutoStartCheckbox?.checked ?? true),
                stop: !opencvEnabledCheckbox.checked,
            });
        });
    }
    if (opencvAutoStartCheckbox) {
        opencvAutoStartCheckbox.addEventListener('change', () => {
            persistOpenCvSettings();
            setOpenCvStatus(
                opencvEnabledCheckbox?.checked
                    ? (opencvAutoStartCheckbox.checked
                        ? 'OpenCV 眼部追踪已启用，主界面会自动使用摄像头追踪人眼。'
                        : 'OpenCV 眼部追踪已启用，等待手动启动摄像头。')
                    : 'OpenCV 眼部追踪未启用。'
            );
            sendOpenCvApply({ start: (opencvEnabledCheckbox?.checked ?? false) && opencvAutoStartCheckbox.checked });
        });
    }
    if (opencvMirrorCheckbox) {
        opencvMirrorCheckbox.addEventListener('change', () => {
            persistOpenCvSettings();
            sendOpenCvApply();
        });
    }
    if (opencvSmoothInput) opencvSmoothInput.addEventListener('input', () => { persistOpenCvSettings(); sendOpenCvApply(); });
    if (opencvYawGainInput) opencvYawGainInput.addEventListener('input', () => { persistOpenCvSettings(); sendOpenCvApply(); });
    if (opencvPitchGainInput) opencvPitchGainInput.addEventListener('input', () => { persistOpenCvSettings(); sendOpenCvApply(); });
    if (opencvBlendInput) opencvBlendInput.addEventListener('input', () => { persistOpenCvSettings(); sendOpenCvApply(); });
    if (opencvStartBtn) opencvStartBtn.addEventListener('click', () => {
        if (opencvEnabledCheckbox) opencvEnabledCheckbox.checked = true;
        persistOpenCvSettings();
        setOpenCvStatus('已向主页面发送启动摄像头指令。');
        sendOpenCvApply({ start: true });
    });
    if (opencvStopBtn) opencvStopBtn.addEventListener('click', () => {
        setOpenCvStatus('已向主页面发送停止摄像头指令。');
        sendOpenCvApply({ stop: true });
    });
    if (opencvCalibrateBtn) opencvCalibrateBtn.addEventListener('click', () => {
        setOpenCvStatus('已向主页面发送校准指令。');
        sendOpenCvApply({ calibrate: true });
    });
    if (opencvResetBtn) opencvResetBtn.addEventListener('click', () => {
        setOpenCvStatus('已向主页面发送重置校准指令。');
        sendOpenCvApply({ reset: true });
    });

    if (opencvEnabledCheckbox?.checked && (opencvAutoStartCheckbox?.checked ?? true)) {
        sendOpenCvApply({ start: true });
    }

    window.addEventListener('beforeunload', () => {
        try {
            opencvControlChannel?.close();
        } catch {
            // ignore
        }
    });

    resetMapPanel();
});
