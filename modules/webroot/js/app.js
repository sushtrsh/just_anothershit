(() => {
  'use strict';

  const TKM = '/data/adb/modules/kernel-manager/tkm';
  const BASE_DIR = '/data/adb/modules/kernel-manager';

  let telemetryTimer = null;
  let activeTab = 'dashboard';
  let selectedQuickProf = 'balanced';
  let currentOperatingMode = 'dynamic';
  let allRules = [];
  let profilesConfRaw = '';
  let parsedProfiles = {};

  let currentLang = localStorage.getItem('tkm_lang') || 'id';

  const I18N = {
    id: {
      hero_prof_label: 'Profil Kernel Aktif',
      hero_mode_label: 'Mode Kontrol',
      hero_mode_dyn: 'Dinamis (Per-App)',
      hero_mode_lock: 'Terkunci',
      hero_app_label: 'Aplikasi:',
      hero_bat_label: 'Baterai:',
      hero_temp_label: 'Suhu CPU:',
      web_title: '🌐 Fitur Buka di Website (Laptop / Browser Luar)',
      web_info_on: 'Web server aktif! Bisa dibuka di browser laptop/perangkat lain:',
      web_info_off: 'Aktifkan agar dashboard bisa dibuka di browser laptop via adb forward port 8088',
      web_copy: 'Salin URL',
      web_copied: 'URL berhasil disalin!',
      web_btn_on: 'Matikan Server',
      web_btn_off: 'Aktifkan Server',
      card_prof_title: '⚡ Pilihan Profil Kernel',
      mode_dyn_btn: '🔄 Mode Dinamis (Per-App)',
      mode_lock_btn: '🔒 Kunci Manual (Tetap Aktif)',
      dyn_info: 'Mode Dinamis: Profil berubah otomatis mengikuti aplikasi yang dibuka.',
      dyn_set_default: 'Set {name} Jadi Default',
      dyn_lock_btn: '🔒 Kunci Profil {name} Secara Permanen',
      lock_info: '🔒 Profil saat ini terkunci secara permanen. Tidak akan kembali ke balanced saat ganti aplikasi.',
      lock_unlock_btn: '🔄 Buka Kunci (Kembali ke Mode Dinamis Per-App)',
      card_cpu_title: '🔥 Frekuensi CPU Clusters',
      card_gpu_title: '🎮 Mali GPU & Kernel Scheduler',
      trans_sched_title: '⚡ Transsion Scheduler (trans_sched)',
      trans_sched_desc: 'Akselerasi UX mutex & pipeline frame in-kernel khusus Infinix/Transsion',
      nav_status: 'Status',
      nav_perapp: 'Per-App',
      nav_tuner: 'Tuner',
      nav_logs: 'Logs',
      nav_cli: 'CLI'
    },
    en: {
      hero_prof_label: 'Active Kernel Profile',
      hero_mode_label: 'Control Mode',
      hero_mode_dyn: 'Dynamic (Per-App)',
      hero_mode_lock: 'Locked',
      hero_app_label: 'App:',
      hero_bat_label: 'Battery:',
      hero_temp_label: 'CPU Temp:',
      web_title: '🌐 Web Dashboard (Laptop / External Browser)',
      web_info_on: 'Web server is running! Open in laptop browser via adb forward port 8088:',
      web_info_off: 'Enable this to open dashboard in your laptop browser via adb forward port 8088',
      web_copy: 'Copy URL',
      web_copied: 'URL copied to clipboard!',
      web_btn_on: 'Stop Server',
      web_btn_off: 'Start Server',
      card_prof_title: '⚡ Kernel Profiles',
      mode_dyn_btn: '🔄 Dynamic Mode (Per-App)',
      mode_lock_btn: '🔒 Manual Lock (Persistent)',
      dyn_info: 'Dynamic Mode: Profile switches automatically based on running foreground app.',
      dyn_set_default: 'Set {name} as Default',
      dyn_lock_btn: '🔒 Lock Profile {name} Permanently',
      lock_info: '🔒 Profile is currently locked permanently. It will not switch back when changing apps.',
      lock_unlock_btn: '🔄 Unlock (Return to Dynamic Mode)',
      card_cpu_title: '🔥 CPU Cluster Frequencies',
      card_gpu_title: '🎮 Mali GPU & Kernel Scheduler',
      trans_sched_title: '⚡ Transsion Scheduler (trans_sched)',
      trans_sched_desc: 'In-kernel UX mutex & frame pipeline acceleration tailored for Infinix/Transsion',
      nav_status: 'Status',
      nav_perapp: 'Per-App',
      nav_tuner: 'Tuner',
      nav_logs: 'Logs',
      nav_cli: 'CLI'
    }
  };

  function applyLanguage(lang) {
    currentLang = lang;
    localStorage.setItem('tkm_lang', lang);

    const langBadge = document.getElementById('lang-code-text');
    if (langBadge) {
      langBadge.textContent = lang.toUpperCase();
    }

    const dict = I18N[lang] || I18N.id;
    document.querySelectorAll('[data-i18n]').forEach(el => {
      const key = el.getAttribute('data-i18n');
      if (dict[key]) {
        el.textContent = dict[key];
      }
    });

    updateProfileButtonsUI();
  }

  window.toggleLanguage = function() {
    const nextLang = currentLang === 'id' ? 'en' : 'id';
    applyLanguage(nextLang);
    showToast(nextLang === 'id' ? 'Bahasa: Indonesia' : 'Language: English', 'info');
  };

  let appsData = { user: [], system: [] };
  let currentAppFilterType = 'user';

  function debounce(fn, delayMs = 200) {
    let timer = null;
    return function(...args) {
      clearTimeout(timer);
      timer = setTimeout(() => fn.apply(this, args), delayMs);
    };
  }

  let ksuSeq = 0;
  function execCommand(cmd, timeoutMs = 8000) {
    return new Promise((resolve) => {

      if (typeof window.ksu !== 'undefined' && typeof window.ksu.exec === 'function') {
        const cb = `_ksu_cb_${Date.now()}_${ksuSeq++}`;
        let timeoutHandle = null;

        window[cb] = (errno, stdout, stderr) => {
          if (timeoutHandle) clearTimeout(timeoutHandle);
          delete window[cb];
          resolve({ errno: Number(errno), stdout: stdout || '', stderr: stderr || '' });
        };

        timeoutHandle = setTimeout(() => {
          if (window[cb]) {
            delete window[cb];
            resolve({ errno: -1, stdout: '', stderr: 'Command timeout' });
          }
        }, timeoutMs);

        try {
          window.ksu.exec(cmd, '{}', cb);
        } catch (e) {
          if (timeoutHandle) clearTimeout(timeoutHandle);
          delete window[cb];
          resolve({ errno: -1, stdout: '', stderr: e.message });
        }
        return;
      }

      const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
      const abortTimer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;

      fetch(`/cgi-bin/api.sh?action=exec&cmd=${encodeURIComponent(cmd)}`, {
        signal: controller ? controller.signal : undefined
      })
        .then(r => r.json())
        .then(data => {
          if (abortTimer) clearTimeout(abortTimer);
          resolve({ errno: 0, stdout: data.output || '', stderr: '' });
        })
        .catch(err => {
          if (abortTimer) clearTimeout(abortTimer);
          resolve({ errno: -1, stdout: '', stderr: err.message || 'CGI connection failed' });
        });
    });
  }

  let toastTimer = null;
  function showToast(msg, type = 'info') {
    const t = document.getElementById('toast');
    t.textContent = msg;
    t.className = `show ${type}`;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.className = ''; }, 3000);
  }

  window.switchNav = function(tab) {
    const prevTab = activeTab;
    activeTab = tab;
    const tabs = ['dashboard', 'perapp', 'tuner', 'logs', 'terminal'];
    document.querySelectorAll('.nav-item').forEach((btn, idx) => {
      btn.classList.toggle('active', tabs[idx] === tab);
    });
    document.querySelectorAll('.view-content').forEach(view => {
      view.classList.remove('active');
    });
    const target = document.getElementById(`view-${tab}`);
    if (target) target.classList.add('active');

    if (tab === 'dashboard') {
      scheduleTelemetry(0);
    } else {
      scheduleTelemetry(3500);
    }

    if (tab === 'perapp') loadRules();
    else if (tab === 'tuner') loadProfilesConf();
    else if (tab === 'logs') refreshLogs();
  };

  window.onProfileClick = function(prof) {
    selectedQuickProf = prof;
    updateProfileButtonsUI();

    if (currentOperatingMode === 'locked') {

      lockSelectedProfile();
    }
  };

  function updateProfileButtonsUI() {
    document.querySelectorAll('.prof-btn').forEach(btn => {
      btn.classList.toggle('selected', btn.getAttribute('data-prof') === selectedQuickProf);
    });
    const title = selectedQuickProf.charAt(0).toUpperCase() + selectedQuickProf.slice(1);
    const dynName = document.getElementById('dyn-sel-prof-name');
    if (dynName) dynName.textContent = title;
    const lockName = document.getElementById('btn-lock-prof-name');
    if (lockName) lockName.textContent = title;

    const dict = I18N[currentLang] || I18N.id;
    const dynInfoBtn = document.querySelector('#dynamic-mode-controls .mode-info-box button');
    if (dynInfoBtn && dict.dyn_set_default) {
      dynInfoBtn.innerHTML = dict.dyn_set_default.replace('{name}', `<span id="dyn-sel-prof-name">${title}</span>`);
    }
    const lockBtn = document.querySelector('.override-actions .btn-warn');
    if (lockBtn && dict.dyn_lock_btn) {
      lockBtn.innerHTML = dict.dyn_lock_btn.replace('{name}', `<span id="btn-lock-prof-name">${title}</span>`);
    }
  }

  window.setMode = async function(mode) {
    if (mode === 'locked') {
      currentOperatingMode = 'locked';
      document.getElementById('btn-mode-dynamic').classList.remove('active');
      document.getElementById('btn-mode-locked').classList.add('active', 'locked');
      document.getElementById('dynamic-mode-controls').style.display = 'none';
      document.getElementById('locked-mode-controls').style.display = 'block';
      await lockSelectedProfile();
    } else {
      currentOperatingMode = 'dynamic';
      document.getElementById('btn-mode-dynamic').classList.add('active');
      document.getElementById('btn-mode-locked').classList.remove('active', 'locked');
      document.getElementById('dynamic-mode-controls').style.display = 'block';
      document.getElementById('locked-mode-controls').style.display = 'none';
      await unlockProfile();
    }
  };

  window.lockSelectedProfile = async function() {
    const prof = selectedQuickProf;
    showToast(`Mengunci profil ke: ${prof}...`, 'warn');
    await execCommand(`sh ${TKM} force ${prof}`);
    showToast(`🔒 Profil TERKUNCI ke ${prof}! Tetap aktif untuk semua aplikasi.`, 'success');
    refreshTelemetry();
  };

  window.unlockProfile = async function() {
    showToast('Membuka kunci manual...');
    await execCommand(`sh ${TKM} unforce`);
    showToast('🔄 Mode Dinamis Aktif! Profil otomatis mengikuti aplikasi.', 'success');
    refreshTelemetry();
  };

  window.setDefaultProfileFromSelection = async function() {
    const prof = selectedQuickProf;
    showToast(`Menjadikan ${prof} sebagai profil default...`);
    await execCommand(`sed -i '/^DEFAULT=/d' ${BASE_DIR}/perapp.conf && echo "DEFAULT=${prof}" >> ${BASE_DIR}/perapp.conf && touch ${BASE_DIR}/reload_trigger`);
    showToast(`Default sistem diubah ke ${prof}`, 'success');
    refreshTelemetry();
  };

  let isFetchingTelemetry = false;
  function scheduleTelemetry(delayMs = 1800) {
    if (telemetryTimer) clearTimeout(telemetryTimer);
    if (document.hidden) return;
    telemetryTimer = setTimeout(refreshTelemetry, delayMs);
  }

  async function refreshTelemetry() {
    if (isFetchingTelemetry) return;
    if (document.hidden) return;

    isFetchingTelemetry = true;
    try {
      let data = null;
      if (typeof window.ksu !== 'undefined') {
        const res = await execCommand(`sh ${TKM} json`);
        if (res.errno === 0 && res.stdout) {
          data = JSON.parse(res.stdout.trim());
        }
      } else {
        const r = await fetch(`/cgi-bin/api.sh?action=json`);
        data = await r.json();
      }

      if (data) {
        updateTelemetryUI(data);
      }
    } catch (e) {

    } finally {
      isFetchingTelemetry = false;

      const nextDelay = activeTab === 'dashboard' ? 1800 : 4000;
      scheduleTelemetry(nextDelay);
    }
  }

  function updateTelemetryUI(data) {

    const pillDaemon = document.getElementById('pill-daemon');
    if (pillDaemon) {
      if (data.daemon && data.daemon.running) {
        pillDaemon.className = 'pill-dot active';
        pillDaemon.title = `Daemon Aktif (PID: ${data.daemon.pid})`;
      } else {
        pillDaemon.className = 'pill-dot danger';
        pillDaemon.title = 'Daemon Mati';
      }
    }

    const pillBridge = document.getElementById('pill-bridge');
    if (pillBridge) {
      if (typeof window.ksu !== 'undefined') {
        pillBridge.style.display = 'none';
      } else {
        pillBridge.className = 'pill';
        pillBridge.innerHTML = `<span class="dot"></span>HTTP:8088`;
      }
    }

    const isLocked = Boolean(data.manual_lock && data.manual_lock !== '');
    currentOperatingMode = isLocked ? 'locked' : 'dynamic';

    const lockBadge = document.getElementById('lock-status-badge');
    const heroMode = document.getElementById('hero-mode-text');
    const dict = I18N[currentLang] || I18N.id;

    if (isLocked) {
      document.getElementById('btn-mode-dynamic').classList.remove('active');
      document.getElementById('btn-mode-locked').classList.add('active', 'locked');
      document.getElementById('dynamic-mode-controls').style.display = 'none';
      document.getElementById('locked-mode-controls').style.display = 'block';

      if (lockBadge) {
        lockBadge.textContent = `${dict.hero_mode_lock}: ${data.manual_lock}`;
        lockBadge.style.color = 'var(--battery)';
      }
      heroMode.textContent = `${dict.hero_mode_lock} (${data.manual_lock})`;
      heroMode.style.color = 'var(--battery)';

      selectedQuickProf = data.manual_lock;
      updateProfileButtonsUI();
    } else {
      document.getElementById('btn-mode-dynamic').classList.add('active');
      document.getElementById('btn-mode-locked').classList.remove('active', 'locked');
      document.getElementById('dynamic-mode-controls').style.display = 'block';
      document.getElementById('locked-mode-controls').style.display = 'none';

      if (lockBadge) {
        lockBadge.textContent = dict.hero_mode_dyn;
        lockBadge.style.color = 'var(--accent)';
      }
      heroMode.textContent = dict.hero_mode_dyn;
      heroMode.style.color = 'var(--accent)';
    }

    const heroProfName = document.getElementById('hero-profile-name');
    const heroProfTag = document.getElementById('hero-profile-tag');
    const prof = data.active_profile || 'balanced';
    heroProfName.textContent = prof.charAt(0).toUpperCase() + prof.slice(1);
    heroProfTag.textContent = prof;
    heroProfTag.className = `prof-tag prof-${prof}`;

    document.getElementById('hero-fg-pkg').textContent = data.foreground || 'Tidak ada';
    document.getElementById('hero-battery').textContent = `${data.battery.level}% (${data.battery.temp}°C)`;
    document.getElementById('hero-cpu-temp').textContent = `${data.thermal.cpu}°C`;

    const lCur = Math.round(Number(data.cpu_little.cur) / 1000);
    const lMin = Math.round(Number(data.cpu_little.min) / 1000);
    const lMax = Math.round(Number(data.cpu_little.max) / 1000);
    document.getElementById('l-gov').textContent = data.cpu_little.gov;
    document.getElementById('l-cur-freq').textContent = `${lCur} MHz`;
    document.getElementById('l-min-freq').textContent = lMin;
    document.getElementById('l-max-freq').textContent = lMax;
    const lScale = Math.min(1, Math.max(0, lCur / 2000));
    document.getElementById('l-bar').style.transform = `scaleX(${lScale.toFixed(3)})`;

    const bCur = Math.round(Number(data.cpu_big.cur) / 1000);
    const bMin = Math.round(Number(data.cpu_big.min) / 1000);
    const bMax = Math.round(Number(data.cpu_big.max) / 1000);
    document.getElementById('b-gov').textContent = data.cpu_big.gov;
    document.getElementById('b-cur-freq').textContent = `${bCur} MHz`;
    document.getElementById('b-min-freq').textContent = bMin;
    document.getElementById('b-max-freq').textContent = bMax;
    const bScale = Math.min(1, Math.max(0, bCur / 2200));
    document.getElementById('b-bar').style.transform = `scaleX(${bScale.toFixed(3)})`;

    const gMin = Math.round(Number(data.gpu.min) / 1000);
    const gMax = Math.round(Number(data.gpu.max) / 1000);
    document.getElementById('gpu-range').textContent = `${gMin} - ${gMax} MHz`;
    const gBoost = document.getElementById('gpu-boost');
    gBoost.textContent = data.gpu.boost === '1' ? 'ON (Boosted)' : 'OFF';
    gBoost.style.color = data.gpu.boost === '1' ? 'var(--gaming)' : 'var(--text-muted)';

    document.getElementById('bore-scale').textContent = data.bore.scale || '1280';
    document.getElementById('uclamp-val').textContent = `${Math.round(data.uclamp.min)}% - ${Math.round(data.uclamp.max)}%`;

    const gBoostFreq = Math.round(Number((data.gpu && data.gpu.boost_freq) || 0) / 1000);
    const gBoostFreqEl = document.getElementById('gpu-boost-freq');
    if (gBoostFreqEl) gBoostFreqEl.textContent = gBoostFreq > 0 ? `${gBoostFreq} MHz` : '--';

    const schedRateEl = document.getElementById('sched-rate');
    if (schedRateEl) schedRateEl.textContent = (data.schedutil && data.schedutil.rate_limit_us) ? `${data.schedutil.rate_limit_us} µs` : '1000 µs';

    const tsPill = document.getElementById('trans-sched-pill');
    const tsBtn = document.getElementById('btn-toggle-trans-sched');
    const isTsActive = Boolean(data.trans_sched && data.trans_sched.enabled);
    if (tsPill) {
      tsPill.className = isTsActive ? 'pill active' : 'pill';
      tsPill.textContent = isTsActive ? '0x7FF (Aktif)' : '0x00 (Off)';
    }
    if (tsBtn) {
      if (isTsActive) {
        tsBtn.textContent = 'Aktif (Klik matikan)';
        tsBtn.style.borderColor = 'var(--accent)';
        tsBtn.style.color = 'var(--accent)';
      } else {
        tsBtn.textContent = 'Mati (Klik aktifkan)';
        tsBtn.style.borderColor = 'var(--surface-border)';
        tsBtn.style.color = 'var(--text-muted)';
      }
    }

    if (data.web_server) {
      const isWebOn = Boolean(data.web_server.running);
      const webUrl = 'http://127.0.0.1:8088';

      const webPill = document.getElementById('web-pill');
      const webBtn = document.getElementById('btn-web-toggle');
      const webInfo = document.getElementById('web-info-text');
      const webUrlBox = document.getElementById('web-url-box');
      const webUrlText = document.getElementById('web-url-text');
      const logWebBtn = document.getElementById('btn-log-web-toggle');
      const logWebDesc = document.getElementById('log-web-status-desc');

      if (webPill) {
        webPill.className = isWebOn ? 'pill active' : 'pill';
        webPill.textContent = isWebOn ? '🟢 ON (Aktif)' : '🔴 OFF (Mati)';
      }
      if (webBtn) {
        if (isWebOn) {
          webBtn.textContent = dict.web_btn_on;
          webBtn.className = 'btn btn-danger';
        } else {
          webBtn.textContent = dict.web_btn_off;
          webBtn.className = 'btn btn-primary';
        }
      }
      if (webInfo) {
        webInfo.textContent = isWebOn ? dict.web_info_on : dict.web_info_off;
      }
      if (webUrlBox) {
        webUrlBox.style.display = isWebOn ? 'flex' : 'none';
      }
      if (webUrlText) {
        webUrlText.textContent = webUrl;
      }
      if (logWebBtn) {
        logWebBtn.textContent = isWebOn ? 'Matikan' : 'Aktifkan';
        logWebBtn.className = isWebOn ? 'btn btn-danger' : 'btn btn-primary';
      }
      if (logWebDesc) {
        logWebDesc.textContent = isWebOn ? `Aktif di ${webUrl}` : 'Nonaktif (Website ditutup)';
      }
    }
  }

  window.toggleWebServer = async function() {
    showToast('Mengubah status Web Server...');
    if (typeof window.ksu !== 'undefined') {
      const res = await execCommand(`sh ${TKM} web toggle`);
      showToast(res.stdout || 'Status Web Server diubah!', 'success');
    } else {
      try {
        await fetch(`/cgi-bin/api.sh?action=web_toggle`);
        showToast('Status Web Server diubah!', 'success');
      } catch (e) {
        showToast('Koneksi terputus (Web Server dimatikan)', 'warn');
      }
    }
    setTimeout(refreshTelemetry, 600);
  };

  window.copyWebUrl = function() {
    const text = document.getElementById('web-url-text').textContent;
    const dict = I18N[currentLang] || I18N.id;
    if (navigator.clipboard) {
      navigator.clipboard.writeText(text);
      showToast(dict.web_copied, 'success');
    } else {
      prompt(dict.web_copy + ':', text);
    }
  };

  window.toggleTransSched = async function() {
    showToast('Mengubah status Transsion Scheduler...');
    if (typeof window.ksu !== 'undefined') {
      await execCommand(`sh ${TKM} trans_sched toggle`);
    } else {
      try {
        await fetch(`/cgi-bin/api.sh?action=toggle_trans_sched`);
      } catch (e) {
        await execCommand(`sh ${TKM} trans_sched toggle`);
      }
    }
    showToast('Status Transsion Scheduler diperbarui!', 'success');
    refreshTelemetry();
  };

  let appsLoadPromise = null;
  let systemPkgSet = new Set();
  function ensureAppsData() {
    if (appsData.user.length || appsData.system.length) return Promise.resolve();
    if (appsLoadPromise) return appsLoadPromise;
    appsLoadPromise = (async () => {
      try {
        const res = await execCommand(`sh ${TKM} get_installed_apps json`);
        if (res.stdout) {
          try {
            const parsed = JSON.parse(res.stdout.trim());
            appsData.user = parsed.user || [];
            appsData.system = parsed.system || [];
          } catch (e) {
            appsData.user = res.stdout.trim().split('\n');
            appsData.system = [];
          }
          systemPkgSet = new Set(appsData.system);
        }
      } finally {
        appsLoadPromise = null;
      }
    })();
    return appsLoadPromise;
  }

  (window.requestIdleCallback || function (f) { return setTimeout(f, 1500); })(function () {
    ensureAppsData().catch(function () {});
  });

  let deleteMode = false;
  const deleteSelected = new Set();

  let currentRulesTab = 'user';

  let typeMap = {};
  async function loadTypes() {
    const res = await execCommand(`sh ${TKM} get_types`);
    if (res.stdout) {
      try { typeMap = JSON.parse(res.stdout.trim()) || {}; } catch (e) {}
    }
  }

  function isSystemRule(pkg) {
    const t = typeMap[pkg];
    if (t === 'system') return true;
    if (t === 'user') return false;
    return systemPkgSet.has(pkg);
  }

  async function saveTypeMarks(pkgs) {
    const sys = [], usr = [];
    pkgs.forEach(p => { (systemPkgSet.has(p) ? sys : usr).push(p); });
    for (const [type, list] of [['system', sys], ['user', usr]]) {
      if (!list.length) continue;
      list.forEach(p => { typeMap[p] = type; });
      await execCommand(`sh ${TKM} set_type ${type} ${list.map(p => `"${p}"`).join(' ')}`);
    }
  }

  function backfillTypeMarks() {
    const known = new Set([...appsData.user, ...appsData.system]);
    const missing = allRules.map(r => r.pkg).filter(p => !typeMap[p] && known.has(p));
    if (missing.length) saveTypeMarks(missing).catch(function () {});
  }

  window.setRulesTab = function(tab) {
    currentRulesTab = (tab === 'system') ? 'system' : 'user';
    deleteSelected.clear();
    applyRulesView();
    if (typeof refreshDeleteUI === 'function') refreshDeleteUI();
  };

  function applyRulesView() {
    const el = document.getElementById('rule-search');
    const q = el ? el.value.toLowerCase().trim() : '';
    let nUser = 0, nSys = 0;
    allRules.forEach(r => { if (isSystemRule(r.pkg)) nSys++; else nUser++; });

    const bU = document.getElementById('rules-seg-user');
    const bS = document.getElementById('rules-seg-system');
    if (bU) { bU.textContent = `📱 Pengguna (${nUser})`; bU.classList.toggle('active', currentRulesTab === 'user'); }
    if (bS) { bS.textContent = `⚙️ Sistem (${nSys})`; bS.classList.toggle('active', currentRulesTab === 'system'); }

    const filtered = allRules.filter(r =>
      (currentRulesTab === 'system') === isSystemRule(r.pkg) &&
      (!q || r.pkg.toLowerCase().includes(q))
    );
    renderRulesList(filtered);
  }

  window.loadRules = async function() {
    const listEl = document.getElementById('rules-list');
    listEl.innerHTML = '<div style="text-align: center; color: var(--text-muted); padding: 20px;">Memuat aturan...</div>';

    let data = null;
    if (typeof window.ksu !== 'undefined') {
      const res = await execCommand(`sh ${TKM} list_json`);
      if (res.errno === 0 && res.stdout) {
        try { data = JSON.parse(res.stdout.trim()); } catch (e) {}
      }
    } else {
      try {
        const r = await fetch(`/cgi-bin/api.sh?action=rules`);
        data = await r.json();
      } catch (e) {}
    }

    if (!data) {
      listEl.innerHTML = '<div style="color: var(--powersave); padding: 10px;">Gagal memuat aturan</div>';
      return;
    }

    allRules = data.rules || [];
    if (data.default) {
      document.getElementById('select-default-prof').value = data.default;
    }
    await Promise.all([ensureAppsData().catch(function () {}), loadTypes().catch(function () {})]);
    backfillTypeMarks();
    applyRulesView();
  };

  function fmtFreq(f) {
    const num = parseInt(f, 10);
    if (!num || isNaN(num) || num <= 0) return '-';
    if (num >= 1000000) return (num / 1000000).toFixed(1) + 'G';
    return Math.round(num / 1000) + 'M';
  }

  function createRuleElement(r) {
    const isCustom = r.is_custom || (r.profile && r.profile.startsWith('custom_'));
    const profName = isCustom ? 'Kustom' : r.profile;
    const profBadge = `<span class="prof-tag ${isCustom ? 'prof-custom' : 'prof-' + r.profile}">${profName}</span>`;

    const lMax = fmtFreq(r.l_max);
    const bMax = fmtFreq(r.b_max);
    const gMax = fmtFreq(r.gpu_max);
    const hasTs = (r.trans_sched === '1' || r.trans_sched === 1);
    const hasGed = (r.gpu_boost === '1' || r.gpu_boost === 1);
    const hasUlat = (r.uclamp_lat === '1' || r.uclamp_lat === 1);
    const hasGameMode = (r.game_mode === '1' || r.game_mode === 1);
    const rr = parseInt(r.refresh_rate, 10);
    const hasEasOff = (r.eas_enable === '0' || r.eas_enable === 0);
    const isBgRestricted = (r.bg_cpus === '0-1' || r.bg_cpus === '0-2');
    const isGpuDvfsOff = (r.gpu_dvfs === '0' || r.gpu_dvfs === 0);
    const tcpCong = (r.tcp_cong && r.tcp_cong !== 'cubic') ? r.tcp_cong : '';
    const swp = (r.swappiness && r.swappiness !== '100') ? r.swappiness : '';

    const el = document.createElement('div');
    el.className = 'rule-item' + (deleteSelected.has(r.pkg) ? ' selected' : '');
    el.dataset.pkg = r.pkg;
    el.innerHTML = `
      <input type="checkbox" class="rule-check" data-pkg="${r.pkg}" ${deleteSelected.has(r.pkg) ? 'checked' : ''}>
      <div class="rule-left" style="flex: 1; min-width: 0;">
        <div class="rule-pkg" style="font-weight: 700; word-break: break-all;">
          <span>${r.pkg}</span>
        </div>
        <div style="display: flex; gap: 4px; flex-wrap: wrap; margin-top: 5px; align-items: center;">
          ${profBadge}
          <span class="info-chip" title="CPU Little Max Freq">Little: ${lMax}</span>
          <span class="info-chip" title="CPU Big Max Freq">Big: ${bMax}</span>
          <span class="info-chip" title="GPU Max Freq">GPU: ${gMax}</span>
          ${hasGameMode ? '<span class="info-chip chip-red" title="In-Kernel Game State Boost">🎮 GameMode</span>' : ''}
          ${rr > 0 ? `<span class="info-chip chip-cyan" title="Refresh Rate Terkunci">📺 ${rr}Hz</span>` : ''}
          ${hasTs ? `<span class="info-chip chip-green" title="Transsion UX Scheduler Boost">⚡ trans_sched${r.trans_lock_tuner ? ` (LT:${r.trans_lock_tuner})` : ''}</span>` : ''}
          ${hasGed ? '<span class="info-chip chip-accent" title="GED Smart Boost">🚀 GED</span>' : ''}
          ${isGpuDvfsOff ? '<span class="info-chip chip-orange" title="GPU DVFS Anti-Throttle">🛡️ Anti-Throttle</span>' : ''}
          ${hasUlat ? '<span class="info-chip chip-amber" title="UCLAMP Latency Sensitive">👆 Latency</span>' : ''}
          ${hasEasOff ? '<span class="info-chip chip-amber" title="EAS Nonaktif (Raw Perf)">⚡ No-EAS</span>' : ''}
          ${isBgRestricted ? `<span class="info-chip chip-purple" title="Background Core Dibatasi">🛑 BG:${r.bg_cpus}</span>` : ''}
          ${tcpCong ? `<span class="info-chip chip-blue" title="TCP Congestion Control">🌐 ${tcpCong.toUpperCase()}</span>` : ''}
          ${swp ? `<span class="info-chip" title="RAM Swappiness">🧠 Swap:${swp}</span>` : ''}
        </div>
      </div>
      <div class="rule-right" style="display: flex; align-items: center; gap: 6px;">
        <button class="btn btn-outline" data-action="edit-rule" data-pkg="${r.pkg}" style="padding: 4px 10px; font-size: 11px; border-color: var(--accent); color: var(--accent); flex: 0 0 auto;">
          ⚙️ Atur
        </button>
        <button class="btn-icon-del" data-action="delete-rule" data-pkg="${r.pkg}" title="Hapus aturan">
          <svg style="width: 16px; height: 16px; pointer-events: none;" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
        </button>
      </div>
    `;
    return el;
  }

  function renderRulesList(rules) {
    const listEl = document.getElementById('rules-list');
    if (!listEl) return;

    if (!rules || !rules.length) {
      listEl.innerHTML = `
        <div style="text-align: center; color: var(--text-muted); padding: 24px;">
          <div style="font-size: 28px; margin-bottom: 6px;">📱</div>
          <div>Belum ada aturan aplikasi ${currentRulesTab === 'system' ? 'sistem' : 'pengguna'}.</div>
          <div style="font-size: 11px; margin-top: 4px;">Klik tombol + di atas untuk menambahkan pengaturan kernel kustom.</div>
        </div>
      `;
      return;
    }

    const existingMap = new Map();
    listEl.querySelectorAll('.rule-item').forEach(el => {
      const pkg = el.dataset.pkg;
      if (pkg) existingMap.set(pkg, el);
    });

    const frag = document.createDocumentFragment();
    rules.forEach(r => {
      const existingEl = existingMap.get(r.pkg);
      const newEl = createRuleElement(r);
      if (existingEl) {
        existingMap.delete(r.pkg);
        if (existingEl.innerHTML !== newEl.innerHTML) {
          existingEl.innerHTML = newEl.innerHTML;
        }
        existingEl.className = newEl.className;
        frag.appendChild(existingEl);
      } else {
        frag.appendChild(newEl);
      }
    });

    existingMap.forEach(el => el.remove());

    if (listEl.querySelector('.rule-item') === null) {
      listEl.innerHTML = '';
    }
    listEl.appendChild(frag);
  }

  window.syncToggleVal = function(el, targetId) {
    document.getElementById(targetId).value = el.checked ? '1' : '0';
  };

  function setToggleState(toggleId, hiddenId, val) {
    const isChecked = (val === '1' || val === 1 || val === true || val === 'true');
    const tEl = document.getElementById(toggleId);
    const hEl = document.getElementById(hiddenId);
    if (tEl) tEl.checked = isChecked;
    if (hEl) hEl.value = isChecked ? '1' : '0';
  }

  let modalConfigLoaded = false;
  function ensureAppConfigModalLoaded() {
    if (modalConfigLoaded) return;
    const container = document.getElementById('modal-app-config-content');
    const tmpl = document.getElementById('tmpl-app-config-modal');
    if (container && tmpl) {
      container.appendChild(tmpl.content.cloneNode(true));
      modalConfigLoaded = true;
    }
  }

  (window.requestIdleCallback || function (f) { return setTimeout(f, 800); })(function () {
    try { ensureAppConfigModalLoaded(); } catch (e) {}
  });

  function setAppModalMode(mode) {
    const isAdd = (mode === 'add');
    const sec = document.getElementById('cfg-config-section');
    const save = document.getElementById('btn-save-config');
    const cancel = document.getElementById('btn-cancel-config');
    const title = document.getElementById('cfg-modal-title');
    const dlg = document.getElementById('modal-app-config');
    if (dlg) dlg.classList.toggle('add-mode', isAdd);
    if (sec) sec.style.display = isAdd ? 'none' : '';
    if (save) save.style.display = isAdd ? 'none' : '';
    if (cancel) cancel.textContent = isAdd ? 'Tutup' : 'Batal';
    if (title) title.textContent = isAdd ? '➕ Tambah Aplikasi' : '📱 Konfigurasi Kernel Per-Aplikasi';
  }

  window.openAddRuleModal = async function() {
    ensureAppConfigModalLoaded();
    setAppModalMode('add');
    selectedAppsSet.clear();
    onAppSelectionUpdated();
    document.getElementById('tune-app-target-pkg').value = '';
    document.getElementById('tune-app-pkg').textContent = 'Tambah Konfigurasi Baru';
    document.getElementById('cfg-app-select-box').style.display = 'block';

    applyQuickTemplate('balanced');

    const modal = document.getElementById('modal-app-config');
    modal.showModal();

    if (!appsData.user.length && !appsData.system.length) {
      document.getElementById('modal-app-picker').innerHTML =
        '<div style="padding: 10px; color: var(--text-muted); text-align: center;">Mengambil daftar aplikasi...</div>';
      await ensureAppsData();
    }
    filterAppPickerList(true);
  };

  window.openEditAppModal = async function(pkg) {
    if (!pkg) return;
    ensureAppConfigModalLoaded();
    setAppModalMode('edit');
    document.getElementById('tune-app-target-pkg').value = pkg;
    document.getElementById('tune-app-pkg').textContent = pkg;
    document.getElementById('cfg-app-select-box').style.display = 'none';

    const modal = document.getElementById('modal-app-config');
    modal.showModal();

    const cfgSec = document.getElementById('cfg-config-section');
    if (cfgSec) { cfgSec.style.opacity = '0.45'; cfgSec.style.pointerEvents = 'none'; }
    let data = null;

    if (typeof window.ksu !== 'undefined') {
      const res = await execCommand(`sh ${TKM} get_app_config ${pkg}`);
      if (res.errno === 0 && res.stdout) {
        try { data = JSON.parse(res.stdout.trim()); } catch (e) {}
      }
    } else {
      try {
        const r = await fetch(`/cgi-bin/api.sh?action=get_app_config&pkg=${encodeURIComponent(pkg)}`);
        data = await r.json();
      } catch (e) {}
    }

    if (data) {
      if (data.l_gov) document.getElementById('app-cpu-l-gov').value = data.l_gov;
      if (data.l_min) document.getElementById('app-cpu-l-min').value = String(data.l_min);
      if (data.l_max) document.getElementById('app-cpu-l-max').value = String(data.l_max);
      if (data.b_gov) document.getElementById('app-cpu-b-gov').value = data.b_gov;
      if (data.b_min) document.getElementById('app-cpu-b-min').value = String(data.b_min);
      if (data.b_max) document.getElementById('app-cpu-b-max').value = String(data.b_max);
      if (data.gpu_min) document.getElementById('app-gpu-min').value = String(data.gpu_min);
      if (data.gpu_max) document.getElementById('app-gpu-max').value = String(data.gpu_max);
      setToggleState('app-gpu-boost-toggle', 'app-gpu-boost', data.gpu_boost);
      if (data.gpu_boost_freq) document.getElementById('app-gpu-boost-freq').value = String(data.gpu_boost_freq);
      if (data.gpu_lock_opp !== undefined) document.getElementById('app-gpu-lock-opp').value = String(data.gpu_lock_opp);
      setToggleState('app-trans-sched-toggle', 'app-trans-sched', data.trans_sched);
      if (data.trans_lock_tuner !== undefined) document.getElementById('app-trans-lock-tuner').value = String(data.trans_lock_tuner);
      setToggleState('app-uclamp-lat-toggle', 'app-uclamp-lat', data.uclamp_latency);
      if (data.uclamp_min !== undefined) document.getElementById('app-uclamp-min').value = Number(data.uclamp_min).toFixed(2);
      if (data.uclamp_max !== undefined) document.getElementById('app-uclamp-max').value = Number(data.uclamp_max).toFixed(2);
      if (data.bore) document.getElementById('app-bore-scale').value = String(data.bore);
      if (data.sched_rate) document.getElementById('app-sched-rate').value = String(data.sched_rate);
      setToggleState('app-game-mode-toggle', 'app-game-mode', data.game_mode);
      if (data.refresh_rate !== undefined) document.getElementById('app-refresh-rate').value = String(data.refresh_rate);
      setToggleState('app-eas-toggle', 'app-eas', data.eas_enable !== undefined ? data.eas_enable : '1');
      if (data.bg_cpus) document.getElementById('app-bg-cpus').value = String(data.bg_cpus);
      setToggleState('app-gpu-dvfs-toggle', 'app-gpu-dvfs', data.gpu_dvfs !== undefined ? data.gpu_dvfs : '1');
      if (data.tcp_cong) document.getElementById('app-tcp-cong').value = String(data.tcp_cong);
      if (data.swappiness) document.getElementById('app-swappiness').value = String(data.swappiness);
    }
    if (cfgSec) { cfgSec.style.opacity = ''; cfgSec.style.pointerEvents = ''; }
  };

  window.closeAppConfigModal = function() {
    document.getElementById('modal-app-config').close();
  };

  window.closeAddRuleModal = window.closeAppConfigModal;
  window.closeAppClockspeedModal = window.closeAppConfigModal;
  window.openAppClockspeedModal = window.openEditAppModal;

  window.applyQuickTemplate = function(preset) {
    if (preset === 'gaming') {
      document.getElementById('app-cpu-l-gov').value = 'performance';
      document.getElementById('app-cpu-l-min').value = '1400000';
      document.getElementById('app-cpu-l-max').value = '2000000';
      document.getElementById('app-cpu-b-gov').value = 'performance';
      document.getElementById('app-cpu-b-min').value = '1800000';
      document.getElementById('app-cpu-b-max').value = '2200000';
      document.getElementById('app-gpu-min').value = '801000';
      document.getElementById('app-gpu-max').value = '1100000';
      setToggleState('app-gpu-boost-toggle', 'app-gpu-boost', '1');
      document.getElementById('app-gpu-boost-freq').value = '1100000';
      document.getElementById('app-gpu-lock-opp').value = '-1';
      setToggleState('app-trans-sched-toggle', 'app-trans-sched', '1');
      document.getElementById('app-trans-lock-tuner').value = '7';
      setToggleState('app-uclamp-lat-toggle', 'app-uclamp-lat', '1');
      document.getElementById('app-uclamp-min').value = '60.00';
      document.getElementById('app-uclamp-max').value = '100.00';
      document.getElementById('app-bore-scale').value = '800';
      document.getElementById('app-sched-rate').value = '500';
      setToggleState('app-game-mode-toggle', 'app-game-mode', '1');
      document.getElementById('app-refresh-rate').value = '120';
      setToggleState('app-eas-toggle', 'app-eas', '0');
      document.getElementById('app-bg-cpus').value = '0-1';
      setToggleState('app-gpu-dvfs-toggle', 'app-gpu-dvfs', '0');
      document.getElementById('app-tcp-cong').value = 'bbr';
      document.getElementById('app-swappiness').value = '40';
      showToast('Template Gaming Max dimuat!');
    } else if (preset === 'performance') {
      document.getElementById('app-cpu-l-gov').value = 'schedutil';
      document.getElementById('app-cpu-l-min').value = '1200000';
      document.getElementById('app-cpu-l-max').value = '2000000';
      document.getElementById('app-cpu-b-gov').value = 'schedutil';
      document.getElementById('app-cpu-b-min').value = '1500000';
      document.getElementById('app-cpu-b-max').value = '2200000';
      document.getElementById('app-gpu-min').value = '648000';
      document.getElementById('app-gpu-max').value = '1100000';
      setToggleState('app-gpu-boost-toggle', 'app-gpu-boost', '1');
      document.getElementById('app-gpu-boost-freq').value = '990000';
      document.getElementById('app-gpu-lock-opp').value = '-1';
      setToggleState('app-trans-sched-toggle', 'app-trans-sched', '1');
      document.getElementById('app-trans-lock-tuner').value = '7';
      setToggleState('app-uclamp-lat-toggle', 'app-uclamp-lat', '1');
      document.getElementById('app-uclamp-min').value = '40.00';
      document.getElementById('app-uclamp-max').value = '100.00';
      document.getElementById('app-bore-scale').value = '1000';
      document.getElementById('app-sched-rate').value = '1000';
      setToggleState('app-game-mode-toggle', 'app-game-mode', '0');
      document.getElementById('app-refresh-rate').value = '120';
      setToggleState('app-eas-toggle', 'app-eas', '1');
      document.getElementById('app-bg-cpus').value = '0-2';
      setToggleState('app-gpu-dvfs-toggle', 'app-gpu-dvfs', '1');
      document.getElementById('app-tcp-cong').value = 'bbr';
      document.getElementById('app-swappiness').value = '60';
      showToast('Template Performa dimuat!');
    } else if (preset === 'balanced') {
      document.getElementById('app-cpu-l-gov').value = 'schedutil';
      document.getElementById('app-cpu-l-min').value = '500000';
      document.getElementById('app-cpu-l-max').value = '2000000';
      document.getElementById('app-cpu-b-gov').value = 'schedutil';
      document.getElementById('app-cpu-b-min').value = '725000';
      document.getElementById('app-cpu-b-max').value = '2000000';
      document.getElementById('app-gpu-min').value = '390000';
      document.getElementById('app-gpu-max').value = '880000';
      setToggleState('app-gpu-boost-toggle', 'app-gpu-boost', '0');
      document.getElementById('app-gpu-boost-freq').value = '648000';
      document.getElementById('app-gpu-lock-opp').value = '-1';
      setToggleState('app-trans-sched-toggle', 'app-trans-sched', '1');
      document.getElementById('app-trans-lock-tuner').value = '7';
      setToggleState('app-uclamp-lat-toggle', 'app-uclamp-lat', '0');
      document.getElementById('app-uclamp-min').value = '10.00';
      document.getElementById('app-uclamp-max').value = '100.00';
      document.getElementById('app-bore-scale').value = '1280';
      document.getElementById('app-sched-rate').value = '1000';
      setToggleState('app-game-mode-toggle', 'app-game-mode', '0');
      document.getElementById('app-refresh-rate').value = '0';
      setToggleState('app-eas-toggle', 'app-eas', '1');
      document.getElementById('app-bg-cpus').value = '0-3';
      setToggleState('app-gpu-dvfs-toggle', 'app-gpu-dvfs', '1');
      document.getElementById('app-tcp-cong').value = 'cubic';
      document.getElementById('app-swappiness').value = '100';
      showToast('Template Balanced dimuat!');
    } else if (preset === 'battery') {
      document.getElementById('app-cpu-l-gov').value = 'schedutil';
      document.getElementById('app-cpu-l-min').value = '500000';
      document.getElementById('app-cpu-l-max').value = '1350000';
      document.getElementById('app-cpu-b-gov').value = 'schedutil';
      document.getElementById('app-cpu-b-min').value = '725000';
      document.getElementById('app-cpu-b-max').value = '1400000';
      document.getElementById('app-gpu-min').value = '390000';
      document.getElementById('app-gpu-max').value = '545000';
      setToggleState('app-gpu-boost-toggle', 'app-gpu-boost', '0');
      document.getElementById('app-gpu-boost-freq').value = '390000';
      document.getElementById('app-gpu-lock-opp').value = '-1';
      setToggleState('app-trans-sched-toggle', 'app-trans-sched', '0');
      document.getElementById('app-trans-lock-tuner').value = '0';
      setToggleState('app-uclamp-lat-toggle', 'app-uclamp-lat', '0');
      document.getElementById('app-uclamp-min').value = '0.00';
      document.getElementById('app-uclamp-max').value = '60.00';
      document.getElementById('app-bore-scale').value = '1600';
      document.getElementById('app-sched-rate').value = '3000';
      setToggleState('app-game-mode-toggle', 'app-game-mode', '0');
      document.getElementById('app-refresh-rate').value = '60';
      setToggleState('app-eas-toggle', 'app-eas', '1');
      document.getElementById('app-bg-cpus').value = '0-3';
      setToggleState('app-gpu-dvfs-toggle', 'app-gpu-dvfs', '1');
      document.getElementById('app-tcp-cong').value = 'cubic';
      document.getElementById('app-swappiness').value = '100';
      showToast('Template Hemat Daya dimuat!');
    } else if (preset === 'powersave') {
      document.getElementById('app-cpu-l-gov').value = 'powersave';
      document.getElementById('app-cpu-l-min').value = '500000';
      document.getElementById('app-cpu-l-max').value = '1000000';
      document.getElementById('app-cpu-b-gov').value = 'powersave';
      document.getElementById('app-cpu-b-min').value = '725000';
      document.getElementById('app-cpu-b-max').value = '1000000';
      document.getElementById('app-gpu-min').value = '390000';
      document.getElementById('app-gpu-max').value = '390000';
      setToggleState('app-gpu-boost-toggle', 'app-gpu-boost', '0');
      document.getElementById('app-gpu-boost-freq').value = '390000';
      document.getElementById('app-gpu-lock-opp').value = '44';
      setToggleState('app-trans-sched-toggle', 'app-trans-sched', '0');
      document.getElementById('app-trans-lock-tuner').value = '0';
      setToggleState('app-uclamp-lat-toggle', 'app-uclamp-lat', '0');
      document.getElementById('app-uclamp-min').value = '0.00';
      document.getElementById('app-uclamp-max').value = '30.00';
      document.getElementById('app-bore-scale').value = '2000';
      document.getElementById('app-sched-rate').value = '5000';
      setToggleState('app-game-mode-toggle', 'app-game-mode', '0');
      document.getElementById('app-refresh-rate').value = '60';
      setToggleState('app-eas-toggle', 'app-eas', '1');
      document.getElementById('app-bg-cpus').value = '0-1';
      setToggleState('app-gpu-dvfs-toggle', 'app-gpu-dvfs', '1');
      document.getElementById('app-tcp-cong').value = 'cubic';
      document.getElementById('app-swappiness').value = '120';
      showToast('Template Powersave dimuat!');
    }
  };

  window.submitAppConfig = async function() {
    const pkg = document.getElementById('tune-app-target-pkg').value.trim();
    if (!pkg) {
      alert('Pilih atau masukkan nama package aplikasi terlebih dahulu!');
      return;
    }

    const l_gov = document.getElementById('app-cpu-l-gov').value;
    const l_min = document.getElementById('app-cpu-l-min').value;
    const l_max = document.getElementById('app-cpu-l-max').value;
    const b_gov = document.getElementById('app-cpu-b-gov').value;
    const b_min = document.getElementById('app-cpu-b-min').value;
    const b_max = document.getElementById('app-cpu-b-max').value;
    const gpu_min = document.getElementById('app-gpu-min').value;
    const gpu_max = document.getElementById('app-gpu-max').value;
    const gpu_boost = document.getElementById('app-gpu-boost').value;
    const gpu_boost_freq = document.getElementById('app-gpu-boost-freq').value;
    const gpu_lock_opp = document.getElementById('app-gpu-lock-opp').value;
    const trans_sched = document.getElementById('app-trans-sched').value;
    const trans_lock_tuner = document.getElementById('app-trans-lock-tuner').value;
    const u_lat = document.getElementById('app-uclamp-lat').value;
    const u_min = document.getElementById('app-uclamp-min').value;
    const u_max = document.getElementById('app-uclamp-max').value;
    const bore = document.getElementById('app-bore-scale').value;
    const sched_rate = document.getElementById('app-sched-rate').value;
    const game_mode = document.getElementById('app-game-mode').value;
    const refresh_rate = document.getElementById('app-refresh-rate').value;
    const eas_enable = document.getElementById('app-eas').value;
    const bg_cpus = document.getElementById('app-bg-cpus').value;
    const gpu_dvfs = document.getElementById('app-gpu-dvfs').value;
    const tcp_cong = document.getElementById('app-tcp-cong').value;
    const swappiness = document.getElementById('app-swappiness').value;

    showToast(`Menyimpan konfigurasi kernel untuk ${pkg}...`);

    if (typeof window.ksu !== 'undefined') {
      await execCommand(`sh ${TKM} set_custom ${pkg} ${l_gov} ${l_min} ${l_max} ${b_gov} ${b_min} ${b_max} ${gpu_min} ${gpu_max} ${gpu_boost} ${u_lat} ${bore} ${gpu_boost_freq} ${trans_sched} ${sched_rate} ${gpu_lock_opp} ${u_min} ${u_max} ${game_mode} ${refresh_rate} ${eas_enable} ${bg_cpus} ${gpu_dvfs} ${tcp_cong} ${swappiness} ${trans_lock_tuner}`);
    } else {
      try {
        const q = new URLSearchParams({
          action: 'save_custom',
          pkg: pkg,
          l_gov: l_gov,
          l_min: l_min,
          l_max: l_max,
          b_gov: b_gov,
          b_min: b_min,
          b_max: b_max,
          gpu_min: gpu_min,
          gpu_max: gpu_max,
          gpu_boost: gpu_boost,
          gpu_boost_freq: gpu_boost_freq,
          gpu_lock_opp: gpu_lock_opp,
          trans_sched: trans_sched,
          u_lat: u_lat,
          uclamp_min: u_min,
          uclamp_max: u_max,
          bore: bore,
          sched_rate: sched_rate,
          game_mode: game_mode,
          refresh_rate: refresh_rate,
          eas_enable: eas_enable,
          bg_cpus: bg_cpus,
          gpu_dvfs: gpu_dvfs,
          tcp_cong: tcp_cong,
          swappiness: swappiness,
          trans_lock_tuner: trans_lock_tuner
        });
        await fetch(`/cgi-bin/api.sh?${q.toString()}`);
      } catch (e) {
        await execCommand(`sh ${TKM} set_custom ${pkg} ${l_gov} ${l_min} ${l_max} ${b_gov} ${b_min} ${b_max} ${gpu_min} ${gpu_max} ${gpu_boost} ${u_lat} ${bore} ${gpu_boost_freq} ${trans_sched} ${sched_rate} ${gpu_lock_opp} ${u_min} ${u_max} ${game_mode} ${refresh_rate} ${eas_enable} ${bg_cpus} ${gpu_dvfs} ${tcp_cong} ${swappiness} ${trans_lock_tuner}`);
      }
    }

    showToast(`Pengaturan kernel ${pkg} berhasil disimpan!`, 'success');
    closeAppConfigModal();
    loadRules();
  };
  window.submitAppClockspeed = window.submitAppConfig;

  function doFilterRules() {
    const el = document.getElementById('rule-search');
    if (!el) return;
    applyRulesView();
  }
  window.filterRules = debounce(doFilterRules, 220);

  function visibleRulePkgs() {
    const q = (document.getElementById('rule-search')?.value || '').toLowerCase().trim();
    return allRules.filter(r =>
      (currentRulesTab === 'system') === isSystemRule(r.pkg) &&
      (!q || r.pkg.toLowerCase().includes(q))
    ).map(r => r.pkg);
  }

  function refreshDeleteUI() {
    const listEl = document.getElementById('rules-list');
    listEl.querySelectorAll('.rule-item').forEach(el => {
      const on = deleteSelected.has(el.dataset.pkg);
      el.classList.toggle('selected', on);
      const cb = el.querySelector('.rule-check');
      if (cb) cb.checked = on;
    });
    const btn = document.getElementById('btn-delete-selected');
    if (btn) {
      btn.textContent = `🗑 Delete (${deleteSelected.size})`;
      btn.disabled = deleteSelected.size === 0;
    }
  }

  window.toggleDeleteMode = function(force) {
    deleteMode = (typeof force === 'boolean') ? force : !deleteMode;
    deleteSelected.clear();
    document.getElementById('rules-list').classList.toggle('delete-mode', deleteMode);
    document.getElementById('delete-toolbar').style.display = deleteMode ? 'flex' : 'none';
    document.getElementById('btn-trash-mode').classList.toggle('active', deleteMode);
    refreshDeleteUI();
  };

  window.selectAllRules = function() {
    const pkgs = visibleRulePkgs();
    const allOn = pkgs.length > 0 && pkgs.every(p => deleteSelected.has(p));
    pkgs.forEach(p => allOn ? deleteSelected.delete(p) : deleteSelected.add(p));
    refreshDeleteUI();
  };

  window.deleteSelectedRules = async function() {
    const pkgs = Array.from(deleteSelected);
    if (!pkgs.length) return;
    if (!confirm(`Hapus ${pkgs.length} aturan terpilih?`)) return;
    showToast(`Menghapus ${pkgs.length} aturan...`);
    await execCommand(pkgs.map(p => `sh ${TKM} remove "${p}"`).join('; '));
    pkgs.forEach(p => delete typeMap[p]);
    showToast(`${pkgs.length} aturan dihapus`, 'success');
    toggleDeleteMode(false);
    loadRules();
  };

  window.deleteRule = async function(pkg) {
    if (!confirm(`Hapus konfigurasi untuk ${pkg}?`)) return;
    showToast(`Menghapus ${pkg}...`);
    await execCommand(`sh ${TKM} remove ${pkg}`);
    delete typeMap[pkg];
    showToast(`Aturan ${pkg} dihapus`, 'success');
    loadRules();
  };

  window.changeDefaultProfile = async function() {
    const val = document.getElementById('select-default-prof').value;
    showToast(`Mengubah default ke: ${val}...`);
    await execCommand(`sed -i '/^DEFAULT=/d' ${BASE_DIR}/perapp.conf && echo "DEFAULT=${val}" >> ${BASE_DIR}/perapp.conf && touch ${BASE_DIR}/reload_trigger`);
    showToast(`Default diubah ke ${val}`, 'success');
  };

  window.setAppFilterType = function(type) {
    currentAppFilterType = type;
    document.getElementById('seg-all').classList.toggle('active', type === 'all');
    document.getElementById('seg-user').classList.toggle('active', type === 'user');
    document.getElementById('seg-system').classList.toggle('active', type === 'system');
    filterAppPickerList(true);
  };

  let selectedAppsSet = new Set();

  window.toggleAppCheck = function(pkg, event) {
    if (event && event.target && event.target.tagName === 'INPUT') {
      return;
    }
    if (selectedAppsSet.has(pkg)) {
      selectedAppsSet.delete(pkg);
    } else {
      selectedAppsSet.add(pkg);
    }
    onAppSelectionUpdated();
  };

  window.onAppCheckChange = function(pkg, isChecked) {
    if (isChecked) {
      selectedAppsSet.add(pkg);
    } else {
      selectedAppsSet.delete(pkg);
    }
    onAppSelectionUpdated();
  };

  function onAppSelectionUpdated() {
    if (selectedAppsSet.size === 1) {
      const [singlePkg] = selectedAppsSet;
      document.getElementById('tune-app-target-pkg').value = singlePkg;
      document.getElementById('tune-app-pkg').textContent = singlePkg;
    } else if (selectedAppsSet.size === 0) {
      document.getElementById('tune-app-target-pkg').value = '';
      document.getElementById('tune-app-pkg').textContent = 'Tambah Konfigurasi Baru';
    } else {
      document.getElementById('tune-app-target-pkg').value = Array.from(selectedAppsSet).join(',');
      document.getElementById('tune-app-pkg').textContent = `${selectedAppsSet.size} Aplikasi Terpilih`;
    }

    const bar = document.getElementById('batch-action-bar');
    const countEl = document.getElementById('batch-selected-count');
    if (selectedAppsSet.size > 0) {
      if (bar) bar.style.display = 'block';
      if (countEl) countEl.textContent = `Terpilih: ${selectedAppsSet.size} aplikasi`;
    } else {
      if (bar) bar.style.display = 'none';
    }

    document.querySelectorAll('.app-picker-row').forEach(row => {
      const pkg = row.getAttribute('data-pkg');
      const isSel = selectedAppsSet.has(pkg);
      row.classList.toggle('selected', isSel);
      const chk = row.querySelector('.app-check-input');
      if (chk) chk.checked = isSel;
    });
  }

  window.selectAllFilteredApps = function() {
    document.querySelectorAll('.app-picker-row').forEach(row => {
      const pkg = row.getAttribute('data-pkg');
      if (pkg) selectedAppsSet.add(pkg);
    });
    onAppSelectionUpdated();
  };

  window.clearAppSelection = function() {
    selectedAppsSet.clear();
    onAppSelectionUpdated();
  };

  window.applyBatchSelectedApps = async function() {
    if (selectedAppsSet.size === 0) {
      showToast('Centang minimal satu aplikasi terlebih dahulu!', 'warn');
      return;
    }
    const prof = document.getElementById('batch-prof-select').value || 'balanced';
    const list = Array.from(selectedAppsSet);
    showToast(`Menyimpan ${list.length} aplikasi ke profil ${prof}...`);

    const pkgsArg = list.map(p => `"${p}"`).join(' ');
    let success = false;

    if (typeof window.ksu !== 'undefined') {
      const res = await execCommand(`sh ${TKM} set_batch "${prof}" ${pkgsArg}`);
      success = (res.errno === 0);
    } else {
      try {
        const pkgsQuery = encodeURIComponent(list.join(','));
        const resp = await fetch(`/cgi-bin/api.sh?action=set_batch&prof=${encodeURIComponent(prof)}&pkgs=${pkgsQuery}`);
        success = resp.ok;
      } catch (e) {
        const res = await execCommand(`sh ${TKM} set_batch "${prof}" ${pkgsArg}`);
        success = (res.errno === 0);
      }
    }

    if (success) {
      await saveTypeMarks(list);
      showToast(`${list.length} aplikasi berhasil ditambahkan ke profil ${prof}!`, 'success');
      currentRulesTab = list.every(p => isSystemRule(p)) ? 'system' : 'user';
      closeAppConfigModal();
      loadRules();
      refreshTelemetry();
    } else {
      showToast('Gagal menyimpan aturan batch. Silakan coba lagi.', 'error');
    }
  };

  function doFilterAppPickerList() {
    const searchEl = document.getElementById('modal-search-app');
    const q = (searchEl ? searchEl.value : '').toLowerCase().trim();
    const box = document.getElementById('modal-app-picker');
    if (!box) return;

    let pool = [];
    if (currentAppFilterType === 'all') {
      pool = [
        ...appsData.user.map(p => ({ pkg: p, type: 'user' })),
        ...appsData.system.map(p => ({ pkg: p, type: 'system' }))
      ];
    } else if (currentAppFilterType === 'user') {
      pool = appsData.user.map(p => ({ pkg: p, type: 'user' }));
    } else {
      pool = appsData.system.map(p => ({ pkg: p, type: 'system' }));
    }

    if (q) {
      pool = pool.filter(item => item.pkg.toLowerCase().includes(q));
    }

    if (!pool.length) {
      box.innerHTML = '<div style="padding: 10px; color: var(--text-muted); text-align: center;">Tidak ada aplikasi yang cocok</div>';
      return;
    }

    const ruleMap = {};
    if (Array.isArray(allRules)) {
      allRules.forEach(r => { ruleMap[r.pkg] = r.profile; });
    }

    const frag = document.createDocumentFragment();
    pool.slice(0, 300).forEach(item => {
      const isSel = selectedAppsSet.has(item.pkg);
      const existing = ruleMap[item.pkg];
      const row = document.createElement('div');
      row.className = `app-picker-row ${isSel ? 'selected' : ''}`;
      row.dataset.pkg = item.pkg;
      row.innerHTML = `
        <label class="app-checkbox-label">
          <input type="checkbox" class="app-check-input" ${isSel ? 'checked' : ''}>
        </label>
        <div class="app-picker-info">
          <span class="app-picker-pkg">${item.pkg}</span>
          ${existing ? `<span class="app-existing-badge">Aktif: ${existing}</span>` : ''}
        </div>
        <span class="tag-app-type ${item.type === 'user' ? 'tag-user' : 'tag-system'}">${item.type}</span>
      `;
      frag.appendChild(row);
    });

    box.innerHTML = '';
    box.appendChild(frag);
  }
  const debouncedFilterAppPicker = debounce(doFilterAppPickerList, 220);
  window.filterAppPickerList = function(immediate = false) {
    if (immediate) {
      doFilterAppPickerList();
    } else {
      debouncedFilterAppPicker();
    }
  };

  window.selectAppFromPicker = function(pkg) {
    toggleAppCheck(pkg);
  };

  window.loadProfilesConf = async function() {
    const res = await execCommand(`cat ${BASE_DIR}/profiles.conf`);
    if (res.stdout) {
      profilesConfRaw = res.stdout;
      document.getElementById('raw-conf-text').value = profilesConfRaw;
      parseProfilesConf(profilesConfRaw);
      renderProfileForm();
    }
  };

  function parseProfilesConf(text) {
    parsedProfiles = {};
    let curSection = null;
    text.split('\n').forEach(line => {
      line = line.trim();
      if (!line || line.startsWith('#')) return;
      if (line.startsWith('[') && line.endsWith(']')) {
        curSection = line.slice(1, -1);
        parsedProfiles[curSection] = {};
      } else if (curSection && line.includes('=')) {
        const [k, ...v] = line.split('=');
        parsedProfiles[curSection][k.trim()] = v.join('=').trim();
      }
    });
  }

  window.renderProfileForm = function() {
    const prof = document.getElementById('tune-prof-select').value;
    const data = parsedProfiles[prof] || {};
    const container = document.getElementById('tune-form-container');

    const lFreqs = [2000000, 1800000, 1600000, 1400000, 1200000, 1000000, 800000, 500000];
    const bFreqs = [2200000, 2000000, 1800000, 1600000, 1500000, 1400000, 1200000, 1000000, 725000];
    const gFreqs = [1100000, 1003000, 948000, 880000, 801000, 756000, 648000, 545000, 390000];

    container.innerHTML = `
      <!-- 1. CPU LITTLE CLUSTER -->
      <div style="font-weight: 700; font-size: 12px; color: #60a5fa; margin-bottom: 6px;">🔹 CPU Little Cluster (6x A55)</div>
      <div class="grid-3" style="margin-bottom: 12px;">
        <div class="form-group">
          <label>Governor</label>
          <select id="f-cpu-l-gov">
            <option value="schedutil" ${data.CPU_L_GOV==='schedutil'?'selected':''}>schedutil</option>
            <option value="performance" ${data.CPU_L_GOV==='performance'?'selected':''}>performance</option>
            <option value="powersave" ${data.CPU_L_GOV==='powersave'?'selected':''}>powersave</option>
            <option value="sugov_ext" ${data.CPU_L_GOV==='sugov_ext'?'selected':''}>sugov_ext</option>
          </select>
        </div>
        <div class="form-group">
          <label>Min Freq</label>
          <select id="f-cpu-l-min">
            ${lFreqs.slice().reverse().map(f => `<option value="${f}" ${(data.CPU_L_MIN||500000)==f?'selected':''}>${f/1000} MHz</option>`).join('')}
          </select>
        </div>
        <div class="form-group">
          <label>Max Freq</label>
          <select id="f-cpu-l-max">
            ${lFreqs.map(f => `<option value="${f}" ${(data.CPU_L_MAX||2000000)==f?'selected':''}>${f/1000} MHz</option>`).join('')}
          </select>
        </div>
      </div>

      <!-- 2. CPU BIG CLUSTER -->
      <div style="font-weight: 700; font-size: 12px; color: #c084fc; margin-bottom: 6px;">🔥 CPU Big Cluster (2x A76)</div>
      <div class="grid-3" style="margin-bottom: 12px;">
        <div class="form-group">
          <label>Governor</label>
          <select id="f-cpu-b-gov">
            <option value="schedutil" ${data.CPU_B_GOV==='schedutil'?'selected':''}>schedutil</option>
            <option value="performance" ${data.CPU_B_GOV==='performance'?'selected':''}>performance</option>
            <option value="powersave" ${data.CPU_B_GOV==='powersave'?'selected':''}>powersave</option>
            <option value="sugov_ext" ${data.CPU_B_GOV==='sugov_ext'?'selected':''}>sugov_ext</option>
          </select>
        </div>
        <div class="form-group">
          <label>Min Freq</label>
          <select id="f-cpu-b-min">
            ${bFreqs.slice().reverse().map(f => `<option value="${f}" ${(data.CPU_B_MIN||725000)==f?'selected':''}>${f/1000} MHz</option>`).join('')}
          </select>
        </div>
        <div class="form-group">
          <label>Max Freq</label>
          <select id="f-cpu-b-max">
            ${bFreqs.map(f => `<option value="${f}" ${(data.CPU_B_MAX||2200000)==f?'selected':''}>${f/1000} MHz</option>`).join('')}
          </select>
        </div>
      </div>

      <!-- 3. GPU MALI-G57 & GED -->
      <div style="font-weight: 700; font-size: 12px; color: var(--accent); margin-bottom: 6px;">🎮 GPU Mali-G57 & MediaTek GED</div>
      <div class="grid-2" style="margin-bottom: 8px;">
        <div class="form-group">
          <label>GPU Min Freq</label>
          <select id="f-gpu-min">
            ${gFreqs.slice().reverse().map(f => `<option value="${f}" ${(data.GPU_MIN||390000)==f?'selected':''}>${f/1000} MHz</option>`).join('')}
          </select>
        </div>
        <div class="form-group">
          <label>GPU Max Freq</label>
          <select id="f-gpu-max">
            ${gFreqs.map(f => `<option value="${f}" ${(data.GPU_MAX||1100000)==f?'selected':''}>${f/1000} MHz</option>`).join('')}
          </select>
        </div>
      </div>
      <div class="grid-3" style="margin-bottom: 12px;">
        <div class="form-group">
          <label>GED Boost</label>
          <select id="f-gpu-boost">
            <option value="1" ${data.GPU_BOOST==='1'?'selected':''}>1 (Aktif)</option>
            <option value="0" ${data.GPU_BOOST==='0'?'selected':''}>0 (Mati)</option>
          </select>
        </div>
        <div class="form-group">
          <label>GED Boost Target</label>
          <select id="f-gpu-boost-freq">
            ${[1100000, 990000, 801000, 648000, 390000].map(f => `<option value="${f}" ${(data.GPU_BOOST_FREQ||990000)==f?'selected':''}>${f/1000} MHz</option>`).join('')}
          </select>
        </div>
        <div class="form-group">
          <label>Lock OPP Index</label>
          <select id="f-gpu-lock-opp">
            <option value="-1" ${(data.GPU_LOCK_OPP||'-1')==='-1'?'selected':''}>-1 (Dinamis)</option>
            <option value="0" ${data.GPU_LOCK_OPP==='0'?'selected':''}>OPP 0 (1100M)</option>
            <option value="20" ${data.GPU_LOCK_OPP==='20'?'selected':''}>OPP 20 (Mid)</option>
            <option value="44" ${data.GPU_LOCK_OPP==='44'?'selected':''}>OPP 44 (390M)</option>
          </select>
        </div>
      </div>

      <!-- 4. TRANSSION SCHEDULER & LOCK TUNER -->
      <div style="font-weight: 700; font-size: 12px; color: #10b981; margin-bottom: 6px;">⚡ Transsion Scheduler & Lock Tuner</div>
      <div class="grid-2" style="margin-bottom: 12px;">
        <div class="form-group">
          <label>trans_sched Enable</label>
          <select id="f-trans-sched">
            <option value="1" ${(data.TRANS_SCHED||'1')==='1'?'selected':''}>1 (0x7FF Full Boost)</option>
            <option value="0" ${data.TRANS_SCHED==='0'?'selected':''}>0 (0x00 Nonaktif)</option>
          </select>
        </div>
        <div class="form-group">
          <label>Lock Tuner Level</label>
          <select id="f-trans-lock-tuner">
            <option value="7" ${(data.TRANS_LOCK_TUNER||'7')==='7'?'selected':''}>7 (Mutex+RT+RWSEM Boost Penuh)</option>
            <option value="3" ${data.TRANS_LOCK_TUNER==='3'?'selected':''}>3 (Mutex+RT Boost)</option>
            <option value="1" ${data.TRANS_LOCK_TUNER==='1'?'selected':''}>1 (Mutex Boost Only)</option>
            <option value="0" ${data.TRANS_LOCK_TUNER==='0'?'selected':''}>0 (Off)</option>
          </select>
        </div>
      </div>

      <!-- 5. UCLAMP TOP-APP -->
      <div style="font-weight: 700; font-size: 12px; color: #f59e0b; margin-bottom: 6px;">👆 UCLAMP & Touch Latency Boost</div>
      <div class="grid-3" style="margin-bottom: 12px;">
        <div class="form-group">
          <label>UCLAMP Min (%)</label>
          <select id="f-uclamp-min">
            ${['0.00', '10.00', '20.00', '40.00', '60.00', '80.00'].map(u => `<option value="${u}" ${(data.UCLAMP_MIN||'10.00')==u?'selected':''}>${u}%</option>`).join('')}
          </select>
        </div>
        <div class="form-group">
          <label>UCLAMP Max (%)</label>
          <select id="f-uclamp-max">
            ${['100.00', '80.00', '60.00', '40.00', '20.00'].map(u => `<option value="${u}" ${(data.UCLAMP_MAX||'100.00')==u?'selected':''}>${u}%</option>`).join('')}
          </select>
        </div>
        <div class="form-group">
          <label>Latency Sensitive</label>
          <select id="f-uclamp-lat">
            <option value="1" ${data.UCLAMP_LATENCY==='1'?'selected':''}>1 (Instan Jump)</option>
            <option value="0" ${(data.UCLAMP_LATENCY||'0')==='0'?'selected':''}>0 (Normal)</option>
          </select>
        </div>
      </div>

      <!-- 6. BORE & SCHEDUTIL -->
      <div style="font-weight: 700; font-size: 12px; color: #ec4899; margin-bottom: 6px;">🌀 BORE Penalty & Schedutil Rate Limit</div>
      <div class="grid-2" style="margin-bottom: 12px;">
        <div class="form-group">
          <label>BORE Burst Scale</label>
          <select id="f-bore-scale">
            ${[800, 1000, 1280, 1600, 2000].map(s => `<option value="${s}" ${(data.BORE_SCALE||'1280')==s?'selected':''}>${s}</option>`).join('')}
          </select>
        </div>
        <div class="form-group">
          <label>Rate Limit (µs)</label>
          <select id="f-sched-rate">
            ${[0, 500, 1000, 3000, 5000].map(r => `<option value="${r}" ${(data.SCHED_RATE||'1000')==r?'selected':''}>${r} µs</option>`).join('')}
          </select>
        </div>
      </div>

      <!-- 7. GAME MODE & REFRESH RATE -->
      <div style="font-weight: 700; font-size: 12px; color: #06b6d4; margin-bottom: 6px;">🎮 Game Mode & Kunci Refresh Rate</div>
      <div class="grid-2" style="margin-bottom: 12px;">
        <div class="form-group">
          <label>In-Kernel Game Mode</label>
          <select id="f-game-mode">
            <option value="1" ${data.GAME_MODE==='1'?'selected':''}>1 (Aktif - Boost Priority)</option>
            <option value="0" ${(data.GAME_MODE||'0')==='0'?'selected':''}>0 (Nonaktif)</option>
          </select>
        </div>
        <div class="form-group">
          <label>Refresh Rate Layar</label>
          <select id="f-refresh-rate">
            <option value="0" ${(data.REFRESH_RATE||'0')==='0'?'selected':''}>0 (Otomatis/Bawaan)</option>
            <option value="60" ${data.REFRESH_RATE==='60'?'selected':''}>60 Hz (Hemat Daya)</option>
            <option value="90" ${data.REFRESH_RATE==='90'?'selected':''}>90 Hz (Mulus Seimbang)</option>
            <option value="120" ${data.REFRESH_RATE==='120'?'selected':''}>120 Hz (Ultra Smooth)</option>
          </select>
        </div>
      </div>

      <!-- 8. EAS, BG CPUSET & GPU DVFS -->
      <div style="font-weight: 700; font-size: 12px; color: #eab308; margin-bottom: 6px;">⚡ EAS, Alokasi Core & GPU DVFS</div>
      <div class="grid-3" style="margin-bottom: 12px;">
        <div class="form-group">
          <label>EAS Enable</label>
          <select id="f-eas-enable">
            <option value="1" ${(data.EAS_ENABLE||'1')==='1'?'selected':''}>1 (EAS Aktif)</option>
            <option value="0" ${data.EAS_ENABLE==='0'?'selected':''}>0 (Raw Perf / No EAS)</option>
          </select>
        </div>
        <div class="form-group">
          <label>Background CPUSet</label>
          <select id="f-bg-cpus">
            <option value="0-3" ${(data.BG_CPUS||'0-3')==='0-3'?'selected':''}>0-3 (Standar)</option>
            <option value="0-2" ${data.BG_CPUS==='0-2'?'selected':''}>0-2 (Dibatasi)</option>
            <option value="0-1" ${data.BG_CPUS==='0-1'?'selected':''}>0-1 (Isolasi Ekstrem)</option>
          </select>
        </div>
        <div class="form-group">
          <label>GPU DVFS (Anti-Throttle)</label>
          <select id="f-gpu-dvfs">
            <option value="1" ${(data.GPU_DVFS||'1')==='1'?'selected':''}>1 (Regulasi Normal)</option>
            <option value="0" ${data.GPU_DVFS==='0'?'selected':''}>0 (Anti-Throttle Kunci Clock)</option>
          </select>
        </div>
      </div>

      <!-- 9. NETWORK TCP & SWAPPINESS -->
      <div style="font-weight: 700; font-size: 12px; color: #3b82f6; margin-bottom: 6px;">🌐 TCP Congestion & ZRAM Swappiness</div>
      <div class="grid-2" style="margin-bottom: 12px;">
        <div class="form-group">
          <label>TCP Congestion</label>
          <select id="f-tcp-cong">
            <option value="bbr" ${(data.TCP_CONG||'cubic')==='bbr'?'selected':''}>BBR (Ping Rendah)</option>
            <option value="cubic" ${(data.TCP_CONG||'cubic')==='cubic'?'selected':''}>CUBIC (Stabil Standard)</option>
            <option value="westwood" ${data.TCP_CONG==='westwood'?'selected':''}>Westwood (Sinyal Lemah)</option>
          </select>
        </div>
        <div class="form-group">
          <label>RAM Swappiness</label>
          <select id="f-swappiness">
            <option value="30" ${data.SWAPPINESS==='30'?'selected':''}>30 (Gaming Minim ZRAM)</option>
            <option value="40" ${(data.SWAPPINESS||'100')==='40'?'selected':''}>40 (Gaming Agresif)</option>
            <option value="60" ${data.SWAPPINESS==='60'?'selected':''}>60 (Responsif)</option>
            <option value="100" ${(data.SWAPPINESS||'100')==='100'?'selected':''}>100 (Default Android)</option>
            <option value="120" ${data.SWAPPINESS==='120'?'selected':''}>120 (Hemat RAM)</option>
            <option value="150" ${data.SWAPPINESS==='150'?'selected':''}>150 (Ekstrem ZRAM)</option>
          </select>
        </div>
      </div>
    `;
  };

  window.saveTunedProfile = async function() {
    const prof = document.getElementById('tune-prof-select').value;
    if (!parsedProfiles[prof]) parsedProfiles[prof] = {};

    parsedProfiles[prof].CPU_L_GOV = document.getElementById('f-cpu-l-gov').value;
    parsedProfiles[prof].CPU_L_MIN = document.getElementById('f-cpu-l-min').value;
    parsedProfiles[prof].CPU_L_MAX = document.getElementById('f-cpu-l-max').value;
    parsedProfiles[prof].CPU_B_GOV = document.getElementById('f-cpu-b-gov').value;
    parsedProfiles[prof].CPU_B_MIN = document.getElementById('f-cpu-b-min').value;
    parsedProfiles[prof].CPU_B_MAX = document.getElementById('f-cpu-b-max').value;
    parsedProfiles[prof].GPU_MIN = document.getElementById('f-gpu-min').value;
    parsedProfiles[prof].GPU_MAX = document.getElementById('f-gpu-max').value;
    parsedProfiles[prof].GPU_BOOST = document.getElementById('f-gpu-boost').value;
    parsedProfiles[prof].GPU_BOOST_FREQ = document.getElementById('f-gpu-boost-freq').value;
    parsedProfiles[prof].GPU_LOCK_OPP = document.getElementById('f-gpu-lock-opp').value;
    parsedProfiles[prof].TRANS_SCHED = document.getElementById('f-trans-sched').value;
    parsedProfiles[prof].TRANS_LOCK_TUNER = document.getElementById('f-trans-lock-tuner').value;
    parsedProfiles[prof].UCLAMP_MIN = document.getElementById('f-uclamp-min').value;
    parsedProfiles[prof].UCLAMP_MAX = document.getElementById('f-uclamp-max').value;
    parsedProfiles[prof].UCLAMP_LATENCY = document.getElementById('f-uclamp-lat').value;
    parsedProfiles[prof].BORE_SCALE = document.getElementById('f-bore-scale').value;
    parsedProfiles[prof].SCHED_RATE = document.getElementById('f-sched-rate').value;
    parsedProfiles[prof].GAME_MODE = document.getElementById('f-game-mode').value;
    parsedProfiles[prof].REFRESH_RATE = document.getElementById('f-refresh-rate').value;
    parsedProfiles[prof].EAS_ENABLE = document.getElementById('f-eas-enable').value;
    parsedProfiles[prof].BG_CPUS = document.getElementById('f-bg-cpus').value;
    parsedProfiles[prof].GPU_DVFS = document.getElementById('f-gpu-dvfs').value;
    parsedProfiles[prof].TCP_CONG = document.getElementById('f-tcp-cong').value;
    parsedProfiles[prof].SWAPPINESS = document.getElementById('f-swappiness').value;

    let out = '# ==============================================================================\n';
    out += '# TRANSSION MT6789 KERNEL PROFILE DEFINITIONS (CONFIGURED VIA WEBUI)\n';
    out += '# ==============================================================================\n\n';

    for (const [sec, keys] of Object.entries(parsedProfiles)) {
      out += `[${sec}]\n`;
      for (const [k, v] of Object.entries(keys)) {
        out += `${k}=${v}\n`;
      }
      out += '\n';
    }

    showToast('Menyimpan perubahan profiles.conf...');
    const b64 = btoa(unescape(encodeURIComponent(out)));
    await execCommand(`echo "${b64}" | base64 -d > ${BASE_DIR}/profiles.conf && touch ${BASE_DIR}/reload_trigger`);
    showToast('Konfigurasi berhasil disimpan dan direload!', 'success');
    loadProfilesConf();
  };

  window.toggleRawEditor = function() {
    const box = document.getElementById('raw-editor-box');
    box.style.display = box.style.display === 'none' ? 'block' : 'none';
  };

  window.saveRawProfilesConf = async function() {
    const text = document.getElementById('raw-conf-text').value;
    showToast('Menyimpan teks mentah...');
    const b64 = btoa(unescape(encodeURIComponent(text)));
    await execCommand(`echo "${b64}" | base64 -d > ${BASE_DIR}/profiles.conf && touch ${BASE_DIR}/reload_trigger`);
    showToast('Teks mentah berhasil disimpan!', 'success');
    loadProfilesConf();
  };

  window.refreshLogs = async function() {
    const box = document.getElementById('log-box');
    box.textContent = 'Memuat riwayat...';
    const res = await execCommand(`sh ${TKM} log 100`);
    box.textContent = res.stdout || 'Belum ada catatan log.';
    box.scrollTop = box.scrollHeight;
  };

  window.clearHistoryLog = async function() {
    if (!confirm('Hapus seluruh riwayat pergantian profil?')) return;
    await execCommand(`sh ${TKM} clearlog`);
    showToast('Riwayat log dibersihkan', 'success');
    refreshLogs();
  };

  window.runCli = async function(cmd) {
    document.getElementById('cli-input').value = cmd;
    await executeCustomCli();
  };

  window.executeCustomCli = async function() {
    const input = document.getElementById('cli-input');
    const out = document.getElementById('cli-output');
    const cmd = input.value.trim();
    if (!cmd) return;

    out.textContent = `$ ${cmd}\nMenjalankan perintah...\n`;
    const res = await execCommand(cmd);
    out.textContent = `$ ${cmd}\n` + (res.stdout || res.stderr || '[Perintah selesai tanpa output]');

    out.scrollTop = /switchlog|\blog\b/.test(cmd) ? out.scrollHeight : 0;
  };

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      if (telemetryTimer) {
        clearTimeout(telemetryTimer);
        telemetryTimer = null;
      }
    } else {

      scheduleTelemetry(0);
    }
  });

  const rulesListEl = document.getElementById('rules-list');
  if (rulesListEl) {
    rulesListEl.addEventListener('click', (e) => {
      if (deleteMode) {
        const item = e.target.closest('.rule-item');
        if (!item) return;
        const pkg = item.dataset.pkg;
        if (deleteSelected.has(pkg)) deleteSelected.delete(pkg); else deleteSelected.add(pkg);
        refreshDeleteUI();
        e.preventDefault();
        return;
      }
      const btn = e.target.closest('[data-action]');
      if (!btn) return;
      const action = btn.dataset.action;
      const pkg = btn.dataset.pkg;
      if (action === 'edit-rule') {
        openEditAppModal(pkg);
      } else if (action === 'delete-rule') {
        deleteRule(pkg);
      }
    });
  }

  document.addEventListener('click', (e) => {
    const row = e.target.closest('.app-picker-row');
    if (!row) return;
    const picker = row.closest('#modal-app-picker');
    if (!picker) return;

    const pkg = row.dataset.pkg;
    if (!pkg) return;

    if (e.target.matches('input[type="checkbox"]')) {
      onAppCheckChange(pkg, e.target.checked);
    } else {
      toggleAppCheck(pkg);
    }
  });

  applyLanguage(currentLang);
  scheduleTelemetry(0);

})();
