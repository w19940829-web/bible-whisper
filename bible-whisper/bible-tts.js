/* ============================================================ */
/* === BIBLE TTS — 語音朗讀引擎                               === */
/* === 功能：整章/逐節朗讀・暫停繼續・速度調整・自動翻頁       === */
/* ============================================================ */

const BibleTTS = {
  synth:          window.speechSynthesis || null,
  voices:         [],
  zhVoice:        null,
  isPlaying:      false,
  isPaused:       false,
  currentVerse:   -1,
  rate:           parseFloat(localStorage.getItem('hw_tts_rate') || '1'),
  _autoAdvancing: false,  // flag: TTS is navigating to next chapter, don't stop
  _currentVerses: null,   // store verses fetched from IDB
  _queuedUntil:   0,      // next verse index to enqueue

  /* ── 初始化：載入系統語音清單 ── */
  init() {
    if (!this.synth) return;
    const loadVoices = () => {
      this.voices = this.synth.getVoices();
      // Priority: zh-TW > zh-HK > any zh
      this.zhVoice =
        this.voices.find(v => v.lang === 'zh-TW' && v.localService) ||
        this.voices.find(v => v.lang === 'zh-TW') ||
        this.voices.find(v => v.lang === 'zh-HK') ||
        this.voices.find(v => v.lang === 'zh-CN') ||
        this.voices.find(v => v.lang.startsWith('zh')) ||
        null;
    };
    loadVoices();
    if (this.synth.onvoiceschanged !== undefined) {
      this.synth.onvoiceschanged = loadVoices;
    }
    // Restore saved rate and update buttons
    this.rate = parseFloat(localStorage.getItem('hw_tts_rate') || '1');
    _ttsUpdateSpeedButtons();
  },

  /* ── 開始朗讀（從指定節开始） ── */
  async start(fromVerse = 0) {
    if (!this.synth) {
      showToast('您的裝置不支援語音朗讀功能');
      return;
    }
    if (!bibleData || bibleCurrentBook < 0 || bibleCurrentChapter < 0) {
      showToast('請先選擇章節');
      return;
    }
    
    // 取得經文庫從 IDB
    const verses = await idbGetChapter(bibleCurrentBook, bibleCurrentChapter);
    if (!verses || verses.length === 0) {
      showToast('無法取得經文內容');
      return;
    }
    this._currentVerses = verses;

    this.synth.cancel();
    this.currentVerse   = fromVerse;
    this.isPlaying      = true;
    this.isPaused       = false;
    this._autoAdvancing = false;
    _ttsShowControlBar(true);
    _ttsUpdateToolbarBtn();
    
    // 清除舊高亮，準備逐節高亮
    _ttsClearHighlight();
    const list = document.getElementById('bible-verse-list');
    if (list) list.classList.remove('tts-playing'); // Fallback remove class
    
    this._startQueuedReading(fromVerse);
  },

  /* ── 預先佇列朗讀邏輯 ── */
  _startQueuedReading(startIdx) {
    if (!this.isPlaying || !this._currentVerses) return;
    this._queuedUntil = startIdx;
    
    // 如果直接點到超出版圖，或該章為空
    if (startIdx >= this._currentVerses.length) {
      this._onChapterEnd();
      return;
    }
    
    this._fillQueue();
  },

  /* 維持緩衝區有後續兩節準備好的機制 */
  _fillQueue() {
    if (!this.isPlaying || !this.synth) return;
    
    // 讓瀏覽器引擎隨時保有至少 2 個即將播放的 Utterance，實現無縫接軌
    // 且又能避開長達 15 秒單句造成的 iOS cut-off bug
    while (this.synth.pending < 2 && this._queuedUntil < this._currentVerses.length) {
      this._enqueueVerse(this._queuedUntil);
      this._queuedUntil++;
    }
  },

  _enqueueVerse(idx) {
    const textToSpeak = this._currentVerses[idx];
    const utt = new SpeechSynthesisUtterance(textToSpeak);
    if (this.zhVoice) utt.voice = this.zhVoice;
    utt.lang  = 'zh-TW';
    utt.rate  = this.rate;
    utt.pitch = 1.0;

    utt.onstart = () => {
      // 當這一節開始播放時，更新 UI 並高亮
      this.currentVerse = idx;
      _ttsHighlightVerse(idx);
      _ttsUpdateControlRef();
      
      // 補充佇列
      if (this.isPlaying && !this.isPaused) {
        this._fillQueue();
      }
    };

    utt.onend = () => {
      // 如果播到了最後一節，就觸發換章
      if (idx === this._currentVerses.length - 1 && this.isPlaying && !this.isPaused && !this._autoAdvancing) {
        this._onChapterEnd();
      } else if (this.isPlaying && !this.isPaused) {
        this._fillQueue();
      }
    };

    utt.onerror = (e) => {
      if (e.error === 'interrupted' || e.error === 'canceled') return;
      console.warn('[TTS] Error:', e.error, e.utterance?.text?.slice(0, 30));
      this.stop();
    };

    this.synth.speak(utt);
  },

  /* ── 章節結束 → 自動翻到下一章 ── */
  _onChapterEnd() {
    if (!bibleData) return;
    const book = bibleData[bibleCurrentBook];

    if (bibleCurrentChapter < (book.chapterCount || 0) - 1) {
      // 同書的下一章
      this._autoAdvancing = true;
      _bibleSelectChapter(bibleCurrentChapter + 1);

    } else if (bibleCurrentBook < bibleData.length - 1) {
      // 下一卷書
      this._autoAdvancing = true;
      _bibleSelectBook(bibleCurrentBook + 1);
      setTimeout(() => {
        if (this._autoAdvancing) _bibleSelectChapter(0);
      }, 150);

    } else {
      // 整本聖經讀完
      this.isPlaying    = false;
      this.currentVerse = -1;
      _ttsShowControlBar(false);
      _ttsUpdateToolbarBtn();
      _ttsClearHighlight();
      showToast('🎉 已讀完整本聖經！');
    }
  },

  /* ── 暫停 / 繼續 ── */
  toggle() {
    if (!this.synth || !this.isPlaying) return;
    if (this.isPaused) {
      this.synth.resume();
      this.isPaused = false;
    } else {
      this.synth.pause();
      this.isPaused = true;
    }
    _ttsUpdatePlayBtn();
  },

  /* ── 停止 ── */
  stop() {
    if (this.synth) this.synth.cancel();
    this.isPlaying      = false;
    this.isPaused       = false;
    this._autoAdvancing = false;
    this.currentVerse   = -1;
    this._queuedUntil   = 0;
    _ttsShowControlBar(false);
    _ttsUpdateToolbarBtn();
    _ttsClearHighlight();
  },

  /* ── 跳到指定節 ── */
  jumpTo(idx) {
    if (!this._currentVerses) return;
    const clamped = Math.max(0, Math.min(idx, this._currentVerses.length - 1));
    if (this.synth) this.synth.cancel();
    setTimeout(() => this._startQueuedReading(clamped), 80);
  },

  /* ── 速度設定 ── */
  setRate(rate) {
    this.rate = rate;
    localStorage.setItem('hw_tts_rate', String(rate));
    _ttsUpdateSpeedButtons();
    // Restart from current verse with new speed
    if (this.isPlaying) {
      const cur = this.currentVerse;
      if (this.synth) this.synth.cancel();
      setTimeout(() => this._startQueuedReading(cur), 80);
    }
  }
};

