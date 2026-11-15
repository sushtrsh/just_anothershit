#!/system/bin/sh

BASE_DIR="/data/adb/modules/kernel-manager"
CONFIG_FILE="$BASE_DIR/perapp.conf"
ENGINE="$BASE_DIR/apply_profile.sh"

echo $$ > "$BASE_DIR/daemon.pid"

while [ "$(getprop sys.boot_completed)" != "1" ]; do
    sleep 3
done

ACTIVE_PROFILE=""
LAST_PKG=""

SWITCH_LOG="$BASE_DIR/switch.log"
LOG_TTL="${LOG_TTL:-1800}"
LAST_CLEAR=$(date +%s)
LOOP_N=0

rotate_log() {
    local now="$1"
    if [ $((now - LAST_CLEAR)) -ge "$LOG_TTL" ]; then
        : > "$SWITCH_LOG"
        LAST_CLEAR="$now"
    fi
}

rd() {
    RV=""
    if [ -r "$1" ]; then
        { read -r RV < "$1"; } 2>/dev/null
    fi
    [ -z "$RV" ] && RV="-"
}

mhz() {
    rd "$1"
    case "$RV" in
        ''|-|*[!0-9]*) ;;
        *) RV=$((RV / 1000)) ;;
    esac
}

snapshot_line() {
    local C="/sys/devices/system/cpu/cpufreq" G="/sys/module/ged/parameters" U="/dev/cpuctl/top-app"
    local out="" a b c d e

    rd $C/policy0/scaling_governor; a="$RV"
    mhz $C/policy0/scaling_cur_freq; b="$RV"
    mhz $C/policy0/scaling_min_freq; c="$RV"
    mhz $C/policy0/scaling_max_freq; d="$RV"
    out="Little: $a cur=${b}M min=${c}M max=${d}M"

    rd $C/policy6/scaling_governor; a="$RV"
    mhz $C/policy6/scaling_cur_freq; b="$RV"
    mhz $C/policy6/scaling_min_freq; c="$RV"
    mhz $C/policy6/scaling_max_freq; d="$RV"
    out="$out | Big: $a cur=${b}M min=${c}M max=${d}M"

    mhz $G/gpu_bottom_freq; a="$RV"
    mhz $G/gpu_cust_upbound_freq; b="$RV"
    mhz $G/gpu_cust_boost_freq; c="$RV"
    rd $G/ged_boost_enable; d="$RV"
    rd /proc/gpufreqv2/fix_target_opp_index; e="$RV"
    out="$out | GPU: min=${a}M max=${b}M boost=${c}M(ged=$d) opp=$e"
    rd $G/gpu_dvfs_enable; out="$out dvfs=$RV"

    rd $U/cpu.uclamp.min; a="$RV"
    rd $U/cpu.uclamp.max; b="$RV"
    rd $U/cpu.uclamp.latency_sensitive; c="$RV"
    out="$out | UCLAMP: $a-$b lat=$c"

    rd /proc/sys/kernel/sched_burst_penalty_scale; a="$RV"
    rd $C/policy0/schedutil/rate_limit_us; b="$RV"
    out="$out | BORE=$a rate=${b}us"

    rd /proc/trans_scheduler/enable; a="$RV"
    rd /proc/trans_scheduler/lock_tuner; b="$RV"
    out="$out | trans_sched=$a lt=$b"

    rd /proc/game_state; a="$RV"
    rd /proc/sys/kernel/sched_energy_aware; b="$RV"
    rd /dev/cpuset/background/cpus; c="$RV"
    out="$out | game=$a eas=$b bg=$c"

    rd /proc/sys/net/ipv4/tcp_congestion_control; a="$RV"
    rd /proc/sys/vm/swappiness; b="$RV"
    out="$out | tcp=$a swap=$b"

    rd /sys/devices/virtual/thermal/thermal_zone0/temp; a="$RV"
    case "$a" in ''|-|*[!0-9]*) ;; *) a=$((a / 1000)) ;; esac
    rd /sys/class/power_supply/battery/temp; b="$RV"
    case "$b" in ''|-|*[!0-9]*) ;; *) b=$((b / 10)) ;; esac
    rd /sys/class/power_supply/battery/capacity; c="$RV"
    out="$out | cpu=${a}C bat=${c}% ${b}C"

    echo "$out"
}

log_snapshot() {
    (
        sleep 2
        echo "$(date '+%Y-%m-%d %H:%M:%S') |   > nilai ($1): $(snapshot_line)" >> "$SWITCH_LOG"
    ) > /dev/null 2>&1 &
}

log_event() {
    local d now ts
    d=$(date '+%s %Y-%m-%d %H:%M:%S')
    now="${d%% *}"
    ts="${d#* }"
    rotate_log "$now"
    echo "$ts | $1" >> "$SWITCH_LOG"
}

get_package_profile() {
    local target_pkg="$1"
    local prof=""

    if [ -f "$CONFIG_FILE" ]; then
        prof=$(grep -E "^${target_pkg}=" "$CONFIG_FILE" | head -n 1 | cut -d '=' -f 2 | tr -d '\r \t')
        if [ -z "$prof" ]; then
            prof=$(grep -E "^DEFAULT=" "$CONFIG_FILE" | head -n 1 | cut -d '=' -f 2 | tr -d '\r \t')
        fi
    fi

    if [ -z "$prof" ]; then
        prof="balanced"
    fi
    echo "$prof"
}

