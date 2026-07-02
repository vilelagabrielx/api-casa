import os
import json
import tinytuya
from http.server import SimpleHTTPRequestHandler, HTTPServer
from urllib.parse import urlparse

# Configurações da lâmpada (definidas pelo usuário)
LAMP_ID = 'eb49c1e95cce655e6ac6mk'
LAMP_IP = '192.168.1.101'  # IP fixo definido pelo usuário
LAMP_KEY = 'E]vaj3/y(s^:gAAO'
LAMP_VERSION = 3.3

# Porta do servidor
PORT = 4000

def get_lamp():
    """Retorna uma nova instância de BulbDevice configurada."""
    return tinytuya.BulbDevice(
        dev_id=LAMP_ID,
        address=LAMP_IP,
        local_key=LAMP_KEY,
        version=LAMP_VERSION
    )

class BulbHandler(SimpleHTTPRequestHandler):
    def translate_path(self, path):
        """Redireciona todas as requisições de arquivos estáticos para a pasta 'static'."""
        # Obtém o caminho padrão traduzido
        path = super().translate_path(path)
        # Calcula o caminho relativo ao diretório de trabalho atual
        relpath = os.path.relpath(path, os.getcwd())
        
        # Se for o diretório raiz, aponta para a pasta 'static'
        if relpath == '.':
            return os.path.join(os.getcwd(), 'static')
        
        # Se a requisição já for para 'static', mantém. Caso contrário, joga para dentro de 'static'
        if relpath.startswith('static') or relpath.startswith('static' + os.sep):
            return path
            
        return os.path.join(os.getcwd(), 'static', relpath)

    def end_headers(self):
        # Habilita CORS para facilitar testes locais e acesso de outros IPs da casa
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        super().end_headers()

    def do_OPTIONS(self):
        """Trata requisições preflight do CORS."""
        self.send_response(200, "ok")
        self.end_headers()

    def do_GET(self):
        parsed_path = urlparse(self.path)
        if parsed_path.path == '/api/status':
            self.handle_get_status()
        elif parsed_path.path.startswith('/api/'):
            self.send_error_response("Rota da API não encontrada", 404)
        else:
            # Caso a rota seja '/' ou vazia, serve o index.html da pasta static
            if parsed_path.path in ('', '/'):
                self.path = '/index.html'
            super().do_GET()

    def do_POST(self):
        parsed_path = urlparse(self.path)
        if parsed_path.path == '/api/toggle':
            self.handle_toggle()
        elif parsed_path.path == '/api/color':
            self.handle_color()
        else:
            self.send_error_response("Rota da API não encontrada", 404)

    def handle_get_status(self):
        try:
            lamp = get_lamp()
            # Tenta ler o status localmente. Timeout padrão do tinytuya ajuda a não travar o loop
            status = lamp.status()
            
            # Se o status retornar um erro ou vazio (lâmpada offline ou IP incorreto)
            if not status or 'Error' in status:
                raise Exception("Não foi possível conectar à lâmpada. Verifique se está ligada na tomada.")
                
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            
            response = {
                "success": True,
                "status": status
            }
            self.wfile.write(json.dumps(response).encode('utf-8'))
        except Exception as e:
            self.send_error_response(str(e))

    def handle_toggle(self):
        try:
            content_length = int(self.headers.get('Content-Length', 0))
            post_data = self.rfile.read(content_length)
            data = json.loads(post_data.decode('utf-8')) if post_data else {}
            
            state = data.get('state')  # True (ligar), False (desligar), None (toggle)
            
            lamp = get_lamp()
            
            if state is True:
                lamp.turn_on()
                new_state = True
            elif state is False:
                lamp.turn_off()
                new_state = False
            else:
                # Comportamento de alternar (toggle)
                status = lamp.status()
                # DPS 20 guarda o estado ligar/desligar
                is_on = status.get('dps', {}).get('20', False)
                if is_on:
                    lamp.turn_off()
                    new_state = False
                else:
                    lamp.turn_on()
                    new_state = True

            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps({"success": True, "state": new_state}).encode('utf-8'))
        except Exception as e:
            self.send_error_response(str(e))

    def handle_color(self):
        try:
            content_length = int(self.headers.get('Content-Length', 0))
            post_data = self.rfile.read(content_length)
            data = json.loads(post_data.decode('utf-8'))
            
            mode = data.get('mode', 'colour')  # 'colour' ou 'white'
            lamp = get_lamp()
            
            if mode == 'white':
                # Valores aceitos pelo Tuya variam geralmente de 10 a 1000
                brightness = int(data.get('brightness', 1000))
                temp = int(data.get('temp', 1000))
                lamp.set_white(brightness, temp)
                response_data = {"success": True, "mode": "white", "brightness": brightness, "temp": temp}
            else:
                r = int(data.get('r', 255))
                g = int(data.get('g', 255))
                b = int(data.get('b', 255))
                # Envia o comando de cor com nowait=True para máxima velocidade e fluidez
                lamp.set_colour(r, g, b, nowait=True)
                response_data = {"success": True, "mode": "colour", "color": {"r": r, "g": g, "b": b}}

            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps(response_data).encode('utf-8'))
        except Exception as e:
            self.send_error_response(str(e))

    def send_error_response(self, message, code=500):
        self.send_response(code)
        self.send_header('Content-Type', 'application/json')
        self.end_headers()
        self.wfile.write(json.dumps({"success": False, "error": message}).encode('utf-8'))

if __name__ == "__main__":
    server = HTTPServer(("0.0.0.0", PORT), BulbHandler)
    print(f"API e Website rodando em http://localhost:{PORT}")
    print(f"Lâmpada configurada para o IP: {LAMP_IP}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nServidor finalizado.")
