// Configuração de API
const API_BASE = window.location.protocol === 'file:' ? 'http://localhost:4000' : '';

// Estado Global do App
let appState = {
    isOn: false,
    mode: 'colour', // 'colour' ou 'white'
    color: { r: 255, g: 215, b: 0 }, // Amarelo padrão
    brightness: 1000,
    temp: 500,
    isLoading: false
};

// Elementos do DOM
const connectionStatus = document.getElementById('connection-status');
const bulbSvg = document.getElementById('bulb-svg');
const bulbGlow = document.getElementById('bulb-glow');
const powerBtn = document.getElementById('power-btn');
const powerLabel = document.getElementById('power-label');
const tabButtons = document.querySelectorAll('.tab-btn');
const panels = document.querySelectorAll('.panel');
const sliderBrightness = document.getElementById('slider-brightness');
const brightnessVal = document.getElementById('brightness-val');
const sliderTemp = document.getElementById('slider-temp');
const tempVal = document.getElementById('temp-val');

// Inicializa o seletor de cores iro.js
let colorPicker;

document.addEventListener('DOMContentLoaded', () => {
    initColorPicker();
    setupEventListeners();
    fetchStatus(); // Busca o status inicial da lâmpada
});

// Inicialização do Picker
function initColorPicker() {
    colorPicker = new iro.ColorPicker("#picker", {
        width: 240,
        color: `rgb(${appState.color.r}, ${appState.color.g}, ${appState.color.b})`,
        borderWidth: 1,
        borderColor: "rgba(255, 255, 255, 0.2)",
        layout: [
            {
                component: iro.ui.Wheel,
                options: {}
            }
        ]
    });

    // Envia a cor em tempo real com throttle (limitação de taxa)
    colorPicker.on('color:change', throttle((color) => {
        if (!appState.isOn) {
            // Se o usuário mexer na roda de cores, assume-se que quer ligar a lâmpada
            setPowerState(true);
        }
        updateBulbColorUI(color.rgb);
        sendColor({
            mode: 'colour',
            r: color.rgb.r,
            g: color.rgb.g,
            b: color.rgb.b
        });
    }, 150));
}

// Configura eventos da interface
function setupEventListeners() {
    // Botão Power
    powerBtn.addEventListener('click', () => {
        if (appState.isLoading) return;
        togglePower();
    });

    // Abas de Modo (Cores / Luz Branca)
    tabButtons.forEach(btn => {
        btn.addEventListener('click', (e) => {
            const tabName = e.target.getAttribute('data-tab');
            switchTab(tabName);
        });
    });

    // Slider de Brilho
    sliderBrightness.addEventListener('input', (e) => {
        const val = parseInt(e.target.value);
        brightnessVal.textContent = `${Math.round(val / 10)}%`;
        
        // Atualiza a opacidade do brilho no UI
        const strength = val / 1000;
        document.documentElement.style.setProperty('--bulb-glow-strength', strength);
    });

    // Envia o brilho final quando o usuário solta o slider (evita flood)
    sliderBrightness.addEventListener('change', (e) => {
        const val = parseInt(e.target.value);
        appState.brightness = val;
        
        if (!appState.isOn) setPowerState(true);
        
        sendColor({
            mode: 'white',
            brightness: appState.brightness,
            temp: appState.temp
        });
    });

    // Slider de Temperatura (Quente / Frio)
    sliderTemp.addEventListener('input', (e) => {
        const val = parseInt(e.target.value);
        let label = 'Neutro';
        if (val < 400) label = 'Quente';
        else if (val > 700) label = 'Frio';
        tempVal.textContent = label;
    });

    // Envia a temperatura final quando o usuário solta o slider (evita flood)
    sliderTemp.addEventListener('change', (e) => {
        const val = parseInt(e.target.value);
        appState.temp = val;
        
        if (!appState.isOn) setPowerState(true);
        
        sendColor({
            mode: 'white',
            brightness: appState.brightness,
            temp: appState.temp
        });
    });
}

// Utilitário de Limitação de Frequência (Throttle)
function throttle(callback, delay) {
    let timerId;
    let lastCalled = 0;
    return (...args) => {
        const now = Date.now();
        if (now - lastCalled >= delay) {
            callback(...args);
            lastCalled = now;
        } else {
            clearTimeout(timerId);
            timerId = setTimeout(() => {
                callback(...args);
                lastCalled = Date.now();
            }, delay - (now - lastCalled));
        }
    };
}

// Troca de Aba
function switchTab(tabName) {
    tabButtons.forEach(btn => {
        if (btn.getAttribute('data-tab') === tabName) {
            btn.classList.add('active');
        } else {
            btn.classList.remove('active');
        }
    });

    panels.forEach(panel => {
        if (panel.id === `panel-${tabName}`) {
            panel.classList.add('active');
        } else {
            panel.classList.remove('active');
        }
    });

    appState.mode = tabName;

    // Sincroniza o modo na lâmpada física
    if (tabName === 'white') {
        sendColor({
            mode: 'white',
            brightness: appState.brightness,
            temp: appState.temp
        });
    } else {
        const currentPickerColor = colorPicker.color.rgb;
        sendColor({
            mode: 'colour',
            r: currentPickerColor.r,
            g: currentPickerColor.g,
            b: currentPickerColor.b
        });
    }
}

// Atualiza a Lâmpada SVG e o Glow na Tela
function updateBulbColorUI(rgb) {
    const hex = rgbToHex(rgb.r, rgb.g, rgb.b);
    document.documentElement.style.setProperty('--bulb-color', hex);
    
    // Atualiza o background glow do site levemente para criar atmosfera
    const bgGlow = document.querySelector('.background-glow');
    if (appState.isOn) {
        bgGlow.style.background = `radial-gradient(circle, rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.15) 0%, rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0) 70%)`;
    } else {
        bgGlow.style.background = `radial-gradient(circle, rgba(99, 102, 241, 0.05) 0%, rgba(99, 102, 241, 0) 70%)`;
    }
}

// Sincroniza o botão Power e o SVG do HTML
function setPowerState(isOn) {
    appState.isOn = isOn;
    if (isOn) {
        bulbSvg.classList.remove('off');
        bulbSvg.classList.add('on');
        powerBtn.classList.add('active');
        powerLabel.textContent = 'Ligada';
        
        // Aplica a cor atual do picker no UI
        if (appState.mode === 'colour') {
            updateBulbColorUI(colorPicker.color.rgb);
        } else {
            updateBulbColorUI({ r: 255, g: 240, b: 215 }); // Tom branco quente padrão no UI
        }
    } else {
        bulbSvg.classList.remove('on');
        bulbSvg.classList.add('off');
        powerBtn.classList.remove('active');
        powerLabel.textContent = 'Desligada';
        
        // Remove cores do background glow
        const bgGlow = document.querySelector('.background-glow');
        bgGlow.style.background = `radial-gradient(circle, rgba(99, 102, 241, 0.05) 0%, rgba(99, 102, 241, 0) 70%)`;
    }
}

// Chamadas de API

async function fetchStatus() {
    setLoading(true);
    updateStatusIndicator('connecting', 'Conectando à lâmpada...');
    
    try {
        const response = await fetch(`${API_BASE}/api/status`);
        if (!response.ok) throw new Error('Não foi possível obter o status.');
        
        const data = await response.json();
        if (data.success && data.status) {
            const dps = data.status.dps;
            
            // DPS 20: Switch Led (Power)
            const powerState = dps['20'] || false;
            
            // DPS 21: Mode ('white' ou 'colour')
            const mode = dps['21'] || 'colour';
            
            setPowerState(powerState);
            updateStatusIndicator('online', 'Lâmpada Online');
            
            // Sincroniza o modo na UI
            if (mode !== appState.mode) {
                switchTabWithoutAPI(mode);
            }

            // Sincroniza a cor se estiver no modo cores
            // DPS 24: Color Data em formato específico (hsv/rgb ou hex)
            // No tinytuya, o status geralmente retorna o dps decodificado ou bruto.
            // Para evitar travar por diferenças de modelo, tentamos deduzir.
            if (dps['24']) {
                // DPS 24 costuma ser uma string hexadecimal longa (V3.3) ou formato similar.
                // Como ler a cor exata pode variar por firmware da lâmpada, mantemos a roda de cores 
                // e o último estado da UI se o parse for complexo, mas se vier RGB bruto ajudamos.
                // tinytuya às vezes expõe isso no status de forma tratada.
            }
        } else {
            throw new Error(data.error || 'Erro desconhecido');
        }
    } catch (error) {
        console.error(error);
        updateStatusIndicator('offline', 'Lâmpada Offline (Local)');
    } finally {
        setLoading(false);
    }
}

async function togglePower() {
    setLoading(true);
    const targetState = !appState.isOn;
    
    // Atualização otimista do UI (melhor resposta do usuário)
    setPowerState(targetState);
    
    try {
        const response = await fetch(`${API_BASE}/api/toggle`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ state: targetState })
        });
        
        const data = await response.json();
        if (!data.success) {
            // Reverte em caso de falha física na lâmpada
            setPowerState(!targetState);
            alert(`Falha ao controlar lâmpada: ${data.error}`);
        }
    } catch (error) {
        console.error(error);
        setPowerState(!targetState);
        alert('Erro ao se conectar com o servidor local.');
    } finally {
        setLoading(false);
    }
}

