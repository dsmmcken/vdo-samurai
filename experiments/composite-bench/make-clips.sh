#!/usr/bin/env bash
# Generates 8 distinct 2-minute 1080p30 H.264 + AAC test clips into clips/.
set -euo pipefail
cd "$(dirname "$0")"
mkdir -p clips
for i in 0 1 2 3 4 5 6 7; do
  ffmpeg -hide_banner -loglevel error -y \
    -f lavfi -i "testsrc2=size=1920x1080:rate=30,hue=h=$((i * 45)),noise=alls=10:allf=t" \
    -f lavfi -i "sine=frequency=$((220 + i * 55)):sample_rate=48000" \
    -t 120 -c:v libx264 -preset veryfast -profile:v high -pix_fmt yuv420p -b:v 6M -maxrate 8M -bufsize 12M -g 60 \
    -c:a aac -b:a 128k -ac 2 -movflags +faststart "clips/clip$i.mp4" &
done
wait
ls -la clips
