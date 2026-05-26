// ================================================
// LC3000 - 工具函数 + SM-2 算法
// ================================================

/* ===== LocalStorage 键名 ===== */
const STORAGE_KEYS = {
  PROGRESS: 'lc3000_progress',   // 每个单词的学习状态
  HISTORY:  'lc3000_history',    // 每日学习历史
  STREAK:   'lc3000_streak',     // 连续学习天数
  SETTINGS: 'lc3000_settings'    // 用户设置
};

/* ===== Storage 工具 ===== */
const Storage = {
  get(key, def = null) {
    try { const d = localStorage.getItem(key); return d ? JSON.parse(d) : def; }
    catch(e) { return def; }
  },
  set(key, val) {
    try { localStorage.setItem(key, JSON.stringify(val)); return true; }
    catch(e) { console.error('Storage write error:', e); return false; }
  },
  remove(key) { localStorage.removeItem(key); }
};

/* ===== SM-2 间隔重复算法 =====
 * 基于 SuperMemo SM-2 算法
 * 评分: 0=不会(Again) 1=较难(Hard) 2=记得(Good) 3=很熟(Easy)
 */
const SM2 = {
  // 创建新卡片
  createCard(wordId) {
    return {
      wordId,
      repetitions: 0,
      interval: 0,
      easeFactor: 2.5,
      nextReview: Date.now(),
      lastReview: null,
      totalReviews: 0,
      correctReviews: 0
    };
  },

  // 计算下次复习时间
  review(card, quality) {
    // 映射到 SM-2 的 0-5 质量分
    const q = [0, 2, 4, 5][quality];
    let { repetitions, easeFactor, interval } = card;

    if (q < 3) {
      // 未记住 → 重置
      repetitions = 0;
      interval = 1;
    } else {
      // 记住了 → 按 SM-2 计算
      if (repetitions === 0)      interval = 1;
      else if (repetitions === 1) interval = 4;
      else                        interval = Math.round(interval * easeFactor);
      repetitions += 1;
      // 更新难易系数
      easeFactor += 0.1 - (5 - q) * (0.08 + (5 - q) * 0.02);
      easeFactor = Math.max(1.3, easeFactor);
    }
    interval = Math.min(interval, 365);

    return {
      ...card,
      repetitions, easeFactor, interval,
      nextReview:     Date.now() + interval * 86400000,
      lastReview:     Date.now(),
      totalReviews:   card.totalReviews + 1,
      correctReviews: card.correctReviews + (q >= 3 ? 1 : 0)
    };
  },

  // 掌握程度（0-4级）
  getMasteryLevel(card) {
    if (!card || card.totalReviews === 0) return 0; // 未学习
    if (card.repetitions === 0)           return 1; // 学习中
    if (card.interval < 7)                return 2; // 初步掌握
    if (card.interval < 21)               return 3; // 较为熟悉
    return 4;                                        // 已掌握
  },

  getMasteryLabel: l => ['未学习','学习中','初步掌握','较为熟悉','已掌握'][l],
  getMasteryColor: l => ['#94a3b8','#f59e0b','#60a5fa','#a78bfa','#34d399'][l],
  getMasteryBg:    l => ['#f1f5f9','#fef3c7','#dbeafe','#ede9fe','#d1fae5'][l],

  isDue(card) { return !card || Date.now() >= card.nextReview; }
};

/* ===== Progress 管理 ===== */
const Progress = {
  getAll()         { return Storage.get(STORAGE_KEYS.PROGRESS, {}); },
  getCard(wordId)  { return this.getAll()[wordId] || null; },
  saveCard(card)   {
    const all = this.getAll();
    all[card.wordId] = card;
    Storage.set(STORAGE_KEYS.PROGRESS, all);
  },
  getStats(wordList) {
    const all = this.getAll();
    const counts = [0,0,0,0,0];  // 对应 level 0-4
    let due = 0;
    wordList.forEach(w => {
      const card = all[w.id];
      counts[SM2.getMasteryLevel(card)]++;
      if (SM2.isDue(card)) due++;
    });
    return {
      total:   wordList.length,
      new:     counts[0],
      learning:counts[1],
      young:   counts[2],
      mature:  counts[3],
      master:  counts[4],
      studied: wordList.length - counts[0],
      due
    };
  }
};

