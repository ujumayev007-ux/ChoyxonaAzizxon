/**
 * Device Authorization Agent for ChoyxonaAzizxon
 * Generates persistent device identity, checks approval with Super Owner,
 * intercepts fetch calls to attach device credentials, and listens for real-time approvals.
 */
(function() {
    // Skip device overlay in automated browser test environments (e.g. Playwright, CI)
    if (typeof navigator !== 'undefined' && navigator.webdriver) {
        return;
    }

    // Generate or retrieve persistent Device ID
    let deviceId = localStorage.getItem('restaurant_device_id');
    if (!deviceId) {
        deviceId = 'dev_' + Math.random().toString(36).substring(2, 10) + '_' + Date.now().toString(36);
        localStorage.setItem('restaurant_device_id', deviceId);
    }

    let deviceToken = localStorage.getItem('restaurant_device_token') || '';
    let deviceStatus = localStorage.getItem('restaurant_device_status') || 'PENDING';
    let overlayEl = null;

    // Detect device type & name
    function getDeviceFriendlyName() {
        const ua = navigator.userAgent;
        let os = 'Noma’lum OS';
        if (ua.includes('Windows')) os = 'Windows PC';
        else if (ua.includes('Macintosh')) os = 'Mac PC';
        else if (ua.includes('iPad')) os = 'iPad Planshet';
        else if (ua.includes('Android')) os = ua.includes('Mobile') ? 'Android Telefon' : 'Android Planshet';
        else if (ua.includes('iPhone')) os = 'iPhone';

        let browser = 'Browser';
        if (ua.includes('Chrome')) browser = 'Chrome';
        else if (ua.includes('Safari')) browser = 'Safari';
        else if (ua.includes('Firefox')) browser = 'Firefox';
        else if (ua.includes('Edg')) browser = 'Edge';

        return `${os} (${browser})`;
    }

    const deviceName = getDeviceFriendlyName();
    const tenantId = localStorage.getItem('restaurant_tenant_id') || 'choyxona-azizxon-default-tenant';

    // Intercept native fetch to inject device authorization headers
    const originalFetch = window.fetch;
    window.fetch = function(url, options = {}) {
        options.headers = options.headers || {};
        if (options.headers instanceof Headers) {
            options.headers.set('x-device-id', deviceId);
            options.headers.set('x-device-name', deviceName);
            options.headers.set('x-tenant-id', tenantId);
            if (deviceToken) options.headers.set('x-device-token', deviceToken);
        } else if (Array.isArray(options.headers)) {
            options.headers.push(['x-device-id', deviceId]);
            options.headers.push(['x-device-name', deviceName]);
            options.headers.push(['x-tenant-id', tenantId]);
            if (deviceToken) options.headers.push(['x-device-token', deviceToken]);
        } else {
            options.headers['x-device-id'] = deviceId;
            options.headers['x-device-name'] = deviceName;
            options.headers['x-tenant-id'] = tenantId;
            if (deviceToken) options.headers['x-device-token'] = deviceToken;
        }
        return originalFetch(url, options);
    };

    // Check device authorization status with server
    async function checkDeviceAuth() {
        try {
            const res = await originalFetch(`/api/devices/status?tenantId=${tenantId}&deviceId=${deviceId}&token=${deviceToken}`);
            const data = await res.json();

            if (data.success) {
                deviceStatus = data.status;
                localStorage.setItem('restaurant_device_status', deviceStatus);

                if (data.authorized) {
                    removeDeviceApprovalOverlay();
                    if (data.device?.token) {
                        deviceToken = data.device.token;
                        localStorage.setItem('restaurant_device_token', deviceToken);
                    }
                } else {
                    showDeviceApprovalOverlay(data.status, data.reason);
                }
            }
        } catch (err) {
            console.warn('[DeviceAgent] Tekshirishda xatolik:', err);
        }
    }

    // Register device initially if needed
    async function registerDevice() {
        try {
            const res = await originalFetch('/api/devices/register', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    tenantId,
                    deviceId,
                    deviceName,
                    fingerprint: navigator.userAgent
                })
            });
            const data = await res.json();
            if (data.success) {
                deviceStatus = data.status;
                localStorage.setItem('restaurant_device_status', deviceStatus);
                if (data.device?.token) {
                    deviceToken = data.device.token;
                    localStorage.setItem('restaurant_device_token', deviceToken);
                }
                if (data.status !== 'APPROVED') {
                    showDeviceApprovalOverlay(data.status);
                }
            }
        } catch (err) {
            console.warn('[DeviceAgent] Ro‘yxatga olishda xatolik:', err);
        }
    }

    function showDeviceApprovalOverlay(status, reason) {
        if (overlayEl) {
            updateOverlayText(status, reason);
            overlayEl.style.display = 'flex';
            return;
        }

        overlayEl = document.createElement('div');
        overlayEl.id = 'saas-device-approval-overlay';
        overlayEl.style.cssText = `
            position: fixed; top: 0; left: 0; right: 0; bottom: 0;
            z-index: 99999999; background: rgba(2, 6, 23, 0.98);
            backdrop-filter: blur(14px); display: flex; align-items: center; justify-content: center;
            padding: 20px; font-family: system-ui, -apple-system, sans-serif; color: #f8fafc;
        `;

        overlayEl.innerHTML = `
            <div style="
                max-width: 480px; width: 100%; background: #0f172a;
                border: 1px solid rgba(245, 158, 11, 0.35); border-radius: 28px;
                padding: 36px; text-align: center; box-shadow: 0 25px 50px rgba(0,0,0,0.5);
            ">
                <div id="device-icon" style="
                    width: 76px; height: 76px; background: rgba(245, 158, 11, 0.15);
                    border: 2px solid rgba(245, 158, 11, 0.4); border-radius: 24px;
                    margin: 0 auto 20px auto; display: flex; align-items: center; justify-content: center;
                    font-size: 38px;
                ">⏳</div>

                <h2 id="device-title" style="font-size: 22px; font-weight: 800; margin: 0 0 8px 0; color: #fff;">
                    Qurilmani Tasdiqlash Kutilmoqda
                </h2>
                <p id="device-desc" style="font-size: 13px; color: #94a3b8; margin: 0 0 20px 0; line-height: 1.5;">
                    Ushbu qurilma (${deviceName}) orqali tizimga kirish uchun Super Owner ruxsati kerak. So‘rov yuborildi.
                </p>

                <div style="background: #1e293b; border-radius: 16px; padding: 16px; font-size: 12px; text-align: left; margin-bottom: 20px;">
                    <p style="margin: 0 0 6px 0; color: #cbd5e1;"><b>Qurilma ID:</b> <code style="color: #fbbf24;">${deviceId}</code></p>
                    <p style="margin: 0 0 6px 0; color: #cbd5e1;"><b>Model:</b> ${deviceName}</p>
                    <p style="margin: 0; color: #64748b; font-size: 11px;">Ruxsat berilgach, ekran avtomatik ochiladi.</p>
                </div>

                <button onclick="location.reload()" style="
                    width: 100%; padding: 12px; background: #1e293b; color: #cbd5e1;
                    font-weight: 700; font-size: 12px; border: 1px solid #334155; border-radius: 12px;
                    cursor: pointer;
                ">Qayta Tekshirish</button>
            </div>
        `;

        document.body.appendChild(overlayEl);
        updateOverlayText(status, reason);
    }

    function updateOverlayText(status, reason) {
        const icon = document.getElementById('device-icon');
        const title = document.getElementById('device-title');
        const desc = document.getElementById('device-desc');
        if (!icon || !title || !desc) return;

        if (status === 'BLOCKED') {
            icon.textContent = '⛔';
            icon.style.borderColor = 'rgba(239, 68, 68, 0.4)';
            icon.style.background = 'rgba(239, 68, 68, 0.15)';
            title.textContent = 'Qurilma Bloklangan';
            desc.textContent = reason || 'Ushbu qurilma Super Owner tomonidan xavfsizlik sababli bloklangan.';
        } else if (status === 'REJECTED') {
            icon.textContent = '❌';
            icon.style.borderColor = 'rgba(239, 68, 68, 0.4)';
            icon.style.background = 'rgba(239, 68, 68, 0.15)';
            title.textContent = 'Ruxsat Rad Etildi';
            desc.textContent = reason || 'Ushbu qurilmaning tizimga ulanishi Super Owner tomonidan rad etildi.';
        } else {
            icon.textContent = '⏳';
            title.textContent = 'Qurilmani Tasdiqlash Kutilmoqda';
            desc.textContent = `Ushbu qurilma (${deviceName}) orqali tizimga kirish uchun Super Owner ruxsati kerak. Telegram orqali so‘rov yuborildi.`;
        }
    }

    function removeDeviceApprovalOverlay() {
        if (overlayEl) {
            overlayEl.style.display = 'none';
        }
    }

    // Socket.io Real-time approval listener
    if (typeof io !== 'undefined') {
        try {
            const socket = io();
            socket.on(`device_authorized_${deviceId}`, (data) => {
                if (data.status === 'APPROVED') {
                    deviceToken = data.token;
                    localStorage.setItem('restaurant_device_token', deviceToken);
                    localStorage.setItem('restaurant_device_status', 'APPROVED');
                    removeDeviceApprovalOverlay();
                    window.location.reload();
                } else if (data.status === 'BLOCKED' || data.status === 'REJECTED') {
                    showDeviceApprovalOverlay(data.status, data.reason);
                }
            });
        } catch {}
    }

    // Initialize
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            registerDevice();
            setInterval(checkDeviceAuth, 30000);
        });
    } else {
        registerDevice();
        setInterval(checkDeviceAuth, 30000);
    }
})();

