#!/usr/bin/env bash
# Synthesizes the mortar sounds (no recordings yet) into src/assets/sounds/effects/:
#   mortar_launch_01.mp3  a hollow low thump with a puff of noise (the shell leaving the tube)
#   mortar_whistle_01.mp3 a falling whistle, about 1.3 s (plays at the impact point before the shell lands)
#
#   scripts/synth-mortar-sounds.sh
#
# Needs ffmpeg with libmp3lame. Replace the files with real recordings any time; the sound bank picks them up by name.
set -euo pipefail

OUT="$(cd "$(dirname "$0")/.." && pwd)/src/assets/sounds/effects"
ff() { ffmpeg -nostdin -hide_banner -v error -y "$@"; }

# Thump: a sine dropping from about 70 Hz, a short low noise burst on top, low-passed and limited.
ff -f lavfi -i "aevalsrc='0.9*sin(2*PI*(70*t-35*t*t))*exp(-5*t)+0.6*(random(0)*2-1)*exp(-22*t)':s=44100:d=0.9" \
  -af "lowpass=f=700,lowpass=f=700,alimiter=limit=0.89,afade=t=out:st=0.6:d=0.3" \
  -ac 1 -codec:a libmp3lame -q:a 3 "$OUT/mortar_launch_01.mp3"

# Whistle: 2300 Hz falling to about 850 Hz over 1.3 s with a little wobble, swelling as it comes in.
ff -f lavfi -i "aevalsrc='(0.25+0.65*t/1.3)*min(1,t/0.25)*(sin(2*PI*(2300*t-557*t*t)+0.6*sin(2*PI*7*t))+0.15*sin(4*PI*(2300*t-557*t*t)))':s=44100:d=1.3" \
  -af "highpass=f=300,alimiter=limit=0.8,afade=t=out:st=1.24:d=0.06" \
  -ac 1 -codec:a libmp3lame -q:a 3 "$OUT/mortar_whistle_01.mp3"

echo "Wrote $OUT/mortar_launch_01.mp3 and $OUT/mortar_whistle_01.mp3"
