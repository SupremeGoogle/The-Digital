#!/bin/sh
# Installed root-owned at /usr/local/sbin/digital-todo-update.
set -eu
umask 022
base=/opt/digital-todo
repo=$base/repository
exec 9>/run/lock/digital-todo-update.lock
flock -n 9 || exit 0
cd "$repo"
git fetch --quiet origin main
revision=$(git rev-parse origin/main)
release=$base/releases/$revision
previous=''
if [ -d "$base/current" ]; then previous=$(readlink -f "$base/current"); fi
if [ "$previous" = "$release" ]; then exit 0; fi
mkdir -p "$release"
# Sparse checkout avoids downloading the unrelated large promo video.
# This root-owned checkout contains no editable files or production secrets.
if [ -n "$(git status --porcelain)" ]; then
  echo 'Deployment checkout has local changes; update stopped.' >&2
  exit 1
fi
git -c advice.detachedHead=false checkout --quiet --detach "$revision"
tar -cf - index.html favicon.svg css js server | tar -x -C "$release"
# Tests use fake providers and never read production credentials.
npm test --prefix "$release/server"
ln -s "$release" "$base/current.next"
mv -Tf "$base/current.next" "$base/current"
systemctl restart digital-todo-assistant
healthy=false
for attempt in 1 2 3 4 5; do
  if curl --silent --fail http://127.0.0.1:8787/health >/dev/null; then healthy=true; break; fi
  sleep 1
done
if [ "$healthy" != true ]; then
  if [ -n "$previous" ] && [ -d "$previous" ]; then
    ln -s "$previous" "$base/current.rollback"
    mv -Tf "$base/current.rollback" "$base/current"
    systemctl restart digital-todo-assistant
  fi
  echo 'Digital To-Do health check failed; previous release restored.' >&2
  exit 1
fi
echo "Digital To-Do deployed: $revision"
