#!/system/bin/sh

BASE_DIR="/data/adb/modules/kernel-manager"
PROFILE="$1"
PKG_OVR="$2"

if [ -z "$PROFILE" ]; then
    echo "Usage: apply_profile.sh <profile_name>"
    exit 1
fi

PROFILES_FILE="$BASE_DIR/profiles.conf"
if [ ! -f "$PROFILES_FILE" ]; then
    echo "Error: $PROFILES_FILE not found"
    exit 1
fi

OVR_DATA=""
if [ -n "$PKG_OVR" ] && [ -f "$BASE_DIR/perapp.conf" ]; then
    _esc=$(printf '%s' "$PKG_OVR" | sed 's/\./\\./g')
    OVR_DATA=$(grep -E "^${_esc}:" "$BASE_DIR/perapp.conf" | sed "s/^${_esc}://" | tr -d '\r')
fi

ov_lookup() {
    local _k _v
    OV=""
    [ -z "$OVR_DATA" ] && return 1
    while IFS='=' read -r _k _v; do
        _k="${_k#"${_k%%[![:space:]]*}"}"; _k="${_k%"${_k##*[![:space:]]}"}"
        if [ "$_k" = "$1" ]; then
            _v="${_v#"${_v%%[![:space:]]*}"}"; _v="${_v%"${_v##*[![:space:]]}"}"
            OV="$_v"
            break
        fi
    done <<EOF_OVR
$OVR_DATA
EOF_OVR
    [ -n "$OV" ]
}

get_val() {
    local key="$1"
    if [ "$key" != "NAME" ] && ov_lookup "$key"; then
        echo "$OV"
        return
    fi
    awk -F '=' -v tgt="[$PROFILE]" -v k="$key" '
        $0 == tgt { flag=1; next }
        /^\[/ { flag=0 }
        flag && $1==k { gsub(/^[ \t]+|[ \t]+$/, "", $2); print $2; exit }
    ' "$PROFILES_FILE"
}

NAME=$(get_val "NAME")
if [ -z "$NAME" ]; then
    echo "Error: Profile '$PROFILE' not defined in profiles.conf"
    exit 1
fi

CPU_L_GOV=$(get_val "CPU_L_GOV")
CPU_L_MIN=$(get_val "CPU_L_MIN")
CPU_L_MAX=$(get_val "CPU_L_MAX")

CPU_B_GOV=$(get_val "CPU_B_GOV")
CPU_B_MIN=$(get_val "CPU_B_MIN")
CPU_B_MAX=$(get_val "CPU_B_MAX")

GPU_MIN=$(get_val "GPU_MIN")
GPU_MAX=$(get_val "GPU_MAX")
GPU_BOOST=$(get_val "GPU_BOOST")
GPU_BOOST_FREQ=$(get_val "GPU_BOOST_FREQ")
GPU_LOCK_OPP=$(get_val "GPU_LOCK_OPP")

UCLAMP_MIN=$(get_val "UCLAMP_MIN")
UCLAMP_MAX=$(get_val "UCLAMP_MAX")
UCLAMP_LATENCY=$(get_val "UCLAMP_LATENCY")
BORE_SCALE=$(get_val "BORE_SCALE")

TRANS_SCHED=$(get_val "TRANS_SCHED")
TRANS_LOCK_TUNER=$(get_val "TRANS_LOCK_TUNER")
SCHED_RATE=$(get_val "SCHED_RATE")

GAME_MODE=$(get_val "GAME_MODE")
REFRESH_RATE=$(get_val "REFRESH_RATE")
EAS_ENABLE=$(get_val "EAS_ENABLE")
BG_CPUS=$(get_val "BG_CPUS")
GPU_DVFS=$(get_val "GPU_DVFS")
TCP_CONG=$(get_val "TCP_CONG")
SWAPPINESS=$(get_val "SWAPPINESS")

P0="/sys/devices/system/cpu/cpufreq/policy0"
if [ -d "$P0" ]; then
    chmod 644 "$P0/scaling_governor" 2>/dev/null
    chmod 644 "$P0/scaling_min_freq" 2>/dev/null
    chmod 644 "$P0/scaling_max_freq" 2>/dev/null

    [ -n "$CPU_L_GOV" ] && echo "$CPU_L_GOV" > "$P0/scaling_governor" 2>/dev/null
    [ -n "$CPU_L_MAX" ] && echo "$CPU_L_MAX" > "$P0/scaling_max_freq" 2>/dev/null
    [ -n "$CPU_L_MIN" ] && echo "$CPU_L_MIN" > "$P0/scaling_min_freq" 2>/dev/null
fi

P6="/sys/devices/system/cpu/cpufreq/policy6"
if [ -d "$P6" ]; then
    chmod 644 "$P6/scaling_governor" 2>/dev/null
    chmod 644 "$P6/scaling_min_freq" 2>/dev/null
    chmod 644 "$P6/scaling_max_freq" 2>/dev/null

    [ -n "$CPU_B_GOV" ] && echo "$CPU_B_GOV" > "$P6/scaling_governor" 2>/dev/null
    [ -n "$CPU_B_MAX" ] && echo "$CPU_B_MAX" > "$P6/scaling_max_freq" 2>/dev/null
    [ -n "$CPU_B_MIN" ] && echo "$CPU_B_MIN" > "$P6/scaling_min_freq" 2>/dev/null
fi

GED="/sys/module/ged/parameters"
if [ -d "$GED" ]; then
    [ -n "$GPU_MIN" ] && echo "$GPU_MIN" > "$GED/gpu_bottom_freq" 2>/dev/null
    [ -n "$GPU_MAX" ] && echo "$GPU_MAX" > "$GED/gpu_cust_upbound_freq" 2>/dev/null
    [ -n "$GPU_BOOST_FREQ" ] && echo "$GPU_BOOST_FREQ" > "$GED/gpu_cust_boost_freq" 2>/dev/null
    if [ "$GPU_BOOST" = "1" ]; then
        echo 1 > "$GED/ged_smart_boost" 2>/dev/null
        echo 1 > "$GED/ged_boost_enable" 2>/dev/null
        echo 1 > "$GED/boost_gpu_enable" 2>/dev/null
    else
        echo 0 > "$GED/ged_smart_boost" 2>/dev/null
        echo 0 > "$GED/ged_boost_enable" 2>/dev/null
        echo 0 > "$GED/boost_gpu_enable" 2>/dev/null
    fi
fi

if [ -f "/proc/gpufreqv2/fix_target_opp_index" ] && [ -n "$GPU_LOCK_OPP" ]; then
    echo "$GPU_LOCK_OPP" > /proc/gpufreqv2/fix_target_opp_index 2>/dev/null
fi

UCLAMP_DIR="/dev/cpuctl/top-app"
if [ -d "$UCLAMP_DIR" ]; then
    [ -n "$UCLAMP_MIN" ] && echo "$UCLAMP_MIN" > "$UCLAMP_DIR/cpu.uclamp.min" 2>/dev/null
    [ -n "$UCLAMP_MAX" ] && echo "$UCLAMP_MAX" > "$UCLAMP_DIR/cpu.uclamp.max" 2>/dev/null
    [ -n "$UCLAMP_LATENCY" ] && echo "$UCLAMP_LATENCY" > "$UCLAMP_DIR/cpu.uclamp.latency_sensitive" 2>/dev/null
fi

if [ -n "$BORE_SCALE" ]; then
    sysctl -w kernel.sched_burst_penalty_scale="$BORE_SCALE" > /dev/null 2>&1
fi

if [ -n "$SCHED_RATE" ]; then
    [ -f "/sys/devices/system/cpu/cpufreq/policy0/schedutil/rate_limit_us" ] && echo "$SCHED_RATE" > /sys/devices/system/cpu/cpufreq/policy0/schedutil/rate_limit_us 2>/dev/null
    [ -f "/sys/devices/system/cpu/cpufreq/policy6/schedutil/rate_limit_us" ] && echo "$SCHED_RATE" > /sys/devices/system/cpu/cpufreq/policy6/schedutil/rate_limit_us 2>/dev/null
fi

if [ -d "/proc/trans_scheduler" ]; then
    if [ "$TRANS_SCHED" = "1" ] || [ "$TRANS_SCHED" = "0x7ff" ]; then
        echo 2047 > /proc/trans_scheduler/enable 2>/dev/null
        if [ -n "$TRANS_LOCK_TUNER" ]; then
            echo "$TRANS_LOCK_TUNER" > /proc/trans_scheduler/lock_tuner 2>/dev/null
        else
            echo 7 > /proc/trans_scheduler/lock_tuner 2>/dev/null
        fi
    elif [ "$TRANS_SCHED" = "0" ] || [ "$TRANS_SCHED" = "0x00" ]; then
        echo 0 > /proc/trans_scheduler/enable 2>/dev/null
        echo 0 > /proc/trans_scheduler/lock_tuner 2>/dev/null
    fi
fi

if [ -f "/proc/game_state" ] && [ -n "$GAME_MODE" ]; then
    echo "$GAME_MODE" > /proc/game_state 2>/dev/null
    if [ "$GAME_MODE" = "1" ] && [ -f "/proc/game_mode" ]; then
        echo "1" > /proc/game_mode 2>/dev/null
    fi
fi

if [ -n "$REFRESH_RATE" ] && [ "$REFRESH_RATE" != "0" ]; then
    settings put system min_refresh_rate "$REFRESH_RATE.0" 2>/dev/null
    settings put system peak_refresh_rate "$REFRESH_RATE.0" 2>/dev/null
elif [ "$REFRESH_RATE" = "0" ]; then
    settings put system min_refresh_rate 60.0 2>/dev/null
    settings put system peak_refresh_rate 120.0 2>/dev/null
fi

if [ -f "/proc/sys/kernel/sched_energy_aware" ] && [ -n "$EAS_ENABLE" ]; then
    echo "$EAS_ENABLE" > /proc/sys/kernel/sched_energy_aware 2>/dev/null
fi

if [ -f "/dev/cpuset/background/cpus" ] && [ -n "$BG_CPUS" ]; then
    echo "$BG_CPUS" > /dev/cpuset/background/cpus 2>/dev/null
fi

if [ -f "/sys/module/ged/parameters/gpu_dvfs_enable" ] && [ -n "$GPU_DVFS" ]; then
    echo "$GPU_DVFS" > /sys/module/ged/parameters/gpu_dvfs_enable 2>/dev/null
fi

if [ -f "/proc/sys/net/ipv4/tcp_congestion_control" ] && [ -n "$TCP_CONG" ]; then
    echo "$TCP_CONG" > /proc/sys/net/ipv4/tcp_congestion_control 2>/dev/null
fi

if [ -f "/proc/sys/vm/swappiness" ] && [ -n "$SWAPPINESS" ]; then
    echo "$SWAPPINESS" > /proc/sys/vm/swappiness 2>/dev/null
fi

echo "$PROFILE" > "$BASE_DIR/current_profile"
OVR_NOTE=""
[ -n "$OVR_DATA" ] && OVR_NOTE=" + override $PKG_OVR"
echo "$(date '+%Y-%m-%d %H:%M:%S') Applied profile: $PROFILE ($NAME)$OVR_NOTE" >> "$BASE_DIR/history.log"
if [ -f "$BASE_DIR/history.log" ]; then
    tail -n 200 "$BASE_DIR/history.log" > "$BASE_DIR/history.log.tmp" && mv "$BASE_DIR/history.log.tmp" "$BASE_DIR/history.log"
fi
