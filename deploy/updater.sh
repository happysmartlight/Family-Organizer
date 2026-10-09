#!/bin/sh
# ═══════════════════════════════════════════════════════════════════
# Family Organizer — dịch vụ cập nhật (chạy trong container docker:cli)
#
# App không tự thay được chính nó, nên việc kéo image mới + khởi động lại
# giao cho container này. Nó KHÔNG mở cổng mạng: chỉ đọc/ghi file trong
# <thư mục data của app>/update/ (thư mục chung với app):
#   request.env   app → updater   id, action (update|restart), target, backup, restore, script
#   state.env     updater → app   heartbeat, phase, result, message, current, previous…
#   log.txt       nhật ký lần chạy gần nhất
#
# Cập nhật = đổi $VERSION_VAR trong .env → pull → up -d CHỈ service app → chờ
# app báo đúng phiên bản. Hỏng → tự quay về bản cũ + khôi phục DB sao lưu
# trước đó. Chỉ đụng tới service app: chạy được trong stack dùng chung
# (vd liu-homelab có cả Immich, Home Assistant…) mà không ảnh hưởng service khác.
# Viết sh thuần (busybox), không cần jq/curl.
#
# Biến môi trường:
#   STACK_DIR    thư mục chứa docker-compose.yml + .env (đường dẫn TRÊN HOST,
#                mount vào container cùng đường dẫn)
#   APP_DATA     thư mục data của app trên host (mặc định $STACK_DIR/data)
#   SERVICE      tên service app trong compose (mặc định family-organizer)
#   VERSION_VAR  biến trong .env chọn tag image (mặc định FAMILY_ORGANIZER_VERSION)
# ═══════════════════════════════════════════════════════════════════
set -u

SCRIPT_VERSION=1
SELF="$0"
STACK="${STACK_DIR:?Thiếu STACK_DIR}"
DATA="${APP_DATA:-$STACK/data}"
UPD="$DATA/update"
REQ="$UPD/request.env"
WORK="$UPD/request.processing"
STATE="$UPD/state.env"
LOG="$UPD/log.txt"
DB="$DATA/family.db"
SERVICE="${SERVICE:-family-organizer}"
VERSION_VAR="${VERSION_VAR:-FAMILY_ORGANIZER_VERSION}"
APP_PORT="${APP_PORT:-3000}"
PUID="${PUID:-1000}"
PGID="${PGID:-1000}"
HEALTH_TIMEOUT="${HEALTH_TIMEOUT:-240}"

mkdir -p "$UPD"
chown "$PUID:$PGID" "$UPD" 2>/dev/null || true

PHASE=idle
RESULT=""
MESSAGE=""
REQ_ID=""
PREVIOUS=""
FINISHED=""
if [ -f "$STATE" ]; then
  REQ_ID="$(sed -n 's/^request_id=//p' "$STATE")"
  RESULT="$(sed -n 's/^result=//p' "$STATE")"
  MESSAGE="$(sed -n 's/^message=//p' "$STATE")"
  PREVIOUS="$(sed -n 's/^previous=//p' "$STATE")"
  FINISHED="$(sed -n 's/^finished_at=//p' "$STATE")"
fi

dc() { docker compose --project-directory "$STACK" -f "$STACK/docker-compose.yml" "$@"; }
log() { printf '%s  %s\n' "$(date '+%H:%M:%S')" "$*" >>"$LOG"; }
env_get() { sed -n "s/^$1=//p" "$STACK/.env" 2>/dev/null | tail -n 1; }
env_set() {
  if grep -q "^$1=" "$STACK/.env" 2>/dev/null; then
    sed -i "s|^$1=.*|$1=$2|" "$STACK/.env"
  else
    printf '%s=%s\n' "$1" "$2" >>"$STACK/.env"
  fi
}
req_get() { sed -n "s/^$1=//p" "$WORK" | head -n 1; }
safe() {
  [ -z "$1" ] && return 0
  case "$1" in *..*) return 1 ;; esac
  printf '%s' "$1" | grep -Eq '^[A-Za-z0-9._/-]*$'
}

write_state() {
  tmp="$STATE.tmp.$$"
  {
    echo "heartbeat=$(date +%s)"
    echo "phase=$PHASE"
    echo "request_id=$REQ_ID"
    echo "result=$RESULT"
    echo "message=$(printf '%s' "$MESSAGE" | tr '\n' ' ')"
    echo "current=$(env_get "$VERSION_VAR")"
    echo "previous=$PREVIOUS"
    echo "finished_at=$FINISHED"
    echo "script_version=$SCRIPT_VERSION"
  } >"$tmp" && chmod 644 "$tmp" && mv -f "$tmp" "$STATE"
}

