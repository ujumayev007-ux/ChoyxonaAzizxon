const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const express = require('express');
const { Prisma } = require('@prisma/client');
const { createHmac } = require('node:crypto');
const D = value => new Prisma.Decimal(value || 0);
function copy(v) {
    if (v instanceof Prisma.Decimal) return D(v);
    if (v instanceof Date) return new Date(v);
    if (Array.isArray(v)) return v.map(copy);
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, value]) => [k, copy(value)]));
    return v;
}
function fixture(options = {}) {
    let counter = 0;
    const stamp = new Date('2026-10-11T05:00:00Z');
    const table = { id: 'table-1', number: 1, assignedWaiterId: 'waiter-1', isActive: true, room: { id: 'room-1', name: 'Xona', isActive: true }, roomId: 'room-1' };
    const menu = { id: 'food-1', name: 'Taom', available: true, isActive: true, sellingPrice: D('25.25'), category: { id: 'category-1', isActive: true } };
    const item = { id: 'item-1', orderId: 'order-1', menuItemId: menu.id, menuItem: menu, quantity: D(3), cancelledQuantity: D(0), unitPrice: D('25.25'), totalPrice: D('75.75'), status: 'TAYYOR', createdAt: stamp, updatedAt: stamp, ...options.item };
    const order = { id: 'order-1', orderNumber: 'TEST-1', waiterId: 'waiter-1', tableId: table.id, table,
        items: [item], payments: [], refunds: [], debt: null, processingById: null, serviceRequests: [],
        status: 'TAYYOR', subtotal: D('75.75'), serviceFeePercent: D(10), serviceCharge: D('7.58'), discount: D('1.33'), totalAmount: D(82), guestCount: 3,
        createdAt: stamp, updatedAt: stamp, ...options.order };
    let state = { tables: [table, { ...table, id: 'table-2', assignedWaiterId: null, number: 2 }], menu: [menu], orders: [order], requests: [], calls: [], records: [], refundLines: [], history: [], audits: [], movements: [], inventories: [{ id: 'inventory-1', name: 'Mahsulot', quantity: D(5) }], inventoryHistory: [], queryLog: [], settings: options.settings || {} };
    const events = [], printCalls = [];
    function models(get) {
        const hydrate = o => o && { ...copy(o), table: copy(get().tables.find(t => t.id === o.tableId)), waiter: o.waiterId ? { id: o.waiterId, fullName: o.waiterId } : null,
            serviceRequests: copy(get().requests.filter(r => r.orderId === o.id)), statusHistory: copy(get().history.filter(h => h.orderId === o.id)) };
        const set = (obj, data) => { for (const [k, val] of Object.entries(data)) { if (k === 'statusHistory' || k === 'items') continue; obj[k] = copy(val); } obj.updatedAt = new Date(new Date(obj.updatedAt || stamp).getTime() + 1); return copy(obj); };
        return {
            $queryRaw: async (strings, ...values) => {
                const sql = strings.join('?');
                if (sql.includes('pg_advisory_xact_lock')) throw new Error('Failed to deserialize column of type void');
                get().queryLog.push({ sql, values }); return [];
            },
            $executeRaw: async (strings, ...values) => { get().queryLog.push({ sql: strings.join('?'), values }); return 1; },
            appSetting: { findUnique: async ({ where }) => get().settings[where.key] ? { value: get().settings[where.key] } : null }, restaurantSetting: { findFirst: async () => null },
            idempotencyRecord: { findUnique: async ({ where }) => copy(get().records.find(r => r.key === where.key) || null), create: async ({ data }) => { get().records.push(copy(data)); return copy(data); } },
            user: { findFirst: async ({ where }) => ['waiter-1','waiter-2'].includes(where.id) ? { id: where.id, role: 'WAITER', isActive: true } : null, findMany: async () => [{ id: 'waiter-1', fullName: 'Ofitsant' }, { id: 'waiter-2', fullName: 'Ikkinchi' }] },
            table: { findFirst: async ({ where }) => copy(get().tables.find(t => t.id === where.id) || null), findUnique: async ({ where }) => copy(get().tables.find(t => t.id === where.id) || null),
                update: async ({ where, data }) => set(get().tables.find(t => t.id === where.id), data),
                updateMany: async ({ where, data }) => { let count = 0; for (const t of get().tables) if ((!where.id || t.id === where.id) && (where.assignedWaiterId === undefined || t.assignedWaiterId === where.assignedWaiterId)) { set(t, data); count++; } return { count }; } },
            menuItem: { findMany: async ({ where = {} } = {}) => copy(get().menu.filter(m => (!where.id?.in || where.id.in.includes(m.id)) && (where.available === undefined || where.available === m.available))),
                update: async ({ where, data }) => set(get().menu.find(m => m.id === where.id), data) },
            order: {
                findUnique: async ({ where }) => hydrate(get().orders.find(o => o.id === where.id)), findUniqueOrThrow: async ({ where }) => hydrate(get().orders.find(o => o.id === where.id)),
                create: async ({ data }) => {
                    const o = { ...copy(data), id: `created-${++counter}`, updatedAt: stamp, createdAt: stamp, payments: [], refunds: [], debt: null, discount: D(0), processingById: null,
                        items: data.items.create.map(i => ({ ...copy(i), id: `line-${++counter}`, cancelledQuantity: D(0), menuItem: copy(get().menu.find(m => m.id === i.menuItemId)), status: 'YANGI', createdAt: stamp })) };
                    get().orders.push(o); return hydrate(o);
                },
                update: async ({ where, data }) => { const o = get().orders.find(o => o.id === where.id); set(o, data); return hydrate(o); },
                count: async ({ where }) => get().orders.filter(o => o.tableId === where.tableId && !where.status.notIn.includes(o.status)).length,
                findMany: async ({ where }) => copy(get().orders.filter(o => (!where.waiterId || o.waiterId === where.waiterId) && (!where.status?.notIn || !where.status.notIn.includes(o.status)))).map(hydrate)
            },
            orderItem: { update: async ({ where, data }) => { const i = get().orders.flatMap(o => o.items).find(i => i.id === where.id); return set(i, data); }, updateMany: async ({ where, data }) => { get().orders.find(o => o.id === where.orderId).items.forEach(i => set(i, data)); return { count: 1 }; } },
            auditLog: { create: async ({ data }) => { get().audits.push(copy(data)); return data; } }, orderStatusHistory: { create: async ({ data }) => { get().history.push(copy(data)); return data; } },
            serviceRequest: {
                findUnique: async ({ where }) => copy(get().requests.find(r => r.id === where.id)), findUniqueOrThrow: async ({ where }) => copy(get().requests.find(r => r.id === where.id)),
                create: async ({ data }) => { const r = { ...copy(data), id: `request-${++counter}`, status: 'KUTILMOQDA', amount: D(0) }; get().requests.push(r); return r; },
                update: async ({ where, data }) => set(get().requests.find(r => r.id === where.id), data),
                aggregate: async ({ where }) => ({ _sum: { quantity: get().requests.filter(r => r.orderItemId === where.orderItemId && r.status === where.status).reduce((s, r) => s.plus(r.quantity), D(0)) } })
            },
            refundItem: { aggregate: async ({ where }) => { const lines = get().refundLines.filter(i => i.orderItemId === where.orderItemId); return { _sum: { quantity: lines.reduce((s,i) => s.plus(i.quantity), D(0)), amount: lines.reduce((s,i) => s.plus(i.amount), D(0)) } }; } },
            refund: { create: async ({ data }) => { const r = { ...copy(data), id: `refund-${++counter}` }; get().refundLines.push(copy(data.items.create)); get().orders.find(o => o.id === data.orderId).refunds.push(r); return r; } },
            cashSession: { findFirst: async () => options.noShift ? null : { id: 'shift-1' } }, cashMovement: { create: async ({ data }) => { get().movements.push(copy(data)); return data; } },
            inventoryProduct: { findUnique: async ({ where }) => copy(get().inventories.find(i => i.id === where.id)), update: async ({ where, data }) => { const i = get().inventories.find(i => i.id === where.id); i.quantity = i.quantity.plus(data.quantity.increment); return i; } }, inventoryTransaction: { create: async ({ data }) => { get().inventoryHistory.push(copy(data)); return data; } },
            waiterCall: {
                findUnique: async ({ where }) => { const c = get().calls.find(c => c.id === where.id); return c && { ...copy(c), table: copy(get().tables.find(t => t.id === c.tableId)) }; }, findUniqueOrThrow: async ({ where }) => copy(get().calls.find(c => c.id === where.id)),
                findFirst: async ({ where }) => copy(get().calls.find(c => c.tableId === where.tableId && c.kind === where.kind && c.status !== 'YAKUNLANDI') || null),
                create: async ({ data }) => { const c = { ...copy(data), id: `call-${++counter}`, status: 'YANGI', acceptedById: null, createdAt: stamp }; get().calls.push(c); return c; },
                updateMany: async ({ where, data }) => { let count = 0; for (const c of get().calls) if ((!where.id || c.id === where.id) && c.status === where.status && c.acceptedById === where.acceptedById) { set(c,data); count++; } return { count }; }
            }
        };
    }
    let queue = Promise.resolve();
    const db = models(() => state);
    db.$transaction = async callback => {
        const run = queue.then(async () => { const staged = copy(state); const result = await callback(models(() => staged)); state = staged; return result; }); queue = run.catch(() => {}); return run;
    };
    function load(file, mocks = {}) {
        const context = { exports: {}, console: { error() {} }, process, URLSearchParams, Buffer, Date, require(name) {
            if (Object.hasOwn(mocks,name)) return mocks[name];
            if (name === '../utils/db') return { prisma: db };
            if (name === '../middleware/auth') return { authenticateToken: (_req, _res, next) => next(), requireRole: roles => (req,res,next) => roles.includes(req.user.role) ? next() : res.status(403).json({message:'Ruxsat yo‘q'}) };
            if (name === '../socket') return { emitSocketEvent: (...args) => events.push(args) };
            if (name === '../utils/kitchen-print') return { queueKitchenPrint: async (...args) => printCalls.push(args.slice(1)) };
            if (name === '../utils/telegram') return { telegramToken: async () => 'test-bot-token' };
            if (name.startsWith('../utils/')) return require('../dist/utils/' + name.split('/').at(-1));
            return require(name);
        } };
        vm.runInNewContext(ts.transpileModule(fs.readFileSync(file,'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true } }).outputText, context);
        return context.exports;
    }
    const app = express(); app.use(express.json()); app.use((req, _res, next) => { req.user = { id: req.get('x-user') || 'waiter-1', role: req.get('x-role') || 'WAITER', fullName: 'Sinov xodimi' }; next(); });
    const service = load('src/routes/service.routes.ts'); app.use('/api/service', service.default); app.use('/api', service.serviceLegacyRouter); app.use('/api', load('src/routes/telegram.routes.ts').default);
    app.use((_req,res)=>res.status(404).json({success:false,message:'Test fixture route not mounted'}));
    let server, base, starting;
    return { get state() { return state; }, events, printCalls, db,
        async send(path, body, role = 'WAITER', user = 'waiter-1') {
            if (!starting) starting = (async () => { server = app.listen(0,'127.0.0.1'); await new Promise(resolve => server.once('listening', resolve)); base = `http://127.0.0.1:${server.address().port}`; })(); await starting;
            const response = await fetch(base + path, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', 'x-role': role, 'x-user': user }, body: body ? JSON.stringify(body) : undefined });
            return { status: response.status, body: await response.json() };
        },
        close() { if (server) { server.closeAllConnections(); server.close(); } }
    };
}
const body = (h, extra = {}) => ({ updatedAt: h.state.orders[0].updatedAt.toISOString(), idempotencyKey: 'operation-test-' + Math.random().toString(36).slice(2), ...extra });
function tracked(t, options) { const h = fixture(options); t.after(() => h.close()); return h; }
test('HTTP panelda randomUUID bo‘lmasa ham buyurtma yuboriladi va qayta yuborish asl so‘rovni saqlaydi', async () => {
    const saved = new Map(), calls = [];
    let offline = true;
    function client() {
        const context = { window: {}, crypto: { getRandomValues: values => require('node:crypto').webcrypto.getRandomValues(values) },
            localStorage: { getItem: key => saved.get(key) || null, setItem: (key, value) => saved.set(key, value), removeItem: key => saved.delete(key) },
            fetch: async (_url, request) => {
                if (!request?.body) return { ok: true, json: async () => ({ user: { id: 'waiter-1' }, data: {} }) };
                calls.push(JSON.parse(request.body));
                if (offline) throw new Error('offline');
                return { ok: true, json: async () => ({ success: true, data: { id: 'created' } }) };
            } };
        vm.runInNewContext(fs.readFileSync('public/service-client.js', 'utf8'), context);
        return context.window.ServiceClient;
    }
    await assert.rejects(() => client().post('/orders', { items: [1] }, 'new-order'), /Natijani/);
    assert.equal(calls.length, 1, 'HTTP panel so‘rovni serverga yuborishi kerak');
    assert.match(calls[0].idempotencyKey, /^[a-zA-Z0-9_-]{16,100}$/);
    offline = false;
    await client().post('/orders', { items: [2] }, 'new-order');
    assert.deepEqual(calls[1], calls[0]);
    assert.equal(saved.size, 0);
});

test('Yangi buyurtma server narxida hisoblanadi; parallel va uzilgan javobdan keyingi retry bitta buyurtma yaratadi', async t => {
    const h = tracked(t), payload = { tableId: 'table-1', guestCount: 4, items: [{ productId: 'food-1', quantity: 2 }], idempotencyKey: 'new-order-retry-123456' };
    const results = await Promise.all([h.send('/api/orders', payload), h.send('/api/orders', payload)]);
    assert.ok(results.every(r => r.status === 201)); assert.equal(h.state.orders.length, 2);
    assert.equal(results[0].body.data.totalAmount, '50.5'); assert.deepEqual(results[0].body, results[1].body);
    assert.equal((await h.send('/api/orders', { ...payload, guestCount: 5 })).status, 409);
    assert.ok(h.state.queryLog.some(q => q.sql.includes('pg_advisory_xact_lock')));
});
test('Stop-list va OWN doirasi yangi buyurtmani serverda cheklaydi', async t => {
    const h = tracked(t, { settings: { waiterService: { scope: 'OWN' } } });
    const payload = { tableId: 'table-1', guestCount: 1, items: [{ productId: 'food-1', quantity: 1 }], idempotencyKey: 'create-disabled-test-1234' };
    assert.equal((await h.send('/api/service/orders', payload, 'WAITER','waiter-2')).status, 403);
    h.state.menu[0].available = false;
    assert.equal((await h.send('/api/service/orders', payload)).status, 409); assert.equal(h.state.orders.length,1);
});
test('Stolni band qilish: takroriy so‘rov bitta biriktirish, boshqa ofitsantga rad javobi va egasiga bo‘shatish', async t => {
    const h = tracked(t), path = '/api/service/tables/table-2';
    const payload = { idempotencyKey: 'reserve-table-retry-12345' };
    const results = await Promise.all([
        h.send(path + '/assign', payload),
        h.send(path + '/assign', { idempotencyKey: 'reserve-other-waiter-12345' }, 'WAITER', 'waiter-2')
    ]);
    assert.equal(results[0].status, 200);
    assert.equal(results[1].status, 409);
    assert.equal(h.state.tables[1].assignedWaiterId, 'waiter-1');
    assert.deepEqual((await h.send(path + '/assign', payload)).body, results[0].body);
    assert.equal(h.state.audits.filter(a => a.action === 'TABLE_ASSIGNED').length, 1);
    assert.equal((await h.send(path + '/release', { idempotencyKey: 'release-other-waiter-12345' }, 'WAITER', 'waiter-2')).status, 403);
    assert.equal((await h.send(path + '/release', { idempotencyKey: 'release-owner-waiter-12345' })).status, 200);
    assert.equal(h.state.tables[1].assignedWaiterId, null);
});
test('Ikki ofitsant bir mijoz buyurtmasini parallel tasdiqlasa faqat bittasi biriktiriladi', async t => {
    const h = tracked(t, { order: { status: 'YANGI', waiterId: null } });
    const first = body(h), second = body(h);
    const results = await Promise.all([h.send('/api/service/orders/order-1/approve',first), h.send('/api/service/orders/order-1/approve',second,'WAITER','waiter-2')]);
    assert.deepEqual(results.map(r => r.status),[200,409]); assert.equal(h.state.orders[0].waiterId,'waiter-1');
    assert.equal(h.state.history.filter(h => h.comment.includes('Buyurtma tasdiqlandi')).length,1);
});
test('Qisman tayyor taomni olib ketish va yetkazish, eski ma’lumot hamda boshqa ofitsantdan himoya', async t => {
    const h = tracked(t); h.state.orders[0].items.push({ ...copy(h.state.orders[0].items[0]), id:'item-2', status:'TAYYORLANMOQDA' });
    const payload = body(h,{status:'OLIB_KETILDI'});
    assert.equal((await h.send('/api/service/orders/order-1/items/item-1/status',payload,'WAITER','waiter-2')).status,403);
    assert.equal((await h.send('/api/service/orders/order-1/items/item-1/status',payload)).status,200);
    assert.equal(h.state.orders[0].status,'TAYYORLANMOQDA'); assert.equal(h.state.orders[0].items[1].status,'TAYYORLANMOQDA');
    assert.equal((await h.send('/api/service/orders/order-1/items/item-1/status',{...payload,status:'STOLGA_YETKAZILDI',idempotencyKey:'stale-request-123456789'})).status,409);
    assert.equal((await h.send('/api/service/orders/order-1/items/item-1/status',body(h,{status:'STOLGA_YETKAZILDI'}))).status,200);
    assert.ok(h.state.orders[0].items[0].deliveredAt);
});
test('Oshxona alohida taom holatini boshqaradi; ofitsant tayyorlikni o‘zi belgilay olmaydi', async t => {
    const h = tracked(t); h.state.orders[0].items[0].status='YANGI';
    assert.equal((await h.send('/api/service/orders/order-1/items/item-1/status',body(h,{status:'TAYYORLANMOQDA'}))).status,403);
    assert.equal((await h.send('/api/service/orders/order-1/items/item-1/status',body(h,{status:'TAYYORLANMOQDA'}),'KITCHEN','kitchen-1')).status,200);
    assert.equal((await h.send('/api/service/orders/order-1/items/item-1/status',body(h,{status:'TAYYOR'}),'KITCHEN','kitchen-1')).status,200);
    assert.ok(h.events.some(([name])=>name==='kitchen_order_ready'));
});
test('Kassir bandligi va yopilgan buyurtma yetkazish amalidan himoyalanadi', async t => {
    for (const order of [{processingById:'cashier-1',processingAt:new Date()},{status:'TOLANDI'}]) {
        const h=tracked(t,{order}); assert.equal((await h.send('/api/service/orders/order-1/items/item-1/status',body(h,{status:'OLIB_KETILDI'}))).status,409);
        assert.equal(h.state.orders[0].items[0].status,'TAYYOR');
    }
});
test('Qisman bekor qilish narx, xizmat haqi va miqdorni o‘zgartiradi; takroriy qaror qo‘llanmaydi',async t=>{
    const h=tracked(t); const request=await h.send('/api/service/orders/order-1/requests',body(h,{kind:'CANCEL',orderItemId:'item-1',quantity:1,reason:'Mijoz fikrini o‘zgartirdi'})); assert.equal(request.status,201);
    const id=request.body.data.id, decision={idempotencyKey:'decision-cancel-12345678',status:'TASDIQLANDI',reason:'Tayyorlash to‘xtatildi'};
    assert.equal((await h.send(`/api/service/requests/${id}/decision`,decision,'KITCHEN','kitchen-1')).status,200);
    assert.equal(h.state.orders[0].items[0].cancelledQuantity.toString(),'1'); assert.equal(h.state.orders[0].subtotal.toString(),'50.5'); assert.equal(h.state.orders[0].totalAmount.toString(),'54.22');
    assert.equal((await h.send(`/api/service/requests/${id}/decision`,decision,'KITCHEN','kitchen-1')).status,200); assert.equal(h.state.orders[0].subtotal.toString(),'50.5');
    assert.equal((await h.send(`/api/service/requests/${id}/decision`,{...decision,idempotencyKey:'second-decision-123456'},'KITCHEN','kitchen-1')).status,409);
});
test('To‘lov boshlangan buyurtmaning bekor qilish so‘rovi rad etiladi',async t=>{
    const h=tracked(t,{order:{payments:[{amount:D(10)}]}});
    assert.equal((await h.send('/api/service/orders/order-1/requests',body(h,{kind:'CANCEL',orderItemId:'item-1',quantity:1,reason:'Bekor qilish'}))).status,409); assert.equal(h.state.requests.length,0);
});
test('To‘lanmagan taom qaytarilsa hisob kamayadi, pul qaytarish yozuvi yaratilmaydi',async t=>{
    const h=tracked(t); const request=await h.send('/api/service/orders/order-1/requests',body(h,{kind:'RETURN',orderItemId:'item-1',quantity:1,reason:'Taom qaytarildi'}));
    assert.equal((await h.send(`/api/service/requests/${request.body.data.id}/decision`,{idempotencyKey:'unpaid-return-decision-1234',status:'TASDIQLANDI',reason:'Hisobdan chiqarildi'},'CASHIER','cashier-1')).status,200);
    assert.equal(h.state.orders[0].totalAmount.toString(),'54.22');assert.equal(h.state.refundLines.length,0);assert.equal(h.state.movements.length,0);
});
test('Kutilayotgan miqdor rezervlanadi; rad etish rezervni bo‘shatadi',async t=>{
    const h=tracked(t); const r=await h.send('/api/service/orders/order-1/requests',body(h,{kind:'RETURN',orderItemId:'item-1',quantity:2,reason:'Qaytarish'})); assert.equal(r.status,201);
    assert.equal((await h.send('/api/service/orders/order-1/requests',body(h,{kind:'RETURN',orderItemId:'item-1',quantity:2,reason:'Yana'}))).status,409);
    assert.equal((await h.send(`/api/service/requests/${r.body.data.id}/decision`,{idempotencyKey:'reject-decision-123456',status:'RAD_ETILDI',reason:'Sabab tasdiqlanmadi'},'CASHIER','cashier-1')).status,200);
    assert.equal((await h.send('/api/service/orders/order-1/requests',body(h,{kind:'RETURN',orderItemId:'item-1',quantity:2,reason:'Yangi so‘rov'}))).status,201);
});
test('Qisman qaytarishlar xizmat haqi va chegirma bilan aynan olingan summaga teng; ortiqcha qaytarilmaydi',async t=>{
    const h=tracked(t,{order:{status:'TOLANDI',payments:[{amount:D(82)}]}});
    for(let step=0;step<3;step++) {
        const request=await h.send('/api/service/orders/order-1/requests',body(h,{kind:'RETURN',orderItemId:'item-1',quantity:1,reason:'Qisman qaytarish'})); assert.equal(request.status,201);
        const decision=await h.send(`/api/service/requests/${request.body.data.id}/decision`,{idempotencyKey:'refund-decision-test-'+step,status:'TASDIQLANDI',reason:'Tasdiqlandi',method:'NAQD'},'CASHIER','cashier-1'); assert.equal(decision.status,200);
    }
    assert.equal(h.state.refundLines.reduce((s,i)=>s.plus(i.amount),D(0)).toString(),'82'); assert.equal(h.state.movements.reduce((s,i)=>s.plus(i.amount),D(0)).toString(),'-82'); assert.equal(h.state.orders[0].status,'QAYTARILDI');
    assert.equal((await h.send('/api/service/orders/order-1/requests',body(h,{kind:'RETURN',orderItemId:'item-1',quantity:1,reason:'Ortiqcha'}))).status,409);
});
test('Qarz va smena cheklovi qaytarishni atomar to‘xtatadi',async t=>{
    for(const options of [{order:{debt:{remaining:D(1),payments:[]},payments:[{amount:D(82)}]}},{order:{payments:[{amount:D(82)}]},settings:{payments:{requireOpenShift:true}},noShift:true}]) {
        const h=tracked(t,options); const r=await h.send('/api/service/orders/order-1/requests',body(h,{kind:'RETURN',orderItemId:'item-1',quantity:1,reason:'Qaytarish'}));
        const result=await h.send(`/api/service/requests/${r.body.data.id}/decision`,{idempotencyKey:'blocked-refund-test-1234',status:'TASDIQLANDI',reason:'Tekshirildi'},'CASHIER','cashier-1');
        assert.ok([403,409].includes(result.status)); assert.equal(h.state.refundLines.length,0); assert.equal(h.state.requests[0].status,'KUTILMOQDA');
    }
});
test('Omborga qaytarish faqat adminning alohida qarori; muvaffaqiyatsiz qaror pulni ham qaytarib saqlamaydi',async t=>{
    const h=tracked(t,{order:{payments:[{amount:D(82)}]}}); const r=await h.send('/api/service/orders/order-1/requests',body(h,{kind:'RETURN',orderItemId:'item-1',quantity:1,reason:'Yaroqli mahsulot'}));
    const payload={idempotencyKey:'restock-decision-12345678',status:'TASDIQLANDI',reason:'Yaroqli mahsulot',stockDisposition:'RESTOCK',inventoryId:'inventory-1',restockQuantity:1};
    assert.equal((await h.send(`/api/service/requests/${r.body.data.id}/decision`,payload,'CASHIER','cashier-1')).status,403); assert.equal(h.state.refundLines.length,0);
    assert.equal((await h.send(`/api/service/requests/${r.body.data.id}/decision`,payload,'ADMIN','admin-1')).status,200); assert.equal(h.state.inventories[0].quantity.toString(),'6'); assert.equal(h.state.inventoryHistory.length,1);
});
test('Chaqiruvni ikki xodim egallay olmaydi; faqat qabul qilgan xodim yakunlaydi',async t=>{
    const h=tracked(t); h.state.calls.push({id:'call-1',tableId:'table-1',kind:'CUSTOMER',status:'YANGI',acceptedById:null});
    const results=await Promise.all([h.send('/api/service/calls/call-1/accept',{}),h.send('/api/service/calls/call-1/accept',{},'WAITER','waiter-2')]); assert.deepEqual(results.map(r=>r.status),[200,409]);
    assert.equal((await h.send('/api/service/calls/call-1/complete',{},'WAITER','waiter-2')).status,403);
    assert.equal((await h.send('/api/service/calls/call-1/complete',{})).status,200); assert.ok(h.state.calls[0].completedAt);
    assert.equal((await h.send('/api/service/calls/call-1/complete',{})).status,200);
});
test('Kassir chaqiruvi ofitsant tomonidan egallanmaydi va takroriy chaqirish bitta yozuv saqlaydi',async t=>{
    const h=tracked(t); const calls=await Promise.all([h.send('/api/waiter/cashier-call',{tableId:'table-1'}),h.send('/api/waiter/cashier-call',{tableId:'table-1'})]); assert.equal(h.state.calls.length,1);
    const id=calls[0].body.data.id; assert.equal((await h.send(`/api/service/calls/${id}/accept`,{})).status,403); assert.equal((await h.send(`/api/service/calls/${id}/accept`,{},'CASHIER','cashier-1')).status,200);
});
test('Mijoz chaqiruvi Telegram HMAC bilan tekshiriladi, bazada saqlanadi va takrorlanmaydi',async t=>{
    const h=tracked(t); assert.equal((await h.send('/api/customer/calls',{tableId:'table-1',initData:'user=fake'})).status,401);
    const params=new URLSearchParams({auth_date:String(Math.floor(Date.now()/1000)),user:JSON.stringify({id:123,first_name:'Sinov'})});
    const text=[...params.entries()].sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>`${k}=${v}`).join('\n'); const secret=createHmac('sha256','WebAppData').update('test-bot-token').digest();params.set('hash',createHmac('sha256',secret).update(text).digest('hex'));
    const payload={tableId:'table-1',initData:params.toString()}; const result=await h.send('/api/customer/calls',payload); assert.equal(result.status,200); assert.equal(h.state.calls.length,1);
    assert.equal((await h.send('/api/customer/calls',payload)).status,200); assert.equal(h.state.calls.length,1); assert.ok(h.events.some(([name])=>name==='call_waiter'));
});
test('Ko‘chirish huquqi, sabab, eski versiya va to‘lov muzlatishi serverda tekshiriladi',async t=>{
    const h=tracked(t); assert.equal((await h.send('/api/service/orders/order-1/transfer',body(h,{tableId:'table-2',reason:'Mijoz so‘radi'}))).status,403);
    h.state.settings.waiterService={transfer:true,reassign:true}; const result=await h.send('/api/service/orders/order-1/transfer',body(h,{tableId:'table-2',waiterId:'waiter-2',reason:'Mijoz so‘radi'})); assert.equal(result.status,200); assert.equal(h.state.orders[0].tableId,'table-2'); assert.equal(h.state.orders[0].waiterId,'waiter-2');
    h.state.orders[0].payments.push({amount:D(5)}); assert.equal((await h.send('/api/service/orders/order-1/transfer',body(h,{tableId:'table-1',reason:'Yana'}),'WAITER','waiter-2')).status,409);
});
test('Ruxsatsiz ofitsant to‘lov API va qaytarish qarorini chaqira olmaydi',async t=>{
    const h=tracked(t); assert.equal((await h.send('/api/tables/table-1/pay',{})).status,403);
    assert.equal((await h.send('/api/tables/table-1/pay',{},'CASHIER','cashier-1')).status,404, 'Kassir ruxsatdan o‘tadi, hisoblash ishlovchisi bu izolyatsiya ilovasiga ulanmagan');
    const r=await h.send('/api/service/orders/order-1/requests',body(h,{kind:'RETURN',orderItemId:'item-1',quantity:1,reason:'Sinov'})); assert.equal((await h.send(`/api/service/requests/${r.body.data.id}/decision`,{idempotencyKey:'forbidden-decision-1234',status:'RAD_ETILDI',reason:'Sinov'})).status,403);
});
test('Oshxona izohi va ko‘rdim belgisi tarixga yoziladi',async t=>{
    const h=tracked(t); assert.equal((await h.send('/api/service/orders/order-1/notes',body(h,{itemId:'item-1',note:'Taom 5 daqiqada tayyor'}),'KITCHEN','kitchen-1')).status,200);
    assert.ok(h.state.orders[0].items[0].notes.includes('Taom 5 daqiqada tayyor'));
    assert.equal((await h.send('/api/service/orders/order-1/notes/ack',body(h,{itemId:'item-1'}),'KITCHEN','kitchen-1')).status,200); assert.ok(h.state.orders[0].items[0].noteAcknowledgedAt); assert.equal(h.state.history.length,2);
});
test('Smena topshirish ruxsat, aniq faol ro‘yxat va kassir bandligini tekshiradi; stollar va chaqiruvlar birga topshiriladi',async t=>{
    const h=tracked(t);const payload={waiterId:'waiter-2',orderIds:['order-1'],reason:'Smena tugadi',idempotencyKey:'shift-handover-12345678'};
    assert.equal((await h.send('/api/service/handover',payload)).status,403);
    h.state.settings.waiterService={reassign:true};
    assert.equal((await h.send('/api/service/handover',{...payload,orderIds:[]})).status,409);
    h.state.orders[0].processingById='cashier-1';h.state.orders[0].processingAt=new Date();assert.equal((await h.send('/api/service/handover',payload)).status,409);
    h.state.orders[0].processingById=null;h.state.calls.push({id:'call-1',tableId:'table-1',kind:'CUSTOMER',status:'QABUL_QILINDI',acceptedById:'waiter-1'});
    assert.equal((await h.send('/api/service/handover',payload)).status,200);assert.equal(h.state.orders[0].waiterId,'waiter-2');assert.equal(h.state.tables[0].assignedWaiterId,'waiter-2');assert.equal(h.state.calls[0].acceptedById,'waiter-2');
    assert.equal((await h.send('/api/service/handover',payload)).status,200);assert.equal(h.state.audits.filter(a=>a.action==='SHIFT_HANDOVER').length,2);
});

test('Ofitsant miqdorni tahrirlaydi, jami qayta hisoblanadi va oshxonaga yangilangan bo‘lim cheki boradi',async t=>{
    const h=tracked(t,{order:{status:'TAYYORLANMOQDA'},item:{status:'YANGI'}});
    const result=await h.send('/api/service/orders/order-1/items/item-1/edit',body(h,{quantity:'4'}));
    assert.equal(result.status,200);
    assert.equal(h.state.orders[0].items[0].quantity.toString(),'4');
    assert.equal(h.state.orders[0].subtotal.toString(),'101');
    assert.equal(h.state.orders[0].serviceCharge.toString(),'10.1');
    assert.equal(h.state.orders[0].totalAmount.toString(),'109.77');
    assert.equal(h.printCalls.length,1);
    assert.equal(h.printCalls[0][2][0],'item-1');
    assert.equal(h.printCalls[0][3],'BUYURTMA TAHRIRLANDI');
    assert.equal(h.state.audits.some(a=>a.action==='ORDER_ITEM_EDITED'),true);
});
test('Tayyorlanishi boshlangan, qaytarish so‘rovi bor yoki kassirda band buyurtma tahrirlanmaydi',async t=>{
    for(const options of [
        {order:{status:'TAYYORLANMOQDA'}},
        {order:{status:'TAYYORLANMOQDA'},item:{status:'YANGI'},request:{orderItemId:'item-1'}},
        {order:{status:'TAYYORLANMOQDA',processingById:'cashier-1',processingAt:new Date()},item:{status:'YANGI'}}
    ]) {
        const h=tracked(t,options);
        if(options.request) h.state.requests.push({...options.request,id:'request-1',orderId:'order-1',status:'KUTILMOQDA'});
        const result=await h.send('/api/service/orders/order-1/items/item-1/edit',body(h,{quantity:'2'}));
        assert.equal(result.status,409);
        assert.equal(h.state.orders[0].subtotal.toString(),'75.75');
    }
});
test('Ofitsant tasdiqlangan buyurtmani olganda printer bo‘limlariga yuboradi, tasdiq kutayotganini chop etmaydi',async t=>{
    const accepted=tracked(t);
    assert.equal((await accepted.send('/api/service/orders/order-1/assign',body(accepted))).status,200);
    assert.equal(accepted.printCalls.length,1);
    assert.equal(accepted.printCalls[0][1],'initial');

    const waiting=tracked(t,{order:{status:'YANGI'}});
    assert.equal((await waiting.send('/api/service/orders/order-1/assign',body(waiting))).status,200);
    assert.equal(waiting.printCalls.length,0);
});

test('Natijasi noma’lum frontend so‘rovi qayta yuklanganda ham ayni kalit va asl payload bilan yuboriladi',async()=>{
    const saved=new Map(), calls=[]; let fail=true;
    function context() { const c={window:{},localStorage:{getItem:k=>saved.get(k)||null,setItem:(k,v)=>saved.set(k,v),removeItem:k=>saved.delete(k)},crypto:{randomUUID:()=> 'durable-request-123456'},fetch:async(url,request)=>{if(!request?.body)return {ok:true,json:async()=>({user:{id:'waiter-1'},data:{}})};calls.push(JSON.parse(request.body));if(fail)throw new Error('offline');return {ok:true,json:async()=>({success:true,data:{id:'created'}})}},console};vm.runInNewContext(fs.readFileSync('public/service-client.js','utf8'),c);return c.window.ServiceClient; }
    let client=context(); await client.init(); await assert.rejects(()=>client.post('/orders',{items:[1]},'new-order'),/Natijani/);assert.equal(saved.size,1);
    client=context();await client.init();fail=false;await client.post('/orders',{items:[2]},'new-order');assert.deepEqual(calls[0],calls[1]);assert.deepEqual(calls[1].items,[1]);assert.equal(saved.size,0);
});
