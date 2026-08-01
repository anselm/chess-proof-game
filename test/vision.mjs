// headless test of the client-side reader: load fixtures in a real browser,
// run the recogniser, compare against the known FEN
import { spawn } from 'node:child_process';
import { readdirSync } from 'node:fs';
const base = process.env.HOME + '/.cache/ms-playwright';
const dir = readdirSync(base).find((d) => d.startsWith('chromium-') && !d.includes('headless'));
const chrome = spawn(`${base}/${dir}/chrome-linux64/chrome`, ['--headless=new','--remote-debugging-port=9271','--use-gl=angle','--use-angle=vulkan','--enable-unsafe-swiftshader','--no-sandbox','--no-first-run','--user-data-dir=/tmp/pgv','about:blank']);
chrome.stderr.on('data',()=>{});
const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));
let page; for(let i=0;i<40;i++){try{const l=await(await fetch('http://localhost:9271/json/list')).json();page=l.find(t=>t.type==='page');if(page)break;}catch{}await sleep(250);}
const ws=new (await import('ws')).WebSocket(page.webSocketDebuggerUrl);
await new Promise(r=>ws.on('open',r));
let id=0;const pending=new Map();const logs=[];
ws.on('message',d=>{const m=JSON.parse(d.toString());if(m.id&&pending.has(m.id)){pending.get(m.id)(m.result);pending.delete(m.id);}
 if(m.method==='Runtime.exceptionThrown')logs.push('EXC '+(m.params.exceptionDetails.exception?.description||'').split('\n')[0]);});
const send=(m,p={})=>new Promise(res=>{const i=++id;pending.set(i,res);ws.send(JSON.stringify({id:i,method:m,params:p}));});
const ev=async e=>{const r=await send('Runtime.evaluate',{expression:e,returnByValue:true,awaitPromise:true});return r.result?.value ?? JSON.stringify(r.exceptionDetails?.exception?.description ?? r.exceptionDetails ?? '');};
await send('Runtime.enable');await send('Page.enable');
await send('Network.enable'); await send('Network.setCacheDisabled',{cacheDisabled:true});
await send('Page.navigate',{url:'http://localhost:8600/'});
await sleep(2000);

const cases = [
  ['reddit screenshot', '/fixtures/reddit.png', 'R7/R5pk/1p6/1p4PP/1p6/1p6/1P6/K7'],
];

// synthetic diagrams: same recogniser, different board styles and sizes
const STYLES = [
  ['classic brown', '#f0d9b5', '#b58863', 64, 0],
  ['blue/grey',     '#dee3e6', '#8ca2ad', 48, 0],
  ['green', '#eeeed2', '#769656', 80, 0],
  ['dark theme', '#8f8f9c', '#454552', 56, 0],
  ['noisy texture', '#f0d9b5', '#b58863', 64, 14],
];
const POSITIONS = [
  ['start', 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR'],
  ['endgame', '8/5k2/3p4/1p1P1p2/1P3P2/4K3/8/8'],
  ['reddit', 'R7/R5pk/1p6/1p4PP/1p6/1p6/1P6/K7'],
];
for (const [sname, lightC, darkC, sq, noise] of STYLES) {
  for (const [pname, fen] of POSITIONS) {
    const got = await ev(`(async () => {
      const V = await import('/vision.js');
      const G={'K':'\u265a','Q':'\u265b','R':'\u265c','B':'\u265d','N':'\u265e','P':'\u265f'};
      const S=${sq}, c=document.createElement('canvas'); c.width=c.height=S*8+30;
      const x=c.getContext('2d'); x.fillStyle='#333'; x.fillRect(0,0,c.width,c.height);
      const rows='${fen}'.split('/');
      for(let r=0;r<8;r++){ let f=0;
        for(const ch of rows[r]){
          if(ch>='1'&&ch<='8'){f+=+ch;continue;}
          const px=15+f*S, py=15+r*S;
          f++;
        }
      }
      // squares
      for(let r=0;r<8;r++)for(let f=0;f<8;f++){
        x.fillStyle=((f+r)%2===0)?'${lightC}':'${darkC}';
        x.fillRect(15+f*S,15+r*S,S,S);
        if(${noise}){ // soft wood-grain streaks, like a textured board
          for(let i=0;i<10;i++){ const a=(Math.random()-0.5)*${noise};
            x.fillStyle='rgba('+(a>0?255:0)+','+(a>0?255:0)+','+(a>0?255:0)+','+Math.abs(a)/170+')';
            x.fillRect(15+f*S, 15+r*S+Math.random()*S, S, 2+Math.random()*6); } }
      }
      // pieces
      x.textAlign='center'; x.textBaseline='middle';
      for(let r=0;r<8;r++){ let f=0;
        for(const ch of rows[r]){
          if(ch>='1'&&ch<='8'){f+=+ch;continue;}
          const white = ch===ch.toUpperCase();
          const g=G[ch.toUpperCase()];
          // draw the way real diagram sets do: a solid silhouette in the piece
          // colour with a hairline of the opposite colour, not a fat stroke
          x.font=Math.round(S*0.80)+'px serif';
          x.lineWidth=Math.max(0.8,S*0.012);
          x.fillStyle=white?'#fff':'#111'; x.strokeStyle=white?'#111':'#eee';
          x.strokeText(g,15+f*S+S/2,15+r*S+S/2+S*0.03);
          x.fillText(g,15+f*S+S/2,15+r*S+S/2+S*0.03);
          f++;
        }
      }
      const blob = await new Promise(res=>c.toBlob(res));
      const out = V.readBoard(await V.toImageData(blob));
      return JSON.stringify(out.error?{error:out.error}:{fen:out.fen.split(' ')[0]});
    })()`);
    let p; try { p = JSON.parse(got); } catch { p = { raw: got }; }
    const ok = p.fen === fen;
    console.log(`${ok?'ok  ':'FAIL'} ${sname} / ${pname}${ok?'':`  got ${p.fen ?? p.error ?? p.raw}`}`);
  }
}
for (const [name, url, want] of cases) {
  const got = await ev(`(async () => {
    const V = await import('/vision.js');
    const res = await fetch('${url}'); const blob = await res.blob();
    const img = await V.toImageData(blob);
    const out = V.readBoard(img);
    return JSON.stringify(out.error ? {error: out.error} : { fen: out.fen.split(' ')[0], conf: +out.confidence.toFixed(2), sq: +out.grid.s.toFixed(1), pieces: out.pieces });
  })()`);
  let parsed; try { parsed = JSON.parse(got); } catch { parsed = { raw: got }; }
  const ok = parsed.fen === want;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}`);
  console.log(`     got  ${parsed.fen ?? parsed.error ?? parsed.raw}`);
  if (!ok) console.log(`     want ${want}`);
  if (parsed.conf !== undefined) console.log(`     square ${parsed.sq}px · ${parsed.pieces} pieces · confidence ${parsed.conf}`);
}
console.log(logs.slice(-3).join('\n')||'(clean)');
ws.close();chrome.kill();process.exit(0);
