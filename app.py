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
from http.server import SimpleHTTPRequestHandler, HTTPServer
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
        """Pula para a próxima música e guarda a atual no histórico."""
        with self.lock:
            if self.current_track:
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
        """Recupera a última música tocada do histórico e devolve a atual para a fila."""
        with self.lock:
            if len(self.history) > 0:
                if self.current_track:
                    self.queue.insert(0, self.current_track)
                self.current_track = self.history.pop()
                return self.current_track
            return None

    def select_track(self, index):
        """Seleciona uma música específica da fila por índice, tocando-a imediatamente."""
        with self.lock:
            if 0 <= index < len(self.queue):
                if self.current_track:
                    self.history.append(self.current_track)
                self.current_track = self.queue.pop(index)
                return self.current_track
            return None

    def remove_track(self, index):
        with self.lock:
            if 0 <= index < len(self.queue):
                return self.queue.pop(index)
            return None

    def clear_queue(self):
        with self.lock:
            self.queue = []
            self.current_track = None
            self.history = []

    def reorder_queue(self, from_idx, to_idx):
        with self.lock:
            if 0 <= from_idx < len(self.queue) and 0 <= to_idx < len(self.queue):
                track = self.queue.pop(from_idx)
                self.queue.insert(to_idx, track)


# =================================================================
# REPRODUTOR DE ÁUDIO (SOUNDDEVICE)
# =================================================================

class AudioPlayer:
    def __init__(self):
        self.stream = None
        self.data = None
        self.sr = 44100
        self.channels = 1
        self.current_frame = 0
        self.is_playing = False
        self.volume = 0.8  # Volume de 0.0 a 1.0
        self.current_track_id = None
        self.server_mute = False  # Modo apenas navegador muta o som no servidor
        self.lock = threading.Lock()

    def play_track(self, track):
        """Carrega e reproduz uma música pronta (status ready)."""
        file_path = track.get('file_path')
        if not file_path or not os.path.exists(file_path):
            print(f"Erro: Arquivo local não encontrado para {track['title']}")
            return False

        print(f"Carregando áudio: {file_path}")
        try:
            # Lê o WAV do cache
            data, sr = sf.read(file_path)
            
            with self.lock:
                self.data = data
                self.sr = sr
                self.channels = data.shape[1] if len(data.shape) > 1 else 1
                self.current_frame = 0
                self.current_track_id = track['id']
                self.is_playing = True
                
                if self.stream:
                    self.stream.stop()
                    self.stream.close()

                # Inicializa stream com callback de baixa latência
                self.stream = sd.OutputStream(
                    samplerate=self.sr,
                    channels=self.channels,
                    callback=self._audio_callback,
                    blocksize=2048,
                    dtype='float32'
                )
                self.stream.start()
            print(f"Tocando: {track['title']}")
            return True
        except Exception as e:
            print(f"Erro ao iniciar reprodução: {e}")
            return False

    def _audio_callback(self, outdata, frames, time_info, status):
        """Callback executado pela thread do PortAudio para preencher o buffer de saída."""
        if not self.is_playing or self.data is None:
            outdata.fill(0)
            return

        if self.server_mute:
            # Mantém avanço e encerramento lógico em silêncio
            with self.lock:
                self.current_frame = min(self.current_frame + frames, len(self.data))
                if self.current_frame >= len(self.data):
                    self.is_playing = False
            outdata.fill(0)
            return

        with self.lock:
            start = self.current_frame
            end = start + frames
            
            if start >= len(self.data):
                # Fim da música
                outdata.fill(0)
                self.is_playing = False
                return
                
            if end > len(self.data):
                # Escreve o restante da música e preenche com silêncio
                chunk = self.data[start:]
                outdata[:len(chunk)] = chunk * self.volume
                outdata[len(chunk):].fill(0)
                self.current_frame = len(self.data)
                self.is_playing = False
            else:
                # Escreve um bloco normal multiplicado pelo volume
                outdata[:] = self.data[start:end] * self.volume
                self.current_frame = end

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
            if self.stream:
                self.stream.stop()
                self.stream.close()
                self.stream = None
            self.current_track_id = None

    def get_position(self):
        """Retorna a posição atual de reprodução em segundos."""
        with self.lock:
            if self.data is not None:
                return self.current_frame / self.sr
            return 0.0


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


# Inicializa as threads
threading.Thread(target=downloader_worker, daemon=True).start()
threading.Thread(target=player_supervisor, daemon=True).start()


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

            elif action == 'output_mode':
                mode = data.get('mode', 'server')
                if mode == 'browser':
                    audio_player.server_mute = True
                elif mode == 'server':
                    audio_player.server_mute = False
                elif mode == 'both':
                    audio_player.server_mute = False

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
    server = HTTPServer(("0.0.0.0", PORT), BulbHandler)
    print(f"API e Website rodando em http://localhost:{PORT}")
    print(f"Lâmpada configurada para o IP: {LAMP_IP}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nServidor finalizado.")