/* ══════════════════════════════════════════════════════════════ */
/* Public API — called from HTML onclick                          */
/* ══════════════════════════════════════════════════════════════ */
function ttsStart(fromVerse = 0) { BibleTTS.start(fromVerse); }
function ttsToggle()             { BibleTTS.toggle(); }
function ttsStop()               { BibleTTS.stop(); }
function ttsPrevVerse()          { BibleTTS.jumpTo(BibleTTS.currentVerse - 1); }
function ttsNextVerse()          { BibleTTS.jumpTo(BibleTTS.currentVerse + 1); }
function ttsSetRate(rate)        { BibleTTS.setRate(parseFloat(rate)); }
function ttsCheckSupport()       { return !!(window.speechSynthesis); }

/**
 * Called by bible-reader.js at the end of _bibleSelectChapter().
 * When auto-advancing chapters, resumes TTS in the new chapter.
 */
function _ttsOnChapterRendered() {
  if (!BibleTTS._autoAdvancing) return;
  BibleTTS._autoAdvancing = false;
  // Because start() is now async and fetches from IDB, we just call it
  setTimeout(() => BibleTTS.start(0), 250);
}

/* ══════════════════════════════════════════════════════════════ */
/* UI Helpers                                                      */
/* ══════════════════════════════════════════════════════════════ */