async function sendColor(payload) {
    try {
        const response = await fetch(`${API_BASE}/api/color`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        
        const data = await response.json();
        if (!data.success) {
            console.error('Falha ao aplicar cor:', data.error);
        }
    } catch (error) {
        console.error('Erro de rede ao enviar comando de cor:', error);
    }
}

// Troca de aba local sem disparar requisição (evita loops)
function switchTabWithoutAPI(tabName) {
    tabButtons.forEach(btn => {
        if (btn.getAttribute('data-tab') === tabName) {
            btn.classList.add('active');
        } else {
            btn.classList.remove('active');
        }
    });

    panels.forEach(panel => {
        if (panel.id === `panel-${tabName}`) {
            panel.classList.add('active');
        } else {
            panel.classList.remove('active');
        }
    });

    appState.mode = tabName;
}

// Helper UI do Status
function updateStatusIndicator(state, message) {
    connectionStatus.className = 'status-indicator';
    
    if (state === 'connecting') {
        connectionStatus.classList.add('loading');
    } else if (state === 'online') {
        connectionStatus.classList.add('online');
    } else if (state === 'offline') {
        connectionStatus.classList.add('offline');
    }
    
    connectionStatus.querySelector('.status-text').textContent = message;
}

function setLoading(loading) {
    appState.isLoading = loading;
    if (loading) {
        powerBtn.style.opacity = '0.7';
    } else {
        powerBtn.style.opacity = '1';
    }
}

// Helpers Matemáticos
function rgbToHex(r, g, b) {
    return "#" + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
}

// =================================================================
// LÓGICA DO PLAYER DE MÚSICA (SOM DA SALA)
// =================================================================

// Elementos do Player no DOM
const sectionLights = document.getElementById('section-lights');
const sectionMusic = document.getElementById('section-music');
const trackTitle = document.getElementById('track-title');
const trackStatus = document.getElementById('track-status');
const playPauseBtn = document.getElementById('play-pause-btn');
const playIcon = document.getElementById('play-icon');
const pauseIcon = document.getElementById('pause-icon');
const stopBtn = document.getElementById('stop-btn');
const prevBtn = document.getElementById('prev-btn');
const nextBtn = document.getElementById('next-btn');
const progressSlider = document.getElementById('progress-slider');
const currentTimeText = document.getElementById('current-time');
const totalTimeText = document.getElementById('total-time');
const volumeSlider = document.getElementById('volume-slider');
const volumeVal = document.getElementById('volume-val');
const ytUrlInput = document.getElementById('yt-url-input');
const addTrackBtn = document.getElementById('add-track-btn');
const clearQueueBtn = document.getElementById('clear-queue-btn');
const queueList = document.getElementById('queue-list');
const musicNoteIcon = document.querySelector('.music-note-icon');

// Novos elementos de controle de som do servidor
const btnToggleServerAudio = document.getElementById('btn-toggle-server-audio');
const serverDeviceSelectorContainer = document.getElementById('server-device-selector-container');
const serverDeviceSelect = document.getElementById('server-device-select');
const syncOffsetSlider = document.getElementById('sync-offset-slider');
const syncOffsetVal = document.getElementById('sync-offset-val');

// Estado interno do player no frontend
let playerState = {
    isPlaying: false,
    duration: 0,
    position: 0,
    isDraggingProgress: false,
    serverMuted: false,
    syncOffset: parseInt(localStorage.getItem('sync_offset') || '0')
};

// Variáveis para reprodução de áudio bruto (Web Audio API)
let audioCtx = null;
let gainNode = null;
let nextPlayTime = 0;
let isStreamingActive = false;
let streamReader = null;

// Modifica setupEventListeners existente para integrar o player
const originalSetupEventListeners = setupEventListeners;
setupEventListeners = function() {
    originalSetupEventListeners(); // Executa configuração da lâmpada
    
    // Configura navegação por abas
    const navTabs = document.querySelectorAll('.nav-tab');
    const sectionNetflix = document.getElementById('section-netflix');
    navTabs.forEach(tab => {
        tab.addEventListener('click', (e) => {
            navTabs.forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            
            const targetNav = tab.getAttribute('data-nav');
            const mainContainer = document.querySelector('.container');
            if (targetNav === 'lights') {
                if (mainContainer) mainContainer.classList.remove('netflix-mode');
                document.body.classList.remove('netflix-active');
                sectionLights.style.display = 'block';
                sectionMusic.style.display = 'none';
                sectionNetflix.style.display = 'none';
            } else if (targetNav === 'music') {
                if (mainContainer) mainContainer.classList.remove('netflix-mode');
                document.body.classList.remove('netflix-active');
                sectionLights.style.display = 'none';
                sectionMusic.style.display = 'block';
                sectionNetflix.style.display = 'none';
                // Atualiza dados de áudio instantaneamente
                fetchMusicStatus();
                fetchMusicQueue();
            } else if (targetNav === 'netflix') {
                if (mainContainer) mainContainer.classList.add('netflix-mode');
                document.body.classList.add('netflix-active');
                sectionLights.style.display = 'none';
                sectionMusic.style.display = 'none';
                sectionNetflix.style.display = 'block';
                checkM3UStatus();
            }
        });
    });

    // Configura botões de controle de reprodução
    playPauseBtn.addEventListener('click', () => {
        const action = playerState.isPlaying ? 'pause' : 'play';
        sendMusicControl(action);
        // Atualização visual otimista
        setPlayStateUI(!playerState.isPlaying);
    });

    prevBtn.addEventListener('click', () => sendMusicControl('prev'));
    stopBtn.addEventListener('click', () => sendMusicControl('stop'));
    nextBtn.addEventListener('click', () => sendMusicControl('skip'));

    // Barra de progresso interativa (seek)
    progressSlider.addEventListener('input', (e) => {
        playerState.isDraggingProgress = true;
        const val = parseFloat(e.target.value);
        currentTimeText.textContent = formatTime(val);
    });

    progressSlider.addEventListener('change', (e) => {
        const val = parseFloat(e.target.value);
        sendMusicControl('seek', { position: val });
        playerState.isDraggingProgress = false;
    });

    // Slider de Volume
    volumeSlider.addEventListener('input', (e) => {
        const val = parseInt(e.target.value);
        volumeVal.textContent = `${val}%`;
        if (gainNode) {
            gainNode.gain.value = val / 100.0;
        }
    });

    volumeSlider.addEventListener('change', (e) => {
        const val = parseInt(e.target.value);
        sendMusicControl('volume', { volume: val });
    });

    // Configura calibrador de sincronização de áudio (eco)
    syncOffsetSlider.value = playerState.syncOffset;
    syncOffsetVal.textContent = (playerState.syncOffset >= 0 ? '+' : '') + playerState.syncOffset + 'ms';

    syncOffsetSlider.addEventListener('input', (e) => {
        const val = parseInt(e.target.value);
        playerState.syncOffset = val;
        syncOffsetVal.textContent = (val >= 0 ? '+' : '') + val + 'ms';
        localStorage.setItem('sync_offset', val.toString());
    });

    // Configura alternância de som no servidor
    btnToggleServerAudio.addEventListener('click', () => {
        const isCurrentlyActive = btnToggleServerAudio.classList.contains('active');
        const nextMute = isCurrentlyActive; // se está ativo, vai mutar (mute=true)
        
        btnToggleServerAudio.classList.toggle('active', !isCurrentlyActive);
        if (!isCurrentlyActive) {
            serverDeviceSelectorContainer.classList.remove('hidden');
        } else {
            serverDeviceSelectorContainer.classList.add('hidden');
        }
        
        sendMusicControl('toggle_server_audio', { mute: nextMute });
    });

    // Configura seleção de dispositivo no servidor
    serverDeviceSelect.addEventListener('change', () => {
        const idx = serverDeviceSelect.value;
        if (idx !== "") {
            sendMusicControl('set_device', { device_index: parseInt(idx) });
        }
    });

    // Busca dispositivos do servidor e inicia streaming no primeiro clique
    fetchServerDevices();

    document.body.addEventListener('click', () => {
        startBrowserStreaming();
    }, { once: true });

    // Formulário de adicionar música
    addTrackBtn.addEventListener('click', addTrackFromInput);
    ytUrlInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') addTrackFromInput();
    });

    // Limpar fila
    clearQueueBtn.addEventListener('click', () => {
        if (confirm("Deseja realmente limpar toda a fila?")) {
            sendMusicControl('clear');
        }
    });

    // Configura eventos do Cine Casa (IPTV)
    setupNetflixEvents();

    // Inicia loops de sincronização com o servidor (polling)
    setInterval(fetchMusicStatus, 300); // Polling rápido para manter áudio local sincronizado
    setInterval(fetchMusicQueue, 2000); // Fila atualiza mais lentamente
};

// Funções de Comunicação da API do Player

async function fetchMusicStatus() {
    // Evita carregar se o painel de música estiver oculto
    if (sectionMusic.style.display === 'none') return;

    try {
        const response = await fetch(`${API_BASE}/api/player/status`);
        const data = await response.json();
        if (data.success) {
            playerState.isPlaying = data.is_playing;
            playerState.position = data.position;
            playerState.serverMuted = data.server_mute;
            
            setPlayStateUI(data.is_playing);
            
            // Sincroniza estado de mute do servidor no painel
            if (data.server_mute) {
                btnToggleServerAudio.classList.remove('active');
                serverDeviceSelectorContainer.classList.add('hidden');
            } else {
                btnToggleServerAudio.classList.add('active');
                serverDeviceSelectorContainer.classList.remove('hidden');
            }
            
            // Sincroniza áudio local no navegador (streaming)
            syncBrowserAudio(data);

            const track = data.current_track;
            if (track) {
                trackTitle.textContent = track.title;
                playerState.duration = track.duration || 0;
                totalTimeText.textContent = formatTime(playerState.duration);
                
                // Atualiza o slider de progresso se o usuário não estiver arrastando
                if (!playerState.isDraggingProgress) {
                    progressSlider.max = playerState.duration;
                    progressSlider.value = playerState.position;
                    currentTimeText.textContent = formatTime(playerState.position);
                }

                // Exibe status do download/reprodução
                if (track.status === 'ready') {
                    trackStatus.textContent = playerState.isPlaying ? "Reproduzindo áudio local" : "Pausado";
                } else if (track.status === 'downloading') {
                    trackStatus.textContent = "Baixando áudio do YouTube...";
                } else if (track.status === 'pending') {
                    trackStatus.textContent = "Aguardando download na fila...";
                } else {
                    trackStatus.textContent = "Erro ao carregar faixa.";
                }
            } else {
                trackTitle.textContent = "Nenhuma música tocando";
                trackStatus.textContent = "Fila vazia";
                progressSlider.value = 0;
                currentTimeText.textContent = "0:00";
                totalTimeText.textContent = "0:00";
            }

            // Volume (apenas atualiza se o usuário não estiver mexendo)
            if (document.activeElement !== volumeSlider) {
                volumeSlider.value = data.volume;
                volumeVal.textContent = `${data.volume}%`;
            }
        }
    } catch (e) {
        console.error("Erro ao obter status do player:", e);
    }
}

async function fetchMusicQueue() {
    if (sectionMusic.style.display === 'none') return;

    try {
        const response = await fetch(`${API_BASE}/api/player/queue`);
        const data = await response.json();
        if (data.success) {
            renderQueue(data.queue);
        }
    } catch (e) {
        console.error("Erro ao carregar fila:", e);
    }
}

async function sendMusicControl(action, payload = {}) {
    try {
        await fetch(`${API_BASE}/api/player/control`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action, ...payload })
        });
        // Atualiza imediatamente o status para dar feedback ao usuário
        fetchMusicStatus();
        fetchMusicQueue();
    } catch (e) {
        console.error(`Erro ao enviar controle ${action}:`, e);
    }
}

async function addTrackFromInput() {
    const url = ytUrlInput.value.trim();
    if (!url) return;

    addTrackBtn.disabled = true;
    addTrackBtn.textContent = "...";

    try {
        const response = await fetch(`${API_BASE}/api/player/add`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url })
        });
        const data = await response.json();
        if (data.success) {
            ytUrlInput.value = '';
            // Força atualização
            fetchMusicQueue();
        } else {
            alert("Erro ao adicionar link: " + data.error);
        }
    } catch (e) {
        console.error("Erro ao adicionar faixa:", e);
        alert("Erro de conexão ao adicionar link.");
    } finally {
        addTrackBtn.disabled = false;
        addTrackBtn.textContent = "Adicionar";
    }
}

// Funções Auxiliares do UI

function setPlayStateUI(isPlaying) {
    playerState.isPlaying = isPlaying;
    if (isPlaying) {
        playIcon.classList.add('hidden');
        pauseIcon.classList.remove('hidden');
        musicNoteIcon.classList.add('playing');
    } else {
        playIcon.classList.remove('hidden');
        pauseIcon.classList.add('hidden');
        musicNoteIcon.classList.remove('playing');
    }
}

