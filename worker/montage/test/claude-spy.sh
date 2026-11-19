#!/bin/sh
# Espion de test (bac à sable) : note chaque appel de Claude Code, puis lance le vrai `claude` avec les mêmes arguments.
#   claude.bin = …/test/claude-spy.sh dans test/config.sandbox.json
# Journal : $CLAUDE_SPY_LOG (par défaut /tmp/mc/claude-calls.log), une ligne par appel :
#   <heure UTC> <appel|outil> <dossier courant> <arguments, coupés à 300 caractères>
# « appel » = une génération (-p) ; « outil » = --help, --version… (détection des drapeaux). check-video-run.mjs
# compte les « appel » : une édition à la main ne doit en ajouter aucun.
# CLAUDE_PROMPT_LOG (facultatif) : le prompt de chaque appel (lu sur l'entrée standard, où le worker l'écrit) y est
# ajouté en entier, précédé d'une ligne « === CLAUDE-PROMPT <heure UTC> <dossier courant> » ; check-video-run.mjs y
# vérifie par exemple que le prompt d'une régénération donne les titres d'avant et demande une idée différente.
# CLAUDE_FAKE=1 : pas de vrai Claude, une réponse jouée par mock-server.mjs (partition de la fixture score-basic),
# pour tester la chaîne sans payer ; CLAUDE_FAKE=slow : ne répond jamais (test du délai) ; CLAUDE_FAKE=bad : illisible.
LOG="${CLAUDE_SPY_LOG:-/tmp/mc/claude-calls.log}"
mkdir -p "$(dirname "$LOG")"
KIND=outil
for a in "$@"; do [ "$a" = "-p" ] && KIND=appel; done
printf '%s %s %s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$KIND" "$PWD" "$(printf '%s ' "$@" | tr '\n' ' ' | cut -c1-300)" >> "$LOG"
if [ "$KIND" = appel ] && [ -n "$CLAUDE_PROMPT_LOG" ] && [ ! -t 0 ]; then
  # Le prompt est gardé dans un fichier temporaire, recopié dans le journal, puis redonné tel quel à Claude sur son
  # entrée standard (le fichier est effacé tout de suite : le descripteur ouvert suffit, `exec` garde le même pid).
  TMP="$(mktemp "${TMPDIR:-/tmp}/claude-prompt.XXXXXX")" || exit 1
  cat > "$TMP"
  { printf '=== CLAUDE-PROMPT %s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$PWD"; cat "$TMP"; printf '\n'; } >> "$CLAUDE_PROMPT_LOG"
  exec < "$TMP"
  rm -f "$TMP"
fi
if [ -n "$CLAUDE_FAKE" ]; then
  exec node "$(dirname "$0")/mock-server.mjs" --fake-claude "$@"
fi
exec "${CLAUDE_REAL:-claude}" "$@"
