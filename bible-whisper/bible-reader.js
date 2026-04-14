/* ============================================================ */
/* === BIBLE READER MODULE — Bible Whisper Standalone        === */
/* === 新標點和合本・神版・完全離線                             === */
/* === 功能：逐節筆記、書籤、底部筆記抽屜、字體調整、滑動翻頁  === */
/* ============================================================ */

let bibleData = null;
let bibleCurrentBook = -1;
let bibleCurrentChapter = -1;
const BIBLE_OT_COUNT = 39;
let _bibleBottomActiveTab = 'chapter';
let _bibleNotesOverviewActive = false;
let _bibleChapterStartTime = 0;

/* ─── Storage Helpers ─────────────────────────────────────── */
function getBibleNotes()         { return JSON.parse(localStorage.getItem('hw_bible_notes')   || '{}'); }
function saveBibleNotes(n)       { localStorage.setItem('hw_bible_notes', JSON.stringify(n)); }
function getBibleBookmark()      { return JSON.parse(localStorage.getItem('hw_bible_bookmark') || 'null'); }
function saveBibleBookmark(b)    { localStorage.setItem('hw_bible_bookmark', JSON.stringify(b)); }
function getBibleReadLog()       { return JSON.parse(localStorage.getItem('hw_bible_read_log') || '{}'); }
function saveBibleReadLog(l)     { localStorage.setItem('hw_bible_read_log', JSON.stringify(l)); }
function getBibleHighlights()    { return JSON.parse(localStorage.getItem('hw_bible_highlights') || '{}'); }
function getBibleFontSize()      { return parseInt(localStorage.getItem('hw_bible_font_size')  || '17'); }
function saveBibleFontSize(s)    { localStorage.setItem('hw_bible_font_size', String(s)); }
function getBibleStreak()        { return JSON.parse(localStorage.getItem('hw_bible_streak')   || '{"lastDate":null,"count":0}'); }
function saveBibleStreak(s)      { localStorage.setItem('hw_bible_streak', JSON.stringify(s)); }
function getBiblePaperChapters() { return parseInt(localStorage.getItem('hw_bible_paper_chapters') || '0'); }
function saveBiblePaperChapters(n){ localStorage.setItem('hw_bible_paper_chapters', String(n)); }

function _bibleKey(b, c, v) { return `${bibleData[b].name}_${c}_${v}`; }

/* ─── Main Entry ──────────────────────────────────────────── */
async function openBible() {
  switchView('view-bible');
  const isInit = await idbGetMeta('initialized');
  if (!isInit || !bibleData) {
    document.getElementById('bible-loading').style.display = 'flex';
    document.getElementById('bible-book-picker').style.display = 'none';
    try {
      if (!isInit) {
        const res = await fetch('./bible.json');
        if (!res.ok) throw new Error('fetch failed');
        const rawJson = await res.json();
        await idbPopulateBible(rawJson);
      }
      bibleData = await idbGetMeta('books');
      document.getElementById('bible-loading').style.display = 'none';
      _bibleRenderBookPicker();
    } catch (e) {
      document.getElementById('bible-loading').style.display = 'none';
      document.getElementById('bible-book-picker').style.display = 'block';
      showToast('聖經庫初始化失敗，請連線後重試');
      console.error(e);
      switchView('view-home');
      return;
    }
  } else {
    bibleCurrentBook = -1;
    bibleCurrentChapter = -1;
    _bibleNotesOverviewActive = false;
    _bibleShowPickerState('books');
  }
  
  if (!window._bwXrefData) {
    try {
      const res = await fetch('./historical_refs.json');
      window._bwXrefData = await res.json();
    } catch(e) { window._bwXrefData = {}; }
  }
  
  _initBibleSwipe();
}

/* ─── Navigation ──────────────────────────────────────────── */
function bibileNavBack() {
  const reader  = document.getElementById('bible-reader');
  const chapter = document.getElementById('bible-chapter-picker');

  if (reader && reader.style.display !== 'none') {
    bibleCurrentChapter = -1;
    _bibleShowPickerState('chapters');
  } else if (chapter && chapter.style.display !== 'none') {
    bibleCurrentBook = -1;
    _bibleShowPickerState('books');
  } else {
    switchView('view-home');
  }
}