function renderQueue(queue) {
    queueList.innerHTML = '';
    
    if (queue.length === 0) {
        queueList.innerHTML = '<li class="queue-item" style="justify-content: center; color: var(--text-secondary); font-size: 0.85rem;">Fila vazia. Cole um link acima!</li>';
        return;
    }

    queue.forEach((track, index) => {
        const li = document.createElement('li');
        li.className = 'queue-item';

        const info = document.createElement('div');
        info.className = 'queue-item-info';
        info.addEventListener('click', () => {
            sendMusicControl('select', { index });
        });

        const title = document.createElement('div');
        title.className = 'queue-item-title';
        title.textContent = `${index + 1}. ${track.title}`;
        info.appendChild(title);

        const statusContainer = document.createElement('div');
        statusContainer.className = 'queue-item-status';
        
        const durationText = document.createTextNode(formatTime(track.duration) + " • ");
        statusContainer.appendChild(durationText);

        const badge = document.createElement('span');
        badge.className = `status-badge ${track.status}`;
        badge.textContent = translateStatus(track.status);
        statusContainer.appendChild(badge);

        info.appendChild(statusContainer);
        li.appendChild(info);

        // Ações da fila
        const actions = document.createElement('div');
        actions.className = 'queue-item-actions';

        // Botão Subir
        if (index > 0) {
            const upBtn = createQueueBtn('<path d="m18 15-6-6-6 6"/>', () => {
                sendMusicControl('reorder', { from: index, to: index - 1 });
            });
            actions.appendChild(upBtn);
        }

        // Botão Descer
        if (index < queue.length - 1) {
            const downBtn = createQueueBtn('<path d="m6 9 6 6 6-6"/>', () => {
                sendMusicControl('reorder', { from: index, to: index + 1 });
            });
            actions.appendChild(downBtn);
        }

        // Botão Remover
        const removeBtn = createQueueBtn('<path d="M3 6h18M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2M10 11v6M14 11v6"/>', () => {
            sendMusicControl('remove', { index });
        }, 'delete');
        actions.appendChild(removeBtn);

        li.appendChild(actions);
        queueList.appendChild(li);
    });
}

function createQueueBtn(svgPath, onClick, customClass = '') {
    const btn = document.createElement('button');
    btn.className = `queue-action-btn ${customClass}`;
    btn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${svgPath}</svg>`;
    btn.addEventListener('click', (e) => {
        e.stopPropagation(); // Evita disparar o clique da música
        onClick();
    });
    return btn;
}

function formatTime(seconds) {
    if (isNaN(seconds) || seconds === null) return "0:00";
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
}

function translateStatus(status) {
    switch (status) {
        case 'pending': return 'Pendente';
        case 'downloading': return 'Baixando';
        case 'ready': return 'Pronta';
        case 'failed': return 'Falhou';
        default: return status;
    }
}

function syncBrowserAudio(data) {
    // Agora que usamos Web Audio API e ReadableStream, a rádio sempre toca no navegador.
    // O syncBrowserAudio serve apenas para atualizar o ganho do volume
    if (gainNode) {
        gainNode.gain.value = volumeSlider.value / 100.0;
    }
}

async function fetchServerDevices() {
    try {
        const response = await fetch(`${API_BASE}/api/player/devices`);
        const data = await response.json();
        if (data.success) {
            renderServerDevices(data.devices, data.current_device);
        }
    } catch (e) {
        console.error("Erro ao carregar dispositivos do servidor:", e);
    }
}

function renderServerDevices(devices, currentDeviceIndex) {
    serverDeviceSelect.innerHTML = '';
    
    if (devices.length === 0) {
        serverDeviceSelect.innerHTML = '<option value="">Nenhum dispositivo encontrado</option>';
        return;
    }

    devices.forEach(dev => {
        const option = document.createElement('option');
        option.value = dev.index;
        option.textContent = `${dev.name} (${dev.hostapi})`;
        if (dev.index === currentDeviceIndex || (currentDeviceIndex === null && dev.index === 0)) {
            option.selected = true;
        }
        serverDeviceSelect.appendChild(option);
    });
}

let activeWS = null;

async function startBrowserStreaming() {
    if (isStreamingActive) return;
    
    // Inicializa o AudioContext
    if (!audioCtx) {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 44100 });
        nextPlayTime = audioCtx.currentTime;
    }
    
    if (audioCtx.state === 'suspended') {
        await audioCtx.resume();
    }
    
    if (!gainNode) {
        gainNode = audioCtx.createGain();
        gainNode.connect(audioCtx.destination);
    }
    
    gainNode.gain.value = volumeSlider.value / 100.0;
    isStreamingActive = true;
    
    // Converte a URL da API para o protocolo WebSocket correspondente (ws:// ou wss://)
    const wsProto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = API_BASE.startsWith('http') ? API_BASE.replace(/^https?:\/\//, '') : window.location.host;
    const wsUrl = `${wsProto}//${host}/api/player/stream`;
    
    console.log("[Stream] Conectando à rádio local via WebSocket:", wsUrl);
    
    const ws = new WebSocket(wsUrl);
    ws.binaryType = 'arraybuffer';
    activeWS = ws;
    
    ws.onopen = () => {
        console.log("[Stream] Conectado à stream de áudio WebSocket.");
    };
    
    ws.onmessage = (event) => {
        if (!isStreamingActive) {
            ws.close();
            return;
        }
        // Cada mensagem WebSocket contêm exatamente um chunk de 8192 bytes
        if (event.data.byteLength === 8192) {
            playPCMChunk(event.data);
        }
    };
    
    ws.onerror = (err) => {
        console.error("[Stream] Erro no canal de áudio WebSocket:", err);
    };
    
    ws.onclose = () => {
        console.log("[Stream] Canal de áudio WebSocket desconectado.");
        activeWS = null;
        isStreamingActive = false;
        // Tenta reconectar após 2 segundos se a stream estiver ativa
        setTimeout(startBrowserStreaming, 2000);
    };
}

function playPCMChunk(arrayBuffer) {
    if (!audioCtx || audioCtx.state === 'suspended') return;
    
    // Converte os bytes 16-bit PCM (little-endian) para float32 usando Int16Array direto sobre o ArrayBuffer
    const pcm16 = new Int16Array(arrayBuffer);
    const numSamples = pcm16.length;
    const numFrames = numSamples / 2; // stereo (2 canais)
    
    const leftChannel = new Float32Array(numFrames);
    const rightChannel = new Float32Array(numFrames);
    
    for (let i = 0; i < numFrames; i++) {
        leftChannel[i] = pcm16[i * 2] / 32768.0;
        rightChannel[i] = pcm16[i * 2 + 1] / 32768.0;
    }
    
    const audioBuffer = audioCtx.createBuffer(2, numFrames, 44100);
    audioBuffer.copyToChannel(leftChannel, 0);
    audioBuffer.copyToChannel(rightChannel, 1);
    
    const source = audioCtx.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(gainNode);
    
    const now = audioCtx.currentTime;
    // Sob sob sob underflow de rede (nextPlayTime ficou atrás do tempo atual de reprodução),
    // reinicializamos o jitter buffer com o offset de calibração personalizado do usuário.
    if (nextPlayTime < now) {
        const calibration = playerState.syncOffset / 1000.0;
        nextPlayTime = now + Math.max(0.01, 0.05 + calibration); // 50ms base + calibração
    }
    
    source.start(nextPlayTime);
    nextPlayTime += audioBuffer.duration;
}

// =================================================================
// LOGICA DO CINE CASA (NETFLIX LOCAL IPTV)
// =================================================================

let netflixState = {
    loaded: false,
    topCategories: [],
    activeCategory: null,
    activeSearch: "",
    currentVideoInfo: null,
    hlsInstance: null,
    mpegtsInstance: null,
    historySaveInterval: null,
    playbackWatchdog: null,
    bufferingWatchdog: null,
    videoJsPlayer: null,
    
    // Novas propriedades do Makeover
    bannerRotationInterval: null,
    heroActiveChannel: null,
    heroTrailerTimeout: null,
    heroTrailerVideo: null,
    activeHoverTimeout: null,
    activeHoverVideo: null,
    activeHoverCard: null,
    favorites: JSON.parse(localStorage.getItem('cine_favorites') || '[]')
};

// Bind de Elementos
const netflixSetup = document.getElementById('netflix-setup');
const netflixCatalog = document.getElementById('netflix-catalog');
const m3uUrlInput = document.getElementById('m3u-url-input');
const btnImportM3uUrl = document.getElementById('btn-import-m3u-url');
const m3uFileDrop = document.getElementById('m3u-file-drop');
const m3uFileInput = document.getElementById('m3u-file-input');
const netflixSearch = document.getElementById('netflix-search');
const btnChangePlaylist = document.getElementById('btn-change-playlist');
const netflixCategoryTags = document.getElementById('netflix-category-tags');
const netflixShelves = document.getElementById('netflix-shelves');
const btnHeroPlay = document.getElementById('btn-hero-play');
const netflixHero = document.getElementById('netflix-hero');
const netflixHeroTitle = document.getElementById('netflix-hero-title');
const netflixHeroCategory = document.getElementById('netflix-hero-category');
const netflixHeroBg = document.getElementById('netflix-hero-bg');
const netflixPlayerModal = document.getElementById('netflix-player-modal');
const btnClosePlayer = document.getElementById('btn-close-player');
const netflixVideo = document.getElementById('netflix-video');

// Bind de Elementos Netflix Premium Makeover
const profileAvatarBtn = document.getElementById('profile-avatar-btn');
const profileDropdown = document.getElementById('profile-dropdown');
const netflixHeroTrailer = document.getElementById('netflix-hero-trailer-container');
const btnHeroInfo = document.getElementById('btn-hero-info');
const navLinkHome = document.getElementById('nav-link-home');
const navLinkSeries = document.getElementById('nav-link-series');
const navLinkMovies = document.getElementById('nav-link-movies');
const navLinkFavorites = document.getElementById('nav-link-favorites');

// Elementos do Modal de Playlists
const netflixPlaylistsModal = document.getElementById('netflix-playlists-modal');
const btnClosePlaylists = document.getElementById('btn-close-playlists');
const playlistNewName = document.getElementById('playlist-new-name');
const playlistNewUrl = document.getElementById('playlist-new-url');
const btnPlaylistAddUrl = document.getElementById('btn-playlist-add-url');
const playlistFileDrop = document.getElementById('playlist-file-drop');
const playlistFileInput = document.getElementById('playlist-file-input');
const playlistsListContainer = document.getElementById('playlists-list-container');

// Elementos do Modal de Séries
const netflixSeriesModal = document.getElementById('netflix-series-modal');
const btnCloseSeries = document.getElementById('btn-close-series');
const seriesModalTitle = document.getElementById('series-modal-title');
const seriesModalGroup = document.getElementById('series-modal-group');
const seriesBannerBg = document.getElementById('series-banner-bg');
const seriesSeasonSelect = document.getElementById('series-season-select');
const seriesEpisodesGrid = document.getElementById('series-episodes-grid');

let seriesEpisodesData = []; // Armazena episódios carregados da série ativa

