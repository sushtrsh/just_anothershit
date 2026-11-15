#!/system/bin/sh

TKM="/data/adb/modules/kernel-manager/tkm"
BASE_DIR="/data/adb/modules/kernel-manager"

printf "Content-Type: application/json; charset=utf-8\r\n"
printf "Cache-Control: no-store\r\n"
printf "X-Content-Type-Options: nosniff\r\n"
printf "\r\n"

if [ "$REQUEST_METHOD" = "OPTIONS" ]; then
    exit 0
fi

fail() {
    printf '{"status":"error","message":"%s"}\n' "$1"
    exit 0
}

case "$HTTP_HOST" in
    ""|127.0.0.1|127.0.0.1:*|localhost|localhost:*) ;;
    *) fail "forbidden host" ;;
esac

url_decode() {
    local s="$1" out="" chunk h c
    while [ -n "$s" ]; do
        case "$s" in
            %[0-9A-Fa-f][0-9A-Fa-f]*)
                h="${s#%}"
                h="${h%"${h#??}"}"
                case "$h" in
                    20) c=" " ;;
                    22) c='"' ;;
                    27) c="'" ;;
                    2B|2b) c="+" ;;
                    2C|2c) c="," ;;
                    2F|2f) c="/" ;;
                    3A|3a) c=":" ;;
                    3D|3d) c="=" ;;
                    40) c="@" ;;
                    *) c=$(printf '%b' "\\0$(printf '%o' "0x$h")") ;;
                esac
                out="$out$c"
                s="${s#%??}"
                ;;
            %*)
                out="$out%"
                s="${s#%}"
                ;;
            *)
                chunk="${s%%%*}"
                out="$out$chunk"
                s="${s#"$chunk"}"
                ;;
        esac
    done
    printf '%s' "$out"
}

raw_query() {
    printf '&%s' "$QUERY_STRING" | sed -n "s/.*&$1=\([^&]*\).*/\1/p" | tr -d '\r\n'
}

parse_query() {
    url_decode "$(raw_query "$1")" | tr -cd 'A-Za-z0-9._,:@=+-'
}

json_escape() {
    sed 's/\\/\\\\/g' | sed 's/"/\\"/g' | awk '{printf "%s\\n", $0}'
}

profile_exists() {
    case "$1" in
        ''|*[!A-Za-z0-9_]*) return 1 ;;
    esac
    grep -q "^\[$1\]\$" "$BASE_DIR/profiles.conf" 2>/dev/null
}

apply_default_profile() {
    profile_exists "$1" || return 1
    sed -i "/^DEFAULT=/d" "$BASE_DIR/perapp.conf"
    echo "DEFAULT=$1" >> "$BASE_DIR/perapp.conf"
    touch "$BASE_DIR/reload_trigger"
}

save_profiles_b64() {
    case "$1" in
        ''|*[!A-Za-z0-9+/=]*) return 1 ;;
    esac
    local tmp="$BASE_DIR/profiles.conf.tmp"
    printf '%s' "$1" | base64 -d > "$tmp" 2>/dev/null
    if [ ! -s "$tmp" ] || grep -qvE '^(\[[A-Za-z0-9_]+\]|[A-Z_]+=[^`$\\]*|#[^`$\\]*)?$' "$tmp"; then
        rm -f "$tmp"
        return 1
    fi
    mv "$tmp" "$BASE_DIR/profiles.conf" && touch "$BASE_DIR/reload_trigger"
}

DRY=1

run_words() {
    [ $# -eq 0 ] && return 1
    local n=$# w
    while [ "$n" -gt 0 ]; do
        w="$1"; shift
        w="${w#\"}"; w="${w%\"}"
        set -- "$@" "$w"
        n=$((n - 1))
    done
    case "$1" in
        status|json|trans_sched|web|set|switchlog|set_type|get_types|set_batch|set_custom|get_app_config|remove|expand|expand_user|unexpand|show|keys|list|list_json|force|unforce|reload|test|restart|log|clearlog|get_installed_apps|help) ;;
        *) return 1 ;;
    esac
    for w in "$@"; do
        case "$w" in
            *[!A-Za-z0-9._:,@=+-]*) return 1 ;;
        esac
    done
    [ "$DRY" = "1" ] && return 0
    sh "$TKM" "$@" 2>&1
}

run_segment() {
    local seg="$1" rest
    case "$seg" in
        "sh $TKM "*) rest="${seg#"sh $TKM "}" ;;
        "tkm "*) rest="${seg#"tkm "}" ;;
        *) return 1 ;;
    esac
    set -f
    set -- $rest
    set +f
    run_words "$@"
}

