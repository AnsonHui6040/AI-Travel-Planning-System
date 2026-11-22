#!/usr/bin/env bash
# T04 PASS 標準：docker build 成功；容器健康檢查回應 200；以非 root 執行；image 內沒有 .env 與 API key
set -euo pipefail

image="atps-web:verify"
name="atps-web-verify"
port="${VERIFY_PORT:-3200}"

cleanup() { docker rm -f "$name" >/dev/null 2>&1 || true; }
trap cleanup EXIT

docker build -f docker/Dockerfile -t "$image" .

user=$(docker run --rm --entrypoint id "$image" -u)
if [ "$user" = "0" ]; then
  echo "FAIL：容器以 root 執行" >&2
  exit 1
fi
echo "PASS：容器以 uid $user 執行"

env_files=$(docker run --rm --entrypoint sh "$image" -c 'find / -xdev \( -name ".env" -o -name ".env.*" \) ! -name ".env.example" 2>/dev/null' || true)
if [ -n "$env_files" ]; then
  echo "FAIL：image 內有 .env 檔：$env_files" >&2
  exit 1
fi
echo "PASS：image 內沒有 .env 檔"

# 常見 API key 格式：Anthropic、OpenAI、Google、Supabase secret 與 service role JWT
key_hits=$(docker run --rm --entrypoint sh "$image" -c \
  'grep -rIlE "sk-ant-[A-Za-z0-9_-]{20,}|sk-(proj-)?[A-Za-z0-9]{32,}|AIza[0-9A-Za-z_-]{35}|sb_secret_[A-Za-z0-9_-]{20,}|service_role" /app 2>/dev/null' || true)
if [ -n "$key_hits" ]; then
  echo "FAIL：image 內疑似含 API key：$key_hits" >&2
  exit 1
fi
echo "PASS：image 內搜尋不到 API key"

docker run -d --name "$name" -p "$port:3000" "$image" >/dev/null
for _ in $(seq 1 30); do
  status=$(docker inspect -f '{{.State.Health.Status}}' "$name")
  [ "$status" = "healthy" ] && break
  sleep 2
done
code=$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$port/api/health")
if [ "$code" != "200" ] || [ "$status" != "healthy" ]; then
  echo "FAIL：健康檢查 HTTP $code，容器狀態 $status" >&2
  exit 1
fi
echo "PASS：健康檢查 HTTP 200，容器狀態 healthy"