// Configura eventos da aba Netflix
function setupNetflixEvents() {
    // Importação por URL
    if (btnImportM3uUrl) {
        btnImportM3uUrl.addEventListener('click', () => {
            const url = m3uUrlInput.value.trim();
            if (!url) return showToast("Por favor, cole um link válido.", "warning");
            btnImportM3uUrl.disabled = true;
            btnImportM3uUrl.textContent = "Baixando...";
            
            fetch('/api/m3u/import', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ url: url })
            })
            .then(r => r.json())
            .then(data => {
                btnImportM3uUrl.disabled = false;
                btnImportM3uUrl.textContent = "Importar Link";
                if (data.success) {
                    m3uUrlInput.value = "";
                    showToast(`Lista importada com sucesso! ${data.count} canais catalogados.`, "success");
                    checkM3UStatus();
                } else {
                    showToast(`Erro: ${data.error}`, "error");
                }
            })
            .catch(err => {
                btnImportM3uUrl.disabled = false;
                btnImportM3uUrl.textContent = "Importar Link";
                showToast("Erro de conexão ao importar lista.", "error");
            });
        });
    }

    // Upload por File Drop
    if (m3uFileDrop) {
        m3uFileDrop.addEventListener('click', () => m3uFileInput.click());
        
        m3uFileDrop.addEventListener('dragover', (e) => {
            e.preventDefault();
            m3uFileDrop.style.borderColor = 'var(--primary-color)';
        });
        
        m3uFileDrop.addEventListener('dragleave', () => {
            m3uFileDrop.style.borderColor = 'rgba(255, 255, 255, 0.15)';
        });
        
        m3uFileDrop.addEventListener('drop', (e) => {
            e.preventDefault();
            m3uFileDrop.style.borderColor = 'rgba(255, 255, 255, 0.15)';
            if (e.dataTransfer.files.length > 0) {
                uploadM3UFile(e.dataTransfer.files[0]);
            }
        });
    }

    if (m3uFileInput) {
        m3uFileInput.addEventListener('change', (e) => {
            if (e.target.files.length > 0) {
                uploadM3UFile(e.target.files[0]);
            }
        });
    }

    // Botão Gerenciar Listas IPTV
    if (btnChangePlaylist) {
        btnChangePlaylist.addEventListener('click', (e) => {
            e.preventDefault();
            SoundFX.playClick();
            if (netflixPlaylistsModal) {
                netflixPlaylistsModal.classList.remove('hidden');
                document.body.classList.add('modal-open');
                fetchPlaylists();
            }
        });
    }

    // Barra de Busca com Debounce
    if (netflixSearch) {
        let searchDebounce;
        netflixSearch.addEventListener('input', (e) => {
            clearTimeout(searchDebounce);
            const query = e.target.value.trim();
            searchDebounce = setTimeout(() => {
                netflixState.activeSearch = query;
                if (query.length > 0) {
                    renderSearchResults(query);
                } else {
                    renderShelves();
                }
            }, 300);
        });
    }

    // Fechar Player Modal
    if (btnClosePlayer) {
        btnClosePlayer.addEventListener('click', closePlayer);
    }
    
    // Fechar Modal de Séries
    if (btnCloseSeries) {
        btnCloseSeries.addEventListener('click', closeSeriesDetails);
    }

    // Seletor de Temporadas
    if (seriesSeasonSelect) {
        seriesSeasonSelect.addEventListener('change', (e) => {
            renderActiveSeasonEpisodes(parseInt(e.target.value));
        });
    }

    // Fechar player ou modal de séries apertando ESC
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            if (netflixPlayerModal && !netflixPlayerModal.classList.contains('hidden')) {
                closePlayer();
            } else if (netflixSeriesModal && !netflixSeriesModal.classList.contains('hidden')) {
                closeSeriesDetails();
            } else if (netflixPlaylistsModal && !netflixPlaylistsModal.classList.contains('hidden')) {
                netflixPlaylistsModal.classList.add('hidden');
                document.body.classList.remove('modal-open');
                checkM3UStatus();
            }
        }
    });

    // Eventos do Modal de Playlists
    if (btnClosePlaylists) {
        btnClosePlaylists.addEventListener('click', () => {
            SoundFX.playClick();
            if (netflixPlaylistsModal) {
                netflixPlaylistsModal.classList.add('hidden');
                document.body.classList.remove('modal-open');
                checkM3UStatus();
            }
        });
    }

    if (btnPlaylistAddUrl) {
        btnPlaylistAddUrl.addEventListener('click', () => {
            const url = playlistNewUrl.value.trim();
            const name = playlistNewName.value.trim();
            if (!url) return showToast("Por favor, cole um link válido.", "warning");
            
            btnPlaylistAddUrl.disabled = true;
            btnPlaylistAddUrl.textContent = "Baixando...";
            SoundFX.playClick();
            
            fetch('/api/m3u/import', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ url: url, name: name })
            })
            .then(r => r.json())
            .then(data => {
                btnPlaylistAddUrl.disabled = false;
                btnPlaylistAddUrl.textContent = "Adicionar";
                if (data.success) {
                    playlistNewUrl.value = "";
                    playlistNewName.value = "";
                    showToast(`Lista importada com sucesso! ${data.count} canais catalogados.`, "success");
                    SoundFX.playChime();
                    fetchPlaylists();
                    checkM3UStatus();
                } else {
                    showToast(`Erro: ${data.error}`, "error");
                }
            })
            .catch(() => {
                btnPlaylistAddUrl.disabled = false;
                btnPlaylistAddUrl.textContent = "Adicionar";
                showToast("Erro de conexão ao importar lista.", "error");
            });
        });
    }

    if (playlistFileDrop) {
        playlistFileDrop.addEventListener('click', () => playlistFileInput.click());
        
        playlistFileDrop.addEventListener('dragover', (e) => {
            e.preventDefault();
            playlistFileDrop.style.borderColor = 'var(--primary-color)';
        });
        
        playlistFileDrop.addEventListener('dragleave', () => {
            playlistFileDrop.style.borderColor = 'rgba(255, 255, 255, 0.15)';
        });
        
        playlistFileDrop.addEventListener('drop', (e) => {
            e.preventDefault();
            playlistFileDrop.style.borderColor = 'rgba(255, 255, 255, 0.15)';
            if (e.dataTransfer.files.length > 0) {
                uploadPlaylistFile(e.dataTransfer.files[0]);
            }
        });
    }

    if (playlistFileInput) {
        playlistFileInput.addEventListener('change', (e) => {
            if (e.target.files.length > 0) {
                uploadPlaylistFile(e.target.files[0]);
            }
        });
    }

    // Inicializa o Video.js se disponível
    if (typeof videojs !== 'undefined' && !netflixState.videoJsPlayer) {
        netflixState.videoJsPlayer = videojs('netflix-video', {
            controls: true,
            autoplay: false,
            preload: 'auto',
            fill: true
        });
    }

    // Setup do Menu Dropdown de Perfil
    setupProfileDropdown();
    
    // Setup dos Filtros da Navbar
    setupNavbarFilters();
    
    // Inicia rotação automática do Hero Banner
    startBannerRotation();
    
    // Configura efeito de escurecimento com scroll da janela
    window.addEventListener('scroll', () => {
        const navbar = document.querySelector('.netflix-navbar');
        if (navbar) {
            if (window.scrollY > 50) {
                navbar.classList.add('scrolled');
            } else {
                navbar.classList.remove('scrolled');
            }
        }
    });

    // Notificações feedback
    const btnNotifications = document.getElementById('btn-notifications');
    if (btnNotifications) {
        btnNotifications.addEventListener('click', () => {
            SoundFX.playClick();
            showToast("Novas recomendações de canais de esportes adicionadas!", "info");
        });
    }

    // Se já estiver na aba netflix ao carregar, verifica status
    checkM3UStatus();
}

function uploadM3UFile(file) {
    const reader = new FileReader();
    const dropText = m3uFileDrop.querySelector('span');
    const originalText = dropText.textContent;
    
    dropText.textContent = "Processando arquivo...";
    m3uFileDrop.style.pointerEvents = 'none';
    
    reader.onload = function(e) {
        const text = e.target.result;
        fetch('/api/m3u/import', {
            method: 'POST',
            body: text
        })
        .then(r => r.json())
        .then(data => {
            dropText.textContent = originalText;
            m3uFileDrop.style.pointerEvents = 'auto';
            if (data.success) {
                showToast(`Arquivo importado! ${data.count} canais analisados com sucesso.`, "success");
                checkM3UStatus();
            } else {
                showToast(`Erro ao importar: ${data.error}`, "error");
            }
        })
        .catch(() => {
            dropText.textContent = originalText;
            m3uFileDrop.style.pointerEvents = 'auto';
            showToast("Erro de conexão ao enviar arquivo.", "error");
        });
    };
    reader.readAsText(file);
}

function checkM3UStatus() {
    if (!netflixSetup || !netflixCatalog) return;
    
    fetch('/api/m3u/status')
    .then(r => r.json())
    .then(data => {
        if (data.success && data.loaded) {
            netflixSetup.classList.add('hidden');
            netflixCatalog.classList.remove('hidden');
            netflixState.loaded = true;
            netflixState.topCategories = data.top_categories;
            
            renderCategoryTags();
            renderShelves();
            loadHeroBanner();
        } else {
            netflixSetup.classList.remove('hidden');
            netflixCatalog.classList.add('hidden');
            netflixState.loaded = false;
        }
    })
    .catch(() => {
        // Ignora falhas silenciosas de rede ao inicializar offline
    });
}

function renderCategoryTags() {
    if (!netflixCategoryTags) return;
    netflixCategoryTags.innerHTML = "";
    
    // Tag "Tudo"
    const tagAll = document.createElement('button');
    tagAll.className = "category-tag active";
    tagAll.textContent = "🎬 Início";
    tagAll.addEventListener('click', () => {
        document.querySelectorAll('.category-tag').forEach(t => t.classList.remove('active'));
        tagAll.classList.add('active');
        netflixSearch.value = "";
        netflixState.activeSearch = "";
        renderShelves();
    });
    netflixCategoryTags.appendChild(tagAll);
    
    // Tags dinâmicas com as maiores categorias
    netflixState.topCategories.forEach(cat => {
        const btn = document.createElement('button');
        btn.className = "category-tag";
        btn.textContent = `${cat.name} (${cat.count})`;
        btn.addEventListener('click', () => {
            document.querySelectorAll('.category-tag').forEach(t => t.classList.remove('active'));
            btn.classList.add('active');
            renderCategoryShelf(cat.name);
        });
        netflixCategoryTags.appendChild(btn);
    });
}

