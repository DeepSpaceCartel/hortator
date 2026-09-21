#!/usr/bin/env python3
"""Draws media/icon.png (the Marketplace icon) with only the standard library.

Two usage bars with a steady-pace marker across them. Supersampled 4x for smooth edges.
Run from the repo root: python3 scripts/make-icon.py
"""
import struct
import zlib

SIZE = 256
SS = 4  # supersampling factor

BG = (27, 35, 48)
TRACK = (58, 69, 86)
FILL = (79, 209, 197)
MARKER = (245, 245, 245)


def in_rrect(x, y, x0, y0, x1, y1, r):
    """True if (x, y) is inside the rectangle with corner radius r."""
    if not (x0 <= x <= x1 and y0 <= y <= y1):
        return False
    cx = min(max(x, x0 + r), x1 - r)
    cy = min(max(y, y0 + r), y1 - r)
    return (x - cx) ** 2 + (y - cy) ** 2 <= r * r


BARS = [(76, 108, 120), (148, 180, 90)]  # (top, bottom, fill right edge)
TRACK_X0, TRACK_X1, BAR_R = 40, 216, 8
MARKER_BOX = (148, 52, 156, 204, 4)


def pixel(x, y):
    """Colour at a point in 256-space, or None where transparent."""
    if not in_rrect(x, y, 0, 0, SIZE, SIZE, 48):
        return None
    colour = BG
    for top, bottom, fill_right in BARS:
        if in_rrect(x, y, TRACK_X0, top, TRACK_X1, bottom, BAR_R):
            colour = FILL if x <= fill_right else TRACK
    if in_rrect(x, y, *MARKER_BOX):
        colour = MARKER
    return colour


def render():
    rows = []
    for py in range(SIZE):
        row = bytearray([0])  # PNG filter type 0
        for px in range(SIZE):
            r = g = b = a = 0
            for sy in range(SS):
                for sx in range(SS):
                    c = pixel(px + (sx + 0.5) / SS, py + (sy + 0.5) / SS)
                    if c:
                        r, g, b, a = r + c[0], g + c[1], b + c[2], a + 1
            n = SS * SS
            if a:
                row += bytes((r // a, g // a, b // a, round(255 * a / n)))
            else:
                row += bytes(4)
        rows.append(bytes(row))
    return b"".join(rows)


def chunk(kind, data):
    body = kind + data
    return struct.pack(">I", len(data)) + body + struct.pack(">I", zlib.crc32(body))


def write_png(path, raw):
    ihdr = struct.pack(">IIBBBBB", SIZE, SIZE, 8, 6, 0, 0, 0)
    with open(path, "wb") as f:
        f.write(b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr) + chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b""))


if __name__ == "__main__":
    write_png("media/icon.png", render())