/* ===== History 管理 ===== */
const History = {
  getAll()  { return Storage.get(STORAGE_KEYS.HISTORY, []); },
  today()   { return new Date().toISOString().split('T')[0]; },
  fmt(d)    { return d.toISOString().split('T')[0]; },

  addSession({ wordsStudied, correctCount }) {
    const all = this.getAll();
    const td  = this.today();
    const idx = all.findIndex(h => h.date === td);
    if (idx >= 0) {
      all[idx].wordsStudied  += wordsStudied;
      all[idx].correctCount  += correctCount;
    } else {
      all.push({ date: td, wordsStudied, correctCount });
    }
    Storage.set(STORAGE_KEYS.HISTORY, all.slice(-365));
  },

  getLast(n) {
    const all  = this.getAll();
    const res  = [];
    const base = new Date();
    for (let i = n - 1; i >= 0; i--) {
      const d = new Date(base); d.setDate(d.getDate() - i);
      const ds = this.fmt(d);
      const entry = all.find(h => h.date === ds);
      res.push({ date: ds, wordsStudied: entry?.wordsStudied||0, correctCount: entry?.correctCount||0 });
    }
    return res;
  },

  todayStudied() {
    const e = this.getAll().find(h => h.date === this.today());
    return e ? e.wordsStudied : 0;
  }
};

/* ===== Streak 管理 ===== */
const Streak = {
  get() { return Storage.get(STORAGE_KEYS.STREAK, { count:0, lastDate:null }); },
  update() {
    const data  = this.get();
    const today = History.today();
    const yest  = History.fmt(new Date(Date.now() - 86400000));
    if (data.lastDate === today) return data.count;
    data.count = (data.lastDate === yest) ? data.count + 1 : 1;
    data.lastDate = today;
    Storage.set(STORAGE_KEYS.STREAK, data);
    return data.count;
  }
};

/* ===== UI 工具 ===== */
const UI = {
  toast(msg, type = 'default', ms = 2800) {
    let c = document.getElementById('toast-container');
    if (!c) { c = document.createElement('div'); c.id='toast-container'; c.className='toast-container'; document.body.appendChild(c); }
    const t = document.createElement('div');
    t.className = `toast${type !== 'default' ? ' toast-'+type : ''}`;
    t.textContent = msg;
    c.appendChild(t);
    setTimeout(() => { t.style.animation='fadeOut .3s ease forwards'; setTimeout(()=>t.remove(), 300); }, ms);
  },

  // 格式化下次复习时间
  fmtNextReview(ts) {
    const diff = Math.round((ts - Date.now()) / 86400000);
    if (diff <= 0) return '今天';
    if (diff === 1) return '明天';
    return `${diff}天后`;
  },

  // 频率标签 HTML
  freqTags(freq) {
    if (!freq) return '';
    return freq.split(' ').map(f => `<span class="freq-tag freq-${f.toLowerCase()}">${f}</span>`).join(' ');
  },

  // 词性中文
  posLabel(pos) {
    const MAP = {
      n:'名词', v:'动词', adj:'形容词', adv:'副词',
      prep:'介词', conj:'连词', pron:'代词', det:'限定词',
      modal:'情态动词', noun:'名词', verb:'动词',
      adjective:'形容词', adverb:'副词', preposition:'介词',
      conjunction:'连词', pronoun:'代词', determiner:'限定词'
    };
    return pos.split('/').map(p => MAP[p.trim().toLowerCase()] || p).join(' / ');
  },

  // 预览间隔天数
  intervalLabel(days) {
    if (days <= 0) return '今天复习';
    if (days === 1) return '明天';
    return `${days}天后`;
  }
};

/* ===== 导航高亮（根据文件名） ===== */
document.addEventListener('DOMContentLoaded', () => {
  const fn = location.pathname.split('/').pop() || 'index.html';
  document.querySelectorAll('.nav-menu a').forEach(a => {
    if (a.getAttribute('href') === fn) a.classList.add('active');
  });
});