// Sistema de Sons Sintetizados via Web Audio API (Netflix Style)
const SoundFX = {
    audioCtx: null,
    init() {
        if (!this.audioCtx) {
            this.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        }
        if (this.audioCtx.state === 'suspended') {
            this.audioCtx.resume();
        }
    },
    // Som clássico "Tudum" da Netflix
    playTudum() {
        try {
            this.init();
            const ctx = this.audioCtx;
            const now = ctx.currentTime;
            
            // Primeiro tom grave
            const osc1 = ctx.createOscillator();
            const gain1 = ctx.createGain();
            osc1.type = 'sawtooth';
            osc1.frequency.setValueAtTime(80, now);
            osc1.frequency.linearRampToValueAtTime(65, now + 0.6);
            gain1.gain.setValueAtTime(0.2, now);
            gain1.gain.exponentialRampToValueAtTime(0.01, now + 0.8);
            osc1.connect(gain1);
            gain1.connect(ctx.destination);
            
            // Segundo tom harmônico
            const osc2 = ctx.createOscillator();
            const gain2 = ctx.createGain();
            osc2.type = 'triangle';
            osc2.frequency.setValueAtTime(160, now + 0.05);
            osc2.frequency.linearRampToValueAtTime(130, now + 0.6);
            gain2.gain.setValueAtTime(0.25, now + 0.05);
            gain2.gain.exponentialRampToValueAtTime(0.01, now + 0.8);
            osc2.connect(gain2);
            gain2.connect(ctx.destination);
            
            osc1.start(now);
            osc2.start(now + 0.05);
            osc1.stop(now + 0.8);
            osc2.stop(now + 0.8);
        } catch (e) {
            console.error("Erro no som Tudum:", e);
        }
    },
    // Som sutil de clique
    playClick() {
        try {
            this.init();
            const ctx = this.audioCtx;
            const now = ctx.currentTime;
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            
            osc.type = 'sine';
            osc.frequency.setValueAtTime(1200, now);
            osc.frequency.exponentialRampToValueAtTime(150, now + 0.04);
            
            gain.gain.setValueAtTime(0.04, now);
            gain.gain.exponentialRampToValueAtTime(0.001, now + 0.04);
            
            osc.connect(gain);
            gain.connect(ctx.destination);
            
            osc.start(now);
            osc.stop(now + 0.05);
        } catch (e) {}
    },
    // Som de chime de sucesso
    playChime() {
        try {
            this.init();
            const ctx = this.audioCtx;
            const now = ctx.currentTime;
            
            const freqs = [523.25, 659.25, 783.99]; // C5, E5, G5
            freqs.forEach((freq, idx) => {
                const osc = ctx.createOscillator();
                const gain = ctx.createGain();
                
                osc.type = 'sine';
                osc.frequency.setValueAtTime(freq, now + idx * 0.08);
                
                gain.gain.setValueAtTime(0.06, now + idx * 0.08);
                gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.08 + 0.3);
                
                osc.connect(gain);
                gain.connect(ctx.destination);
                
                osc.start(now + idx * 0.08);
                osc.stop(now + idx * 0.08 + 0.3);
            });
        } catch (e) {}
    }
};

function toggleFavorite(channel, btn) {
    const idx = netflixState.favorites.findIndex(fav => fav.url === channel.url);
    if (idx !== -1) {
        netflixState.favorites.splice(idx, 1);
        btn.textContent = '+';
        btn.title = 'Adicionar à minha lista';
        showToast(`"${channel.name}" removido de Minha Lista.`, "info");
    } else {
        netflixState.favorites.push(channel);
        btn.textContent = '✓';
        btn.title = 'Remover da minha lista';
        showToast(`"${channel.name}" adicionado a Minha Lista.`, "success");
    }
    localStorage.setItem('cine_favorites', JSON.stringify(netflixState.favorites));
    
    const activeNav = document.querySelector('.nav-link.active');
    if (activeNav && activeNav.id === 'nav-link-favorites') {
        renderFavoritesShelf();
    }
}

function setupProfileDropdown() {
    if (!profileAvatarBtn || !profileDropdown) return;
    
    profileAvatarBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        SoundFX.playClick();
        profileDropdown.classList.toggle('hidden');
    });
    
    document.addEventListener('click', () => {
        if (profileDropdown && !profileDropdown.classList.contains('hidden')) {
            profileDropdown.classList.add('hidden');
        }
    });
    
    const btnProfileMylist = document.getElementById('btn-profile-mylist');
    if (btnProfileMylist) {
        btnProfileMylist.addEventListener('click', (e) => {
            e.preventDefault();
            SoundFX.playClick();
            renderFavoritesShelf();
        });
    }
    
    const btnProfileMe = document.getElementById('btn-profile-me');
    if (btnProfileMe) {
        btnProfileMe.addEventListener('click', (e) => {
            e.preventDefault();
            SoundFX.playClick();
            showToast("Perfil ativo: Administrador", "info");
        });
    }
    
    const btnProfileSettings = document.getElementById('btn-profile-settings');
    if (btnProfileSettings) {
        btnProfileSettings.addEventListener('click', (e) => {
            e.preventDefault();
            SoundFX.playClick();
            showToast("Configurações do Cine Casa carregadas.", "info");
        });
    }
    
    const btnProfileLogout = document.getElementById('btn-profile-logout');
    if (btnProfileLogout) {
        btnProfileLogout.addEventListener('click', (e) => {
            e.preventDefault();
            SoundFX.playClick();
            fetch('/api/m3u/clear', { method: 'POST' }).then(() => {
                window.location.reload();
            });
        });
    }
}

function setupNavbarFilters() {
    const navLinks = [navLinkHome, navLinkSeries, navLinkMovies, navLinkFavorites];
    navLinks.forEach(link => {
        if (!link) return;
        link.addEventListener('click', (e) => {
            e.preventDefault();
            SoundFX.playClick();
            navLinks.forEach(l => { if (l) l.classList.remove('active'); });
            link.classList.add('active');
            
            const id = link.id;
            if (id === 'nav-link-home') {
                renderShelves();
            } else if (id === 'nav-link-series') {
                renderFilteredCatalog("series");
            } else if (id === 'nav-link-movies') {
                renderFilteredCatalog("movies");
            } else if (id === 'nav-link-favorites') {
                renderFavoritesShelf();
            }
        });
    });
}

function renderFavoritesShelf() {
    if (!netflixShelves) return;
    netflixShelves.innerHTML = "";
    
    const shelf = createShelfDOM("Minha Lista");
    netflixShelves.appendChild(shelf);
    const row = shelf.querySelector('.shelf-row');
    row.style.flexWrap = "wrap";
    row.style.overflowX = "visible";
    
    if (netflixState.favorites.length === 0) {
        row.innerHTML = `<p style="padding: 20px; color: var(--text-secondary);">Sua lista está vazia. Adicione itens clicando em "+" nos cards.</p>`;
        return;
    }
    
    netflixState.favorites.forEach(ch => {
        row.appendChild(createVideoCard(ch));
    });
}

function renderFilteredCatalog(type) {
    if (!netflixShelves) return;
    netflixShelves.innerHTML = "";
    
    const title = type === "series" ? "Séries Disponíveis" : "Filmes Disponíveis";
    const shelf = createShelfDOM(title);
    netflixShelves.appendChild(shelf);
    const row = shelf.querySelector('.shelf-row');
    row.style.flexWrap = "wrap";
    row.style.overflowX = "visible";
    
    renderSkeletons();
    
    let fetchedChannels = [];
    const loadPromises = netflixState.topCategories.slice(0, 4).map(cat => 
        fetch(`/api/m3u/category?category=${encodeURIComponent(cat.name)}&limit=50`)
        .then(r => r.json())
        .then(data => {
            if (data.success) {
                fetchedChannels.push(...data.channels);
            }
        }).catch(() => {})
    );
    
    Promise.all(loadPromises).then(() => {
        netflixShelves.innerHTML = "";
        netflixShelves.appendChild(shelf);
        
        let filtered = [];
        if (type === "series") {
            filtered = fetchedChannels.filter(ch => ch.is_series === 1);
        } else {
            filtered = fetchedChannels.filter(ch => ch.is_series !== 1);
        }
        
        const seen = new Set();
        filtered = filtered.filter(ch => {
            const duplicate = seen.has(ch.url);
            seen.add(ch.url);
            return !duplicate;
        });
        
        if (filtered.length === 0) {
            row.innerHTML = `<p style="padding: 20px; color: var(--text-secondary);">Nenhum conteúdo desse tipo encontrado na lista IPTV atual.</p>`;
            return;
        }
        
        filtered.slice(0, 40).forEach(ch => {
            row.appendChild(createVideoCard(ch));
        });
    });
}

function renderSkeletons() {
    if (!netflixShelves) return;
    netflixShelves.innerHTML = "";
    
    for (let i = 0; i < 3; i++) {
        const shelf = document.createElement('div');
        shelf.className = "shelf-container";
        
        let title = "Recomendados";
        if (i === 0) title = "Continuar Assistindo";
        else if (i === 1) title = "Em Alta";
        
        shelf.innerHTML = `
            <h3 class="shelf-title" style="width: 150px; height: 18px; background: #222; border-radius: 4px;"></h3>
            <div class="skeleton-row">
                <div class="skeleton-card"></div>
                <div class="skeleton-card"></div>
                <div class="skeleton-card"></div>
                <div class="skeleton-card"></div>
                <div class="skeleton-card"></div>
                <div class="skeleton-card"></div>
            </div>
        `;
        netflixShelves.appendChild(shelf);
    }
}

function startBannerRotation() {
    if (netflixState.bannerRotationInterval) clearInterval(netflixState.bannerRotationInterval);
    netflixState.bannerRotationInterval = setInterval(() => {
        if (netflixPlayerModal && netflixPlayerModal.classList.contains('hidden') && !netflixHero.matches(':hover')) {
            loadHeroBanner();
        }
    }, 20000);
}

function renderShelves() {
    if (!netflixShelves) return;
    renderSkeletons();
    
    const promises = [
        fetch('/api/m3u/history').then(r => r.json()).catch(() => ({ success: false })),
        fetch('/api/m3u/status').then(r => r.json()).catch(() => ({ success: false }))
    ];
    
    Promise.all(promises).then(([historyData, statusData]) => {
        netflixShelves.innerHTML = "";
        
        // 1. Continuar Assistindo (Histórico)
        if (historyData.success && historyData.history && historyData.history.length > 0) {
            const shelf = createShelfDOM("Continuar Assistindo");
            const row = shelf.querySelector('.shelf-row');
            historyData.history.forEach(item => {
                row.appendChild(createVideoCard(item, { position: item.position, duration: item.duration }));
            });
            netflixShelves.appendChild(shelf);
            
            // 2. Recomendação Baseada em Histórico (IA fake)
            const lastWatched = historyData.history[0];
            if (lastWatched) {
                const groupName = lastWatched.group;
                let cleanGroupName = groupName;
                if (!cleanGroupName || cleanGroupName.toLowerCase() === 'undefined' || cleanGroupName.toLowerCase() === 'null') {
                    cleanGroupName = "Recomendados para Você";
                }
                const shelfWatched = createShelfDOM(`Porque você assistiu ${lastWatched.name}`);
                netflixShelves.appendChild(shelfWatched);
                const rowWatched = shelfWatched.querySelector('.shelf-row');
                
                fetch(`/api/m3u/category?category=${encodeURIComponent(groupName)}&limit=15`)
                .then(r => r.json())
                .then(d => {
                    if (d.success) {
                        d.channels.filter(ch => ch.url !== lastWatched.url).forEach(ch => {
                            rowWatched.appendChild(createVideoCard(ch));
                        });
                    }
                });
            }
        }
        
        // 3. Recomendados e categorias principais
        const topCats = netflixState.topCategories.slice(0, 5);
        if (topCats.length > 0) {
            topCats.forEach((cat, index) => {
                let shelfTitle = cat.name;
                if (!shelfTitle || shelfTitle.toLowerCase() === 'undefined' || shelfTitle.toLowerCase() === 'null') {
                    shelfTitle = "Recomendados para Você";
                }
                
                if (index === 0) shelfTitle = "Em Alta";
                else if (index === 1) shelfTitle = "Novidades Quentes";
                else if (index === 2) shelfTitle = "Destaques Cine Casa";
                
                const shelf = createShelfDOM(shelfTitle);
                netflixShelves.appendChild(shelf);
                const row = shelf.querySelector('.shelf-row');
                
                fetch(`/api/m3u/category?category=${encodeURIComponent(cat.name)}&limit=15`)
                .then(r => r.json())
                .then(d => {
                    if (d.success) {
                        d.channels.forEach(ch => {
                            row.appendChild(createVideoCard(ch));
                        });
                    }
                });
            });
        }
    });
}

