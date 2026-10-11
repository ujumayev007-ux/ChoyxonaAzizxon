/* Shared durable mutations: retries reuse the original payload and identifier. */
window.ServiceClient = (() => {
    let user;
    function requestId() {
        if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
        // getRandomValues also works on LAN HTTP pages, where randomUUID is unavailable.
        const bytes = crypto.getRandomValues(new Uint8Array(16));
        bytes[6] = (bytes[6] & 0x0f) | 0x40;
        bytes[8] = (bytes[8] & 0x3f) | 0x80;
        const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
        return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
    }
    const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
    async function get(path) {
        const response = await fetch('/api/service' + path, { credentials: 'same-origin' });
        const result = await response.json();
        if (!response.ok) throw Object.assign(new Error(result.message || 'Ma’lumotni yuklab bo‘lmadi'), { status: response.status });
        return result;
    }
    async function init() { const result = await get('/config'); user = result.user; return result; }
    const keyFor = slot => `service-pending:${user.id}:${slot}`;
    function pending(slot) { try { return JSON.parse(localStorage.getItem(keyFor(slot)) || 'null'); } catch { return null; } }
    async function post(path, body, slot = path) {
        if (!user) await init();
        const key = keyFor(slot);
        let saved = pending(slot);
        if (!saved) {
            saved = { path, body: { ...body, actorId: user.id, idempotencyKey: requestId() } };
            localStorage.setItem(key, JSON.stringify(saved));
        }
        // Once sent, never replace an uncertain request with edited form values.
        if (saved.path !== path) throw new Error('Avval natijasi noma’lum so‘rovni qayta tekshiring');
        try {
            const response = await fetch('/api/service' + saved.path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(saved.body) });
            const result = await response.json();
            if (!response.ok) {
                if (response.status < 500) localStorage.removeItem(key);
                throw Object.assign(new Error(result.message || 'Rad etildi'), { status: response.status });
            }
            localStorage.removeItem(key); return result;
        } catch (error) {
            if (!error.status) throw new Error('Natijani qayta tekshirish kerak. Qayta bosish avvalgi so‘rovni yuboradi.');
            throw error;
        }
    }
    return { get, post, init, pending, esc, requestId, get user() { return user; } };
})();