pkg_has_override() {
    [ -f "$CONFIG_FILE" ] && grep -q "^${1}:" "$CONFIG_FILE"
}

conf_mtime() {
    stat -c %Y "$CONFIG_FILE" 2>/dev/null
}
CONF_MTIME=$(conf_mtime)

get_active_app() {
    local win_out
    win_out=$(dumpsys window 2>/dev/null)
    local focus
    focus=$(echo "$win_out" | grep -m 1 'mCurrentFocus' | sed -n 's/.* \([a-zA-Z0-9._]*\)\/.*/\1/p')

    if [ -z "$focus" ] || echo "$win_out" | grep -m 1 'mCurrentFocus' | grep -qE 'NotificationShade|Keyguard|StatusBar'; then
        focus=$(echo "$win_out" | grep -m 1 'mFocusedApp' | sed -n 's/.* \([a-zA-Z0-9._]*\)\/.*/\1/p')
    fi

    if [ -z "$focus" ]; then
        focus="system"
    fi
    echo "$focus"
}

while true; do
    LOOP_N=$((LOOP_N + 1))
    if [ -f "$BASE_DIR/disable" ] || [ -f "$BASE_DIR/remove" ]; then
        pkill -f "httpd -p [0-9.]*:8088" 2>/dev/null
        rm -f "$BASE_DIR/daemon.pid"
        exit 0
    fi
    if [ $((LOOP_N % 30)) -eq 0 ]; then
        rotate_log "$(date +%s)"
    fi

    if [ -f "$BASE_DIR/reload_trigger" ]; then
        rm -f "$BASE_DIR/reload_trigger"
        LAST_PKG=""
        ACTIVE_PROFILE=""
    fi

    if [ $((LOOP_N % 3)) -eq 0 ]; then
        NEW_MTIME=$(conf_mtime)
        if [ -n "$NEW_MTIME" ] && [ "$NEW_MTIME" != "$CONF_MTIME" ]; then
            CONF_MTIME="$NEW_MTIME"
            LAST_PKG=""
            ACTIVE_PROFILE=""
            log_event "perapp.conf berubah | reload otomatis"
        fi
    fi

    WAKEFUL=$(dumpsys power 2>/dev/null | grep -m 1 "mWakefulness=" | cut -d '=' -f 2 | tr -d '\r ')

    if [ "$WAKEFUL" != "Awake" ]; then
        if [ "$ACTIVE_PROFILE" != "sleep" ]; then
            log_event "LAYAR MATI | profil: ${ACTIVE_PROFILE:--} -> sleep | BERUBAH"
            sh "$ENGINE" "sleep"
            ACTIVE_PROFILE="sleep"
            log_snapshot "layar mati"
            LAST_PKG="SCREEN_OFF"
            echo "SCREEN_OFF" > "$BASE_DIR/current_pkg"
        fi
        sleep 4
        continue
    fi

    if [ -f "$BASE_DIR/manual_override" ]; then
        OVERRIDE=$(cat "$BASE_DIR/manual_override" | tr -d '\r \n\t')
        if [ -n "$OVERRIDE" ] && [ "$ACTIVE_PROFILE" != "$OVERRIDE" ]; then
            log_event "MANUAL LOCK | profil: ${ACTIVE_PROFILE:--} -> $OVERRIDE | BERUBAH"
            sh "$ENGINE" "$OVERRIDE"
            ACTIVE_PROFILE="$OVERRIDE"
            log_snapshot "manual lock"
        fi
        sleep 2
        continue
    fi

    CURRENT_PKG=$(get_active_app | tr -d '\r ')

    if [ -n "$CURRENT_PKG" ] && { [ "$CURRENT_PKG" != "$LAST_PKG" ] || [ -z "$ACTIVE_PROFILE" ]; }; then
        TARGET_PROFILE=$(get_package_profile "$CURRENT_PKG")

        TARGET_KEY="$TARGET_PROFILE"
        OVR_PKG=""
        if pkg_has_override "$CURRENT_PKG"; then
            OVR_PKG="$CURRENT_PKG"
            TARGET_KEY="${TARGET_PROFILE}@${CURRENT_PKG}"
        fi

        RULE_SRC="default"
        if [ -f "$CONFIG_FILE" ] && grep -qE "^${CURRENT_PKG}=" "$CONFIG_FILE"; then
            RULE_SRC="aturan app"
        fi
        [ -n "$OVR_PKG" ] && RULE_SRC="$RULE_SRC+detail"

        if [ -z "$ACTIVE_PROFILE" ]; then
            RESULT="DITERAPKAN (awal/reload)"
        elif [ "$TARGET_KEY" != "$ACTIVE_PROFILE" ]; then
            RESULT="BERUBAH"
        else
            RESULT="TETAP"
        fi
        log_event "${LAST_PKG:--} -> $CURRENT_PKG | $RULE_SRC | profil: ${ACTIVE_PROFILE:--} -> $TARGET_KEY | $RESULT"

        if [ "$TARGET_KEY" != "$ACTIVE_PROFILE" ]; then
            sh "$ENGINE" "$TARGET_PROFILE" "$OVR_PKG"
            ACTIVE_PROFILE="$TARGET_KEY"
        fi
        log_snapshot "$CURRENT_PKG"
        LAST_PKG="$CURRENT_PKG"
        echo "$CURRENT_PKG" > "$BASE_DIR/current_pkg"
    fi

    sleep 1
done
