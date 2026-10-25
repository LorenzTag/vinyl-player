#!/usr/bin/env python3
"""Erzeugt die App-Icons (Schallplatte auf Nussholz) als PNG – ohne Abhängigkeiten.

Aufruf:  python3 tools/make-icons.py
Ergebnis: icons/icon-180.png (Apple), icon-192.png, icon-512.png, icon-512-maskable.png
"""

import math
import os
import struct
import zlib

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "icons")


def hex_rgb(value):
    value = value.lstrip("#")
    return tuple(int(value[i:i + 2], 16) / 255 for i in (0, 2, 4))


def mix(a, b, t):
    return tuple(x + (y - x) * t for x, y in zip(a, b))


def clamp(v, lo=0.0, hi=1.0):
    return max(lo, min(hi, v))


def smoothstep(e0, e1, x):
    t = clamp((x - e0) / (e1 - e0))
    return t * t * (3 - 2 * t)


BG_CENTER = hex_rgb("#3d2919")
BG_EDGE = hex_rgb("#120c08")
VINYL = hex_rgb("#0f0d0c")
RIM = hex_rgb("#1e1a17")
LABEL = hex_rgb("#c9a063")
LABEL_DARK = hex_rgb("#a77f45")
HOLE = hex_rgb("#140d09")
SHEEN = hex_rgb("#fff0dc")


def pixel(x, y, size, disc_ratio):
    c = size / 2
    dx, dy = x + 0.5 - c, y + 0.5 - c
    r = math.hypot(dx, dy)
    theta = math.atan2(dy, dx)

    # Hintergrund: warmes Holz-Braun mit Lichtfleck oben
    bd = math.hypot(x + 0.5 - c, y + 0.5 - size * 0.32) / (size * 0.9)
    color = mix(BG_CENTER, BG_EDGE, clamp(bd))

    R = size * disc_ratio
    # weicher Schatten unter der Platte
    sr = math.hypot(dx, dy - size * 0.018)
    shadow = 1 - smoothstep(R * 0.92, R * 1.12, sr)
    color = mix(color, (0, 0, 0), shadow * 0.55)

    # Platte
    disc_cov = clamp(R - r + 0.5)
    if disc_cov > 0:
        u = r / R
        v = VINYL
        if 0.44 < u < 0.955:
            groove = 0.5 + 0.5 * math.sin(2 * math.pi * u / 0.018)
            v = mix(v, RIM, groove * 0.35)
            for gap in (0.58, 0.71, 0.84):
                if abs(u - gap) < 0.006:
                    v = mix(v, (1, 1, 1), 0.06)
            # Lichtreflex: zwei Keulen
            lobe = max(0.0, math.cos(2 * (theta + 0.75))) ** 10
            v = mix(v, SHEEN, lobe * 0.16)
        elif u >= 0.955:
            v = RIM
        color = mix(color, v, disc_cov)

        # Etikett
        L = R * 0.36
        label_cov = clamp(L - r + 0.5)
        if label_cov > 0:
            lab = mix(LABEL, LABEL_DARK, clamp(r / L) ** 2 * 0.6)
            if abs(r / L - 0.86) < 0.025:
                lab = mix(lab, LABEL_DARK, 0.8)
            color = mix(color, lab, label_cov)
            hole_cov = clamp(L * 0.09 - r + 0.5)
            color = mix(color, HOLE, hole_cov)

    return color


def render(size, disc_ratio):
    rows = []
    for y in range(size):
        row = bytearray(b"\x00")  # Filtertyp „None"
        for x in range(size):
            r, g, b = pixel(x, y, size, disc_ratio)
            row += bytes((round(clamp(r) * 255), round(clamp(g) * 255), round(clamp(b) * 255)))
        rows.append(bytes(row))
    return b"".join(rows)


def write_png(path, size, raw):
    def chunk(tag, data):
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)

    png = (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 2, 0, 0, 0))
        + chunk(b"IDAT", zlib.compress(raw, 9))
        + chunk(b"IEND", b"")
    )
    with open(path, "wb") as f:
        f.write(png)


def main():
    os.makedirs(OUT, exist_ok=True)
    # (Dateiname, Größe, Plattenradius relativ zur Kantenlänge)
    # maskable: Platte innerhalb der 80-%-Sicherheitszone
    for name, size, ratio in (
        ("icon-180.png", 180, 0.40),
        ("icon-192.png", 192, 0.40),
        ("icon-512.png", 512, 0.40),
        ("icon-512-maskable.png", 512, 0.33),
    ):
        write_png(os.path.join(OUT, name), size, render(size, ratio))
        print("  geschrieben:", os.path.join("icons", name))


if __name__ == "__main__":
    main()
