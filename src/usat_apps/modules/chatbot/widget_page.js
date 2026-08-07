'use strict';
// Self-contained HTML for the embeddable public chatbot widget (served by public.js at
// /api/public-chatbot/widget and embedded via <iframe>). No external dependencies, no build step: inline CSS
// + JS. It renders a floating bubble that POSTs to /api/public-chatbot/ask (same-origin inside the iframe).
// Analytics: it emits events to the PARENT page via postMessage AND pushes to its own dataLayer, so GA4/GTM
// can track opens/questions/answers/errors. Config (queue, theme) is injected server-side.

function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]; }); }

// Bubble (FAB) styles the visitor sees. All keep the same 56px size/position so the resizer + open/close
// still work; the difference is only the glyph + animation. Cycling styles (triathlon/emoji) are driven by
// JS so hover-to-speed-up and click-to-freeze are exact; ath/speedlines are CSS animations paused on open.
const BUBBLES = ['plain', 'triathlon', 'athlete', 'speedlines', 'emoji', 'random'];
function fab_inner(style) {
  var SWIM = '&#127946;', BIKE = '&#128692;', RUN = '&#127939;', CHAT = '&#128172;';   // 🏊 🚴 🏃 💬 (entities avoid encoding issues)
  if (style === 'triathlon') return '<span class="cyc"><span>' + SWIM + '</span><span>' + BIKE + '</span><span>' + RUN + '</span></span>';
  if (style === 'emoji') return '<span class="cyc soft"><span>' + SWIM + '</span><span>' + BIKE + '</span><span>' + RUN + '</span></span>';
  if (style === 'athlete') return '<span class="ath">' + RUN + '</span>';
  if (style === 'speedlines') return '<span class="spd"><i></i><i></i><i></i><b>' + BIKE + '</b></span>';
  return '<span class="plain">' + CHAT + '</span>';
}

// Accent color. USAT blue by default; a valid #RGB/#RRGGBB `color` param overrides it (bubble + header +
// send button + user message). We lighten it for dark mode so a dark brand color still reads on a dark bg.
const DEFAULT_ACCENT = '#152C53';   // USAT blue
function norm_hex(s) {
  var v = String(s == null ? '' : s).trim();
  if (v && v.charAt(0) !== '#') v = '#' + v;
  if (/^#[0-9a-fA-F]{3}$/.test(v)) v = '#' + v[1] + v[1] + v[2] + v[2] + v[3] + v[3];
  return /^#[0-9a-fA-F]{6}$/.test(v) ? v.toUpperCase() : null;
}
function lighten(hex, amt) {
  var m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex); if (!m) return hex;
  var f = function (h) { var x = parseInt(h, 16); x = Math.round(x + (255 - x) * amt); return ('0' + x.toString(16)).slice(-2); };
  return '#' + f(m[1]) + f(m[2]) + f(m[3]);
}

