#!/system/bin/sh
MODDIR=${0%/*}

while [ "$(getprop sys.boot_completed)" != "1" ]; do
    sleep 2
done

if [ -f "$MODDIR/daemon.pid" ]; then
    PID=$(cat "$MODDIR/daemon.pid" 2>/dev/null)
    [ -n "$PID" ] && kill -9 "$PID" 2>/dev/null
fi

nohup sh "$MODDIR/daemon.sh" > /dev/null 2>&1 &

BUSYBOX="/data/adb/ksu/bin/busybox"
[ ! -x "$BUSYBOX" ] && BUSYBOX="/data/adb/magisk/busybox"
[ ! -x "$BUSYBOX" ] && BUSYBOX="/data/adb/ap/bin/busybox"
[ ! -x "$BUSYBOX" ] && BUSYBOX="$(which busybox 2>/dev/null)"

if [ ! -f "$MODDIR/web_server_disabled" ] && [ -x "$BUSYBOX" ] && [ -d "$MODDIR/webroot" ]; then
    pkill -f "httpd -p [0-9.]*:8088" 2>/dev/null
    nohup "$BUSYBOX" httpd -p 127.0.0.1:8088 -h "$MODDIR/webroot" > /dev/null 2>&1 &
fi