function _bibleShowPickerState(state) {
  const bookPicker    = document.getElementById('bible-book-picker');
  const chapterPicker = document.getElementById('bible-chapter-picker');
  const reader        = document.getElementById('bible-reader');
  const loading       = document.getElementById('bible-loading');
  const toolbar       = document.getElementById('bible-reader-toolbar');
  const scrollArea    = document.getElementById('bible-scroll-area');

  if (bookPicker)    bookPicker.style.display    = state === 'books'    ? 'block' : 'none';
  if (chapterPicker) chapterPicker.style.display = state === 'chapters' ? 'block' : 'none';
  if (reader)        reader.style.display        = state === 'reader'   ? 'block' : 'none';
  if (loading)       loading.style.display       = 'none';
  if (toolbar)       toolbar.style.display       = state === 'reader'   ? 'flex'  : 'none';

  // Stop TTS if leaving reader
  if (state !== 'reader' && typeof ttsStop === 'function') {
    ttsStop();
  }

  // Scroll content area to top on state change
  if (scrollArea) scrollArea.scrollTop = 0;

  const backLabel = document.getElementById('bible-back-label');
  const navInfo   = document.getElementById('bible-nav-info');
  if (!backLabel || !navInfo) return;

  if (state === 'books') {
    backLabel.textContent = '返回';
    navInfo.innerHTML = '';
  } else if (state === 'chapters' && bibleCurrentBook >= 0) {
    backLabel.textContent = '書卷';
    navInfo.textContent = bibleData[bibleCurrentBook].name;
  } else if (state === 'reader' && bibleCurrentBook >= 0 && bibleCurrentChapter >= 0) {
    backLabel.textContent = '章節';
    navInfo.textContent = `${bibleData[bibleCurrentBook].name} ${bibleCurrentChapter + 1}`;
  }
}

/* ─── Book Picker ─────────────────────────────────────────── */
function _bibleRenderBookPicker() {
  if (!bibleData) return;
  _bibleNotesOverviewActive = false;

  /* Bookmark / Streak Banner */
  const bm     = getBibleBookmark();
  const streak = getBibleStreak();
  const count  = streak.count || 0;
  const banner = document.getElementById('bible-bookmark-banner');

  if (banner) {
    const paperCount = getBiblePaperChapters();
    const readLog    = getBibleReadLog();
    const currentYear = new Date().getFullYear().toString();
    const yearlyReads = Object.keys(readLog)
      .filter(k => k.indexOf('_') > 0 && readLog[k].startsWith(currentYear)).length + paperCount;

    let html = '<div style="display:flex;justify-content:space-between;align-items:center;width:100%;">';
    if (count > 0) {
      html += `<div style="font-weight:700;color:var(--accent-gold);font-size:0.95rem;">🔥 連續靈修 ${count} 天</div>`;
    } else {
      html += '<div></div>';
    }
    html += `<div class="bible-year-stats">📖 今年已讀 ${yearlyReads} 章 <button class="bible-edit-stats-btn" onclick="openBibleStatsEdit()" title="修改進度">✏️</button></div>`;
    html += '</div>';

    if (bm) {
      const verseText = bm.verseIdx !== undefined ? `:${bm.verseIdx + 1}` : '';
      html += `
        <div style="display:flex;width:100%;justify-content:space-between;align-items:center;margin-top:10px;">
          <span>📌 上次讀到：<b>${bm.bookName} ${bm.chapterIdx + 1}章${verseText}</b></span>
          <button class="bible-continue-btn" onclick="_bibleSelectBook(${bm.bookIdx}); setTimeout(()=>{_bibleSelectChapter(${bm.chapterIdx});${bm.verseIdx !== undefined ? `setTimeout(()=>_scrollToVerse(${bm.verseIdx}),400);` : ''}},100);">繼續 →</button>
        </div>`;
    }

    if (!count && !bm && yearlyReads === 0) {
      banner.style.display = 'none';
    } else {
      banner.innerHTML = html;
      banner.style.display = 'block';
    }
  }

  /* Tabs */
  document.getElementById('bible-picker-tab-books')?.classList.add('active');
  document.getElementById('bible-picker-tab-notes')?.classList.remove('active');
  document.getElementById('bible-notes-overview').style.display = 'none';
  document.getElementById('bible-book-lists').style.display = 'block';

  /* Build book grids */
  const readLog = getBibleReadLog();
  const notes   = getBibleNotes();
  const otGrid  = document.getElementById('bible-ot-grid');
  const ntGrid  = document.getElementById('bible-nt-grid');
  if (!otGrid || !ntGrid) return;
  otGrid.innerHTML = '';
  ntGrid.innerHTML = '';

  bibleData.forEach((book, idx) => {
    const totalChapters = book.chapterCount || 0;
    const readCount     = Object.keys(readLog).filter(k => k.startsWith(idx + '_')).length;
    const noteCount     = Object.keys(notes).filter(k => k.startsWith(book.name + '_')).length;

    const btn = document.createElement('button');
    btn.className = 'bible-book-btn';
    if (readCount === totalChapters && totalChapters > 0) btn.classList.add('fully-read');

    let badge   = '';
    let noteDot = noteCount > 0 ? '<span class="bible-book-note-dot"></span>' : '';

    if (readCount > 0 && readCount < totalChapters) {
      badge = `<span class="bible-book-progress">${readCount}/${totalChapters} 章</span>`;
    } else if (readCount === totalChapters && totalChapters > 0) {
      badge = '<span class="bible-book-progress done">✓ 已讀完</span>';
    }

    btn.innerHTML = `${noteDot}${book.name}${badge}`;
    btn.onclick = () => _bibleSelectBook(idx);
    (idx < BIBLE_OT_COUNT ? otGrid : ntGrid).appendChild(btn);
  });

  _bibleShowPickerState('books');
}

