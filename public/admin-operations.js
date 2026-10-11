let operationsData;
const opsEscape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const opsField = 'w-full rounded-lg border border-slate-200 p-2 text-sm';
async function loadOperationsSettings() {
    const root = document.getElementById('operations-settings');
    try {
        operationsData = await apiFetch('/api/admin/operations');
        const d = operationsData;
        root.innerHTML = `<section class="bg-white rounded-xl border p-5 space-y-4"><h2 class="text-lg font-bold">PIN orqali kirish</h2><p class="text-sm text-slate-500">Har bir admin, ofitsant va kassir uchun alohida 4 raqamli PIN belgilang. PIN o‘zgarsa, xodim qayta kiradi.</p><div class="grid gap-3 md:grid-cols-2">${d.users.map(user => `<form data-pin-user="${opsEscape(user.id)}" class="border rounded-xl p-3 space-y-2"><b>${opsEscape(user.fullName)}</b><p class="text-xs">${opsEscape(user.username)} · ${{ ADMIN: 'Admin', WAITER: 'Ofitsant', CASHIER: 'Kassir' }[user.role]} · ${user.hasPin ? 'PIN mavjud' : 'PIN belgilanmagan'}</p><input name="pin" type="password" inputmode="numeric" pattern="[0-9]{4}" minlength="4" maxlength="4" required placeholder="Yangi 4 raqamli PIN" autocomplete="new-password" class="${opsField}"><button class="rounded-lg bg-blue-600 px-3 py-2 text-white">PIN saqlash</button> <button type="button" data-remove-pin="${opsEscape(user.id)}" class="text-red-600 text-sm">PINni o‘chirish</button></form>`).join('')}</div></section>
        <section class="bg-white rounded-xl border p-5 space-y-4"><h2 class="text-lg font-bold">Printerlar va kategoriya yo‘nalishlari</h2><p class="text-sm text-slate-500">Har bir kategoriya bitta faol printerga biriktiriladi. USB printer uchun Windows’da o‘rnatilgan printer nomini kiriting.</p><div class="flex flex-wrap gap-2">${d.printers.map(p => `<button type="button" data-edit-printer="${opsEscape(p.id)}" class="rounded-lg border px-3 py-2 text-sm">${opsEscape(p.name)} · ${p.isActive ? 'Faol' : 'O‘chiq'}</button>`).join('')}<button type="button" data-edit-printer="new" class="rounded-lg bg-blue-600 px-3 py-2 text-white">+ Printer qo‘shish</button></div><div id="printer-editor"></div></section>
        <section class="bg-white rounded-xl border p-5 space-y-4"><h2 class="text-lg font-bold">Chek sozlamalari</h2><form id="receipt-config" class="space-y-3"><label class="block text-sm">Chek sarlavhasi<input name="header" maxlength="150" value="${opsEscape(d.config.header)}" class="${opsField}"></label><label class="block text-sm">Chek yakunidagi yozuv<input name="footer" maxlength="250" value="${opsEscape(d.config.footer)}" class="${opsField}"></label><button class="bg-blue-600 text-white px-4 py-2 rounded-lg">Saqlash</button></form></section>
        <section class="bg-white rounded-xl border p-5 space-y-4"><h2 class="text-lg font-bold">Printer kompyuterini ulash</h2><p class="text-sm">${d.config.agentConfigured ? 'Ulash kaliti yaratilgan.' : 'Ulash kaliti hali yaratilmagan.'} Restorandagi kompyuterda Node.js va ulash dasturi ishlashi kerak. Printer sozlamalari shu paneldan olinadi.</p><button type="button" id="create-agent-token" class="bg-indigo-600 text-white rounded-lg px-4 py-2">Yangi ulash kaliti yaratish</button><div id="agent-token-result" class="text-sm break-all"></div><p class="text-xs text-slate-500">Yangi kalit yaratilganda oldingi kalit ishlamaydi.</p><a href="/printer-setup.html" target="_blank" class="text-blue-600 underline">Ulash yo‘riqnomasi va dastur</a></section>
        <section class="bg-white rounded-xl border p-5 space-y-3"><div class="flex justify-between"><h2 class="text-lg font-bold">Cheklar navbati</h2><button type="button" id="refresh-operations" class="text-blue-600">Yangilash</button></div><p class="text-xs text-slate-500">“Yuborildi” — printer yoki Windows chop etish navbatiga topshirilgan. Qog‘oz chiqqanini printerda tekshiring.</p>${d.jobs.map(j => `<div class="border-b py-2 text-sm">№${opsEscape(j.order.orderNumber)} · ${opsEscape(d.printers.find(p => p.id === j.printerId)?.name || 'Printer biriktirish kutilmoqda')} · <b>${({ KUTILMOQDA: 'Navbatda', CHOP_ETILMOQDA: 'Yuborilmoqda', YUBORILDI: 'Yuborildi', XATOLIK: 'Xatolik' })[j.status] || opsEscape(j.status)}</b>${['XATOLIK', 'CHOP_ETILMOQDA'].includes(j.status) ? ` <button type="button" data-retry-job="${opsEscape(j.id)}" class="text-blue-600 underline">Qayta yuborish</button>` : ''}</div>`).join('') || '<p>Cheklar yo‘q.</p>'}</section>`;
    } catch (error) { root.textContent = error.message; }
}
function editOperationsPrinter(id) {
    const p = operationsData.printers.find(p => p.id === id) || { id: 'new', name: '', department: 'Umumiy Oshxona', ipAddress: '', port: 9100, paperWidth: 80, connectionType: 'TCP', isActive: true, categoryIds: [] };
    document.getElementById('printer-editor').innerHTML = `<form id="printer-settings-form" data-id="${opsEscape(p.id)}" class="grid md:grid-cols-2 gap-3 rounded-xl bg-slate-50 p-4">
        <label class="text-sm">Printer nomi<input name="name" required maxlength="100" value="${opsEscape(p.name)}" class="${opsField}"></label><label class="text-sm">Bo‘lim<input name="department" required maxlength="100" value="${opsEscape(p.department)}" placeholder="Kabobxona" class="${opsField}"></label>
        <label class="text-sm">Ulanish turi<select name="connectionType" class="${opsField}"><option value="TCP" ${p.connectionType === 'TCP' ? 'selected' : ''}>Tarmoq printeri (IP)</option><option value="WINDOWS" ${p.connectionType === 'WINDOWS' ? 'selected' : ''}>Windows printeri (USB yoki tarmoq)</option></select></label><label class="text-sm">IP manzili yoki Windows printer nomi<input name="ipAddress" required maxlength="200" value="${opsEscape(p.ipAddress)}" class="${opsField}"></label>
        <label class="text-sm">Port (IP printer uchun)<input name="port" type="number" min="1" max="65535" value="${p.port}" class="${opsField}"></label><label class="text-sm">Qog‘oz eni<select name="paperWidth" class="${opsField}"><option value="80" ${p.paperWidth === 80 ? 'selected' : ''}>80 mm</option><option value="58" ${p.paperWidth === 58 ? 'selected' : ''}>58 mm</option></select></label>
        <fieldset class="md:col-span-2"><legend class="font-bold text-sm mb-2">Shu printerga yuboriladigan kategoriyalar</legend><div class="flex flex-wrap gap-3">${operationsData.categories.map(c => `<label class="text-sm"><input type="checkbox" name="categoryIds" value="${opsEscape(c.id)}" ${p.categoryIds.includes(c.id) ? 'checked' : ''}> ${opsEscape(c.name)}</label>`).join('')}</div></fieldset>
        <label class="text-sm"><input name="isActive" type="checkbox" ${p.isActive ? 'checked' : ''}> Printer faol</label><button class="bg-blue-600 text-white rounded-lg p-2">Printerni saqlash</button></form>`;
}
document.getElementById('operations-settings').addEventListener('submit', async event => {
    event.preventDefault(); const form = event.target, values = new FormData(form), button = form.querySelector('button'); button.disabled = true;
    try {
        if (form.dataset.pinUser) await apiFetch(`/api/admin/users/${encodeURIComponent(form.dataset.pinUser)}/pin`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pin: values.get('pin') }) });
        else if (form.id === 'receipt-config') await apiFetch('/api/admin/print-config', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(Object.fromEntries(values)) });
        else if (form.id === 'printer-settings-form') await apiFetch(`/api/admin/printers/${encodeURIComponent(form.dataset.id)}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...Object.fromEntries(values), port: Number(values.get('port')), paperWidth: Number(values.get('paperWidth')), isActive: values.has('isActive'), categoryIds: values.getAll('categoryIds') }) });
        await loadOperationsSettings();
    } catch (error) { alert(error.message); } finally { button.disabled = false; }
});
document.getElementById('operations-settings').addEventListener('click', async event => {
    const button = event.target.closest('button'); if (!button || button.type !== 'button') return;
    try {
        if (button.dataset.editPrinter) return editOperationsPrinter(button.dataset.editPrinter);
        if (button.id === 'refresh-operations') return loadOperationsSettings();
        if (button.id === 'create-agent-token') {
            if (!confirm('Yangi kalit yaratilsinmi? Oldingi printer ulanishi to‘xtaydi.')) return;
            const data = await apiFetch('/api/admin/print-agent-token', { method: 'POST' });
            document.getElementById('agent-token-result').textContent = `Kalitni xavfsiz saqlang (faqat hozir ko‘rsatiladi): ${data.token}`;
        }
        if (button.dataset.removePin && confirm('Ushbu xodimning PIN orqali kirishi o‘chirilsinmi?')) {
            await apiFetch(`/api/admin/users/${encodeURIComponent(button.dataset.removePin)}/pin`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pin: null }) }); await loadOperationsSettings();
        }
        if (button.dataset.retryJob && confirm('Chek avval chiqmaganini tekshiring. Qayta yuborish takroriy chek chiqarishi mumkin. Davom etilsinmi?')) {
            await apiFetch(`/api/admin/print-jobs/${encodeURIComponent(button.dataset.retryJob)}/retry`, { method: 'POST' }); await loadOperationsSettings();
        }
    } catch (error) { alert(error.message); }
});
