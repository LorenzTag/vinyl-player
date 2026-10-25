#!/usr/bin/env python3
"""Lokaler Dev-Server für den Vinyl Player.

Liefert den Projektordner statisch aus, ist im WLAN erreichbar (bindet an
0.0.0.0) und verbietet Caching, damit Safari auf dem iPad nach jeder Änderung
die aktuellen Module lädt.

Start:  python3 dev-server.py [port]     (Standard-Port: 8080)
"""

import functools
import http.server
import os
import socket
import subprocess
import sys

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8080
ROOT = os.path.dirname(os.path.abspath(__file__))


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    extensions_map = {
        **http.server.SimpleHTTPRequestHandler.extensions_map,
        ".js": "text/javascript",
        ".mjs": "text/javascript",
        ".css": "text/css",
        ".svg": "image/svg+xml",
        ".webmanifest": "application/manifest+json",
    }

    def end_headers(self):
        self.send_header("Cache-Control", "no-store, max-age=0")
        super().end_headers()

    def send_head(self):
        # Bedingte Anfragen ignorieren: immer frische Dateien statt 304.
        for header in ("If-Modified-Since", "If-None-Match"):
            if header in self.headers:
                del self.headers[header]
        return super().send_head()

    def log_request(self, code="-", size="-"):
        # Nur Auffälliges loggen: Fehler und den ersten Abruf eines neuen Geräts.
        client = self.client_address[0]
        status = int(code) if str(code).isdigit() else 0
        if client not in SEEN_CLIENTS and client != "127.0.0.1":
            SEEN_CLIENTS.add(client)
            sys.stderr.write(f"  Neues Gerät verbunden: {client}\n")
        if status >= 400 and not self.path.startswith("/favicon"):
            sys.stderr.write(f"  {status}  {self.path}\n")

    def log_error(self, fmt, *args):
        pass  # wird über log_request gemeldet


SEEN_CLIENTS = set()


def lan_ips():
    """Mögliche WLAN/LAN-Adressen des Mac (en0/en1 bevorzugt)."""
    found = []
    for iface in ("en0", "en1"):
        try:
            ip = subprocess.run(["ipconfig", "getifaddr", iface], capture_output=True, text=True, timeout=2).stdout.strip()
        except (OSError, subprocess.SubprocessError):
            ip = ""
        if ip and ip not in found:
            found.append(ip)
    if not found:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        try:
            s.connect(("10.255.255.255", 1))  # sendet nichts, wählt nur die Route
            found.append(s.getsockname()[0])
        except OSError:
            pass
        finally:
            s.close()
    return found


def main():
    handler = functools.partial(NoCacheHandler, directory=ROOT)
    try:
        server = http.server.ThreadingHTTPServer(("0.0.0.0", PORT), handler)
    except OSError as err:
        sys.exit(f"Port {PORT} ist belegt ({err}). Anderen Port wählen: python3 dev-server.py 8081")

    print("\n  Vinyl Player – Dev-Server läuft\n")
    print(f"  Mac:   http://127.0.0.1:{PORT}")
    for ip in lan_ips():
        print(f"  iPad:  http://{ip}:{PORT}   (gleiches WLAN)")
    print("\n  Beenden mit Ctrl+C\n", flush=True)

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n  Server beendet.")
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
