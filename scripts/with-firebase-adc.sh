#!/bin/bash
# Spustí příkaz (typicky Admin SDK skript) s Application Default Credentials
# z přihlášení firebase-tools — bez instalace gcloud (viz Známé pasti v CLAUDE.md,
# „Čerstvý sandbox bez gcloud/CLI přihlášení“). Dočasný soubor s tokenem se po
# doběhnutí smaže. Předtím: npx firebase-tools login --reauth
#
# Použití:
#   bash scripts/with-firebase-adc.sh node scripts/seed-rezervace.js
#   bash scripts/with-firebase-adc.sh node scripts/seed-rezervace.js --apply
#
# Spouští člověk ve svém terminálu, ne agent — skripty zapisují do produkce.
set -euo pipefail

TMP=$(mktemp)
trap 'rm -f "$TMP"' EXIT

python3 - "$TMP" <<'PY'
import json, os, sys
store = os.path.expanduser("~/.config/configstore/firebase-tools.json")
token = json.load(open(store)).get("tokens", {}).get("refresh_token")
if not token:
    sys.exit("Chybí přihlášení firebase-tools — spusť: npx firebase-tools login --reauth")
json.dump({
    # Veřejný OAuth klient firebase-tools (stejný princip jako gcloud).
    "client_id": "563584335869-fgrhgmd47bqnekij5i8b5pr03ho849e6.apps.googleusercontent.com",
    "client_secret": "j9iVZfS8kkCEFUPaAeJV0sAi",
    "refresh_token": token,
    "type": "authorized_user",
    "quota_project_id": "koupelny-navstevnost",
}, open(sys.argv[1], "w"))
PY

export GOOGLE_APPLICATION_CREDENTIALS="$TMP"
"$@"
