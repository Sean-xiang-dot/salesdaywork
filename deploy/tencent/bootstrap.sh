#!/usr/bin/env bash
set -Eeuo pipefail

APP_ROOT="${APP_ROOT:-/opt/salesdaywork}"
DATA_DIR="${DATA_DIR:-/var/lib/salesdaywork}"
LEGACY_ROOT="${LEGACY_ROOT:-/home/ubuntu/salesdaywork}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [[ "${EUID}" -ne 0 ]]; then
  echo "Please run this bootstrap script with sudo." >&2
  exit 1
fi

install -d -o ubuntu -g ubuntu "${APP_ROOT}/releases" "${DATA_DIR}"
install -m 0755 "${SCRIPT_DIR}/deploy.sh" "${APP_ROOT}/deploy.sh"

if [[ -d "${LEGACY_ROOT}/data" && ! -e "${DATA_DIR}/state.json" ]]; then
  cp -a "${LEGACY_ROOT}/data/." "${DATA_DIR}/"
  chown -R ubuntu:ubuntu "${DATA_DIR}"
fi

cat > /etc/systemd/system/salesdaywork.service <<'UNIT'
[Unit]
Description=Sales Daywork Node Service
After=network.target

[Service]
Type=simple
User=ubuntu
WorkingDirectory=/opt/salesdaywork/current
Environment=NODE_ENV=production
Environment=PORT=3000
Environment=DATA_DIR=/var/lib/salesdaywork
EnvironmentFile=-/etc/salesdaywork-version.env
EnvironmentFile=-/etc/salesdaywork.env
ExecStart=/usr/bin/node /opt/salesdaywork/current/server.mjs
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
UNIT

cat > /etc/nginx/sites-available/salesdaywork <<'NGINX'
server {
    listen 80 default_server;
    listen [::]:80 default_server;
    server_name _;

    client_max_body_size 10m;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
NGINX

ln -sfn /etc/nginx/sites-available/salesdaywork /etc/nginx/sites-enabled/salesdaywork
rm -f /etc/nginx/sites-enabled/default

systemctl daemon-reload
systemctl enable salesdaywork
nginx -t
systemctl reload nginx

echo "Tencent deployment runtime is ready."
echo "Run sudo ${APP_ROOT}/deploy.sh to publish the current GitHub main branch."
