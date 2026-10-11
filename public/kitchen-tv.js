(() => {
    const grid = document.getElementById('tv-grid-container');
    const connection = document.getElementById('tv-connection');
    const labels = {YANGI:'Tayyorlash kutilmoqda',TASDIQLANDI:'Tayyorlash kutilmoqda',OSHXONAGA_YUBORILDI:'Tayyorlash kutilmoqda',TAYYORLANMOQDA:'Tayyorlanmoqda',TAYYOR:'Tayyor — olib ketish kutilmoqda'};
    let orders = [], loading = false, reloadNeeded = false, failed = false;
    let settings = { showReady:true, soundEnabled:false, textScale:100, refreshSeconds:15, kitchenSection:'' }, lastPoll=0, audio=null, previousStates=null;
    document.addEventListener('click',()=>{if(!audio){const Audio=window.AudioContext||window.webkitAudioContext;if(Audio)audio=new Audio();}audio?.resume().catch(()=>{});});
    function readySound(next){const states=new Map(next.flatMap(order=>(order.items||[]).map(item=>[item.id,item.status])));if(previousStates&&settings.soundEnabled&&audio?.state==='running'&&[...states].some(([id,status])=>status==='TAYYOR'&&previousStates.get(id)!=='TAYYOR')){const tone=audio.createOscillator(),gain=audio.createGain();tone.frequency.value=880;gain.gain.setValueAtTime(.12,audio.currentTime);gain.gain.exponentialRampToValueAtTime(.001,audio.currentTime+.35);tone.connect(gain);gain.connect(audio.destination);tone.start();tone.stop(audio.currentTime+.35);}previousStates=states;}
    async function loadSettings(){try{const response=await fetch('/api/kitchen/tv-settings',{cache:'no-store'});if(response.ok){settings={...settings,...await response.json()};if(orders.length)render();}}catch{connection.textContent='TV sozlamalari qayta tekshiriladi';}}
    const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    function layout() {
        const cards = [...grid.querySelectorAll('.tv-food-card')], count = cards.length;
        if (!count) return;
        const width = grid.clientWidth, height = grid.clientHeight;
        if(!width||!height)return;
        let best = {columns:1,rows:count,score:Infinity};
        for (let columns=1;columns<=count;columns++) {
            const rows=Math.ceil(count/columns);
            const ratio=(width/columns)/(height/rows);
            const score=Math.abs(Math.log(ratio/1.6))+(columns*rows-count)/count*4;
            if(score<best.score) best={columns,rows,score};
        }
        grid.style.setProperty('--columns',best.columns);
        grid.style.setProperty('--rows',best.rows);
        const font=Math.max(10,Math.min(80,Math.min(width/best.columns/12,height/best.rows/6)*settings.textScale/100));
        for(const card of cards) {
            let size=font;card.style.fontSize=`${size}px`;
            while(size>10&&(card.scrollHeight>card.clientHeight+1||card.scrollWidth>card.clientWidth+1)) {size--;card.style.fontSize=`${size}px`;}
        }
    }
    function render() {
        const foods=orders.flatMap(order=>(order.items||[]).filter(item=>Object.hasOwn(labels,item.status||order.status)&&(settings.showReady||(item.status||order.status)!=='TAYYOR')&&(!settings.kitchenSection||item.menuItem?.kitchenSection===settings.kitchenSection)&&Number(item.quantity)-Number(item.cancelledQuantity||0)>0).map(item=>({order,item})));
        document.getElementById('tv-summary').textContent=`${foods.length} ta faol taom • ${new Set(foods.map(f=>f.order.id)).size} ta buyurtma`;
        grid.innerHTML=foods.length?foods.map(({order,item})=>{
            const status=item.status||order.status;
            return `<article class="tv-food-card ${status==='TAYYOR'?'ready':status==='TAYYORLANMOQDA'?'':'waiting'}" data-item-id="${esc(item.id)}">
                <div class="card-top"><strong>Stol №${esc(order.table?.number??'—')}</strong><span>№${esc(order.orderNumber??'—')}</span></div>
                <h2 class="food-name">${esc(item.menuItem?.name??'Taom')}</h2>
                <div class="quantity">${esc(Number((Number(item.quantity)-Number(item.cancelledQuantity||0)).toFixed(3)))} ${esc(item.menuItem?.unit??'dona')}</div>
                <div class="state">${esc(labels[status])}</div>
                <p class="meta">${esc(order.table?.room?.name??'')} • ${esc(order.waiter?.fullName??'Ofitsant biriktirilmagan')}</p>
                ${item.notes?`<p class="note">Taom izohi: ${esc(item.notes)}</p>`:''}
                ${order.notes?`<p class="note">Buyurtma izohi: ${esc(order.notes)}</p>`:''}
                <p class="meta">Kutish: <span class="elapsed" data-since="${esc(item.createdAt||order.createdAt)}"></span></p>
            </article>`;
        }).join(''):'<div class="tv-empty">Oshxonada faol taomlar yo‘q</div>';
        tick();layout();
    }
    async function load() {
        if(loading){reloadNeeded=true;return;}loading=true;
        try {
            const response=await fetch('/api/kitchen/orders',{cache:'no-store'});
            if(response.status===401||response.status===403){orders=[];grid.innerHTML='<div class="tv-empty">TV uchun oshxona panelida tizimga kiring.<a href="/kitchen/">Oshxona panelini ochish</a></div>';document.getElementById('tv-summary').textContent='Kirish talab qilinadi';connection.textContent='Sessiya yo‘q';return;}
            const result=await response.json();if(!response.ok||!result.success||!Array.isArray(result.data))throw new Error('Yuklab bo‘lmadi');
            readySound(result.data);orders=result.data;failed=false;connection.textContent='Yangilandi';render();
        } catch(error) {failed=true;connection.textContent='Aloqa uzildi — qayta tekshirilmoqda';if(!grid.querySelector('.tv-food-card'))grid.innerHTML='<div class="tv-empty">Buyurtmalarni yuklab bo‘lmadi. Avtomatik qayta tekshiriladi.</div>';}
        finally{loading=false;if(reloadNeeded){reloadNeeded=false;load();}}
    }
    function tick(){document.getElementById('tv-clock').textContent=new Date().toLocaleTimeString('uz-UZ',{hour12:false});for(const element of grid.querySelectorAll('[data-since]')){const seconds=Math.max(0,Math.floor((Date.now()-new Date(element.dataset.since).getTime())/1000));element.textContent=Number.isFinite(seconds)?`${Math.floor(seconds/60)}:${String(seconds%60).padStart(2,'0')}`:'—';}}
    document.getElementById('tv-fullscreen').addEventListener('click',async()=>{try{if(document.fullscreenElement)await document.exitFullscreen();else await document.documentElement.requestFullscreen();}catch{connection.textContent='To‘liq ekran uchun F11 bosing';}});
    document.addEventListener('fullscreenchange',()=>{document.getElementById('tv-fullscreen').textContent=document.fullscreenElement?'Oddiy ekran':'To‘liq ekran';layout();});
    window.addEventListener('resize',layout);new ResizeObserver(layout).observe(grid);
    window.addEventListener('online',load);document.addEventListener('visibilitychange',()=>{if(!document.hidden)load();});
    if(typeof io==='function'){const socket=io();for(const event of ['connect','kitchen_new_order','order_status_updated','orderUpdate','service_updated'])socket.on(event,load);socket.on('settings_updated',()=>{loadSettings();load();});socket.on('disconnect',()=>{connection.textContent='Jonli aloqa uzildi — davriy tekshiruv faol';});}
    setInterval(tick,1000);setInterval(()=>{if(Date.now()-lastPoll>=settings.refreshSeconds*1000&&(!document.hidden||failed)){lastPoll=Date.now();loadSettings();load();}},1000);tick();loadSettings();load();
})();
