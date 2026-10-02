#!/bin/sh
# Stands in for `claude` in the adapter tests: records its arguments and environment, then replays a recorded
# stream-json file. `__PLUGIN_DIR__` in the stream is replaced by the first --plugin-dir argument, `__TOKEN__` by the
# credential it received, as an agent that printed its environment would. `plugin ...` calls also record their own env.
# The prompt, read on stdin, is recorded too.
# FAKE_CLAUDE_STREAM, FAKE_CLAUDE_RECORD and FAKE_CLAUDE_EXIT come from the test workspace environment.
if [ "$1" = "--version" ]; then echo "9.9.9 (Claude Code)"; exit 0; fi
if [ -n "$FAKE_CLAUDE_RECORD" ]; then
  printf '%s\n' "$@" >> "$FAKE_CLAUDE_RECORD.args"
  env >> "$FAKE_CLAUDE_RECORD.env"
  if [ "$1" = "plugin" ]; then env > "$FAKE_CLAUDE_RECORD.plugin-env"; fi
fi
if [ "$1" = "plugin" ] && [ "$2" = "marketplace" ]; then
  mkdir -p "$CLAUDE_CONFIG_DIR/plugins"
  echo '{"fake-market":{"source":{"source":"github","repo":"'"$4"'"}}}' > "$CLAUDE_CONFIG_DIR/plugins/known_marketplaces.json"
  exit 0
fi
if [ "$1" = "plugin" ]; then exit 0; fi
if [ -n "$FAKE_CLAUDE_RECORD" ]; then cat > "$FAKE_CLAUDE_RECORD.stdin"; fi
plugin_dir=""
while [ $# -gt 0 ]; do
  if [ "$1" = "--plugin-dir" ] && [ -z "$plugin_dir" ]; then plugin_dir="$2"; fi
  shift
done
sed -e "s#__PLUGIN_DIR__#$plugin_dir#g" -e "s#__TOKEN__#$CLAUDE_CODE_OAUTH_TOKEN#g" "$FAKE_CLAUDE_STREAM"
exit "${FAKE_CLAUDE_EXIT:-0}"
