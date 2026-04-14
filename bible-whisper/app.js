/* ============================================================ */
/* === Bible Whisper — App Core (app.js)                     === */
/* ============================================================ */

/* ── Theme ── */
function toggleTheme() {
  const html = document.documentElement;
  const isDark = html.getAttribute('data-theme') === 'dark';
  const next = isDark ? 'light' : 'dark';
  html.setAttribute('data-theme', next);
  localStorage.setItem('hw_theme', next);
}

/* ── Toast ── */
function showToast(message) {
  const toast = document.getElementById('toast');
  if (!toast) return;
  toast.innerText = message;
  toast.className = 'toast show';
  setTimeout(() => { toast.className = toast.className.replace('show', '').trim(); }, 3000);
}

/* ── View Navigation ── */
function switchView(viewId) {
  if (window.navigator && window.navigator.vibrate) window.navigator.vibrate(15);
  document.querySelectorAll('.view').forEach(el => el.classList.remove('active'));
  const target = document.getElementById(viewId);
  if (target) target.classList.add('active');
  if (viewId === 'view-home') updateDashboard();
}

/* ── Dashboard ── */
function updateDashboard() {
  // Streak badge
  if (typeof getBibleStreakCount === 'function') {
    const count = getBibleStreakCount();
    const badge = document.getElementById('streak-badge');
    const label = document.getElementById('streak-count-label');
    if (badge && label) {
      if (count > 0) {
        badge.style.display = 'flex';
        label.textContent = `連續靈修 ${count} 天`;
      } else {
        badge.style.display = 'none';
      }
    }
  }

  // Continue reading card
  if (typeof getBibleBookmark === 'function') {
    const bm = getBibleBookmark();
    const card = document.getElementById('continue-card');
    const info = document.getElementById('continue-info');
    if (card && info) {
      if (bm) {
        const verseText = bm.verseIdx !== undefined ? `:${bm.verseIdx + 1}` : '';
        info.textContent = `${bm.bookName} ${bm.chapterIdx + 1}章${verseText}`;
        card.style.display = 'flex';
      } else {
        card.style.display = 'none';
      }
    }
  }

  // Daily verse card
  if (typeof getDailyVerseForHome === 'function') {
    const dv = getDailyVerseForHome();
    if (dv) {
      const verseEl = document.getElementById('dvc-verse-text');
      const refEl   = document.getElementById('dvc-verse-ref');
      if (verseEl && refEl) {
        // Extract text and reference from format "verse（ref）"
        const refMatch = dv.text.match(/（(.+?)）$/);
        if (refMatch) {
          verseEl.textContent = dv.text.replace(/（.+?）$/, '').trim();
          refEl.textContent   = refMatch[1];
        } else {
          verseEl.textContent = dv.text;
          refEl.textContent   = '';
        }
      }
    }
  }
}

/* ── Testament Tab ── */
function switchTestamentTab(tab) {
  const otGrid = document.getElementById('bible-ot-grid');
  const ntGrid = document.getElementById('bible-nt-grid');
  const otTab  = document.getElementById('tab-ot');
  const ntTab  = document.getElementById('tab-nt');
  if (tab === 'ot') {
    if (otGrid) otGrid.style.display = 'grid';
    if (ntGrid) ntGrid.style.display = 'none';
    otTab?.classList.add('active');
    ntTab?.classList.remove('active');
  } else {
    if (otGrid) otGrid.style.display = 'none';
    if (ntGrid) ntGrid.style.display = 'grid';
    ntTab?.classList.add('active');
    otTab?.classList.remove('active');
  }
}

/* ── Search Clear ── */
function clearBibleSearch() {
  const input       = document.getElementById('bible-search-input');
  const results     = document.getElementById('bible-search-results');
  const clearBtn    = document.getElementById('search-clear-btn');
  const testTabs    = document.getElementById('testament-tabs');
  const otGrid      = document.getElementById('bible-ot-grid');
  const ntGrid      = document.getElementById('bible-nt-grid');
  const otTab       = document.getElementById('tab-ot');
  const ntTab       = document.getElementById('tab-nt');

  if (input)   input.value = '';
  if (results) { results.innerHTML = ''; results.style.display = 'none'; }
  if (clearBtn)  clearBtn.style.display = 'none';
  if (testTabs)  testTabs.style.display = 'flex';
  // Reset to OT tab
  if (otGrid) otGrid.style.display = 'grid';
  if (ntGrid) ntGrid.style.display = 'none';
  otTab?.classList.add('active');
  ntTab?.classList.remove('active');
}