run_chain() {
    local rest="$1" seg
    while [ -n "$rest" ]; do
        case "$rest" in
            *"; "*) seg="${rest%%; *}"; rest="${rest#*; }" ;;
            *) seg="$rest"; rest="" ;;
        esac
        run_segment "$seg" || return 1
    done
}

run_gateway() {
    local cmd="$1" pre suf v
    pre="sed -i '/^DEFAULT=/d' $BASE_DIR/perapp.conf && echo \"DEFAULT="
    suf="\" >> $BASE_DIR/perapp.conf && touch $BASE_DIR/reload_trigger"
    case "$cmd" in
        "$pre"*"$suf")
            v="${cmd#"$pre"}"; v="${v%"$suf"}"
            apply_default_profile "$v" || return 1
            return 0
            ;;
    esac
    if [ "$cmd" = "cat $BASE_DIR/profiles.conf" ]; then
        cat "$BASE_DIR/profiles.conf" 2>&1
        return 0
    fi
    pre="echo \""
    suf="\" | base64 -d > $BASE_DIR/profiles.conf && touch $BASE_DIR/reload_trigger"
    case "$cmd" in
        "$pre"*"$suf")
            v="${cmd#"$pre"}"; v="${v%"$suf"}"
            save_profiles_b64 "$v" || return 1
            return 0
            ;;
    esac
    DRY=1
    run_chain "$cmd" || return 1
    DRY=0
    run_chain "$cmd"
}

ACTION=$(parse_query "action")
PKG=$(parse_query "pkg")
PROF=$(parse_query "prof")
FILTER=$(parse_query "filter")

