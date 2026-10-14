(() => {
    const client = ServiceClient, e = client.esc;
    let policy = {}, staff = [], historyPage = 1, orderPage = 1, historyTable = '', draftTable = '', ready = false;
    let popular = [], favorites = [], summary, activeRequests = [], activeRequestVersion = 0;
    const old = { renderCart, renderMenuCatalog, renderRoomsAndTables, addToCart, loadTableDropdowns, switchTab, initWaiterSession, renderPendingOrders, openAppendOrder, cancelAppendOrder, logout, changeGuestCount, updateCartItemNote };
    const money = value => `${Number(value || 0).toLocaleString('uz-UZ', { maximumFractionDigits: 2 })} so‘m`;
    const labels = { YANGI: 'Yangi', TAYYORLANMOQDA: 'Tayyorlanmoqda', TAYYOR: 'Tayyor', OLIB_KETILDI: 'Olib ketildi', STOLGA_YETKAZILDI: 'Yetkazildi', BEKOR_QILINDI: 'Bekor qilingan', QABUL_QILINDI: 'Qabul qilingan', YAKUNLANDI: 'Yakunlangan', KUTILMOQDA: 'Qaror kutilmoqda', TASDIQLANDI: 'Tasdiqlangan', RAD_ETILDI: 'Rad etilgan' };
    const button = (text, action, attrs = '') => `<button type="button" class="svc-button" data-service-action="${action}" ${attrs}>${e(text)}</button>`;
    const timer = (createdAt, stopped) => `<span data-service-time="${e(createdAt)}" ${stopped ? 'data-stopped="true"' : ''}></span>`;
    const draftKey = table => `waiter-draft:${currentWaiter.id}:${table || 'unselected'}`;
    function saveDraft() {
        if (!currentWaiter || appendOrder) return;
        try { localStorage.setItem(draftKey(draftTable), JSON.stringify({ cart: cartItems, guests: document.getElementById('builder-guest-count').value, note: document.getElementById('order-general-note').value, savedAt: new Date().toISOString() })); } catch { showNotification('Qoralamani qurilmada saqlash uchun joy yetmayapti'); }
    }
    function restoreDraft(table) {
        if (!currentWaiter || appendOrder) return;
        draftTable = table;
        let draft; try { draft = JSON.parse(localStorage.getItem(draftKey(table)) || 'null'); } catch {}
        cartItems = Array.isArray(draft?.cart) ? draft.cart : [];
        document.getElementById('builder-guest-count').value = draft?.guests || '1';
        document.getElementById('order-general-note').value = draft?.note || '';
        old.renderCart();
        document.getElementById('service-draft-state').textContent = draft ? 'Yuborilmagan qoralama tiklandi' : 'Yuborilmagan qoralama';
    }
    window.renderCart = () => { old.renderCart(); saveDraft(); };
    window.showNotification = message => {
        document.getElementById('service-toast')?.remove();
        const toast = document.createElement('div'); toast.id = 'service-toast'; toast.className = 'svc-toast'; toast.setAttribute('role', 'status'); toast.textContent = message; document.body.append(toast);
        setTimeout(() => toast.remove(), 4500);
    };
    window.changeGuestCount = delta => { old.changeGuestCount(delta); saveDraft(); };
    window.updateCartItemNote = (idx, value) => { old.updateCartItemNote(idx, value); saveDraft(); };
    window.addToCart = item => {
        if (item.available === false) { showNotification('Taom vaqtincha sotuvda yo‘q'); return; }
        old.addToCart(item);
    };
    window.loadTableDropdowns = async () => { await old.loadTableDropdowns(); };
    window.renderRoomsAndTables = () => { old.renderRoomsAndTables(); if (summary) document.getElementById('stat-active-tables').textContent = summary.activeTables; };
    function selectedFilters(history) {
        const root = document.getElementById(history ? 'service-history-filters' : 'service-order-filters'), params = new URLSearchParams();
        if (root) root.querySelectorAll('[name]').forEach(input => { if (input.value) params.set(input.name, input.value); });
        params.set('page', history ? historyPage : orderPage);
        if (history) { params.set('history', 'true'); if (historyTable) params.set('tableId', historyTable); }
        return params;
    }
    function pager(result, kind) {
        return `<div class="svc-row">${button('← Oldingi', `${kind}-previous`, result.page <= 1 ? 'disabled' : '')}<span>${result.page} / ${Math.max(1, result.pages)} · ${result.count} buyurtma</span>${button('Keyingi →', `${kind}-next`, result.page >= result.pages ? 'disabled' : '')}</div>`;
    }
    window.loadActiveOrders = async () => {
        const version = ++activeRequestVersion;
        try {
            const result = await client.get('/orders?' + selectedFilters(false)); if (version !== activeRequestVersion) return;
            activeOrdersList = result.data.map(o => ({ ...o, tableNumber: o.table?.number })); renderActiveOrders(activeOrdersList);
            document.getElementById('service-order-pages').innerHTML = pager(result, 'orders');
        } catch (error) { document.getElementById('waiter-orders-list-container').textContent = error.message; }
    };
    function orderCard(order, history = false) {
        const mine = order.waiterId === currentWaiter?.id;
        return `<article class="svc-card"><div class="svc-row"><strong>№${e(order.orderNumber)}</strong><span>${e(getOrderStatusUz(order.status))}</span></div>
          <p>Stol #${e(order.table?.number || '—')} · ${e(order.table?.room?.name || '')} · ${e(order.waiter?.fullName || 'Biriktirilmagan')}</p>
          <p>${e(new Date(order.createdAt).toLocaleString('uz-UZ'))} · ${e(order.guestCount)} mehmon</p>
          ${order.processingBy ? `<p class="svc-warning">Kassir ${e(order.processingBy.fullName)} band</p>` : ''}
          ${order.notes ? `<p>Izoh: ${e(order.notes)} ${order.noteAcknowledgedAt ? '✓ Oshxona ko‘rgan' : '· Oshxona hali ko‘rmagan'}</p>` : ''}
                    ${order.items.map(item => `<div class="svc-item"><div class="svc-row"><strong>${e(item.menuItem?.name)} × ${e(item.remainingQuantity ?? (Number(item.quantity) - Number(item.cancelledQuantity || 0)))}</strong><span>${money(item.remainingTotalPrice ?? item.totalPrice)}</span></div>
                        ${Number(item.returnedQuantity || 0) > 0 ? `<p style="color:#b91c1c;font-weight:700">QAYTARILDI × ${e(item.returnedQuantity)}</p>` : ''}
            <p>${e(labels[item.status] || item.status)} · ${timer(item.createdAt, ['STOLGA_YETKAZILDI', 'BEKOR_QILINDI'].includes(item.status))}</p>
            ${item.notes ? `<p>${e(item.notes)} ${item.noteAcknowledgedAt ? '✓ Oshxona ko‘rgan' : ''}</p>` : ''}
            ${!history && mine && policy.deliver && ['TAYYOR', 'OLIB_KETILDI'].includes(item.status) ? button(item.status === 'TAYYOR' ? 'Olib ketdim' : 'Stolga yetkazdim', 'deliver', `data-order="${e(order.id)}" data-item="${e(item.id)}" data-status="${item.status === 'TAYYOR' ? 'OLIB_KETILDI' : 'STOLGA_YETKAZILDI'}"`) : ''}
            ${mine && item.status !== 'BEKOR_QILINDI' ? `<div class="svc-row">${policy.requestReturn ? button('Qisman qaytarish', 'request', `data-order="${e(order.id)}" data-item="${e(item.id)}" data-kind="RETURN"`) : ''}${!history && policy.requestCancel ? button('Bekor qilish so‘rovi', 'request', `data-order="${e(order.id)}" data-item="${e(item.id)}" data-kind="CANCEL"`) : ''}</div>` : ''}</div>`).join('')}
          <strong>Jami ${money(order.totalAmount)}</strong>
          ${order.balance ? `<p>To‘langan: ${money(order.balance.paid)} · Qarz: ${money(order.balance.debtRemaining)} · Qoldiq: ${money(order.balance.remaining)} · Qaytarilgan: ${money(order.balance.refunds)}</p>` : ''}
          <div class="svc-row">${button('Voqealar tarixi', 'timeline', `data-order="${e(order.id)}"`)}${!history && mine ? button('Oshxonaga izoh', 'note', `data-order="${e(order.id)}"`) : ''}${history ? button('Taomlarni qayta tanlash', 'repeat', `data-order="${e(order.id)}"`) : ''}
          ${!history && !order.waiterId && policy.assign ? button('Buyurtmani olish', 'assign', `data-order="${e(order.id)}"`) : ''}
          ${!history && mine && !order.payments?.length && !order.debt ? button('Taom qo‘shish', 'append', `data-order="${e(order.id)}"`) : ''}
          ${!history && mine && (policy.transfer || policy.reassign) ? button('Ko‘chirish / topshirish', 'transfer', `data-order="${e(order.id)}"`) : ''}</div></article>`;
    }
    window.renderActiveOrders = orders => { document.getElementById('waiter-orders-list-container').innerHTML = orders.length ? orders.map(o => orderCard(o)).join('') : '<p>Faol buyurtmalar yo‘q.</p>'; updateTimers(); };
    window.loadCompletedOrders = async () => {
        const version = ++completedOrdersRequest;
        try {
            const result = await client.get('/orders?' + selectedFilters(true)); if (version !== completedOrdersRequest) return;
            document.getElementById('completed-orders-list').innerHTML = result.data.length ? result.data.map(o => orderCard(o, true)).join('') : '<p>Tarixda buyurtma topilmadi.</p>';
            document.getElementById('service-history-pages').innerHTML = pager(result, 'history'); updateTimers();
        } catch (error) { document.getElementById('completed-orders-list').textContent = error.message; }
    };
    window.loadMenuCatalog = async () => {
        try {
            const result = await client.get('/menu'); menuCatalog = result.data; popular = result.popular;
            menuCategories = [...new Map(menuCatalog.map(i => [i.category.id, i.category])).values()]; renderMenuCategories(); renderMenuCatalog(menuCatalog);
        } catch (error) { document.getElementById('menu-items-grid').textContent = error.message; }
    };
    window.renderMenuCatalog = items => {
        const mode = document.getElementById('service-menu-mode')?.value;
        const ids = mode === 'favorites' ? favorites : mode === 'popular' ? popular : null;
        old.renderMenuCatalog(ids ? items.filter(i => ids.includes(i.id)) : items);
        document.querySelectorAll('[data-add-menu-item]').forEach(btn => {
            const item = menuCatalog.find(i => i.id === btn.dataset.addMenuItem); if (!item) return;
            if (!item.available) { btn.disabled = true; btn.textContent = `Sotuvda yo‘q: ${item.unavailableReason || 'Vaqtincha'}`; }
            const star = document.createElement('button'); star.type = 'button'; star.className = 'svc-button'; star.dataset.serviceAction = 'favorite'; star.dataset.item = item.id;
            star.textContent = favorites.includes(item.id) ? '★ Sevimli' : '☆ Sevimliga'; btn.after(star);
        });
    };
    window.approveOrder = async orderId => {
        const order = pendingOrdersList.find(o => o.id === orderId); if (!order) return;
        try { await client.post(`/orders/${orderId}/approve`, { updatedAt: order.updatedAt }); showNotification('Saqlandi: buyurtma biriktirildi va tasdiqlandi'); } catch (error) { showNotification(error.message); }
        loadPendingOrders(); loadActiveOrders();
    };
    window.confirmRejectOrder = async () => {
        const orderId = document.getElementById('reject-order-id').value, reason = document.getElementById('reject-reason-input').value.trim();
        const order = pendingOrdersList.find(o => o.id === orderId); if (!order) return;
        try { await client.post(`/orders/${orderId}/reject`, { reason, updatedAt: order.updatedAt }); closeRejectModal(); showNotification('Rad etildi'); } catch (error) { showNotification(error.message); }
        loadPendingOrders();
    };
    window.submitWaiterOrder = async () => {
        const btn = document.getElementById('submit-waiter-order'); if (btn.disabled) return;
        const tableId = document.getElementById('builder-table-select').value, guestCount = Number(document.getElementById('builder-guest-count').value), note = document.getElementById('order-general-note').value;
        const pending = client.user ? client.pending('new-order') : null;
        if (!appendOrder && !pending && (!tableId || !cartItems.length || !Number.isInteger(guestCount) || guestCount < 1 || guestCount > 999)) { showNotification('Stol, taomlar va mehmonlar sonini tekshiring'); return; }
        btn.disabled = true; const text = btn.textContent; btn.textContent = 'Yuborilmoqda…';
        const state = document.getElementById('service-draft-state');
        try {
            const items = cartItems.map(i => ({ productId: i.id, quantity: i.quantity, note: appendOrder ? [i.note, note].filter(Boolean).join('; ') : i.note || '' }));
            let savedTable = tableId;
            if (appendOrder) {
                if (!appendRequest) appendRequest = { items, updatedAt: appendOrder.updatedAt, idempotencyKey: client.requestId() };
                const storageKey = `waiter-append:${currentWaiter.id}`;
                localStorage.setItem(storageKey, JSON.stringify({ order: appendOrder, request: appendRequest }));
                const response = await fetch(`/api/waiter/orders/${appendOrder.id}/items`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(appendRequest) });
                const result = await response.json();
                if (!response.ok) {
                    if (response.status < 500) { appendRequest = null; localStorage.removeItem(storageKey); }
                    throw Object.assign(new Error(result.message), { status: response.status });
                }
                localStorage.removeItem(storageKey); appendRequest = null; btn.disabled = false; cancelAppendOrder();
            } else {
                savedTable = pending?.body.tableId || tableId;
                await client.post('/orders', { tableId, guestCount, note, items }, 'new-order');
                localStorage.removeItem(draftKey(savedTable));
            }
            cartItems = []; document.getElementById('order-general-note').value = ''; document.getElementById('builder-guest-count').value = '1'; old.renderCart();
            state.textContent = 'Saqlandi: server buyurtmani tasdiqladi'; showNotification('Buyurtma saqlandi'); switchTab('orders'); loadWaiterStatistics();
        } catch (error) { state.textContent = error.status && error.status < 500 ? `Rad etildi: ${error.message}` : 'Natijani qayta tekshirish kerak. Avvalgi so‘rov saqlangan; qayta yuborishda takrorlanmaydi.'; showNotification(state.textContent); }
        finally { btn.disabled = false; btn.textContent = appendOrder ? text : 'Buyurtmani yuborish'; }
    };
    window.openAppendOrder = async id => {
        if (client.pending('new-order')) { showNotification('Avval yangi buyurtma natijasini qayta tekshiring'); return; }
        saveDraft(); const result = await client.get(`/orders/${id}`);
        if (!activeOrdersList.some(o => o.id === id)) activeOrdersList.push(result.data);
        await old.openAppendOrder(id); appendOrder = result.data;
    };
    window.cancelAppendOrder = () => {
        if (appendRequest) { showNotification('Avval qo‘shimcha so‘rov natijasini qayta tekshiring'); return; }
        if (document.getElementById('submit-waiter-order').disabled) return;
        const previousDraft = localStorage.getItem(draftKey(draftTable));
        old.cancelAppendOrder();
        if (previousDraft) localStorage.setItem(draftKey(draftTable), previousDraft);
        else localStorage.removeItem(draftKey(draftTable));
        document.getElementById('builder-table-select').value = draftTable;
        restoreDraft(draftTable);
    };
    window.loadActiveCalls = async () => {
        try {
            activeCallsList = (await client.get('/calls')).data;
            const count = activeCallsList.length;
            for (const id of ['badge-active-calls', 'mob-badge-calls']) { const el = document.getElementById(id); el.textContent = count; el.classList.toggle('hidden', !count); }
            document.getElementById('stat-pending-calls').textContent = count;
            const customerCalls = activeCallsList.filter(c => c.kind === 'CUSTOMER');
            document.getElementById('call-alert').classList.toggle('hidden', !customerCalls.length);
            document.getElementById('call-alert-text').textContent = `${customerCalls.length} mijoz chaqiruvi`;
            renderActiveCalls(activeCallsList);
        } catch (error) { console.error(error); }
    };
    window.renderActiveCalls = calls => {
        document.getElementById('waiter-calls-list-container').innerHTML = calls.length ? calls.map(call => `<article class="svc-card"><strong>Stol #${e(call.table.number)} · ${call.kind === 'CUSTOMER' ? 'Mijoz chaqiruvi' : 'Kassir chaqiruvi'}</strong><p>${e(labels[call.status])} · ${timer(call.createdAt)}</p><p>${e(call.acceptedBy?.fullName || 'Hali qabul qilinmagan')} ${call.acceptedAt ? '· ' + e(new Date(call.acceptedAt).toLocaleTimeString('uz-UZ')) : ''}</p>${call.kind === 'CUSTOMER' && call.status === 'YANGI' ? button('Qabul qilish', 'call-accept', `data-call="${e(call.id)}"`) : ''}${call.acceptedById === currentWaiter.id && call.status === 'QABUL_QILINDI' ? button('Yakunlash', 'call-complete', `data-call="${e(call.id)}"`) : ''}</article>`).join('') : '<p>Faol chaqiruvlar yo‘q.</p>'; updateTimers();
    };
    window.acceptCall = async id => { await client.post(`/calls/${id}/accept`, {}); loadActiveCalls(); };
    window.completeCall = async id => { await client.post(`/calls/${id}/complete`, {}); loadActiveCalls(); };
    window.loadWaiterStatistics = async () => {
        try {
            summary = (await client.get('/summary')).data;
            for (const [id, text] of Object.entries({ 'stat-active-tables': summary.activeTables, 'stat-today-orders': summary.createdOrders, 'stat-today-sales': money(summary.receiptTotal), 'waiter-today-commission': money(summary.commission), 'profile-val-orders': summary.createdOrders + ' ta', 'profile-val-sales': money(summary.receiptTotal), 'profile-val-commission': money(summary.commission), 'waiter-commission-rate': `${summary.commissionRate || 0}%`, 'waiter-completed-count': `${summary.completedCount || 0} ta`, 'waiter-cancelled-count': `${summary.cancelledCount || 0} ta` })) { const node = document.getElementById(id); if (node) node.textContent = text; }
            document.getElementById('stat-today-sales').title = 'Bugun kelib tushgan to‘lovlar va qarz to‘lovlari, qaytarishlar ayirilgan';
            document.getElementById('service-shift').innerHTML = `<strong>Bugungi smena · ${e(summary.date)}</strong><p>Yaratilgan buyurtmalar: ${summary.createdOrders} · ${money(summary.createdTotal)}</p><p>Bugun kelib tushgan pul: ${money(summary.receiptTotal)} · Komissiya: ${money(summary.commission)}</p><p>Xizmat qilingan stollar: ${summary.servedTables} · Mehmonlar: ${summary.guests} · Faol buyurtmalar: ${summary.activeOwnOrders} · Tugallanmagan chaqiruvlar: ${summary.unfinishedCalls}</p><p class="svc-muted">Mehmonlar soni buyurtmalarda kiritilgan sonlar yig‘indisi. Komissiya bugungi tushumdan hisoblanadi.</p>${policy.reassign ? button('Ishni boshqa ofitsantga topshirish', 'handover') : '<p>Topshirish huquqini admin sozlaydi.</p>'}`;
        } catch (error) { console.error(error); }
    };
    window.openTableModal = async (tableId, number, status) => {
        selectedTableForModal = tableId;
        document.getElementById('modal-table-number').textContent = `Stol #${number}`; document.getElementById('modal-table-status').textContent = getTableStatusUzText(status);
        document.getElementById('modal-table-details').classList.remove('hidden');
        const box = document.getElementById('modal-table-active-orders'); box.textContent = 'Yuklanmoqda…';
        try {
            const result = (await client.get(`/tables/${tableId}/bill`)).data; if (selectedTableForModal !== tableId) return;
            tableOrdersCache = result.orders; document.getElementById('modal-table-guests').textContent = `${result.guests} mehmon (faol buyurtmalar)`;
            document.getElementById('modal-table-waiter').textContent = result.table.assignedWaiter?.fullName || [...new Set(result.orders.map(o => o.waiter?.fullName).filter(Boolean))].join(', ') || 'Biriktirilmagan';
            box.innerHTML = `<div class="svc-card"><strong>Stolning yagona hisobi</strong>${Object.entries({ subtotal: 'Taomlar', serviceCharge: 'Xizmat haqi', discount: 'Chegirma', total: 'Jami', paid: 'To‘langan', refunds: 'Qaytarilgan', debt: 'Qarzga yozilgan', debtRemaining: 'Qarz qoldig‘i', remaining: 'To‘lov qoldig‘i' }).map(([key, label]) => `<div class="svc-row"><span>${label}</span><strong>${money(result.totals[key])}</strong></div>`).join('')}<p class="svc-muted">Faol buyurtmalar hisobi. To‘langan buyurtmalar stol tarixida.</p>${!result.table.assignedWaiterId && policy.assign ? button('Stolni o‘zimga biriktirish', 'table-assign', `data-table="${e(tableId)}"`) : ''}</div>${result.calls.map(c => `<p>Kassir chaqiruvi: ${e(labels[c.status])} · ${e(c.acceptedBy?.fullName || '—')}</p>`).join('')}${result.orders.map(o => orderCard(o)).join('')}`;
            updateTimers();
        } catch (error) { box.textContent = error.message; }
    };
    window.openMenuForCurrentTable = async () => {
        const table = selectedTableForModal; if (!table) return;
        saveDraft(); closeTableModal(); switchTab('menu'); await loadTableDropdowns(); document.getElementById('builder-table-select').value = table; restoreDraft(table);
    };
    window.goToBillForCurrentTable = () => { historyTable = selectedTableForModal || ''; closeTableModal(); historyPage = 1; document.querySelector('#service-history-filters [name="tableId"]').value = historyTable; switchTab('bills'); };
    window.freeCurrentTable = async () => {
        if (!selectedTableForModal || !confirm('Faol buyurtmalar tugagan bo‘lsa, stolni bo‘shatasizmi?')) return;
        try { await client.post(`/tables/${selectedTableForModal}/release`, {}); closeTableModal(); loadRoomsAndTables(); showNotification('Stol bo‘shatildi'); } catch (error) { showNotification(error.message); }
    };
    window.toggleMobileSidebar = () => document.getElementById('service-mobile-menu').classList.toggle('hidden');
    window.switchTab = id => { document.getElementById('service-mobile-menu')?.classList.add('hidden'); old.switchTab(id); if (id === 'calls') loadRequests(); if (id === 'profile') loadWaiterStatistics(); };
    async function loadRequests() {
        try { activeRequests = (await client.get('/requests')).data; document.getElementById('service-request-list').innerHTML = `<h3>Qaytarish va bekor qilish so‘rovlari</h3>${activeRequests.map(r => `<article class="svc-card"><strong>№${e(r.order.orderNumber)} · ${e(r.orderItem.menuItem.name)}</strong><p>${r.kind === 'RETURN' ? 'Qaytarish' : 'Bekor qilish'} × ${e(r.quantity)} · ${e(labels[r.status])}</p><p>${e(r.reason)}</p>${r.decidedBy ? `<p>${e(r.decidedBy.fullName)} · ${e(r.decisionReason)} · ${money(r.amount)}</p>` : ''}</article>`).join('') || '<p>So‘rovlar yo‘q.</p>'}`; } catch (error) { console.error(error); }
    }
    function dialog(title, html) {
        const el = document.getElementById('service-dialog'); el.querySelector('h2').textContent = title; el.querySelector('.service-dialog-content').innerHTML = html; if (!el.open) el.showModal(); updateTimers();
    }
    async function findOrder(id) { return (await client.get(`/orders/${id}`)).data; }
    async function action(target) {
        const type = target.dataset.serviceAction, id = target.dataset.order;
        if (type === 'favorite') { const item = target.dataset.item; favorites = favorites.includes(item) ? favorites.filter(i => i !== item) : [...favorites, item]; localStorage.setItem(`waiter-favorites:${currentWaiter.id}`, JSON.stringify(favorites)); renderMenuCatalog(menuCatalog); return; }
        if (type === 'orders-previous' || type === 'orders-next') { orderPage += type.endsWith('next') ? 1 : -1; await loadActiveOrders(); return; }
        if (type === 'history-previous' || type === 'history-next') { historyPage += type.endsWith('next') ? 1 : -1; await loadCompletedOrders(); return; }
        if (type === 'call-accept') return acceptCall(target.dataset.call);
        if (type === 'call-complete') return completeCall(target.dataset.call);
        if (type === 'append') return openAppendOrder(id);
        if (type === 'table-assign') {
            const tableId = target.dataset.table;
            await client.post(`/tables/${tableId}/assign`, {});
            await loadRoomsAndTables();
            const table = allRooms.flatMap(room => room.tables).find(entry => entry.id === tableId);
            if (selectedTableForModal === tableId && table) await openTableModal(table.id, table.number, table.status);
            showNotification('Stol sizga biriktirildi'); return;
        }
        if (type === 'retry-new-order') return submitWaiterOrder();
        if (type === 'handover') {
            let orders = [], page = 1, result;
            do { result = await client.get(`/orders?waiterId=${currentWaiter.id}&page=${page++}`); orders.push(...result.data); } while (page <= result.pages);
            dialog('Smenani topshirish', `<form id="service-handover-form"><label>Ofitsant<select name="waiterId" required>${staff.filter(s => s.id !== currentWaiter.id).map(s => `<option value="${e(s.id)}">${e(s.fullName)}</option>`).join('')}</select></label><label>Sabab<textarea name="reason" required maxlength="500"></textarea></label><p>${orders.length} faol buyurtma hamda stollar va qabul qilingan mijoz chaqiruvlari topshiriladi.</p><button class="svc-button">Topshirish</button></form>`);
            document.getElementById('service-handover-form').onsubmit = async event => { event.preventDefault(); await sendForm(event, '/handover', { orderIds: orders.map(o => o.id) }); }; return;
        }
        const order = await findOrder(id);
        if (type === 'note') { const note = prompt('Oshxonaga izoh'); if (!note) return; await client.post(`/orders/${id}/notes`, { note, updatedAt: order.updatedAt }); showNotification('Izoh saqlandi'); return loadActiveOrders(); }
        if (type === 'deliver') { await client.post(`/orders/${id}/items/${target.dataset.item}/status`, { status: target.dataset.status, updatedAt: order.updatedAt }); showNotification('Saqlandi'); await loadActiveOrders(); return; }
        if (type === 'assign') { await client.post(`/orders/${id}/assign`, { updatedAt: order.updatedAt }); showNotification('Buyurtma biriktirildi'); return loadActiveOrders(); }
        if (type === 'timeline') { dialog('Buyurtma voqealari', order.statusHistory.map(h => `<article class="svc-card"><strong>${e(h.user?.fullName || 'Tizim')}</strong><p>${e(new Date(h.createdAt).toLocaleString('uz-UZ'))}</p><p>${e(getOrderStatusUz(h.status))} · ${e(h.comment || '')}</p></article>`).join('')); return; }
        if (type === 'repeat') {
            if (client.pending('new-order')) throw new Error('Avval yuborilgan buyurtma natijasini tekshiring');
            await loadMenuCatalog();
            const items = order.items.map(i => { const menu = menuCatalog.find(m => m.id === i.menuItemId && m.available); const quantity = Number(i.quantity) - Number(i.cancelledQuantity); return menu && quantity > 0 ? { id: menu.id, name: menu.name, price: Number(menu.sellingPrice), quantity, note: i.notes || '' } : null; }).filter(Boolean);
            if (cartItems.length && !confirm('Joriy qoralamani ushbu taomlar bilan almashtirasizmi?')) return;
            cartItems = items; renderCart(); switchTab('menu'); showNotification('Taomlar amaldagi narxda tanlandi. Sotuvda yo‘qlari olinmadi.'); return;
        }
        if (type === 'request') {
            const item = order.items.find(i => i.id === target.dataset.item);
            const returning = target.dataset.kind === 'RETURN';
            const methods = [...new Set((order.payments || []).map(payment => payment.method).filter(method => ['NAQD', 'PLASTIK', 'ELEKTRON'].includes(method)))];
            const methodOptions = (methods.length ? methods : ['NAQD', 'PLASTIK', 'ELEKTRON']).map(method => `<option value="${method}">${({ NAQD: 'Naqd', PLASTIK: 'Karta', ELEKTRON: 'Elektron' })[method]}</option>`).join('');
            dialog(`${returning ? 'Qisman qaytarish' : 'Bekor qilish so‘rovi'}: ${item.menuItem.name}`, `<form id="service-request-form"><label>Miqdor<input name="quantity" type="number" min="0.001" step="0.001" max="${e(item.remainingQuantity ?? (Number(item.quantity) - Number(item.cancelledQuantity)))}" value="1" required></label>${returning && Number(order.balance?.paid || 0) > 0 ? `<label>Pulni qaytarish usuli<select name="method">${methodOptions}</select></label>` : ''}<label>Sabab<textarea name="reason" required maxlength="500"></textarea></label><p>${returning ? 'Qaytarish darhol serverda tekshiriladi va qayd etiladi.' : 'So‘rovni mas’ul xodim ko‘rib chiqadi.'}</p><button class="svc-button">${returning ? 'Qaytarishni tasdiqlash' : 'So‘rov yuborish'}</button></form>`);
            document.getElementById('service-request-form').onsubmit = async event => { event.preventDefault(); await sendForm(event, `/orders/${id}/${returning ? 'return' : 'requests'}`, { orderItemId: item.id, updatedAt: order.updatedAt, ...(returning ? {} : { kind: target.dataset.kind }) }); }; return;
        }
        if (type === 'transfer') {
            dialog('Ko‘chirish / topshirish', `<form id="service-transfer-form">${policy.transfer ? `<label>Yangi stol<select name="tableId"><option value="">Stolni saqlash</option>${allRooms.flatMap(r => r.tables.map(t => `<option value="${e(t.id)}">${e(r.name)} · Stol #${e(t.number)}</option>`)).join('')}</select></label>` : ''}${policy.reassign ? `<label>Yangi ofitsant<select name="waiterId"><option value="">Ofitsantni saqlash</option>${staff.map(s => `<option value="${e(s.id)}">${e(s.fullName)}</option>`).join('')}</select></label>` : ''}<label>Sabab<textarea name="reason" required maxlength="500"></textarea></label><button class="svc-button">Saqlash</button></form>`);
            document.getElementById('service-transfer-form').onsubmit = async event => { event.preventDefault(); await sendForm(event, `/orders/${id}/transfer`, { updatedAt: order.updatedAt }); };
        }
    }
    async function sendForm(event, path, extra) {
        const form = event.target, btn = form.querySelector('button'); btn.disabled = true; const text = btn.textContent; btn.textContent = 'Yuborilmoqda…';
        try { await client.post(path, { ...Object.fromEntries(new FormData(form)), ...extra }); document.getElementById('service-dialog').close(); showNotification('Saqlandi'); loadActiveOrders(); loadRequests(); loadWaiterStatistics(); }
        catch (error) { showNotification(error.message); }
        finally { btn.disabled = false; btn.textContent = text; }
    }
    function updateTimers() {
        document.querySelectorAll('[data-service-time]').forEach(node => {
            if (node.dataset.stopped) { node.textContent = 'Yakunlangan'; return; }
            const mins = Math.max(0, Math.floor((Date.now() - Date.parse(node.dataset.serviceTime)) / 60000)); node.textContent = `${mins} daqiqa kutish`;
            node.classList.toggle('svc-warning', mins >= (policy.delayMinutes || 20));
        });
    }
    function setupUI() {
        const style = document.createElement('link'); style.rel = 'stylesheet'; style.href = '/service.css'; document.head.append(style);
        document.body.insertAdjacentHTML('beforeend', `<nav id="service-mobile-menu" class="hidden svc-mobile">${[['dashboard','Bosh sahifa'],['tables','Stollar'],['orders','Buyurtmalar'],['menu','Yangi buyurtma'],['calls','Chaqiruvlar'],['bills','Hisoblar'],['profile','Profil']].map(([id, text]) => `<button type="button" class="svc-button" onclick="switchTab('${id}')">${text}</button>`).join('')}</nav><dialog id="service-dialog"><div class="svc-row"><h2></h2><button type="button" class="svc-button" onclick="document.getElementById('service-dialog').close()">Yopish</button></div><div class="service-dialog-content"></div></dialog>`);
        const filters = history => `<form class="svc-filters" id="service-${history ? 'history' : 'order'}-filters"><label>Stol<select name="tableId"><option value="">Barcha stollar</option></select></label>${history ? '<label>Buyurtma raqami<input name="search" placeholder="Raqam bo‘yicha"></label>' : '<label>Xona<select name="roomId"><option value="">Barcha xonalar</option></select></label><label>Ofitsant<select name="waiterId"><option value="">Barchasi</option></select></label><label>Holat<select name="status"><option value="">Barcha holatlar</option><option>TASDIQLANDI</option><option>TAYYORLANMOQDA</option><option>TAYYOR</option><option>STOLGA_YETKAZILDI</option><option>QISMAN_TOLANDI</option></select></label>'}<label>Dan<input type="date" name="from"></label><label>Gacha<input type="date" name="to"></label><button class="svc-button">Filtrlash</button></form>`;
        document.getElementById('waiter-orders-list-container').insertAdjacentHTML('beforebegin', filters(false));
        document.getElementById('waiter-orders-list-container').insertAdjacentHTML('afterend', '<div id="service-order-pages"></div>');
        document.getElementById('completed-orders-list').insertAdjacentHTML('beforebegin', filters(true));
        document.getElementById('completed-orders-list').insertAdjacentHTML('afterend', '<div id="service-history-pages"></div>');
        document.getElementById('tab-profile').insertAdjacentHTML('beforeend', '<section id="service-shift" class="svc-card"></section>');
        document.getElementById('tab-calls').insertAdjacentHTML('beforeend', '<section id="service-request-list"></section>');
        document.getElementById('menu-categories-container').insertAdjacentHTML('beforebegin', '<select id="service-menu-mode"><option value="all">Barcha taomlar</option><option value="popular">Ko‘p sotiladigan (30 kun)</option><option value="favorites">Sevimli taomlar</option></select>');
        document.getElementById('submit-waiter-order').insertAdjacentHTML('beforebegin', `<p id="service-draft-state" role="status" aria-live="polite" class="svc-muted">Yuborilmagan qoralama</p>${button('Avvalgi yuborishni qayta tekshirish', 'retry-new-order')}`);
        document.getElementById('service-menu-mode').onchange = () => renderMenuCatalog(menuCatalog);
        for (const history of [false, true]) document.getElementById(`service-${history ? 'history' : 'order'}-filters`).onsubmit = event => { event.preventDefault(); if (history) { historyTable = ''; historyPage = 1; loadCompletedOrders(); } else { orderPage = 1; loadActiveOrders(); } };
        document.getElementById('builder-table-select').addEventListener('change', event => { saveDraft(); restoreDraft(event.target.value); });
        for (const id of ['builder-guest-count', 'order-general-note', 'cart-items-container']) document.getElementById(id)?.addEventListener('input', saveDraft);
        document.addEventListener('input', event => { if (event.target.closest('#tab-menu')) saveDraft(); });
        window.addEventListener('beforeunload', saveDraft); window.addEventListener('offline', () => { saveDraft(); document.getElementById('service-draft-state').textContent = 'Internet uzildi. Yuborilmagan qoralama qurilmada saqlangan.'; });
        document.addEventListener('click', async event => {
            const target = event.target.closest('[data-service-action]'); if (!target || target.disabled) return;
            target.disabled = true; try { await action(target); } catch (error) { showNotification(error.message); } finally { target.disabled = false; }
        });
        socket.on('waiter_call_updated', () => loadActiveCalls()); socket.on('waiter_call', () => loadActiveCalls());
        socket.removeAllListeners('call_waiter');
        socket.on('call_waiter', async data => { await loadActiveCalls(); if (activeCallsList.some(c => c.id === data.callId && c.kind === 'CUSTOMER')) { playAlertSound(); showNotification('Mijoz ofitsantni chaqirdi'); navigator.vibrate?.(250); } });
        socket.on('settings_updated', async () => { policy = (await client.get('/config')).data; loadWaiterStatistics(); loadActiveOrders(); });
        socket.on('return_alert', data => { showNotification(`! QAYTARILDI: ${data.itemName} × ${data.quantity}`); loadActiveOrders(); loadCompletedOrders(); });
        socket.on('service_updated', () => { loadRequests(); loadWaiterStatistics(); if (selectedTableForModal) { const table = allRooms.flatMap(r => r.tables).find(t => t.id === selectedTableForModal); if (table) openTableModal(table.id, table.number, table.status); } });
        socket.on('waiter_new_order', async data => { try { if (policy.scope === 'OWN' && data.orderId) await findOrder(data.orderId); playAlertSound(); showNotification('Yangi mijoz buyurtmasi'); navigator.vibrate?.(200); loadPendingOrders(); } catch {} });
        socket.on('kitchen_order_ready', async data => { try { if (policy.scope === 'OWN' && data.orderId) await findOrder(data.orderId); playAlertSound(); showNotification('Taom tayyor — olib ketish mumkin'); navigator.vibrate?.(200); loadActiveOrders(); } catch {} });
        setInterval(updateTimers, 15000);
    }
    setupUI();
    async function initialize() {
        if (!currentWaiter || ready) return;
        ready = true;
        try {
            const result = await client.init(); policy = result.data; staff = (await client.get('/staff')).data;
            try { favorites = JSON.parse(localStorage.getItem(`waiter-favorites:${currentWaiter.id}`) || '[]'); } catch { favorites = []; }
            await loadRoomsAndTables();
            document.querySelectorAll('.svc-filters [name="tableId"]').forEach(select => { select.innerHTML += allRooms.flatMap(r => r.tables.map(t => `<option value="${e(t.id)}">${e(r.name)} · #${e(t.number)}</option>`)).join(''); });
            document.querySelector('#service-order-filters [name="roomId"]').innerHTML += allRooms.map(r => `<option value="${e(r.id)}">${e(r.name)}</option>`).join('');
            document.querySelector('#service-order-filters [name="waiterId"]').innerHTML += staff.map(s => `<option value="${e(s.id)}">${e(s.fullName)}</option>`).join('');
            draftTable = localStorage.getItem(`waiter-last-table:${currentWaiter.id}`) || ''; const select = document.getElementById('builder-table-select'); if ([...select.options].some(o => o.value === draftTable)) select.value = draftTable;
            restoreDraft(select.value);
            select.addEventListener('change', () => localStorage.setItem(`waiter-last-table:${currentWaiter.id}`, select.value));
            let savedAppend; try { savedAppend = JSON.parse(localStorage.getItem(`waiter-append:${currentWaiter.id}`) || 'null'); } catch {}
            if (savedAppend) { appendOrder = savedAppend.order; appendRequest = savedAppend.request; showNotification('Natijasi noma’lum qo‘shimcha so‘rov saqlangan. Yuborish orqali qayta tekshiring.'); }
            if (client.pending('new-order')) document.getElementById('service-draft-state').textContent = 'Avvalgi buyurtma natijasi noma’lum. Qayta tekshirish tugmasini bosing.';
            await Promise.all([loadActiveOrders(), loadMenuCatalog(), loadActiveCalls(), loadWaiterStatistics(), loadRequests()]);
        } catch (error) { ready = false; showNotification(error.message); }
    }
    window.initWaiterSession = () => { old.initWaiterSession(); initialize(); };
    window.logout = async () => { saveDraft(); ready = false; cartItems = []; appendOrder = null; appendRequest = null; favorites = []; await old.logout(); };
    initialize();
})();