/* ── Home CTA Handlers ── */
async function openBibleToVerse() {
  const dv = typeof getDailyVerseForHome === 'function' ? getDailyVerseForHome() : null;
  await openBible();
  if (dv && dv.bookIdx !== undefined && dv.chapterIdx !== undefined) {
    if (typeof _bibleSelectBook === 'function') {
      _bibleSelectBook(dv.bookIdx);
      setTimeout(() => {
        if (typeof _bibleSelectChapter === 'function') _bibleSelectChapter(dv.chapterIdx);
      }, 100);
    }
  }
}

async function openBibleContinue() {
  await openBible();
  const bm = typeof getBibleBookmark === 'function' ? getBibleBookmark() : null;
  if (!bm) return;
  if (typeof _bibleSelectBook === 'function') {
    _bibleSelectBook(bm.bookIdx);
    setTimeout(() => {
      if (typeof _bibleSelectChapter === 'function') {
        _bibleSelectChapter(bm.chapterIdx);
        if (bm.verseIdx !== undefined) {
          setTimeout(() => {
            if (typeof _scrollToVerse === 'function') _scrollToVerse(bm.verseIdx);
          }, 400);
        }
      }
    }, 100);
  }
}

async function openNotesOverview() {
  await openBible();
  if (typeof bibleShowNotesOverview === 'function') bibleShowNotesOverview();
}

/* ── Global Search State ── */
let _bibleSearchFilter = 'all';

function setSearchFilter(filter) {
  _bibleSearchFilter = filter;
  document.querySelectorAll('#search-filter-tabs .bible-bottom-tab').forEach(b => b.classList.remove('active'));
  event.target.classList.add('active');
  const query = document.getElementById('global-search-input')?.value;
  if(query) bibleGlobalSearch();
}

async function bibleGlobalSearch() {
  const query = document.getElementById('global-search-input')?.value?.trim();
  const resultsEl = document.getElementById('global-search-results');
  if (!query) {
    if(resultsEl) resultsEl.innerHTML = '';
    return;
  }
  
  if(resultsEl) resultsEl.innerHTML = '<div style="padding:16px; text-align:center;">🔍 搜尋中...</div>';
  
  // Ensure IDB is populated before searching
  const isInit = await idbGetMeta('initialized');
  if (!isInit) {
    // Need to populate IDB first
    try {
      const fetchRes = await fetch('./bible.json');
      const rawJson = await fetchRes.json();
      await idbPopulateBible(rawJson);
      if (!window.bibleData) window.bibleData = await idbGetMeta('books');
    } catch(e) {
      if(resultsEl) resultsEl.innerHTML = '<div style="padding:16px; text-align:center; color:var(--text-muted)">請先開啟聖經完成初始化</div>';
      return;
    }
  }
  if (!window.bibleData) {
    window.bibleData = await idbGetMeta('books');
  }
  
  // Search from IDB
  try {
    const res = await idbSearchGlobal(query, _bibleSearchFilter);
    if(res.length === 0) {
      resultsEl.innerHTML = '<div style="padding:16px; text-align:center; color:var(--text-muted)">找不到相關經文</div>';
      return;
    }
    
    let html = '';
    res.forEach(item => {
      // Highlight the query
      const highlightedText = item.text.replace(new RegExp(query, 'gi'), match => `<span class="search-highlight">${match}</span>`);
      const refName = (typeof bibleData !== 'undefined' && bibleData[item.bookIdx]) ? bibleData[item.bookIdx].name : `Book ${item.bookIdx}`;
      
      html += `<div class="search-result-item" onclick="openBibleToCoordinate(${item.bookIdx}, ${item.chapterIdx}, ${item.verseIdx})">
        <div class="search-result-ref">${refName} ${item.chapterIdx + 1}:${item.verseIdx + 1}</div>
        <div class="search-result-text">${highlightedText}</div>
      </div>`;
    });
    
    if (resultsEl) resultsEl.innerHTML = html;
  } catch (err) {
    if(resultsEl) resultsEl.innerHTML = '<div style="padding:16px; text-align:center; color:red">搜尋發生錯誤</div>';
    console.error(err);
  }
}