/* ─── Chapter Picker ──────────────────────────────────────── */
function _bibleSelectBook(bookIdx) {
  bibleCurrentBook    = bookIdx;
  bibleCurrentChapter = -1;
  const book = bibleData[bookIdx];

  const titleEl = document.getElementById('bible-chapter-title');
  if (titleEl) titleEl.textContent = book.name;

  const readLog = getBibleReadLog();
  const grid    = document.getElementById('bible-chapter-grid');
  if (!grid) return;
  grid.innerHTML = '';

  const chapCount = book.chapterCount || 0;
  for (let idx = 0; idx < chapCount; idx++) {
    const btn = document.createElement('button');
    btn.className = 'bible-chapter-btn';
    if (readLog[`${bookIdx}_${idx}`]) btn.classList.add('read');
    btn.textContent = idx + 1;
    btn.onclick = () => _bibleSelectChapter(idx);
    grid.appendChild(btn);
  }

  _bibleShowPickerState('chapters');
}

/* ─── Reader ──────────────────────────────────────────────── */
async function _bibleSelectChapter(chapterIdx) {
  bibleCurrentChapter = chapterIdx;
  const book   = bibleData[bibleCurrentBook];
  const verses = await idbGetChapter(bibleCurrentBook, chapterIdx); // IDB!
  
  if (!verses) {
    showToast('⚠️ 經文讀取失敗，請重新啟動 App 進行修復');
    return;
  }
  
  const notes  = getBibleNotes();

  /* Update heading */
  const headingEl = document.getElementById('bible-reader-heading');
  if (headingEl) headingEl.textContent = `${book.name}・第${chapterIdx + 1}章`;

  /* Build verse list */
  const list = document.getElementById('bible-verse-list');
  if (!list) return;
  list.innerHTML = '';

  const fontSize = getBibleFontSize();
  list.style.fontSize = fontSize + 'px';

  verses.forEach((verse, idx) => {
    const key          = _bibleKey(bibleCurrentBook, chapterIdx, idx);
    const hasNote      = !!notes[key];
    const bm           = getBibleBookmark();
    const isBookmarked = bm && bm.bookIdx === bibleCurrentBook &&
                         bm.chapterIdx === chapterIdx && bm.verseIdx === idx;

    const highlights   = getBibleHighlights();
    const hlColor      = highlights[key] || '';
    const hasXref      = window._bwXrefData && window._bwXrefData[`${bibleCurrentBook}_${chapterIdx}_${idx}`];

    const row = document.createElement('div');
    row.className = 'bible-verse-row' + (isBookmarked ? ' verse-bookmarked' : '') + (hlColor ? ` highlight-${hlColor}` : '');
    row.id = `verse-row-${idx}`;
    row.innerHTML = `
      <span class="bible-verse-num">${idx + 1}${hasNote ? '<span class="bible-note-dot"></span>' : ''}</span>
      <div class="bible-verse-body">
        <span class="bible-verse-text">${verse}</span>
        ${hasNote ? `<div class="bible-note-card" id="note-card-${idx}">${notes[key].text}</div>` : ''}
        <div class="bible-note-input-area" id="note-input-${idx}" style="display:none;">
          <textarea class="bible-note-textarea" id="note-textarea-${idx}" maxlength="500" placeholder="在這裡寫下你的靈修筆記...">${hasNote ? notes[key].text : ''}</textarea>
          <div class="bible-note-actions">
            <button class="bible-note-save-btn" onclick="bibleSaveNote(${idx})">儲存</button>
            <button class="bible-note-cancel-btn" onclick="bibleCloseNoteInput(${idx})">取消</button>
            ${hasNote ? `<button class="bible-note-delete-btn" onclick="bibleDeleteNote(${idx})">🗑️ 刪除</button>` : ''}
          </div>
        </div>
      </div>
      <div class="bible-verse-btns">
        <button class="bible-note-trigger"    title="寫筆記"      onclick="bibleToggleNoteInput(${idx})">📝</button>
        <button class="bible-bookmark-btn"    title="多色螢光筆"   onclick="bibleCycleHighlight(${bibleCurrentBook},${chapterIdx},${idx})">🖍️</button>
        <button class="bible-set-bookmark-btn" title="標記讀到這裡" onclick="bibleSetBookmark(${idx})">📌</button>
        ${hasXref ? `<button class="bible-xref-btn" title="歷史關聯" onclick="bibleShowXref('${bibleCurrentBook}_${chapterIdx}_${idx}')">🔗</button>` : ''}
        <button class="bible-tts-verse-btn"   title="從這節開始朗讀" onclick="ttsStart(${idx})">🔊</button>
      </div>`;
    list.appendChild(row);
  });

  /* Prev / Next inline nav buttons */
  const prevBtn = document.getElementById('bible-prev-btn');
  const nextBtn = document.getElementById('bible-next-btn');
  if (prevBtn) prevBtn.style.display = chapterIdx > 0 ? 'block' : 'none';
  if (nextBtn) nextBtn.style.display = chapterIdx < (book.chapterCount || 0) - 1 ? 'block' : 'none';

  _bibleShowPickerState('reader');
  _bibleChapterStartTime = Date.now();
  if (typeof _ttsOnChapterRendered === 'function') _ttsOnChapterRendered();
  _initBibleSwipe();
}

