#!/bin/bash
set -e

ROOT_DIR=$(cd "$(dirname "$0")" && pwd)
PID_FILE="${ROOT_DIR}/backend/supervisor.pid"

echo "Stopping backend supervisor..."
if [ -f "${PID_FILE}" ]; then
  PID=$(cat "${PID_FILE}")
  if ps -p "${PID}" > /dev/null 2>&1; then
    echo "Stopping supervisor (PID ${PID})..."
    kill -TERM "${PID}" 2>/dev/null || true

    # Wait up to 10 seconds for graceful shutdown
    COUNTER=0
    while [ $COUNTER -lt 10 ]; do
      if ! ps -p "${PID}" > /dev/null 2>&1; then
        echo "Supervisor stopped gracefully."
        rm -f "${PID_FILE}"
        exit 0
      fi
      sleep 1
      COUNTER=$((COUNTER + 1))
    done

    # Force kill if still running
    if ps -p "${PID}" > /dev/null 2>&1; then
      echo "Forcing shutdown..."
      kill -9 "${PID}" 2>/dev/null || true
      sleep 1
    fi
  fi
  rm -f "${PID_FILE}"
  echo "Backend supervisor stopped."
else
  echo "No PID file found. Supervisor may not be running."
fi
