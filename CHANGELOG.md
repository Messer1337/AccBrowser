# Changelog

All notable changes to OASIS Browser are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/), versions follow [SemVer](https://semver.org/).

## [1.6.0] - 2026-07-23
### Added
- Explicit App Version Badge (e.g., `v1.6.0`) displayed in the sidebar footer.
- Manual Update Button `🔄 Перевірити оновлення` allowing any user to trigger live GitHub Releases check.
- Interactive Update Progress Modal showing release detection, download percentage bar, and instant relaunch button (`autoUpdater.quitAndInstall(false, true)`).

## [1.5.0] - 2026-07-23
### Changed
- Switched auto-update publishing back to GitHub Releases on the public repository `Messer1337/AccBrowser` for instant 100% reliable auto-updates across all macOS and Windows devices without CORS or host restrictions.

## [1.4.0] - 2026-07-23
### Fixed
- Guaranteed Cloud Firestore upload for all newly created profiles. Previously, newly created empty-cookie profiles were skipping Firestore setDoc because unchanged cookie hash checks bypassed metadata sync.

## [1.3.0] - 2026-07-23
### Added
- Team User Accounts & Permissions Multi-PC Cloud Sync (`teamUsers` Cloud Firestore collection). Creating/editing team accounts on Mac #1 now instantly syncs to Mac #2 Admin panel.

## [1.2.0] - 2026-07-23
### Added
- Real live network proxy pinging via HTTP/SOCKS5 tunnels (`ip-api.com`), fetching real IP, country, and timezone.
- Instant cloud authorization revocation on user deletion (`deleteDoc` on `authorizedUsers/{uid}`).
- Dynamic ESM imports for proxy agents (`https-proxy-agent`, `socks-proxy-agent`).
- Modern 3D Glassmorphic macOS squircle icon and `app.setName('OASIS Browser')` Dock title.

## [1.1.0] - 2026-07-23
### Added
- Firebase Authentication tied to local accounts, so Firestore security rules can verify who's asking instead of trusting any request that has the app's config.
- `authorizedUsers` Firestore collection gating profile/audit-log access — admin-provisioned, not self-service.
- Encrypted profile backup: export/import all profiles to a password-protected `.oasisbak` file (AES-256-GCM).
- Per-profile timezone field, applied via `page.emulateTimezone()` to stay consistent with the proxy's geography.
- WebRTC leak protection (`disable_non_proxied_udp`) and a hardened proxy bypass list whenever a proxy is configured.
- User management panel (create/edit/delete team accounts and per-profile access) and a team audit log (who launched/edited/deleted what, when).
- One-click connection health check with a trust-score style report per profile.
- Auto-update support via `electron-updater`.

### Changed
- Passwords are now hashed (previously stored in plaintext); default admin/admin forces a password change on first login.
- Cookie sync interval reduced from 15s to 5s (safe now that unchanged cookies are deduped before hitting Firestore).
- Cookies synced to Firestore are trimmed of known tracking cookies and capped in size to stay under the 1MB document limit.

### Fixed
- `process.env.USER` (undefined on Windows) no longer breaks cross-device sync — replaced with a generated per-install device ID.
- Profile IDs are validated against path traversal before being used to build filesystem paths.

## [1.0.0] - 2026-07-22
### Added
- Initial release: isolated Chrome profiles per account, proxy + fingerprint injection per profile, Firestore-based cookie sync across teammates, local-only fallback when cloud sync isn't configured.