function createShelfDOM(title) {
    const shelf = document.createElement('div');
    shelf.className = "shelf-container";
    const shelfId = 'shelf-' + Math.random().toString(36).substr(2, 9);
    
    shelf.innerHTML = `
        <h3 class="shelf-title">${title}</h3>
        <div class="shelf-row-wrapper">
            <button class="carousel-arrow left-arrow hidden" aria-label="Voltar">&lt;</button>
            <div class="shelf-row" id="${shelfId}"></div>
            <button class="carousel-arrow right-arrow" aria-label="Avançar">&gt;</button>
        </div>
    `;
    
    setTimeout(() => {
        const row = shelf.querySelector('.shelf-row');
        const leftArrow = shelf.querySelector('.left-arrow');
        const rightArrow = shelf.querySelector('.right-arrow');
        
        if (row && leftArrow && rightArrow) {
            row.addEventListener('scroll', () => {
                if (row.scrollLeft > 10) {
                    leftArrow.classList.remove('hidden');
                } else {
                    leftArrow.classList.add('hidden');
                }
            });
            
            leftArrow.addEventListener('click', () => {
                SoundFX.playClick();
                row.scrollBy({ left: -row.clientWidth * 0.75, behavior: 'smooth' });
            });
            
            rightArrow.addEventListener('click', () => {
                SoundFX.playClick();
                row.scrollBy({ left: row.clientWidth * 0.75, behavior: 'smooth' });
            });
        }
    }, 50);
    
    return shelf;
}

function createVideoCard(channel, progress = null) {
    const card = document.createElement('div');
    card.className = "video-card";
    
    const imgUrl = channel.poster_path || channel.logo;
    const titleClean = channel.name || "Canal Sem Nome";
    const groupClean = channel.group || "Recomendados";
    
    const miniPlayer = document.createElement('div');
    miniPlayer.className = "card-mini-player-container";
    card.appendChild(miniPlayer);
    
    if (imgUrl && imgUrl.startsWith('http')) {
        const img = document.createElement('img');
        img.className = "card-logo";
        img.src = imgUrl;
        img.alt = titleClean;
        img.onerror = () => {
            img.remove();
            card.appendChild(createCardPlaceholderDOM(channel));
        };
        card.appendChild(img);
        
        const overlay = document.createElement('div');
        overlay.className = "card-info-overlay";
        overlay.innerHTML = `<span class="card-title">${titleClean}</span>`;
        card.appendChild(overlay);
    } else {
        card.appendChild(createCardPlaceholderDOM(channel));
    }
    
    if (progress && progress.duration > 0) {
        const pct = (progress.position / progress.duration) * 100;
        const progressEl = document.createElement('div');
        progressEl.className = "card-progress-bar";
        progressEl.innerHTML = `<div class="card-progress-fill" style="width: ${pct}%"></div>`;
        card.appendChild(progressEl);
    }
    
    const hoverDetails = document.createElement('div');
    hoverDetails.className = "card-hover-details";
    
    const isFav = netflixState.favorites.some(fav => fav.url === channel.url);
    const matchScore = 90 + (titleClean.length % 10);
    
    hoverDetails.innerHTML = `
        <div class="card-actions">
            <button class="action-btn play-mini" title="Assistir">▶</button>
            <button class="action-btn like-mini" title="Gostei">👍</button>
            <button class="action-btn fav-mini" title="${isFav ? 'Remover da minha lista' : 'Adicionar à minha lista'}">
                ${isFav ? '✓' : '+'}
            </button>
        </div>
        <div class="card-meta">
            <span class="meta-relevance">${matchScore}% relevante</span>
            <span class="meta-year">2026</span>
            <span class="meta-age">16+</span>
            <span class="meta-quality">HD</span>
        </div>
        <div class="card-genres">${groupClean}</div>
    `;
    card.appendChild(hoverDetails);
    
    hoverDetails.querySelector('.play-mini').addEventListener('click', (e) => {
        e.stopPropagation();
        SoundFX.playTudum();
        if (channel.is_series === 1) {
            openSeriesDetails(
                channel.series_name || channel.name, 
                channel.logo, 
                channel.group, 
                channel.backdrop_path, 
                channel.overview, 
                channel.rating
            );
        } else {
            playVideo(channel, progress ? progress.position : 0);
        }
    });
    
    hoverDetails.querySelector('.like-mini').addEventListener('click', (e) => {
        e.stopPropagation();
        SoundFX.playChime();
        showToast(`Você gostou de "${titleClean}"!`, "success");
    });
    
    const favBtn = hoverDetails.querySelector('.fav-mini');
    favBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        SoundFX.playChime();
        toggleFavorite(channel, favBtn);
    });
    
    card.addEventListener('click', () => {
        SoundFX.playClick();
        if (channel.is_series === 1) {
            openSeriesDetails(
                channel.series_name || channel.name, 
                channel.logo, 
                channel.group, 
                channel.backdrop_path, 
                channel.overview, 
                channel.rating
            );
        } else {
            playVideo(channel, progress ? progress.position : 0);
        }
    });
    
    let hoverTimeout = null;
    card.addEventListener('mouseenter', () => {
        hoverTimeout = setTimeout(() => {
            if (!netflixState.activeHoverCard) {
                netflixState.activeHoverCard = card;
                miniPlayer.innerHTML = "";
                
                const video = document.createElement('video');
                video.muted = true;
                video.autoplay = true;
                video.loop = true;
                video.playsInline = true;
                video.src = `/api/m3u/stream?url=${encodeURIComponent(channel.url)}`;
                
                miniPlayer.appendChild(video);
                miniPlayer.classList.add('active');
                netflixState.activeHoverVideo = video;
            }
        }, 1000);
    });
    
    card.addEventListener('mouseleave', () => {
        if (hoverTimeout) clearTimeout(hoverTimeout);
        miniPlayer.classList.remove('active');
        miniPlayer.innerHTML = "";
        
        if (netflixState.activeHoverCard === card) {
            netflixState.activeHoverCard = null;
            netflixState.activeHoverVideo = null;
        }
    });
    
    return card;
}

function createCardPlaceholderDOM(channel) {
    const placeholder = document.createElement('div');
    placeholder.className = "card-placeholder";
    const groupClean = channel.group || "Recomendados";
    placeholder.innerHTML = `
        <span class="card-placeholder-group">${groupClean}</span>
        <span class="card-placeholder-title">${channel.name}</span>
    `;
    return placeholder;
}

function renderCategoryShelf(categoryName) {
    if (!netflixShelves) return;
    netflixShelves.innerHTML = "";
    const shelf = createShelfDOM(categoryName);
    netflixShelves.appendChild(shelf);
    const row = shelf.querySelector('.shelf-row');
    row.style.flexWrap = "wrap";
    row.style.overflowX = "visible";
    
    let currentPage = 1;
    let isLoading = false;
    let hasMore = true;
    
    function loadMore() {
        if (isLoading || !hasMore) return;
        isLoading = true;
        
        fetch(`/api/m3u/category?category=${encodeURIComponent(categoryName)}&page=${currentPage}&limit=40`)
        .then(r => r.json())
        .then(data => {
            isLoading = false;
            if (data.success) {
                if (data.channels.length === 0) {
                    hasMore = false;
                    return;
                }
                data.channels.forEach(ch => {
                    row.appendChild(createVideoCard(ch));
                });
                currentPage++;
                if (data.channels.length < 40) {
                    hasMore = false;
                }
            }
        });
    }
    
    loadMore();
    
    window.onscroll = () => {
        if ((window.innerHeight + window.scrollY) >= document.body.offsetHeight - 300) {
            loadMore();
        }
    };
}

function renderSearchResults(query) {
    if (!netflixShelves) return;
    netflixShelves.innerHTML = "";
    const shelf = createShelfDOM(`Resultados para "${query}"`);
    netflixShelves.appendChild(shelf);
    const row = shelf.querySelector('.shelf-row');
    row.style.flexWrap = "wrap";
    
    fetch(`/api/m3u/category?search=${encodeURIComponent(query)}&limit=50`)
    .then(r => r.json())
    .then(data => {
        if (data.success) {
            if (data.channels.length === 0) {
                row.innerHTML = `<p style="padding: 20px; color: var(--text-secondary);">Nenhum canal ou filme encontrado.</p>`;
                return;
            }
            data.channels.forEach(ch => {
                row.appendChild(createVideoCard(ch));
            });
        }
    });
}

function loadHeroBanner(specificChannel = null) {
    if (!netflixHeroTitle) return;
    
    if (netflixState.heroTrailerTimeout) clearTimeout(netflixState.heroTrailerTimeout);
    if (netflixState.heroTrailerVideo) {
        netflixState.heroTrailerVideo.remove();
        netflixState.heroTrailerVideo = null;
    }
    if (netflixHeroTrailer) {
        netflixHeroTrailer.classList.remove('active');
        netflixHeroTrailer.innerHTML = "";
    }
    
    if (specificChannel) {
        setHeroUI(specificChannel);
        return;
    }
    
    if (netflixState.topCategories.length === 0) return;
    const cat = netflixState.topCategories[0].name;
    
    fetch(`/api/m3u/category?category=${encodeURIComponent(cat)}&limit=20`)
    .then(r => r.json())
    .then(data => {
        if (data.success && data.channels.length > 0) {
            const idx = Math.floor(Math.random() * data.channels.length);
            const ch = data.channels[idx];
            setHeroUI(ch);
        }
    });
}

function setHeroUI(ch) {
    netflixState.heroActiveChannel = ch;
    netflixHeroTitle.textContent = ch.name;
    if (netflixHeroCategory) netflixHeroCategory.textContent = ch.group || "Destaque";
    
    const imgUrl = ch.poster_path || ch.logo;
    if (imgUrl && imgUrl.startsWith('http') && netflixHeroBg) {
        netflixHeroBg.style.backgroundImage = `url('${imgUrl}')`;
        netflixHeroBg.style.opacity = '1';
    } else if (netflixHeroBg) {
        netflixHeroBg.style.backgroundImage = `linear-gradient(135deg, #1f1f1f 0%, #000000 100%)`;
        netflixHeroBg.style.opacity = '1';
    }
    
    if (btnHeroPlay) {
        btnHeroPlay.onclick = () => {
            SoundFX.playTudum();
            if (ch.is_series === 1) {
                openSeriesDetails(ch.series_name || ch.name, ch.logo, ch.group, ch.backdrop_path, ch.overview, ch.rating);
            } else {
                playVideo(ch);
            }
        };
    }
    if (btnHeroInfo) {
        btnHeroInfo.onclick = () => {
            SoundFX.playClick();
            if (ch.is_series === 1) {
                openSeriesDetails(ch.series_name || ch.name, ch.logo, ch.group, ch.backdrop_path, ch.overview, ch.rating);
            } else {
                playVideo(ch);
            }
        };
    }
    
    if (netflixHero) {
        netflixHero.onmouseenter = () => {
            if (netflixState.heroTrailerTimeout) clearTimeout(netflixState.heroTrailerTimeout);
            netflixState.heroTrailerTimeout = setTimeout(() => {
                if (!netflixHeroTrailer) return;
                
                const video = document.createElement('video');
                video.muted = true;
                video.autoplay = true;
                video.loop = true;
                video.src = `/api/m3u/stream?url=${encodeURIComponent(ch.url)}`;
                netflixHeroTrailer.appendChild(video);
                netflixHeroTrailer.classList.add('active');
                netflixState.heroTrailerVideo = video;
            }, 1500);
        };
        
        netflixHero.onmouseleave = () => {
            if (netflixState.heroTrailerTimeout) clearTimeout(netflixState.heroTrailerTimeout);
            if (netflixState.heroTrailerVideo) {
                netflixState.heroTrailerVideo.remove();
                netflixState.heroTrailerVideo = null;
            }
            if (netflixHeroTrailer) {
                netflixHeroTrailer.classList.remove('active');
                netflixHeroTrailer.innerHTML = "";
            }
        };
    }
}