/* ─── Chapter Prev / Next ─────────────────────────────────── */
function bibleGoPrevChapter() {
  if (bibleCurrentChapter > 0) _bibleSelectChapter(bibleCurrentChapter - 1);
}
function bibleGoNextChapter() {
  if (bibleCurrentBook >= 0 &&
      bibleCurrentChapter < bibleData[bibleCurrentBook].chapters.length - 1) {
    _bibleSelectChapter(bibleCurrentChapter + 1);
  }
}

function _scrollToVerse(verseIdx) {
  const row = document.getElementById(`verse-row-${verseIdx}`);
  if (row) row.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

/* ─── Bookmark / Progress ─────────────────────────────────── */
function bibleSetBookmark(verseIdx) {
  if (bibleCurrentBook < 0 || bibleCurrentChapter < 0) return;
  const book  = bibleData[bibleCurrentBook];
  const bm = {
    bookIdx: bibleCurrentBook,
    chapterIdx: bibleCurrentChapter,
    verseIdx,
    bookName: book.name,
    verseText: '' // verse text loaded on demand from IDB
  };
  saveBibleBookmark(bm);
  // Async update bookmark verseText from IDB
  idbGetChapter(bibleCurrentBook, bibleCurrentChapter).then(verses => {
    if (verses && verses[verseIdx]) {
      bm.verseText = verses[verseIdx];
      saveBibleBookmark(bm);
    }
  });

  /* Record chapter as read */
  const readLog = getBibleReadLog();
  const logKey  = `${bibleCurrentBook}_${bibleCurrentChapter}`;
  if (!readLog[logKey]) {
    readLog[logKey] = new Date().toISOString();
    saveBibleReadLog(readLog);
  }

  _updateBibleStreak();
  if (typeof renderTimeline === 'function') renderTimeline();
  _bibleRenderBookPicker();

  showToast(`📌 已標記：${book.name} ${bibleCurrentChapter + 1}:${verseIdx + 1}`);
  _bibleSelectChapter(bibleCurrentChapter);
}

/* ─── Font Size ───────────────────────────────────────────── */
function bibleFontChange(delta) {
  const current = getBibleFontSize();
  const next    = Math.min(26, Math.max(14, current + delta));
  saveBibleFontSize(next);
  const list = document.getElementById('bible-verse-list');
  if (list) list.style.fontSize = next + 'px';
  showToast(`字體大小：${next}px`);
}

/* ─── Note CRUD ───────────────────────────────────────────── */
function bibleToggleNoteInput(verseIdx) {
  const area = document.getElementById(`note-input-${verseIdx}`);
  if (!area) return;
  const isOpen = area.style.display !== 'none';
  area.style.display = isOpen ? 'none' : 'block';
  if (!isOpen) document.getElementById(`note-textarea-${verseIdx}`)?.focus();
}

function bibleCloseNoteInput(verseIdx) {
  const area = document.getElementById(`note-input-${verseIdx}`);
  if (area) area.style.display = 'none';
}

function bibleSaveNote(verseIdx) {
  const textarea = document.getElementById(`note-textarea-${verseIdx}`);
  if (!textarea) return;
  const text = textarea.value.trim();
  if (!text) { showToast('請先輸入筆記內容'); return; }

  const notes = getBibleNotes();
  const key   = _bibleKey(bibleCurrentBook, bibleCurrentChapter, verseIdx);
  notes[key]  = { text, bookIdx: bibleCurrentBook, chapterIdx: bibleCurrentChapter, verseIdx, updatedAt: Date.now() };
  saveBibleNotes(notes);

  /* Update verse number dot */
  const numEl = document.querySelector(`#verse-row-${verseIdx} .bible-verse-num`);
  if (numEl && !numEl.querySelector('.bible-note-dot')) {
    const dot = document.createElement('span');
    dot.className = 'bible-note-dot';
    numEl.appendChild(dot);
  }
  /* Update / create note card */
  let card = document.getElementById(`note-card-${verseIdx}`);
  if (!card) {
    card = document.createElement('div');
    card.className = 'bible-note-card';
    card.id = `note-card-${verseIdx}`;
    const body = document.querySelector(`#verse-row-${verseIdx} .bible-verse-body`);
    body?.insertBefore(card, document.getElementById(`note-input-${verseIdx}`));
  }
  card.textContent = text;
  bibleCloseNoteInput(verseIdx);
  showToast('📝 筆記已儲存');
}

function bibleDeleteNote(verseIdx) {
  const notes = getBibleNotes();
  const key   = _bibleKey(bibleCurrentBook, bibleCurrentChapter, verseIdx);
  delete notes[key];
  saveBibleNotes(notes);

  document.getElementById(`note-card-${verseIdx}`)?.remove();
  document.querySelector(`#verse-row-${verseIdx} .bible-note-dot`)?.remove();
  bibleCloseNoteInput(verseIdx);
  showToast('筆記已刪除');
}

/* ─── Verse Highlight (Cycling Colors) ─────────────── */
function bibleCycleHighlight(bookIdx, chapterIdx, verseIdx) {
  const hls    = getBibleHighlights();
  const key    = _bibleKey(bookIdx, chapterIdx, verseIdx);
  const colors = ['none', 'yellow', 'green', 'pink', 'blue'];
  
  const curr   = hls[key] || 'none';
  const nextIdx= (colors.indexOf(curr) + 1) % colors.length;
  const next   = colors[nextIdx];
  
  if (next === 'none') delete hls[key];
  else hls[key] = next;
  
  localStorage.setItem('hw_bible_highlights', JSON.stringify(hls));
  
  // UI Update
  const row = document.getElementById(`verse-row-${verseIdx}`);
  if (row) {
    colors.forEach(c => row.classList.remove(`highlight-${c}`));
    if (next !== 'none') row.classList.add(`highlight-${next}`);
  }
}

/* ─── Bottom Sheet ────────────────────────────────────────── */
function toggleBibleBottomSheet() {
  const sheet = document.getElementById('bible-bottom-sheet');
  if (!sheet) return;
  if (sheet.classList.contains('open')) {
    _closeBibleBottomSheet();
  } else {
    sheet.classList.add('open');
    renderBottomSheetNotes(_bibleBottomActiveTab);
  }
}

function _closeBibleBottomSheet() {
  document.getElementById('bible-bottom-sheet')?.classList.remove('open');
}

function switchBottomTab(tab) {
  _bibleBottomActiveTab = tab;
  document.querySelectorAll('.bible-bottom-tab').forEach(el => el.classList.remove('active'));
  document.getElementById(`tab-${tab}`)?.classList.add('active');
  renderBottomSheetNotes(tab);
}

function renderBottomSheetNotes(tab) {
  const container = document.getElementById('bottom-sheet-content');
  if (!container) return;
  const notes = getBibleNotes();

  if (tab === 'chapter') {
    if (bibleCurrentBook < 0 || bibleCurrentChapter < 0) {
      container.innerHTML = '<p class="bible-empty-state">請先選擇章節後再查看筆記</p>';
      return;
    }
    const prefix       = `${bibleData[bibleCurrentBook].name}_${bibleCurrentChapter}_`;
    const chapterNotes = Object.entries(notes).filter(([k]) => k.startsWith(prefix));

    if (chapterNotes.length === 0) {
      container.innerHTML = '<p class="bible-empty-state">本章還沒有筆記<br><small>在閱讀時點擊 📝 寫下第一則</small></p>';
      return;
    }
    container.innerHTML = chapterNotes.map(([k, v]) => {
      const idx = k.split('_').pop();
      return `<div class="bottom-note-card">
        <div class="bottom-note-ref">${bibleData[bibleCurrentBook].name} ${bibleCurrentChapter + 1}:${parseInt(idx) + 1}</div>
        <div class="bottom-note-text">${v.text}</div>
        <button class="bottom-note-jump" onclick="bibleJumpToVerse(${bibleCurrentBook},${bibleCurrentChapter},${idx})">↑ 跳到這節</button>
      </div>`;
    }).join('');

  } else if (tab === 'recent') {
    const noteEntries = Object.entries(notes);
    if (noteEntries.length === 0) {
      container.innerHTML = '<p class="bible-empty-state">還沒有任何筆記</p>';
      return;
    }
    const sorted = noteEntries
      .sort((a, b) => (b[1].updatedAt || 0) - (a[1].updatedAt || 0))
      .slice(0, 15);
    container.innerHTML = sorted.map(([k, v]) => {
      const showRef = v.bookIdx !== undefined
        ? `${bibleData[v.bookIdx]?.name} ${v.chapterIdx + 1}:${v.verseIdx + 1}`
        : k;
      return `<div class="bottom-note-card">
        <div class="bottom-note-ref">${showRef}</div>
        <div class="bottom-note-text">${v.text}</div>
        ${v.bookIdx !== undefined
          ? `<button class="bottom-note-jump" onclick="bibleJumpToVerse(${v.bookIdx},${v.chapterIdx},${v.verseIdx})">↑ 跳到這節</button>`
          : ''}
      </div>`;
    }).join('');
  } else if (tab === 'xref') {
    if (!window._activeXrefKey || !window._bwXrefData || !window._bwXrefData[window._activeXrefKey]) {
      container.innerHTML = '<p class="bible-empty-state">無歷史關聯資料</p>';
      return;
    }
    const refs = window._bwXrefData[window._activeXrefKey];
    container.innerHTML = refs.map(r => `
      <div class="xref-item">
        <div class="xref-item-ref">🔗 ${r.ref}</div>
        <div class="xref-item-text">${r.text}</div>
      </div>
    `).join('');
  }
}

function bibleJumpToVerse(bookIdx, chapterIdx, verseIdx) {
  _closeBibleBottomSheet();
  const needNav = bookIdx !== bibleCurrentBook || chapterIdx !== bibleCurrentChapter;
  const doJump = () => {
    const el = document.getElementById(`verse-row-${verseIdx}`);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el.classList.add('bible-verse-highlight');
      setTimeout(() => el.classList.remove('bible-verse-highlight'), 1800);
    }
  };
  if (needNav) {
    _bibleSelectBook(bookIdx);
    setTimeout(() => { _bibleSelectChapter(chapterIdx); setTimeout(doJump, 300); }, 100);
  } else {
    doJump();
  }
}

