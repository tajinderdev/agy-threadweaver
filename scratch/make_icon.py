import struct
import zlib
import math
import os

width = 128
height = 128
raw_data = bytearray()

for y in range(height):
    raw_data.append(0) # Filter type 0 (None)
    for x in range(width):
        dx = x - 64
        dy = y - 64
        dist = math.sqrt(dx*dx + dy*dy)

        # Base background - sleek dark Antigravity theme
        if dist > 60:
            r, g, b, a = 0, 0, 0, 0 # Transparent outside circle
        elif dist > 58:
            r, g, b, a = 45, 120, 255, 200 # Subtle outer ring
        else:
            # Radial dark background gradient
            factor = 1.0 - (dist / 60.0) * 0.4
            r = int(22 * factor)
            g = int(27 * factor)
            b = int(34 * factor)
            a = 255

            # Thread weaver lines (crossing curves)
            wave1 = abs(dy - math.sin(dx / 12.0) * 16.0)
            wave2 = abs(dy + math.sin(dx / 12.0) * 16.0)
            wave3 = abs(dx - math.sin(dy / 12.0) * 16.0)

            if wave1 < 3.5:
                # Blue/cyan thread
                r, g, b = 64, 180, 255
            elif wave2 < 3.5:
                # Purple/violet thread
                r, g, b = 180, 100, 255
            elif wave3 < 2.5:
                # Golden core thread
                r, g, b = 255, 200, 80

            # Central glowing node
            if dist < 8:
                r, g, b = 255, 255, 255
            elif dist < 12:
                r, g, b = 100, 220, 255

        raw_data.extend([r, g, b, a])

def make_chunk(chunk_type, data):
    return struct.pack('>I', len(data)) + chunk_type + data + struct.pack('>I', zlib.crc32(chunk_type + data) & 0xffffffff)

png_bytes = b'\x89PNG\r\n\x1a\n'
png_bytes += make_chunk(b'IHDR', struct.pack('>IIBBBBB', width, height, 8, 6, 0, 0, 0))
png_bytes += make_chunk(b'IDAT', zlib.compress(bytes(raw_data)))
png_bytes += make_chunk(b'IEND', b'')

out_path = os.path.join('assets', 'icons', 'icon.png')
os.makedirs(os.path.dirname(out_path), exist_ok=True)
with open(out_path, 'wb') as f:
    f.write(png_bytes)

print('Generated icon at:', out_path, 'Size:', len(png_bytes), 'bytes')
