#!/usr/bin/env bash
# 2026-11-17 : Metricove passe de metricove.antoinequarroz.ch à metricove.postmelo.ch (suite PostMelo).
# metricove.antoinequarroz.ch et social.antoinequarroz.ch redirigent (308) vers la nouvelle adresse.
# Usage depuis le Mac : git show origin/main:deploy/passer-sur-postmelo.sh | ssh antoine-vps bash
set -euo pipefail
NEW=metricove.postmelo.ch
OLD=metricove.antoinequarroz.ch
IP=179.237.65.71
if ! getent hosts "$NEW" | grep -q "$IP"; then
  echo "ERREUR : $NEW ne pointe pas encore sur $IP (DNS). Rien n'a changé."; exit 1
fi
F="$HOME/.config/antoinequarroz-vitrine/runtime/Caddyfile"
B="$F.bak-20261117-postmelo"
cp -p "$F" "$B"
python3 - "$F" "$OLD" "$NEW" <<'PY'
import re, sys
path, old, new = sys.argv[1:4]
lines = open(path).read().split("\n")
def block_end(i):
    depth = 0
    for j in range(i, len(lines)):
        depth += lines[j].count("{") - lines[j].count("}")
        if depth == 0:
            return j
    raise SystemExit("bloc non fermé")
idx = [i for i, l in enumerate(lines) if re.match(r"^" + re.escape(old) + r"\s*\{", l)]
if len(idx) != 1:
    raise SystemExit(f"bloc {old} introuvable ou en double: {idx}")
if any(re.match(r"^" + re.escape(new) + r"\s*\{", l) for l in lines):
    raise SystemExit(f"un bloc {new} existe déjà")
i = idx[0]; e = block_end(i)
lines[i] = lines[i].replace(old, new, 1)
lines = [l.replace(f"redir https://{old}{{uri}} 308", f"redir https://{new}{{uri}} 308") for l in lines]
lines[e+1:e+1] = ["", f"{old} {{", f"\tredir https://{new}{{uri}} 308", "}"]
with open(path, "w") as f:   # même fichier (inode gardé, il est monté dans Caddy)
    f.write("\n".join(lines))
PY
diff -u "$B" "$F" || true
if ! docker exec antoinequarroz-caddy caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null 2>&1; then
  cat "$B" > "$F"; echo "ERREUR : Caddyfile invalide, sauvegarde remise. Rien d'autre n'a changé."; exit 1
fi
docker exec antoinequarroz-caddy caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile
cp -p ~/metricove-v2/.env ~/metricove-v2/.env.bak-20261117-postmelo
sed -i "s#^PUBLIC_URL=.*#PUBLIC_URL=https://$NEW#" ~/metricove-v2/.env
cd ~/metricove-v2/deploy && docker compose -p metricove-v2 -f compose.social.yml up -d --force-recreate
sleep 25
echo "--- $NEW :"; curl -sI "https://$NEW/login" | head -1
echo "--- $OLD :"; curl -sI "https://$OLD/calendar" | grep -iE "^HTTP|^location"
echo "--- social :"; curl -sI "https://social.antoinequarroz.ch/calendar" | grep -iE "^HTTP|^location"
echo "OK. Retour arrière : cat $B > $F && docker exec antoinequarroz-caddy caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile && cp ~/metricove-v2/.env.bak-20261117-postmelo ~/metricove-v2/.env"
