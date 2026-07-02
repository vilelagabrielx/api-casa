import os
import json
import time
import socket
import threading
import tinytuya
import sounddevice as sd
import soundfile as sf
import numpy as np
import yt_dlp
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse

# Configurações da lâmpada (definidas pelo usuário)
LAMP_ID = 'eb49c1e95cce655e6ac6mk'
LAMP_IP = '192.168.1.101'  # IP fixo correto
LAMP_KEY = 'E]vaj3/y(s^:gAAO'
LAMP_VERSION = 3.3

# Porta do servidor
PORT = 4000

def get_lamp():
    """Retorna uma nova instância de BulbDevice configurada."""
    lamp = tinytuya.BulbDevice(
        dev_id=LAMP_ID,
        address=LAMP_IP,
        local_key=LAMP_KEY,
        version=LAMP_VERSION
    )
    # Pré-configura as capacidades de Lâmpada Colorida Tipo B (EKAZA)
    # para evitar RuntimeError ao chamar set_colour com nowait=True
    lamp.detect_bulb(response={
        'dps': {
            '20': True,            # switch
            '21': 'colour',        # mode
            '22': 1000,            # brightness
            '23': 1000,            # colourtemp
            '24': '000003e801f4',  # colour
            '25': 'scene',
            '26': 0,
            '28': 'music'
        }
    })
    return lamp


# =================================================================
# GERENCIADOR DE FILA (PLAYLIST) E DOWNLOADS
# =================================================================

def delete_track_file(track):
    """Remove o arquivo WAV físico associado a uma música para liberar espaço no servidor."""
    if track and track.get('file_path') and os.path.exists(track['file_path']):
        try:
            os.remove(track['file_path'])
            print(f"[Limpeza] Removido arquivo de cache: {track['file_path']}")
        except Exception as e:
            print(f"Erro ao deletar {track['file_path']}: {e}")

class QueueManager:
    def __init__(self):
        self.queue = []
        self.current_track = None
        self.history = []
        self.lock = threading.Lock()

    def add_url(self, url):
        """Extrai metadados do link do YouTube e adiciona à fila."""
        print(f"Extraindo metadados da URL: {url}")
        ydl_opts = {
            'extract_flat': 'in_playlist',
            'skip_download': True,
            'quiet': True,
        }
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            try:
                info = ydl.extract_info(url, download=False)
            except Exception as e:
                print(f"Erro ao extrair metadados: {e}")
                raise e

            new_tracks = []
            if 'entries' in info:
                # Playlist do YouTube
                playlist_title = info.get('title') or "Playlist"
                print(f"Playlist detectada: {playlist_title}")
                for idx, entry in enumerate(info['entries']):
                    if not entry: continue
                    new_tracks.append({
                        'id': entry.get('id') or f"pl_{int(time.time())}_{idx}",
                        'title': entry.get('title') or f"Faixa {idx+1}",
                        'url': entry.get('url') or f"https://www.youtube.com/watch?v={entry.get('id')}",
                        'duration': entry.get('duration') or 0,
                        'status': 'pending', # pending, downloading, ready, failed
                        'file_path': None
                    })
            else:
                # Vídeo único
                new_tracks.append({
                    'id': info.get('id') or f"vid_{int(time.time())}",
                    'title': info.get('title') or "Música sem título",
                    'url': info.get('webpage_url') or url,
                    'duration': info.get('duration') or 0,
                    'status': 'pending',
                    'file_path': None
                })

            with self.lock:
                self.queue.extend(new_tracks)
                # Se não havia nada tocando, a primeira da fila vira a ativa e sai da fila
                if self.current_track is None and len(self.queue) > 0:
                    self.current_track = self.queue.pop(0)
            
            return len(new_tracks)

    def get_queue(self):
        with self.lock:
            # Retorna uma cópia da fila (apenas músicas próximas)
            return list(self.queue)

    def get_current_track(self):
        with self.lock:
            return self.current_track

    def get_next_pending_download(self):
        """Retorna a próxima música que precisa de download."""
        with self.lock:
            if self.current_track and self.current_track['status'] == 'pending':
                return self.current_track
            for track in self.queue:
                if track['status'] == 'pending':
                    return track
            return None

    def pop_next_track(self):
        """Pula para a próxima música e limpa o arquivo físico da atual."""
        with self.lock:
            if self.current_track:
                delete_track_file(self.current_track)
                # Reseta o status para pending antes de salvar no histórico para caso o usuário volte
                self.current_track['status'] = 'pending'
                self.current_track['file_path'] = None
                self.history.append(self.current_track)
                if len(self.history) > 20:
                    self.history.pop(0)
            if len(self.queue) > 0:
                self.current_track = self.queue.pop(0)
                return self.current_track
            else:
                self.current_track = None
                return None

    def prev_track(self):
        """Volta para a música anterior limpando a atual."""
        with self.lock:
            if len(self.history) > 0:
                if self.current_track:
                    delete_track_file(self.current_track)
                    self.current_track['status'] = 'pending'
                    self.current_track['file_path'] = None
                    self.queue.insert(0, self.current_track)
                self.current_track = self.history.pop()
                return self.current_track
            return None

    def select_track(self, index):
        """Pula para uma música da fila limpando a atual."""
        with self.lock:
            if 0 <= index < len(self.queue):
                if self.current_track:
                    delete_track_file(self.current_track)
                    self.current_track['status'] = 'pending'
                    self.current_track['file_path'] = None
                    self.history.append(self.current_track)
                    if len(self.history) > 20:
                        self.history.pop(0)
                self.current_track = self.queue.pop(index)
                return self.current_track
            return None

    def remove_track(self, index):
        with self.lock:
            if 0 <= index < len(self.queue):
                track = self.queue.pop(index)
                delete_track_file(track)
                return track
            return None

    def clear_queue(self):
        with self.lock:
            for track in self.queue:
                delete_track_file(track)
            if self.current_track:
                delete_track_file(self.current_track)
            self.queue = []
            self.current_track = None
            self.history = []

    def reorder_queue(self, from_idx, to_idx):
        with self.lock:
            if 0 <= from_idx < len(self.queue) and 0 <= to_idx < len(self.queue):
                track = self.queue.pop(from_idx)
                self.queue.insert(to_idx, track)


