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

// Estado interno do player no frontend
let playerState = {
    isPlaying: false,
    duration: 0,
    position: 0,
    isDraggingProgress: false,
    serverMuted: false
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
    navTabs.forEach(tab => {
        tab.addEventListener('click', (e) => {
            navTabs.forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            
            const targetNav = tab.getAttribute('data-nav');
            if (targetNav === 'lights') {
                sectionLights.style.display = 'block';
                sectionMusic.style.display = 'none';
            } else {
                sectionLights.style.display = 'none';
                sectionMusic.style.display = 'block';
                // Atualiza dados de áudio instantaneamente
                fetchMusicStatus();
                fetchMusicQueue();
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
    // reinicializamos o jitter buffer em 150ms para garantir fluxo contínuo.
    if (nextPlayTime < now) {
        nextPlayTime = now + 0.15; // 150ms de jitter buffer
    }
    
    source.start(nextPlayTime);
    nextPlayTime += audioBuffer.duration;
}
