/* ============================================================ */
/* === Bible Whisper — IndexedDB Core (Native Promise)       === */
/* ============================================================ */

const DB_NAME = 'BibleWhisperDB';
const DB_VERSION = 3; // Bump to force re-init with fixed schema
let _bwDbInstance = null;

function initIDB() {
  return new Promise((resolve, reject) => {
    if (_bwDbInstance) return resolve(_bwDbInstance);

    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = e => {
      const db = e.target.result;
      // Clear old stores on upgrade to purge broken data
      if (db.objectStoreNames.contains('metadata')) db.deleteObjectStore('metadata');
      if (db.objectStoreNames.contains('chapters')) db.deleteObjectStore('chapters');
      db.createObjectStore('metadata');
      db.createObjectStore('chapters');
    };

    req.onsuccess = e => {
      _bwDbInstance = e.target.result;
      resolve(_bwDbInstance);
    };

    req.onerror = e => reject('IDB Error: ' + e.target.error);
  });
}

function idbSetMeta(key, val) {
  return initIDB().then(db => new Promise((resolve, reject) => {
    const tx = db.transaction('metadata', 'readwrite');
    tx.objectStore('metadata').put(val, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  }));
}

function idbGetMeta(key) {
  return initIDB().then(db => new Promise((resolve, reject) => {
    const tx = db.transaction('metadata', 'readonly');
    const req = tx.objectStore('metadata').get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  }));
}

function idbGetChapter(bookIdx, chapIdx) {
  return initIDB().then(db => new Promise((resolve, reject) => {
    const tx = db.transaction('chapters', 'readonly');
    const req = tx.objectStore('chapters').get(`${bookIdx}_${chapIdx}`);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  }));
}

// Bulk put all chapters
async function idbPopulateBible(bibleJson) {
  const db = await initIDB();
  
  // Extract purely the headers for lightweight mapping
  const bookHeaders = bibleJson.map(b => ({
    name: b.name,
    abbrev: b.abbrev,
    chapterCount: b.chapters.length
  }));

  await idbSetMeta('books', bookHeaders);

  // Bulk insert chapters
  return new Promise((resolve, reject) => {
    // Large transactions can be chunky, we do it in one sweep for safety.
    const tx = db.transaction('chapters', 'readwrite');
    const store = tx.objectStore('chapters');
    
    for (let bIdx = 0; bIdx < bibleJson.length; bIdx++) {
      const book = bibleJson[bIdx];
      for (let cIdx = 0; cIdx < book.chapters.length; cIdx++) {
        store.put(book.chapters[cIdx], `${bIdx}_${cIdx}`);
      }
    }

    tx.oncomplete = () => {
      idbSetMeta('initialized', true).then(resolve);
    };
    tx.onerror = () => reject(tx.error);
  });
}

async function idbSearchGlobal(query, filter = 'all') {
  // filter: 'all', 'ot', 'nt'
  const db = await initIDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('chapters', 'readonly');
    const store = tx.objectStore('chapters');
    const req = store.openCursor();
    const results = [];
    
    req.onsuccess = e => {
      const cursor = e.target.result;
      if (cursor) {
        const key = cursor.key; // "0_1"
        const [bStr, cStr] = key.split('_');
        const bIdx = parseInt(bStr);
        const cIdx = parseInt(cStr);
        
        let inScope = true;
        if (filter === 'ot' && bIdx >= 39) inScope = false;
        if (filter === 'nt' && bIdx < 39) inScope = false;

        if (inScope) {
          const verses = cursor.value;
          for (let v = 0; v < verses.length; v++) {
            if (verses[v].includes(query)) {
              results.push({ bookIdx: bIdx, chapterIdx: cIdx, verseIdx: v, text: verses[v] });
              // Cap at 200 matches to prevent freezing
              if (results.length >= 200) {
                return resolve(results);
              }
            }
          }
        }
        cursor.continue();
      } else {
        // Done
        resolve(results);
      }
    };
    req.onerror = () => reject(req.error);
  });
}