// Client-side helpers (injected into the widget via .toString()): escape HTML, then render a safe subset of
// Markdown — links [label](url) + bare http(s) URLs into anchors, plus **bold** and *italic*. Escaping runs
// FIRST and we only emit tags we build ourselves (http/https anchors, <strong>/<em>) — no HTML injection.
function _wesc(s) { return String(s).replace(/[&<>"']/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]; }); }
function _wlink(t) {
  var out = _wesc(t);
  out = out.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, function (m, l, u) { return '<a href="' + u + '" target="_blank" rel="noopener noreferrer">' + l + '</a>'; });
  out = out.replace(/(^|[^"'>])(https?:\/\/[^\s<]+)/g, function (m, pre, u) { var tr = ''; var mm = /[.,!?;:)]+$/.exec(u); if (mm) { tr = mm[0]; u = u.slice(0, -tr.length); } return pre + '<a href="' + u + '" target="_blank" rel="noopener noreferrer">' + u + '</a>' + tr; });
  out = out.replace(/\*\*([^*\n]+)\*\*/g, function (m, x) { return '<strong>' + x + '</strong>'; });   // **bold**
  out = out.replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, function (m, pre, x) { return pre + '<em>' + x + '</em>'; });   // *italic*
  return out;
}

function render(opts) {
  const o = opts || {};
  const accent = norm_hex(o.color) || DEFAULT_ACCENT;
  const accentDark = lighten(accent, 0.30);   // readable on the dark bg
  const cfg = { queue: String(o.queue || 'Team USA'), handle: String(o.handle || 'default'), endpoint: '/api/public-chatbot/ask', theme: o.theme === 'dark' ? 'dark' : 'light', bubble: BUBBLES.indexOf(o.bubble) >= 0 ? o.bubble : 'plain' };
  const CLIENT = [
    "(function(){",
    "  var CFG = window.__USAT_CFG__ || {};",
    "  var q = CFG.queue || 'Team USA';",
    "  var els = {};",
    "  function $(id){ return document.getElementById(id); }",
    "  function greeting(){ return 'Hi! Ask me anything about the ' + q + ' program.'; }",
    "  function buildFab(style){ var S='&#127946;',B='&#128692;',R='&#127939;',C='&#128172;';",
    "    if(style==='triathlon') return '<span class=\"cyc\"><span>'+S+'</span><span>'+B+'</span><span>'+R+'</span></span>';",
    "    if(style==='emoji') return '<span class=\"cyc soft\"><span>'+S+'</span><span>'+B+'</span><span>'+R+'</span></span>';",
    "    if(style==='athlete') return '<span class=\"ath\">'+R+'</span>';",
    "    if(style==='speedlines') return '<span class=\"spd\"><i></i><i></i><i></i><b>'+B+'</b></span>';",
    "    return '<span class=\"plain\">'+C+'</span>'; }",
    "  var state = { open:false, cid:null, turn:0, sending:false, msgs:[] };",
    "  var cyc=false, cycStart=function(){}, cycStop=function(){};",   // bubble-cycle control (assigned on load)
    "  // Analytics: notify the parent page (GTM/GA4 lives there) + push to a local dataLayer as a fallback.",
    "  function track(event, detail){",
    "    try { window.parent && window.parent.postMessage({ source:'usat-chatbot', event:event, detail:detail||{} }, '*'); } catch(e){}",
    "    try { window.dataLayer = window.dataLayer || []; window.dataLayer.push(Object.assign({ event:event }, detail||{})); } catch(e){}",
    "  }",
    "  function scroll(){ if(els.body) els.body.scrollTop = els.body.scrollHeight; }",
    _wesc.toString(),
    _wlink.toString(),
    "  function bubble(m){ var d=document.createElement('div'); d.className='msg '+m.role; if(m.role==='bot'){ d.innerHTML=_wlink(m.text); } else { d.textContent=m.text; } els.body.appendChild(d); scroll(); }",
    "  function render(){ els.body.innerHTML=''; state.msgs.forEach(bubble); }",
    "  function openPanel(){ state.open=true; els.panel.style.display='flex'; els.fab.setAttribute('aria-expanded','true'); els.fab.classList.add('usat-frozen'); cycStop();",
    "    if(!state.msgs.length){ state.msgs.push({role:'bot',text:greeting()}); render(); } track('chatbot_open',{queue:q}); }",
    "  function closePanel(){ state.open=false; els.panel.style.display='none'; els.fab.setAttribute('aria-expanded','false'); els.fab.classList.remove('usat-frozen'); if(cyc) cycStart(); track('chatbot_close',{queue:q}); }",
    "  function reset(){ state.cid=null; state.turn=0; state.msgs=[{role:'bot',text:greeting()}]; render(); }",
    "  function send(){",
    "    var text=(els.input.value||'').trim(); if(!text||state.sending) return;",
    "    els.input.value=''; state.msgs.push({role:'user',text:text}); render();",
    "    state.sending=true; els.send.disabled=true;",
    "    var typing={role:'bot',text:'…'}; state.msgs.push(typing); render();",
    "    track('chatbot_ask',{queue:q});",
    "    var payload={ message:text, w:CFG.handle, conversation_id:state.cid, turn:state.turn, history:state.msgs.slice(-7,-1).map(function(m){return {role:m.role,text:m.text};}), intro: state.turn===0 ? greeting() : undefined };",
    "    fetch(CFG.endpoint,{ method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(payload) })",
    "      .then(function(r){ return r.json().catch(function(){return {};}).then(function(j){ return {ok:r.ok,j:j}; }); })",
    "      .then(function(res){",
    "        state.msgs.pop();",
    "        if(res.ok && res.j && res.j.answer!=null){ if(res.j.conversation_id) state.cid=res.j.conversation_id; state.turn+=1; state.msgs.push({role:'bot',text:res.j.answer||'(no answer)'}); track('chatbot_answer',{queue:q}); }",
    "        else { state.msgs.push({role:'bot',text: (res.j && res.j.error) ? res.j.error : 'Sorry — something went wrong.'}); track('chatbot_error',{queue:q}); }",
    "        render();",
    "      })",
    "      .catch(function(){ state.msgs.pop(); state.msgs.push({role:'bot',text:'Sorry — I could not reach the assistant.'}); track('chatbot_error',{queue:q}); render(); })",
    "      .then(function(){ state.sending=false; els.send.disabled=false; els.input.focus(); });",
    "  }",
    "  document.addEventListener('DOMContentLoaded',function(){",
    "    els.fab=$('usat-fab'); els.panel=$('usat-panel'); els.body=$('usat-body'); els.input=$('usat-input'); els.send=$('usat-send');",
    "    var bub=CFG.bubble||'plain';",
    "    if(bub==='random'){ var pool=['triathlon','athlete','speedlines','emoji']; bub=pool[Math.floor(Math.random()*pool.length)]; els.fab.innerHTML=buildFab(bub); els.fab.setAttribute('data-bubble',bub); }",
    "    cyc=(bub==='triathlon'||bub==='emoji');",
    "    if(cyc){ var spans=els.fab.querySelectorAll('.cyc>span'), idx=0, timer=null;",
    "      var showIdx=function(){ for(var i=0;i<spans.length;i++){ spans[i].style.opacity=(i===idx)?'1':'0'; } };",
    "      cycStart=function(){ cycStop(); var base=(bub==='emoji')?1500:1200; var ms=els.fab.classList.contains('usat-fast')?Math.round(base*0.42):base; timer=setInterval(function(){ idx=(idx+1)%spans.length; showIdx(); }, ms); };",
    "      cycStop=function(){ if(timer){ clearInterval(timer); timer=null; } };",
    "      showIdx(); cycStart(); }",
    "    els.fab.addEventListener('mouseenter',function(){ els.fab.classList.add('usat-fast'); if(cyc) cycStart(); });",
    "    els.fab.addEventListener('mouseleave',function(){ els.fab.classList.remove('usat-fast'); if(cyc) cycStart(); });",
    "    els.fab.addEventListener('click',function(){ state.open?closePanel():openPanel(); });",
    "    $('usat-x').addEventListener('click',closePanel);",
    "    $('usat-reset').addEventListener('click',reset);",
    "    els.send.addEventListener('click',send);",
    "    els.input.addEventListener('keydown',function(e){ if(e.key==='Enter' && !e.shiftKey){ e.preventDefault(); send(); } });",
    "  });",
    "})();"
  ].join("\n");

  return [
    '<!DOCTYPE html>',
    '<html lang="en" data-theme="' + esc(cfg.theme) + '">',
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    '<title>USA Triathlon assistant</title>',
    '<style>',
    ':root{--bg:#fff;--ink:#1f2937;--dim:#6b7280;--line:#e4e7ec;--accent:#152C53;--bot:#f3f4f6;--user:#152C53;--userink:#fff;}',
    '[data-theme="dark"]{--bg:#0f172a;--ink:#e5e7eb;--dim:#9aa4b2;--line:#334155;--accent:#3A5A8C;--bot:#1e293b;--user:#3A5A8C;--userink:#fff;}',
    '*{box-sizing:border-box}',
    'html,body{margin:0;height:100%;background:transparent;font:14px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;color:var(--ink)}',
    '.usat-fab{position:fixed;right:16px;bottom:16px;width:56px;height:56px;border-radius:50%;border:0;cursor:pointer;background:var(--accent);color:#fff;font-size:24px;box-shadow:0 6px 20px rgba(0,0,0,.25);z-index:2;display:flex;align-items:center;justify-content:center;overflow:hidden}',
    '.usat-fab:hover{transform:scale(1.05)}',
    '.usat-fab .cyc{position:relative;width:28px;height:28px;display:inline-block}',
    '.usat-fab .cyc>span{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:24px;opacity:0}',
    '.usat-fab .cyc>span:first-child{opacity:1}',
    '.usat-fab .cyc.soft>span{transition:opacity .45s ease}',
    '.usat-fab .plain{font-size:24px;line-height:1;display:inline-flex;align-items:center;justify-content:center}',
    '.usat-fab .ath{font-size:24px;display:inline-block;transform-origin:50% 85%;animation:usatRun .62s ease-in-out infinite}',
    '.usat-fab:hover .ath{animation-duration:.34s}',
    '@keyframes usatRun{0%,100%{transform:translateY(1px) rotate(-6deg)}50%{transform:translateY(-3px) rotate(6deg)}}',
    '.usat-fab .spd{position:relative;display:inline-block;width:30px;height:26px}',
    '.usat-fab .spd>b{font-size:24px;font-weight:400;position:absolute;right:0;top:50%;transform:translateY(-50%)}',
    '.usat-fab .spd>i{position:absolute;left:-2px;height:2px;width:9px;border-radius:2px;background:rgba(255,255,255,.9);opacity:0;animation:usatSpd 1s linear infinite}',
    '.usat-fab .spd>i:nth-child(1){top:7px}.usat-fab .spd>i:nth-child(2){top:13px;animation-delay:.33s}.usat-fab .spd>i:nth-child(3){top:19px;animation-delay:.66s}',
    '.usat-fab:hover .spd>i{animation-duration:.5s}',
    '@keyframes usatSpd{0%{transform:translateX(6px);opacity:0}30%{opacity:1}100%{transform:translateX(-10px);opacity:0}}',
    '.usat-fab.usat-frozen .ath,.usat-fab.usat-frozen .spd>i{animation-play-state:paused}',
    '@media (prefers-reduced-motion:reduce){.usat-fab .ath,.usat-fab .spd>i{animation:none}}',
    '.usat-panel{position:fixed;right:16px;bottom:84px;width:min(380px,calc(100vw - 32px));height:min(560px,calc(100vh - 110px));background:var(--bg);border:1px solid var(--line);border-radius:14px;box-shadow:0 12px 40px rgba(0,0,0,.28);display:none;flex-direction:column;overflow:hidden;z-index:2}',
    '.usat-head{display:flex;align-items:center;gap:8px;padding:12px 14px;background:var(--accent);color:#fff}',
    '.usat-head b{font-size:14px}.usat-head .sub{font-size:11px;opacity:.9}',
    '.usat-head .sp{margin-left:auto;display:flex;gap:4px}',
    '.usat-hbtn{border:0;background:rgba(255,255,255,.15);color:#fff;width:26px;height:26px;border-radius:7px;cursor:pointer;font-size:14px}',
    '.usat-body{flex:1;overflow:auto;padding:12px;display:flex;flex-direction:column;gap:8px;background:var(--bg)}',
    '.msg{max-width:82%;padding:8px 11px;border-radius:12px;white-space:pre-wrap;word-wrap:break-word}',
    '.msg.bot{align-self:flex-start;background:var(--bot);color:var(--ink);border-bottom-left-radius:4px}',
    '.msg.user{align-self:flex-end;background:var(--user);color:var(--userink);border-bottom-right-radius:4px}',
    '.msg a{word-break:break-word}',
    '.msg.bot a{color:var(--accent);text-decoration:underline}',
    '.msg.user a{color:#fff;text-decoration:underline}',
    '.usat-input{display:flex;gap:8px;padding:10px;border-top:1px solid var(--line);background:var(--bg)}',
    '.usat-input textarea{flex:1;resize:none;border:1px solid var(--line);border-radius:9px;padding:8px 10px;font:inherit;background:var(--bg);color:var(--ink);max-height:110px}',
    '.usat-input button{border:0;background:var(--accent);color:#fff;border-radius:9px;padding:0 14px;cursor:pointer;font-weight:600}',
    '.usat-input button:disabled{opacity:.5;cursor:default}',
    '.usat-foot{font-size:10px;color:var(--dim);text-align:center;padding:4px 0 8px;background:var(--bg)}',
    '</style>',
    '<style>:root{--accent:' + accent + ';--user:' + accent + '}[data-theme="dark"]{--accent:' + accentDark + ';--user:' + accentDark + '}</style>',
    '</head>',
    '<body>',
    '<div class="usat-panel" id="usat-panel" role="dialog" aria-label="USA Triathlon assistant">',
    '  <div class="usat-head"><div><b>USA Triathlon</b><div class="sub">' + esc(cfg.queue) + ' assistant</div></div>',
    '    <div class="sp"><button class="usat-hbtn" id="usat-reset" title="New conversation" aria-label="New conversation">&#8635;</button>',
    '    <button class="usat-hbtn" id="usat-x" title="Close" aria-label="Close">&times;</button></div></div>',
    '  <div class="usat-body" id="usat-body"></div>',
    '  <div class="usat-input"><textarea id="usat-input" rows="1" placeholder="Ask a question…"></textarea><button id="usat-send">Send</button></div>',
    '  <div class="usat-foot">Answers from USA Triathlon\'s published info. This assistant is in training — chats are recorded to improve it.</div>',
    '</div>',
    '<button class="usat-fab" id="usat-fab" data-bubble="' + esc(cfg.bubble) + '" aria-label="Open the USA Triathlon assistant" aria-expanded="false">' + fab_inner(cfg.bubble) + '</button>',
    '<script>window.__USAT_CFG__=' + JSON.stringify(cfg) + ';</script>',
    '<script>' + CLIENT + '</script>',
    '</body>',
    '</html>',
  ].join('\n');
}

// The GTM loader script (served at /api/public-chatbot/widget.js). Pasted into a GTM Custom HTML tag as
// <script async src=".../widget.js" data-theme="light"></script>, it injects the widget IFRAME + a resizer
// that grows/shrinks it on open/close, and forwards events to the host page's dataLayer (for GA4). This gives
// GTM/script delivery while keeping iframe isolation (the API call stays same-origin inside the iframe).
function render_loader() {
  return [
    "(function(){",
    "  var me = document.currentScript;",
    "  if(!me){ var ss=document.getElementsByTagName('script'); me=ss[ss.length-1]; }",
    "  var origin=''; try{ origin=new URL(me.src).origin; }catch(e){}",
    "  var handle=me.getAttribute('data-widget')||me.getAttribute('data-handle')||'';",
    "  var theme=(me.getAttribute('data-theme')==='dark')?'dark':(me.getAttribute('data-theme')==='light'?'light':'');",
    "  var bubble=me.getAttribute('data-bubble')||'';",
    "  var color=me.getAttribute('data-color')||'';",
    "  if(document.getElementById('usat-bot')) return;",
    "  var f=document.createElement('iframe');",
    "  f.id='usat-bot'; f.title='USA Triathlon assistant'; f.allow='clipboard-write';",
    "  f.src=origin+'/api/public-chatbot/widget?w='+encodeURIComponent(handle||'default')+(theme?('&theme='+theme):'')+(bubble?('&bubble='+encodeURIComponent(bubble)):'')+(color?('&color='+encodeURIComponent(color)):'');",
    "  f.setAttribute('style','position:fixed;right:12px;bottom:12px;width:84px;height:84px;border:0;z-index:2147483000;background:transparent;transition:width .15s,height .15s;color-scheme:normal;');",
    "  (document.body||document.documentElement).appendChild(f);",
    "  window.addEventListener('message',function(e){",
    "    if(!e.data||e.data.source!=='usat-chatbot')return;",
    "    if(e.data.event==='chatbot_open'){ f.style.width='min(396px,100vw)'; f.style.height='min(600px,100vh)'; }",
    "    if(e.data.event==='chatbot_close'){ f.style.width='84px'; f.style.height='84px'; }",
    "    try{ window.dataLayer=window.dataLayer||[]; window.dataLayer.push({event:e.data.event}); }catch(_){}",
    "  });",
    "})();",
  ].join("\n");
}

module.exports = { render, render_loader };
