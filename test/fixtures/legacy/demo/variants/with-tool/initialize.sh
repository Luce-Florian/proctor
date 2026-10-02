#!/usr/bin/env bash
# Installs an external plugin, as the caveman variants do.
set -euo pipefail

claude plugin marketplace add owner/tool --scope local
claude plugin install tool@tool --scope local -y
