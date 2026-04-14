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
  _utterance:     null,

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
  start(fromVerse = 0) {
    if (!this.synth) {
      showToast('您的裝置不支援語音朗讀功能');
      return;
    }
    if (!bibleData || bibleCurrentBook < 0 || bibleCurrentChapter < 0) {
      showToast('請先選擇章節');
      return;
    }
    this.synth.cancel();
    this.currentVerse   = fromVerse;
    this.isPlaying      = true;
    this.isPaused       = false;
    this._autoAdvancing = false;
    _ttsShowControlBar(true);
    _ttsUpdateToolbarBtn();
    this._speakVerse(fromVerse);
  },

  /* ── 朗讀單節（內部用） ── */
  _speakVerse(idx) {
    if (!this.isPlaying) return;

    const verses = bibleData?.[bibleCurrentBook]?.chapters?.[bibleCurrentChapter];
    if (!verses) return;

    // 章節讀完 → 自動翻頁
    if (idx >= verses.length) {
      this._onChapterEnd();
      return;
    }

    this.currentVerse = idx;
    _ttsHighlightVerse(idx);

    // 僅讀經文，不讀節碼（依用戶設定）
    const text = verses[idx];
    const utt  = new SpeechSynthesisUtterance(text);
    if (this.zhVoice) utt.voice = this.zhVoice;
    utt.lang  = 'zh-TW';
    utt.rate  = this.rate;
    utt.pitch = 1.0;

    utt.onstart = () => {
      this.currentVerse = idx;
      _ttsHighlightVerse(idx);
      _ttsUpdateControlRef();
    };

    utt.onend = () => {
      if (this.isPlaying && !this.isPaused) {
        this._speakVerse(idx + 1);
      }
    };

    utt.onerror = (e) => {
      // 'interrupted' / 'canceled' = 正常中斷（使用者操作），不算錯誤
      if (e.error === 'interrupted' || e.error === 'canceled') return;
      console.warn('[TTS] Error:', e.error, e.utterance?.text?.slice(0, 30));
      this.stop();
    };

    this._utterance = utt;
    this.synth.speak(utt);
  },

  /* ── 章節結束 → 自動翻到下一章 ── */
  _onChapterEnd() {
    if (!bibleData) return;
    const book = bibleData[bibleCurrentBook];

    if (bibleCurrentChapter < book.chapters.length - 1) {
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
    this._utterance     = null;
    _ttsShowControlBar(false);
    _ttsUpdateToolbarBtn();
    _ttsClearHighlight();
  },

  /* ── 跳到指定節 ── */
  jumpTo(idx) {
    const verses = bibleData?.[bibleCurrentBook]?.chapters?.[bibleCurrentChapter];
    if (!verses) return;
    const clamped = Math.max(0, Math.min(idx, verses.length - 1));
    if (this.synth) this.synth.cancel();
    // Brief delay for iOS cancel to settle
    setTimeout(() => this._speakVerse(clamped), 80);
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
      setTimeout(() => this._speakVerse(cur), 80);
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
  BibleTTS.isPlaying      = true;
  BibleTTS.isPaused       = false;
  BibleTTS.currentVerse   = 0;
  _ttsShowControlBar(true);
  _ttsUpdateToolbarBtn();
  // Small delay so DOM is fully rendered
  setTimeout(() => BibleTTS._speakVerse(0), 250);
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
  if (!bibleData || bibleCurrentBook < 0 || bibleCurrentChapter < 0) return;
  const bookEl  = document.getElementById('tts-book-ref');
  const verseEl = document.getElementById('tts-verse-ref');
  const total   = bibleData[bibleCurrentBook].chapters[bibleCurrentChapter].length;
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
