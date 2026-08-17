"""Generate simple list-style PNG icons for the Chrome extension."""

from __future__ import annotations

import struct
import zlib
from pathlib import Path

NAVY = (29, 78, 216, 255)
WHITE = (255, 255, 255, 255)


def png_rgba(pixels: list[list[tuple[int, int, int, int]]]) -> bytes:
    height = len(pixels)
    width = len(pixels[0])
    raw = b""
    for row in pixels:
        raw += b"\x00"
        for r, g, b, a in row:
            raw += bytes((r, g, b, a))

    def chunk(tag: bytes, data: bytes) -> bytes:
        return (
            struct.pack(">I", len(data))
            + tag
            + data
            + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
        )

    ihdr = struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0)
    return b"".join(
        [
            b"\x89PNG\r\n\x1a\n",
            chunk(b"IHDR", ihdr),
            chunk(b"IDAT", zlib.compress(raw, 9)),
            chunk(b"IEND", b""),
        ]
    )


def draw_icon(size: int) -> list[list[tuple[int, int, int, int]]]:
    pixels = [[NAVY for _ in range(size)] for _ in range(size)]
    margin = max(2, size // 8)
    bar_h = max(1, size // 12)
    gap = max(2, size // 7)
    start = margin + max(1, size // 10)
    width = size - margin * 2
    for i in range(3):
        y0 = start + i * (bar_h + gap)
        for y in range(y0, min(size - margin, y0 + bar_h)):
            for x in range(margin, margin + width):
                pixels[y][x] = WHITE
    return pixels


def main() -> None:
    out_dir = Path(__file__).resolve().parent / "icons"
    out_dir.mkdir(exist_ok=True)
    for size in (16, 32, 48, 128):
        (out_dir / f"icon{size}.png").write_bytes(png_rgba(draw_icon(size)))
        print(f"wrote icon{size}.png")


if __name__ == "__main__":
    main()
