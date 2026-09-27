/* Ismaili Guide — chat, learn, glossary. Everything runs on the phone. */
(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  var KB = null, ENGINE = null;

  var TOPICS = [
    ['faq', 'Start with the basics'],
    ['history', 'History'],
    ['imams', 'The Imams'],
    ['theology', 'Beliefs & ideas'],
    ['practice', 'Practice & daily life'],
    ['institutions', 'Institutions & AKDN'],
    ['community', 'The community today'],
    ['branches', 'Branches & other Muslims']
  ];
  var TOPIC_LABEL = {};
  TOPICS.forEach(function (t) { TOPIC_LABEL[t[0]] = t[1]; });
  TOPIC_LABEL.glossary = 'Glossary';

  var STARTERS = [
    'Who are the Ismailis?',
    'Who is the Aga Khan?',
    'What is a Jamatkhana?',
    'What does Imamat mean?',
    'Who were the Fatimids?',
    'What is the Aga Khan Development Network?'
  ];

  /* Netlify injects a floating "Powered by Netlify" badge that sits over the
     chat box. Its script skips the badge when this dismissal flag is set, and
     it runs after this file, so setting the flag here keeps it away. */
  try { localStorage.setItem('nl-hud:public:v1', 'hidden'); } catch (e) {}

  /* ------------------------------------------------------------ storage */
  /* Local storage can be missing (private windows) — the app must still work. */
  function load(key, fallback) {
    try { var v = localStorage.getItem('ig.' + key); return v ? JSON.parse(v) : fallback; }
    catch (e) { return fallback; }
  }
  function save(key, val) {
    try { localStorage.setItem('ig.' + key, JSON.stringify(val)); } catch (e) {}
  }

  var chat = load('chat', []);
  var readIds = new Set(load('read', []));
  var last = { id: null, hits: [], shown: [] };

  /* ------------------------------------------------------------ helpers */
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function paras(text) {
    return String(text || '').split(/\n\s*\n/).map(function (p) {
      return '<p>' + esc(p.trim()).replace(/\n/g, '<br>') + '</p>';
    }).join('');
  }
  function host(url) {
    try { return new URL(url).hostname.replace(/^www\./, ''); } catch (e) { return ''; }
  }
  function sourcesHtml(e) {
    if (!e.sources || !e.sources.length) return '';
    return '<div class="sources"><div class="label">Sources</div><ol>' + e.sources.map(function (s) {
      return '<li><a href="' + esc(s.url) + '" target="_blank" rel="noopener">' + esc(s.title || s.url) + '</a>' +
        '<span class="pub">' + esc(s.publisher || host(s.url)) + '</span>' +
        (s.provenance ? '<span class="prov">' + esc(s.provenance) + '</span>' : '') + '</li>';
    }).join('') + '</ol></div>';
  }
  function notesHtml(e) {
    return e.notes ? '<div class="note"><b>Worth knowing:</b> ' + esc(e.notes) + '</div>' : '';
  }
  function el(html) {
    var d = document.createElement('div');
    d.innerHTML = html.trim();
    return d.firstChild;
  }

  /* --------------------------------------------------------------- chat */
  var GREET = /^(hi|hello|hey|salaam|salam|assalam\w*|as salam\w*|ya ali madad|yam|good (morning|afternoon|evening))\b/;
  var THANKS = /^(thanks|thank you|thx|shukran|ty)\b/;
  var MORE = /^(tell me more|more|go on|continue|keep going|what else|anything else|and\??|explain more|elaborate)\b/;
  var PRONOUN = /\b(he|him|his|she|her|it|its|they|them|their|that|this|these|those)\b/;

  function reply(q) {
    var n = Engine.norm(q);
    var words = Engine.tokens(q);

    if (GREET.test(n) && words.length <= 3) {
      return { kind: 'text', text: (/ya ali madad|^yam\b/.test(n) ? 'Mowla Ali Madad! ' : 'Hello! ') +
        'Ask me anything about the Ismaili community: its history, beliefs, practices or institutions. ' +
        'Every answer comes with the sources it was drawn from.', chips: STARTERS.slice(0, 4) };
    }
    if (THANKS.test(n) && words.length <= 3) {
      return { kind: 'text', text: "You're welcome. Ask me anything else whenever you like." };
    }
    if (MORE.test(n) && words.length <= 2 && last.id) {
      var next = last.hits.filter(function (id) { return last.shown.indexOf(id) < 0; })[0];
      if (next) {
        last.shown.push(next);
        return { kind: 'answer', id: next, lead: 'Here is a closely related entry:', related: [] };
      }
      return { kind: 'text', text: 'That is everything I have close to that topic. Try the Learn tab to browse by subject.' };
    }

    var ctx = null;
    if (last.id && words.length <= 3 && PRONOUN.test(n)) {
      var prev = ENGINE.byId[last.id];
      if (prev) ctx = Engine.tokens(prev.title).concat(Engine.tokens((prev.keywords || []).slice(0, 3).join(' ')));
    }
    var hits = ENGINE.search(q, { context: ctx });
    var top = hits[0];
    if (!ENGINE.confident(top)) {
      var near = hits.slice(0, 3).map(function (h) { return h.entry.title; });
      return {
        kind: 'text',
        text: "I don't have a sourced answer for that yet, and I won't guess. " +
          (near.length ? 'These entries might be close:' : 'Try rephrasing, or browse the Learn tab.'),
        chips: near,
        miss: true
      };
    }
    var related = hits.slice(1, 8)
      .filter(function (h) { return h.score >= top.score * 0.4 && h.entry.topic !== 'glossary'; })
      .slice(0, 3).map(function (h) { return h.entry.id; });
    last = { id: top.entry.id, hits: hits.slice(1, 8).map(function (h) { return h.entry.id; }), shown: [] };
    return { kind: 'answer', id: top.entry.id, related: related };
  }

  function renderMsg(m) {
    if (m.role === 'user') return el('<div class="msg user"><div class="bubble">' + esc(m.text) + '</div></div>');
    if (m.kind === 'answer') {
      var e = ENGINE.byId[m.id];
      if (!e) return el('<div class="msg bot"><div class="bubble">That entry has been removed in an update.</div></div>');
      var rel = (m.related || []).map(function (id) { return ENGINE.byId[id]; }).filter(Boolean);
      return el('<div class="msg bot"><div class="bubble card">' +
        (m.lead ? '<div class="lead">' + esc(m.lead) + '</div>' : '') +
        '<div class="kicker">' + esc(TOPIC_LABEL[e.topic] || e.topic) + '</div>' +
        '<h3>' + esc(e.title) + '</h3>' + paras(e.answer) + notesHtml(e) + sourcesHtml(e) +
        '<div class="actions">' +
          '<button class="link" data-open="' + esc(e.id) + '">Open in Learn</button>' +
          ('speechSynthesis' in window ? '<button class="link" data-speak="' + esc(e.id) + '">Read aloud</button>' : '') +
        '</div>' +
        (rel.length ? '<div class="chips"><span class="label">Related</span>' + rel.map(function (r) {
          return '<button class="chip" data-ask-id="' + esc(r.id) + '">' + esc(r.title) + '</button>';
        }).join('') + '</div>' : '') +
        '</div></div>');
    }
    return el('<div class="msg bot"><div class="bubble' + (m.miss ? ' miss' : '') + '">' + paras(m.text) +
      (m.chips && m.chips.length ? '<div class="chips">' + m.chips.map(function (c) {
        return '<button class="chip" data-ask="' + esc(c) + '">' + esc(c) + '</button>';
      }).join('') + '</div>' : '') + '</div></div>');
  }

  function renderChat() {
    var box = $('chat');
    box.innerHTML = '';
    if (!chat.length) {
      box.appendChild(el('<div class="welcome">' +
        '<img src="icon-192.png" alt="" width="56" height="56">' +
        '<h2>Learn about the Ismailis</h2>' +
        '<p>Ask a question in your own words. Answers come only from ' + KB.entries.length +
        ' researched entries, each linked to its sources, and the app never makes anything up.</p>' +
        '<div class="chips center">' + STARTERS.map(function (s) {
          return '<button class="chip" data-ask="' + esc(s) + '">' + esc(s) + '</button>';
        }).join('') + '</div></div>'));
    }
    chat.forEach(function (m) { box.appendChild(renderMsg(m)); });
    scrollChat();
  }

  function scrollChat() {
    var box = $('chat');
    var lastMsg = box.lastElementChild;
    if (!lastMsg) return;
    /* Land on the top of a long answer, not its last source link. */
    if (lastMsg.classList.contains('bot') && lastMsg.previousElementSibling) {
      box.scrollTop = lastMsg.previousElementSibling.offsetTop - 8;
    } else {
      box.scrollTop = box.scrollHeight;
    }
  }

  function push(m) {
    chat.push(m);
    if (chat.length > 80) chat = chat.slice(-80);
    save('chat', chat);
    var w = $('chat').querySelector('.welcome');
    if (w) w.remove();
    $('chat').appendChild(renderMsg(m));
  }

  function ask(q) {
    q = String(q || '').trim();
    if (!q) return;
    push({ role: 'user', text: q });
    var r = reply(q);
    r.role = 'bot';
    push(r);
    scrollChat();
  }

  function askEntry(id) {
    var e = ENGINE.byId[id];
    if (!e) return;
    push({ role: 'user', text: e.title });
    last = { id: id, hits: last.hits.filter(function (x) { return x !== id; }), shown: [] };
    push({ role: 'bot', kind: 'answer', id: id, related: [] });
    scrollChat();
  }

  /* -------------------------------------------------------------- voice */
  function speak(id) {
    var e = ENGINE.byId[id];
    if (!e || !('speechSynthesis' in window)) return;
    if (speechSynthesis.speaking) { speechSynthesis.cancel(); return; }
    var u = new SpeechSynthesisUtterance(e.title + '. ' + e.answer.replace(/\n+/g, ' '));
    u.lang = 'en';
    u.rate = 1;
    speechSynthesis.speak(u);
  }

  function setupMic() {
    var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) return;
    var btn = $('btn-mic');
    btn.hidden = false;
    var rec = null;
    btn.addEventListener('click', function () {
      if (rec) { rec.stop(); return; }
      rec = new SR();
      rec.lang = navigator.language || 'en-US';
      rec.interimResults = true;
      rec.onresult = function (ev) {
        var t = '';
        for (var i = 0; i < ev.results.length; i++) t += ev.results[i][0].transcript;
        $('q').value = t;
        if (ev.results[ev.results.length - 1].isFinal) { ask(t); $('q').value = ''; }
      };
      rec.onend = rec.onerror = function () { rec = null; btn.classList.remove('live'); };
      btn.classList.add('live');
      rec.start();
    });
  }

  /* -------------------------------------------------------------- learn */
  var current = null;

  function groups() {
    var g = {};
    KB.entries.forEach(function (e) { (g[e.topic] = g[e.topic] || []).push(e); });
    return g;
  }

  function renderToc() {
    var g = groups();
    var html = '';
    if (KB.path && KB.path.length) {
      html += section('Start here', 'path', KB.path.map(function (id) { return ENGINE.byId[id]; }).filter(Boolean), true);
    }
    TOPICS.forEach(function (t) { if (g[t[0]]) html += section(t[1], t[0], g[t[0]], false); });
    $('toc').innerHTML = html;

    function section(label, key, list, open) {
      var done = list.filter(function (e) { return readIds.has(e.id); }).length;
      return '<details class="topic"' + (open ? ' open' : '') + ' data-key="' + key + '"><summary>' +
        '<span>' + esc(label) + '</span><span class="count">' + done + '/' + list.length + '</span></summary><ul>' +
        list.map(function (e) {
          return '<li><button data-read="' + esc(e.id) + '" data-group="' + key + '" class="' +
            (readIds.has(e.id) ? 'done' : '') + (current === e.id ? ' cur' : '') + '">' + esc(e.title) + '</button></li>';
        }).join('') + '</ul></details>';
    }
  }

  function openEntry(id, group) {
    var e = ENGINE.byId[id];
    if (!e) return;
    current = id;
    readIds.add(id);
    save('read', Array.from(readIds));
    var list = group === 'path' ? KB.path : (groups()[e.topic] || []).map(function (x) { return x.id; });
    var i = list.indexOf(id);
    var prev = list[i - 1], next = list[i + 1];
    $('reader').innerHTML =
      '<button class="back" id="btn-back">‹ All topics</button>' +
      '<div class="kicker">' + esc(TOPIC_LABEL[e.topic] || e.topic) + '</div>' +
      '<h2>' + esc(e.title) + '</h2>' + paras(e.answer) + notesHtml(e) + sourcesHtml(e) +
      '<div class="pager">' +
        (prev ? '<button data-read="' + esc(prev) + '" data-group="' + group + '">‹ ' + esc(ENGINE.byId[prev].title) + '</button>' : '<span></span>') +
        (next ? '<button data-read="' + esc(next) + '" data-group="' + group + '">' + esc(ENGINE.byId[next].title) + ' ›</button>' : '<span></span>') +
      '</div>';
    $('screen-learn').classList.add('reading');
    $('reader').scrollTop = 0;
    window.scrollTo(0, 0);
    renderToc();
    var d = $('toc').querySelector('[data-key="' + group + '"]');
    if (d) d.open = true;
  }

  /* ----------------------------------------------------------- glossary */
  function renderGlossary() {
    var f = Engine.norm($('gl-filter').value);
    var items = KB.entries.filter(function (e) { return e.topic === 'glossary'; })
      .sort(function (a, b) { return Engine.norm(a.title).localeCompare(Engine.norm(b.title)); })
      .filter(function (e) {
        return !f || Engine.norm(e.title + ' ' + (e.keywords || []).join(' ')).indexOf(f) >= 0;
      });
    $('gl-list').innerHTML = items.length ? items.map(function (e) {
      return '<details class="term"><summary>' + esc(e.title) + '</summary>' + paras(e.answer) + sourcesHtml(e) + '</details>';
    }).join('') : '<p class="muted">No matching terms.</p>';
  }

  /* ------------------------------------------------------------- listen */
  var EPISODES = null;

  function fmt(sec) {
    sec = Math.round(sec);
    return Math.floor(sec / 60) + ':' + ('0' + (sec % 60)).slice(-2);
  }

  function renderListen() {
    var box = $('listen');
    if (!EPISODES) {
      box.innerHTML = '<p class="muted">Loading episodes…</p>';
      fetch('episodes.json').then(function (r) { return r.json(); }).then(function (eps) {
        EPISODES = eps; renderListen();
      }).catch(function () {
        box.innerHTML = '<p class="muted">Episodes need an internet connection to load.</p>';
      });
      return;
    }
    box.innerHTML = '<div class="show"><h2>Light Upon Light</h2><p class="muted">A podcast for the curious: the story of ' +
      'the Ismailis, told by two hosts. The voices are synthetic; everything they say comes from the published ' +
      'scholarship listed with each episode.</p></div>' +
      EPISODES.map(function (ep, i) {
        return '<article class="episode" data-ep="' + i + '">' +
          '<div class="kicker">' + Math.round(ep.minutes) + ' min</div>' +
          '<h3>' + esc(ep.title) + '</h3>' +
          (ep.summary ? '<p>' + esc(ep.summary) + '</p>' : '') +
          '<audio controls preload="none" src="' + esc(ep.audio) + '"></audio>' +
          '<details><summary>Chapters</summary><ol class="chapters">' + ep.chapters.map(function (c) {
            return '<li><button data-seek="' + c[0] + '" data-ep-i="' + i + '"><span class="t">' + fmt(c[0]) + '</span>' + esc(c[1]) + '</button></li>';
          }).join('') + '</ol></details>' +
          (ep.sources.length ? '<details><summary>Sources (' + ep.sources.length + ')</summary>' + sourcesHtml(ep) + '</details>' : '') +
          '</article>';
      }).join('');
    box.querySelectorAll('audio').forEach(function (a, i) {
      a.addEventListener('play', function () {
        // One episode at a time, and lock-screen controls with its title.
        box.querySelectorAll('audio').forEach(function (o) { if (o !== a) o.pause(); });
        if ('mediaSession' in navigator) {
          navigator.mediaSession.metadata = new MediaMetadata({
            title: EPISODES[i].title, artist: 'Light Upon Light', album: 'Ismaili Guide',
            artwork: [{ src: 'icon-512.png', sizes: '512x512', type: 'image/png' }]
          });
        }
      });
      // Pick up where you left off.
      var key = 'pos.' + EPISODES[i].id;
      a.addEventListener('loadedmetadata', function () { var p = load(key, 0); if (p > 5 && p < a.duration - 10) a.currentTime = p; });
      a.addEventListener('timeupdate', function () { if (Math.round(a.currentTime) % 5 === 0) save(key, a.currentTime); });
    });
  }

  function seek(i, t) {
    var a = $('listen').querySelectorAll('audio')[i];
    if (!a) return;
    var go = function () { a.currentTime = t; a.play(); };
    if (a.readyState >= 1) go(); else { a.addEventListener('loadedmetadata', go, { once: true }); a.load(); }
  }

  /* -------------------------------------------------------------- about */
  function renderAbout() {
    var urls = new Set(), pubs = {};
    KB.entries.forEach(function (e) {
      (e.sources || []).forEach(function (s) {
        urls.add(s.url);
        var p = s.publisher || host(s.url);
        pubs[p] = (pubs[p] || 0) + 1;
      });
    });
    var topPubs = Object.keys(pubs).sort(function (a, b) { return pubs[b] - pubs[a]; }).slice(0, 12);
    $('about').innerHTML =
      '<h2>About this app</h2>' +
      '<p>Ismaili Guide is an independent learning aid for people who are new to the Ismaili Muslim community. ' +
      'It is <b>not an official publication</b> of the Ismaili Imamat or any Jamati institution. For authoritative guidance, ' +
      'please refer to <a href="https://the.ismaili" target="_blank" rel="noopener">the.ismaili</a> and ' +
      '<a href="https://www.iis.ac.uk" target="_blank" rel="noopener">The Institute of Ismaili Studies</a>.</p>' +
      '<h3>How answers work</h3>' +
      '<p>There is no AI writing answers on the fly. Each answer is an entry researched from published sources, ' +
      'written in plain language, and shown with links to those sources so you can check it. If a question isn\'t ' +
      'covered, the app says so instead of guessing.</p>' +
      '<div class="stats"><div><b>' + KB.entries.length + '</b><span>entries</span></div>' +
      '<div><b>' + urls.size + '</b><span>source pages</span></div>' +
      '<div><b>' + readIds.size + '</b><span>you\'ve read</span></div></div>' +
      '<h3>Most-cited publishers</h3><ul class="pubs">' + topPubs.map(function (p) {
        return '<li>' + esc(p) + ' <span class="muted">' + pubs[p] + '</span></li>';
      }).join('') + '</ul>' +
      '<h3>Your data</h3><p>Everything stays on this phone. There are no accounts and nothing is sent anywhere, ' +
      'except that the microphone button uses your browser\'s speech service.</p>' +
      '<p><button class="btn" id="btn-clear">Clear chat history</button></p>' +
      '<p class="muted small">Knowledge base built ' + esc(KB.built || '') + '.</p>';
  }

  /* ------------------------------------------------------------ updates */
  function banner(text, label, fn) {
    $('banner-text').textContent = text;
    $('banner-btn').textContent = label;
    $('banner-btn').onclick = fn;
    $('banner').hidden = false;
  }

  function setupUpdates() {
    if (!('serviceWorker' in navigator)) return;
    navigator.serviceWorker.register('sw.js').catch(function () {});
    /* A page that was already controlled and gets a new controller means a new
       build took over. The first install also fires this, hence the guard. */
    var wasControlled = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.addEventListener('controllerchange', function () {
      if (!wasControlled) return;
      banner('A new version is ready.', 'Reload', function () { location.reload(); });
    });
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState !== 'visible') return;
      navigator.serviceWorker.getRegistration().then(function (r) { if (r) r.update(); }).catch(function () {});
    });
  }

  /* --------------------------------------------------------------- tabs */
  function goTab(tab) {
    document.querySelectorAll('#tabs button').forEach(function (b) { b.classList.toggle('on', b.dataset.tab === tab); });
    document.querySelectorAll('.screen').forEach(function (s) { s.classList.toggle('on', s.id === 'screen-' + tab); });
    if (tab === 'learn') renderToc();
    if (tab === 'about') renderAbout();
    if (tab === 'listen' && !$('listen').children.length) renderListen();
    save('tab', tab);
  }

  /* --------------------------------------------------------------- init */
  function bind() {
    $('tabs').addEventListener('click', function (ev) {
      var b = ev.target.closest('[data-tab]');
      if (b) goTab(b.dataset.tab);
    });
    $('composer').addEventListener('submit', function (ev) {
      ev.preventDefault();
      var q = $('q').value;
      $('q').value = '';
      ask(q);
    });
    document.addEventListener('click', function (ev) {
      var t = ev.target.closest('[data-ask],[data-ask-id],[data-open],[data-speak],[data-read],[data-seek],#btn-back,#btn-clear');
      if (!t) return;
      if (t.dataset.ask) ask(t.dataset.ask);
      else if (t.dataset.askId) askEntry(t.dataset.askId);
      else if (t.dataset.open) { goTab('learn'); openEntry(t.dataset.open, ENGINE.byId[t.dataset.open].topic); }
      else if (t.dataset.speak) speak(t.dataset.speak);
      else if (t.dataset.read) openEntry(t.dataset.read, t.dataset.group);
      else if (t.dataset.seek) seek(+t.dataset.epI, +t.dataset.seek);
      else if (t.id === 'btn-back') $('screen-learn').classList.remove('reading');
      else if (t.id === 'btn-clear') {
        chat = []; save('chat', chat); last = { id: null, hits: [], shown: [] };
        renderChat(); goTab('ask');
      }
    });
    $('gl-filter').addEventListener('input', renderGlossary);
  }

  function start(kb) {
    KB = kb;
    ENGINE = new Engine(kb.entries);
    window.__engine = ENGINE; // handy from the console when tuning
    bind();
    renderChat();
    renderGlossary();
    $('reader').innerHTML = '<div class="empty"><h2>Pick a topic</h2><p class="muted">Choose an entry from the list. ' +
      'Entries you have read get a tick, so you can work through at your own pace.</p></div>';
    setupMic();
    setupUpdates();
    var tab = load('tab', 'ask');
    if (tab !== 'ask') goTab(tab);
  }

  fetch('kb.json').then(function (r) { return r.json(); }).then(start).catch(function () {
    $('chat').innerHTML = '<div class="welcome"><h2>Couldn\'t load the knowledge base</h2>' +
      '<p>Connect to the internet once so the app can download it; after that it works offline.</p></div>';
  });
})();
