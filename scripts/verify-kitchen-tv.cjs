/* Real Chrome, isolated API data; no writes to the restaurant database. */
const assert=require('node:assert/strict'),path=require('node:path'),os=require('node:os'),fs=require('node:fs'),express=require('express');
let chromium;try{({chromium}=require('playwright'));}catch{({chromium}=require(path.join(os.tmpdir(),'choyxona-ui-qa/node_modules/playwright')));}
(async()=>{
    const app=express();app.use(express.static(path.resolve('public')));
    const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
    let browser;try{
        browser=await chromium.launch({channel:'chrome',headless:true});
        const page=await browser.newPage({viewport:{width:1920,height:1080}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
        let count=1,unauthorized=false,offline=false,delivered=false,tvSettings={showReady:true,textScale:100,refreshSeconds:15,kitchenSection:''};
        await page.route('**/api/kitchen/tv-settings',r=>r.fulfill({contentType:'application/json',body:JSON.stringify(tvSettings)}));
        await page.route('**/socket.io/**',r=>r.fulfill({contentType:'application/javascript',body:'window.tvHandlers={};window.io=()=>({on(event,fn){window.tvHandlers[event]=fn}});'}));
        await page.route('**/api/kitchen/orders',r=>offline?r.abort():r.fulfill({status:unauthorized?401:200,contentType:'application/json',body:JSON.stringify({success:!unauthorized,data:[{id:'o1',orderNumber:'101',table:{number:7,room:{name:'Asosiy zal'}},waiter:{fullName:'Ali'},createdAt:new Date(Date.now()-300000).toISOString(),notes:'Kam tuzli',items:Array.from({length:count},(_,i)=>({id:`i${i}`,status:delivered&&i===0?'OLIB_KETILDI':i%2?'TAYYOR':'TAYYORLANMOQDA',quantity:'2',cancelledQuantity:'0.5',menuItem:{name:i===0?'Osh <img src=x onerror=alert(1)>':`Taom ${i+1}`,unit:'dona'},notes:'Piyozsiz'}))}]})}));
        await page.goto(`http://127.0.0.1:${server.address().port}/kitchen-tv.html`);
        async function refresh(n){count=n;await page.evaluate(()=>window.tvHandlers.service_updated());await page.waitForFunction(n=>document.querySelectorAll('.tv-food-card').length===n,n);}
        for(const n of [1,2,10]){
            await refresh(n);
            const geometry=await page.locator('.tv-food-card').evaluateAll(cards=>cards.map(c=>({x:c.getBoundingClientRect().x,y:c.getBoundingClientRect().y,w:c.clientWidth,h:c.clientHeight,sh:c.scrollHeight,sw:c.scrollWidth,bottom:c.getBoundingClientRect().bottom,right:c.getBoundingClientRect().right})));
            assert.equal(geometry.length,n);assert.ok(geometry.every(c=>c.bottom<=1080&&c.right<=1920&&c.sh<=c.h+1&&c.sw<=c.w+1));
            if(n===1)assert.ok(geometry[0].w>1850&&geometry[0].h>900);
            if(n===2)assert.equal(geometry[0].y,geometry[1].y);
            if(n===10)assert.equal(new Set(geometry.map(c=>c.y)).size,2);
            fs.mkdirSync('artifacts/kitchen-tv',{recursive:true});await page.screenshot({path:`artifacts/kitchen-tv/${n}-taom.png`});
        }
        assert.equal(await page.locator('.food-name img').count(),0);assert.match(await page.locator('.quantity').first().textContent(),/1.5 dona/);
        tvSettings.showReady=false;await page.evaluate(()=>window.tvHandlers.settings_updated());await page.waitForFunction(()=>document.querySelectorAll('.tv-food-card').length===5);
        tvSettings.showReady=true;tvSettings.kitchenSection='Mavjud bo‘lmagan bo‘lim';await page.evaluate(()=>window.tvHandlers.settings_updated());await page.waitForFunction(()=>document.querySelectorAll('.tv-food-card').length===0);
        tvSettings.kitchenSection='';tvSettings.textScale=120;await page.evaluate(()=>window.tvHandlers.settings_updated());await page.waitForFunction(()=>document.querySelectorAll('.tv-food-card').length===10);
        await page.setViewportSize({width:1080,height:1920});await page.waitForTimeout(150);assert.ok(await page.locator('.tv-food-card').evaluateAll(cards=>cards.every(c=>c.getBoundingClientRect().bottom<=1920&&c.getBoundingClientRect().right<=1080)));
        delivered=true;await page.evaluate(()=>window.tvHandlers.order_status_updated());await page.waitForFunction(()=>document.querySelectorAll('.tv-food-card').length===9);
        count=0;await page.evaluate(()=>window.tvHandlers.service_updated());await page.getByText('Oshxonada faol taomlar yo‘q',{exact:true}).waitFor();
        unauthorized=true;await page.evaluate(()=>window.tvHandlers.connect());await page.getByText('TV uchun oshxona panelida tizimga kiring.',{exact:false}).waitFor();
        unauthorized=false;offline=true;await page.evaluate(()=>window.tvHandlers.connect());await page.getByText('Buyurtmalarni yuklab bo‘lmadi. Avtomatik qayta tekshiriladi.',{exact:true}).waitFor();
        offline=false;count=2;delivered=false;await page.evaluate(()=>window.dispatchEvent(new Event('online')));await page.waitForFunction(()=>document.querySelectorAll('.tv-food-card').length===2);
        assert.deepEqual(errors,[]);console.log('PASS: TV 1/2/10 taom, 1920×1080/1080×1920, real-time, olib ketish, bo‘sh holat, sessiya, qayta ulanish va xavfsiz matn.');
    }finally{if(browser)await browser.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1;});
