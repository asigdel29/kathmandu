#!/bin/sh
# Download the two CC0 source packs the character build needs and unpack them under <dir>:
#   <dir>/ubc  Quaternius "Universal Base Characters" (Standard, free)  https://quaternius.itch.io/universal-base-characters
#   <dir>/ual  Quaternius "Universal Animation Library" (Standard)       https://opengameart.org/content/universal-animation-library
# usage: sh tools/characters/fetch.sh <dir>
set -eu
DIR=${1:?usage: fetch.sh <dir>}
mkdir -p "$DIR"
cd "$DIR"

# Animation library: direct file on OpenGameArt.
if [ ! -d ual ]; then
  curl -fsSL -o ual.zip https://opengameart.org/sites/default/files/universal_animation_librarystandard.zip
  mkdir ual && unzip -q ual.zip -d ual
fi

# Base characters: itch.io hands out the file through a short-lived URL (the free "Standard" zip needs no account).
if [ ! -d ubc ]; then
  SLUG=universal-base-characters
  HOST=https://quaternius.itch.io
  JAR=$(mktemp)
  token() { sed -n 's/.*name="csrf_token" value="\([^"]*\)".*/\1/p' "$1" | head -1; }
  curl -fsSL -c "$JAR" -b "$JAR" "$HOST/$SLUG" -o page.html
  DL=$(curl -fsS -c "$JAR" -b "$JAR" -X POST --data-urlencode "csrf_token=$(token page.html)" \
    -H 'X-Requested-With: XMLHttpRequest' "$HOST/$SLUG/download_url" | sed -n 's/.*"url":"\([^"]*\)".*/\1/p' | sed 's#\\/#/#g')
  curl -fsSL -c "$JAR" -b "$JAR" "$DL" -o dl.html
  UPLOAD=$(sed -n 's/.*data-upload_id="\([0-9]*\)".*/\1/p' dl.html | head -1)
  URL=$(curl -fsS -c "$JAR" -b "$JAR" -X POST --data-urlencode "csrf_token=$(token dl.html)" \
    -H 'X-Requested-With: XMLHttpRequest' "$HOST/$SLUG/file/$UPLOAD?source=game_download" | sed -n 's/.*"url":"\([^"]*\)".*/\1/p' | sed 's#\\/#/#g')
  curl -fsSL -o ubc.zip "$URL"
  mkdir ubc && unzip -q ubc.zip -d ubc
  rm -f "$JAR" page.html dl.html
fi
echo "ready: $DIR/ubc and $DIR/ual"
