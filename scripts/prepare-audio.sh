#!/usr/bin/env bash
# Turns the raw recordings in Sounds/ into the game's sound files in src/assets/sounds/.
#
#   scripts/prepare-audio.sh
#
# Needs ffmpeg (with libmp3lame) and awk. The raw files are only read, never changed or deleted.
# Re-run it after replacing a recording; it overwrites the processed files it makes.
#
# To add a gun or a surface, add a line at the bottom:
#   gun <id> <full-auto burst recording> <reload recording> <seconds where the burst's echo has died away>
#   footsteps <surface> <continuous walking recording>
# Then add the sound bank entries in src/core/audio/sounds.ts.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$ROOT/Sounds"
OUT="$ROOT/src/assets/sounds"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

RATE=44100
# Peak level every processed file is brought up to, in dBFS.
PEAK=-1
# Footsteps: clips per surface, length and lead-in before the step's attack, in seconds.
STEP_COUNT=8
STEP_LENGTH=0.30
STEP_LEAD=0.02

ff() { ffmpeg -nostdin -hide_banner -v error -y "$@"; }

# envelope <file> <filters> <window samples>: prints "time level_dB" per window (mono mix, after filters).
envelope() {
  ff -i "$1" -vn -af "aformat=channel_layouts=mono,$2,asetnsamples=n=$3:p=0,astats=metadata=1:reset=1,ametadata=print:key=lavfi.astats.Overall.RMS_level:file=$TMP/env.txt" -f null -
  awk '/pts_time/ { split($0, a, "pts_time:"); t = a[2] }
       /RMS_level/ { split($0, b, "="); v = (b[2] == "-inf") ? -120 : b[2]; printf "%.4f %.2f\n", t, v }' "$TMP/env.txt"
}

# onsets <rise dB> <floor dB> <min gap s> <look-back s>: reads an envelope, prints "start peak_dB" per attack.
# An attack is a jump of at least <rise> dB over the quietest level in the last <look-back> seconds, within
# <floor> dB of the loudest point in the file. Its start is where the level began to climb.
onsets() {
  awk -v rise="$1" -v floor="$2" -v gap="$3" -v back="$4" '
    BEGIN { max = -200 }
    { t[NR] = $1; v[NR] = $2; if ($2 > max) max = $2 }
    END {
      dt = t[2] - t[1]; nb = int(back / dt + 0.5); last = -1e9
      for (i = nb + 1; i <= NR; i++) {
        lo = 1e9; for (k = i - nb; k < i; k++) if (v[k] < lo) lo = v[k]
        if (v[i] - lo < rise || v[i] <= max - floor || t[i] - last < gap) continue
        s = i; while (s > 1 && v[s - 1] < v[s] && v[s - 1] > lo + 1) s--
        pk = v[i]; for (k = i; k <= i + int(0.03 / dt) && k <= NR; k++) if (v[k] > pk) pk = v[k]
        printf "%.4f %.2f\n", t[s], pk; last = t[i]
      }
    }'
}

# peak_of <file>: the file's peak level in dBFS.
peak_of() {
  ffmpeg -nostdin -hide_banner -nostats -i "$1" -af astats -f null - 2>&1 |
    awk '/Overall/ { o = 1 } o && /Peak level dB/ { print $NF; exit }'
}

# rms_of <file>: the file's RMS level in dBFS.
rms_of() {
  ffmpeg -nostdin -hide_banner -nostats -i "$1" -af astats -f null - 2>&1 |
    awk '/Overall/ { o = 1 } o && /RMS level dB/ { print $NF; exit }'
}

# duration_of <file>: length in seconds.
duration_of() { ffprobe -v error -show_entries format=duration -of csv=p=0 "$1"; }

