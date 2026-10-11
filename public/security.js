function auditActionLabel(action) {
    const labels = { PAYMENT_RECEIVED: 'To‘lov qabul qilindi', SESSION_REVOKED: 'Sessiya yakunlandi', ORDER_APPROVED: 'Buyurtma tasdiqlandi', ORDER_REJECTED: 'Buyurtma rad etildi', INVENTORY_STOCKTAKE: 'Sanoq tuzatildi', BACKUP_DOWNLOADED: 'Nusxa yuklab olindi', BACKUP_SETTINGS_RESTORED: 'Sozlamalar tiklandi', ORDERS_ARCHIVED: 'Arxivlandi', ORDERS_UNARCHIVED: 'Arxivdan qaytarildi' };
    return labels[action] || (action.includes('CREATED') ? 'Yaratildi' : action.includes('UPDATED') || action.includes('SETTINGS') ? 'O‘zgartirildi' : action.includes('DELETED') || action.includes('REMOVED') ? 'O‘chirildi' : 'Amal qayd etildi');
}
async function loadSecuritySettings() {
    const root = document.getElementById('security-settings');
    try {
        const [sessions, permissions, audit] = await Promise.all([apiFetch('/api/admin/security/sessions'), apiFetch('/api/admin/role-permissions'), apiFetch('/api/admin/security/audit')]);
        root.innerHTML = `<section class="bg-white border rounded-xl p-5 space-y-3"><h2 class="font-bold text-lg">Xavfsizlik va ruxsatlar</h2><form id="security-permissions-form" class="space-y-3">${permissions.data.map(p => `<label class="block text-sm"><input type="checkbox" data-permission="${escapeHtml(p.permissionKey)}" data-role="${p.role}" data-original="${p.enabled}" ${p.enabled ? 'checked' : ''}> ${escapeHtml(p.label)}</label>`).join('')}<button class="bg-blue-600 text-white rounded px-4 py-2">Ruxsatlarni saqlash</button><output class="block text-sm"></output></form><p class="text-xs text-slate-500">PINlar va hisob holati Xodimlar bo‘limida boshqariladi.</p></section>
        <section class="bg-white border rounded-xl p-5 space-y-3"><h2 class="font-bold">Faol sessiyalar</h2>${sessions.map(s => `<div class="border-b py-2 text-sm"><b>${escapeHtml(s.user.fullName)}</b> · ${escapeHtml(new Date(s.lastSeenAt).toLocaleString('uz-UZ'))}<p class="text-xs text-slate-500 break-all">${escapeHtml(s.userAgent || '')}</p><button data-revoke-session="${s.id}" class="text-red-600">Sessiyani yakunlash</button></div>`).join('') || 'Faol sessiyalar yo‘q'}</section>
        <section class="bg-white border rounded-xl p-5 space-y-3"><h2 class="font-bold">Muhim amallar tarixi</h2><p class="text-xs text-slate-500">So‘nggi 200 amal. Maxfiy qiymatlar ko‘rsatilmaydi.</p>${audit.map(a => `<p class="border-b py-2 text-sm">${escapeHtml(a.user?.fullName || 'Tizim')} · ${escapeHtml(new Date(a.createdAt).toLocaleString('uz-UZ'))} · ${escapeHtml(auditActionLabel(a.action))} · ${escapeHtml(({ User: 'Xodim', Order: 'Buyurtma', Payment: 'To‘lov', CustomerDebt: 'Qarz', AuthSession: 'Sessiya', WaiterShift: 'Davomat', AttendanceConfig: 'Davomat sozlamalari', MenuItem: 'Taom', InventoryProduct: 'Ombor mahsuloti', RolePermission: 'Ruxsat', CashSession: 'Kassa smenasi', Expense: 'Xarajat', Refund: 'Qaytarish' })[a.entity] || 'Tizim amali')}</p>`).join('')}</section>`;
    } catch (error) { root.textContent = error.message; }
}
document.getElementById('security-settings').onsubmit = async event => {
    const form = event.target.closest('#security-permissions-form'); if (!form) return; event.preventDefault();
    const button = form.querySelector('button'), output = form.querySelector('output'); button.disabled = true;
    const inputs = [...form.querySelectorAll('[data-permission]')].filter(input => String(input.checked) !== input.dataset.original);
    let saved = 0;
    try { for (const input of inputs) {
        await apiFetch('/api/admin/role-permissions/' + input.dataset.role + '/' + encodeURIComponent(input.dataset.permission), { method:'PUT', headers:{'Content-Type':'application/json'}, body:JSON.stringify({enabled:input.checked}) });
        input.dataset.original = String(input.checked); saved++;
    } output.textContent = inputs.length ? 'Ruxsatlar saqlandi' : 'O‘zgartirilgan qiymat yo‘q'; form.dispatchEvent(new Event('settings-form-saved', {bubbles:true})); }
    catch(error) { output.textContent = saved + ' ta ruxsat saqlandi. Qolganlari: ' + error.message; }
    finally { button.disabled = false; form.dispatchEvent(new Event('settings-permissions-updated', {bubbles:true})); }
};
document.getElementById('security-settings').onclick = async event => {
    const button = event.target.closest('[data-revoke-session]'); if (!button || !confirm('Bu sessiya yakunlansinmi?')) return;
    try { await apiFetch(`/api/admin/security/sessions/${button.dataset.revokeSession}/revoke`, { method: 'POST' }); await loadSecuritySettings(); } catch (error) { alert(error.message); }
};
