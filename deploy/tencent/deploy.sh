#!/usr/bin/env bash
set -Eeuo pipefail

APP_ROOT="${APP_ROOT:-/opt/salesdaywork}"
DATA_DIR="${DATA_DIR:-/var/lib/salesdaywork}"
SERVICE_NAME="${SERVICE_NAME:-salesdaywork}"
REPOSITORY="${REPOSITORY:-Sean-xiang-dot/salesdaywork}"
RELEASE_REF="${RELEASE_REF:-main}"
KEEP_RELEASES="${KEEP_RELEASES:-5}"

if [[ "${EUID}" -ne 0 ]]; then
  echo "Please run this deploy script with sudo." >&2
  exit 1
fi

release_id="$(date -u +%Y%m%d%H%M%S)-${RANDOM}"
release_dir="${APP_ROOT}/releases/${release_id}"
archive_file="/tmp/salesdaywork-${release_id}.zip"
extract_dir="/tmp/salesdaywork-${release_id}"
previous_release="$(readlink -f "${APP_ROOT}/current" 2>/dev/null || true)"

cleanup() {
  rm -f "${archive_file}"
  rm -rf "${extract_dir}"
}
trap cleanup EXIT

install -d -o ubuntu -g ubuntu "${APP_ROOT}/releases" "${DATA_DIR}"

echo "Downloading ${REPOSITORY}@${RELEASE_REF}..."
curl -fsSL --http1.1 \
  "https://github.com/${REPOSITORY}/archive/${RELEASE_REF}.zip" \
  -o "${archive_file}"
mkdir -p "${extract_dir}"
unzip -q "${archive_file}" -d "${extract_dir}"
source_dir="$(find "${extract_dir}" -mindepth 1 -maxdepth 1 -type d | head -n 1)"

if [[ -z "${source_dir}" ]]; then
  echo "Downloaded archive does not contain an application directory." >&2
  exit 1
fi

mv "${source_dir}" "${release_dir}"
chown -R ubuntu:ubuntu "${release_dir}"

echo "Checking release ${release_id}..."
sudo -u ubuntu npm --prefix "${release_dir}" run check

ln -sfn "${release_dir}" "${APP_ROOT}/current.next"
mv -Tf "${APP_ROOT}/current.next" "${APP_ROOT}/current"

if ! systemctl restart "${SERVICE_NAME}"; then
  if [[ -n "${previous_release}" ]]; then
    ln -sfn "${previous_release}" "${APP_ROOT}/current"
    systemctl restart "${SERVICE_NAME}" || true
  fi
  echo "Service restart failed; restored the previous release." >&2
  exit 1
fi

healthy=false
for _ in {1..15}; do
  if curl -fsS "http://127.0.0.1:3000/api/health" >/dev/null; then
    healthy=true
    break
  fi
  sleep 1
done

if [[ "${healthy}" != "true" ]]; then
  if [[ -n "${previous_release}" ]]; then
    ln -sfn "${previous_release}" "${APP_ROOT}/current"
    systemctl restart "${SERVICE_NAME}" || true
  fi
  echo "Health check failed; restored the previous release." >&2
  exit 1
fi

mapfile -t old_releases < <(find "${APP_ROOT}/releases" -mindepth 1 -maxdepth 1 -type d -printf '%T@ %p\n' | sort -nr | tail -n "+$((KEEP_RELEASES + 1))" | cut -d' ' -f2-)
for old_release in "${old_releases[@]}"; do
  [[ "${old_release}" == "${previous_release}" ]] && continue
  rm -rf "${old_release}"
done

echo "Deployed ${release_id} successfully."
curl -fsS "http://127.0.0.1:3000/api/health"
echo