# cut <in> <start s> <end s> <fade-in s> <fade-out s> <channels> <out.wav>: a clip with fades at both ends.
cut() {
  local length; length=$(awk -v a="$2" -v b="$3" 'BEGIN { printf "%.4f", b - a }')
  local fade_start; fade_start=$(awk -v l="$length" -v f="$5" 'BEGIN { printf "%.4f", l - f }')
  # Trimmed from a full decode: seeking into an MP3 starts with a frame of silence.
  ff -i "$1" -vn -ac "$6" -ar "$RATE" \
    -af "atrim=start=$2:end=$3,asetpts=PTS-STARTPTS,afade=t=in:st=0:d=$4:curve=qsin,afade=t=out:st=$fade_start:d=$5:curve=qsin" \
    -c:a pcm_s16le "$7"
}

# encode <in.wav> <gain dB> <channels> <out.mp3>: applies the gain, trims leading silence, writes the MP3.
encode() {
  mkdir -p "$(dirname "$4")"
  ff -i "$1" -vn -ac "$3" -ar "$RATE" \
    -af "volume=${2}dB,silenceremove=start_periods=1:start_threshold=-60dB:start_silence=0" \
    -c:a libmp3lame -q:a 2 "$4"
  echo "  $(basename "$(dirname "$4")")/$(basename "$4")  $(printf '%.3f' "$(duration_of "$4")") s"
}

# gun <id> <burst> <reload> <tail end s>
# Four single shots from the burst (each up to the next shot), the last shot plus its echo, and the reload.
gun() {
  local id="$1" burst="$2" reload="$3" tail_end="$4"
  local dir="$OUT/weapons/$id"
  echo "weapon $id"
  # Shot attacks are bright; a high-pass keeps the room ring between shots from hiding them.
  envelope "$burst" "highpass=f=3000,highpass=f=3000" 88 | onsets 10 12 0.045 0.02 > "$TMP/shots.txt"
  local shots; shots=$(wc -l < "$TMP/shots.txt" | tr -d ' ')
  if [ "$shots" -lt 6 ]; then echo "  found only $shots shots in $burst" >&2; exit 1; fi
  echo "  $shots shots at: $(awk '{ printf "%s ", $1 }' "$TMP/shots.txt")"
  local starts=($(awk '{ print $1 }' "$TMP/shots.txt"))

  # Spread the picks over the burst so they differ (later shots carry more room ring), skipping the first
  # (no ring under it) and the last (it starts the tail).
  local picks=() k
  for k in 0 1 2 3; do picks+=($(awk -v k="$k" -v n="$shots" 'BEGIN { printf "%d", 1 + k * (n - 3) / 3 + 0.5 }')); done
  local loudest=-200 n=1 p
  for p in "${picks[@]}"; do
    local from to
    from=$(awk -v t="${starts[$p]}" 'BEGIN { printf "%.4f", t - 0.002 }')
    to=$(awk -v t="${starts[$((p + 1))]}" 'BEGIN { printf "%.4f", t - 0.003 }')
    cut "$burst" "$from" "$to" 0.002 0.008 2 "$TMP/fire_$n.wav"
    loudest=$(awk -v a="$loudest" -v b="$(peak_of "$TMP/fire_$n.wav")" 'BEGIN { print (b > a) ? b : a }')
    n=$((n + 1))
  done
  local last="${starts[$((shots - 1))]}"
  local from; from=$(awk -v t="$last" 'BEGIN { printf "%.4f", t - 0.002 }')
  local fade; fade=$(awk -v a="$from" -v b="$tail_end" 'BEGIN { printf "%.4f", (b - a) * 0.45 }')
  cut "$burst" "$from" "$tail_end" 0.002 "$fade" 2 "$TMP/fire_tail.wav"

  # One gain for all shots and the tail, so they keep their natural differences and match each other.
  local gain; gain=$(awk -v p="$loudest" -v t="$PEAK" 'BEGIN { printf "%.2f", t - p }')
  for n in 1 2 3 4; do encode "$TMP/fire_$n.wav" "$gain" 2 "$dir/fire_0$n.mp3"; done
  encode "$TMP/fire_tail.wav" "$gain" 2 "$dir/fire_tail.mp3"

  ff -i "$reload" -vn -ac 2 -ar "$RATE" -c:a pcm_s16le "$TMP/reload.wav"
  encode "$TMP/reload.wav" "$(awk -v p="$(peak_of "$TMP/reload.wav")" -v t="$PEAK" 'BEGIN { printf "%.2f", t - p }')" 2 "$dir/reload.mp3"
}

