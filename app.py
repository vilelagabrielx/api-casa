from http.server import BaseHTTPRequestHandler, HTTPServer
import json
from datetime import datetime

class Handler(BaseHTTPRequestHandler):

    def do_GET(self):
        self.send_response(200)
        self.send_header("Content-type", "application/json")
        self.end_headers()

        if self.path == "/api/status":
            response = {
                "status": "ok",
                "message": "API Python rodando no Termux",
                "time": str(datetime.now())
            }
        else:
            response = {"error": "rota não existe"}

        self.wfile.write(json.dumps(response).encode())

server = HTTPServer(("0.0.0.0", 4000), Handler)
print("API rodando na porta 4000")
server.serve_forever()
