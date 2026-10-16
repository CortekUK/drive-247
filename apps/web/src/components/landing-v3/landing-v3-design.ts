/* eslint-disable */
// @ts-nocheck
/*
 * GENERATED — the scripts of Claude Design's "Drive247 Landing v3 - Trax Glass.html",
 * in page order, each in its own block. Carried over verbatim except for:
 *   - pricing toggle: $('.y-bill').forEach → $$ (design bug: single element)
 *   - product stylesheet → /landing-v3/landing-product.css
 *   - payments loop: $('i',bars) → $$ (design bug: single element, so bs.map threw every tick)
 *   - calendar loop: remember the placeholder bar by data-ph, not by its .ph class (design bug: re-entering the card mid-animation found no .ph and threw)
 *   - asset URLs pointed at /landing-v3/
 * They expect the globals the design loads from CDNs (gsap, ScrollTrigger, Lenis,
 * lucide); landing-v3.tsx provides them from npm before calling this, once per page.
 */
export function runLandingV3Design(): void {
  /* ---------------- page script (inline in the HTML) ---------------- */
  {
const $=s=>document.querySelector(s),$$=s=>[...document.querySelectorAll(s)];
lucide.createIcons();
/* one gesture → the 24/7 doors part and reveal the site underneath */
const reduce=matchMedia('(prefers-reduced-motion: reduce)').matches;
const lenis=reduce?null:new Lenis({lerp:.085,smoothWheel:true});
if(lenis){gsap.ticker.add(t=>lenis.raf(t*1000));gsap.ticker.lagSmoothing(0);lenis.stop();}
const B=document.body,hero=$('#hero'),car=$('#car'),after=$('#after'),sh=$('#sheen');
B.classList.add('sealed');scrollTo(0,0);
gsap.set(car,{xPercent:-50});
function fitCar(){const m=car.querySelector('.main'),h1=$('#copy h1');if(!m||!h1)return;const ch=m.offsetHeight||car.offsetWidth*1207/2600;const want=innerHeight*.43,max=h1.getBoundingClientRect().top-ch-18;car.style.top=Math.max(96,Math.min(want,max))+'px';}
fitCar();addEventListener('resize',fitCar);car.querySelector('.main').addEventListener('load',fitCar);document.fonts&&document.fonts.ready.then(fitCar);
const carDY=()=>innerHeight*.5-(car.offsetTop+car.offsetHeight*.5);
const tl=gsap.timeline({paused:true,defaults:{overwrite:'auto'},onUpdate(){const t=this.time();B.classList.toggle('open',t>.55);hero.classList.toggle('gone',this.progress()>=1);}});
tl.to(['#copy h1','#copyR h1'],{opacity:0,y:-30,duration:.45,ease:'power2.in'},0)
 .to(['#copy p','#copyR p'],{opacity:0,y:-18,duration:.4,ease:'power2.in'},.03)
 .to('#copy .ctas',{opacity:0,y:-10,duration:.35,ease:'power2.in'},.06)
 .to(['#cone','#pool','.cue','.side'],{opacity:0,duration:.4},0)
 .add(()=>{sh.classList.remove('go');void sh.offsetWidth;sh.classList.add('go');},.05)
 .to('#doorL',{xPercent:-101,duration:1.35,ease:'power3.inOut'},.12)
 .to('#doorR',{xPercent:101,duration:1.35,ease:'power3.inOut'},.12)
 .to(car,{y:()=>carDY()*.2,scale:1.15,opacity:0,filter:'blur(8px)',duration:.5,ease:'power2.in'},.04)
 .to(['.vig','.grain'],{opacity:0,duration:.6},.35)
 .to('#stage',{opacity:0,duration:.5,ease:'power1.out'},.4)
 .fromTo(after,{scale:.96,y:40,opacity:.4,filter:'blur(4px)'},{scale:1,y:0,opacity:1,filter:'blur(0px)',duration:1,ease:'power3.out',clearProps:'transform,filter'},.25);
let isOpen=false,busy=false;
function open(fast){if(isOpen)return;isOpen=true;busy=true;
 const done=()=>{busy=false;B.classList.remove('sealed');lenis&&lenis.start();};
 if(reduce||fast){tl.progress(1);done();dispatchEvent(new Event('d247:open'));return;}
 tl.timeScale(1).play();dispatchEvent(new Event('d247:open'));gsap.delayedCall(.7,()=>{B.classList.remove('sealed');lenis&&lenis.start();});tl.eventCallback('onComplete',()=>{busy=false;});}
function close(){if(!isOpen||busy)return;isOpen=false;busy=true;B.classList.add('sealed');lenis&&lenis.stop();scrollTo(0,0);
 hero.classList.remove('gone');tl.timeScale(1.4).reverse();tl.eventCallback('onReverseComplete',()=>{busy=false;});}
const atTop=()=>(lenis?lenis.scroll:scrollY)<=2;
let lw=0;
addEventListener('wheel',e=>{const now=performance.now();
 if(!isOpen){e.preventDefault();if(e.deltaY>4&&now-lw>120)open();lw=now;return;}
 if(busy){e.preventDefault();return;}
 if(atTop()&&e.deltaY<-4&&now-lw>400){e.preventDefault();close();}lw=now;},{passive:false});
let ty=null;addEventListener('touchstart',e=>{ty=e.touches[0].clientY;},{passive:true});
addEventListener('touchmove',e=>{if(!isOpen||busy)e.preventDefault();},{passive:false});
addEventListener('touchend',e=>{if(ty==null)return;const dy=ty-e.changedTouches[0].clientY;ty=null;if(Math.abs(dy)<30)return;if(!isOpen&&dy>0)open();else if(isOpen&&atTop()&&dy<0)close();});
addEventListener('keydown',e=>{if(/INPUT|SELECT|TEXTAREA/.test(e.target.tagName))return;
 if(!isOpen&&['ArrowDown','PageDown',' ','Enter'].includes(e.key)&&e.target===B){e.preventDefault();open();}
 else if(isOpen&&atTop()&&['ArrowUp','PageUp'].includes(e.key)){e.preventDefault();close();}});
$('#tour').onclick=()=>open();
window.__d247Lenis=lenis;window.__d247Release=()=>{if(!isOpen){open(true);}};
/* page progress */
const pg=$('#prog');const prog=()=>{const m=document.documentElement.scrollHeight-innerHeight;pg.style.transform='scaleX('+(m>0?(lenis?lenis.scroll:scrollY)/m:0)+')';};
lenis?lenis.on('scroll',prog):addEventListener('scroll',prog,{passive:true});
  }

  /* ---------------- landing-v3.js ---------------- */
  {
/* Drive247 landing v3 — behaviour for the sections after the hero. Loops only run while their section is on screen. */
(()=>{
const $=(s,r=document)=>r.querySelector(s),$$=(s,r=document)=>[...r.querySelectorAll(s)];
const reduce=matchMedia('(prefers-reduced-motion: reduce)').matches;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const seen=(el,fn,margin='0px 0px -12% 0px')=>new IntersectionObserver(es=>es.forEach(e=>fn(e.isIntersecting)),{rootMargin:margin}).observe(el);

/* reveal */
const ro=new IntersectionObserver(es=>es.forEach(e=>{if(e.isIntersecting){e.target.classList.add('in');ro.unobserve(e.target);}}),{rootMargin:'0px 0px -8% 0px'});
$$('.after .x-rv').forEach(el=>ro.observe(el));

/* in-page anchors (work with Lenis or native) */
document.addEventListener('click',e=>{const a=e.target.closest('a[href^="#x-"]');if(!a)return;const t=$(a.getAttribute('href'));if(!t)return;e.preventDefault();
 if(window.__d247Release)window.__d247Release();
 setTimeout(()=>{const L=window.__d247Lenis;L?L.scrollTo(t,{offset:-20,duration:1.4}):t.scrollIntoView?scrollTo({top:t.getBoundingClientRect().top+scrollY-20,behavior:'smooth'}):0;},60);});

/* 01 showcase */
if($('.x-sg')){const tabs=$$('.x-tab'),panes=$$('.x-pane'),ttl=$('#x-sttl'),D=1500;let i=0,t0=0,vis=false,hover=false,raf;
 const set=k=>{i=k;tabs.forEach((t,j)=>t.classList.toggle('on',j===k));panes.forEach((p,j)=>{p.classList.remove('on');if(j===k){void p.offsetWidth;p.classList.add('on');}});ttl.textContent=tabs[k].dataset.t;t0=performance.now();};
 tabs.forEach((t,k)=>t.addEventListener('click',()=>set(k)));
 $('.x-sg').addEventListener('mouseenter',()=>hover=true);$('.x-sg').addEventListener('mouseleave',()=>{hover=false;t0=performance.now()-(+$('.x-tab.on .bar i').dataset.p||0)*D;});
 const loop=now=>{raf=requestAnimationFrame(loop);if(!vis||reduce)return;const bar=$('.x-tab.on .bar i');if(hover){return;}const p=Math.min(1,(now-t0)/D);bar.style.transform=`scaleX(${p})`;bar.dataset.p=p;if(p>=1){bar.style.transform='scaleX(0)';set((i+1)%tabs.length);}};
 seen($('#x-showcase'),v=>{if(v&&!vis){t0=performance.now();set(i);}vis=v;});
 requestAnimationFrame(loop);}

/* 03 Trax chat */
{const asks=$$('.x-ask'),msgs=$('.x-msgs'),ph=$('.x-in .ph');let i=0,run=0,vis=false;
 const ANS=[
  {a:'<strong>3 customers owe you $1,840.</strong> Jonas Weber is the oldest, 4 days overdue on the BMW X5.',
   r:`<div class="r"><span class="x-av" style="background:#e5484d">J</span><b>Jonas Weber</b><em>$1,210.00 <small style="color:var(--late)">4d late</small></em></div><div class="r"><span class="x-av" style="background:#12a594">P</span><b>Priya Shah</b><em>$389.00 <small style="color:var(--wait)">Due today</small></em></div><div class="r"><span class="x-av" style="background:#0090ff">D</span><b>Daniel Reyes</b><em>$241.00 <small style="color:var(--soft)">Due Fri</small></em></div><div class="act"><span>Send reminders</span><span>Open payments</span></div>`},
  {a:'<strong>2 of your 8 cars are free on Friday 17 Oct.</strong> Want me to hold one for Maya’s request?',
   r:`<div class="r"><span class="ci" style="background-image:url(/landing-v3/car2.webp)"></span><b>Mercedes E-Class</b><em>$149 <small style="color:var(--soft)">/ day</small></em></div><div class="r"><span class="ci" style="background-image:url(/landing-v3/car4.webp)"></span><b>BMW 3 Series</b><em>$119 <small style="color:var(--soft)">/ day</small></em></div><div class="act"><span>Hold for Maya</span><span>See calendar</span></div>`},
  {a:'<strong>October is up 18%:</strong> $12,480 collected against $10,570 in September. Weekend rentals drove most of it.',
   r:`<div class="cmp"><div><b>$10,570</b><i style="height:62%"></i>September</div><div><b>$12,480</b><i style="height:84%"></i>October</div></div><div class="act"><span>Open insights</span></div>`}];
 const go=async k=>{const me=++run;i=k;asks.forEach((a,j)=>a.classList.toggle('on',j===k));const q=asks[k].dataset.q;
  ph.classList.remove('e');for(let c=1;c<=q.length;c++){if(me!==run)return;ph.innerHTML=q.slice(0,c)+'<span class="cr"></span>';await sleep(reduce?0:34);}
  await sleep(380);if(me!==run)return;ph.classList.add('e');ph.textContent='Ask Trax anything…';
  msgs.innerHTML='';msgs.insertAdjacentHTML('beforeend',`<div class="x-m u">${q}</div>`);
  await sleep(350);if(me!==run)return;msgs.insertAdjacentHTML('beforeend',`<div class="x-m t"><span class="x-mark"><i data-lucide="sparkles"></i></span><div class="tx"><span class="x-typing"><i></i><i></i><i></i></span></div></div>`);lucide.createIcons();
  await sleep(900);if(me!==run)return;const tx=$('.x-m.t:last-child .tx',msgs),words=ANS[k].a.split(' ');tx.innerHTML='';
  for(let w=1;w<=words.length;w++){if(me!==run)return;tx.innerHTML=words.slice(0,w).join(' ');await sleep(reduce?0:42);}
  await sleep(200);if(me!==run)return;tx.insertAdjacentHTML('beforeend',`<div class="x-res">${ANS[k].r}</div>`);
  await sleep(5200);if(me!==run||!vis)return;go((k+1)%asks.length);};
 asks.forEach((a,k)=>a.addEventListener('click',()=>go(k)));
 seen($('#x-trax'),v=>{const was=vis;vis=v;if(v&&!was)go(i);if(!v)run++;});}

/* 04 how it works iframe — fit height + visibility */
{const f=$('#hiw');if(f){const fit=()=>{try{const d=f.contentDocument;if(!d)return;const s=d.getElementById('hw');const H=s?s.offsetHeight:d.documentElement.scrollHeight;if(H&&Math.abs(f.offsetHeight-H)>1)f.style.height=H+'px';}catch(e){}};
 f.addEventListener('load',()=>{fit();try{const w=f.contentWindow,fw=e=>{e.preventDefault();window.dispatchEvent(new WheelEvent('wheel',{deltaX:e.deltaX,deltaY:e.deltaY,deltaMode:e.deltaMode,bubbles:true,cancelable:true}));};w.addEventListener('wheel',fw,{passive:false});w.document.documentElement.style.overflow='hidden';}catch(e){}try{new ResizeObserver(fit).observe(f.contentDocument.body);}catch(e){}setTimeout(fit,800);});addEventListener('resize',fit);
 const chk=()=>{const r=f.getBoundingClientRect(),v=r.top<innerHeight*.85&&r.bottom>innerHeight*.15;try{f.contentWindow.HIW&&f.contentWindow.HIW.setVisible(v);}catch(e){}};
 addEventListener('scroll',chk,{passive:true});setInterval(chk,500);}}

lucide.createIcons();
})();
  }

  /* ---------------- landing-int2.js ---------------- */
  {
/* Integrations — 5 right-angle routes per side, mirrored, all entering one hub. Scroll draws them; tiles ride in from the edges. */
(()=>{const sec=document.getElementById('x-integrations'),stage=document.getElementById('nStage');if(!sec||!stage)return;
const svg=document.getElementById('nSvg'),hub=document.getElementById('nHub'),tiles=[...stage.querySelectorAll('.n-tile')];
const reduce=matchMedia('(prefers-reduced-motion: reduce)').matches;
let R={l:[],r:[]},P={v:reduce?1:0};
const LANES=5;
function geo(){
 const W=stage.offsetWidth,H=stage.offsetHeight,cx=W/2,cy=H*.5;
 const hw=Math.min(220,Math.max(180,W*.16)),hh=Math.min(190,H*.38);
 stage.style.setProperty('--hy',cy+'px');hub.style.setProperty('--hw',hw+'px');hub.style.setProperty('--hh',hh+'px');
 const gap=Math.min(26,hh/6.5);
 const outY=[H*.12,H*.32,cy,H*.7,H*.9];                       // outer rows, top→bottom
 const inY=[-2,-1,0,1,2].map(k=>cy+k*gap);                     // entry points on the hub side
 const edge=hw/2, step=Math.min(80,W*.055);
 const bend=[edge+step*1.1,edge+step*2.2,0,edge+step*2.2,edge+step*1.1]; // outer-most rows turn closest to the hub → no crossings
 const rr=12;
 const out={l:[],r:[]};
 ['l','r'].forEach(s=>{const d=s==='l'?-1:1;for(let i=0;i<LANES;i++){
  const y0=outY[i],y1=inY[i],x0=cx+d*(W/2+20),xe=cx+d*edge;
  let path;
  if(i===2){path=`M${x0},${y0} H${xe}`;}
  else{const bx=cx+d*bend[i],dn=y1>y0?1:-1;
   path=`M${x0},${y0} H${bx-d*rr} Q${bx},${y0} ${bx},${y0+dn*rr} V${y1-dn*rr} Q${bx},${y1} ${bx+(-d)*rr},${y1} H${xe}`;}
  out[s].push({path,y0,y1,x0,xe,bx:i===2?null:cx+d*bend[i]});}});
 return {W,H,cx,cy,out};}
let G;
function build(){
 G=geo();const {W,H,out}=G;
 let s=`<defs><linearGradient id="nfL" gradientUnits="userSpaceOnUse" x1="0" x2="${W*.22}" y1="0" y2="0"><stop offset="0" stop-color="#fff"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient><linearGradient id="nfR" gradientUnits="userSpaceOnUse" x1="${W}" x2="${W*.78}" y1="0" y2="0"><stop offset="0" stop-color="#fff"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient></defs>`;
 ['l','r'].forEach(sd=>out[sd].forEach((o,i)=>{s+=`<path class="tr" data-s="${sd}" data-i="${i}" d="${o.path}"/>`;}));
 s+=`<rect x="0" y="0" width="${W*.22}" height="${H}" fill="url(#nfL)"/><rect x="${W*.78}" y="0" width="${W*.22}" height="${H}" fill="url(#nfR)"/>`;
 svg.innerHTML=s;
 R={l:[...svg.querySelectorAll('.tr[data-s="l"]')],r:[...svg.querySelectorAll('.tr[data-s="r"]')]};
 [...svg.querySelectorAll('.tr')].forEach(p=>{const L=p.getTotalLength();p.dataset.len=L;p.style.strokeDasharray=L;});
 apply(P.v);}
/* final tile x as a fraction of the outer straight run (edge → bend) */
const FX={l:{0:.62,1:.42,2:.36,4:.62},r:{0:.62,1:.42,2:.36,4:.62}};
function tileXY(t,q){const s=t.dataset.side,i=+t.dataset.line,o=G.out[s][i],d=s==='l'?-1:1;
 const runEnd=o.bx!=null?o.bx:G.cx+d*(G.W*.26);const runStart=G.cx+d*(G.W/2);
 const fx=runStart+(runEnd-runStart)*FX[s][i];const sx=runStart+d*90;
 return {x:sx+(fx-sx)*q,y:o.y0};}
function apply(v){
 ['l','r'].forEach(s=>R[s].forEach((p,i)=>{const del=Math.abs(i-2)*.05,q=Math.min(1,Math.max(0,(v-del)/.6));p.style.strokeDashoffset=(+p.dataset.len*(1-q)).toFixed(1);}));
 const hq=Math.min(1,Math.max(0,(v-.45)/.35));hub.style.opacity=.2+.8*hq;hub.style.scale=(.9+.1*hq).toFixed(3);
 tiles.forEach((t,k)=>{const st=.12+(k%4)*.07,q=Math.min(1,Math.max(0,(v-st)/.5)),e=1-Math.pow(1-q,3);const {x,y}=tileXY(t,e);
  t.style.transform=`translate(${x.toFixed(1)}px,${y.toFixed(1)}px) translate(-50%,-50%)`;t.style.opacity=q<=0?0:Math.min(1,q*2);});
 sec.classList.toggle('n-live',v>.92);}
tiles.forEach(t=>{const p=()=>R[t.dataset.side][+t.dataset.line];const on=v=>{const x=p();x&&x.classList.toggle('hot',v);};
 t.addEventListener('mouseenter',()=>on(true));t.addEventListener('mouseleave',()=>on(false));t.addEventListener('focus',()=>on(true));t.addEventListener('blur',()=>on(false));});
const allHot=v=>{stage.classList.toggle('n-allhot',v);};
hub.addEventListener('mouseenter',()=>allHot(true));hub.addEventListener('mouseleave',()=>allHot(false));hub.tabIndex=0;hub.addEventListener('focus',()=>allHot(true));hub.addEventListener('blur',()=>allHot(false));
build();
if(!reduce&&window.gsap&&window.ScrollTrigger){gsap.registerPlugin(ScrollTrigger);const L=window.__d247Lenis;if(L)L.on('scroll',ScrollTrigger.update);
 gsap.to(P,{v:1,ease:'none',onUpdate:()=>apply(P.v),scrollTrigger:{trigger:stage,start:'top 95%',end:'center 55%',scrub:.7}});
 new MutationObserver(()=>{if(!document.body.classList.contains('sealed'))setTimeout(()=>ScrollTrigger.refresh(),1300);}).observe(document.body,{attributes:true,attributeFilter:['class']});}
else apply(1);
let rz;addEventListener('resize',()=>{clearTimeout(rz);rz=setTimeout(()=>{build();window.ScrollTrigger&&ScrollTrigger.refresh();},150);});
window.lucide&&lucide.createIcons();})();
  }

  /* ---------------- landing-v3b.js ---------------- */
  {
(()=>{const $=(s,r=document)=>r.querySelector(s),$$=(s,r=document)=>[...r.querySelectorAll(s)];
const reduce=matchMedia('(prefers-reduced-motion: reduce)').matches;

/* testimonials carousel — swipe, arrows, auto-advance while visible */
{const view=$('#tcView'),track=$('#tcTrack'),cards=$$('.tc-card'),fill=$('#tcFill'),D=1500*2.4;let i=0,vis=false,hover=false,t0=performance.now(),last=t0;
 const per=()=>innerWidth<860?1:2,max=()=>cards.length-per();
 const go=k=>{const m=max();i=k>m?0:k<0?m:k;const c=cards[0],gap=parseFloat(getComputedStyle(track).columnGap)||0;track.style.transform='translateX('+(-i*(c.offsetWidth+gap))+'px)';cards.forEach((x,j)=>x.classList.toggle('on',j>=i&&j<i+per()));t0=performance.now();};
 $('#tcPrev').onclick=()=>go(i-1);$('#tcNext').onclick=()=>go(i+1);
 view.addEventListener('mouseenter',()=>hover=true);view.addEventListener('mouseleave',()=>hover=false);
 let sx=null;view.addEventListener('pointerdown',e=>{sx=e.clientX;});addEventListener('pointerup',e=>{if(sx==null)return;const dx=e.clientX-sx;sx=null;if(Math.abs(dx)>40)go(i+(dx<0?1:-1));});
 new IntersectionObserver(es=>es.forEach(x=>{vis=x.isIntersecting;if(vis)t0=performance.now();}),{threshold:.25}).observe(view);
 const loop=n=>{requestAnimationFrame(loop);const dt=n-last;last=n;if(!vis||reduce)return;if(hover){t0+=dt;return;}const p=Math.min(1,(n-t0)/D);fill.style.transform='scaleX('+p+')';if(p>=1)go(i+1);};
 addEventListener('resize',()=>go(Math.min(i,max())));go(0);requestAnimationFrame(loop);}

/* pricing toggle */
{const tog=$('#pTog'),th=$('.th',tog),bs=$$('button',tog);
 const place=b=>{th.style.width=b.offsetWidth+'px';th.style.transform=`translateX(${b.offsetLeft}px)`;};
 const tween=(el,to)=>{const from=+(el.dataset.cur||to);el.dataset.cur=to;if(reduce||from===to){el.textContent=to;return;}const s=performance.now();const st=n=>{const q=Math.min(1,(n-s)/550),e=1-Math.pow(1-q,3);el.textContent=Math.round(from+(to-from)*e);if(q<1)requestAnimationFrame(st);};requestAnimationFrame(st);};
 const set=y=>{bs.forEach(b=>b.classList.toggle('on',b.dataset.y===(y?'1':'0')));place(bs.find(b=>b.classList.contains('on')));
  $$('.y-amt b').forEach(b=>tween(b,+(y?b.dataset.y:b.dataset.m)));$$('.y-bill').forEach(s=>s.textContent=y?s.dataset.y:s.dataset.m);};
 bs.forEach(b=>b.addEventListener('click',()=>set(b.dataset.y==='1')));addEventListener('resize',()=>place(bs.find(b=>b.classList.contains('on'))));
 $$('.y-amt b').forEach(b=>b.dataset.cur=b.dataset.y);const on0=bs.find(b=>b.classList.contains('on'));document.fonts.ready.then(()=>place(on0));place(on0);}

/* faq — categories + single-open accordion */
{const items=$$('.y-qa');
 $$('#fCats button').forEach(b=>b.addEventListener('click',()=>{$$('#fCats button').forEach(x=>x.classList.toggle('on',x===b));let n=0;
  items.forEach(q=>{const show=q.dataset.c===b.dataset.c;q.hidden=!show;q.classList.remove('on');if(show){q.style.animationDelay=(n++*.05)+'s';q.style.animation='none';q.offsetHeight;q.style.animation='';}});
  const first=items.find(q=>!q.hidden);if(first)first.classList.add('on');}));
 items.forEach(q=>$('button',q).addEventListener('click',()=>{const on=q.classList.contains('on');items.forEach(x=>x.classList.remove('on'));if(!on)q.classList.add('on');}));}

/* CTA — gentle pointer parallax on the photo (user-initiated) */
{const cb=$('.y-cb'),img=$('.bgimg',cb);if(cb&&!reduce){cb.addEventListener('pointermove',e=>{const r=cb.getBoundingClientRect(),x=(e.clientX-r.left)/r.width-.5,y=(e.clientY-r.top)/r.height-.5;img.style.transform=`scale(1.1) translate(${(-x*18).toFixed(1)}px,${(-y*12).toFixed(1)}px)`;});cb.addEventListener('pointerleave',()=>img.style.transform='');}}

/* reveal for any x-rv added here (in case the main reveal ran before) */
{const io=new IntersectionObserver(e=>e.forEach(x=>{if(x.isIntersecting){x.target.classList.add('in');io.unobserve(x.target);}}),{rootMargin:'0px 0px -10% 0px'});
 $$('.y-tst .x-rv,.y-pr .x-rv,.y-faq .x-rv,.y-cta .x-rv').forEach(el=>io.observe(el));}
lucide.createIcons();})();
  }

  /* ---------------- landing-product.js ---------------- */
  {
/* Product section — alternating portal cards, rendered in a shadow root so the page's CSS can't leak in */
(()=>{const host=document.getElementById('x-showcase'),tpl=document.getElementById('pa-tpl');if(!host||!tpl)return;
const SR=host.attachShadow({mode:'open'});
const ln=document.createElement('link');ln.rel='stylesheet';ln.href='/landing-v3/landing-product.css';SR.appendChild(ln);
SR.appendChild(tpl.content.cloneNode(true));
const svgI=(n,s=14)=>{const k=n.replace(/(^|-)(\w)/g,(_,a,b)=>b.toUpperCase());let nd=lucide.icons[k];if(!nd)return '';if(nd[0]==='svg')nd=nd[2];return `<svg viewBox="0 0 24 24" width="${s}" height="${s}" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">${nd.map(([t,a])=>`<${t} ${Object.entries(a).map(([x,y])=>`${x}="${y}"`).join(' ')}/>`).join('')}</svg>`;};
const icons=()=>SR.querySelectorAll('i[data-lucide]').forEach(i=>{const k=i.dataset.lucide;const s=svgI(k,18);if(s){i.innerHTML=s;i.removeAttribute('data-lucide');i.style.display='inline-flex';i.firstChild.classList.add('lucide');}});
const start=()=>{

const $=(s,r=SR)=>r.querySelector(s),$$=(s,r=SR)=>[...r.querySelectorAll(s)];
const AV=['#5b5bd6','#12a594','#e5484d','#f76b15','#0090ff','#8e4ec6','#30a46c','#d6409f'];
const money=n=>'$'+n.toLocaleString('en-US',{minimumFractionDigits:0});
const bar=(page,url='yourcompany.portal.drive-247.com')=>`<div class="wb"><span class="dt"><i></i><i></i><i></i></span><span class="url"><i data-lucide="lock"></i>${url}</span><span class="pg">${page}</span></div>`;
const payRow=(n,s,a,st,c,i)=>`<div class="r"><span class="who"><span class="av" style="background:${AV[i%8]}">${n[0]}</span><span>${n}<small>${s}</small></span></span><span class="amt">${a}<small style="color:${c}">${st}</small></span></div>`;
const BK=[['Tesla Model 3',[[0,3,'Maya O.','#442DD7']]],['BMW X5',[[1,4.4,'Jonas W.','#d93025']]],['Lexus RX 350',[[0,1.5,'Daniel R.','#12a594'],[4,2.6,'','ph']]],['Audi Q5',[[2.5,2,'Priya S.','#6a55f5']]]];
const R=[
{ic:'calendar-days',t:'Bookings that <em>run themselves.</em>',p:'Your own booking site takes reservations day and night. Every car, every date, on one calendar, with requests queued oldest first.',li:['Branded booking site on your domain','Drag-to-extend calendar','One queue for every request'],
 card:`<div class="win">${bar('Calendar')}<div class="wc"><div class="wh"><div><h4>This week</h4><small id="b-sub">4 cars · 5 bookings</small></div><span class="wbtn"><i data-lucide="plus"></i>New booking</span></div>
 <div class="cal" id="cal"><span></span>${['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].map((d,i)=>`<span class="d${i===2?' t':''}">${d}</span>`).join('')}
 ${BK.map(([car,bs],r)=>`<span class="cr">${car}</span><div class="tk">${[1,2,3,4,5,6].map(n=>`<span class="vl" style="left:calc(100% / 7 * ${n})"></span>`).join('')}${r===0?'<span class="today" style="left:calc(100% / 7 * 2.45)"></span>':''}${bs.map(([s,l,n,c])=>`<span class="bk${c==='ph'?' ph':''}" style="left:calc(100% / 7 * ${s} + 3px);width:calc(100% / 7 * ${l} - 6px);background:${c}">${n}</span>`).join('')}</div>`).join('')}</div></div></div>`},
{ic:'credit-card',t:'Get paid <em>before pickup.</em>',p:'Deposits are held and balances charged automatically through Stripe. Only money actually collected counts on your dashboard.',li:['Deposits held, released on return','Automatic balance charges','Payouts straight to your bank'],
 card:`<div class="win">${bar('Payments')}<div class="wc"><div class="wh"><div><h4>Payments</h4><small>Last 30 days · via Stripe</small></div><span class="wbtn"><i data-lucide="download"></i>Export</span></div>
 <div class="pane"><span class="lbl">Collected</span><div class="big"><span id="p-big">$12,480</span><small>↑ 18%</small></div><div class="bars" id="p-bars">${[34,52,44,62,48,70,78,56,66,60,74,88,68,100].map(h=>`<i style="--h:${h}%"></i>`).join('')}</div></div>
 <div class="lst" id="p-l" style="height:156px">${payRow('Maya Okafor','Deposit · Stripe','$300.00','Held','var(--p)',0)}${payRow('Daniel Reyes','Extension · 2 days','$278.00','Paid','var(--clear)',1)}${payRow('Jonas Weber','Rental R-1041','$1,210.00','4d late','var(--late)',2)}</div></div></div>`},
{ic:'scan-face',t:'Every driver <em>checked.</em>',p:'Licence and selfie are matched before the keys ever move, with a shared blocklist so a bad renter can’t try again elsewhere.',li:['Licence + selfie match in seconds','Shared operator blocklist','Age and expiry rules'],
 card:`<div class="win">${bar('Customers')}<div class="wc"><div class="wh"><div><h4 id="d-who">Priya Shah</h4><small>Verification · new customer</small></div><span class="wbtn" id="d-btn"><i data-lucide="user-check"></i>Approve</span></div>
 <div class="pane" style="display:flex;align-items:center;gap:16px"><div class="idc" style="flex:1"><span class="ph" id="d-ini">PS</span><span class="ln"><i style="width:70%"></i><i style="width:90%"></i><i style="width:50%"></i><i style="width:76%"></i></span><span class="scan" id="d-scan"></span></div>
 <div class="ring"><svg viewBox="0 0 36 36"><circle cx="18" cy="18" r="15" fill="none" stroke="#ecebf1" stroke-width="3.5"/><circle id="d-ring" cx="18" cy="18" r="15" fill="none" stroke="#12a594" stroke-width="3.5" stroke-linecap="round" pathLength="100" stroke-dasharray="100" stroke-dashoffset="0"/></svg><b id="d-pct">100%</b></div></div>
 <div class="lst">${['Driving licence','Selfie match','Blocklist','Age 25+'].map(a=>{const ok=a==='Blocklist'?'Clear':a==='Age 25+'?'Passed':'Matched';return `<div class="r d-r" style="height:44px"><span style="display:flex;align-items:center;gap:10px;font-weight:600;white-space:nowrap"><i data-lucide="shield-check" style="color:var(--clear)"></i>${a}</span><span class="mk ok" data-ok="${ok}">${ok}</span></div>`;}).join('')}</div></div></div>`},
{ic:'key-round',t:'Keys, <em>without the counter.</em>',p:'Agreements are e-signed from a phone, and the lockbox code goes out the moment the rental starts. Photos are timestamped at both ends.',li:['E-signed agreements by BoldSign','Lockbox code by SMS at start time','Late returns flagged instantly'],
 card:`<div class="win">${bar('Agreements')}<div class="wc"><div class="wh"><div><h4>Rental R-1042</h4><small>Tesla Model 3 · Maya Okafor</small></div><span class="mk ok" id="k-ag">Signed</span></div>
 <div class="doc" style="margin-top:16px"><span class="lbl">Rental agreement</span>${[92,100,84,96,60].map(w=>`<span class="dl" style="width:${w}%"></span>`).join('')}
 <div class="sigw"><div class="sigb"><svg viewBox="0 0 200 56" preserveAspectRatio="xMinYMax meet"><path class="sp" id="k-sig" pathLength="1" d="M6 42 C10 24 15 14 19 17 C23 20 17 40 21 42 C25 44 29 20 33 18 C37 16 33 40 37 42 C41 44 45 27 51 27 C57 27 53 41 59 41 C65 41 65 27 71 29 C75 31 71 45 77 43 C83 41 85 21 91 23 C95 25 89 52 83 54 C79 55 83 45 93 41 C103 37 107 31 113 33 C119 35 115 43 121 41 C127 39 129 31 135 33 C141 35 137 43 145 41" style="stroke-dasharray:1;stroke-dashoffset:0"/><path class="sp" id="k-ul" pathLength="1" d="M34 50 C80 46 128 46 194 36" style="stroke-width:1.6;stroke-dasharray:1;stroke-dashoffset:0"/><circle id="k-halo" r="7" fill="rgb(68 45 215 / .16)" opacity="0"/><circle id="k-pen" r="3.2" fill="#442DD7" opacity="0"/></svg></div><div class="sigc"><span>Maya Okafor</span><span id="k-time">Signed 09:56</span></div></div></div>
 <div class="pane" style="display:flex;align-items:center;gap:12px"><div style="flex:0 0 auto;min-width:118px"><span class="lbl">Lockbox</span><div style="margin-top:4px;font:700 13px var(--sans);white-space:nowrap" id="k-st">Unlocked · 10:02</div></div><div class="pin" id="k-pin">${[4,8,1,7].map(x=>`<span><em>${x}</em></span>`).join('')}</div><span class="lockb on" id="k-lock"><i data-lucide="lock-open"></i></span></div></div></div>`}];
$('#rows').innerHTML=R.map((x,i)=>`<div class="row${i%2?' flip':''}">
<div class="info"><span class="ic"><i data-lucide="${x.ic}"></i></span><h3>${x.t}</h3><p>${x.p}</p><ul>${x.li.map(l=>`<li><b><i data-lucide="check"></i></b>${l}</li>`).join('')}</ul><a class="lk" href="#"><i><i data-lucide="plus"></i></i>Learn more</a></div>
<div class="card">${x.card}</div></div>`).join('');
icons();
const reduce=matchMedia('(prefers-reduced-motion: reduce)').matches;
gsap.registerPlugin(ScrollTrigger);
const rows=$$('.row');

/* entry: card slides in from its side, text from the other */
rows.forEach((row,i)=>{const flip=i%2===1,info=$('.info',row),card=$('.card',row);
 ScrollTrigger.create({trigger:row,start:'top 60%',end:'bottom 40%',toggleClass:{targets:row,className:'on'}});
 if(reduce)return;
 gsap.timeline({scrollTrigger:{trigger:row,start:'top 88%',end:'top 40%',scrub:.8}})
  .fromTo(card,{x:flip?-110:110,y:40,rotate:flip?-3:3,opacity:0},{x:0,y:0,rotate:0,opacity:1,ease:'power2.out'},0)
  .fromTo(info.children,{x:flip?50:-50,opacity:0},{x:0,opacity:1,stagger:.06,ease:'power2.out'},0);
 row.addEventListener('pointermove',e=>{const r=card.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)return;gsap.to(card,{rotateY:((e.clientX-r.left)/r.width-.5)*6,rotateX:-((e.clientY-r.top)/r.height-.5)*6,transformPerspective:1400,duration:.6,ease:'power2.out'});});
 row.addEventListener('pointerleave',()=>gsap.to(card,{rotateY:0,rotateX:0,duration:.8,ease:'power3.out'}));});

/* live loops — each starts with an "open" reveal, then keeps working while on screen */
const WF=$('.wf');
function note(){}
note(0,'globe','var(--p)','Booked on your site','northwind.drive-247.com · 24/7',1);note(1,'zap','#635bff','Paid via Stripe','Maya Okafor · $300.00',1);note(2,'badge-check','var(--clear)','Verified in 38s','Ready for pickup',1);note(3,'message-square','#14131c','Code sent by SMS','to Maya · +1 •••• 4417',1);
const pop=el=>{el.classList.remove('pop');void el.offsetWidth;el.classList.add('pop');};
function pushRow(list,html,keep){list.insertAdjacentHTML('afterbegin',html);const n=list.firstElementChild;n.classList.add('in','new');requestAnimationFrame(()=>requestAnimationFrame(()=>n.classList.remove('in')));setTimeout(()=>{while(list.children.length>keep)list.lastElementChild.remove();},650);setTimeout(()=>n.classList.remove('new'),2200);}
const LOOPS=[
 S=>{const bks=$$('#cal .bk:not(.ph):not([data-ph])'),ph=$('#cal [data-ph]')||$('#cal .bk.ph'),c=$('#b-c'),sub=$('#b-sub');ph.dataset.ph='1';
  const Q=[['Leo K.','#0090ff','Lexus RX 350 · Fri – Sat'],['Sara N.','#8e4ec6','Lexus RX 350 · Fri – Sun'],['Aisha B.','#f76b15','Lexus RX 350 · Sat – Sun']];let k=0;
  gsap.fromTo(bks,{scaleX:0},{scaleX:1,duration:.7,ease:'power3.out',stagger:.12});
  const run=()=>{const q=Q[k++%Q.length];ph.className='bk ph';ph.textContent='';ph.style.background='';sub.textContent='4 cars · 5 bookings';
   gsap.fromTo(ph,{opacity:0},{opacity:1,duration:.3});
   S.after(1300,()=>{ph.className='bk';ph.style.background=q[1];ph.textContent=q[0];gsap.fromTo(ph,{scaleX:0},{scaleX:1,duration:.6,ease:'power3.out'});sub.textContent='4 cars · 6 bookings';note(0,'check','var(--clear)','Booking confirmed',q[0]+' · '+q[2]);});
   S.after(4200,()=>gsap.to(ph,{opacity:0,duration:.35,onComplete:()=>S.after(200,run)}));};
  S.after(900,run);},
 S=>{const bars=$('#p-bars'),big=$('#p-big'),L=$('#p-l'),c=$('#p-c');let total=12480,k=0;
  gsap.fromTo($$('i',bars),{scaleY:0},{scaleY:1,duration:.7,ease:'power3.out',stagger:.04});
  const o={v:0};gsap.to(o,{v:total,duration:1.2,ease:'power2.out',onUpdate:()=>big.textContent=money(Math.round(o.v))});
  const N=[['Priya Shah','Rental R-1039',389,'Paid','var(--clear)'],['Leo Kim','Deposit · Stripe',300,'Held','var(--p)'],['Aisha Bello','Extension · 1 day',139,'Paid','var(--clear)'],['Sara Novak','Rental R-1044',612,'Paid','var(--clear)']];
  S.every(3200,()=>{const n=N[k%N.length];const bs=$$('i',bars),hs=bs.map(b=>b.style.getPropertyValue('--h'));bs.forEach((b,j)=>b.style.setProperty('--h',j<bs.length-1?hs[j+1]:(62+Math.random()*38).toFixed(0)+'%'));
   const from=total;total=total>16000?12480:total+n[2];const p={v:from};gsap.to(p,{v:total,duration:.9,ease:'power2.out',onUpdate:()=>big.textContent=money(Math.round(p.v))});
   pushRow(L,payRow(n[0],n[1],money(n[2])+'.00',n[3],n[4],k+3),3);note(1,'zap','#635bff','Paid via Stripe',n[0]+' · '+money(n[2])+'.00 · just now');k++;});},
 S=>{const rs=$$('.d-r'),c=$('#d-c'),scan=$('#d-scan'),ring=$('#d-ring'),pct=$('#d-pct'),btn=$('#d-btn');const D=[['Priya Shah','PS'],['Leo Kim','LK'],['Aisha Bello','AB'],['Jonas Weber','JW']];let k=0;
  const run=()=>{const d=D[k++%D.length];$('#d-who').textContent=d[0];$('#d-ini').textContent=d[1];btn.classList.remove('go');
   rs.forEach(r=>{const m=$('.mk',r);m.className='mk g';m.textContent='Waiting';});note(2,'scan-face','var(--wait)','Checking '+d[0],'Licence · selfie · blocklist · age');
   const pr={v:0};ring.style.strokeDashoffset=100;pct.textContent='0%';
   gsap.fromTo(scan,{top:0,opacity:1},{top:'100%',duration:.9,repeat:2,yoyo:true,ease:'power1.inOut',onComplete:()=>gsap.to(scan,{opacity:0,duration:.2})});
   rs.forEach((r,i)=>{S.after(300+i*650,()=>{const m=$('.mk',r);m.className='mk w';m.innerHTML='<span class="spin"></span>Checking';});
    S.after(850+i*650,()=>{const m=$('.mk',r);m.className='mk ok';m.textContent=m.dataset.ok;gsap.to(pr,{v:(i+1)*25,duration:.4,onUpdate:()=>{ring.style.strokeDashoffset=100-pr.v;pct.textContent=Math.round(pr.v)+'%';}});});});
   S.after(850+3*650+350,()=>{btn.classList.add('go');note(2,'badge-check','var(--clear)','Verified in 38s',d[0]+' · ready for pickup');});
   S.after(6400,run);};
  run();},
 S=>{const ul=$('#k-ul'),pen=$('#k-pen'),halo=$('#k-halo'),sig=$('#k-sig'),dls=$$('.doc .dl'),ag=$('#k-ag'),pins=$$('#k-pin span'),lock=$('#k-lock'),st=$('#k-st'),c=$('#k-c');let hh=9,mm=58;
  const run=()=>{gsap.set(dls,{scaleX:0});sig.style.strokeDashoffset=1;ul.style.strokeDashoffset=1;$('#k-time').textContent='Awaiting signature';ag.className='mk w';ag.innerHTML='<span class="spin"></span>Signing';
   pins.forEach(p=>{p.textContent='';p.classList.remove('f','cur');});lock.classList.remove('on');lock.innerHTML=svgI('lock',18);st.textContent='Locked · waiting';note(3,'pen-line','var(--p)','Waiting for signature','Sent to Maya by email');
   gsap.to(dls,{scaleX:1,duration:.5,ease:'power2.out',stagger:.1});
   S.after(700,()=>{const L=sig.getTotalLength(),o={p:0};gsap.set([pen,halo],{attr:{opacity:1}});
    gsap.to(o,{p:1,duration:1.7,ease:'sine.inOut',onUpdate:()=>{sig.style.strokeDashoffset=1-o.p;const pt=sig.getPointAtLength(L*o.p);pen.setAttribute('cx',pt.x);pen.setAttribute('cy',pt.y);halo.setAttribute('cx',pt.x);halo.setAttribute('cy',pt.y);},
     onComplete:()=>{const L2=ul.getTotalLength(),q={p:0};gsap.to(q,{p:1,duration:.4,ease:'power2.out',onUpdate:()=>{ul.style.strokeDashoffset=1-q.p;const pt=ul.getPointAtLength(L2*q.p);pen.setAttribute('cx',pt.x);pen.setAttribute('cy',pt.y);halo.setAttribute('cx',pt.x);halo.setAttribute('cy',pt.y);},onComplete:()=>gsap.to([pen,halo],{attr:{opacity:0},duration:.25})});}});});
   S.after(2900,()=>{ag.className='mk ok';ag.textContent='Signed';$('#k-time').textContent=`Signed ${String(hh).padStart(2,'0')}:${String((mm+56)%60).padStart(2,'0')}`;});
   const code=String(1000+Math.floor(Math.random()*9000)).split('');pins[0].classList.add('cur');
   code.forEach((d,i)=>S.after(3300+i*240,()=>{pins[i].classList.remove('cur');pins[i].innerHTML='<em>'+d+'</em>';pins[i].classList.add('f');if(pins[i+1])pins[i+1].classList.add('cur');}));
   S.after(4400,()=>{note(3,'message-square','#14131c','Code sent by SMS','to Maya · +1 •••• 4417');st.textContent='Code sent · waiting';});
   S.after(5600,()=>{mm=(mm+4)%60;if(mm<4)hh++;lock.classList.add('on');lock.innerHTML=svgI('lock-open',18);st.textContent=`Unlocked · ${String(hh).padStart(2,'0')}:${String(mm).padStart(2,'0')}`;});
   S.after(8600,run);};
  run();}];
function scheduler(){const T=new Set(),I=new Set();return{after(ms,f){const id=setTimeout(()=>{T.delete(id);f();},ms);T.add(id);},every(ms,f){const id=setInterval(f,ms);I.add(id);},stop(){T.forEach(clearTimeout);I.forEach(clearInterval);T.clear();I.clear();}};}
if(!reduce){rows.forEach((row,i)=>{let S=null;new IntersectionObserver(([e])=>{if(e.isIntersecting&&!S){S=scheduler();S.after(500,()=>LOOPS[i](S));}else if(!e.isIntersecting&&S){S.stop();S=null;}},{threshold:.3}).observe($('.card',row));});}

icons();
const L=window.__d247Lenis;if(L)L.on('scroll',ScrollTrigger.update);
new MutationObserver(()=>{if(!document.body.classList.contains('sealed'))setTimeout(()=>ScrollTrigger.refresh(),1300);}).observe(document.body,{attributes:true,attributeFilter:['class']});
};
ln.onload=start;ln.onerror=start;})();
  }

}
