(() => {
    const root = document.getElementById('telegram-settings');
    let pin = '';
    async function api(path, method = 'GET', body) {
        return apiFetch('/api/admin/telegram' + path, { method, headers: { 'Content-Type': 'application/json', 'x-admin-pin': pin }, ...(body ? { body: JSON.stringify(body) } : {}) });
    }
    function lock() {
        pin = '';
        root.innerHTML = '<section class="bg-white border rounded-xl p-5"><h2 class="font-bold text-lg">Telegram boshqaruvi</h2><form id="telegram-unlock" class="flex gap-3 mt-3"><input name="pin" type="password" inputmode="numeric" pattern="[0-9]{4}" maxlength="4" required placeholder="Admin PIN" autocomplete="off" class="border rounded p-2"><button class="bg-blue-600 text-white rounded px-4">Ochish</button></form><output></output></section>';
        root.querySelector('form').onsubmit = async event => { event.preventDefault(); pin = event.target.elements.pin.value; event.target.elements.pin.value = ''; try { await load(); } catch (error) { pin = ''; root.querySelector('output').textContent = error.message; } };
    }
    async function load() {
        const [config, subscribers, deliveries] = await Promise.all([api('/config'), api('/subscribers'), api('/deliveries')]);
        root.innerHTML = `<section class="bg-white border rounded-xl p-5 space-y-4"><div class="flex justify-between"><h2 class="font-bold text-lg">Telegram boshqaruvi</h2><button data-tg="lock">Qulflash</button></div><p>Bot: ${config.configured ? 'Sozlangan' : 'Sozlanmagan'}</p><form data-tg-form="token" class="space-y-2"><input name="token" type="password" autocomplete="new-password" required placeholder="Yangi bot tokeni" class="border rounded p-2 w-full"><button class="text-blue-600">Botni tekshirish va saqlash</button><p class="text-xs">Bot almashtirilganda qabul qiluvchilar qayta tasdiqlanadi.</p></form><form data-tg-form="recipient" class="space-y-2"><h3 class="font-bold">Qabul qiluvchi qo‘shish</h3><input name="name" required minlength="2" maxlength="100" placeholder="Ism" class="border p-2"><input name="chatId" required pattern="[0-9]{1,20}" placeholder="Shaxsiy Chat ID" class="border p-2"><button class="text-blue-600">Qo‘shish</button></form><p class="text-xs">Qabul qiluvchi avval botni shaxsiy chatda ishga tushiradi. Unga yuborilgan kod orqali hisob tasdiqlanadi.</p>${subscribers.data.map(s => `<div class="border rounded p-3 space-y-2"><b>${escapeHtml(s.name)}</b> · ${escapeHtml(s.chatId)} · ${s.verifiedAt ? 'Tasdiqlangan' : 'Tasdiqlanmagan'}<div class="flex gap-3 flex-wrap"><button data-tg="code" data-id="${s.id}" class="text-blue-600">Kod yuborish</button><button data-tg="verify" data-id="${s.id}" class="text-blue-600">Kodni kiritish</button><button data-tg="test" data-id="${s.id}">Sinov xabari</button><button data-tg="toggle" data-active="${s.isActive}" data-id="${s.id}">${s.isActive ? 'To‘xtatish' : 'Faollashtirish'}</button><button data-tg="delete" data-id="${s.id}" class="text-red-600">O‘chirish</button></div></div>`).join('')}<h3 class="font-bold">Yuborish tarixi</h3>${deliveries.map(d => `<p class="text-sm border-b py-2">${escapeHtml(new Date(d.createdAt).toLocaleString('uz-UZ'))} · ${escapeHtml(d.chatId)} · ${escapeHtml(({ TASDIQLASH: 'Tasdiqlash', SINOV: 'Sinov', XABAR: 'Xabar', HISOBOT: 'Hisobot' })[d.kind] || 'Xabar')} · ${d.status === 'YUBORILDI' ? 'Yuborildi' : 'Yuborilmadi'}</p>`).join('') || '<p>Hali xabarlar yo‘q</p>'}<output class="block"></output></section>`;
    }
    root.onsubmit = async event => {
        const form = event.target.closest('[data-tg-form]'); if (!form) return; event.preventDefault();
        const button = form.querySelector('button'); button.disabled = true;
        try {
            if (form.dataset.tgForm === 'token') { const token = form.elements.token.value; form.elements.token.value = ''; await api('/config', 'PUT', { token }); }
            else await api('/subscribers', 'POST', { name: form.elements.name.value, chatId: form.elements.chatId.value });
            await load();
        } catch (error) { root.querySelector('output').textContent = error.message; button.disabled = false; }
    };
    root.onclick = async event => {
        const button = event.target.closest('[data-tg]'); if (!button) return;
        const action = button.dataset.tg, id = button.dataset.id;
        if (action === 'lock') { lock(); return; }
        button.disabled = true;
        try {
            if (action === 'verify') { const code = prompt('Telegramga kelgan 6 raqamli kod:'); if (code) await api(`/subscribers/${id}/verify`, 'POST', { code }); }
            else if (action === 'delete') { if (confirm('Qabul qiluvchi o‘chirilsinmi?')) await api(`/subscribers/${id}`, 'DELETE'); }
            else if (action === 'toggle') await api(`/subscribers/${id}`, 'PUT', { isActive: button.dataset.active !== 'true' });
            else await api(`/subscribers/${id}/${action}`, 'POST');
            await load();
        } catch (error) { root.querySelector('output').textContent = error.message; button.disabled = false; }
    };
    document.addEventListener('visibilitychange', () => { if (document.hidden) lock(); });
    lock();
})();
