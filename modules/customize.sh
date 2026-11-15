ui_print "- Kernel Manager: memeriksa perangkat"

lc() { printf '%s' "$1" | tr 'A-Z' 'a-z'; }

DEV="$(getprop ro.product.device)"
MODEL="$(getprop ro.product.model)"
PLAT="$(lc "$(getprop ro.board.platform)")"
HW="$(lc "$(getprop ro.hardware)")"

ui_print "  Perangkat : ${MODEL:-?} (${DEV:-?})"
ui_print "  Platform  : ${PLAT:-?}"

case "$PLAT $HW" in
    *mt6789*) ;;
    *)
        ui_print "! Platform bukan MT6789. Modul ini dibuat untuk Infinix X6885,"
        ui_print "! sebagian setelan bisa tidak berfungsi di perangkat ini."
        ;;
esac

if [ "$(getprop sys.boot_completed)" = "1" ]; then
    MISSING=0
    probe() {
        if [ -e "$2" ]; then
            ui_print "  [ada]   $1"
        else
            ui_print "  [tidak] $1"
            MISSING=$((MISSING + 1))
        fi
    }
    probe "CPU little (policy0)" /sys/devices/system/cpu/cpufreq/policy0
    probe "CPU big (policy6)" /sys/devices/system/cpu/cpufreq/policy6
    probe "GPU GED" /sys/module/ged/parameters
    probe "GPU OPP lock (gpufreqv2)" /proc/gpufreqv2/fix_target_opp_index
    probe "UCLAMP top-app" /dev/cpuctl/top-app
    probe "BORE scheduler" /proc/sys/kernel/sched_burst_penalty_scale
    probe "Transsion scheduler" /proc/trans_scheduler
    probe "Game state" /proc/game_state
    if [ "$MISSING" -gt 0 ]; then
        ui_print "! $MISSING fitur tidak ditemukan, setelan terkait akan dilewati."
    fi
else
    ui_print "  Sistem belum boot penuh, pengecekan fitur dilewati."
fi

ui_print "- Mengatur permission"

set_perm_recursive "$MODPATH" 0 0 0755 0644

for f in tkm daemon.sh service.sh apply_profile.sh uninstall.sh system/bin/tkm webroot/cgi-bin/api.sh; do
    [ -f "$MODPATH/$f" ] && set_perm "$MODPATH/$f" 0 0 0755
done

ui_print "- Selesai"
