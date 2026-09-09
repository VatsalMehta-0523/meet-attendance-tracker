"""Regenerates alarm.wav — a synthesized siren-style alert tone.

No third-party dependencies (uses only the stdlib `wave` module). Run with:

    tools\\.venv\\Scripts\\python tools\\generate_alarm.py   (Windows)
    tools/.venv/bin/python tools/generate_alarm.py           (macOS/Linux)
"""

import math
import struct
import wave
from pathlib import Path

OUT_PATH = Path(__file__).resolve().parent.parent / "alarm.wav"
SAMPLE_RATE = 44100


def tone(freq, duration, volume=0.9, fade=0.01):
    n = int(SAMPLE_RATE * duration)
    fade_n = max(1, int(SAMPLE_RATE * fade))
    samples = []
    for i in range(n):
        t = i / SAMPLE_RATE
        env = 1.0
        if i < fade_n:
            env = i / fade_n
        elif i > n - fade_n:
            env = (n - i) / fade_n
        samples.append(math.sin(2 * math.pi * freq * t) * volume * env)
    return samples


def silence(duration):
    return [0.0] * int(SAMPLE_RATE * duration)


def beep_pair():
    return tone(1000, 0.15, 0.95) + silence(0.05) + tone(1300, 0.15, 0.95) + silence(0.08)


def main():
    samples = []
    for _ in range(4):
        samples += beep_pair()

    frames = bytearray()
    for s in samples:
        s = max(-1.0, min(1.0, s))
        frames += struct.pack("<h", int(s * 32767))

    with wave.open(str(OUT_PATH), "w") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(SAMPLE_RATE)
        wf.writeframes(bytes(frames))

    print(f"alarm.wav written to {OUT_PATH} ({len(samples) / SAMPLE_RATE:.2f}s)")


if __name__ == "__main__":
    main()
