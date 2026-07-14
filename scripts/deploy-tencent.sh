#!/usr/bin/env bash
set -Eeuo pipefail

SERVER="${TENCENT_SERVER:-ubuntu@175.24.138.38}"
REMOTE_DEPLOY="${TENCENT_DEPLOY_SCRIPT:-/opt/salesdaywork/deploy.sh}"

echo "Deploying GitHub main to ${SERVER}..."
ssh -o ConnectTimeout=10 "${SERVER}" "sudo ${REMOTE_DEPLOY}"

echo "Verifying public endpoint..."
curl -fsS "http://175.24.138.38/api/health"
echo
