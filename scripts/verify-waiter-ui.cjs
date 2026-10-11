/* Browser integration tests use isolated API fixtures; they never create live restaurant records. */
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const express = require('express');
let playwright;
try { playwright = require('playwright'); }
catch { playwright = require(path.join(os.tmpdir(), 'choyxona-ui-qa', 'node_modules', 'playwright')); }
const { chromium } = playwright;
const app = express(); app.use(express.static(path.resolve('public')));
const output = path.resolve('artifacts/waiter-service'); fs.mkdirSync(output, { recursive: true });
const date = new Date(Date.now()-5*60000).toISOString();
const waiter = { id:'waiter-1', name:'Sinov ofitsanti', fullName:'Sinov ofitsanti', role:'WAITER', login:'sinov' };
const menu = [{id:'food-1',name:'Osh',sellingPrice:'30000',available:true,unit:'dona',category:{id:'cat-1',name:'Taomlar'}},{id:'food-2',name:'Choy',sellingPrice:'10000',available:false,unavailableReason:'Tugagan',unit:'dona',category:{id:'cat-1',name:'Taomlar'}}];
const table = {id:'table-1',number:1,status:'OCCUPIED',assignedWaiterId:waiter.id,assignedWaiter:{id:waiter.id,fullName:waiter.name},room:{id:'room-1',name:'Asosiy xona'}};
const order = {id:'order-1',orderNumber:'TEST-001',tableId:table.id,table,waiterId:waiter.id,waiter:{id:waiter.id,fullName:waiter.name},guestCount:3,status:'TAYYOR',updatedAt:date,createdAt:date,totalAmount:'90000',subtotal:'90000',serviceCharge:'0',discount:'0',payments:[],refunds:[],debt:null,items:[{id:'item-1',menuItemId:'food-1',menuItem:menu[0],quantity:'3',cancelledQuantity:'0',totalPrice:'90000',unitPrice:'30000',status:'TAYYOR',createdAt:date,notes:'Piyozsiz'}],balance:{paid:'0',remaining:'90000',debtRemaining:'0',refunds:'0'},statusHistory:[{user:{fullName:waiter.name},createdAt:date,status:'TAYYOR',comment:'Taom tayyor'}]};
const summary = {activeTables:1,activeOrders:1,activeOwnOrders:1,createdOrders:1,createdTotal:'90000',receiptTotal:'0',commission:'0',date:'2026-10-11',guests:3,servedTables:0,unfinishedCalls:1};
let postBodies = [], failNextCreate = false, role = 'WAITER', calls = [{id:'call-1',table,tableId:table.id,kind:'CUSTOMER',status:'YANGI',createdAt:date}], requests = [];
async function api(route) {
    const url = new URL(route.request().url()), p = url.pathname;
    const send = value => route.fulfill({ contentType:'application/json',body:JSON.stringify(value) });
    if (route.request().method()==='POST') {
        const body=route.request().postDataJSON();postBodies.push({path:p,body});
        if (p === '/api/service/orders' && failNextCreate) { failNextCreate = false; return route.abort('failed'); }
        if(p.endsWith('/accept'))calls[0]={...calls[0],status:'QABUL_QILINDI',acceptedById:waiter.id,acceptedBy:{fullName:waiter.name},acceptedAt:new Date().toISOString()};
        if(p.endsWith('/complete'))calls=[];
        if(p.endsWith('/status'))order.items[0].status=body.status;
        return send({success:true,data:{id:'created-1',...body}});
    }
    if(p==='/api/service/config')return send({success:true,data:{scope:'ALL',assign:true,deliver:true,requestReturn:true,requestCancel:true,transfer:true,reassign:true,delayMinutes:20},user:{...waiter,role}});
    if(p==='/api/waiter/me')return send({success:true,waiter});
    if(p==='/api/rooms')return send([{id:'room-1',name:'Asosiy xona',tables:[table,{...table,id:'table-2',number:2,status:'AVAILABLE'}]}]);
    if(p==='/api/menu')return send(menu);
    if(p==='/api/menu/categories/public')return send([{id:'cat-1',name:'Taomlar'}]);
    if(p==='/api/restaurant')return send({restaurantName:'ChoyxonaAzizxon',serviceFeePercent:0});
    if(p==='/api/service/staff')return send({success:true,data:[{id:waiter.id,fullName:waiter.name},{id:'waiter-2',fullName:'Boshqa ofitsant'}]});
    if(p==='/api/service/summary')return send({success:true,data:summary});
    if(p==='/api/service/menu')return send({success:true,data:menu,popular:['food-1']});
    if(p==='/api/service/orders')return send({success:true,data:[url.searchParams.get('history')==='true'?{...order,status:'TOLANDI'}:order],page:1,pages:1,count:1});
    if(p==='/api/service/orders/order-1')return send({success:true,data:order});
    if(p==='/api/orders')return send([]);
    if(p==='/api/waiter/stats')return send({});
    if(p==='/api/service/calls')return send({success:true,data:calls});
    if(p==='/api/service/requests')return send({success:true,data:requests});
    if(p==='/api/service/tables/table-1/bill')return send({success:true,data:{table,guests:3,orders:[order],calls:[],totals:{total:'90000',subtotal:'90000',serviceCharge:'0',discount:'0',paid:'0',refunds:'0',debt:'0',debtRemaining:'0',remaining:'90000'}}});
    if(p==='/api/admin/settings')return send({waiterService:{scope:'ALL',delayMinutes:20,assign:true,deliver:true,requestReturn:true,requestCancel:true,transfer:false,reassign:false,takePayment:false,cashierReview:true,kitchenCancel:true}});
    if(p==='/api/inventory')return send([{id:'inventory-1',name:'Yaroqli mahsulot',unit:'dona'}]);
    return send({success:true,data:[]});
}
(async()=>{
    const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
    const browser=await chromium.launch({channel:'chrome',headless:true});
    const base=`http://127.0.0.1:${server.address().port}`;
    const errors=[];
    try{
        const context=await browser.newContext({viewport:{width:1440,height:1000}}), page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));page.on('dialog',dialog=>dialog.accept());
        await page.route('**/api/**',api);
        await page.route('**/socket.io/**',route=>route.fulfill({contentType:'application/javascript',body:'window.io=()=>({connected:false,on(){},removeAllListeners(){}})'}));
        await page.goto(base+'/waiter/',{waitUntil:'networkidle'});
        await page.waitForFunction(()=>document.getElementById('service-shift')?.textContent.includes('Bugungi smena'));
        await page.evaluate(()=>switchTab('orders'));await page.getByText('Olib ketdim',{exact:true}).first().waitFor();
        await page.screenshot({path:path.join(output,'desktop-orders.png'),fullPage:true});
        await page.getByText('Olib ketdim',{exact:true}).first().click();await page.waitForFunction(()=>document.querySelector('[data-service-action="deliver"]')?.textContent==='Stolga yetkazdim');
        assert.ok(postBodies.some(p=>p.body.status==='OLIB_KETILDI'));
        await page.evaluate(()=>switchTab('menu'));
        await page.selectOption('#builder-table-select','table-1');await page.locator('[data-add-menu-item="food-1"]').click();
        await page.fill('#builder-guest-count','5');await page.fill('#order-general-note','Mehmon uchun izoh');await page.locator('#cart-items-container input').first().fill('Kam tuzli');await page.locator('#order-general-note').click();
        await page.evaluate(()=>loadRoomsAndTables());await page.waitForFunction(()=>document.getElementById('builder-table-select').value==='table-1');
        assert.equal(await page.inputValue('#builder-guest-count'),'5');assert.equal(await page.inputValue('#order-general-note'),'Mehmon uchun izoh');assert.equal(await page.locator('[data-add-menu-item="food-2"]').isDisabled(),true);
        await page.reload({waitUntil:'networkidle'});await page.waitForFunction(()=>document.getElementById('service-shift')?.textContent.includes('Bugungi smena'));await page.evaluate(()=>switchTab('menu'));
        assert.equal(await page.inputValue('#builder-table-select'),'table-1');assert.equal(await page.inputValue('#builder-guest-count'),'5');assert.equal(await page.inputValue('#order-general-note'),'Mehmon uchun izoh');assert.equal(await page.locator('#cart-items-container input').first().inputValue(),'Kam tuzli');
        await page.screenshot({path:path.join(output,'desktop-draft.png'),fullPage:true});
        failNextCreate = true;await context.setOffline(true);await page.click('#submit-waiter-order');await page.waitForFunction(()=>document.getElementById('service-draft-state').textContent.includes('Natijani qayta'));
        await context.setOffline(false);await page.click('#submit-waiter-order');await page.waitForFunction(()=>document.getElementById('service-draft-state').textContent.includes('Saqlandi'));
        const sent=postBodies.find(p=>p.path==='/api/service/orders');assert.equal(sent.body.guestCount,5);assert.equal(sent.body.items[0].note,'Kam tuzli');
        assert.deepEqual(postBodies.filter(p=>p.path==='/api/service/orders')[0].body,postBodies.filter(p=>p.path==='/api/service/orders')[1].body);
        await page.evaluate(()=>openTableModal('table-1',1,'OCCUPIED'));await page.waitForFunction(()=>document.getElementById('modal-table-guests').textContent==='3 mehmon (faol buyurtmalar)');
        assert.ok((await page.locator('#modal-table-waiter').textContent()).includes(waiter.name));await page.evaluate(()=>goToBillForCurrentTable());
        assert.equal(await page.inputValue('#service-history-filters [name="tableId"]'),'table-1');
        await page.setViewportSize({width:390,height:844});await page.evaluate(()=>toggleMobileSidebar());await page.locator('#service-mobile-menu').getByText('Yangi buyurtma',{exact:true}).click();
        assert.equal(await page.locator('#tab-menu').isVisible(),true);await page.screenshot({path:path.join(output,'mobile-menu.png'),fullPage:true});
        await page.evaluate(()=>toggleMobileSidebar());await page.locator('#service-mobile-menu').getByText('Hisoblar',{exact:true}).click();assert.equal(await page.locator('#tab-bills').isVisible(),true);
        await page.evaluate(()=>switchTab('calls'));await page.locator('[data-service-action="call-accept"]').click();await page.locator('[data-service-action="call-complete"]').waitFor();await page.locator('[data-service-action="call-complete"]').click();await page.waitForFunction(()=>document.getElementById('call-alert').classList.contains('hidden'));
        requests=[{id:'request-1',order,orderItem:order.items[0],kind:'RETURN',quantity:1,reason:'Mijoz qaytardi',requestedBy:{fullName:waiter.name},createdAt:date,status:'KUTILMOQDA'}];role='CASHIER';
        await page.goto(base+'/service.html',{waitUntil:'networkidle'});await page.getByText('Qaror berish',{exact:true}).waitFor();await page.getByText('Qaror berish',{exact:true}).click();await page.fill('#decision-form [name="reason"]','Kassir tekshirdi');await page.locator('#decision-form button').click();await page.waitForFunction(()=>!document.getElementById('decision').open);
        await page.screenshot({path:path.join(output,'mobile-cashier.png'),fullPage:true});assert.ok(postBodies.some(p=>p.path==='/api/service/requests/request-1/decision'));
        role='ADMIN';await page.setViewportSize({width:1440,height:1000});await page.goto(base+'/service.html',{waitUntil:'networkidle'});await page.getByText('Ruxsatlar va biriktirish',{exact:true}).click();await page.locator('#settings-form [name="delayMinutes"]').waitFor();await page.screenshot({path:path.join(output,'admin-settings.png'),fullPage:true});
        assert.deepEqual(errors,[], 'Brauzerda bajarilish xatolari bo‘lmasligi kerak');
        console.log('Browser QA passed: desktop/mobile, delivery, draft restoration, notes, stop-list, offline retry, table billing/history, calls, cashier decisions, admin settings.');
    }finally{await browser.close();server.closeAllConnections();server.close();}
})().catch(error=>{console.error(error);process.exitCode=1});