# Nhịp tim nền trong lúc làm việc lâu (pull image có thể mất vài phút).
HB_PID=""
hb_start() {
  (
    while :; do
      sleep 5
      [ -f "$STATE" ] && sed "s/^heartbeat=.*/heartbeat=$(date +%s)/" "$STATE" >"$STATE.hb" 2>/dev/null && mv -f "$STATE.hb" "$STATE"
    done
  ) &
  HB_PID=$!
}
hb_stop() {
  [ -n "$HB_PID" ] && kill "$HB_PID" 2>/dev/null
  [ -n "$HB_PID" ] && wait "$HB_PID" 2>/dev/null
  HB_PID=""
}

# Chờ app trả /api/health với đúng phiên bản (bỏ trống = chỉ cần khỏe).
# Hạn chờ tính theo đồng hồ thật (tra DNS lúc container chết có thể treo lâu),
# và bỏ cuộc sớm nếu container đã khởi động lỗi liên tục.
health_wait() {
  want="$1"
  deadline=$(($(date +%s) + HEALTH_TIMEOUT))
  cid="$(dc ps -q "$SERVICE" 2>/dev/null | head -n 1)"
  while [ "$(date +%s)" -lt "$deadline" ]; do
    out="$(wget -qO- -T 3 "http://$SERVICE:$APP_PORT/api/health" 2>/dev/null || true)"
    if printf '%s' "$out" | grep -q '"ok":true'; then
      if [ -z "$want" ] || [ "$want" = "latest" ] || printf '%s' "$out" | grep -q "\"version\":\"$want\""; then
        return 0
      fi
    fi
    if [ -n "$cid" ]; then
      restarts="$(docker inspect -f '{{.RestartCount}}' "$cid" 2>/dev/null || echo 0)"
      if [ "${restarts:-0}" -ge 3 ]; then
        log "Container $SERVICE khởi động lỗi liên tục ($restarts lần)"
        return 1
      fi
    fi
    sleep 3
  done
  return 1
}

restore_db() {
  src="$1"
  log "Khôi phục dữ liệu từ $(basename "$src")"
  gunzip -c "$src" >"$DB.restore" 2>>"$LOG" || { rm -f "$DB.restore"; return 1; }
  rm -f "$DB-wal" "$DB-shm"
  mv -f "$DB.restore" "$DB"
  chown "$PUID:$PGID" "$DB" 2>/dev/null || true
}

# Giữ image của bản đang chạy + bản trước (để quay về nhanh), xóa các bản cũ hơn.
prune_images() {
  keep_a="$1"
  keep_b="$2"
  cid="$(dc ps -q "$SERVICE" 2>/dev/null | head -n 1)"
  [ -n "$cid" ] || return 0
  img="$(docker inspect -f '{{.Config.Image}}' "$cid" 2>/dev/null)"
  repo="${img%:*}"
  [ -n "$repo" ] && [ "$repo" != "$img" ] || return 0
  docker images "$repo" --format '{{.Tag}}' 2>/dev/null | while read -r tag; do
    case "$tag" in
      "$keep_a" | "$keep_b" | "<none>" | "") ;;
      *) docker rmi "$repo:$tag" >/dev/null 2>&1 && log "Đã dọn image cũ $repo:$tag" ;;
    esac
  done
  docker images -q -f dangling=true "$repo" 2>/dev/null | xargs -r docker rmi >/dev/null 2>&1 || true
}

finish() {
  hb_stop
  RESULT="$1"
  MESSAGE="$2"
  FINISHED="$(date +%s)"
  PHASE="$3"
  write_state
  log "=== $MESSAGE ==="
  PHASE=idle
  write_state
}

do_restart() {
  : >"$LOG"
  RESULT=""
  FINISHED=""
  PHASE=restarting
  write_state
  hb_start
  log "Khởi động lại $SERVICE"
  dc restart "$SERVICE" >>"$LOG" 2>&1
  if health_wait ""; then finish ok "Đã khởi động lại" done; else finish failed "App không khởi động lại được" failed; fi
}

