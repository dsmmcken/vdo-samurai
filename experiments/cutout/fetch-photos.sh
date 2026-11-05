#!/bin/sh
# Downloads the test portraits (Wikimedia Commons, public domain / CC, and
# MediaPipe's sample) into photos/, and the model.
cd "$(dirname "$0")" && mkdir -p photos
for n in Kamala_Harris_Vice_Presidential_Portrait.jpg Malala_Yousafzai_at_Girl_Summit_2014.jpg \
  Lionel_Messi_20180626.jpg Serena_Williams_at_2013_US_Open.jpg Albert_Einstein_Head.jpg; do
  out=$(printf %s "$n" | tr -c 'A-Za-z0-9.' '_')
  [ -f "photos/$out" ] || curl -sSL -A "vdo-samurai-cutout-experiment/1.0" -o "photos/$out" "https://commons.wikimedia.org/wiki/Special:FilePath/$n?width=640"
  sleep 1
done
[ -f photos/portrait.jpg ] || curl -sSL -o photos/portrait.jpg https://storage.googleapis.com/mediapipe-assets/portrait.jpg
