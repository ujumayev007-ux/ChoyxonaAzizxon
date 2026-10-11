const attEscape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
let attendanceUser, attendanceRows = [], cameraStream, cameraTimer;
async function attendanceApi(path, method = 'GET', body) {
    const response = await fetch(`/api/attendance${path}`, { method, headers: { 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
    const data = await response.json(); if (!response.ok) throw Error(data.message || 'Amal bajarilmadi'); return data;
}
function attendanceError(error) { document.getElementById('notice').textContent = error.message; }
async function loadAttendanceHistory() {
    const form = document.getElementById('history-filter');
    const from = new Date(form.elements.from.value + 'T00:00:00'), to = new Date(form.elements.to.value + 'T23:59:59');
    const data = await attendanceApi(`/history?from=${encodeURIComponent(from.toISOString())}&to=${encodeURIComponent(to.toISOString())}`);
    attendanceRows = data.rows;
    document.getElementById('current').textContent = data.active ? `Ishga kirilgan: ${new Date(data.active.checkInTime).toLocaleString('uz-UZ')}` : 'Hozir ochiq smena yo‘q';
    document.getElementById('punch').elements.action.value = data.active ? 'OUT' : 'IN';
    document.getElementById('history').innerHTML = `<table class="w-full text-sm"><thead><tr>${['Xodim', 'Kirish', 'Chiqish', 'Soat', 'Kechikish (daq.)', 'Erta ketish (daq.)', 'Amal'].map(x => `<th class="p-2 text-left">${x}</th>`).join('')}</tr></thead><tbody>${data.rows.map(r => `<tr class="border-t"><td class="p-2">${attEscape(r.waiter.fullName)}</td><td>${attEscape(new Date(r.checkInTime).toLocaleString('uz-UZ'))}</td><td>${r.checkOutTime ? attEscape(new Date(r.checkOutTime).toLocaleString('uz-UZ')) : 'Ochiq'}</td><td>${r.totalHours ?? '—'}</td><td>${r.lateMinutes}</td><td>${r.earlyMinutes}</td><td>${attendanceUser.role === 'ADMIN' ? `<button data-correct="${attEscape(r.id)}" class="text-blue-600">Tuzatish</button>` : '—'}</td></tr>`).join('')}</tbody></table>`;
}
async function loadAttendanceConfig() {
    const data = await attendanceApi('/config'), form = document.getElementById('config');
    form.elements.enabled.checked = data.enabled;
    for (const name of ['startTime', 'endTime', 'timezone', 'graceMinutes']) form.elements[name].value = data[name];
    form.querySelectorAll('[name="methods"]').forEach(input => { input.checked = data.methods.includes(input.value); });
    document.getElementById('punch').elements.method.innerHTML = data.methods.map(m => `<option value="${m}">${m}</option>`).join('');
    document.getElementById('punch').querySelector('button').disabled = !data.enabled;
}
document.getElementById('punch').onsubmit = async event => {
    event.preventDefault(); const form = event.target, button = form.querySelector('button'); button.disabled = true;
    try { await attendanceApi('/punch', 'POST', { method: form.elements.method.value, action: form.elements.action.value,
        pin: form.elements.method.value === 'PIN' ? form.elements.credential.value : undefined,
        token: form.elements.method.value === 'QR' ? form.elements.credential.value.replace(/^CHOYXONA_ATTENDANCE:/, '') : undefined });
        form.elements.credential.value = ''; document.getElementById('notice').textContent = 'Davomat saqlandi'; await loadAttendanceHistory();
    } catch (error) { attendanceError(error); } finally { button.disabled = false; }
};
document.getElementById('config').onsubmit = async event => {
    event.preventDefault(); const values = new FormData(event.target);
    try { await attendanceApi('/config', 'PUT', { ...Object.fromEntries(values), enabled: values.has('enabled'), methods: values.getAll('methods'), graceMinutes: Number(values.get('graceMinutes')) }); await loadAttendanceConfig(); document.getElementById('notice').textContent = 'Sozlamalar saqlandi'; } catch (error) { attendanceError(error); }
};
document.getElementById('history-filter').onsubmit = event => { event.preventDefault(); loadAttendanceHistory().catch(attendanceError); };
document.getElementById('qr-create').onclick = async () => {
    try { const data = await attendanceApi('/qr', 'POST'); const image = document.getElementById('qr-image'); image.src = data.image; image.classList.remove('hidden'); document.getElementById('qr-expiry').textContent = `Amal qilish muddati: ${new Date(data.expiresAt).toLocaleTimeString('uz-UZ')}`; } catch (error) { attendanceError(error); }
};
function stopAttendanceCamera() { clearTimeout(cameraTimer); cameraStream?.getTracks().forEach(t => t.stop()); document.getElementById('camera').classList.add('hidden'); document.getElementById('stop-camera').classList.add('hidden'); }
document.getElementById('stop-camera').onclick = stopAttendanceCamera;
window.addEventListener('pagehide', stopAttendanceCamera);
document.getElementById('scan').onclick = async () => {
    try {
        if (!('BarcodeDetector' in window) || !navigator.mediaDevices?.getUserMedia) throw Error('Brauzer QR skanerlashni qo‘llamaydi. Mos brauzer yoki PINdan foydalaning');
        stopAttendanceCamera(); const detector = new BarcodeDetector({ formats: ['qr_code'] }), video = document.getElementById('camera');
        cameraStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } }); video.srcObject = cameraStream; video.classList.remove('hidden'); document.getElementById('stop-camera').classList.remove('hidden'); await video.play();
        const scan = async () => { try { const results = await detector.detect(video); const found = results.find(r => r.rawValue.startsWith('CHOYXONA_ATTENDANCE:')); if (found) { const form = document.getElementById('punch'); form.elements.method.value = 'QR'; form.elements.credential.value = found.rawValue; stopAttendanceCamera(); return; } cameraTimer = setTimeout(scan, 300); } catch (error) { stopAttendanceCamera(); attendanceError(error); } }; scan();
    } catch (error) { stopAttendanceCamera(); attendanceError(error); }
};
document.getElementById('history').onclick = event => {
    const button = event.target.closest('[data-correct]'); if (!button) return;
    const row = attendanceRows.find(r => r.id === button.dataset.correct), dialog = document.createElement('dialog');
    const local = value => { if (!value) return ''; const date = new Date(value); return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16); };
    dialog.className = 'p-5 rounded-xl max-w-md w-full'; dialog.innerHTML = `<form class="space-y-3"><h2 class="font-bold">Davomatni tuzatish</h2><label class="block">Kirish<input name="start" required type="datetime-local" value="${local(row.checkInTime)}" class="border p-2 w-full"></label><label class="block">Chiqish (ochiq smena uchun bo‘sh)<input name="end" type="datetime-local" value="${local(row.checkOutTime)}" class="border p-2 w-full"></label><input name="reason" required minlength="3" maxlength="500" placeholder="Tuzatish sababi" class="border p-2 w-full"><p data-error class="text-red-600"></p><button class="bg-blue-600 text-white p-2 rounded">Saqlash</button> <button type="button">Bekor qilish</button></form>`;
    document.body.append(dialog); dialog.showModal(); dialog.onclose = () => dialog.remove(); dialog.querySelector('[type="button"]').onclick = () => dialog.close();
    dialog.querySelector('form').onsubmit = async e => { e.preventDefault(); const f = e.target; try { await attendanceApi(`/history/${encodeURIComponent(row.id)}`, 'PUT', { checkInTime: new Date(f.elements.start.value).toISOString(), checkOutTime: f.elements.end.value ? new Date(f.elements.end.value).toISOString() : null, reason: f.elements.reason.value }); await loadAttendanceHistory(); dialog.close(); } catch (error) { dialog.querySelector('[data-error]').textContent = error.message; } };
};
(async () => { attendanceUser = await attendanceApi('/me'); document.getElementById('person').textContent = attendanceUser.fullName;
    document.getElementById('back').href = ({ ADMIN: '/admin/', WAITER: '/waiter/', CASHIER: '/cashier/', KITCHEN: '/kitchen/' })[attendanceUser.role];
    if (attendanceUser.role === 'ADMIN') document.getElementById('admin-config').classList.remove('hidden');
    const filter = document.getElementById('history-filter'); filter.elements.from.value = new Date(Date.now() - 29 * 86400000).toISOString().slice(0, 10); filter.elements.to.value = new Date().toISOString().slice(0, 10);
    await loadAttendanceConfig(); await loadAttendanceHistory();
})().catch(attendanceError);
