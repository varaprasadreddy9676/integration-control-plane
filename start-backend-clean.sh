#!/bin/sh

ROOT_DIR=$(cd "$(dirname "$0")" && pwd)
PID_FILE="${ROOT_DIR}/backend/supervisor.pid"
PORT="${PORT:-3545}"

echo "Stopping existing backend supervisor (if any)..."
if [ -f "${PID_FILE}" ]; then
  OLD_PID=$(cat "${PID_FILE}")
  if ps -p "${OLD_PID}" > /dev/null 2>&1; then
    echo "Found running supervisor (PID ${OLD_PID}), stopping..."
    kill -TERM "${OLD_PID}" 2>/dev/null || true
    sleep 2
    if ps -p "${OLD_PID}" > /dev/null 2>&1; then
      echo "Forcing shutdown..."
      kill -9 "${OLD_PID}" 2>/dev/null || true
    fi
  fi
  rm -f "${PID_FILE}"
fi

PORT_PIDS=""
if command -v lsof > /dev/null 2>&1; then
  PORT_PIDS=$(lsof -ti tcp:${PORT} -sTCP:LISTEN 2>/dev/null || true)
elif command -v ss > /dev/null 2>&1; then
  PORT_PIDS=$(ss -lptn "sport = :${PORT}" 2>/dev/null | awk -F'pid=' 'NR>1 {split($2,a,","); print a[1]}')
fi

if [ -n "${PORT_PIDS}" ]; then
  echo "Port ${PORT} is in use by PID(s): ${PORT_PIDS}"
  for PID in ${PORT_PIDS}; do
    kill -TERM "${PID}" 2>/dev/null || true
  done
  sleep 2
  for PID in ${PORT_PIDS}; do
    if ps -p "${PID}" > /dev/null 2>&1; then
      echo "Forcing shutdown for PID ${PID}..."
      kill -9 "${PID}" 2>/dev/null || true
    fi
  done
fi

echo "Starting backend..."
cd "${ROOT_DIR}/backend"
nohup node supervisor.js > "${ROOT_DIR}/backend.nohup.out" 2>&1 &

sleep 1
if [ -f "${PID_FILE}" ]; then
  echo "Backend started successfully (PID $(cat ${PID_FILE}))"
  echo "Logs: ${ROOT_DIR}/backend.nohup.out"
else
  echo "Warning: Backend may have failed to start (no PID file created)"
fi
