#!/bin/sh
# Copies the mod into the Herdr app's folder for a live trial. Herdr reloads a mod when
# a file inside its own mods folder changes; it does not follow a symlink out of it.
set -eu
cd "$(dirname "$0")/.."
rsync -a --delete --exclude gpui-kit.d.ts --exclude jsconfig.json mods/vscode-pets/ "${HERDR_APP_HOME:-$HOME/.config/herdr-app}/mods/vscode-pets/"
echo "synced mods/vscode-pets to ${HERDR_APP_HOME:-$HOME/.config/herdr-app}/mods/vscode-pets"
