#!/bin/sh
# Creates .env with random secrets (only once), then starts Postiz.
set -e
cd "$(dirname "$0")"
if [ ! -f .env ]; then
  cp .env.example .env
  sed -i "s|^JWT_SECRET=.*|JWT_SECRET=$(openssl rand -hex 32)|" .env
  sed -i "s|^POSTGRES_PASSWORD=.*|POSTGRES_PASSWORD=$(openssl rand -hex 16)|" .env
  sed -i "s|^TEMPORAL_DB_PASSWORD=.*|TEMPORAL_DB_PASSWORD=$(openssl rand -hex 16)|" .env
  chmod 600 .env
  echo ".env créé. Vérifie POSTIZ_DOMAIN dedans."
fi
docker compose up -d
echo "Postiz démarre (2 à 3 minutes). Puis ouvre https://$(grep ^POSTIZ_DOMAIN= .env | cut -d= -f2)"