# footsteps <surface> <recording>
# Eight clean single steps of similar loudness, each normalized to the same level, mono.
footsteps() {
  local surface="$1" source="$2"
  local dir="$OUT/footsteps/$surface"
  echo "footsteps $surface"
  envelope "$source" "highpass=f=150" 480 | onsets 10 25 0.2 0.06 > "$TMP/steps.txt"
  local total; total=$(duration_of "$source")
  # Clean steps have no other attack just before them or inside the clip. Of those, keep the ones
  # closest to the median loudness, in recording order.
  awk -v len="$STEP_LENGTH" -v lead="$STEP_LEAD" -v total="$total" -v want="$STEP_COUNT" '
    { t[NR] = $1; p[NR] = $2 }
    END {
      for (i = 1; i <= NR; i++) {
        prev = (i > 1) ? t[i] - t[i - 1] : 1; next_ = (i < NR) ? t[i + 1] - t[i] : total - t[i]
        if (prev >= 0.25 && next_ >= len + 0.02 && t[i] >= lead) { n++; ct[n] = t[i]; cp[n] = p[i] }
      }
      for (i = 1; i <= n; i++) sorted[i] = cp[i]
      for (i = 2; i <= n; i++) for (j = i; j > 1 && sorted[j - 1] > sorted[j]; j--) { x = sorted[j]; sorted[j] = sorted[j - 1]; sorted[j - 1] = x }
      median = sorted[int((n + 1) / 2)]
      for (i = 1; i <= n; i++) d[i] = (cp[i] > median) ? cp[i] - median : median - cp[i]
      for (k = 1; k <= want && k <= n; k++) {
        best = 0; for (i = 1; i <= n; i++) if (!used[i] && (best == 0 || d[i] < d[best])) best = i
        used[best] = 1
      }
      for (i = 1; i <= n; i++) if (used[i]) printf "%.4f %.2f\n", ct[i], cp[i]
    }' "$TMP/steps.txt" > "$TMP/picked.txt"
  local count; count=$(wc -l < "$TMP/picked.txt" | tr -d ' ')
  if [ "$count" -lt "$STEP_COUNT" ]; then echo "  found only $count clean steps in $source" >&2; exit 1; fi
  echo "  steps at: $(awk '{ printf "%s ", $1 }' "$TMP/picked.txt")"

  local n=1 t
  for t in $(awk '{ print $1 }' "$TMP/picked.txt"); do
    local from to
    from=$(awk -v t="$t" -v l="$STEP_LEAD" 'BEGIN { printf "%.4f", t - l }')
    to=$(awk -v f="$from" -v l="$STEP_LENGTH" 'BEGIN { printf "%.4f", f + l }')
    cut "$source" "$from" "$to" 0.005 0.06 1 "$TMP/step_$n.wav"
    echo "$(rms_of "$TMP/step_$n.wav") $(peak_of "$TMP/step_$n.wav")" > "$TMP/step_$n.level"
    n=$((n + 1))
  done
  # Every step gets the same RMS level: the loudest one that keeps every step's peak under PEAK.
  local target; target=$(cat "$TMP"/step_*.level | awk -v t="$PEAK" '{ v = $1 + t - $2; if (NR == 1 || v < m) m = v } END { print m }')
  for n in $(seq 1 "$STEP_COUNT"); do
    local gain; gain=$(awk -v r="$(awk '{ print $1 }' "$TMP/step_$n.level")" -v t="$target" 'BEGIN { printf "%.2f", t - r }')
    encode "$TMP/step_$n.wav" "$gain" 1 "$dir/step_0$n.mp3"
  done
}

gun m4a1 "$SRC/weapons/M4A1/AR-Shooting.mp3" "$SRC/weapons/M4A1/AR-Reloading.mp4" 1.95
footsteps gravel "$SRC/Footsteps/Gravel footsteps.wav"
