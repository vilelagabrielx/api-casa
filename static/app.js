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