/* ─── Notes Overview ──────────────────────────────────────── */
function bibleShowNotesOverview() {
  _bibleNotesOverviewActive = true;
  document.getElementById('bible-picker-tab-books')?.classList.remove('active');
  document.getElementById('bible-picker-tab-notes')?.classList.add('active');
  document.getElementById('bible-book-lists').style.display   = 'none';
  document.getElementById('bible-notes-overview').style.display = 'block';
  _renderNotesOverview('');
}

function bibleShowBookPicker() {
  _bibleNotesOverviewActive = false;
  _bibleRenderBookPicker();
}

function bibleFilterNotes() {
  const q = document.getElementById('bible-notes-search')?.value || '';
  _renderNotesOverview(q);
}

function _renderNotesOverview(query) {
  const container = document.getElementById('bible-notes-overview-list');
  if (!container || !bibleData) return;
  const notes      = getBibleNotes();
  const allEntries = Object.entries(notes);
  const filtered   = query
    ? allEntries.filter(([, v]) => v.text.includes(query))
    : allEntries;

  if (filtered.length === 0) {
    container.innerHTML = `<div class="bible-empty-state">
      <p style="font-size:2rem;">📝</p>
      <p>${query ? '找不到符合的筆記' : '還沒有任何靈修筆記'}</p>
      <small>在閱讀時點擊 📝 寫下第一則</small>
    </div>`;
    return;
  }

  /* Group by book */
  const byBook = {};
  filtered.forEach(([k, v]) => {
    const bookName = k.split('_')[0];
    if (!byBook[bookName]) byBook[bookName] = [];
    byBook[bookName].push([k, v]);
  });

  container.innerHTML = Object.entries(byBook).map(([bookName, entries]) => {
    const items = entries
      .sort((a, b) => (a[1].chapterIdx||0) - (b[1].chapterIdx||0) || (a[1].verseIdx||0) - (b[1].verseIdx||0))
      .map(([k, v]) => {
        const date = v.updatedAt
          ? new Date(v.updatedAt).toLocaleDateString('zh-TW', { month: 'short', day: 'numeric' })
          : '';
        const refText = v.bookIdx !== undefined
          ? `${bookName} ${v.chapterIdx + 1}:${v.verseIdx + 1}`
          : k;
        return `<div class="notes-overview-item">
          <div class="notes-overview-ref">${refText} <small style="font-weight:400;color:var(--text-muted);">${date}</small></div>
          <div class="notes-overview-text">${v.text}</div>
          ${v.bookIdx !== undefined
            ? `<button class="bottom-note-jump" onclick="bibleJumpToVerse(${v.bookIdx},${v.chapterIdx},${v.verseIdx})">去這節 →</button>`
            : ''}
        </div>`;
      }).join('');

    return `<div class="notes-overview-book-card">
      <div class="notes-overview-book-title" onclick="this.nextElementSibling.classList.toggle('open')">
        📖 ${bookName} <span class="notes-count">${entries.length} 則筆記</span>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-left:auto;flex-shrink:0;"><polyline points="6,9 12,15 18,9"/></svg>
      </div>
      <div class="notes-overview-book-body open">${items}</div>
    </div>`;
  }).join('');
}

