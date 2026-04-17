"""Generate pixel cat GIF sprites for minipet-overlay"""
from PIL import Image, ImageDraw
import os

OUT = os.path.join(os.path.dirname(__file__), 'assets', 'pet')
os.makedirs(OUT, exist_ok=True)

SCALE = 8  # each pixel block = 8x8 real pixels
SIZE = 16  # sprite is 16x16 pixel blocks = 128x128 real pixels

# Colors
BG = (0, 0, 0, 0)  # transparent
BODY = (255, 167, 38)  # orange
DARK = (230, 126, 0)   # darker orange
WHITE = (255, 255, 255)
BLACK = (40, 40, 40)
PINK = (255, 150, 180)
BLUSH = (255, 200, 180, 128)

def make_frame(pixels):
    """Create a frame from a dict of {(x,y): color}"""
    img = Image.new('RGBA', (SIZE * SCALE, SIZE * SCALE), BG)
    draw = ImageDraw.Draw(img)
    for (x, y), color in pixels.items():
        if 0 <= x < SIZE and 0 <= y < SIZE:
            draw.rectangle([x*SCALE, y*SCALE, (x+1)*SCALE-1, (y+1)*SCALE-1], fill=color)
    return img

def base_cat(eye_open=True, mouth=None, tail_up=False, ear_tilt=0):
    """Draw a cute pixel cat, returns pixel dict"""
    p = {}
    # Body (round-ish)
    for x in range(5, 12):
        for y in range(8, 14):
            p[(x, y)] = BODY
    # Wider middle
    for x in range(4, 13):
        for y in range(9, 13):
            p[(x, y)] = BODY
    # Head
    for x in range(5, 12):
        for y in range(4, 9):
            p[(x, y)] = BODY
    for x in range(4, 13):
        for y in range(5, 8):
            p[(x, y)] = BODY
    # Ears
    p[(5, 3)] = BODY
    p[(5+ear_tilt, 2)] = BODY
    p[(11, 3)] = BODY
    p[(11-ear_tilt, 2)] = BODY
    # Inner ears
    p[(5, 3)] = PINK if ear_tilt == 0 else BODY
    p[(11, 3)] = PINK if ear_tilt == 0 else BODY
    # Eyes
    if eye_open:
        p[(6, 6)] = BLACK
        p[(10, 6)] = BLACK
        # Eye shine
        p[(6, 5)] = WHITE  # just make the cat cute
        p[(10, 5)] = WHITE
    else:
        p[(6, 6)] = DARK
        p[(10, 6)] = DARK
    # Nose
    p[(8, 7)] = PINK
    # Mouth
    if mouth == 'happy':
        p[(7, 8)] = DARK
        p[(9, 8)] = DARK
    elif mouth == 'open':
        p[(8, 8)] = PINK
        p[(7, 8)] = DARK
        p[(9, 8)] = DARK
    # Feet
    p[(5, 14)] = DARK
    p[(6, 14)] = DARK
    p[(10, 14)] = DARK
    p[(11, 14)] = DARK
    # Tail
    if tail_up:
        p[(13, 11)] = DARK
        p[(14, 10)] = DARK
        p[(14, 9)] = DARK
        p[(15, 8)] = DARK
    else:
        p[(13, 12)] = DARK
        p[(14, 12)] = DARK
        p[(15, 11)] = DARK
    # Belly (lighter)
    for x in range(6, 11):
        for y in range(10, 13):
            p[(x, y)] = WHITE
    return p

def make_sitting():
    """Sitting: blinks occasionally"""
    frames = []
    # 20 frames open, 2 frames closed
    for i in range(22):
        eye_open = i < 18 or i > 19
        tail_up = (i // 11) % 2 == 0
        px = base_cat(eye_open=eye_open, mouth='happy', tail_up=tail_up)
        frames.append(make_frame(px))
    return frames

def make_moving():
    """Moving: bouncing left and right"""
    frames = []
    offsets = [0, 0, -1, -1, 0, 0, 1, 1]
    bounces = [0, -1, -2, -1, 0, -1, -2, -1]
    for i in range(8):
        px = base_cat(eye_open=True, mouth='happy', tail_up=(i % 4 < 2))
        shifted = {}
        for (x, y), c in px.items():
            shifted[(x + offsets[i], y + bounces[i])] = c
        frames.append(make_frame(shifted))
    return frames

def make_sleeping():
    """Sleeping: closed eyes, zzz"""
    frames = []
    for i in range(12):
        px = base_cat(eye_open=False, tail_up=False)
        # Zzz animation
        phase = i % 6
        if phase < 3:
            px[(14, 4 - phase)] = BLACK
            if phase > 0:
                px[(13, 5 - phase)] = BLACK
        else:
            px[(13, 7 - phase)] = BLACK
            if phase > 3:
                px[(12, 8 - phase)] = BLACK
        # Slightly lower body (curled up)
        frames.append(make_frame(px))
    return frames

def make_eating():
    """Eating: mouth open/close, food bowl"""
    frames = []
    for i in range(8):
        mouth = 'open' if i % 2 == 0 else 'happy'
        px = base_cat(eye_open=True, mouth=mouth, tail_up=(i % 4 < 2))
        # Food bowl
        for x in range(2, 6):
            px[(x, 14)] = (139, 119, 101)  # brown bowl
            px[(x, 13)] = (139, 119, 101)
        for x in range(3, 5):
            px[(x, 12)] = (255, 200, 100)  # food
        # Slight lean forward
        frames.append(make_frame(px))
    return frames

def save_gif(frames, name, duration=150):
    path = os.path.join(OUT, f'{name}.gif')
    frames[0].save(
        path, save_all=True, append_images=frames[1:],
        loop=0, duration=duration, disposal=2,
        transparency=0
    )
    print(f'Saved {path} ({len(frames)} frames)')

save_gif(make_sitting(), 'sitting', duration=200)
save_gif(make_moving(), 'moving', duration=120)
save_gif(make_sleeping(), 'sleeping', duration=300)
save_gif(make_eating(), 'eating', duration=150)

print('Done!')
