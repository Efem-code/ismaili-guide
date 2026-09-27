/* Answer engine — finds the best sourced entry for a question.

   There is deliberately no language model here. Every reply the app gives is
   an entry from kb.json that a researcher wrote from pages they actually read,
   shown with those pages as links. If nothing matches well enough the app says
   so instead of guessing: for a religion people hold dear, "I don't have a
   sourced answer" is better than a fluent invention.

   Ranking is BM25 across weighted fields (title, keywords and sample questions
   count for more than body text), plus a bonus when the question closely
   resembles one of an entry's sample questions, plus typo tolerance. */
(function () {
  'use strict';

  var STOP = new Set(('a an the and or but of to in on at for from by with about as is are was were be been being ' +
    'do does did done can could would should will shall may might must i me my we our you your he him his she her ' +
    'it its they them their this that these those what which who whom whose when where why how there here ' +
    'tell explain describe please know want learn understand mean means meaning define definition some any ' +
    'if so not no yes than then also very just more most much many really all into up out over under ' +
    'give show let us get got have has had like one whats whos hows wheres thats dont').split(' '));

  /* Phrases people type that should also search for the vocabulary the
     sources use. Keys are normalised text; values are extra query terms. */
  var ALIASES = [
    [/\baga khan\b/, 'imam hazir imamat'],
    [/\bhis highness\b/, 'aga khan imam'],
    [/\b(current|present|living|today s|new) (imam|leader|aga khan)\b/, 'hazir imam rahim aga khan v fiftieth succession'],
    [/\bleader\b/, 'imam'],
    [/\bjk\b|\bjamat khana\b|\bjamaat khana\b/, 'jamatkhana'],
    [/\bmosque\b|\bmasjid\b|\bworship place\b|\bplace of worship\b/, 'jamatkhana'],
    [/\bpray\w*\b|\bnamaz\b|\bnamaaz\b/, 'dua salat prayer'],
    [/\btithe\w*\b|\bdonat\w*\b|\bgiving\b/, 'dasond zakat'],
    [/\bconvert\w*\b|\bjoin\w*\b|\bbecome (an )?ismaili\b/, 'convert conversion become'],
    [/\bassassin\w*\b|\bhashish\w*\b/, 'assassins legend nizari alamut'],
    [/\bbohra\w*\b/, 'bohra musta li tayyibi'],
    [/\bshiite\w*\b|\bshia\w*\b|\bshi a\b/, 'shia'],
    [/\bsunni\w*\b/, 'sunni'],
    [/\bhymn\w*\b|\bsong\w*\b/, 'ginan qasida'],
    [/\btaw?[ei]+l\b|\btaaweel\b|\bta wil\b/, 'tawil interpretation batin esoteric'],
    [/\bnew year\b|\bnowruz\b|\bnauroz\b/, 'navroz'],
    [/\bbirthday\b/, 'salgirah'],
    [/\bhow many\b|\bpopulation\b|\bnumbers?\b/, 'population demographics million'],
    [/\bwomen\b|\bwoman\b|\bgirls?\b|\bfemale\b/, 'women'],
    [/\bgod\b|\ballah\b/, 'allah tawhid god'],
    [/\bmuhammad\b|\bprophet\b/, 'prophet muhammad'],
    [/\bali\b/, 'ali'],
    [/\bdeath\b|\bdied\b|\bpassed away\b|\bfuneral\b/, 'death died funeral'],
    [/\bmarri\w*\b|\bwedding\b/, 'marriage nikah'],
    [/\bfood\b|\bdiet\w*\b|\bpork\b|\balcohol\b|\bdrink\w*\b/, 'dietary alcohol halal'],
    [/\bhello\b/, '']
  ];

  /* Questions whose right answer is obvious to a person but not to word
     matching: "the Aga Khan" today means the present Imam, not the first one
     to hold the title. A pin lifts that entry to the top; the rest of the
     ranking still supplies the related entries. */
  var PINS = [
    [/^(who is|who s|whos|what is) (the |an )?aga khan$/, 'faq-who-is-the-aga-khan'],
    [/\b(current|present|new|today s|todays|50th|fiftieth) (imam|aga khan|leader)\b|\bwho is (the )?(imam|aga khan) (now|today)$|\bwho leads the ismailis\b|\b(prince )?rahim\b|\baga khan v\b/, 'imam-aga-khan-v-biography'],
    [/\b(prince )?karim\b|\baga khan iv\b|\b49th imam\b/, 'imam-aga-khan-iv'],
    [/\b(when|how) did (the )?aga khan( iv)? die\b|\baga khan (death|died|funeral|burial)\b/, 'imam-aga-khan-iv-death-burial'],
    [/\bhow (was|is) (the )?(new )?(imam|aga khan) (chosen|appointed|selected|picked)\b|\bsuccession\b.*\bimam\b/, 'imam-succession-nass'],
    [/\blist of (the )?imams\b|\ball (the )?imams\b/, 'imam-list-nizari-imams'],
    [/^(tell me about|who were|what were|what was) (the )?fatimids?( caliphate| dynasty| empire)?$/, 'hist-fatimid-founding-909'],
    [/^(who was|who is|tell me about) (imam |hazrat )?ali( ibn abi talib)?$/, 'hist-imam-ali'],
    [/^(who are|what are|tell me about) (the )?ismailis?$|^what is ismailism$/, 'faq-who-are-the-ismailis']
  ];

  function norm(s) {
    return String(s || '').toLowerCase()
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/['’‘ʿʾ`´]/g, '')
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
  }

  function stem(t) {
    if (t.length > 5 && /ies$/.test(t)) return t.slice(0, -3) + 'y';
    if (t.length > 5 && /ing$/.test(t)) return t.slice(0, -3);
    if (t.length > 4 && /ed$/.test(t)) return t.slice(0, -2);
    if (t.length > 4 && /es$/.test(t) && !/ies$/.test(t)) return t.slice(0, -2);
    if (t.length > 3 && /s$/.test(t) && !/ss$/.test(t)) return t.slice(0, -1);
    return t;
  }

  function tokens(s, keepStop) {
    var out = [];
    norm(s).split(' ').forEach(function (w) {
      if (!w) return;
      if (!keepStop && (STOP.has(w) || w.length < 2)) return;
      out.push(stem(w));
    });
    return out;
  }

  var FIELDS = { title: 3.0, keywords: 3.0, questions: 2.0, answer: 1.0 };
  var K1 = 1.2, B = 0.6;

  function Engine(entries) {
    this.docs = entries;
    this.byId = {};
    this.df = {};
    this.vocab = [];
    var total = 0, self = this;

    entries.forEach(function (e, i) {
      self.byId[e.id] = e;
      var tf = {}, len = 0;
      var parts = {
        title: e.title,
        keywords: (e.keywords || []).join(' '),
        questions: (e.questions || []).join(' '),
        answer: e.answer
      };
      Object.keys(FIELDS).forEach(function (f) {
        tokens(parts[f]).forEach(function (t) {
          tf[t] = (tf[t] || 0) + FIELDS[f];
          len += FIELDS[f];
        });
      });
      e._tf = tf;
      e._len = len;
      e._qsets = (e.questions || []).concat([e.title]).map(function (q) { return new Set(tokens(q)); });
      e._title = norm(e.title);
      e._tcore = tokens(e.title.replace(/\(.*?\)/g, '').split(/[:,]/)[0]);
      total += len;
      Object.keys(tf).forEach(function (t) { self.df[t] = (self.df[t] || 0) + 1; });
    });
    this.avg = total / Math.max(1, entries.length);
    this.vocab = Object.keys(this.df);
  }

  function editDistance(a, b, max) {
    if (Math.abs(a.length - b.length) > max) return max + 1;
    var prev = [], prev2 = [], cur, i, j;
    for (j = 0; j <= b.length; j++) prev[j] = j;
    for (i = 1; i <= a.length; i++) {
      cur = [i];
      var rowMin = i, prevPrev = prev2;
      for (j = 1; j <= b.length; j++) {
        cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
        // Two letters typed the wrong way round is one slip, so that "kahn"
        // reaches "khan" rather than settling for "kahf".
        if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1])
          cur[j] = Math.min(cur[j], prevPrev[j - 2] + 1);
        if (cur[j] < rowMin) rowMin = cur[j];
      }
      if (rowMin > max) return max + 1;
      prev2 = prev; prev = cur;
    }
    return prev[b.length];
  }

  /* Returns [{term, weight}] for a question: the typed words, alias
     expansions at lower weight, and the closest known word for any typo. */
  Engine.prototype.expand = function (q) {
    var n = ' ' + norm(q) + ' ', terms = {}, self = this;
    function add(t, w) { if (!STOP.has(t) || w >= 1) terms[t] = Math.max(terms[t] || 0, w); }

    tokens(q).forEach(function (t) {
      if (self.df[t]) return add(t, 1);
      // Only treat a word as a typo if it's long enough that a near miss is
      // unlikely to be a different, ordinary English word: at four letters
      // "rain" is one edit from "train", and the question "is it going to
      // rain" was being answered from the knowledge base.
      if (t.length < 4) return;
      var max = t.length >= 8 ? 2 : 1, best = null, bestD = max + 1;
      for (var i = 0; i < self.vocab.length; i++) {
        var v = self.vocab[i];
        if (Math.abs(v.length - t.length) > max) continue;
        var d = editDistance(t, v, max);
        if (d < bestD || (d === bestD && best && self.df[v] > self.df[best])) { bestD = d; best = v; }
      }
      if (best) add(best, 0.8);
    });
    // Remember which alias put a term in, so that a question made entirely of
    // an alias word ("what is taweel") can still count as covered when the
    // expansion lands: the typed word never appears in any entry, so without
    // this it scores well and is then thrown away as unsupported.
    var via = {};
    ALIASES.forEach(function (a, gi) {
      if (!a[0].test(n)) return;
      tokens(a[1]).forEach(function (t) {
        if ((terms[t] || 0) < 0.8 && via[t] === undefined) via[t] = gi;
        add(t, 0.6);
      });
    });
    return Object.keys(terms).map(function (t) {
      return { term: t, weight: terms[t], via: via[t] };
    });
  };

  Engine.prototype.search = function (q, opts) {
    opts = opts || {};
    var terms = this.expand(q), N = this.docs.length, self = this;
    if (opts.context) opts.context.forEach(function (t) {
      if (!terms.some(function (x) { return x.term === t; }) && self.df[t]) terms.push({ term: t, weight: 0.45 });
    });
    if (!terms.length) return [];
    // Match sample questions against the words as corrected, not as typed:
    // otherwise "what is jamatkana" finds the right entry by score and is then
    // rejected because it resembles no known question.
    var typed = new Set(tokens(q));
    // Resemblance to a known question is judged on the words as corrected, so
    // "what is jamatkana" can still match "What is a Jamatkhana?". Coverage
    // below is judged on the words as TYPED, so a question that is mostly
    // about something else (pizza) can't ride in on one lucky match.
    var qset = new Set(terms.filter(function (x) { return x.weight >= 0.8; })
                            .map(function (x) { return x.term; }));
    if (!qset.size) qset = typed;
    var nq = norm(q);
    // Coverage is measured against every word the person typed, so a
    // question that is mostly about something else (pizza) can't ride in on
    // one lucky typo-match.
    var denom = Math.max(typed.size, 1);
    var defining = /^(what is|what s|what are|what does|whats|define|meaning of)\b/.test(nq) && qset.size <= 2;

    var hits = [];
    this.docs.forEach(function (e) {
      if (opts.topic && e.topic !== opts.topic) return;
      var s = 0, matched = 0, groups = {};
      terms.forEach(function (x) {
        var tf = e._tf[x.term];
        if (!tf) return;
        if (x.weight >= 0.8) matched += x.weight;
        else if (x.via !== undefined) groups[x.via] = 1;
        var df = self.df[x.term];
        var idf = Math.log(1 + (N - df + 0.5) / (df + 0.5));
        s += x.weight * idf * (tf * (K1 + 1)) / (tf + K1 * (1 - B + B * e._len / self.avg));
      });
      if (!s) return;
      // An alias that landed stands in for the word the reader actually typed.
      matched += Object.keys(groups).length;
      // Closest sample question, by word overlap.
      var bestJ = 0;
      if (qset.size) e._qsets.forEach(function (set) {
        var inter = 0;
        qset.forEach(function (t) { if (set.has(t)) inter++; });
        var j = inter / (qset.size + set.size - inter);
        if (j > bestJ) bestJ = j;
      });
      s += bestJ * 6;
      if (e._title.length > 3 && (' ' + nq + ' ').indexOf(' ' + e._title + ' ') >= 0) s += 3;
      // Every word of the entry's name is in the question ("Aga Khan University").
      if (e._tcore.length >= 2 && e._tcore.every(function (t) { return qset.has(t); })) s += 2 + e._tcore.length;
      // A glossary card is the right answer to "what is X", a full entry to
      // anything longer.
      if (e.topic === 'glossary') s *= defining ? 1.1 : 0.75;
      hits.push({ entry: e, score: s, overlap: bestJ, coverage: Math.min(1, matched / denom) });
    });
    var pinned = null;
    for (var p = 0; p < PINS.length && !pinned; p++) if (PINS[p][0].test(nq) && this.byId[PINS[p][1]]) pinned = PINS[p][1];
    if (pinned) {
      var ph = hits.filter(function (h) { return h.entry.id === pinned; })[0];
      if (!ph) hits.push(ph = { entry: this.byId[pinned], score: 0, overlap: 1, coverage: 1 });
      ph.score += 30; ph.overlap = Math.max(ph.overlap, 1); ph.coverage = 1;
    }
    hits.sort(function (a, b) { return b.score - a.score; });
    // Two research files can cover the same event; don't list it twice.
    var titles = new Set();
    return hits.filter(function (h) {
      var k = norm(h.entry.title).replace(/\b(the|of|and|a)\b/g, '').replace(/\s+/g, ' ');
      if (titles.has(k)) return false;
      titles.add(k); return true;
    });
  };

  /* Is the best hit good enough to present as the answer? */
  Engine.prototype.confident = function (hit) {
    // An answer needs to look like an answer to THIS question: it must cover
    // a fair share of what was typed, and either resemble a question the
    // entry already answers or match on the words strongly enough to speak
    // for itself. Without the second test, questions made of ordinary English
    // words that happen to appear in the research ("is it going to rain",
    // "who is the current prime minister") were answered confidently.
    return !!hit
      && (hit.score >= 7 || hit.overlap >= 0.34 || (hit.score >= 5.5 && hit.coverage >= 0.75))
      && hit.coverage >= 0.45
      && (hit.overlap > 0 || hit.score >= 12);
  };

  Engine.tokens = tokens;
  Engine.norm = norm;
  window.Engine = Engine;
})();
