(() => {
    const fieldLabels = { ...settingLabels, enabled: 'Avtomatik yuborish', revenue: 'Tushum', expenses: 'Xarajatlar', netProfit: 'Hisobiy sof foyda', debts: 'Qarzlar', waiters: 'Ofitsantlar natijalari', inventory: 'Ombor', hourly: 'Soatlik', daily: 'Belgilangan vaqtlarda', times: 'Vaqtlar', shiftOpen: 'Smena ochilganda', shiftClose: 'Smena yopilganda' };
    const root = document.getElementById('data-settings'); let pin = '';
    async function api(path, method = 'GET', body) { return apiFetch('/api/admin/data' + path, { method, headers: { 'Content-Type': 'application/json', 'x-admin-pin': pin }, ...(body ? { body: JSON.stringify(body) } : {}) }); }
    function lock() {
        pin = ''; root.innerHTML = '<section class="bg-white border rounded-xl p-5"><h2 class="font-bold text-lg">Zaxira nusxalari va ma’lumotlar</h2><form class="mt-3 flex gap-3"><input type="password" name="pin" inputmode="numeric" pattern="[0-9]{4}" maxlength="4" required autocomplete="off" placeholder="Admin PIN" class="border rounded p-2"><button class="bg-blue-600 text-white rounded px-4">Ochish</button></form><output></output></section>';
        root.querySelector('form').onsubmit = async event => { event.preventDefault(); pin = event.target.elements.pin.value; event.target.elements.pin.value = ''; try { await load(); } catch (error) { pin = ''; root.querySelector('output').textContent = error.message; } };
    }
    async function load() {
        if (window.adminHasOtherDrafts?.(root)) return;
        const rows = await api('/backups');
        root.innerHTML = `<section class="bg-white border rounded-xl p-5 space-y-3"><div class="flex justify-between"><h2 class="font-bold text-lg">Zaxira nusxalari va ma’lumotlar</h2><button data-data="lock">Qulflash</button></div><p class="text-sm">Biznes ma’lumotlari shifrlangan nusxaga saqlanadi. Parollar, PINlar, sessiyalar va bot kalitlari kiritilmaydi. Nusxani yuklab olib, serverdan alohida xavfsiz joyda saqlang.</p><button data-data="create" class="bg-blue-600 text-white rounded px-4 py-2">Yangi nusxa yaratish</button><a class="text-blue-600 block" href="/data-recovery.html" target="_blank">Saqlash va tiklash yo‘riqnomasi</a>${rows.map(r => `<div class="border-b py-2 text-sm">${escapeHtml(new Date(r.createdAt).toLocaleString('uz-UZ'))} · ${r.status === 'TAYYOR' ? 'Tayyor' : r.status === 'XATOLIK' ? 'Xatolik' : 'Jarayonda'} ${r.status === 'TAYYOR' ? `<button data-data="download" data-id="${r.id}" class="text-blue-600">Yuklab olish</button> · <button data-data="preview" data-id="${r.id}" class="text-blue-600">Tekshirish va sozlamalarni tiklash</button>` : ''}</div>`).join('')}<div id="backup-preview"></div><h3 class="font-bold">Ma’lumotlarni eksport qilish</h3><form id="data-export" class="flex flex-wrap gap-3"><select name="kind" class="border p-2"><option value="payments">To‘lovlar</option><option value="inventory">Ombor harakatlari</option></select><input name="from" type="date" required class="border p-2"><input name="to" type="date" required class="border p-2"><button class="text-blue-600">JSON yuklab olish</button></form><h3 class="font-bold">Buyurtmalar arxivi</h3><p class="text-sm">Faqat yakunlangan, qarzi qolmagan buyurtmalar arxivlanadi. To‘lovlar va hisobot ma’lumotlari saqlanadi.</p><form id="data-archive" class="flex gap-3"><input name="before" type="date" required class="border p-2"><select name="action" class="border p-2"><option value="archive">Sanadan oldingilarni arxivlash</option><option value="restore">Arxivdan qaytarish</option></select><button class="text-blue-600">Bajarish</button></form><output class="block"></output></section>`;
        root.querySelector('#data-export').onsubmit = async event => { event.preventDefault(); const f = event.target.elements; try { await download(`/export/${f.kind.value}?from=${encodeURIComponent(f.from.value + 'T00:00:00Z')}&to=${encodeURIComponent(f.to.value + 'T23:59:59Z')}`, `restoran-${f.kind.value}.json`); } catch (error) { report(error); } };
        root.querySelector('#data-archive').onsubmit = async event => { event.preventDefault(); const f = event.target.elements; try { const result = await api('/archive', 'POST', { before: f.before.value, restore: f.action.value === 'restore' }); root.querySelector('output').textContent = `${result.count} ta buyurtma yangilandi`; } catch (error) { report(error); } };
    }
    function report(error) { root.querySelector('output').textContent = error.message; }
    async function download(path, name) {
        const response = await fetch('/api/admin/data' + path, { headers: { 'x-admin-pin': pin }, credentials: 'same-origin' });
        if (!response.ok) throw Error((await response.json()).message || 'Yuklab bo‘lmadi');
        const url = URL.createObjectURL(await response.blob()), a = document.createElement('a'); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
    root.onclick = async event => {
        const button = event.target.closest('[data-data]'); if (!button) return; const action = button.dataset.data, id = button.dataset.id;
        if (action === 'lock') { lock(); return; } button.disabled = true;
        try {
            if (action === 'create') { await api('/backups', 'POST'); await load(); }
            else if (action === 'download') await download(`/backups/${id}/download`, `restoran-${id}.encrypted.json`);
            else if (action === 'preview') {
                const preview = await api(`/backups/${id}/preview`);
                const labels = { restaurant: 'Restoran', payments: 'To‘lovlar', orders: 'Buyurtmalar', alerts: 'Ogohlantirishlar', telegramReport: 'Telegram hisobotlari', waiterService:'Xizmat ruxsatlari', kitchenTv:'Oshxona TV' };
                document.getElementById('backup-preview').innerHTML = `<form id="backup-restore" class="border rounded p-4 space-y-3"><h3 class="font-bold">Tiklashdan oldin tekshiring</h3><p class="text-sm">Quyidagi tanlangan sozlamalar tiklanadi. Moliyaviy yozuvlar va buyurtmalar bu amal bilan o‘zgarmaydi.</p>${Object.entries(preview.settings).map(([key, value]) => `<details><summary><label><input type="checkbox" name="keys" value="${key}"> ${labels[key]}</label></summary><pre class="text-xs whitespace-pre-wrap">${Object.entries(value).map(([field, saved]) => escapeHtml(fieldLabels[field] || settingLabels[field] || 'Sozlama') + ': ' + escapeHtml(settingValueText(saved))).join('\n')}</pre></details>`).join('')}<input name="confirmation" required placeholder="SOZLAMALARNI TIKLASH" class="border p-2 w-full"><button class="bg-amber-600 text-white rounded px-3 py-2">Tanlangan sozlamalarni tiklash</button></form>`;
                document.getElementById('backup-restore').onsubmit = async event => { event.preventDefault(); const form = event.target; try { await api(`/backups/${id}/restore-settings`, 'POST', { keys: [...form.querySelectorAll('[name=keys]:checked')].map(i => i.value), confirmation: form.elements.confirmation.value }); await load(); } catch (error) { report(error); } };
            }
        } catch (error) { report(error); } finally { button.disabled = false; }
    };
    document.addEventListener('visibilitychange', () => { if (document.hidden) lock(); }); lock();
})();
