#!/bin/sh
# Downloads the test portraits (Wikimedia Commons, public domain / CC) into faces/.
cd "$(dirname "$0")" && mkdir -p faces
for n in Albert_Einstein_Head.jpg Kamala_Harris_Vice_Presidential_Portrait.jpg Malala_Yousafzai_at_Girl_Summit_2014.jpg \
  "Mahatma-Gandhi,_studio,_1931.jpg" Ada_Lovelace_portrait.jpg Lionel_Messi_20180626.jpg Serena_Williams_at_2013_US_Open.jpg; do
  out=$(printf %s "$n" | tr -c 'A-Za-z0-9.' '_')
  [ -f "faces/$out" ] || curl -sSL -A "vdo-samurai-face-experiment/1.0" -o "faces/$out" "https://commons.wikimedia.org/wiki/Special:FilePath/$n?width=640"
  sleep 1
done
curl -sSL -o portrait.jpg https://storage.googleapis.com/mediapipe-assets/portrait.jpg
curl -sSL -o blaze_face_short_range.tflite https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite
