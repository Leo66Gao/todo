#!/bin/sh
# Builds Todo File Opener and installs it in ~/Applications (needs Xcode's
# command line tools: xcode-select --install). Run it again to update.
set -e
cd "$(dirname "$0")"
app="$HOME/Applications/Todo File Opener.app"
rm -rf "$app"
mkdir -p "$app/Contents/MacOS"
cp Info.plist "$app/Contents/Info.plist"
swiftc -O main.swift -o "$app/Contents/MacOS/TodoFileOpener"
codesign --force --sign - "$app"
/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister -f "$app"
echo "Installed $app"
