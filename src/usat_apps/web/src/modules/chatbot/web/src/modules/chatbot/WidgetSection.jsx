import { useState, useEffect } from 'react';
import * as store from './lib/store.js';
import { api } from './lib/api.js';
import { WidgetPublicBotsCard, WidgetPreviewCard, WidgetAppearanceCard, WidgetColorCard, WidgetGtmSetupCard, WidgetGtmCard, WidgetEmbedCard, WidgetDevConsoleCard, WidgetReferenceCard } from './components/ChatbotAiPanel.jsx';
import './chatbot.css';

// Chatbot → Public widget. Two-column shell: live preview on the left (with the "open full page" link above
// it) and a right rail. Each PUBLISHED bot is addressed by an opaque handle; the selected bot's config
// (queue / channel / theme / bubble / color / pages) lives HERE so the preview, the styling cards, the GTM
// trigger helper, and the embed all stay in lockstep. The embed carries only the handle (server-resolved).
const DEFAULT_COLOR = '#002A5C';
export default function WidgetSection() {
  const [bots, setBots] = useState({});
  const [queues, setQueues] = useState([]);
  const [handle, setHandle] = useState('default');
  const [queue, setQueue] = useState('');
  const [channel, setChannel] = useState('web-widget');
  const [theme, setTheme] = useState('light');
  const [bubble, setBubble] = useState('triathlon');
  const [color, setColor] = useState(DEFAULT_COLOR);
  const [pagesText, setPagesText] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [reload, setReload] = useState(0);   // bump to refetch the preview after a save

  const base = (import.meta.env.BASE_URL || '/').replace(/\/+$/, '');
  const previewHandle = (bots && Object.prototype.hasOwnProperty.call(bots, handle)) ? handle : 'default';
  // Preview a saved handle's content; theme/bubble/color are passed as cosmetic overrides so the live draft
  // shows before saving. (A brand-new unsaved bot previews the default queue's content with the draft look.)
  const src = base + '/api/public-chatbot/widget?w=' + encodeURIComponent(previewHandle)
    + '&theme=' + theme + '&bubble=' + bubble + '&color=' + encodeURIComponent(color) + (reload ? '&_r=' + reload : '');

  function loadInto(h, map) {
    const b = (map && map[h]) || {};
    setHandle(h);
    setQueue(b.queue || '');
    setChannel(b.channel || 'web-widget');
    setTheme(b.theme === 'dark' ? 'dark' : 'light');
    setBubble(b.bubble || 'triathlon');
    setColor(b.color || DEFAULT_COLOR);
    setPagesText(Array.isArray(b.pages) ? b.pages.join('\n') : '');
  }
  useEffect(function () {
    let live = true;
    (async function () {
      try {
        const r = await api.publicBots();
        if (!live) return;
        setBots(r.bots || {});
        setQueues(r.queues || []);
        loadInto((r.bots && r.bots.default) ? 'default' : (Object.keys(r.bots || {})[0] || 'default'), r.bots || {});
      } catch (e) { if (live) setMsg(e.message || 'Could not load'); }
    })();
    return function () { live = false; };
  }, []);

  const onNew = function () {
    setHandle(''); setQueue((queues[0] && queues[0].key) || ''); setChannel('web-widget');
    setTheme('light'); setBubble('triathlon'); setColor(DEFAULT_COLOR); setPagesText(''); setMsg('');
  };
  const onSave = async function () {
    setBusy(true); setMsg('');
    try {
      const pages = pagesText.split('\n').map(function (s) { return s.trim(); }).filter(Boolean);
      const r = await api.savePublicBot({ handle: handle || 'default', queue: queue, channel: channel, theme: theme, bubble: bubble, color: color, pages: pages });
      setBots(r.bots || {}); setHandle(r.handle);
      setMsg('Saved ✓'); setTimeout(function () { setMsg(''); }, 1800);
      setReload(function (n) { return n + 1; });
    } catch (e) { setMsg(e.message || 'Save failed'); }
    finally { setBusy(false); }
  };
  const onDelete = async function () {
    if (!window.confirm('Delete the "' + handle + '" bot?')) return;
    setBusy(true); setMsg('');
    try { const r = await api.deletePublicBot(handle); setBots(r.bots || {}); loadInto('default', r.bots || {}); setReload(function (n) { return n + 1; }); }
    catch (e) { setMsg(e.message || 'Delete failed'); }
    finally { setBusy(false); }
  };

  // Live-update the shared left rail when the preview logs a new conversation (same-origin postMessage).
  useEffect(function () {
    function onMsg(e) {
      if (e.origin !== window.location.origin) return;
      var d = e.data;
      if (!d || d.source !== 'usat-chatbot' || d.event !== 'chatbot_answer') return;
      setTimeout(function () { store.loadThreads(); }, 1000);
      setTimeout(function () { store.loadThreads(); }, 2600);
    }
    window.addEventListener('message', onMsg);
    return function () { window.removeEventListener('message', onMsg); };
  }, []);

  return (
    <div className="cbx-wrap">
      <div className="cbx-topbar">
        <h2 className="cbx-title">Public widget <span className="cbx-pill">GTM</span></h2>
        <span className="cbx-dim">Embeddable, member-facing bots · handle-addressed · strict grounding · curated knowledge only — no PII</span>
      </div>
      <div className="cbx-main2" style={{ gridTemplateColumns: 'minmax(0,1fr) 420px' }}>
        <div style={{ overflow: 'auto', minHeight: 0, paddingRight: 4 }}>
          <div className="cbx-row-end" style={{ marginBottom: 8 }}>
            <a className="cbx-btn xs" href={src} target="_blank" rel="noreferrer">open full page ↗</a>
          </div>
          <WidgetPreviewCard src={src} theme={theme} />
        </div>
        <aside className="cbx-ai">
          <WidgetPublicBotsCard
            bots={bots} queues={queues} handle={handle} setHandle={setHandle}
            onSelect={function (h) { loadInto(h, bots); }} onNew={onNew}
            queue={queue} setQueue={setQueue} channel={channel} setChannel={setChannel}
            pagesText={pagesText} setPagesText={setPagesText}
            onSave={onSave} onDelete={onDelete} busy={busy} msg={msg} />
          <WidgetAppearanceCard theme={theme} setTheme={setTheme} bubble={bubble} setBubble={setBubble} />
          <WidgetColorCard color={color} setColor={setColor} />
          <WidgetGtmSetupCard handle={handle} pagesText={pagesText} />
          <WidgetGtmCard />
          <WidgetEmbedCard handle={handle} />
          <WidgetDevConsoleCard handle={handle} />
          <WidgetReferenceCard />
        </aside>
      </div>
    </div>
  );
}