function playVideo(channel, startPosition = 0) {
    if (!netflixPlayerModal || !netflixState.videoJsPlayer) return;
    
    // Remove listener de teclado antigo se houver
    if (netflixState.playerKeyDownHandler) {
        document.removeEventListener('keydown', netflixState.playerKeyDownHandler);
        netflixState.playerKeyDownHandler = null;
    }
    
    netflixState.currentVideoInfo = channel;
    netflixPlayerModal.classList.remove('hidden');
    document.body.classList.add('modal-open');
    SoundFX.playTudum();
    
    // Registra listener de teclado para controle do player
    const handlePlayerKeyDown = (e) => {
        const player = netflixState.videoJsPlayer;
        if (!player || (netflixPlayerModal && netflixPlayerModal.classList.contains('hidden'))) return;
        
        // Evita atalhos padrões do browser
        if (['Space', ' ', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key) || e.code === 'Space') {
            e.preventDefault();
        }
        
        if (e.key === ' ' || e.code === 'Space') {
            if (player.paused()) {
                player.play().catch(() => {});
            } else {
                player.pause();
            }
        } else if (e.key === 'ArrowLeft') {
            const newTime = Math.max(0, player.currentTime() - 10);
            player.currentTime(newTime);
            showToast("Retroceder 10s", "info");
        } else if (e.key === 'ArrowRight') {
            const newTime = Math.min(player.duration() || Infinity, player.currentTime() + 10);
            player.currentTime(newTime);
            showToast("Avançar 10s", "info");
        } else if (e.key === 'ArrowUp') {
            const newVol = Math.min(1.0, player.volume() + 0.1);
            player.volume(newVol);
        } else if (e.key === 'ArrowDown') {
            const newVol = Math.max(0.0, player.volume() - 0.1);
            player.volume(newVol);
        } else if (e.key.toLowerCase() === 'f') {
            if (player.isFullscreen()) {
                player.exitFullscreen();
            } else {
                player.requestFullscreen();
            }
        }
    };
    document.addEventListener('keydown', handlePlayerKeyDown);
    netflixState.playerKeyDownHandler = handlePlayerKeyDown;
    
    let isStarted = false;
    
    // Função utilitária para limpar watchdogs locais
    const clearWatchdogs = () => {
        if (netflixState.playbackWatchdog) {
            clearTimeout(netflixState.playbackWatchdog);
            netflixState.playbackWatchdog = null;
        }
        if (netflixState.bufferingWatchdog) {
            clearTimeout(netflixState.bufferingWatchdog);
            netflixState.bufferingWatchdog = null;
        }
    };
    
    const initPlayer = (pos) => {
        const player = netflixState.videoJsPlayer;
        
        // Limpa watchdogs e mpegts antigos
        clearWatchdogs();
        if (netflixState.mpegtsInstance) {
            netflixState.mpegtsInstance.destroy();
            netflixState.mpegtsInstance = null;
        }
        
        // Remove todos os event listeners anteriores do Video.js para não duplicar
        player.off('playing');
        player.off('timeupdate');
        player.off('waiting');
        player.off('error');
        player.off('ended');
        player.off('loadedmetadata');
        
        player.reset();
        
        const urlLower = channel.url.toLowerCase();
        const isM3U8 = urlLower.includes('.m3u8');
        const isTS = urlLower.includes('.ts') || urlLower.includes('output=ts') || urlLower.includes('output=mpegts');
        
        const playUrl = `/api/m3u/stream?url=${encodeURIComponent(channel.url)}`;
        
        // Watchdog de carregamento inicial (8 segundos)
        netflixState.playbackWatchdog = setTimeout(() => {
            if (!isStarted) {
                console.warn("[Watchdog] A reprodução do canal demorou mais de 8s para iniciar.");
                showToast("A transmissão está demorando muito para responder ou está offline.", "warning");
                closePlayer();
            }
        }, 8000);
        
        // Configura os event listeners usando a API do Video.js
        player.on('playing', () => {
            isStarted = true;
            clearWatchdogs();
        });
        
        player.on('timeupdate', () => {
            if (player.currentTime() > 0.1 && !isStarted) {
                isStarted = true;
                clearWatchdogs();
            }
        });
        
        player.on('waiting', () => {
            if (isStarted) {
                if (!netflixState.bufferingWatchdog) {
                    netflixState.bufferingWatchdog = setTimeout(() => {
                        console.warn("[Watchdog] O buffer da transmissão travou por mais de 8s.");
                        showToast("Conexão instável ou canal offline. Transmissão interrompida.", "error");
                        closePlayer();
                    }, 8000);
                }
            }
        });
        
        player.on('error', () => {
            if (netflixState.currentVideoInfo) {
                const err = player.error();
                console.error("Erro no Video.js player:", err);
                showToast("Erro ao reproduzir canal. A transmissão pode estar offline.", "error");
                closePlayer();
            }
        });
        
        player.on('loadedmetadata', () => {
            if (pos > 0 && player.duration() && player.duration() !== Infinity) {
                player.currentTime(pos);
            }
            player.play().catch(() => {
                console.log("Auto-play bloqueado pelo navegador, aguardando clique.");
            });
        });
        
        player.on('ended', () => {
            if (netflixState.currentSeriesEpisodes && netflixState.currentSeriesEpisodes.length > 0 && netflixState.currentEpisode) {
                const currentEp = netflixState.currentEpisode;
                
                const sortedEps = [...netflixState.currentSeriesEpisodes].sort((a, b) => {
                    if (a.season !== b.season) return a.season - b.season;
                    return a.episode - b.episode;
                });
                
                const idx = sortedEps.findIndex(ep => ep.season === currentEp.season && ep.episode === currentEp.episode);
                
                if (idx !== -1 && idx + 1 < sortedEps.length) {
                    const nextEp = sortedEps[idx + 1];
                    netflixState.currentEpisode = nextEp;
                    
                    const nextChannelMock = {
                        name: `${netflixState.currentSeriesName} S0${nextEp.season}E${String(nextEp.episode).padStart(2, '0')}`,
                        logo: nextEp.logo || channel.logo,
                        group: channel.group,
                        url: nextEp.url
                    };
                    
                    console.log(`[Auto-Play] Próximo episódio: T${nextEp.season} E${nextEp.episode}`);
                    playVideo(nextChannelMock);
                    return;
                }
            }
            closePlayer();
        });
        
        // Define a fonte e carrega
        if (isTS && typeof mpegts !== 'undefined' && mpegts.getFeatureList().mseLivePlayback) {
            // Integração híbrida: recupera a tag <video> interna gerida pelo Video.js
            const videoEl = player.el().querySelector('video');
            const mpegtsPlayer = mpegts.createPlayer({
                type: 'mse',
                isLive: true,
                url: playUrl
            });
            netflixState.mpegtsInstance = mpegtsPlayer;
            mpegtsPlayer.attachMediaElement(videoEl);
            
            mpegtsPlayer.on(mpegts.Events.ERROR, (type, detail, info) => {
                console.error("MPEG-TS Error:", type, detail, info);
                showToast("Erro na transmissão MPEG-TS. Canal offline.", "error");
                closePlayer();
            });
            
            mpegtsPlayer.load();
            player.play().catch(() => {});
        } else if (isM3U8) {
            player.src({
                src: playUrl,
                type: 'application/x-mpegURL'
            });
        } else {
            player.src({
                src: playUrl,
                type: 'video/mp4'
            });
        }
    };
    
    if (startPosition === 0) {
        fetch(`/api/m3u/history/position?url=${encodeURIComponent(channel.url)}`)
        .then(r => r.json())
        .then(data => {
            initPlayer(data.success && data.position > 0 ? data.position : 0);
        })
        .catch(() => {
            initPlayer(0);
        });
    } else {
        initPlayer(startPosition);
    }

    clearInterval(netflixState.historySaveInterval);
    netflixState.historySaveInterval = setInterval(() => {
        const player = netflixState.videoJsPlayer;
        if (player && !player.paused() && player.currentTime() > 0) {
            const pos = player.currentTime();
            const dur = player.duration() || 0.0;
            
            fetch('/api/m3u/history/update', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    name: channel.name,
                    logo: channel.logo,
                    group: channel.group,
                    url: channel.url,
                    position: pos,
                    duration: dur === Infinity ? 0.0 : dur
                })
            }).catch(() => {});
        }
    }, 5000);
}

function closePlayer() {
    if (!netflixVideo) return;
    clearInterval(netflixState.historySaveInterval);
    
    // Remove listener de teclado do player
    if (netflixState.playerKeyDownHandler) {
        document.removeEventListener('keydown', netflixState.playerKeyDownHandler);
        netflixState.playerKeyDownHandler = null;
    }
    
    // Limpa watchdogs ativos
    if (netflixState.playbackWatchdog) {
        clearTimeout(netflixState.playbackWatchdog);
        netflixState.playbackWatchdog = null;
    }
    if (netflixState.bufferingWatchdog) {
        clearTimeout(netflixState.bufferingWatchdog);
        netflixState.bufferingWatchdog = null;
    }
    
    if (netflixState.videoJsPlayer) {
        netflixState.videoJsPlayer.off('playing');
        netflixState.videoJsPlayer.off('timeupdate');
        netflixState.videoJsPlayer.off('waiting');
        netflixState.videoJsPlayer.off('error');
        netflixState.videoJsPlayer.off('ended');
        netflixState.videoJsPlayer.off('loadedmetadata');
        
        netflixState.videoJsPlayer.reset();
    }
    
    if (netflixState.mpegtsInstance) {
        netflixState.mpegtsInstance.destroy();
        netflixState.mpegtsInstance = null;
    }
    
    // Reseta estado de autoplay do episódio
    netflixState.currentSeriesEpisodes = null;
    netflixState.currentSeriesName = null;
    netflixState.currentEpisode = null;
    
    if (netflixPlayerModal) netflixPlayerModal.classList.add('hidden');
    document.body.classList.remove('modal-open');
    netflixState.currentVideoInfo = null;
    
    renderShelves();
}

