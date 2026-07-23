#!/bin/sh
set -eu

reward=0
if [ -f /app/grain-canary.txt ] \
  && [ "$(cat /app/grain-canary.txt)" = "grain-harbor-ok" ] \
  && [ "$(find /app -mindepth 1 -maxdepth 1 -type f | wc -l | tr -d ' ')" = "1" ]; then
  reward=1
fi

printf '%s\n' "$reward" > /logs/verifier/reward.txt
