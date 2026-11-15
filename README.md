# Kernel Manager

Modul KernelSU/Magisk per aplikasi (target: MediaTek MT6789 / Transsion).
Daemon memantau aplikasi foreground, lalu menerapkan profil (mode) yang sesuai.
Pengaturan bisa lewat WebUI (port 8088), lewat CLI `tkm`, atau langsung edit `perapp.conf`.

## Isi modul

| File | Fungsi |
|---|---|
| `daemon.sh` | Pemantau aplikasi foreground, menerapkan profil, reload otomatis |
| `apply_profile.sh` | menulis nilai ke sysfs/proc |
| `profiles.conf` | Definisi mode bawaan (gaming, performance, balanced, battery, powersave, sleep) |
| `perapp.conf` | Aturan per aplikasi: mode + detail fitur |
| `perapp_type.conf` | Penanda app `user` / `system` (dipakai WebUI) |
| `tkm`, `system/bin/tkm` | CLI |
| `webroot/` | WebUI dan API (`cgi-bin/api.sh`) |
| `service.sh` | Menjalankan daemon dan web server saat boot |

Lokasi di perangkat: `/data/adb/modules/kernel-manager/`


## Format perapp.conf

```
DEFAULT=balanced                      # mode untuk app tanpa aturan
com.brave.browser=gaming              # <package>=<mode>
com.brave.browser:REFRESH_RATE=90     # <package>:<KEY>=<nilai>  (detail)
com.brave.browser:GPU_MAX=1000000
```


### Daftar key

| KEY | Isi / contoh |
|---|---|
| `CPU_L_GOV` | governor cluster little: `schedutil` / `performance` / `powersave` |
| `CPU_L_MIN`, `CPU_L_MAX` | frekuensi little (kHz), mis. 500000 / 1800000 |
| `CPU_B_GOV` | governor cluster big |
| `CPU_B_MIN`, `CPU_B_MAX` | frekuensi big (kHz), mis. 725000 / 2200000 |
| `GPU_MIN`, `GPU_MAX` | frekuensi GPU (kHz), mis. 390000 / 1100000 |
| `GPU_BOOST` | 0 / 1 (GED boost) |
| `GPU_BOOST_FREQ` | frekuensi boost GPU (kHz) |
| `GPU_LOCK_OPP` | index OPP GPU yang dikunci, `-1` = tidak dikunci |
| `UCLAMP_MIN`, `UCLAMP_MAX` | uclamp top-app, 0.00 - 100.00 |
| `UCLAMP_LATENCY` | 0 / 1 |
| `BORE_SCALE` | `sched_burst_penalty_scale`, mis. 800 - 2000 |
| `TRANS_SCHED` | 0 / 1 (Transsion scheduler) |
| `TRANS_LOCK_TUNER` | 0 - 7 |
| `SCHED_RATE` | schedutil `rate_limit_us`, mis. 500 - 5000 |
| `GAME_MODE` | 0 / 1 |
| `REFRESH_RATE` | `0` = auto (60-120), atau 60 / 90 / 120 / 144 |
| `EAS_ENABLE` | 0 / 1 |
| `BG_CPUS` | cpuset background, mis. `0-1` / `0-3` |
| `GPU_DVFS` | 0 / 1 |
| `TCP_CONG` | `cubic` / `bbr` |
| `SWAPPINESS` | 0 - 200 |

## Perintah tkm

Jalankan dengan root: `su -c "tkm <perintah>"`

| Perintah | Fungsi |
|---|---|
| `tkm expand <pkg>` | Tulis semua 25 fitur app ke `perapp.conf` |
| `tkm expand_user` | Sama, untuk semua app user |
| `tkm show <pkg>` | Tampilkan nilai efektif; tanda `*` = hasil override |
| `tkm unexpand <pkg>` | Hapus detail, app kembali ikut mode |
| `tkm keys` | Daftar key yang dikenal |
| `tkm set <pkg> <mode>` | Set mode app (menghapus detail app tsb) |
| `tkm set_batch <mode> <pkg...>` | Set mode banyak app sekaligus |
| `tkm remove <pkg>` | Hapus aturan app beserta detailnya |
| `tkm list` | Tampilkan isi aturan |
| `tkm force <mode>` / `tkm unforce` | Kunci / lepas profil manual |
| `tkm reload` | Paksa daemon memuat ulang konfigurasi |
| `tkm restart` | Restart daemon |