function openSeriesDetails(seriesName, logo, group, backdrop = "", overview = "", rating = 0.0) {
    if (!netflixSeriesModal) return;
    document.body.classList.add('modal-open');
    
    seriesModalTitle.textContent = seriesName;
    seriesModalGroup.textContent = group;
    
    const bgUrl = backdrop || logo;
    if (bgUrl && bgUrl.startsWith('http')) {
        seriesBannerBg.style.backgroundImage = `url('${bgUrl}')`;
    } else {
        seriesBannerBg.style.backgroundImage = `linear-gradient(135deg, #1e1b4b 0%, #020617 100%)`;
    }
    
    const ratingStarsEl = document.getElementById('series-modal-rating-stars');
    const ratingNumEl = document.getElementById('series-modal-rating-num');
    const overviewEl = document.getElementById('series-modal-overview');
    
    if (ratingStarsEl && ratingNumEl) {
        if (rating > 0) {
            const numStars = Math.round(rating / 2);
            ratingStarsEl.textContent = "⭐".repeat(numStars) + "☆".repeat(5 - numStars);
            ratingNumEl.textContent = `${rating.toFixed(1)}/10`;
            ratingStarsEl.style.display = "inline-block";
            ratingNumEl.style.display = "inline-block";
        } else {
            ratingStarsEl.style.display = "none";
            ratingNumEl.style.display = "none";
        }
    }
    
    if (overviewEl) {
        overviewEl.textContent = overview || "Nenhuma sinopse disponível em português para este título.";
    }
    
    seriesEpisodesGrid.innerHTML = "<p style='padding:20px; color:var(--text-secondary);'>Carregando episódios...</p>";
    seriesSeasonSelect.innerHTML = "";
    netflixSeriesModal.classList.remove('hidden');
    
    fetch(`/api/m3u/series/episodes?series_name=${encodeURIComponent(seriesName)}`)
    .then(r => r.json())
    .then(data => {
        if (data.success) {
            seriesEpisodesData = data.episodes;
            
            // Extrai as temporadas únicas
            const seasons = [...new Set(data.episodes.map(ep => ep.season))].sort((a, b) => a - b);
            
            if (seasons.length === 0) {
                seriesEpisodesGrid.innerHTML = "<p style='padding:20px; color:var(--text-secondary);'>Nenhum episódio encontrado.</p>";
                return;
            }
            
            // Popula o dropdown de temporadas
            seasons.forEach(s => {
                const opt = document.createElement('option');
                opt.value = s;
                opt.textContent = `Temporada ${s}`;
                seriesSeasonSelect.appendChild(opt);
            });
            
            // Exibe a primeira temporada por padrão
            renderActiveSeasonEpisodes(seasons[0]);
        } else {
            seriesEpisodesGrid.innerHTML = `<p style='padding:20px; color:#ef4444;'>Erro: ${data.error}</p>`;
        }
    })
    .catch(() => {
        seriesEpisodesGrid.innerHTML = "<p style='padding:20px; color:#ef4444;'>Erro ao conectar com o servidor.</p>";
    });
}

function renderActiveSeasonEpisodes(seasonNum) {
    if (!seriesEpisodesGrid) return;
    seriesEpisodesGrid.innerHTML = "";
    
    const seasonEps = seriesEpisodesData
        .filter(ep => ep.season === seasonNum)
        .sort((a, b) => a.episode - b.episode);
        
    seasonEps.forEach(ep => {
        const row = document.createElement('div');
        row.className = "episode-row";
        
        row.innerHTML = `
            <div class="episode-info">
                <div class="episode-number">${String(ep.episode).padStart(2, '0')}</div>
                <div class="episode-details">
                    <div class="episode-title">${ep.episode_name || `Episódio ${ep.episode}`}</div>
                    <div class="episode-meta">Temporada ${ep.season} &bull; S0${ep.season}E${String(ep.episode).padStart(2, '0')}</div>
                </div>
            </div>
            <div class="episode-play-icon">
                <svg viewBox="0 0 24 24" fill="currentColor">
                    <polygon points="5 3 19 12 5 21 5 3"></polygon>
                </svg>
            </div>
        `;
        
        const channelMock = {
            name: `${seriesModalTitle.textContent} S0${ep.season}E${String(ep.episode).padStart(2, '0')}`,
            logo: ep.logo,
            group: seriesModalGroup.textContent,
            url: ep.url
        };
        
        row.addEventListener('click', () => {
            netflixState.currentSeriesEpisodes = seriesEpisodesData;
            netflixState.currentSeriesName = seriesModalTitle.textContent;
            netflixState.currentEpisode = ep;
            playVideo(channelMock);
        });
        
        seriesEpisodesGrid.appendChild(row);
    });
}

function closeSeriesDetails() {
    if (netflixSeriesModal) netflixSeriesModal.classList.add('hidden');
    document.body.classList.remove('modal-open');
    seriesEpisodesData = [];
}

function showToast(message, type = 'error') {
    let container = document.querySelector('.toast-container');
    if (!container) {
        container = document.createElement('div');
        container.className = 'toast-container';
        document.body.appendChild(container);
    }
    
    const toast = document.createElement('div');
    toast.className = `toast-notification ${type}`;
    
    let icon = 'ℹ️';
    if (type === 'error') icon = '❌';
    else if (type === 'success') icon = '✅';
    else if (type === 'warning') icon = '⚠️';
    
    toast.innerHTML = `
        <span class="toast-icon">${icon}</span>
        <span class="toast-message">${message}</span>
    `;
    
    container.appendChild(toast);
    
    setTimeout(() => {
        toast.remove();
        if (container.children.length === 0) {
            container.remove();
        }
    }, 5000);
}

function uploadPlaylistFile(file) {
    const reader = new FileReader();
    const name = playlistNewName.value.trim() || file.name.replace(/\.[^/.]+$/, "");
    
    showToast("Processando arquivo...", "info");
    
    reader.onload = function(e) {
        const text = e.target.result;
        fetch('/api/m3u/import', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                name: name,
                content: text
            })
        })
        .then(r => r.json())
        .then(data => {
            if (data.success) {
                playlistNewName.value = "";
                showToast(`Lista "${name}" importada! ${data.count} canais analisados.`, "success");
                SoundFX.playChime();
                fetchPlaylists();
                checkM3UStatus();
            } else {
                showToast(`Erro ao importar: ${data.error}`, "error");
            }
        })
        .catch(() => {
            showToast("Erro de conexão ao enviar arquivo.", "error");
        });
    };
    reader.readAsText(file);
}

function fetchPlaylists() {
    if (!playlistsListContainer) return;
    
    playlistsListContainer.innerHTML = `<p style="color: var(--text-secondary); text-align: center; padding: 20px;">Carregando listas...</p>`;
    
    fetch('/api/m3u/playlists')
    .then(r => r.json())
    .then(data => {
        if (data.success) {
            playlistsListContainer.innerHTML = "";
            if (data.playlists.length === 0) {
                playlistsListContainer.innerHTML = `<p style="color: var(--text-secondary); text-align: center; padding: 20px;">Nenhuma lista cadastrada.</p>`;
                return;
            }
            
            data.playlists.forEach(pl => {
                const item = document.createElement('div');
                item.className = "playlist-item-row";
                item.style.display = "flex";
                item.style.alignItems = "center";
                item.style.justifyContent = "space-between";
                item.style.padding = "12px 16px";
                item.style.background = "rgba(255, 255, 255, 0.03)";
                item.style.border = "1px solid rgba(255, 255, 255, 0.05)";
                item.style.borderRadius = "8px";
                item.style.gap = "15px";
                
                item.innerHTML = `
                    <div style="flex: 1; display: flex; flex-direction: column; gap: 4px;">
                        <span style="font-weight: 600; color: #fff; font-size: 0.95rem;">${pl.name}</span>
                        <span style="font-size: 0.8rem; color: var(--text-secondary);">${pl.channel_count} canais &bull; ${pl.url !== 'Upload de Arquivo' ? 'Remota' : 'Arquivo Local'}</span>
                    </div>
                    <div style="display: flex; align-items: center; gap: 15px;">
                        <label class="switch-toggle" style="position: relative; display: inline-block; width: 44px; height: 24px;">
                            <input type="checkbox" class="toggle-active-checkbox" data-id="${pl.id}" ${pl.active === 1 ? 'checked' : ''} style="opacity: 0; width: 0; height: 0;">
                            <span class="slider-toggle-round" style="position: absolute; cursor: pointer; top: 0; left: 0; right: 0; bottom: 0; background-color: #333; transition: .3s; border-radius: 24px;"></span>
                        </label>
                        <button class="btn-playlist-delete" data-id="${pl.id}" style="background: none; border: none; color: #777; cursor: pointer; padding: 5px; font-size: 1.1rem; transition: color 0.2s;" title="Excluir Lista">🗑️</button>
                    </div>
                `;
                
                const checkbox = item.querySelector('.toggle-active-checkbox');
                const slider = item.querySelector('.slider-toggle-round');
                
                const updateSwitchStyle = () => {
                    if (checkbox.checked) {
                        slider.style.backgroundColor = 'var(--primary-color)';
                        slider.style.boxShadow = '0 0 8px rgba(229, 9, 20, 0.5)';
                    } else {
                        slider.style.backgroundColor = '#333';
                        slider.style.boxShadow = 'none';
                    }
                };
                
                const handle = document.createElement('span');
                handle.style.position = 'absolute';
                handle.style.content = '""';
                handle.style.height = '18px';
                handle.style.width = '18px';
                handle.style.left = '3px';
                handle.style.bottom = '3px';
                handle.style.backgroundColor = 'white';
                handle.style.transition = '.3s';
                handle.style.borderRadius = '50%';
                slider.appendChild(handle);
                
                const updateHandlePosition = () => {
                    if (checkbox.checked) {
                        handle.style.transform = 'translateX(20px)';
                    } else {
                        handle.style.transform = 'translateX(0)';
                    }
                };
                
                checkbox.addEventListener('change', () => {
                    SoundFX.playClick();
                    updateSwitchStyle();
                    updateHandlePosition();
                    togglePlaylistActive(pl.id, checkbox.checked ? 1 : 0);
                });
                
                updateSwitchStyle();
                updateHandlePosition();
                
                item.querySelector('.btn-playlist-delete').addEventListener('click', () => {
                    if (confirm(`Tem certeza que deseja remover a lista "${pl.name}"? Todos os canais dela serão apagados.`)) {
                        SoundFX.playClick();
                        deletePlaylist(pl.id);
                    }
                });
                
                playlistsListContainer.appendChild(item);
            });
        }
    });
}

function togglePlaylistActive(playlistId, activeState) {
    fetch('/api/m3u/playlists/toggle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: playlistId, active: activeState })
    })
    .then(r => r.json())
    .then(data => {
        if (data.success) {
            showToast(activeState === 1 ? "Lista ativada com sucesso!" : "Lista desativada.", "success");
            checkM3UStatus();
        } else {
            showToast("Erro ao alterar estado da lista.", "error");
        }
    })
    .catch(() => {
        showToast("Erro de rede.", "error");
    });
}

function deletePlaylist(playlistId) {
    fetch('/api/m3u/playlists/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: playlistId })
    })
    .then(r => r.json())
    .then(data => {
        if (data.success) {
            showToast("Lista removida com sucesso.", "success");
            SoundFX.playChime();
            fetchPlaylists();
            checkM3UStatus();
        } else {
            showToast("Erro ao remover lista.", "error");
        }
    })
    .catch(() => {
        showToast("Erro de rede.", "error");
    });
}
