#!/bin/sh

ROOT_DIR=$(cd "$(dirname "$0")" && pwd)
PID_FILE="${ROOT_DIR}/backend/supervisor.pid"

echo "Stopping existing backend (if any)..."
if [ -f "${PID_FILE}" ]; then
  OLD_PID=$(cat "${PID_FILE}")
  if ps -p "${OLD_PID}" > /dev/null 2>&1; then
    echo "Found running supervisor (PID ${OLD_PID}), stopping..."
    kill -TERM "${OLD_PID}" 2>/dev/null || true
    sleep 2
    # Force kill if still running
    if ps -p "${OLD_PID}" > /dev/null 2>&1; then
      echo "Forcing shutdown..."
      kill -9 "${OLD_PID}" 2>/dev/null || true
    fi
  fi
  rm -f "${PID_FILE}"
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
