function settingValueText(value) { return typeof value === 'boolean' ? (value ? 'Ha' : 'Yo‘q') : String(value ?? ''); }
const settingLabels = {
    alerts: 'Avtomatik ogohlantirishlar', lowStock: 'Omborda kam qolgan mahsulotlar', delayedOrderMinutes: 'Buyurtma kechikishi (daqiqa; 0 — o‘chiq)', unclosedShiftHours: 'Yopilmagan smena (soat; 0 — o‘chiq)', printerFailures: 'Printer xatolari', backupFailures: 'Zaxira nusxa xatolari', failedPayments: 'To‘lov xatolari',
    restaurant: 'Restoran ma’lumotlari', payments: 'Kassir va to‘lovlar', orders: 'Ofitsant va buyurtmalar',
    restaurantName: 'Restoran nomi', address: 'Manzil', phone: 'Telefon', timezone: 'Vaqt mintaqasi', logoUrl: 'Logotip havolasi (HTTPS)', workingHours: 'Ish vaqti', serviceFeePercent: 'Xizmat haqi (%)',
    cash: 'Naqd to‘lov', card: 'Karta orqali to‘lov', electronic: 'Elektron to‘lov', split: 'Aralash to‘lov', requireOpenShift: 'To‘lovdan oldin kassa smenasi ochilishi shart', refunds: 'Qaytarishga ruxsat', maxDiscountPercent: 'Eng katta chegirma (%)', debtLimit: 'Bir mijozning qarz chegarasi (0 — cheklanmagan)', cashDifferenceLimit: 'Admin tasdig‘isiz kassa farqi chegarasi (0 — cheklanmagan)',
    autoApprove: 'Ofitsant buyurtmasini avtomatik tasdiqlash', cancellation: 'Buyurtmani bekor qilishga ruxsat', tableTransfer: 'Boshqa stolga o‘tkazishga ruxsat', waiterReassignment: 'Ofitsantni almashtirishga ruxsat'
};
async function loadRestaurantSettings() {
    const root = document.getElementById('restaurant-settings');
    try {
        const data = await apiFetch('/api/admin/settings');
        root.innerHTML = ['restaurant', 'payments', 'orders', 'alerts'].map(key => `<form data-settings="${key}" class="bg-white border rounded-xl p-5 space-y-3"><h2 class="font-bold text-lg">${settingLabels[key]}</h2>${Object.entries(data[key]).map(([field, value]) => `<label class="block text-sm">${settingLabels[field]} <input class="border rounded p-2 ${typeof value === 'boolean' ? '' : 'block w-full'}" name="${field}" type="${typeof value === 'boolean' ? 'checkbox' : typeof value === 'number' ? 'number' : 'text'}" ${typeof value === 'boolean' ? (value ? 'checked' : '') : `value="${escapeHtml(String(value))}"`} ${typeof value === 'number' ? 'min="0" step="0.01"' : 'maxlength="500"'}></label>`).join('')}<button class="bg-blue-600 text-white rounded px-4 py-2">Saqlash</button><output class="block text-sm"></output></form>`).join('') + '<section id="settings-history" class="bg-white border rounded-xl p-5"></section>';
        await loadSettingsHistory();
    } catch (error) { root.textContent = error.message; }
}
async function loadSettingsHistory() {
    const rows = (await apiFetch('/api/admin/settings/history')).filter(row => row.key !== 'telegramReport');
    document.getElementById('settings-history').innerHTML = `<h2 class="font-bold text-lg">Sozlamalar tarixi</h2>${rows.map(row => `<details class="border-b py-3"><summary>${escapeHtml(settingLabels[row.key] || 'Sozlamalar')} · ${escapeHtml(new Date(row.createdAt).toLocaleString('uz-UZ'))}</summary><p class="text-sm">Xodim: ${escapeHtml(row.actorName || row.actorId)}</p>${Object.keys(row.value).filter(k => row.previous[k] !== row.value[k]).map(k => `<p class="text-sm">${escapeHtml(settingLabels[k] || k)}: ${escapeHtml(settingValueText(row.previous[k]))} → ${escapeHtml(settingValueText(row.value[k]))}</p>`).join('')}<button data-restore-settings="${row.id}" class="text-blue-600">Oldingi qiymatlarga qaytarish</button></details>`).join('') || '<p>Hali o‘zgarishlar yo‘q</p>'}`;
}
document.getElementById('restaurant-settings').onsubmit = async event => {
    event.preventDefault(); const form = event.target.closest('[data-settings]'); if (!form) return;
    const value = Object.fromEntries([...form.querySelectorAll('input')].map(input => [input.name, input.type === 'checkbox' ? input.checked : input.type === 'number' ? Number(input.value) : input.value]));
    const button = form.querySelector('button'); button.disabled = true;
    try { await apiFetch(`/api/admin/settings/${form.dataset.settings}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value) }); form.querySelector('output').textContent = 'Saqlandi'; window.dispatchEvent(new Event('restaurant-settings-saved')); await loadSettingsHistory(); }
    catch (error) { form.querySelector('output').textContent = error.message; } finally { button.disabled = false; }
};
async function loadOrderControls(root) {
    const [orders, users, rooms] = await Promise.all([apiFetch('/api/orders?active=true'), apiFetch('/api/users'), apiFetch('/api/rooms')]);
    const section = document.createElement('section'); section.className = 'bg-white border rounded-xl p-5 space-y-3';
    section.innerHTML = `<h2 class="font-bold">Faol buyurtmani boshqarish</h2><form id="order-control" class="space-y-3"><select name="order" class="border p-2 w-full" required><option value="">Buyurtmani tanlang</option>${orders.map(o => `<option value="${o.id}">${escapeHtml(o.orderNumber)} · Stol ${escapeHtml(String(o.tableNumber || '—'))} · ${escapeHtml(String(o.totalAmount))} so‘m</option>`).join('')}</select><select name="action" class="border p-2 w-full"><option value="discount">Chegirma</option><option value="transfer">Boshqa stolga o‘tkazish</option><option value="reassign">Ofitsantni almashtirish</option><option value="cancel">Bekor qilish</option></select><input name="discount" type="number" min="0" step="0.01" class="border p-2 w-full" placeholder="Chegirma summasi (so‘m)"><select name="table" hidden class="border p-2 w-full">${rooms.flatMap(r => (r.tables || []).map(t => `<option value="${t.id}">${escapeHtml(r.name)} · Stol ${t.number}</option>`)).join('')}</select><select name="waiter" hidden class="border p-2 w-full">${users.filter(u => u.role === 'WAITER' && u.isActive).map(u => `<option value="${u.id}">${escapeHtml(u.fullName)}</option>`).join('')}</select><input name="reason" required minlength="3" maxlength="500" class="border p-2 w-full" placeholder="O‘zgartirish sababi"><button class="bg-blue-600 text-white rounded px-4 py-2">Amalni bajarish</button><output class="block"></output></form>`;
    root.append(section); const form = section.querySelector('form');
    form.elements.action.onchange = () => { for (const [field, action] of [['discount', 'discount'], ['table', 'transfer'], ['waiter', 'reassign']]) form.elements[field].hidden = form.elements.action.value !== action; };
    form.onsubmit = async event => {
        event.preventDefault(); event.stopPropagation(); const fields = form.elements, action = fields.action.value;
        const value = action === 'transfer' ? fields.table.value : action === 'reassign' ? fields.waiter.value : fields.discount.value;
        const button = form.querySelector('button'); button.disabled = true;
        try { await apiFetch(`/api/admin/order-control/${fields.order.value}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, value, reason: fields.reason.value }) }); await loadRestaurantSettings(); }
        catch (error) { form.querySelector('output').textContent = error.message; button.disabled = false; }
    };
}
document.getElementById('restaurant-settings').onclick = async event => {
    const button = event.target.closest('[data-restore-settings]'); if (!button || !confirm('Bu o‘zgarishdan oldingi sozlamalar tiklansinmi?')) return;
    button.disabled = true;
    try { await apiFetch(`/api/admin/settings/history/${button.dataset.restoreSettings}/restore`, { method: 'POST' }); await loadRestaurantSettings(); }
    catch (error) { alert(error.message); button.disabled = false; }
};