function _ttsShowControlBar(show) {
  const bar = document.getElementById('tts-control-bar');
  if (bar) {
    bar.style.display = show ? 'block' : 'none';
  }
}

function _ttsUpdatePlayBtn() {
  const btn = document.getElementById('tts-play-btn');
  if (!btn) return;
  if (BibleTTS.isPaused) {
    btn.textContent = '▶';
    btn.title = '繼續';
    btn.setAttribute('aria-label', '繼續朗讀');
  } else {
    btn.textContent = '⏸';
    btn.title = '暫停';
    btn.setAttribute('aria-label', '暫停朗讀');
  }
}

function _ttsUpdateToolbarBtn() {
  const btn = document.getElementById('tts-toolbar-btn');
  if (!btn) return;
  const span = btn.querySelector('span');
  if (BibleTTS.isPlaying) {
    if (span) span.textContent = '停止';
    btn.title = '停止朗讀';
    btn.style.color = 'var(--accent-gold)';
    btn.onclick = () => ttsStop();
  } else {
    if (span) span.textContent = '朗讀';
    btn.title = '語音朗讀';
    btn.style.color = '';
    btn.onclick = () => ttsStart(0);
  }
}

function _ttsUpdateControlRef() {
  if (!bibleData || bibleCurrentBook < 0 || bibleCurrentChapter < 0 || !BibleTTS._currentVerses) return;
  const bookEl  = document.getElementById('tts-book-ref');
  const verseEl = document.getElementById('tts-verse-ref');
  const total   = BibleTTS._currentVerses.length;
  if (bookEl)  bookEl.textContent  = `${bibleData[bibleCurrentBook].name} ${bibleCurrentChapter + 1}`;
  if (verseEl) verseEl.textContent = `第 ${BibleTTS.currentVerse + 1} 節 / 共 ${total} 節`;
}

function _ttsHighlightVerse(idx) {
  // Clear previous
  document.querySelectorAll('.bible-verse-row.tts-active')
    .forEach(el => el.classList.remove('tts-active'));

  // Add tts-playing to list (dims other verses)
  const list = document.getElementById('bible-verse-list');
  if (list) list.classList.add('tts-playing');

  // Highlight current verse
  const row = document.getElementById(`verse-row-${idx}`);
  if (row) {
    row.classList.add('tts-active');
    row.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  _ttsUpdateControlRef();
  _ttsUpdatePlayBtn();
}

function _ttsClearHighlight() {
  document.querySelectorAll('.bible-verse-row.tts-active')
    .forEach(el => el.classList.remove('tts-active'));
  document.getElementById('bible-verse-list')?.classList.remove('tts-playing');
}

function _ttsUpdateSpeedButtons() {
  document.querySelectorAll('.tts-speed-btn').forEach(btn => {
    const r = parseFloat(btn.dataset.rate);
    btn.classList.toggle('active', Math.abs(r - BibleTTS.rate) < 0.01);
  });
}

/* ── Init ─────────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', () => {
  if (!ttsCheckSupport()) {
    // Hide TTS toolbar button if not supported
    const btn = document.getElementById('tts-toolbar-btn');
    if (btn) btn.style.display = 'none';
    return;
  }
  BibleTTS.init();
});