do_update() {
  target="$(req_get target)"
  backup="$(req_get backup)"
  restore="$(req_get restore)"
  script="$(req_get script)"
  : >"$LOG"
  for v in "$target" "$backup" "$restore" "$script"; do
    if ! safe "$v"; then
      finish failed "Yêu cầu không hợp lệ" failed
      return
    fi
  done
  [ -n "$target" ] || { finish failed "Thiếu phiên bản đích" failed; return; }
  [ -f "$STACK/docker-compose.yml" ] || { finish failed "Không thấy $STACK/docker-compose.yml — kiểm tra STACK_DIR trong .env" failed; return; }

  PREVIOUS="$(env_get "$VERSION_VAR")"
  [ -n "$PREVIOUS" ] || PREVIOUS=latest
  PHASE=prepare
  RESULT=""
  MESSAGE=""
  FINISHED=""
  write_state
  hb_start
  log "=== Cập nhật v$PREVIOUS → v$target ==="
  env_set "$VERSION_VAR" "$target"

  # 1. Kéo image
  PHASE=pulling
  write_state
  log "--- docker compose pull $SERVICE ---"
  if ! dc pull "$SERVICE" >>"$LOG" 2>&1; then
    env_set "$VERSION_VAR" "$PREVIOUS"
    finish failed "Không tải được bản v$target (kiểm tra mạng / quyền truy cập ghcr.io)" failed
    return
  fi

  # 2. Quay về kèm dữ liệu: khôi phục DB trước khi chạy bản đích.
  if [ -n "$restore" ] && [ -f "$DATA/$restore" ]; then
    PHASE=restoring
    write_state
    dc stop "$SERVICE" >>"$LOG" 2>&1
    restore_db "$DATA/$restore" || log "LỖI khôi phục dữ liệu — giữ dữ liệu hiện tại"
  fi

  # 3. Chạy bản mới (chỉ service app, không đụng service khác trong stack)
  PHASE=restarting
  write_state
  log "--- docker compose up -d $SERVICE ---"
  dc up -d --no-deps "$SERVICE" >>"$LOG" 2>&1

  # 4. Kiểm tra sức khỏe; hỏng → quay về
  PHASE=health
  write_state
  if health_wait "$target"; then
    prune_images "$target" "$PREVIOUS"
    finish ok "Đã lên v$target" done
  else
    log "Bản v$target không khởi động được — quay về v$PREVIOUS"
    PHASE=rolling_back
    write_state
    dc logs --tail 40 "$SERVICE" >>"$LOG" 2>&1
    env_set "$VERSION_VAR" "$PREVIOUS"
    dc stop "$SERVICE" >>"$LOG" 2>&1
    if [ -n "$backup" ] && [ -f "$DATA/$backup" ]; then restore_db "$DATA/$backup" || true; fi
    dc up -d --no-deps "$SERVICE" >>"$LOG" 2>&1
    if health_wait ""; then
      finish rolled_back "Bản v$target khởi động lỗi — đã tự quay về v$PREVIOUS" rolled_back
    else
      finish failed "Bản v$target lỗi và quay về v$PREVIOUS cũng không chạy. Xem log, hoặc chạy tay: cd $STACK && docker compose up -d $SERVICE" failed
    fi
  fi

  # 5. Script updater mới đi kèm → thay rồi nạp lại chính mình.
  if [ -n "$script" ] && [ -f "$DATA/$script" ] && ! cmp -s "$DATA/$script" "$SELF"; then
    if head -n 1 "$DATA/$script" | grep -q '^#!/bin/sh' && sh -n "$DATA/$script" 2>>"$LOG"; then
      cp -f "$DATA/$script" "$SELF.new" && mv -f "$SELF.new" "$SELF"
      log "Dịch vụ cập nhật có bản mới — nạp lại"
      rm -f "$WORK"
      exec /bin/sh "$SELF"
    fi
  fi
}

# ── Khởi động ──────────────────────────────────────────────────────
if ! docker compose version >/dev/null 2>&1; then
  echo "updater: thiếu docker compose plugin — cài thêm"
  apk add --no-cache docker-cli-compose >/dev/null 2>&1 || echo "updater: không cài được docker compose"
fi
[ -f "$STACK/docker-compose.yml" ] || echo "updater: CẢNH BÁO — không thấy $STACK/docker-compose.yml (STACK_DIR sai?)"
# Mất điện giữa chừng: yêu cầu đang làm dở coi như thất bại, không chạy lại.
if [ -f "$WORK" ]; then
  REQ_ID="$(req_get id)"
  rm -f "$WORK"
  RESULT=failed
  MESSAGE="Lần cập nhật trước bị gián đoạn (máy khởi động lại?)"
  FINISHED="$(date +%s)"
fi
write_state
echo "updater: sẵn sàng (v$SCRIPT_VERSION), stack $STACK, data $DATA, service $SERVICE"

last=0
while :; do
  if [ -f "$REQ" ]; then
    mv -f "$REQ" "$WORK"
    REQ_ID="$(req_get id)"
    action="$(req_get action)"
    case "$action" in
      update) do_update ;;
      restart) do_restart ;;
      *) log "Bỏ qua yêu cầu lạ: $action" ;;
    esac
    rm -f "$WORK"
    last=0
    [ -n "${UPDATER_ONCE:-}" ] && { write_state; exit 0; }
  fi
  now="$(date +%s)"
  if [ $((now - last)) -ge 10 ]; then
    write_state
    last="$now"
  fi
  sleep 2
done
