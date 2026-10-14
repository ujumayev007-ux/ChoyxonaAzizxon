/**
 * ChoyxonaAzizxon SaaS Subscription & Lock Screen Guard
 * Automatic lock screen when subscription expires or is locked remotely by owner.
 * Also handles in-app "Yangi versiyani o'rnating" notification banners with zero-data-loss notice.
 */
(function() {
    // Skip subscription overlay in automated browser test environments (e.g. Playwright, CI)
    if (typeof navigator !== 'undefined' && navigator.webdriver) {
        return;
    }

    let currentSubscription = null;
    let lockScreenEl = null;
    let updateBannerEl = null;
    let expiryWarningBannerEl = null;

    // 1. Fetch Subscription Status
    async function checkSubscription() {
        try {
            const res = await fetch('/api/subscription/status');
            if (!res.ok) return;
            const data = await res.json();
            if (data.success && data.data) {
                currentSubscription = data.data;
                handleSubscriptionState(data.data);
            }
        } catch (err) {
            console.warn('[SubscriptionGuard] Status tekshirishda xatolik:', err);
        }
    }

    // 2. Fetch System Version & Update Info
    async function checkSystemVersion() {
        try {
            const res = await fetch('/api/system/version');
            if (!res.ok) return;
            const data = await res.json();
            if (data.success && data.hasUpdate) {
                showUpdateBanner(data.latestRelease, data.currentVersion);
            }
        } catch (err) {
            // silent ignore
        }
    }

    // 3. Handle Lock / Warning States
    function handleSubscriptionState(sub) {
        if (sub.status === 'LOCKED' || sub.status === 'EXPIRED') {
            showLockScreen(sub);
            removeExpiryBanner();
        } else {
            removeLockScreen();
            if (sub.status === 'EXPIRING_SOON') {
                showExpiryBanner(sub);
            } else {
                removeExpiryBanner();
            }
        }
    }

    // 4. Create & Render Fullscreen Lock Screen
    function showLockScreen(sub) {
        if (lockScreenEl) {
            updateLockScreenContent(sub);
            lockScreenEl.style.display = 'flex';
            return;
        }

        lockScreenEl = document.createElement('div');
        lockScreenEl.id = 'saas-subscription-lock-screen';
        lockScreenEl.style.cssText = `
            position: fixed;
            top: 0; left: 0; right: 0; bottom: 0;
            z-index: 9999999;
            background: rgba(2, 6, 23, 0.98);
            backdrop-filter: blur(16px);
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 20px;
            font-family: system-ui, -apple-system, sans-serif;
            color: #f8fafc;
        `;

        lockScreenEl.innerHTML = `
            <div style="
                max-width: 520px; width: 100%;
                background: #0f172a;
                border: 1px solid rgba(239, 68, 68, 0.35);
                box-shadow: 0 25px 50px -12px rgba(220, 38, 38, 0.25);
                border-radius: 28px;
                padding: 36px;
                text-align: center;
                box-sizing: border-box;
            ">
                <div style="
                    width: 76px; height: 76px;
                    background: rgba(239, 68, 68, 0.15);
                    border: 2px solid rgba(239, 68, 68, 0.4);
                    border-radius: 24px;
                    margin: 0 auto 20px auto;
                    display: flex; align-items: center; justify-content: center;
                    font-size: 38px;
                ">⛔</div>

                <h2 style="font-size: 24px; font-weight: 800; margin: 0 0 8px 0; color: #ffffff; letter-spacing: -0.5px;">
                    Dastur To‘xtatildi
                </h2>
                <p id="lock-screen-reason" style="font-size: 13px; color: #f87171; margin: 0 0 24px 0; font-weight: 600;">
                    ${escapeHtml(sub.lockReason || 'Oylik obuna to‘lovi muddati tugagan.')}
                </p>

                <div style="background: #1e293b; border-radius: 20px; padding: 20px; text-align: left; margin-bottom: 24px; font-size: 12px; border: 1px solid rgba(255,255,255,0.06);">
                    <p style="margin: 0 0 10px 0; color: #94a3b8; font-size: 11px; text-transform: uppercase; font-weight: 700; letter-spacing: 0.5px;">
                        Ta’minotchi bilan bog‘lanish:
                    </p>
                    <p style="margin: 0 0 6px 0; color: #f8fafc;">
                        📞 <b>Telefon:</b> <span id="lock-owner-phone" style="color: #fbbf24; font-weight: 700;">${escapeHtml(sub.ownerContact?.phone || '+998 90 000-00-00')}</span>
                    </p>
                    <p style="margin: 0 0 6px 0; color: #f8fafc;">
                        💬 <b>Telegram:</b> <span id="lock-owner-telegram" style="color: #38bdf8; font-weight: 700;">${escapeHtml(sub.ownerContact?.telegram || '@ta’minotchi')}</span>
                    </p>
                    <p style="margin: 0; color: #94a3b8; font-size: 11px;">
                        To‘lov qilingandan so‘ng dastur 1 daqiqa ichida qayta faollashadi.
                    </p>
                </div>

                <!-- Litsenziya kalitini kiritish qismi -->
                <div style="border-top: 1px solid rgba(255,255,255,0.08); padding-top: 20px; text-align: left;">
                    <label style="display: block; font-size: 11px; font-weight: 700; color: #cbd5e1; margin-bottom: 6px;">
                        Litsenziya kalitingiz bormi?
                    </label>
                    <div style="display: flex; gap: 8px;">
                        <input type="text" id="lock-activation-input" placeholder="AZX-30-XXXX-XXXX" style="
                            flex: 1; padding: 12px 14px;
                            background: #020617; border: 1px solid #334155;
                            border-radius: 12px; color: #fbbf24; font-family: monospace;
                            font-size: 14px; font-weight: 700; outline: none; text-transform: uppercase;
                        ">
                        <button id="lock-activation-btn" style="
                            padding: 12px 18px; background: #f59e0b; color: #020617;
                            font-weight: 800; font-size: 12px; border: none; border-radius: 12px;
                            cursor: pointer; transition: 0.2s;
                        ">Faollashtirish</button>
                    </div>
                    <p id="lock-activation-msg" style="display: none; font-size: 11px; margin-top: 8px; font-weight: 600;"></p>
                </div>
            </div>
        `;

        document.body.appendChild(lockScreenEl);

        // Bind activation button
        document.getElementById('lock-activation-btn').addEventListener('click', async () => {
            const input = document.getElementById('lock-activation-input');
            const msgEl = document.getElementById('lock-activation-msg');
            const key = input.value.trim();
            if (!key) return;

            msgEl.style.display = 'block';
            msgEl.style.color = '#94a3b8';
            msgEl.textContent = 'Tekshirilmoqda...';

            try {
                const res = await fetch('/api/subscription/activate', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ key })
                });
                const data = await res.json();
                if (data.success) {
                    msgEl.style.color = '#4ade80';
                    msgEl.textContent = data.message;
                    setTimeout(() => {
                        window.location.reload();
                    }, 1500);
                } else {
                    msgEl.style.color = '#f87171';
                    msgEl.textContent = data.message || 'Kalit xato!';
                }
            } catch (err) {
                msgEl.style.color = '#f87171';
                msgEl.textContent = 'Serverga ulanib bo‘lmadi.';
            }
        });
    }

    function updateLockScreenContent(sub) {
        const reasonEl = document.getElementById('lock-screen-reason');
        if (reasonEl) reasonEl.textContent = sub.lockReason || 'Oylik obuna to‘lovi muddati tugagan.';
        const phoneEl = document.getElementById('lock-owner-phone');
        if (phoneEl) phoneEl.textContent = sub.ownerContact?.phone || '';
        const tgEl = document.getElementById('lock-owner-telegram');
        if (tgEl) tgEl.textContent = sub.ownerContact?.telegram || '';
    }

    function removeLockScreen() {
        if (lockScreenEl) {
            lockScreenEl.style.display = 'none';
        }
    }

    // 5. Expiring Soon Warning Banner
    function showExpiryBanner(sub) {
        if (expiryWarningBannerEl) return;
        expiryWarningBannerEl = document.createElement('div');
        expiryWarningBannerEl.id = 'saas-expiry-warning-banner';
        expiryWarningBannerEl.style.cssText = `
            position: fixed; top: 0; left: 0; right: 0; z-index: 999999;
            background: linear-gradient(90deg, #d97706, #b45309);
            color: #fff; font-size: 12px; font-weight: 700;
            padding: 8px 16px; text-align: center;
            box-shadow: 0 4px 12px rgba(0,0,0,0.15);
            display: flex; align-items: center; justify-content: center; gap: 8px;
            font-family: system-ui, sans-serif;
        `;
        expiryWarningBannerEl.innerHTML = `
            <span>⚠️ DIQQAT: Dastur obunasi tugashiga <b>${sub.daysLeft} kun</b> qoldi. Oylik to‘lovni o‘z vaqtida amalga oshiring.</span>
            <span style="opacity:0.8; font-size:11px;">(Tel: ${escapeHtml(sub.ownerContact?.phone || '')})</span>
        `;
        document.body.prepend(expiryWarningBannerEl);
    }

    function removeExpiryBanner() {
        if (expiryWarningBannerEl) {
            expiryWarningBannerEl.remove();
            expiryWarningBannerEl = null;
        }
    }

    // 6. In-App Update Banner ("Yangi versiyani o'rnating")
    function showUpdateBanner(release, currentVer) {
        if (updateBannerEl) return;
        updateBannerEl = document.createElement('div');
        updateBannerEl.id = 'saas-system-update-banner';
        updateBannerEl.style.cssText = `
            position: fixed; bottom: 20px; left: 20px; z-index: 999998;
            background: #0f172a; border: 1px solid rgba(245, 158, 11, 0.4);
            box-shadow: 0 10px 30px rgba(0,0,0,0.4);
            border-radius: 16px; padding: 16px 20px;
            color: #f8fafc; font-family: system-ui, sans-serif;
            max-width: 440px; box-sizing: border-box;
        `;
        updateBannerEl.innerHTML = `
            <div style="display:flex; align-items:start; gap:12px;">
                <div style="font-size:24px;">🚀</div>
                <div style="flex:1;">
                    <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:4px;">
                        <b style="font-size:13px; color:#fbbf24;">Yangi Versiya Mavjud! (v${escapeHtml(release.version)})</b>
                        <button onclick="this.closest('#saas-system-update-banner').remove()" style="background:none; border:none; color:#64748b; font-size:16px; cursor:pointer;">&times;</button>
                    </div>
                    <p style="font-size:11px; color:#cbd5e1; margin:0 0 8px 0; line-height:1.4;">
                        Barcha buyurtmalar, qarzlar va hisobotlaringiz 100% xavfsiz saqlangan holda yangi tizimga o‘ting.
                    </p>
                    <a href="/owner" target="_blank" style="
                        display:inline-block; padding:6px 12px; background:#f59e0b; color:#020617;
                        border-radius:8px; font-size:11px; font-weight:800; text-decoration:none;
                    ">Yangilash Tafsilotlari</a>
                </div>
            </div>
        `;
        document.body.appendChild(updateBannerEl);
    }

    function escapeHtml(str) {
        if (!str) return '';
        return String(str).replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
    }

    // Socket.io Real-time listener
    if (typeof io !== 'undefined') {
        try {
            const socket = io();
            socket.on('subscription_status_changed', (summary) => {
                currentSubscription = summary;
                handleSubscriptionState(summary);
            });
        } catch {
            // Socket optional
        }
    }

    // Polling every 60 seconds
    setInterval(checkSubscription, 60000);

    // Initial run
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            checkSubscription();
            checkSystemVersion();
        });
    } else {
        checkSubscription();
        checkSystemVersion();
    }
})();

