#!/usr/bin/env bash
# 2026-11-17 : Metricove v2 passe de social.antoinequarroz.ch à metricove.antoinequarroz.ch.
# L'ancien Metricove Cockpit (/opt/metricove) perd seulement son domaine : ses fichiers et conteneurs restent.
# Usage depuis le Mac : git show origin/claude/project-thread-awat2v:deploy/passer-sur-metricove.sh | ssh antoine-vps bash
set -euo pipefail
F="$HOME/.config/antoinequarroz-vitrine/runtime/Caddyfile"
B="$F.bak-20261117-metricove-domain"
cp -p "$F" "$B"
python3 - "$F" <<'PY'
import re, sys
path = sys.argv[1]
lines = open(path).read().split("\n")
def block_end(i):
    depth = 0
    for j in range(i, len(lines)):
        depth += lines[j].count("{") - lines[j].count("}")
        if depth == 0 and j >= i:
            return j
    raise SystemExit("bloc non fermé")
old = [i for i, l in enumerate(lines) if re.match(r"^metricove\.antoinequarroz\.ch\s*\{", l)]
new = [i for i, l in enumerate(lines) if re.match(r"^social\.antoinequarroz\.ch\s*\{", l)]
if len(old) != 1 or len(new) != 1:
    raise SystemExit(f"blocs inattendus: metricove={old} social={new}")
o, n = old[0], new[0]
oe, ne = block_end(o), block_end(n)
lines[n] = lines[n].replace("social.antoinequarroz.ch", "metricove.antoinequarroz.ch", 1)
lines[ne+1:ne+1] = ["", "social.antoinequarroz.ch {", "\tredir https://metricove.antoinequarroz.ch{uri} 308", "}"]
for k in range(o, oe + 1):
    lines[k] = "# " + lines[k]
lines.insert(o, "# Ancien Metricove Cockpit (/opt/metricove), retiré du domaine le 2026-11-17, fichiers gardés")
with open(path, "w") as f:   # même fichier (inode gardé, il est monté dans Caddy)
    f.write("\n".join(lines))
PY
diff -u "$B" "$F" || true
if ! docker exec antoinequarroz-caddy caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null 2>&1; then
  cat "$B" > "$F"; echo "ERREUR : Caddyfile invalide, sauvegarde remise. Rien d'autre n'a changé."; exit 1
fi
docker exec antoinequarroz-caddy caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile
cp -p ~/metricove-v2/.env ~/metricove-v2/.env.bak-20261117
sed -i 's#^PUBLIC_URL=.*#PUBLIC_URL=https://metricove.antoinequarroz.ch#' ~/metricove-v2/.env
cd ~/metricove-v2/deploy && docker compose -p metricove-v2 -f compose.social.yml up -d --force-recreate
sleep 20
echo "--- metricove.* :"; curl -sI https://metricove.antoinequarroz.ch/login | head -1
echo "--- social.* :"; curl -sI https://social.antoinequarroz.ch/calendar | grep -iE "^HTTP|^location"
echo "OK. Retour arrière : cat $B > $F && docker exec antoinequarroz-caddy caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile"
