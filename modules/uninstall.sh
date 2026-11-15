#!/system/bin/sh
MODDIR=${0%/*}

if [ -f "$MODDIR/daemon.pid" ]; then
    PID=$(cat "$MODDIR/daemon.pid" 2>/dev/null)
    case "$PID" in
        ''|*[!0-9]*) ;;
        *)
            if tr '\0' ' ' < "/proc/$PID/cmdline" 2>/dev/null | grep -q "daemon.sh"; then
                kill "$PID" 2>/dev/null
            fi
            ;;
    esac
fi

pkill -f "$MODDIR/daemon.sh" 2>/dev/null
pkill -f "httpd -p [0-9.]*:8088" 2>/dev/null

settings put system min_refresh_rate 60.0 2>/dev/null
settings put system peak_refresh_rate 120.0 2>/dev/null

rm -f "$MODDIR/daemon.pid" "$MODDIR/current_pkg" "$MODDIR/current_profile" \
      "$MODDIR/manual_override" "$MODDIR/reload_trigger" "$MODDIR/switch.log" \
      "$MODDIR/history.log" "$MODDIR/web_server_disabled"