function bibleShowXref(key) {
  window._activeXrefKey = key;
  const sheet = document.getElementById('bible-bottom-sheet');
  const tabXref = document.getElementById('tab-xref');
  if (sheet && tabXref) {
    sheet.classList.add('open');
    tabXref.style.display = 'inline-block';
    switchBottomTab('xref');
  }
}

/* ─── Full-Text Search ────────────────────────────────────── */
function bibleSearch() {
  const input     = document.getElementById('bible-search-input');
  const query     = input?.value?.trim();
  const resultsEl = document.getElementById('bible-search-results');
  const clearBtn  = document.getElementById('search-clear-btn');
  const testTabs  = document.getElementById('testament-tabs');
  const otGrid    = document.getElementById('bible-ot-grid');
  const ntGrid    = document.getElementById('bible-nt-grid');

  if (clearBtn) clearBtn.style.display = query ? 'flex' : 'none';

  if (!query) {
    if (resultsEl) { resultsEl.innerHTML = ''; resultsEl.style.display = 'none'; }
    if (testTabs)  testTabs.style.display = 'flex';
    if (otGrid)    otGrid.style.display   = 'grid';
    if (ntGrid)    ntGrid.style.display   = 'none';
    return;
  }

  if (!bibleData) return;

  if (resultsEl) resultsEl.style.display = 'block';
  if (testTabs)  testTabs.style.display  = 'none';
  if (otGrid)    otGrid.style.display    = 'none';
  if (ntGrid)    ntGrid.style.display    = 'none';

  resultsEl.innerHTML = '<p style="color:var(--text-secondary);font-size:0.9rem;padding:12px 14px;">搜尋中...</p>';

  // Use IDB global search instead of iterating in-memory
  idbSearchGlobal(query, 'all').then(results => {
    // Enrich with book names
    results.forEach(r => { r.bookName = bibleData[r.bookIdx]?.name || ''; r.verse = r.text; });

    if (results.length === 0) {
      resultsEl.innerHTML = `<p class="bible-empty-state" style="padding:20px;">找不到「${query}」的相關經文</p>`;
      return;
    }

    const limited = results.slice(0, 50);
    resultsEl.innerHTML = `<p class="bible-search-count">共找到 ${results.length} 處${results.length > 50 ? '（顯示前50筆）' : ''}</p>` +
      limited.map(r => {
        const highlighted = r.verse.replace(new RegExp(query, 'g'), `<mark>${query}</mark>`);
        return `<div class="bible-search-result-item" onclick="bibleJumpToVerse(${r.bookIdx},${r.chapterIdx},${r.verseIdx})">
          <div class="bible-search-ref">${r.bookName} ${r.chapterIdx + 1}:${r.verseIdx + 1}</div>
          <div class="bible-search-verse">${highlighted}</div>
        </div>`;
      }).join('');
  });
}

