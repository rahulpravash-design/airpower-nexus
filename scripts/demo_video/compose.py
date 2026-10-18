"""Mux the recorded walkthrough with its narration and burned-in subtitles.

    python3 scripts/demo_video/compose.py <dir with timeline.json>   ->  <dir>/airpower_demo.mp4
"""
import json
import subprocess
import sys
from pathlib import Path

out = Path(sys.argv[1] if len(sys.argv) > 1 else "demo-output").resolve()
meta = json.loads((out / "timeline.json").read_text())
scenes = meta["timeline"]


def ts(t: float) -> str:
    h, rem = divmod(t, 3600)
    m, s = divmod(rem, 60)
    return f"{int(h):02d}:{int(m):02d}:{int(s):02d},{int(round((s % 1) * 1000)) % 1000:03d}"


# captions use the written terms; the narration text spells some of them phonetically for the voice
CAPTION = {"C P sat": "CP-SAT", "O R Tools": "OR-Tools", "three D": "3D", "two six two five zero": "26250",
           "thirteen eighty five": "1385", "C-P-SAT": "CP-SAT", "O-R Tools": "OR-Tools",
           "two-six-two-five-zero": "26250", "thirteen eighty-five": "1385", "fourteen hundred": "1400"}


def caption(text: str) -> str:
    for k, v in CAPTION.items():
        text = text.replace(k, v)
    return text


# subtitles: split each narration into chunks of ~12 words spread over its voice duration
srt, n = [], 1
for sc in scenes:
    words = caption(sc["text"]).split()
    chunks = [" ".join(words[i:i + 11]) for i in range(0, len(words), 11)]
    per = sc["voice"] / len(chunks)
    for i, c in enumerate(chunks):
        a = sc["start"] + 0.25 + i * per
        srt.append(f"{n}\n{ts(a)} --> {ts(a + per)}\n{c}\n")
        n += 1
(out / "subs.srt").write_text("\n".join(srt), encoding="utf-8")

voiced = [sc for sc in scenes if sc.get("audio")]  # scenes without a clip are caption-only
cmd = ["ffmpeg", "-y", "-i", meta["video"]]
for sc in voiced:
    cmd += ["-i", sc["audio"]]
delays = ";".join(f"[{i + 1}:a]adelay={int((sc['start'] + 0.25) * 1000)}:all=1[a{i}]" for i, sc in enumerate(voiced))
mix = "".join(f"[a{i}]" for i in range(len(voiced)))
style = "FontName=DejaVu Sans,FontSize=11,PrimaryColour=&H00FFFFFF,BackColour=&H99000000,BorderStyle=4,Outline=0,MarginV=18"
filt = (f"{delays};{mix}amix=inputs={len(voiced)}:normalize=0,loudnorm=I=-16:TP=-1.5[aout];"
        f"[0:v]subtitles={out / 'subs.srt'}:force_style='{style}',format=yuv420p[vout]")
end = scenes[-1]["end"] + 1.0
cmd += ["-filter_complex", filt, "-map", "[vout]", "-map", "[aout]", "-t", f"{end:.2f}",
        "-c:v", "libx264", "-preset", "medium", "-crf", "22", "-r", "25", "-c:a", "aac", "-b:a", "160k",
        "-movflags", "+faststart", str(out / "airpower_demo.mp4")]
subprocess.run(cmd, check=True)
print("wrote", out / "airpower_demo.mp4", f"({end:.0f} s)")
