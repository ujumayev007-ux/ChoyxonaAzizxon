async function loadSecuritySettings() {
    const root = document.getElementById('security-settings');
    try {
        const [sessions, permissions, audit] = await Promise.all([apiFetch('/api/admin/security/sessions'), apiFetch('/api/admin/role-permissions'), apiFetch('/api/admin/security/audit')]);
        root.innerHTML = `<section class="bg-white border rounded-xl p-5 space-y-3"><h2 class="font-bold text-lg">Xavfsizlik va ruxsatlar</h2>${permissions.data.map(p => `<label class="block text-sm"><input type="checkbox" data-permission="${escapeHtml(p.permissionKey)}" data-role="${p.role}" ${p.enabled ? 'checked' : ''}> ${escapeHtml(p.label)}</label>`).join('')}<p class="text-xs text-slate-500">PINlar va hisob holati Xodimlar bo‘limida boshqariladi.</p></section>
        <section class="bg-white border rounded-xl p-5 space-y-3"><h2 class="font-bold">Faol sessiyalar</h2>${sessions.map(s => `<div class="border-b py-2 text-sm"><b>${escapeHtml(s.user.fullName)}</b> · ${escapeHtml(new Date(s.lastSeenAt).toLocaleString('uz-UZ'))}<p class="text-xs text-slate-500 break-all">${escapeHtml(s.userAgent || '')}</p><button data-revoke-session="${s.id}" class="text-red-600">Sessiyani yakunlash</button></div>`).join('') || 'Faol sessiyalar yo‘q'}</section>
        <section class="bg-white border rounded-xl p-5 space-y-3"><h2 class="font-bold">Muhim amallar tarixi</h2><p class="text-xs text-slate-500">So‘nggi 200 amal. Maxfiy qiymatlar ko‘rsatilmaydi.</p>${audit.map(a => `<p class="border-b py-2 text-sm">${escapeHtml(a.user?.fullName || 'Tizim')} · ${escapeHtml(new Date(a.createdAt).toLocaleString('uz-UZ'))} · ${escapeHtml(({ User: 'Xodim', Order: 'Buyurtma', Payment: 'To‘lov', CustomerDebt: 'Qarz', AuthSession: 'Sessiya', WaiterShift: 'Davomat', AttendanceConfig: 'Davomat sozlamalari', MenuItem: 'Taom', InventoryProduct: 'Ombor mahsuloti', RolePermission: 'Ruxsat', CashSession: 'Kassa smenasi', Expense: 'Xarajat', Refund: 'Qaytarish' })[a.entity] || 'Tizim amali')}</p>`).join('')}</section>`;
    } catch (error) { root.textContent = error.message; }
}
document.getElementById('security-settings').onchange = async event => {
    const input = event.target.closest('[data-permission]'); if (!input) return;
    try { await apiFetch(`/api/admin/role-permissions/${input.dataset.role}/${encodeURIComponent(input.dataset.permission)}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled: input.checked }) }); } catch (error) { input.checked = !input.checked; alert(error.message); }
};
document.getElementById('security-settings').onclick = async event => {
    const button = event.target.closest('[data-revoke-session]'); if (!button || !confirm('Bu sessiya yakunlansinmi?')) return;
    try { await apiFetch(`/api/admin/security/sessions/${button.dataset.revokeSession}/revoke`, { method: 'POST' }); await loadSecuritySettings(); } catch (error) { alert(error.message); }
};