async function openBibleToCoordinate(bookIdx, chapIdx, verseIdx) {
  await openBible();
  if (typeof _bibleSelectBook === 'function') {
    _bibleSelectBook(bookIdx);
    setTimeout(() => {
      if (typeof _bibleSelectChapter === 'function') {
        _bibleSelectChapter(chapIdx);
        setTimeout(() => {
          if (typeof _scrollToVerse === 'function') _scrollToVerse(verseIdx);
        }, 400);
      }
    }, 100);
  }
}

/* ── App Settings / Backup ── */
function openAppSettings() {
  document.getElementById('modal-app-settings').classList.add('active');
}

function closeAppSettings(e) {
  if (e && e.target !== e.currentTarget && e.target.nodeName !== 'BUTTON' && !e.target.classList.contains('btn-cancel')) return;
  document.getElementById('modal-app-settings').classList.remove('active');
}

function exportBibleData() {
  const dataToExport = {};
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    // Export both core configs and hw_bible_ configs
    if (key && (key.startsWith('hw_bible_') || key === 'hw_theme' || key === 'hw_tts_rate')) {
      dataToExport[key] = localStorage.getItem(key);
    }
  }
  const jsonStr = JSON.stringify(dataToExport, null, 2);
  const blob = new Blob([jsonStr], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  
  const a = document.createElement('a');
  a.href = url;
  a.download = `bible-whisper-backup-${new Date().toISOString().split('T')[0]}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  
  showToast('✅ 備份檔已匯出');
}

function importBibleData(event) {
  const file = event.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const data = JSON.parse(e.target.result);
      if (!data || typeof data !== 'object') throw new Error('Invalid JSON structure');
      
      let importedCount = 0;
      for (const key in data) {
        if (key.startsWith('hw_bible_') || key === 'hw_theme' || key === 'hw_tts_rate') {
          localStorage.setItem(key, data[key]);
          importedCount++;
        }
      }
      showToast(`✅ 成功還原 ${importedCount} 筆設定，即將重新載入...`);
      setTimeout(() => window.location.reload(), 1500);
    } catch (err) {
      console.error(err);
      showToast('❌ 無效的備份檔案');
    }
    // reset input
    event.target.value = '';
  };
  reader.readAsText(file);
}

function repairBibleDatabase() {
  if (!confirm('即將清除並重新下載聖經資料庫。此操作不會刪除您的個人筆記與進度，確定要繼續嗎？')) return;
  
  showToast('正在清除快取與資料庫...');
  
  // Clear IDB
  const dbDeleteReq = indexedDB.deleteDatabase('BibleWhisperDB');
  
  dbDeleteReq.onsuccess = dbDeleteReq.onerror = () => {
    // Unregister SW
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.getRegistrations().then(function(registrations) {
        for(let registration of registrations) {
          registration.unregister();
        }
      });
    }
    
    // Clear caches
    if ('caches' in window) {
      caches.keys().then(function(names) {
        for (let name of names) caches.delete(name);
      });
    }
    
    showToast('清除完成，正在重新載入...');
    setTimeout(() => {
      window.location.reload(true);
    }, 1500);
  };
}

function bibleSetFontFamily(font) {
  const root = document.documentElement;
  if (font === 'sans') root.style.setProperty('--font-serif', 'var(--font-sans)');
  else if (font === 'kaiti') root.style.setProperty('--font-serif', 'var(--font-kaiti)');
  else root.style.setProperty('--font-serif', 'var(--font-serif-default)');
  
  localStorage.setItem('hw_bible_font', font);
  document.querySelectorAll('.settings-font-btn').forEach(b => b.classList.remove('active'));
  const btn = document.getElementById('font-btn-'+font);
  if (btn) btn.classList.add('active');
}

/* ── Init ── */
document.addEventListener('DOMContentLoaded', () => {
  // Apply saved theme
  const savedTheme = localStorage.getItem('hw_theme') || 'light';
  document.documentElement.setAttribute('data-theme', savedTheme);
  
  // Apply saved font
  const savedFont = localStorage.getItem('hw_bible_font') || 'serif';
  bibleSetFontFamily(savedFont);

  // Delay dashboard update so bible-reader.js functions are available
  setTimeout(updateDashboard, 120);
});
