(async () => {
    const client = ServiceClient, e = client.esc, notice = document.getElementById('message');
    let user, policy, requests = [], orders = [], menu = [], page = 1, activeSection = 'requests', selectedRequest;
    const labels = { YANGI: 'Yangi', TAYYORLANMOQDA: 'Tayyorlanmoqda', TAYYOR: 'Tayyor', OLIB_KETILDI: 'Olib ketildi', STOLGA_YETKAZILDI: 'Yetkazildi', BEKOR_QILINDI: 'Bekor qilingan', KUTILMOQDA: 'Qaror kutilmoqda', TASDIQLANDI: 'Tasdiqlangan', RAD_ETILDI: 'Rad etilgan' };
    function button(text, action, attributes = '') { return `<button type="button" class="svc-button" data-action="${action}" ${attributes}>${e(text)}</button>`; }
    async function mutate(path, body, slot) { notice.textContent = 'Yuborilmoqda…'; const result = await client.post(path, body, slot); notice.textContent = 'Saqlandi'; return result; }
    async function loadRequests() {
        requests = (await client.get('/requests?' + new URLSearchParams({ status: document.getElementById('request-filter').value }))).data;
        document.getElementById('request-list').innerHTML = requests.length ? requests.map(r => `<article class="svc-card"><strong>№${e(r.order.orderNumber)} · Stol #${e(r.order.table?.number || '—')}</strong><p>${e(r.orderItem.menuItem.name)} × ${e(r.quantity)} · ${r.kind === 'RETURN' ? 'Qaytarish' : 'Bekor qilish'}</p><p>${e(r.reason)}</p><p>${e(r.requestedBy.fullName)} · ${e(new Date(r.createdAt).toLocaleString('uz-UZ'))}</p><p>${e(labels[r.status])}</p>${r.decidedBy ? `<p>Qaror: ${e(r.decidedBy.fullName)} · ${e(r.decisionReason)} · ${e(r.amount)} so‘m · ${r.stockDisposition === 'RESTOCK' ? 'Omborga qaytarilgan' : 'Omborga qaytarilmagan'}</p>` : ''}${user.role !== 'WAITER' && r.status === 'KUTILMOQDA' ? button('Qaror berish', 'decision', `data-id="${e(r.id)}"`) : ''}</article>`).join('') : '<p>Kutilayotgan so‘rov yo‘q.</p>';
    }
    async function loadCalls() {
        const calls = (await client.get('/calls?history=true')).data;
        document.getElementById('call-list').innerHTML = calls.map(c => `<article class="svc-card"><strong>Stol #${e(c.table.number)} · ${c.kind === 'CASHIER_ASSIST' ? 'Kassir chaqiruvi' : 'Mijoz chaqiruvi'}</strong><p>${e(c.status === 'YANGI' ? 'Yangi' : c.status === 'QABUL_QILINDI' ? 'Qabul qilingan' : 'Yakunlangan')}</p><p>${e(c.calledBy?.fullName || 'Mijoz')} · ${e(c.acceptedBy?.fullName || 'Qabul qilinmagan')}</p><p>${e(new Date(c.createdAt).toLocaleString('uz-UZ'))} · ${Math.max(0, Math.floor(((c.completedAt ? Date.parse(c.completedAt) : Date.now()) - Date.parse(c.createdAt)) / 60000))} daqiqa</p>${c.status === 'YANGI' && (user.role === 'ADMIN' || user.role === 'CASHIER' && c.kind === 'CASHIER_ASSIST' || user.role === 'WAITER' && c.kind === 'CUSTOMER') ? button('Qabul qilish', 'call-accept', `data-id="${e(c.id)}"`) : ''}${c.status === 'QABUL_QILINDI' && (user.role === 'ADMIN' || c.acceptedById === user.id) ? button('Yakunlash', 'call-complete', `data-id="${e(c.id)}"`) : ''}</article>`).join('') || '<p>Chaqiruvlar yo‘q.</p>';
    }
    async function loadKitchen() {
        const result = await client.get('/orders?' + new URLSearchParams({ page })); orders = result.data;
        orders = orders.filter(o => !['YANGI', 'KUTILMOQDA', 'ADMIN_TASDIGINI_KUTMOQDA'].includes(o.status));
        document.getElementById('kitchen-list').innerHTML = orders.map(o => `<article class="svc-card"><strong>№${e(o.orderNumber)} · Stol #${e(o.table?.number || '—')}</strong><p>${e(o.waiter?.fullName || 'Biriktirilmagan')}</p>${o.notes ? `<p>Buyurtma izohi: ${e(o.notes)}</p>${o.noteAcknowledgedAt ? '<p>✓ Izoh ko‘rilgan</p>' : button('Buyurtma izohini ko‘rdim', 'ack', `data-order="${e(o.id)}"`)}` : ''}${button('Buyurtmaga javob izohi', 'note', `data-order="${e(o.id)}"`)}
        ${o.items.map(i => `<div class="svc-item"><strong>${e(i.menuItem.name)} × ${e(Number(i.quantity) - Number(i.cancelledQuantity))}</strong><p>${e(labels[i.status] || i.status)} · <span data-time="${e(i.createdAt)}" data-status="${e(i.status)}"></span></p>${i.notes ? `<p>${e(i.notes)}</p>${i.noteAcknowledgedAt ? '<p>✓ Ko‘rilgan</p>' : button('Taom izohini ko‘rdim', 'ack', `data-order="${e(o.id)}" data-item="${e(i.id)}"`)}` : ''}${button('Taomga javob izohi', 'note', `data-order="${e(o.id)}" data-item="${e(i.id)}"`)}${['YANGI', 'TASDIQLANDI', 'TAYYORLANMOQDA'].includes(i.status) ? button(i.status === 'TAYYORLANMOQDA' ? 'Tayyor' : 'Tayyorlashni boshlash', 'status', `data-order="${e(o.id)}" data-item="${e(i.id)}" data-status="${i.status === 'TAYYORLANMOQDA' ? 'TAYYOR' : 'TAYYORLANMOQDA'}"`) : ''}</div>`).join('')}</article>`).join('') || '<p>Bu sahifada oshxona uchun buyurtma yo‘q.</p>';
        document.getElementById('kitchen-pages').innerHTML = `${page > 1 ? button('← Oldingi', 'previous') : ''} ${page} / ${Math.max(1, result.pages)} ${page < result.pages ? button('Keyingi →', 'next') : ''}`; updateTimers();
    }
    async function loadMenu() {
        menu = (await client.get('/menu')).data;
        const search = document.getElementById('menu-search').value.toLocaleLowerCase();
        document.getElementById('menu-list').innerHTML = menu.filter(m => m.name.toLocaleLowerCase().includes(search)).map(m => `<article class="svc-card"><strong>${e(m.name)}</strong><p>${m.available ? 'Sotuvda bor' : 'Sotuvda yo‘q: ' + e(m.unavailableReason)}</p>${button(m.available ? 'Vaqtincha to‘xtatish' : 'Sotuvga qaytarish', 'availability', `data-id="${e(m.id)}" data-available="${!m.available}"`)}</article>`).join('');
    }
    const settingNames = { assign: 'Buyurtma va stolni olish', deliver: 'Taomni olib ketish / yetkazish', requestReturn: 'Qaytarish so‘rovi', requestCancel: 'Bekor qilish so‘rovi', transfer: 'Stol ko‘chirish', reassign: 'Ofitsant almashtirish / smenani topshirish', takePayment: 'Ofitsantga to‘lov olish', cashierReview: 'Kassirga so‘rov qarori', kitchenCancel: 'Oshxonaga bekor qilish qarori' };
    async function loadSettings() {
        const response = await fetch('/api/admin/settings'), result = await response.json(); if (!response.ok) throw new Error(result.message);
        const data = result.waiterService;
        const form = document.getElementById('settings-form');
        form.innerHTML = `<label>Ishlash doirasi<select name="scope"><option value="ALL">Barcha stollar</option><option value="OWN">O‘z stollari va biriktirilmagan buyurtmalar</option></select></label><label>Kechikish chegarasi (daqiqa)<input name="delayMinutes" type="number" min="1" max="240" value="${e(data.delayMinutes)}" required></label>${Object.entries(settingNames).map(([name, label]) => `<label><span><input type="checkbox" name="${name}" ${data[name] ? 'checked' : ''}> ${label}</span></label>`).join('')}<button class="svc-button">Sozlamalarni saqlash</button>`;
        form.elements.scope.value = data.scope;
        form.onsubmit = async event => {
            event.preventDefault(); const btn = form.querySelector('button'); btn.disabled = true;
            try {
                const body = { scope: form.elements.scope.value, delayMinutes: Number(form.elements.delayMinutes.value) };
                for (const name of Object.keys(settingNames)) body[name] = form.elements[name].checked;
                const response = await fetch('/api/admin/settings/waiterService', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); const result = await response.json(); if (!response.ok) throw new Error(result.message); notice.textContent = 'Sozlamalar saqlandi';
            } catch (error) { notice.textContent = error.message; } finally { btn.disabled = false; }
        };
        const [staffResult, roomsResponse] = await Promise.all([client.get('/staff'), fetch('/api/rooms')]); const rooms = await roomsResponse.json();
        if (!roomsResponse.ok) throw new Error(rooms.message);
        const assignment = document.getElementById('table-assignment'); assignment.elements.tableId.innerHTML = rooms.flatMap(r => r.tables.map(t => `<option value="${e(t.id)}">${e(r.name)} · Stol #${e(t.number)}</option>`)).join('');
        assignment.elements.waiterId.innerHTML = staffResult.data.map(s => `<option value="${e(s.id)}">${e(s.fullName)}</option>`).join('');
        assignment.onsubmit = async event => { event.preventDefault(); const btn = assignment.querySelector('button'); btn.disabled = true; try { await mutate(`/tables/${assignment.elements.tableId.value}/assign`, Object.fromEntries(new FormData(assignment))); } catch (error) { notice.textContent = error.message; } finally { btn.disabled = false; } };
    }
    async function refresh() { if (activeSection === 'requests') await loadRequests(); if (activeSection === 'calls') await loadCalls(); if (activeSection === 'kitchen') await loadKitchen(); if (activeSection === 'menu') await loadMenu(); }
    function updateTimers() { document.querySelectorAll('[data-time]').forEach(el => { const done = ['BEKOR_QILINDI', 'STOLGA_YETKAZILDI'].includes(el.dataset.status), mins = Math.max(0, Math.floor((Date.now() - Date.parse(el.dataset.time)) / 60000)); el.textContent = done ? 'Yakunlangan' : `${mins} daqiqa kutish`; el.classList.toggle('svc-warning', !done && mins >= policy.delayMinutes); }); }
    document.getElementById('request-filter').onchange = () => loadRequests().catch(error => notice.textContent = error.message);
    document.getElementById('menu-search').oninput = () => loadMenu().catch(error => notice.textContent = error.message);
    document.getElementById('decision-form').elements.stockDisposition.onchange = event => {
        const restock = event.target.value === 'RESTOCK'; document.getElementById('restock').classList.toggle('hidden', !restock); document.getElementById('decision-form').elements.restockQuantity.required = restock;
    };
    document.getElementById('decision-form').onsubmit = async event => {
        event.preventDefault(); const form = event.target, btn = form.querySelector('button'); btn.disabled = true;
        try { await mutate(`/requests/${selectedRequest.id}/decision`, Object.fromEntries(new FormData(form))); document.getElementById('decision').close(); await loadRequests(); }
        catch (error) { notice.textContent = error.message; } finally { btn.disabled = false; }
    };
    document.addEventListener('click', async event => {
        const btn = event.target.closest('[data-action]'); if (!btn || btn.disabled) return; btn.disabled = true;
        try {
            const action = btn.dataset.action;
            if (action === 'tab') { activeSection = btn.dataset.tab; for (const section of ['requests', 'calls', 'kitchen', 'menu', 'settings']) document.getElementById(section).classList.toggle('hidden', section !== activeSection); if (activeSection === 'settings') await loadSettings(); else await refresh(); }
            if (action === 'call-accept' || action === 'call-complete') { await mutate(`/calls/${btn.dataset.id}/${action === 'call-accept' ? 'accept' : 'complete'}`, {}); await loadCalls(); }
            if (action === 'decision') {
                selectedRequest = requests.find(r => r.id === btn.dataset.id); const form = document.getElementById('decision-form'); form.reset(); document.getElementById('restock').classList.add('hidden'); form.elements.restockQuantity.required = false;
                document.getElementById('refund-method').classList.toggle('hidden', selectedRequest.kind !== 'RETURN'); form.elements.stockDisposition.querySelector('[value="RESTOCK"]').disabled = user.role !== 'ADMIN';
                if (user.role === 'ADMIN') { const response = await fetch('/api/inventory'); if (!response.ok) throw new Error('Ombor mahsulotlarini yuklab bo‘lmadi'); const result = await response.json(); const items = Array.isArray(result) ? result : result.data || []; form.elements.inventoryId.innerHTML = items.map(i => `<option value="${e(i.id)}">${e(i.name)} (${e(i.unit)})</option>`).join(''); }
                document.getElementById('decision').showModal();
            }
            if (['status', 'ack', 'note'].includes(action)) {
                const order = (await client.get(`/orders/${btn.dataset.order}`)).data;
                const body = { updatedAt: order.updatedAt, itemId: btn.dataset.item };
                let path = `/orders/${order.id}/notes/ack`;
                if (action === 'status') { body.status = btn.dataset.status; path = `/orders/${order.id}/items/${btn.dataset.item}/status`; }
                if (action === 'note') { body.note = prompt('Oshxona izohini kiriting'); if (!body.note) return; path = `/orders/${order.id}/notes`; }
                await mutate(path, body); await loadKitchen();
            }
            if (action === 'availability') { const available = btn.dataset.available === 'true', reason = available ? '' : prompt('Taom sotuvda yo‘qligi sababi'); if (!available && !reason) return; await mutate(`/menu/${btn.dataset.id}/availability`, { available, reason }); await loadMenu(); }
            if (action === 'previous' || action === 'next') { page += action === 'next' ? 1 : -1; await loadKitchen(); }
        } catch (error) { notice.textContent = error.message; } finally { btn.disabled = false; }
    });
    try {
        const config = await client.init(); user = config.user; policy = config.data;
        document.getElementById('identity').textContent = `${user.fullName} · ${user.role}`;
        const paths = { WAITER: '/waiter/', CASHIER: '/cashier/', ADMIN: '/admin/', KITCHEN: '/kitchen/' }; document.getElementById('back').href = paths[user.role];
        const tabs = [['requests', 'Qaytarish / bekor qilish']];
        if (user.role !== 'KITCHEN') tabs.push(['calls', 'Chaqiruvlar']);
        if (['ADMIN', 'KITCHEN'].includes(user.role)) tabs.push(['kitchen', 'Oshxona taomlari'], ['menu', 'Menyu mavjudligi']);
        if (user.role === 'ADMIN') tabs.push(['settings', 'Ruxsatlar va biriktirish']);
        document.getElementById('nav').innerHTML = tabs.map(([id, text]) => button(text, 'tab', `data-tab="${id}"`)).join(''); notice.textContent = 'Ulangan'; await loadRequests();
        const socket = io(); for (const name of ['service_updated', 'orderUpdate', 'menu_updated', 'settings_updated']) socket.on(name, () => refresh().catch(error => notice.textContent = error.message));
        socket.on('connect', () => refresh().catch(error => notice.textContent = error.message)); setInterval(updateTimers, 15000);
        socket.on('waiter_call_updated', () => refresh().catch(error => notice.textContent = error.message));
        socket.on('waiter_call', () => { notice.textContent = 'Yangi kassir chaqiruvi. Chaqiruvlar bo‘limini oching.'; refresh().catch(error => notice.textContent = error.message); });
    } catch (error) { notice.textContent = error.status === 401 ? 'Avval o‘z panelingizda tizimga kiring, keyin bu sahifani oching.' : error.message; }
})();
