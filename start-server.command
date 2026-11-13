#!/bin/bash
# Double-click to serve the game locally (needed for MIDI clips and images).
# Leave this window open while you play; close it (or press Ctrl+C) to stop.
cd "$(dirname "$0")"
PORT=8000
URL="http://localhost:$PORT/index.html"

if xcrun --find python3 >/dev/null 2>&1 || [ -x /opt/homebrew/bin/python3 ] || [ -x /usr/local/bin/python3 ]; then
  echo "Serving the game at $URL"
  (sleep 1; open "$URL") &
  python3 -m http.server $PORT
elif command -v npx >/dev/null 2>&1; then
  echo "Serving the game at $URL"
  (sleep 2; open "$URL") &
  npx --yes http-server -p $PORT -c-1 .
else
  echo "No Python 3 or Node found."
  echo "Easiest fix: in Terminal run   xcode-select --install   (installs Python 3), then double-click this file again."
  echo "Or use the 'Live Server' extension in VS Code: right-click index.html > Open with Live Server."
  read -n 1 -s -r -p "Press any key to close."
fi