# =================================================================
# REPRODUTOR E TRANSMISSOR DE ÁUDIO (SOUNDDEVICE & NETWORK STREAM)
# =================================================================

def get_wav_header(sample_rate, channels, bits_per_sample=16):
    """Gera um cabeçalho WAV estático de 2GB (fluxo contínuo) para o navegador."""
    data_size = 0x7FFFFFFF
    file_size = data_size + 36
    header = bytearray(44)
    header[0:4] = b'RIFF'
    header[4:8] = file_size.to_bytes(4, 'little')
    header[8:12] = b'WAVE'
    header[12:16] = b'fmt '
    header[16:20] = (16).to_bytes(4, 'little') # subchunk1 size (16 para PCM)
    header[20:22] = (1).to_bytes(2, 'little')  # formato (1 para PCM)
    header[22:24] = channels.to_bytes(2, 'little')
    header[24:28] = sample_rate.to_bytes(4, 'little')
    header[28:32] = (sample_rate * channels * (bits_per_sample // 8)).to_bytes(4, 'little')
    header[32:34] = (channels * (bits_per_sample // 8)).to_bytes(2, 'little')
    header[34:36] = bits_per_sample.to_bytes(2, 'little')
    header[36:40] = b'data'
    header[40:44] = data_size.to_bytes(4, 'little')
    return bytes(header)

class StreamManager:
    def __init__(self):
        self.clients = set()
        self.lock = threading.Lock()

    def add_client(self, client_writer):
        with self.lock:
            # Envia o cabeçalho WAV inicial ao novo cliente
            header = get_wav_header(44100, 2, 16)
            try:
                client_writer(header)
                self.clients.add(client_writer)
                print(f"[Stream] Novo cliente conectado. Total: {len(self.clients)}")
            except Exception as e:
                print("Erro ao adicionar cliente ao stream:", e)

    def remove_client(self, client_writer):
        with self.lock:
            if client_writer in self.clients:
                self.clients.remove(client_writer)
                print(f"[Stream] Cliente desconectado. Total: {len(self.clients)}")

    def broadcast(self, data_bytes):
        with self.lock:
            disconnected = []
            for client in self.clients:
                try:
                    client(data_bytes)
                except Exception:
                    disconnected.append(client)
            for client in disconnected:
                if client in self.clients:
                    self.clients.remove(client)

class AudioPlayer:
    def __init__(self):
        self.data = None
        self.sr = 44100
        self.channels = 2
        self.current_frame = 0
        self.is_playing = False
        self.volume = 0.8  # Volume de 0.0 a 1.0
        self.current_track_id = None
        self.server_mute = False
        self.stream = None
        self.stream_manager = StreamManager()
        self.lock = threading.Lock()

    def start_stream(self):
        try:
            self.stream = sd.OutputStream(
                samplerate=44100,
                channels=2,
                dtype='float32'
            )
            self.stream.start()
        except Exception as e:
            print("Erro ao iniciar sounddevice local:", e)

    def play_track(self, track):
        """Carrega e reproduz uma música pronta (status ready)."""
        file_path = track.get('file_path')
        if not file_path or not os.path.exists(file_path):
            print(f"Erro: Arquivo local não encontrado para {track['title']}")
            return False

        print(f"Carregando áudio master: {file_path}")
        try:
            # Lê o WAV do cache (já salvo em 44100Hz Stereo)
            data, sr = sf.read(file_path)
            
            with self.lock:
                self.data = data
                self.sr = sr
                self.channels = data.shape[1] if len(data.shape) > 1 else 1
                self.current_frame = 0
                self.current_track_id = track['id']
                self.is_playing = True
            
            print(f"Tocando master clock: {track['title']}")
            return True
        except Exception as e:
            print(f"Erro ao iniciar reprodução master: {e}")
            return False

    def pause(self):
        with self.lock:
            self.is_playing = False

    def resume(self):
        with self.lock:
            if self.data is not None:
                self.is_playing = True

    def seek(self, seconds):
        with self.lock:
            if self.data is not None:
                target_frame = int(seconds * self.sr)
                self.current_frame = max(0, min(target_frame, len(self.data)))
                # Se a música terminou, colocar no meio pode reativar
                if self.current_frame < len(self.data):
                    self.is_playing = True

    def set_volume(self, value):
        """Define o volume de 0.0 a 1.0."""
        with self.lock:
            self.volume = max(0.0, min(value, 1.0))

    def stop(self):
        with self.lock:
            self.is_playing = False
            self.current_frame = 0
            self.data = None
            self.current_track_id = None

    def get_position(self):
        """Retorna a posição atual de reprodução em segundos."""
        with self.lock:
            if self.data is not None:
                return self.current_frame / self.sr
            return 0.0

    def get_next_chunk(self, blocksize):
        """Lê o próximo bloco de áudio de forma thread-safe e garante formato stereo 44100Hz."""
        with self.lock:
            if not self.is_playing or self.data is None:
                return np.zeros((blocksize, 2), dtype='float32')

            start = self.current_frame
            end = start + blocksize

            # Coleta o chunk cru de dados do arquivo
            if start >= len(self.data):
                self.is_playing = False
                return np.zeros((blocksize, 2), dtype='float32')

            if end > len(self.data):
                chunk = self.data[start:]
                self.current_frame = len(self.data)
                self.is_playing = False
            else:
                chunk = self.data[start:end]
                self.current_frame = end

            # Garante que o formato de canais seja transformado em 2D Stereo
            if len(chunk.shape) == 1:
                # Caso o array seja 1D (Mono puro)
                chunk = np.column_stack((chunk, chunk))
            elif chunk.shape[1] == 1:
                # Caso o array seja 2D de apenas 1 canal (ex: (N, 1))
                chunk = np.column_stack((chunk[:, 0], chunk[:, 0]))
            elif chunk.shape[1] > 2:
                # Caso seja multi-canal (ex: 5.1), reduz para stereo pegando os 2 primeiros canais
                chunk = chunk[:, :2]

            # Se o pedaço for menor que o blocksize (fim do arquivo), preenche com zeros
            if len(chunk) < blocksize:
                out = np.zeros((blocksize, 2), dtype='float32')
                out[:len(chunk)] = chunk
                chunk = out

            return chunk * self.volume

    def get_devices(self):
        """Lista os dispositivos de saída de som disponíveis no servidor."""
        try:
            devices = sd.query_devices()
            output_devices = []
            for idx, dev in enumerate(devices):
                if dev.get('max_output_channels', 0) > 0:
                    output_devices.append({
                        'index': idx,
                        'name': dev.get('name'),
                        'hostapi': sd.query_hostapis(dev.get('hostapi', 0))['name']
                    })
            return output_devices
        except Exception as e:
            print("Erro ao listar dispositivos:", e)
            return []


# Instâncias globais do Player
queue_manager = QueueManager()
audio_player = AudioPlayer()

# =================================================================
# WORKERS DE SEGUNDO PLANO (THREAD DE DOWNLOAD E SUPERVISOR)
# =================================================================

def downloader_worker():
    """Baixa em background as músicas pendentes da fila."""
    os.makedirs('static/cache', exist_ok=True)
    while True:
        track = queue_manager.get_next_pending_download()
        if track:
            video_id = track['id']
            out_path = f"static/cache/{video_id}.wav"
            
            if os.path.exists(out_path):
                print(f"[Cache] {track['title']} já baixada.")
                with queue_manager.lock:
                    track['status'] = 'ready'
                    track['file_path'] = out_path
                continue

            print(f"[Download] Iniciando download: {track['title']}")
            with queue_manager.lock:
                track['status'] = 'downloading'

            ydl_opts = {
                'format': 'bestaudio/best',
                'outtmpl': f'static/cache/{video_id}',
                'postprocessors': [{
                    'key': 'FFmpegExtractAudio',
                    'preferredcodec': 'wav',
                    'preferredquality': '192',
                }],
                'postprocessor_args': [
                    '-ar', '44100',
                    '-ac', '2'
                ],
                'quiet': True,
            }
            try:
                with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                    ydl.download([track['url']])
                
                # Garante que o arquivo foi criado e renomeado corretamente
                final_path = out_path
                if not os.path.exists(final_path) and os.path.exists(f"static/cache/{video_id}.wav.wav"):
                    os.rename(f"static/cache/{video_id}.wav.wav", final_path)
                
                if os.path.exists(final_path):
                    print(f"[Download] Sucesso: {track['title']}")
                    with queue_manager.lock:
                        track['status'] = 'ready'
                        track['file_path'] = final_path
                        
                    # Se o player estiver ocioso e for a música atual da fila, inicia ela automaticamente
                    current = queue_manager.get_current_track()
                    if current and current['id'] == track['id'] and not audio_player.is_playing and audio_player.data is None:
                        audio_player.play_track(current)
                else:
                    raise Exception("Arquivo final não encontrado.")
            except Exception as e:
                print(f"[Download] Erro ao baixar {track['title']}: {e}")
                with queue_manager.lock:
                    track['status'] = 'failed'
        else:
            time.sleep(1)

def player_supervisor():
    """Monitora o fim de uma faixa para pular automaticamente para a próxima."""
    while True:
        time.sleep(0.5)
        # Se uma música estava carregada, mas parou de tocar e chegou no final
        if audio_player.data is not None and not audio_player.is_playing:
            with audio_player.lock:
                is_finished = audio_player.current_frame >= len(audio_player.data)
            
            if is_finished:
                print("Música finalizada. Carregando próxima faixa...")
                next_track = queue_manager.pop_next_track()
                if next_track:
                    # Tenta tocar. Se o status for pendente, o downloader irá baixar e tocar logo em seguida
                    if next_track['status'] == 'ready':
                        audio_player.play_track(next_track)
                    else:
                        audio_player.stop() # Fica ocioso aguardando download
                else:
                    audio_player.stop()

import queue

# Fila e worker para desacoplar a escrita física de som local (sounddevice) do loop de rede
local_playback_queue = queue.Queue(maxsize=15)

def local_playback_worker():
    """Consome blocos de áudio da fila e escreve no sounddevice sem bloquear a rede."""
    while True:
        try:
            chunk = local_playback_queue.get(timeout=1.0)
            if audio_player.stream:
                try:
                    # Só escreve se não estiver mutado no servidor
                    if not audio_player.server_mute:
                        audio_player.stream.write(chunk.astype('float32'))
                except Exception:
                    pass
        except queue.Empty:
            pass

# Inicia o worker de som local em background
threading.Thread(target=local_playback_worker, daemon=True).start()

def master_audio_loop():
    """Clock central de áudio de ultra-precisão temporal (microssegundos) para rede e som local."""
    blocksize = 2048
    block_duration = blocksize / 44100.0
    
    # Inicializa saída local do Termux
    audio_player.start_stream()
    
    next_frame_time = time.time()
    
    while True:
        # Se o player estiver pausado ou sem música, limpa a fila e dorme
        if not audio_player.is_playing or audio_player.data is None:
            # Limpa fila local
            while not local_playback_queue.empty():
                try:
                    local_playback_queue.get_nowait()
                except queue.Empty:
                    break
            time.sleep(0.1)
            next_frame_time = time.time()
            continue
            
        # Lê o próximo bloco de áudio do player
        chunk = audio_player.get_next_chunk(blocksize)
        
        # Converte para PCM 16-bit estéreo com clipping de proteção para streaming de rede
        clipped_chunk = np.clip(chunk, -1.0, 1.0)
        pcm_bytes = (clipped_chunk * 32767.0).astype(np.int16).tobytes()
        
        # Distribui para todos os clientes conectados via WebSocket imediatamente (sem travar)
        audio_player.stream_manager.broadcast(pcm_bytes)
        
        # Adiciona na fila de reprodução local (sounddevice) sem bloquear o loop principal de rede
        if not audio_player.server_mute:
            try:
                local_playback_queue.put_nowait(chunk)
            except queue.Full:
                pass # Descarta pacote no servidor se o hardware de som dele atrasar
                
        # Temporizador inteligente com compensação de drift acumulado e busy-wait para precisão absoluta (microsegundos)
        next_frame_time += block_duration
        now = time.time()
        sleep_time = next_frame_time - now
        
        # Dorme a maior parte do tempo para poupar CPU
        if sleep_time > 0.004:
            time.sleep(sleep_time - 0.004)
            
        # Busy-wait preciso nos últimos 4 milissegundos
        while time.time() < next_frame_time:
            pass


# Inicializa as threads
threading.Thread(target=downloader_worker, daemon=True).start()
threading.Thread(target=player_supervisor, daemon=True).start()
threading.Thread(target=master_audio_loop, daemon=True).start()


# =================================================================
# HANDLER HTTP E ROTAS DE API
# =================================================================

class BulbHandler(SimpleHTTPRequestHandler):
    def translate_path(self, path):
        path = super().translate_path(path)
        relpath = os.path.relpath(path, os.getcwd())
        if relpath == '.':
            return os.path.join(os.getcwd(), 'static')
        if relpath.startswith('static') or relpath.startswith('static' + os.sep):
            return path
        return os.path.join(os.getcwd(), 'static', relpath)

    def end_headers(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(200, "ok")
        self.end_headers()

    def do_GET(self):
        parsed_path = urlparse(self.path)
        # Rotas da Lâmpada
        if parsed_path.path == '/api/status':
            self.handle_get_status()
        # Rotas do Player
        elif parsed_path.path == '/api/player/queue':
            self.handle_player_queue()
        elif parsed_path.path == '/api/player/status':
            self.handle_player_status()
        elif parsed_path.path == '/api/player/stream':
            if self.headers.get('Upgrade', '').lower() == 'websocket':
                self.handle_player_websocket()
            else:
                self.send_error_response("Upgrade para WebSocket necessário", 400)
        elif parsed_path.path == '/api/player/devices':
            self.handle_player_devices()
        elif parsed_path.path.startswith('/api/'):
            self.send_error_response("Rota da API não encontrada", 404)
        else:
            if parsed_path.path in ('', '/'):
                self.path = '/index.html'
            super().do_GET()

    def do_POST(self):
        parsed_path = urlparse(self.path)
        # Rotas da Lâmpada
        if parsed_path.path == '/api/toggle':
            self.handle_toggle()
        elif parsed_path.path == '/api/color':
            self.handle_color()
        # Rotas do Player
        elif parsed_path.path == '/api/player/add':
            self.handle_player_add()
        elif parsed_path.path == '/api/player/control':
            self.handle_player_control()
        else:
            self.send_error_response("Rota da API não encontrada", 404)

    # Handlers da Lâmpada
    def handle_get_status(self):
        try:
            lamp = get_lamp()
            status = lamp.status()
            if not status or 'Error' in status:
                raise Exception("Lâmpada offline ou IP incorreto.")
            self.send_json_response({"success": True, "status": status})
        except Exception as e:
            self.send_error_response(str(e))

    def handle_toggle(self):
        try:
            content_length = int(self.headers.get('Content-Length', 0))
            post_data = self.rfile.read(content_length)
            data = json.loads(post_data.decode('utf-8')) if post_data else {}
            state = data.get('state')
            lamp = get_lamp()
            if state is True:
                lamp.turn_on()
                new_state = True
            elif state is False:
                lamp.turn_off()
                new_state = False
            else:
                status = lamp.status()
                is_on = status.get('dps', {}).get('20', False)
                if is_on:
                    lamp.turn_off()
                    new_state = False
                else:
                    lamp.turn_on()
                    new_state = True
            self.send_json_response({"success": True, "state": new_state})
        except Exception as e:
            self.send_error_response(str(e))

    def handle_color(self):
        try:
            content_length = int(self.headers.get('Content-Length', 0))
            post_data = self.rfile.read(content_length)
            data = json.loads(post_data.decode('utf-8'))
            mode = data.get('mode', 'colour')
            lamp = get_lamp()
            if mode == 'white':
                brightness = int(data.get('brightness', 1000))
                temp = int(data.get('temp', 1000))
                lamp.set_white(brightness, temp)
                response_data = {"success": True, "mode": "white", "brightness": brightness, "temp": temp}
            else:
                r = int(data.get('r', 255))
                g = int(data.get('g', 255))
                b = int(data.get('b', 255))
                lamp.set_colour(r, g, b, nowait=True)
                response_data = {"success": True, "mode": "colour", "color": {"r": r, "g": g, "b": b}}
            self.send_json_response(response_data)
        except Exception as e:
            self.send_error_response(str(e))

    # Handlers do Player
    def handle_player_queue(self):
        q = queue_manager.get_queue()
        self.send_json_response({"success": True, "queue": q})

    def handle_player_status(self):
        current = queue_manager.get_current_track()
        pos = audio_player.get_position()
        self.send_json_response({
            "success": True,
            "is_playing": audio_player.is_playing,
            "current_track": current,
            "position": round(pos, 1),
            "volume": int(audio_player.volume * 100),
            "server_mute": audio_player.server_mute
        })

    def handle_player_websocket(self):
        """Faz o handshake e mantém uma conexão WebSocket transmitindo frames de áudio em tempo real."""
        key = self.headers.get('Sec-WebSocket-Key')
        if not key:
            self.send_error_response("Missing Sec-WebSocket-Key", 400)
            return

        import hashlib
        import base64
        import queue

        # Realiza o handshake WebSocket conforme o padrão RFC 6455
        accept_key = base64.b64encode(hashlib.sha1((key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").encode('utf-8')).digest()).decode('utf-8')
        
        self.send_response(101)
        self.send_header('Upgrade', 'websocket')
        self.send_header('Connection', 'Upgrade')
        self.send_header('Sec-WebSocket-Accept', accept_key)
        self.end_headers()

        # Desativa algoritmo de Nagle (TCP_NODELAY) para envio imediato de bytes de som
        self.connection.setsockopt(socket.IPPROTO_TCP, socket.TCP_NODELAY, 1)

        # Fila local para o cliente
        data_queue = queue.Queue(maxsize=30)
        
        def write_client(data_bytes):
            # Garante que o payload tenha exatamente 8192 bytes
            if len(data_bytes) != 8192:
                if len(data_bytes) < 8192:
                    data_bytes = data_bytes + b'\x00' * (8192 - len(data_bytes))
                else:
                    data_bytes = data_bytes[:8192]
            # Cabeçalho de frame binário WebSocket (opcode 2, payload de 8192 bytes = 0x2000)
            frame_header = b'\x82\x7e\x20\x00'
            try:
                data_queue.put_nowait(frame_header + data_bytes)
            except queue.Full:
                pass # Descarta pacotes antigos para forçar sincronização
                
        audio_player.stream_manager.add_client(write_client)
        
        try:
            while write_client in audio_player.stream_manager.clients:
                try:
                    frame = data_queue.get(timeout=2.0)
                    self.wfile.write(frame)
                    self.wfile.flush()
                except queue.Empty:
                    # Envia WebSocket Ping frame para manter a conexão ativa (opcode 9)
                    self.wfile.write(b'\x89\x00')
                    self.wfile.flush()
        except Exception:
            pass
        finally:
            audio_player.stream_manager.remove_client(write_client)

    def handle_player_add(self):
        try:
            content_length = int(self.headers.get('Content-Length', 0))
            post_data = self.rfile.read(content_length)
            data = json.loads(post_data.decode('utf-8'))
            url = data.get('url', '').strip()
            
            if not url:
                raise Exception("URL inválida.")

            # Executa a extração em uma thread secundária para não bloquear o servidor HTTP
            def async_add():
                try:
                    queue_manager.add_url(url)
                except Exception as e:
                    print(f"Erro assíncrono ao adicionar: {e}")
            
            threading.Thread(target=async_add, daemon=True).start()
            self.send_json_response({"success": True, "message": "Adicionando música(s)..."})
        except Exception as e:
            self.send_error_response(str(e))

    def handle_player_devices(self):
        """Retorna os dispositivos de acesso físico de áudio no servidor."""
        devs = audio_player.get_devices()
        current = getattr(audio_player, 'device_index', None)
        self.send_json_response({"success": True, "devices": devs, "current_device": current})

    def handle_player_control(self):
        try:
            content_length = int(self.headers.get('Content-Length', 0))
            post_data = self.rfile.read(content_length)
            data = json.loads(post_data.decode('utf-8'))
            action = data.get('action')

            if action == 'play':
                current = queue_manager.get_current_track()
                if current:
                    if audio_player.data is not None:
                        audio_player.resume()
                    elif current['status'] == 'ready':
                        audio_player.play_track(current)
                
            elif action == 'pause':
                audio_player.pause()

            elif action == 'stop':
                current = queue_manager.get_current_track()
                if current:
                    delete_track_file(current)
                audio_player.stop()
                queue_manager.current_track = None
                
            elif action == 'skip':
                next_track = queue_manager.pop_next_track()
                if next_track and next_track['status'] == 'ready':
                    audio_player.play_track(next_track)
                else:
                    audio_player.stop()
                    
            elif action == 'prev':
                prev_track = queue_manager.prev_track()
                if prev_track and prev_track['status'] == 'ready':
                    audio_player.play_track(prev_track)
                else:
                    audio_player.stop()
                    
            elif action == 'seek':
                pos = float(data.get('position', 0))
                audio_player.seek(pos)
                
            elif action == 'volume':
                vol = int(data.get('volume', 80))
                audio_player.set_volume(vol / 100.0)

            elif action == 'toggle_server_audio':
                mute = data.get('mute', False)
                audio_player.server_mute = mute

            elif action == 'set_device':
                device_idx = data.get('device_index')
                if device_idx is not None:
                    device_idx = int(device_idx)
                audio_player.start_stream(device_idx)

            elif action == 'select':
                idx = int(data.get('index', 0))
                track = queue_manager.select_track(idx)
                if track and track['status'] == 'ready':
                    audio_player.play_track(track)
                else:
                    audio_player.stop()

            elif action == 'remove':
                idx = int(data.get('index', 0))
                queue_manager.remove_track(idx)

            elif action == 'clear':
                audio_player.stop()
                queue_manager.clear_queue()

            elif action == 'reorder':
                from_idx = int(data.get('from'))
                to_idx = int(data.get('to'))
                queue_manager.reorder_queue(from_idx, to_idx)

            self.send_json_response({"success": True})
        except Exception as e:
            self.send_error_response(str(e))

    # Utilitários de Resposta
    def send_json_response(self, data, code=200):
        self.send_response(code)
        self.send_header('Content-Type', 'application/json')
        self.end_headers()
        self.wfile.write(json.dumps(data).encode('utf-8'))

    def send_error_response(self, message, code=500):
        self.send_json_response({"success": False, "error": message}, code)

if __name__ == "__main__":
    # Limpa cache antigo ao iniciar para evitar resíduos de execuções anteriores
    import shutil
    if os.path.exists('static/cache'):
        try:
            shutil.rmtree('static/cache')
            print("[Limpeza] Pasta static/cache limpa na inicialização.")
        except Exception as e:
            print("Erro ao limpar static/cache inicial:", e)
    os.makedirs('static/cache', exist_ok=True)

    server = ThreadingHTTPServer(("0.0.0.0", PORT), BulbHandler)
    print(f"API e Website rodando em http://localhost:{PORT}")
    print(f"Lâmpada configurada para o IP: {LAMP_IP}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nServidor finalizado.")
