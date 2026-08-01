import { spawn } from 'node:child_process';
import { readdirSync, writeFileSync, mkdirSync } from 'node:fs';
const base = process.env.HOME + '/.cache/ms-playwright';
const dir = readdirSync(base).find((d) => d.startsWith('chromium-') && !d.includes('headless'));
mkdirSync(new URL('../artifacts/', import.meta.url).pathname, { recursive: true });
const chrome = spawn(`${base}/${dir}/chrome-linux64/chrome`, ['--headless=new','--remote-debugging-port=9270','--use-gl=angle','--use-angle=vulkan','--enable-unsafe-swiftshader','--window-size=1200,900','--no-sandbox','--no-first-run','--user-data-dir=/tmp/pgui','about:blank']);
chrome.stderr.on('data',()=>{});
const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));
let page; for(let i=0;i<40;i++){try{const l=await(await fetch('http://localhost:9270/json/list')).json();page=l.find(t=>t.type==='page');if(page)break;}catch{}await sleep(250);}
const ws=new (await import('ws')).WebSocket(page.webSocketDebuggerUrl);
await new Promise(r=>ws.on('open',r));
let id=0;const pending=new Map();const logs=[];
ws.on('message',d=>{const m=JSON.parse(d.toString());if(m.id&&pending.has(m.id)){pending.get(m.id)(m.result);pending.delete(m.id);}
 if(m.method==='Runtime.exceptionThrown')logs.push('EXC '+(m.params.exceptionDetails.exception?.description||m.params.exceptionDetails.text||'').split('\n')[0]);
 if(m.method==='Runtime.consoleAPICalled'&&m.params.type==='error')logs.push('ERR '+m.params.args.map(a=>a.value??'').join(' ').slice(0,140));});
const send=(m,p={})=>new Promise(res=>{const i=++id;pending.set(i,res);ws.send(JSON.stringify({id:i,method:m,params:p}));});
const ev=async e=>(await send('Runtime.evaluate',{expression:e,returnByValue:true,awaitPromise:true})).result?.value;
const shot=async n=>{const s=await send('Page.captureScreenshot',{format:'png'});writeFileSync(new URL(`../artifacts/${n}.png`,import.meta.url).pathname,Buffer.from(s.data,'base64'));console.log('shot',n);};
await send('Runtime.enable');await send('Page.enable');
await send('Network.enable'); await send('Network.setCacheDisabled',{cacheDisabled:true});
await send('Page.navigate',{url:'https://proofgame.exe.xyz/'});
await sleep(2500);
console.log('audit(reddit):', (await ev(`document.querySelector('#audit .verdict').textContent`)));
console.log('notes:', await ev(`[...document.querySelectorAll('#audit li')].map(l=>l.textContent).join(' | ')`));
await shot('ui-reddit');
// illegal example: three dark bishops
await ev(`document.querySelectorAll('#exlist a')[2].click()`);
await sleep(600);
console.log('audit(3 bishops):', await ev(`document.querySelector('#audit .verdict').textContent`), '|', await ev(`[...document.querySelectorAll('#audit li.prob')].map(l=>l.textContent).join(' | ')`));
await shot('ui-illegal');
// solvable example
await ev(`document.querySelectorAll('#exlist a')[1].click()`);
await sleep(400);
await ev(`document.querySelector('#solve').click()`);
for (let i=0;i<40;i++){ await sleep(500); const s = await ev(`document.querySelector('#status').textContent`); if(/proof game|no game/.test(s)) { console.log('solve:', s); console.log('score:', await ev(`document.querySelector('#score').textContent`)); break; } }
await shot('ui-solved');
console.log('exceptions:', logs.slice(-4).join(' | ')||'(clean)');
ws.close();chrome.kill();process.exit(0);
