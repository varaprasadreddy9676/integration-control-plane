#!/bin/sh

set -eu

case "$0" in
  /*) SCRIPT_PATH="$0" ;;
  *) SCRIPT_PATH="$(pwd)/$0" ;;
esac

ROOT_DIR="$(CDPATH= cd -- "$(dirname -- "$SCRIPT_PATH")" && pwd)"
BACKEND_DIR="${ROOT_DIR}/backend"
PID_FILE="${ROOT_DIR}/backend.pid"
LOG_FILE="${ROOT_DIR}/nohup.out"
LOCK_DIR="${ROOT_DIR}/backend.start.lock"
ENTRYPOINT="src/index.js"
DEFAULT_NODE_BIN="/root/.nvm/versions/node/v14.15.3/bin/node"
ROOT_ENV_FILE="${ROOT_DIR}/.env"
BACKEND_ENV_FILE="${BACKEND_DIR}/.env"

resolve_node_bin() {
  if [ "${NODE_BIN:-}" ] && [ -x "${NODE_BIN}" ]; then
    printf '%s\n' "${NODE_BIN}"
    return 0
  fi

  if command -v node >/dev/null 2>&1; then
    command -v node
    return 0
  fi

  if [ -x "${DEFAULT_NODE_BIN}" ]; then
    printf '%s\n' "${DEFAULT_NODE_BIN}"
    return 0
  fi

  echo "ERROR: Unable to find a node binary. Set NODE_BIN or install node." >&2
  return 1
}

load_env_file() {
  env_file="$1"
  [ -f "${env_file}" ] || return 0

  # shellcheck disable=SC1090
  set -a
  . "${env_file}"
  set +a
}

is_numeric_pid() {
  case "$1" in
    ''|*[!0-9]*) return 1 ;;
    *) return 0 ;;
  esac
}

is_pid_running_for_backend() {
  pid="$1"

  is_numeric_pid "${pid}" || return 1
  kill -0 "${pid}" 2>/dev/null || return 1

  proc_cwd="$(readlink -f "/proc/${pid}/cwd" 2>/dev/null || true)"
  [ "${proc_cwd}" = "${BACKEND_DIR}" ] || return 1

  cmdline="$(tr '\000' ' ' <"/proc/${pid}/cmdline" 2>/dev/null || true)"
  case "${cmdline}" in
    *"${ENTRYPOINT}"*) return 0 ;;
    *) return 1 ;;
  esac
}

find_running_pid() {
  if [ -f "${PID_FILE}" ]; then
    pid="$(tr -d '[:space:]' <"${PID_FILE}")"
    if is_pid_running_for_backend "${pid}"; then
      printf '%s\n' "${pid}"
      return 0
    fi
  fi

  for pid in $(pgrep -f "node .*${ENTRYPOINT}" 2>/dev/null || true); do
    if is_pid_running_for_backend "${pid}"; then
      printf '%s\n' "${pid}"
      return 0
    fi
  done

  return 1
}

write_pid_file() {
  printf '%s\n' "$1" >"${PID_FILE}"
}

clear_pid_file() {
  rm -f "${PID_FILE}"
}

status_backend() {
  if pid="$(find_running_pid)"; then
    write_pid_file "${pid}"
    echo "RUNNING pid=${pid}"
    return 0
  fi

  clear_pid_file
  echo "STOPPED"
  return 1
}

acquire_start_lock() {
  if mkdir "${LOCK_DIR}" 2>/dev/null; then
    trap 'rmdir "${LOCK_DIR}" 2>/dev/null || true' EXIT INT TERM HUP
    return 0
  fi

  echo "ERROR: start lock is already held. Another start may be in progress." >&2
  return 1
}

release_start_lock() {
  rmdir "${LOCK_DIR}" 2>/dev/null || true
  trap - EXIT INT TERM HUP
}

start_backend() {
  acquire_start_lock

  if existing_pid="$(find_running_pid)"; then
    write_pid_file "${existing_pid}"
    echo "Backend already running with pid=${existing_pid}"
    release_start_lock
    return 0
  fi

  clear_pid_file
  node_bin="$(resolve_node_bin)"

  (
    load_env_file "${ROOT_ENV_FILE}"
    load_env_file "${BACKEND_ENV_FILE}"
    cd "${BACKEND_DIR}"
    nohup "${node_bin}" "${ENTRYPOINT}" >>"${LOG_FILE}" 2>&1 < /dev/null &
    printf '%s\n' "$!" >"${PID_FILE}"
  )

  sleep 2

  if new_pid="$(find_running_pid)"; then
    write_pid_file "${new_pid}"
    echo "Backend started with pid=${new_pid}"
    release_start_lock
    return 0
  fi

  echo "ERROR: Backend failed to start. Check ${LOG_FILE}" >&2
  clear_pid_file
  release_start_lock
  return 1
}

stop_backend() {
  waited=0

  if ! pid="$(find_running_pid)"; then
    clear_pid_file
    echo "Backend is not running"
    return 0
  fi

  echo "Stopping backend pid=${pid}"
  kill -TERM "${pid}" 2>/dev/null || true

  while is_pid_running_for_backend "${pid}"; do
    sleep 1
    waited=$((waited + 1))
    if [ "${waited}" -ge 30 ]; then
      echo "Backend did not stop in time; sending SIGKILL to pid=${pid}" >&2
      kill -KILL "${pid}" 2>/dev/null || true
      break
    fi
  done

  clear_pid_file
  echo "Backend stopped"
}

restart_backend() {
  stop_backend
  start_backend
}

usage() {
  cat <<'EOF'
Usage: sh start-backend.sh [start|stop|restart|status]

Defaults to "start".

Environment overrides:
  NODE_BIN=/absolute/path/to/node
EOF
}

ACTION="${1:-start}"

case "${ACTION}" in
  start)
    start_backend
    ;;
  stop)
    stop_backend
    ;;
  restart)
    restart_backend
    ;;
  status)
    status_backend
    ;;
  help|-h|--help)
    usage
    ;;
  *)
    echo "ERROR: Unknown action: ${ACTION}" >&2
    usage >&2
    exit 1
    ;;
esac
