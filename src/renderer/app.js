document.addEventListener('DOMContentLoaded', async () => {
  const loginOverlay = document.getElementById('login-overlay');
  const formLogin = document.getElementById('form-login');
  const loginUsername = document.getElementById('login-username');
  const loginPassword = document.getElementById('login-password');
  const loginError = document.getElementById('login-error');
  const formInitialSetup = document.getElementById('form-initial-setup');
  const initialAdminPassword = document.getElementById('initial-admin-password');
  const initialAdminPasswordConfirm = document.getElementById('initial-admin-password-confirm');
  const initialSetupError = document.getElementById('initial-setup-error');
  const loginHint = document.getElementById('login-hint');

  const userInfoCard = document.getElementById('user-info-card');
  const userAvatarInitial = document.getElementById('user-avatar-initial');
  const userDisplayName = document.getElementById('user-display-name');
  const userDisplayRole = document.getElementById('user-display-role');
  const btnLogout = document.getElementById('btn-logout');

  const profilesContainer = document.getElementById('profiles-container');
  const syncStatusText = document.getElementById('sync-status-text');
  const syncStatusBadge = document.getElementById('sync-status-badge');
  const btnAddProfile = document.getElementById('btn-add-profile');
  const workerAccessSubtitle = document.getElementById('worker-access-subtitle');

  // Modals
  const modalProfile = document.getElementById('modal-profile');
  const modalClose = document.getElementById('modal-close');
  const modalCancel = document.getElementById('modal-cancel');
  const formProfile = document.getElementById('form-profile');

  const modalAdminGuide = document.getElementById('modal-admin-guide');
  const navGuide = document.getElementById('nav-guide');
  const guideModalClose = document.getElementById('guide-modal-close');
  const guideModalOk = document.getElementById('guide-modal-ok');

  const modalSyncConfig = document.getElementById('modal-sync-config');
  const syncModalClose = document.getElementById('sync-modal-close');
  const syncModalCancel = document.getElementById('sync-modal-cancel');
  const formSyncConfig = document.getElementById('form-sync-config');
  const navSync = document.getElementById('nav-sync');

  // Form Fields
  const profileIdInput = document.getElementById('profile-id');
  const profileNameInput = document.getElementById('profile-name');
  const profileUrlInput = document.getElementById('profile-url');
  const profileProxyInput = document.getElementById('profile-proxy');
  const profileProxyRotateUrlInput = document.getElementById('profile-proxy-rotate-url');
  const profileUaInput = document.getElementById('profile-ua');
  const profileTimezoneInput = document.getElementById('profile-timezone');

  const modalBackup = document.getElementById('modal-backup');
  const navBackup = document.getElementById('nav-backup');
  const backupModalClose = document.getElementById('backup-modal-close');
  const backupPasswordInput = document.getElementById('backup-password');
  const backupStatusText = document.getElementById('backup-status-text');
  const btnExportBackup = document.getElementById('btn-export-backup');
  const btnImportBackup = document.getElementById('btn-import-backup');

  // Theme Switcher Logic
  const themeSelect = document.getElementById('theme-select');
  const savedTheme = localStorage.getItem('oasis_theme') || 'cyber';
  document.body.setAttribute('data-theme', savedTheme);
  if (themeSelect) {
    themeSelect.value = savedTheme;
    themeSelect.addEventListener('change', (e) => {
      const selected = e.target.value;
      document.body.setAttribute('data-theme', selected);
      localStorage.setItem('oasis_theme', selected);
    });
  }

  let currentUser = null;

  const modalChangePassword = document.getElementById('modal-change-password');
  const formChangePassword = document.getElementById('form-change-password');
  const newPasswordInput = document.getElementById('new-password');
  const confirmPasswordInput = document.getElementById('confirm-password');
  const changePassError = document.getElementById('change-pass-error');

  // Register Push Event Listeners from Main Process
  if (window.api && window.api.onForceLogout) {
    window.api.onForceLogout((data) => {
      console.warn('[App] Received forced logout event:', data);
      currentUser = null;
      profilesContainer.innerHTML = '';
      alert(data.reason || 'Ваш сеанс було скасовано адміністратором.');
      checkAuth();
    });
  }

  if (window.api && window.api.onProfilesUpdated) {
    window.api.onProfilesUpdated(() => {
      console.log('[App] Real-time profiles update event received');
      if (currentUser) {
        loadProfiles();
      }
    });
  }

  if (window.api && window.api.onSyncError) {
    window.api.onSyncError((data) => {
      console.warn('[App] Profile sync error:', data);
      const profileName = data.profileName || data.profileId || 'профіль';
      syncStatusText.textContent = 'Потрібна дія: синхронізація профілю не виконана';
      syncStatusBadge.classList.add('status-error');
      alert(`⚠️ ${profileName}: сесія збережена локально, але не синхронізована. ${data.error}`);
    });
  }

  // Check Auth State
  async function checkAuth() {
    if (formInitialSetup) formInitialSetup.classList.add('hidden');
    formLogin.classList.remove('hidden');
    loginHint.classList.remove('hidden');
    currentUser = await window.api.getCurrentUser();
    if (!currentUser) {
      loginOverlay.classList.add('active');
      modalChangePassword.classList.remove('active');
      profilesContainer.innerHTML = '';
    } else {
      loginOverlay.classList.remove('active');
      if (currentUser.mustChangePassword) {
        modalChangePassword.classList.add('active');
      } else {
        modalChangePassword.classList.remove('active');
      }
      updateUserUI();
      checkSyncStatus();
      loadProfiles();
    }
  }

  // Handle Forced Change Password Submit
  if (formChangePassword) {
    formChangePassword.addEventListener('submit', async (e) => {
      e.preventDefault();
      changePassError.textContent = '';
      const newPass = newPasswordInput.value;
      const confirmPass = confirmPasswordInput.value;

      if (newPass !== confirmPass) {
        changePassError.textContent = 'Паролі не збігаються';
        return;
      }
      if (newPass === 'admin') {
        changePassError.textContent = 'Новий пароль не може бути "admin"';
        return;
      }

      const res = await window.api.changePassword(newPass);
      if (res.success) {
        modalChangePassword.classList.remove('active');
        checkAuth();
      } else {
        changePassError.textContent = res.message || 'Помилка зміни пароля';
      }
    });
  }

  // Update UI elements based on User Role
  function updateUserUI() {
    if (!currentUser) return;

    userDisplayName.textContent = currentUser.username;
    userAvatarInitial.textContent = currentUser.username.charAt(0).toUpperCase();

    const isAdmin = currentUser.role === 'admin';
    userDisplayRole.textContent = isAdmin ? 'Адміністратор' : 'Користувач';

    document.querySelectorAll('.admin-only').forEach(el => {
      if (isAdmin) {
        el.classList.remove('hidden');
      } else {
        el.classList.add('hidden');
      }
    });
  }

  // Handle Login Form Submit
  formLogin.addEventListener('submit', async (e) => {
    e.preventDefault();
    loginError.textContent = '';
    const username = loginUsername.value.trim();
    const password = loginPassword.value;

    const res = await window.api.login(username, password);
    if (res.success) {
      loginPassword.value = '';
      checkAuth();
    } else {
      loginError.textContent = res.message || 'Помилка входу';
    }
  });

  // Handle Logout
  btnLogout.addEventListener('click', async () => {
    await window.api.logout();
    currentUser = null;
    profilesContainer.innerHTML = '';
    checkAuth();
  });

  // Fetch Sync Status
  async function checkSyncStatus() {
    try {
      const status = await window.api.getSyncStatus();
      if (status.isCloudConfigured) {
        syncStatusText.textContent = 'Firebase Cloud Active';
        syncStatusBadge.classList.add('cloud');
      } else {
        syncStatusText.textContent = 'Локальний режим';
        syncStatusBadge.classList.remove('cloud');
      }
    } catch (e) {
      console.warn('Sync status error:', e);
    }
  }

  // Load and Render Profiles Filtered by User Permissions
  async function loadProfiles() {
    try {
      const result = await window.api.listProfiles();
      const profiles = result.profiles || [];
      profilesContainer.innerHTML = '';

      const isAdmin = currentUser && currentUser.role === 'admin';

      if (!isAdmin) {
        workerAccessSubtitle.textContent = `Вам надано доступ до ${result.allowedCount} з ${result.totalCount} профілів команди`;
      } else {
        workerAccessSubtitle.textContent = `Доступні ізольовані середовища для вашого акаунта (${result.allowedCount} активних)`;
      }

      if (profiles.length === 0) {
        profilesContainer.innerHTML = `
          <div style="grid-column: 1/-1; text-align: center; padding: 40px; color: var(--text-muted);">
            Немає доступних профілів для вашого акаунта.
          </div>
        `;
        return;
      }

      profiles.forEach(p => {
        const card = document.createElement('div');
        card.className = 'profile-card';

        const proxyText = p.proxy && p.proxy.trim() !== '' ? p.proxy : 'Без проксі (Direct)';

        let activeStatusBadge = '⚪ Закритий';
        if (p.isRunning) {
          activeStatusBadge = '🟢 Відкрито локально';
        } else if (p.activeHolder && p.activeHolder.username) {
          activeStatusBadge = `🟡 Зайнято (${escapeHtml(p.activeHolder.username)})`;
        }

        const adminButtonsHTML = isAdmin ? `
          <button class="btn btn-secondary btn-icon btn-edit" data-id="${p.id}" title="Редагувати">✏️</button>
        ` : '';

        const deleteButtonHTML = isAdmin ? `
          <button class="btn btn-secondary btn-icon btn-delete" data-id="${p.id}" title="Видалити">🗑</button>
        ` : '';

        const rotateButtonHTML = p.proxyRotateUrl && p.proxyRotateUrl.trim() !== '' ? `
          <button class="btn btn-secondary btn-icon btn-rotate" data-id="${p.id}" title="Оновити IP (Ротація мобільного проксі)">🔄</button>
        ` : '';

        card.innerHTML = `
          <div>
            <div class="card-header">
              <span class="service-badge">${activeStatusBadge}</span>
              ${adminButtonsHTML}
            </div>
            <div class="profile-title">${escapeHtml(p.name)}</div>
            <div class="profile-url">${escapeHtml(p.url)}</div>
            <div class="proxy-info">
              <span>🌐</span> ${escapeHtml(proxyText)}
            </div>
          </div>
          <div class="card-actions">
            <button class="btn btn-secondary btn-icon btn-test" data-id="${p.id}" title="Автотест підключення">🔍</button>
            ${rotateButtonHTML}
            <button class="btn btn-secondary btn-icon btn-warmup" data-id="${p.id}" title="Авто-прогрів акаунта (набір куків & trust score)">🔥</button>
            <button class="btn btn-primary btn-launch" data-id="${p.id}">
              ${p.isRunning ? 'Відкрито' : '▶ Запустити'}
            </button>
            ${deleteButtonHTML}
          </div>
        `;

        profilesContainer.appendChild(card);
      });

      // Bind IP Rotation Buttons
      document.querySelectorAll('.btn-rotate').forEach(btn => {
        btn.addEventListener('click', async (e) => {
          const id = e.target.getAttribute('data-id');
          btn.disabled = true;
          const origText = btn.textContent;
          btn.textContent = '⏳';
          try {
            const result = await window.api.rotateProxyIp(id);
            if (result.ok) {
              alert(`✅ ${result.message}`);
              loadProfiles();
            } else {
              alert(`❌ Помилка ротації IP: ${result.error}`);
            }
          } catch (err) {
            alert('❌ [ПОМИЛКА РОТАЦІЇ IP]: ' + err.message);
          } finally {
            btn.disabled = false;
            btn.textContent = origText;
          }
        });
      });

      // Bind Preflight Test Buttons
      // Bind Preflight Health Check Buttons
      document.querySelectorAll('.btn-test').forEach(btn => {
        btn.addEventListener('click', async (e) => {
          const id = e.target.getAttribute('data-id');
          btn.disabled = true;
          const origText = btn.textContent;
          btn.textContent = '⏳';
          try {
            const report = await window.api.runFullHealthCheck(id);
            modalHealth.classList.add('active');

            const scoreColor = report.score >= 85 ? '#10B981' : (report.score >= 60 ? '#F59E0B' : '#EF4444');
            const warningsHtml = report.warnings && report.warnings.length > 0
              ? report.warnings.map(w => `<div style="background:rgba(239,68,68,0.15); border:1px solid rgba(239,68,68,0.3); border-radius:6px; padding:8px 10px; font-size:12px; margin-top:6px; color:#fca5a5;">${escapeHtml(w)}</div>`).join('')
              : '<div style="background:rgba(16,185,129,0.15); border:1px solid rgba(16,185,129,0.3); border-radius:6px; padding:8px 10px; font-size:12px; margin-top:6px; color:#6ee7b7;">✅ Захист відбитків та мережевий тунель ідеальні (0 зауважень).</div>';

            healthReportBody.innerHTML = `
              <div style="text-align:center; margin-bottom:16px;">
                <div style="font-size:32px; font-weight:800; color:${scoreColor};">${report.statusBadge}</div>
                <div style="font-size:12px; color:var(--text-muted); margin-top:4px;">Trust Score: ${report.score}/100</div>
              </div>
              <div style="background:rgba(15,23,42,0.8); border:1px solid var(--border-color); border-radius:8px; padding:12px; font-size:13px; display:flex; flex-direction:column; gap:8px;">
                <div>🌐 <b>Проксі IP:</b> <code>${escapeHtml(report.proxyIp)}</code></div>
                <div>📍 <b>Геолокація:</b> ${escapeHtml(report.country)}</div>
                <div>🕓 <b>Часовий пояс:</b> <code>${escapeHtml(report.profileTimezone)}</code> ${report.timezoneMatch ? '✅' : '⚠️'}</div>
                <div>🛡 <b>WebRTC Leak Shield:</b> ${report.webrtcShield ? '🟢 Активовано (Захищено від витоку IP)' : '🔴 Вимкнено'}</div>
              </div>
              <div style="margin-top:14px;">
                <b style="font-size:12px; text-transform:uppercase; color:var(--text-muted);">Результати діагностики:</b>
                ${warningsHtml}
              </div>
            `;
          } catch (err) {
            alert('❌ [ПОМИЛКА ДІАГНОСТИКИ]: ' + err.message);
          } finally {
            btn.disabled = false;
            btn.textContent = origText;
          }
        });
      });

      // Bind Warmup Buttons
      document.querySelectorAll('.btn-warmup').forEach(btn => {
        btn.addEventListener('click', async (e) => {
          const id = e.target.getAttribute('data-id');
          btn.disabled = true;
          btn.textContent = '⏳';
          try {
            alert('🔥 Розпочато авто-прогрів! Браузер послідовно відвідає Google, YouTube, Reddit та Wikipedia для створення реальної історії та куків.');
            await window.api.warmupProfile(id);
            alert('✅ Прогрів успішно завершено! Набрано реальні кукі та піднято Trust Score.');
            loadProfiles();
          } catch (err) {
            alert('❌ Помилка прогріву: ' + err.message);
          } finally {
            btn.disabled = false;
            btn.textContent = '🔥';
          }
        });
      });

      // Bind Launch Buttons with Active Holder Conflict Warning
      document.querySelectorAll('.btn-launch').forEach(btn => {
        btn.addEventListener('click', async (e) => {
          const id = e.target.getAttribute('data-id');
          const profile = profiles.find(p => p.id === id);

          if (profile && profile.activeHolder && profile.activeHolder.username && !profile.isRunning) {
            const confirmLaunch = confirm(`⚠️ ПОПЕРЕДЖЕННЯ: Цей акаунт зараз відкритий у колеги '${profile.activeHolder.username}'.\n\nВи впевнені, що хочете відкрити його паралельно?`);
            if (!confirmLaunch) return;
          }

          btn.disabled = true;
          btn.textContent = 'Запуск...';
          try {
            await window.api.launchProfile(id);
            setTimeout(loadProfiles, 1500);
          } catch (err) {
            alert('⚠️ Запуск відхилено: ' + err.message);
            loadProfiles();
          }
        });
      });

      // Bind Edit Buttons (Admin Only)
      document.querySelectorAll('.btn-edit').forEach(btn => {
        btn.addEventListener('click', async (e) => {
          const id = e.target.getAttribute('data-id');
          const profile = await window.api.getProfile(id);
          if (profile) {
            profileIdInput.value = profile.id;
            profileNameInput.value = profile.name || '';
            profileUrlInput.value = profile.url || '';
            profileProxyInput.value = profile.proxy || '';
            if (profileProxyRotateUrlInput) profileProxyRotateUrlInput.value = profile.proxyRotateUrl || '';
            profileUaInput.value = profile.userAgent || '';
            profileTimezoneInput.value = profile.timezone || '';
            document.getElementById('modal-title').textContent = 'Редагувати Профіль';
            modalProfile.classList.add('active');
          }
        });
      });

      // Bind Delete Buttons (Admin Only)
      document.querySelectorAll('.btn-delete').forEach(btn => {
        btn.addEventListener('click', async (e) => {
          const id = e.target.getAttribute('data-id');
          if (confirm('Ви впевнені, що хочете видалити цей профіль?')) {
            await window.api.deleteProfile(id);
            loadProfiles();
          }
        });
      });

    } catch (err) {
      console.error('Error loading profiles:', err);
    }
  }

  // Open Modal Add Profile
  btnAddProfile.addEventListener('click', () => {
    profileIdInput.value = 'profile_' + Date.now();
    profileNameInput.value = '';
    profileUrlInput.value = 'https://chatgpt.com';
    profileProxyInput.value = '';
    if (profileProxyRotateUrlInput) profileProxyRotateUrlInput.value = '';
    profileUaInput.value = '';
    profileTimezoneInput.value = '';
    document.getElementById('modal-title').textContent = 'Створити Профіль';
    modalProfile.classList.add('active');
  });

  // Guide Modal Nav
  if (navGuide) {
    navGuide.addEventListener('click', () => modalAdminGuide.classList.add('active'));
  }
  [guideModalClose, guideModalOk].forEach(btn => {
    if (btn) btn.addEventListener('click', () => modalAdminGuide.classList.remove('active'));
  });

  // Close Modals
  [modalClose, modalCancel].forEach(btn => {
    btn.addEventListener('click', () => modalProfile.classList.remove('active'));
  });
  [syncModalClose, syncModalCancel].forEach(btn => {
    btn.addEventListener('click', () => modalSyncConfig.classList.remove('active'));
  });

  navSync.addEventListener('click', () => modalSyncConfig.classList.add('active'));
  syncStatusBadge.addEventListener('click', () => {
    if (currentUser && currentUser.role === 'admin') {
      modalSyncConfig.classList.add('active');
    }
  });

  // Encrypted Backup Modal
  if (navBackup) {
    navBackup.addEventListener('click', () => {
      backupPasswordInput.value = '';
      backupStatusText.textContent = '';
      modalBackup.classList.add('active');
    });
  }
  if (backupModalClose) {
    backupModalClose.addEventListener('click', () => modalBackup.classList.remove('active'));
  }
  if (btnExportBackup) {
    btnExportBackup.addEventListener('click', async () => {
      const password = backupPasswordInput.value;
      if (!password || password.length < 6) {
        backupStatusText.textContent = '⚠️ Пароль має містити щонайменше 6 символів.';
        return;
      }
      btnExportBackup.disabled = true;
      backupStatusText.textContent = 'Експортуємо...';
      try {
        const res = await window.api.exportProfiles(password);
        backupStatusText.textContent = res.success
          ? `✅ Збережено ${res.count} профілів у ${res.path}`
          : (res.message || 'Скасовано.');
      } catch (err) {
        backupStatusText.textContent = '❌ ' + err.message;
      } finally {
        btnExportBackup.disabled = false;
      }
    });
  }
  if (btnImportBackup) {
    btnImportBackup.addEventListener('click', async () => {
      const password = backupPasswordInput.value;
      if (!password) {
        backupStatusText.textContent = '⚠️ Введіть пароль, яким був зашифрований файл.';
        return;
      }
      btnImportBackup.disabled = true;
      backupStatusText.textContent = 'Імпортуємо...';
      try {
        const res = await window.api.importProfiles(password);
        backupStatusText.textContent = res.success
          ? `✅ Імпортовано ${res.count} профілів.`
          : (res.message || 'Скасовано.');
        if (res.success) loadProfiles();
      } catch (err) {
        backupStatusText.textContent = '❌ ' + err.message;
      } finally {
        btnImportBackup.disabled = false;
      }
    });
  }

  // Submit Profile Form
  formProfile.addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = profileIdInput.value;
    const profile = {
      id,
      name: profileNameInput.value,
      url: profileUrlInput.value,
      proxy: profileProxyInput.value,
      proxyRotateUrl: profileProxyRotateUrlInput ? profileProxyRotateUrlInput.value.trim() : '',
      userAgent: profileUaInput.value,
      timezone: profileTimezoneInput.value,
      updatedAt: Date.now()
    };

    const cookiesRaw = document.getElementById('profile-cookies-import').value.trim();
    if (cookiesRaw) {
      try {
        const parsed = JSON.parse(cookiesRaw);
        if (Array.isArray(parsed)) {
          profile.cookies = parsed;
        }
      } catch (err) {
        alert('⚠️ Увага: Імпортовані кукі мають помилку формату JSON і не були збережені.');
      }
    }

    const saved = await window.api.saveProfile(profile);
    modalProfile.classList.remove('active');
    loadProfiles();
    if (saved && saved.cloudSyncError) {
      alert(`⚠️ Профіль збережено лише локально. Cloud-синхронізація не виконана: ${saved.cloudSyncError}`);
    }
  });

  // Submit Sync Config Form
  formSyncConfig.addEventListener('submit', async (e) => {
    e.preventDefault();
    const config = {
      apiKey: document.getElementById('fb-api-key').value.trim(),
      projectId: document.getElementById('fb-project-id').value.trim(),
      authDomain: document.getElementById('fb-auth-domain').value.trim(),
      storageBucket: document.getElementById('fb-storage-bucket').value.trim(),
      appId: document.getElementById('fb-app-id').value.trim()
    };
    const res = await window.api.updateFirebaseConfig(config);
    modalSyncConfig.classList.remove('active');
    checkSyncStatus();
  });

  // User Management & Profile Access Control
  const navUsers = document.getElementById('nav-users');
  const modalUsers = document.getElementById('modal-users');
  const usersModalClose = document.getElementById('users-modal-close');
  const usersListContainer = document.getElementById('users-list-container');
  const userProfilesCheckboxes = document.getElementById('user-profiles-checkboxes');
  const formUserEdit = document.getElementById('form-user-edit');
  const btnResetUserForm = document.getElementById('btn-reset-user-form');
  const userFormTitle = document.getElementById('user-form-title');

  if (navUsers) {
    navUsers.addEventListener('click', () => {
      modalUsers.classList.add('active');
      loadUsersManagement();
    });
  }

  if (usersModalClose) {
    usersModalClose.addEventListener('click', () => {
      modalUsers.classList.remove('active');
    });
  }

  if (btnResetUserForm) {
    btnResetUserForm.addEventListener('click', () => {
      resetUserForm();
    });
  }

  function resetUserForm() {
    userFormTitle.textContent = 'Додати новий акаунт співробітника';
    document.getElementById('user-username').value = '';
    document.getElementById('user-username').disabled = false;
    document.getElementById('user-password').value = '';
    document.getElementById('user-role').value = 'user';
    document.querySelectorAll('#user-profiles-checkboxes input[type="checkbox"]').forEach(cb => cb.checked = false);
  }

  async function loadUsersManagement() {
    try {
      const users = await window.api.getUsers();
      const profilesRes = await window.api.listProfiles();
      const allProfiles = (profilesRes && Array.isArray(profilesRes.profiles)) ? profilesRes.profiles : [];

      if (!allProfiles || allProfiles.length === 0) {
        userProfilesCheckboxes.innerHTML = `<div style="grid-column: span 2; font-size: 11px; color: var(--text-muted); text-align: center; padding: 8px;">Жодного профілю ще не створено</div>`;
      } else {
        userProfilesCheckboxes.innerHTML = allProfiles.map(p => `
          <label class="profile-access-chip">
            <input type="checkbox" value="${p.id}" class="cb-profile-access" />
            <span>🌐 ${escapeHtml(p.name)}</span>
          </label>
        `).join('');
      }

      if (!users || users.length === 0) {
        usersListContainer.innerHTML = `<div style="font-size: 12px; color: var(--text-muted); text-align: center; padding: 12px;">Немає додаткових акаунтів</div>`;
      } else {
        usersListContainer.innerHTML = users.map(u => {
          const allowedCount = u.allowedProfiles && u.allowedProfiles.includes('*')
            ? '🌐 Повний доступ (Усі профілі)'
            : (Array.isArray(u.allowedProfiles) ? `🔒 ${u.allowedProfiles.length} профілів` : '🔒 0 профілів');

          const initial = (u.username || 'U').charAt(0).toUpperCase();
          const roleClass = u.role === 'admin' ? 'admin' : 'user';
          const roleText = u.role === 'admin' ? 'Admin' : 'Worker';

          return `
            <div class="user-item-row">
              <div class="user-item-info">
                <div class="user-item-avatar">${initial}</div>
                <div class="user-item-meta">
                  <div class="user-item-name">
                    ${escapeHtml(u.username)}
                    <span class="user-role-badge ${roleClass}">${roleText}</span>
                  </div>
                  <div class="user-item-access">${allowedCount}</div>
                </div>
              </div>
              <div class="user-item-actions">
                <button class="btn-icon-action btn-edit-user" data-user="${escapeHtml(u.username)}">✏️ Редагувати</button>
                ${u.username !== 'admin' ? `<button class="btn-icon-action danger btn-delete-user" data-user="${escapeHtml(u.username)}">🗑️ Видалити</button>` : ''}
              </div>
            </div>
          `;
        }).join('');
      }

      document.querySelectorAll('.btn-edit-user').forEach(btn => {
        btn.addEventListener('click', (e) => {
          const username = e.target.closest('.btn-edit-user').getAttribute('data-user');
          const target = users.find(u => u.username === username);
          if (target) {
            userFormTitle.textContent = `✏️ Редагувати користувача: ${target.username}`;
            document.getElementById('user-username').value = target.username;
            document.getElementById('user-username').disabled = true;
            document.getElementById('user-password').value = '';
            document.getElementById('user-role').value = target.role || 'user';

            const allowed = Array.isArray(target.allowedProfiles) ? target.allowedProfiles : [];
            document.querySelectorAll('#user-profiles-checkboxes input[type="checkbox"]').forEach(cb => {
              cb.checked = target.role === 'admin' || allowed.includes('*') || allowed.includes(cb.value);
            });
          }
        });
      });

      document.querySelectorAll('.btn-delete-user').forEach(btn => {
        btn.addEventListener('click', async (e) => {
          const username = e.target.closest('.btn-delete-user').getAttribute('data-user');
          if (confirm(`Видалити користувача '${username}'?`)) {
            try {
              await window.api.deleteUser(username);
              loadUsersManagement();
            } catch (err) {
              alert('❌ Помилка: ' + err.message);
            }
          }
        });
      });

    } catch (err) {
      console.error('Error loading users:', err);
    }
  }

  if (formUserEdit) {
    formUserEdit.addEventListener('submit', async (e) => {
      e.preventDefault();
      const username = document.getElementById('user-username').value.trim();
      const password = document.getElementById('user-password').value.trim();
      const role = document.getElementById('user-role').value;

      const checkedProfiles = [];
      document.querySelectorAll('#user-profiles-checkboxes input[type="checkbox"]:checked').forEach(cb => {
        checkedProfiles.push(cb.value);
      });

      const userData = {
        username,
        role,
        allowedProfiles: role === 'admin' ? ['*'] : checkedProfiles
      };
      if (password) userData.password = password;

      try {
        await window.api.saveUser(userData);
        alert(`✅ Права для '${username}' збережено!`);
        resetUserForm();
        loadUsersManagement();
      } catch (err) {
        alert('❌ Помилка збереження користувача: ' + err.message);
      }
    });
  }

  // Health Check Modal Elements
  const modalHealth = document.getElementById('modal-health');
  const healthModalClose = document.getElementById('health-modal-close');
  const healthModalOk = document.getElementById('health-modal-ok');
  const healthReportBody = document.getElementById('health-report-body');

  if (healthModalClose) healthModalClose.addEventListener('click', () => modalHealth.classList.remove('active'));
  if (healthModalOk) healthModalOk.addEventListener('click', () => modalHealth.classList.remove('active'));

  // Audit Logs Modal Elements
  const navLogs = document.getElementById('nav-logs');
  const modalLogs = document.getElementById('modal-logs');
  const logsModalClose = document.getElementById('logs-modal-close');
  const auditLogsContainer = document.getElementById('audit-logs-container');

  if (logsModalClose) logsModalClose.addEventListener('click', () => modalLogs.classList.remove('active'));
  if (navLogs) {
    navLogs.addEventListener('click', async () => {
      modalLogs.classList.add('active');
      loadAuditLogs();
    });
  }

  async function loadAuditLogs() {
    try {
      auditLogsContainer.innerHTML = '<div style="text-align:center; padding:20px; color:var(--text-muted);">⏳ Завантаження журналу дій...</div>';
      const logs = await window.api.getAuditLogs();
      if (!logs || logs.length === 0) {
        auditLogsContainer.innerHTML = '<div style="text-align:center; padding:20px; color:var(--text-muted);">Записів у журналі дій ще немає.</div>';
        return;
      }

      auditLogsContainer.innerHTML = logs.map(l => {
        const dateStr = new Date(l.timestamp).toLocaleString('uk-UA', { dateStyle: 'short', timeStyle: 'medium' });
        const userBadge = `<span style="font-weight:700; color:var(--accent-primary);">${escapeHtml(l.username)}</span>`;
        const profileBadge = l.profileName ? `<span style="background:rgba(255,255,255,0.08); padding:2px 6px; border-radius:4px; font-size:11px;">${escapeHtml(l.profileName)}</span>` : '';

        return `
          <div style="display:flex; align-items:center; justify-content:space-between; padding:10px 12px; background:rgba(30,41,59,0.7); border:1px solid rgba(255,255,255,0.05); border-radius:8px; font-size:12px;">
            <div style="display:flex; align-items:center; gap:10px;">
              <span style="font-size:14px;">⚡</span>
              <div>
                <div><strong>${escapeHtml(l.action)}</strong> ${profileBadge}</div>
                <div style="font-size:11px; color:var(--text-muted);">Користувач: ${userBadge} | Пристрій: <code>${escapeHtml(l.deviceId || 'local')}</code></div>
              </div>
            </div>
            <div style="font-size:11px; color:var(--text-muted); opacity:0.8;">${dateStr}</div>
          </div>
        `;
      }).join('');
    } catch (err) {
      auditLogsContainer.innerHTML = `<div style="color:#ef4444; padding:10px;">❌ Помилка завантаження журналу: ${escapeHtml(err.message)}</div>`;
    }
  }

  function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/[&<>"']/g, function(m) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[m];
    });
  }

  // Changelog / "What's New" Modal
  const navChangelog = document.getElementById('nav-changelog');
  const modalChangelog = document.getElementById('modal-changelog');
  const changelogModalClose = document.getElementById('changelog-modal-close');
  const changelogModalOk = document.getElementById('changelog-modal-ok');
  const changelogContainer = document.getElementById('changelog-container');

  // CHANGELOG.md is plain Ukrainian text now, no markdown — just "Версія X.Y.Z (дата)"
  // lines followed by plain paragraphs, so rendering it is a straight escape + wrap.
  function renderChangelogText(text) {
    const lines = escapeHtml(text).split('\n');
    let html = '';
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed === '') continue;
      if (/^Версія /.test(trimmed)) {
        html += `<div class="changelog-version">${trimmed}</div>`;
      } else {
        html += `<p style="font-size:12px; color:var(--text-muted); margin:4px 0 14px; line-height:1.6;">${trimmed}</p>`;
      }
    }
    return html;
  }

  async function loadChangelog() {
    changelogContainer.innerHTML = '<div style="text-align:center; padding:20px; color:var(--text-muted);">⏳ Завантаження...</div>';
    try {
      const res = await window.api.getChangelog();
      if (!res.success || !res.content) {
        changelogContainer.innerHTML = '<div style="text-align:center; padding:20px; color:var(--text-muted);">Історія версій недоступна.</div>';
        return;
      }
      changelogContainer.innerHTML = renderChangelogText(res.content);
    } catch (err) {
      changelogContainer.innerHTML = `<div style="color:#ef4444; padding:10px;">❌ ${escapeHtml(err.message)}</div>`;
    }
  }

  if (navChangelog) {
    navChangelog.addEventListener('click', () => {
      modalChangelog.classList.add('active');
      loadChangelog();
    });
  }
  [changelogModalClose, changelogModalOk].forEach(btn => {
    if (btn) btn.addEventListener('click', () => modalChangelog.classList.remove('active'));
  });

  // App Version & Auto-Update UI Logic
  const appVersionNum = document.getElementById('app-version-num');
  const btnCheckUpdate = document.getElementById('btn-check-update');
  const modalUpdate = document.getElementById('modal-update');
  const updateModalClose = document.getElementById('update-modal-close');
  const btnUpdateCancel = document.getElementById('btn-update-cancel');
  const btnUpdateNow = document.getElementById('btn-update-now');
  const updateStatusIcon = document.getElementById('update-status-icon');
  const updateStatusTitle = document.getElementById('update-status-title');
  const updateStatusDesc = document.getElementById('update-status-desc');
  const updateProgressContainer = document.getElementById('update-progress-container');
  const updateProgressFill = document.getElementById('update-progress-fill');

  // Load app version
  try {
    const version = await window.api.getAppVersion();
    if (version && appVersionNum) {
      appVersionNum.textContent = `v${version}`;
    }
  } catch (error) {
    console.warn('App version read notice:', error.message);
  }

  if (btnCheckUpdate) {
    btnCheckUpdate.addEventListener('click', async () => {
      if (modalUpdate) modalUpdate.classList.add('active');
      if (updateStatusIcon) updateStatusIcon.textContent = '🔍';
      if (updateStatusTitle) updateStatusTitle.textContent = 'Перевірка оновлень...';
      if (updateStatusDesc) updateStatusDesc.textContent = "З'єднання з серверним маніфестом GitHub Releases...";
      if (updateProgressContainer) updateProgressContainer.style.display = 'none';
      if (btnUpdateNow) btnUpdateNow.style.display = 'none';
      if (btnUpdateCancel) btnUpdateCancel.textContent = 'Скасувати';

      const res = await window.api.checkForUpdates();
      if (res && res.status === 'dev') {
        if (updateStatusIcon) updateStatusIcon.textContent = '🛠️';
        if (updateStatusTitle) updateStatusTitle.textContent = 'Режим Розробки';
        if (updateStatusDesc) updateStatusDesc.textContent = res.message;
      }
    });
  }

  [updateModalClose, btnUpdateCancel].forEach(btn => {
    if (btn) btn.addEventListener('click', () => {
      if (modalUpdate) modalUpdate.classList.remove('active');
    });
  });

  if (btnUpdateNow) {
    btnUpdateNow.addEventListener('click', () => {
      window.api.installUpdate();
    });
  }

  if (window.api.onUpdateStatus) {
    window.api.onUpdateStatus((data) => {
      if (!data) return;
      if (modalUpdate) modalUpdate.classList.add('active');

      if (data.status === 'checking') {
        if (updateStatusIcon) updateStatusIcon.textContent = '🔍';
        if (updateStatusTitle) updateStatusTitle.textContent = 'Перевіряємо оновлення...';
        if (updateStatusDesc) updateStatusDesc.textContent = data.message;
        if (updateProgressContainer) updateProgressContainer.style.display = 'none';
        if (btnUpdateNow) btnUpdateNow.style.display = 'none';
      } else if (data.status === 'available') {
        if (updateStatusIcon) updateStatusIcon.textContent = '🎁';
        if (updateStatusTitle) updateStatusTitle.textContent = `Знайдено версію v${data.version}!`;
        if (updateStatusDesc) updateStatusDesc.textContent = 'Завантаження інсталяційного пакету...';
        if (updateProgressContainer) updateProgressContainer.style.display = 'block';
        if (btnUpdateNow) btnUpdateNow.style.display = 'none';
      } else if (data.status === 'not-available') {
        if (updateStatusIcon) updateStatusIcon.textContent = '✅';
        if (updateStatusTitle) updateStatusTitle.textContent = 'Найновіша версія';
        if (updateStatusDesc) updateStatusDesc.textContent = data.message;
        if (updateProgressContainer) updateProgressContainer.style.display = 'none';
        if (btnUpdateNow) btnUpdateNow.style.display = 'none';
        if (btnUpdateCancel) btnUpdateCancel.textContent = 'Чудово';
      } else if (data.status === 'downloading') {
        if (updateStatusIcon) updateStatusIcon.textContent = '⏳';
        if (updateStatusTitle) updateStatusTitle.textContent = 'Завантаження оновлення...';
        if (updateStatusDesc) updateStatusDesc.textContent = `${data.percent}% завершено`;
        if (updateProgressContainer) updateProgressContainer.style.display = 'block';
        if (updateProgressFill) updateProgressFill.style.width = `${data.percent}%`;
        if (btnUpdateNow) btnUpdateNow.style.display = 'none';
      } else if (data.status === 'downloaded') {
        const isMac = window.api.platform === 'darwin';
        if (updateStatusIcon) updateStatusIcon.textContent = '🎉';
        if (updateStatusTitle) updateStatusTitle.textContent = `Версію v${data.version} завантажено!`;
        if (updateStatusDesc) {
          updateStatusDesc.textContent = isMac
            ? 'На macOS застосунок поки не підписаний сертифікатом Apple, тому автоматично встановити не можна — натисніть кнопку, щоб відкрити сторінку завантаження і встановити вручну.'
            : 'Натисніть кнопку нижче, щоб перезапустити додаток і застосувати оновлення.';
        }
        if (updateProgressContainer) updateProgressContainer.style.display = 'none';
        if (btnUpdateNow) {
          btnUpdateNow.style.display = 'inline-block';
          btnUpdateNow.textContent = isMac ? '🌐 Відкрити завантаження' : '🚀 Перезапустити зараз';
        }
        if (btnUpdateCancel) btnUpdateCancel.textContent = 'Пізніше';
      } else if (data.status === 'error') {
        if (updateStatusIcon) updateStatusIcon.textContent = '⚠️';
        if (updateStatusTitle) updateStatusTitle.textContent = 'Помилка оновлення';
        if (updateStatusDesc) updateStatusDesc.textContent = data.message;
        if (updateProgressContainer) updateProgressContainer.style.display = 'none';
        if (btnUpdateNow) btnUpdateNow.style.display = 'none';
        if (btnUpdateCancel) btnUpdateCancel.textContent = 'Закрити';
      }
    });
  }

  // Initial Auth Check
  checkAuth();
});
