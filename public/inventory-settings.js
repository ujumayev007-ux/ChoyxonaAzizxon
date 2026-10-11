async function loadInventorySettings() {
    const root = document.getElementById('inventory-settings');
    try {
        const [products, history, alerts] = await Promise.all([apiFetch('/api/inventory'), apiFetch('/api/admin/inventory/history'), apiFetch('/api/admin/settings/alerts')]);
        root.innerHTML = `<section class="bg-white border rounded-xl p-5 space-y-3"><h2 class="font-bold text-lg">Ombor sanoq va chegaralari</h2><p class="text-sm">Retsept bo‘yicha sarflar mavjud to‘lov oqimida avtomatik hisoblanadi. Sanoq saqlanganda qoldiq boshqa amal bilan o‘zgarmagani tekshiriladi.</p><form id="stocktake-form" class="space-y-3"><div class="overflow-auto"><table class="w-full text-sm"><thead><tr><th>Mahsulot</th><th>Joriy qoldiq</th><th>Sanog‘ingiz</th><th>Minimal qoldiq</th></tr></thead><tbody>${products.map(p => `<tr data-stock-id="${p.id}" data-expected="${p.quantity}" data-minimum="${p.minQuantity}"><td>${escapeHtml(p.name)} (${escapeHtml(p.unit)})</td><td>${escapeHtml(String(p.quantity))}</td><td><input name="quantity" type="number" min="0" step="0.001" value="${p.quantity}" class="border rounded p-2 w-28" required></td><td><input name="minimum" type="number" min="0" step="0.001" value="${p.minQuantity}" class="border rounded p-2 w-28" required></td></tr>`).join('')}</tbody></table></div><input name="reason" minlength="3" maxlength="500" required placeholder="Sanoq yoki tuzatish sababi" class="border p-2 w-full"><button class="bg-blue-600 text-white rounded px-4 py-2">O‘zgargan qiymatlarni saqlash</button><output class="block"></output></form><details><summary class="font-bold">Ombor harakatlari tarixi</summary>${history.map(h => `<p class="text-sm border-b py-2">${escapeHtml(new Date(h.createdAt).toLocaleString('uz-UZ'))} · ${escapeHtml(h.inventory.name)}: ${h.quantityBefore} → ${h.quantityAfter} · ${escapeHtml(h.user.fullName)} · ${escapeHtml(h.reason || '')}</p>`).join('')}</details></section><section class="bg-white border rounded-xl p-5 space-y-3"><h2 class="font-bold text-lg">Ogohlantirishlar</h2><button data-refresh-alerts class="text-blue-600">Yangilash</button>${alerts.map(a => `<div class="border-b py-2 text-sm">${escapeHtml(a.message)} <button data-resolve-alert="${escapeHtml(a.id)}" class="text-blue-600">Ko‘rib chiqildi</button></div>`).join('') || '<p>Faol ogohlantirish yo‘q</p>'}<p class="text-xs">Holat har daqiqada tekshiriladi. Sabab bartaraf etilmasa ogohlantirish qayta ochiladi.</p></section>`;
        root.querySelector('form').onsubmit = async event => {
            event.preventDefault(); const form = event.target, button = form.querySelector('button');
            const items = [...form.querySelectorAll('[data-stock-id]')].map(row => ({ id: row.dataset.stockId, expected: row.dataset.expected, quantity: row.querySelector('[name=quantity]').value, minQuantity: row.querySelector('[name=minimum]').value, oldMin: row.dataset.minimum })).filter(i => Number(i.expected) !== Number(i.quantity) || Number(i.oldMin) !== Number(i.minQuantity));
            if (!items.length) { form.querySelector('output').textContent = 'O‘zgartirilgan qiymat yo‘q'; return; }
            button.disabled = true;
            try { await apiFetch('/api/admin/inventory/stocktake', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ items, reason: form.elements.reason.value }) }); await loadInventorySettings(); }
            catch (error) { form.querySelector('output').textContent = error.message; button.disabled = false; }
        };
    } catch (error) { root.textContent = error.message; }
}
document.getElementById('inventory-settings').onclick = async event => {
    try {
        const button = event.target.closest('[data-resolve-alert]');
        if (button) { await apiFetch(`/api/admin/settings/alerts/${encodeURIComponent(button.dataset.resolveAlert)}/resolve`, { method: 'POST' }); await loadInventorySettings(); }
        if (event.target.closest('[data-refresh-alerts]')) await loadInventorySettings();
    } catch (error) { alert(error.message); }
};