/* ─── Streak ──────────────────────────────────────────────── */
function _updateBibleStreak() {
  const today = new Date().toDateString();
  const streak = getBibleStreak();
  if (streak.lastDate !== today) {
    const yesterday = new Date(Date.now() - 86400000).toDateString();
    streak.count = streak.lastDate === yesterday ? (streak.count || 0) + 1 : 1;
    streak.lastDate = today;
    saveBibleStreak(streak);
  }
  updateDashboard();
}

function getBibleStreakCount() { return getBibleStreak().count || 0; }

/* ─── Daily Verse ─────────────────────────────────────────── */
function getDailyVerseForHome() {
  const today  = new Date().toDateString();
  const cached = JSON.parse(localStorage.getItem('hw_daily_verse') || 'null');
  if (cached && cached.date === today) return cached;

  const curated = [
    { text: '起初，神創造天地。（創世記 1:1）',                                 bookIdx: 0,  chapterIdx: 0  },
    { text: '耶和華是我的牧者，我必不至缺乏。（詩篇 23:1）',                   bookIdx: 18, chapterIdx: 22 },
    { text: '我靠著那加給我力量的，凡事都能做。（腓立比書 4:13）',             bookIdx: 49, chapterIdx: 3  },
    { text: '你要全心倚賴耶和華，不可倚靠自己的聰明。（箴言 3:5）',           bookIdx: 19, chapterIdx: 2  },
    { text: '愛是恆久忍耐，又有恩慈。（哥林多前書 13:4）',                     bookIdx: 45, chapterIdx: 12 },
    { text: '神愛世人，甚至將他的獨生子賜給他們。（約翰福音 3:16）',           bookIdx: 42, chapterIdx: 2  },
    { text: '你趁著年幼，應當記念造你的主。（傳道書 12:1）',                   bookIdx: 20, chapterIdx: 11 },
    { text: '耶和華是我的力量，是我的盾牌。（詩篇 28:7）',                     bookIdx: 18, chapterIdx: 27 },
    { text: '凡你手所當做的事要盡力去做。（傳道書 9:10）',                     bookIdx: 20, chapterIdx: 8  },
    { text: '信就是所望之事的實底，是未見之事的確據。（希伯來書 11:1）',       bookIdx: 57, chapterIdx: 10 },
    { text: '我的恩典夠你用的，因為我的能力是在人的軟弱上顯得完全。（哥林多後書 12:9）', bookIdx: 46, chapterIdx: 11 },
    { text: '要思念那些真實的、可敬的、公義的、清潔的、可愛的、有美名的事。（腓立比書 4:8）', bookIdx: 49, chapterIdx: 3 },
    { text: '你所作的，要交託耶和華，你所謀的，就必成立。（箴言 16:3）',       bookIdx: 19, chapterIdx: 15 },
    { text: '耶和華祝福你，保護你；願他的臉光照你，賜恩給你。（民數記 6:24-25）', bookIdx: 3, chapterIdx: 5 },
  ];

  const pick = curated[new Date().getDate() % curated.length];
  const result = { date: today, text: pick.text, bookIdx: pick.bookIdx, chapterIdx: pick.chapterIdx, source: 'curated' };
  localStorage.setItem('hw_daily_verse', JSON.stringify(result));
  return result;
}

