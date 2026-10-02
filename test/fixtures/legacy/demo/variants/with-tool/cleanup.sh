#!/usr/bin/env bash
set -euo pipefail

claude plugin uninstall tool@tool --scope local
claude plugin marketplace remove tool --scope local
