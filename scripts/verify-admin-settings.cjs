const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript'),express=require('express');
const settings=require('../dist/utils/settings');
test('Admin sozlamalari: eskirgan versiya yozmaydi, bir versiyaning parallel saqlanishidan bittasi o‘tadi va tiklash tekshiriladi',async()=>{
    const stored=new Map(),revisions=[],events=[];let sequence=0,tail=Promise.resolve();
    const db={appSetting:{findUnique:async({where})=>stored.has(where.key)?{value:stored.get(where.key)}:null,upsert:async({where,create,update})=>{stored.set(where.key,structuredClone(stored.has(where.key)?update.value:create.value));}},settingRevision:{create:async({data})=>{const row={...data,id:`r${++sequence}`};revisions.push(row);return row;},findUniqueOrThrow:async({where})=>revisions.find(r=>r.id===where.id)},auditLog:{create:async()=>{}},$queryRaw:async()=>[]};
    db.$transaction=async fn=>{const before=tail;let release;tail=new Promise(r=>release=r);await before;try{return await fn(db);}finally{release();}};
    const context={exports:{},console,require(name){if(name==='express')return express;if(name==='../utils/db')return{prisma:db};if(name==='../utils/settings')return settings;if(name==='../socket')return{emitSocketEvent:(...args)=>events.push(args)};if(name==='../middleware/auth')return{authenticateToken:(req,res,next)=>{req.user={id:'admin',role:req.get('x-role')||'ADMIN'};next();},requireRole:roles=>(req,res,next)=>roles.includes(req.user.role)?next():res.status(403).json({message:'Ruxsat yo‘q'})};return require(name);}};
    vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/routes/admin-settings.routes.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,context);
    const app=express();app.use(express.json());app.use('/settings',context.exports.default);const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const base=`http://127.0.0.1:${server.address().port}/settings`;
    const send=(key,value,version)=>fetch(base+'/'+key,{method:'PUT',headers:{'Content-Type':'application/json','x-settings-version':version},body:JSON.stringify(value)});
    try{
        const original=settings.defaults.waiterService,version=settings.settingsVersion(original),changed={...original,scope:'OWN'};
        const responses=await Promise.all([send('waiterService',changed,version),send('waiterService',{...original,deliver:false},version)]);assert.deepEqual(responses.map(r=>r.status).sort(),[200,409]);assert.equal(revisions.length,1);assert.equal(events.length,1);
        const saved=stored.get('waiterService');assert.equal(await send('waiterService',original,version).then(r=>r.status),409);assert.deepEqual(stored.get('waiterService'),saved);
        const stale=await fetch(base+'/history/'+revisions[0].id+'/restore',{method:'POST',headers:{'x-settings-version':version}});assert.equal(stale.status,409);
        const restore=await fetch(base+'/history/'+revisions[0].id+'/restore',{method:'POST',headers:{'x-settings-version':settings.settingsVersion(saved)}});assert.equal(restore.status,200);assert.deepEqual(stored.get('waiterService'),original);
        const denied=await fetch(base+'/waiterService',{method:'PUT',headers:{'Content-Type':'application/json','x-role':'WAITER'},body:JSON.stringify(original)});assert.equal(denied.status,403);
    }finally{server.closeAllConnections();await new Promise(r=>server.close(r));}
});
test('TV sozlamalari chegaralari tekshiriladi va oddiy sozlamalar bilan birga tarixga saqlanishi mumkin',()=>{
    assert.equal(settings.validateSettings('kitchenTv',{...settings.defaults.kitchenTv,textScale:120}).textScale,120);
    for(const input of [{textScale:151},{refreshSeconds:4},{refreshSeconds:5.5},{showReady:'true'},{soundEnabled:1},{kitchenSection:'x'.repeat(101)}])assert.throws(()=>settings.validateSettings('kitchenTv',input));
});