/* ─── Stats Modal ─────────────────────────────────────────── */
function openBibleStatsEdit() {
  document.getElementById('edit-streak-count').value   = getBibleStreakCount();
  document.getElementById('edit-paper-chapters').value = getBiblePaperChapters();
  document.getElementById('modal-bible-stats').classList.add('active');
}

function closeBibleStatsEdit(e) {
  if (e && e.target !== e.currentTarget &&
      e.target.nodeName !== 'BUTTON' &&
      !e.target.classList.contains('btn-cancel')) return;
  document.getElementById('modal-bible-stats').classList.remove('active');
}

function saveBibleStatsEdit() {
  const newStreak = parseInt(document.getElementById('edit-streak-count').value || '0');
  const newPaper  = parseInt(document.getElementById('edit-paper-chapters').value || '0');

  const streak = getBibleStreak();
  streak.count = newStreak;
  if (newStreak > 0 && streak.lastDate !== new Date().toDateString()) {
    streak.lastDate = new Date().toDateString();
  }
  saveBibleStreak(streak);
  saveBiblePaperChapters(newPaper);

  document.getElementById('modal-bible-stats').classList.remove('active');
  updateDashboard();
  if (document.getElementById('bible-book-picker')?.style.display !== 'none') {
    _bibleRenderBookPicker();
  }
  showToast('✅ 進度已更新');
}

/* ─── Swipe Navigation ────────────────────────────────────── */
function _initBibleSwipe() {
  const el = document.getElementById('bible-scroll-area');
  if (!el || el._swipeInited) return;
  el._swipeInited = true;

  let startX = 0, startY = 0, startTime = 0;

  el.addEventListener('touchstart', e => {
    startX    = e.touches[0].clientX;
    startY    = e.touches[0].clientY;
    startTime = Date.now();
  }, { passive: true });

  el.addEventListener('touchend', e => {
    const dx       = e.changedTouches[0].clientX - startX;
    const dy       = e.changedTouches[0].clientY - startY;
    const elapsed  = Date.now() - startTime;
    const reader   = document.getElementById('bible-reader');

    /* Only trigger swipe in reader mode, horizontal, fast, significant distance */
    if (!reader || reader.style.display === 'none') return;
    if (Math.abs(dx) < 60)              return; // Min swipe distance
    if (Math.abs(dy) > Math.abs(dx))   return; // Must be more horizontal than vertical
    if (elapsed > 400)                  return; // Must be a quick swipe

    if (dx < 0) bibleGoNextChapter();
    else        bibleGoPrevChapter();
  }, { passive: true });
  
  _initBibleDoubleTap();
}

/* ─── Immersive Mode Double Tap ───────────────────────────── */
function _initBibleDoubleTap() {
  const el = document.getElementById('bible-scroll-area');
  if (!el || el._doubleTapInited) return;
  el._doubleTapInited = true;

  // Touch devices
  let lastTap = 0;
  el.addEventListener('touchend', e => {
    const reader = document.getElementById('bible-reader');
    if (!reader || reader.style.display === 'none') return;
    
    const currentTime = new Date().getTime();
    const tapLength = currentTime - lastTap;
    
    if (e.target.closest('button') || e.target.closest('textarea')) return;

    if (tapLength < 400 && tapLength > 0) {
      document.body.classList.toggle('immersive-mode');
      // e.preventDefault() cannot be used in passive listener, so we just capture
    }
    lastTap = currentTime;
  }, { passive: true });

  // Mouse devices
  el.addEventListener('dblclick', e => {
    const reader = document.getElementById('bible-reader');
    if (!reader || reader.style.display === 'none') return;
    if (e.target.closest('button') || e.target.closest('textarea')) return;
    document.body.classList.toggle('immersive-mode');
  });
}
