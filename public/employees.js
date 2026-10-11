function employeeAvatarIcon(key) { return ({ person: '👤', chef: '👨‍🍳', service: '🤵', cashier: '🧑‍💼', star: '⭐', flower: '🌷' })[key] || '👤'; }
function employeeAvatarOptions(selected) {
    return Object.entries({ '': 'Avatarsiz', person: 'Xodim', chef: 'Oshpaz', service: 'Xizmat', cashier: 'Kassir', star: 'Yulduz', flower: 'Gul' })
        .map(([key, label]) => `<option value="${key}" ${key === (selected || '') ? 'selected' : ''}>${employeeAvatarIcon(key)} ${label}</option>`).join('');
}
function employeeDialog(title, body) {
    const dialog = document.createElement('dialog');
    dialog.className = 'rounded-2xl p-6 w-full max-w-xl shadow-xl max-h-[90vh] overflow-y-auto';
    dialog.innerHTML = `<div class="flex justify-between mb-4"><h2 class="font-bold text-xl">${title}</h2><button type="button" data-close>Yopish</button></div>${body}`;
    document.body.append(dialog); dialog.querySelector('[data-close]').onclick = () => dialog.close();
    dialog.onclose = () => dialog.remove(); dialog.showModal(); return dialog;
}
function editEmployee(id) {
    const employee = adminData.employees.find(e => e.id === id); if (!employee) return;
    const dialog = employeeDialog('Xodimni tahrirlash', `<form class="space-y-3">
        ${[['fullName', 'Ism'], ['username', 'Login'], ['phone', 'Telefon']].map(([key, label]) => `<label class="block text-sm">${label}<input name="${key}" required value="${escapeHtml(employee[key] || '')}" class="w-full border rounded-xl p-2"></label>`).join('')}
        <label class="block text-sm">Lavozim<select name="role" class="w-full border rounded-xl p-2">${Object.entries({ ADMIN: 'Admin', WAITER: 'Ofitsant', CASHIER: 'Kassir', KITCHEN: 'Oshxona' }).map(([value, label]) => `<option value="${value}" ${employee.role === value ? 'selected' : ''}>${label}</option>`).join('')}</select></label>
        <label class="block text-sm">Yangi parol (bo‘sh qoldirilsa saqlanadi)<input name="password" type="password" minlength="8" autocomplete="new-password" class="w-full border rounded-xl p-2"></label>
        <label class="block text-sm">Yangi PIN (4 raqam, bo‘sh qoldirilsa saqlanadi)<input name="pin" type="password" pattern="[0-9]{4}" maxlength="4" inputmode="numeric" autocomplete="new-password" class="w-full border rounded-xl p-2"></label>
        <label class="block text-sm"><input name="removePin" type="checkbox"> PINni olib tashlash</label>
        <label class="block text-sm">Avatar<select name="avatar" class="w-full border rounded-xl p-2">${employeeAvatarOptions(employee.avatar)}</select><span data-preview class="block text-4xl mt-2">${employeeAvatarIcon(employee.avatar)}</span></label>
        <label class="block text-sm">Ofitsant foizi<input name="commissionPercent" type="number" min="0" max="100" step="0.01" value="${Number(employee.waiterProfile?.commissionPercent ?? 10)}" class="w-full border rounded-xl p-2"></label>
        <label class="block text-sm"><input name="isActive" type="checkbox" ${employee.isActive ? 'checked' : ''}> Faol</label>
        <p data-error class="text-sm text-red-600"></p><button type="submit" class="bg-blue-600 text-white rounded-xl px-4 py-2">Saqlash</button></form>`);
    dialog.querySelector('[name="avatar"]').onchange = event => dialog.querySelector('[data-preview]').textContent = employeeAvatarIcon(event.target.value);
    dialog.querySelector('form').onsubmit = async event => {
        event.preventDefault(); const values = new FormData(event.target), button = event.target.querySelector('[type="submit"]'); button.disabled = true;
        const body = Object.fromEntries(values); body.isActive = values.has('isActive'); body.avatar = body.avatar || null;
        if (!body.password) delete body.password;
        if (values.has('removePin')) body.pin = null; else if (!body.pin) delete body.pin;
        delete body.removePin;
        try { await apiFetch(`/api/employees/${encodeURIComponent(id)}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); await loadEmployees(); dialog.close(); }
        catch (error) { dialog.querySelector('[data-error]').textContent = error.message; } finally { button.disabled = false; }
    };
}
async function employeeHistory(id) {
    const dialog = employeeDialog('Amallar tarixi', '<div data-history>Yuklanmoqda...</div>');
    try {
        const events = await apiFetch(`/api/employees/${encodeURIComponent(id)}/history`);
        const names = { EMPLOYEE_CREATED: 'Xodim yaratildi', EMPLOYEE_UPDATED: 'Xodim tahrirlandi', EMPLOYEE_PIN_UPDATED: 'PIN o‘zgartirildi' };
        const describe = value => {
            if (!value) return '—';
            const data = JSON.parse(value), labels = { username: 'Login', fullName: 'Ism', phone: 'Telefon', role: 'Lavozim', isActive: 'Faol', avatar: 'Avatar', passwordChanged: 'Parol o‘zgartirildi', pinChanged: 'PIN o‘zgartirildi', pinEnabled: 'PIN faol' };
            return Object.entries(labels).filter(([key]) => Object.hasOwn(data, key)).map(([key, label]) => `${label}: ${typeof data[key] === 'boolean' ? (data[key] ? 'Ha' : 'Yo‘q') : key === 'avatar' ? employeeAvatarIcon(data[key]) : ({ ADMIN: 'Admin', WAITER: 'Ofitsant', CASHIER: 'Kassir', KITCHEN: 'Oshxona' })[data[key]] || data[key] || '—'}`).join('\n');
        };
        dialog.querySelector('[data-history]').innerHTML = events.length ? events.map(e => `<article class="border-b py-3 text-sm"><b>${escapeHtml(names[e.action] || 'Profil yangilandi')}</b><p>${escapeHtml(e.user?.fullName || 'Tizim')} · ${escapeHtml(new Date(e.createdAt).toLocaleString('uz-UZ'))}</p><details><summary>O‘zgarish tafsilotlari</summary><pre class="whitespace-pre-wrap break-all text-xs">${escapeHtml(describe(e.oldValue))}
→ ${escapeHtml(describe(e.newValue))}</pre></details></article>`).join('') : 'Hozircha tarix yo‘q.';
    } catch (error) { dialog.querySelector('[data-history]').textContent = error.message; }
}
