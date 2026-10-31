"""
serve_web.py
============
Server HTTP lokal & LAN untuk menjalankan aplikasi WebGIS LahanAman (EPSG:32749).
Akses di browser lokal : http://127.0.0.1:8000/Web/index.html
Akses dari perangkat lain (1 Wi-Fi/Hotspot): http://<IP-LAPTOP>:8000/Web/index.html
"""
import functools
import http.server
import json
import os
from pathlib import Path
import socket
import socketserver
import sys
import urllib.parse
import webbrowser

SCRIPTS_DIR = Path(__file__).resolve().parent
ROOT_DIR = SCRIPTS_DIR.parent
if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))

from spatial_loader import (
    cari_lokasi_backend,
    muat_data_spasial_server,
    query_spasial_titik_backend,
)

DEFAULT_PORTS = [int(os.getenv("PORT", "8000")), 8085, 8888, 5500, 3000]


def dapatkan_ip_lan():
    """Deteksi alamat IP lokal (Wi-Fi / LAN) laptop ini agar bisa diakses perangkat lain."""
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
            s.connect(("8.8.8.8", 80))
            return s.getsockname()[0]
    except Exception:
        return "127.0.0.1"


class LahanAmanHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Cache-Control", "no-cache")
        super().end_headers()

    def _kirim_json(self, payload, status_code=200):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status_code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        route = parsed.path

        if route in ("/", "/index.html"):
            self.send_response(302)
            self.send_header("Location", "/Web/index.html")
            self.end_headers()
            return

        if route == "/api/query":
            qs = urllib.parse.parse_qs(parsed.query)
            try:
                lat = float(qs.get("lat", ["-7.797068"])[0])
                lng = float(qs.get("lng", ["110.370529"])[0])
                dusun_hint = qs.get("dusun", [""])[0]
                hasil = query_spasial_titik_backend(lat, lng, dusun_hint=dusun_hint or None)
                self._kirim_json(hasil, 200)
            except Exception as e:
                self._kirim_json({"status": "error", "message": str(e)}, 400)
            return

        if route == "/api/search":
            qs = urllib.parse.parse_qs(parsed.query)
            q = qs.get("q", [""])[0]
            kab = qs.get("kab", ["ALL"])[0]
            zona = qs.get("zona", ["ALL"])[0]
            limit = int(qs.get("limit", ["60"])[0])
            try:
                hasil = cari_lokasi_backend(q=q, kab=kab, zona=zona, limit=limit)
                self._kirim_json(hasil, 200)
            except Exception as e:
                self._kirim_json({"status": "error", "message": str(e)}, 400)
            return

        super().do_GET()


if __name__ == "__main__":
    os.chdir(ROOT_DIR)
    muat_data_spasial_server()
    handler = functools.partial(LahanAmanHandler, directory=str(ROOT_DIR))
    socketserver.ThreadingTCPServer.allow_reuse_address = True
    ip_lan = dapatkan_ip_lan()

    for port in DEFAULT_PORTS:
        try:
            with socketserver.ThreadingTCPServer(("0.0.0.0", port), handler) as httpd:
                url_lokal = f"http://127.0.0.1:{port}/Web/index.html"
                url_lan = f"http://{ip_lan}:{port}/Web/index.html"
                print("=" * 65)
                print(f"[WEBGIS] Server aktif di laptop ini : {url_lokal}")
                print(f"[WEBGIS] Link untuk orang lain (1 Wi-Fi): {url_lan}")
                print(f"[PINGGY] Untuk share link ke rekan (beda jaringan), buka terminal baru & ketik:")
                print(f"         ssh -p 443 -R0:localhost:{port} a.pinggy.io")
                print("[WEBGIS] Tekan Ctrl+C untuk menghentikan server.")
                print("=" * 65)
                try:
                    webbrowser.open(url_lokal)
                except Exception:
                    pass
                httpd.serve_forever()
            break
        except OSError:
            continue