case "$ACTION" in
    json|status)
        sh "$TKM" json 2>&1
        ;;
    rules)
        sh "$TKM" list_json 2>&1
        ;;
    apps)
        [ -z "$FILTER" ] && FILTER="json"
        sh "$TKM" get_installed_apps "$FILTER" 2>&1
        ;;
    log)
        LINES=$(parse_query "lines")
        case "$LINES" in
            ''|*[!0-9]*) LINES=50 ;;
        esac
        LOG_DATA=$(sh "$TKM" log "$LINES" 2>&1 | json_escape)
        printf '{"log":"%s"}\n' "$LOG_DATA"
        ;;
    clearlog)
        sh "$TKM" clearlog 2>&1
        printf '{"status":"ok"}\n'
        ;;
    toggle_trans_sched)
        sh "$TKM" trans_sched toggle > /dev/null 2>&1
        RAW=$(cat /proc/trans_scheduler/enable 2>/dev/null | tr -d '\r\n')
        EN="false"
        if echo "$RAW" | grep -qE "7ff|2047|0x1|1"; then EN="true"; fi
        printf '{"status":"ok","enabled":%s,"raw":"%s"}\n' "$EN" "$RAW"
        ;;
    set_trans_sched)
        VAL=$(parse_query "val")
        if [ "$VAL" = "1" ] || [ "$VAL" = "on" ]; then
            sh "$TKM" trans_sched on > /dev/null 2>&1
            printf '{"status":"ok","enabled":true,"raw":"enable=0x7ff"}\n'
        else
            sh "$TKM" trans_sched off > /dev/null 2>&1
            printf '{"status":"ok","enabled":false,"raw":"enable=0x0"}\n'
        fi
        ;;
    force)
        profile_exists "$PROF" || fail "unknown profile"
        sh "$TKM" force "$PROF" 2>&1
        printf '{"status":"ok","forced":"%s"}\n' "$PROF"
        ;;
    unforce)
        sh "$TKM" unforce 2>&1
        printf '{"status":"ok"}\n'
        ;;
    set_rule)
        [ -n "$PKG" ] || fail "missing package"
        sh "$TKM" set "$PKG" "$PROF" 2>&1
        printf '{"status":"ok"}\n'
        ;;
    set_batch)
        PKGS=$(parse_query "pkgs" | tr ',' ' ')
        sh "$TKM" set_batch "$PROF" $PKGS 2>&1
        printf '{"status":"ok"}\n'
        ;;
    remove_rule)
        [ -n "$PKG" ] || fail "missing package"
        sh "$TKM" remove "$PKG" 2>&1
        printf '{"status":"ok"}\n'
        ;;
    get_app_config)
        sh "$TKM" get_app_config "$PKG" 2>&1
        ;;
    save_custom)
        [ -n "$PKG" ] || fail "missing package"
        L_GOV=$(parse_query "l_gov")
        L_MIN=$(parse_query "l_min")
        L_MAX=$(parse_query "l_max")
        B_GOV=$(parse_query "b_gov")
        B_MIN=$(parse_query "b_min")
        B_MAX=$(parse_query "b_max")
        GPU_MIN=$(parse_query "gpu_min")
        GPU_MAX=$(parse_query "gpu_max")
        GPU_BOOST=$(parse_query "gpu_boost")
        U_LAT=$(parse_query "u_lat")
        BORE=$(parse_query "bore")
        GPU_BOOST_FREQ=$(parse_query "gpu_boost_freq")
        TRANS_SCHED=$(parse_query "trans_sched")
        SCHED_RATE=$(parse_query "sched_rate")
        GPU_LOCK_OPP=$(parse_query "gpu_lock_opp")
        UCLAMP_MIN=$(parse_query "uclamp_min")
        UCLAMP_MAX=$(parse_query "uclamp_max")
        GAME_MODE=$(parse_query "game_mode")
        REFRESH_RATE=$(parse_query "refresh_rate")
        EAS_ENABLE=$(parse_query "eas_enable")
        BG_CPUS=$(parse_query "bg_cpus")
        GPU_DVFS=$(parse_query "gpu_dvfs")
        TCP_CONG=$(parse_query "tcp_cong")
        SWAPPINESS=$(parse_query "swappiness")
        TRANS_LOCK_TUNER=$(parse_query "trans_lock_tuner")
        [ -z "$TRANS_LOCK_TUNER" ] && TRANS_LOCK_TUNER="7"
        sh "$TKM" set_custom "$PKG" "$L_GOV" "$L_MIN" "$L_MAX" "$B_GOV" "$B_MIN" "$B_MAX" "$GPU_MIN" "$GPU_MAX" "$GPU_BOOST" "$U_LAT" "$BORE" "$GPU_BOOST_FREQ" "$TRANS_SCHED" "$SCHED_RATE" "$GPU_LOCK_OPP" "$UCLAMP_MIN" "$UCLAMP_MAX" "$GAME_MODE" "$REFRESH_RATE" "$EAS_ENABLE" "$BG_CPUS" "$GPU_DVFS" "$TCP_CONG" "$SWAPPINESS" "$TRANS_LOCK_TUNER" 2>&1
        printf '{"status":"ok","pkg":"%s"}\n' "$PKG"
        ;;
    set_default)
        if apply_default_profile "$PROF"; then
            printf '{"status":"ok","default":"%s"}\n' "$PROF"
        else
            printf '{"status":"error","message":"unknown profile"}\n'
        fi
        ;;
    restart)
        sh "$TKM" restart 2>&1
        printf '{"status":"ok"}\n'
        ;;
    reload)
        sh "$TKM" reload 2>&1
        printf '{"status":"ok"}\n'
        ;;
    web_toggle)
        sh "$TKM" web toggle 2>&1
        if pgrep -f "httpd -p [0-9.]*:8088" >/dev/null 2>&1; then
            printf '{"status":"ok","running":true}\n'
        else
            printf '{"status":"ok","running":false}\n'
        fi
        ;;
    web_on)
        sh "$TKM" web on 2>&1
        printf '{"status":"ok","running":true}\n'
        ;;
    web_off)
        sh "$TKM" web off 2>&1
        printf '{"status":"ok","running":false}\n'
        ;;
    web_status)
        sh "$TKM" web status 2>&1
        ;;
    profiles_raw)
        CONF_DATA=$(cat "$BASE_DIR/profiles.conf" 2>/dev/null | json_escape)
        printf '{"content":"%s"}\n' "$CONF_DATA"
        ;;
    exec)
        CMD_DEC=$(url_decode "$(raw_query cmd)" | tr -d '\r\n')
        if OUT=$(run_gateway "$CMD_DEC"); then
            OUT=$(printf '%s' "$OUT" | json_escape)
        else
            OUT=$(printf '%s' "[ditolak] mode browser hanya mengizinkan perintah tkm (mis. tkm status)" | json_escape)
        fi
        printf '{"output":"%s"}\n' "$OUT"
        ;;
    *)
        printf '{"status":"ready","endpoints":["json","rules","apps","log","clearlog","force","unforce","set_rule","remove_rule","set_default","restart","reload","profiles_raw","toggle_trans_sched","set_trans_sched"]}\n'
        ;;
esac
