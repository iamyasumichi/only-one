// Firebase Sync Module
// 注意: Firebase設定は index.html でグローバルに読み込まれています

// ========================================
// Firebase設定
// ========================================
const firebaseConfig = {
    apiKey: "AIzaSyAQgnR4LRzwT0e7NWPAvXxzeRqKetGPLqc",
    authDomain: "only-one-note.firebaseapp.com",
    databaseURL: "https://only-one-note-default-rtdb.asia-southeast1.firebasedatabase.app",
    projectId: "only-one-note",
    storageBucket: "only-one-note.firebasestorage.app",
    messagingSenderId: "986912998769",
    appId: "1:986912998769:web:6deee8136cd740ad3662d0",
    measurementId: "G-VENRDF7L6X"
};
// ========================================

let db = null;
let auth = null;
let userId = null;
let isOnline = navigator.onLine;
let syncCallbacks = [];

// ローカルキャッシュ
const LOCAL_STORAGE_KEY = 'onlyone_memos_cache';

// 同期状態
export const SyncState = {
    SYNCING: 'syncing',
    SYNCED: 'synced',
    OFFLINE: 'offline'
};

let currentSyncState = SyncState.OFFLINE;
let syncStateListeners = [];

// 同期状態変更リスナー
export function onSyncStateChange(callback) {
    syncStateListeners.push(callback);
    callback(currentSyncState);
    return () => {
        syncStateListeners = syncStateListeners.filter(cb => cb !== callback);
    };
}

function setSyncState(state) {
    currentSyncState = state;
    syncStateListeners.forEach(cb => cb(state));
}

// Firebase初期化
export async function initFirebase() {
    try {
        const { initializeApp, getDatabase, getAuth, signInAnonymously, onAuthStateChanged } = window.firebaseModules;

        // 設定が未編集の場合はオフラインモードで動作
        if (firebaseConfig.apiKey === "YOUR_API_KEY") {
            console.log('Firebase未設定: ローカルモードで動作します');
            setSyncState(SyncState.OFFLINE);
            return false;
        }

        const app = initializeApp(firebaseConfig);
        db = getDatabase(app);
        auth = getAuth(app);

        // 匿名認証
        await signInAnonymously(auth);

        return new Promise((resolve) => {
            onAuthStateChanged(auth, (user) => {
                if (user) {
                    userId = user.uid;
                    console.log('Firebase認証成功:', userId);
                    setSyncState(SyncState.SYNCED);
                    resolve(true);
                } else {
                    setSyncState(SyncState.OFFLINE);
                    resolve(false);
                }
            });
        });
    } catch (error) {
        console.error('Firebase初期化エラー:', error);
        setSyncState(SyncState.OFFLINE);
        return false;
    }
}

// オンライン/オフライン監視
window.addEventListener('online', () => {
    isOnline = true;
    if (db && userId) {
        setSyncState(SyncState.SYNCED);
    }
});

window.addEventListener('offline', () => {
    isOnline = false;
    setSyncState(SyncState.OFFLINE);
});

// メモ一覧の監視
export function subscribeToMemos(callback) {
    syncCallbacks.push(callback);

    // ローカルキャッシュを即座に返す
    const cached = getLocalCache();
    if (cached) {
        callback(cached);
    }

    // Firebaseが有効な場合はリアルタイム監視
    if (db && userId) {
        const { ref, onValue } = window.firebaseModules;
        const memosRef = ref(db, `users/${userId}/memos`);

        onValue(memosRef, (snapshot) => {
            setSyncState(SyncState.SYNCED);
            const data = snapshot.val();
            const memos = data ? Object.entries(data).map(([id, memo]) => ({ id, ...memo })) : [];
            setLocalCache(memos);
            callback(memos);
        }, (error) => {
            console.error('Firebase読み込みエラー:', error);
            setSyncState(SyncState.OFFLINE);
        });
    }

    return () => {
        syncCallbacks = syncCallbacks.filter(cb => cb !== callback);
    };
}

// メモ作成
export async function createMemo(title) {
    const memo = {
        title,
        items: [],
        createdAt: Date.now(),
        updatedAt: Date.now()
    };

    if (db && userId) {
        try {
            setSyncState(SyncState.SYNCING);
            const { ref, push } = window.firebaseModules;
            const memosRef = ref(db, `users/${userId}/memos`);
            const newRef = await push(memosRef, memo);
            return { id: newRef.key, ...memo };
        } catch (error) {
            console.error('メモ作成エラー:', error);
            setSyncState(SyncState.OFFLINE);
        }
    }

    // オフライン: ローカルに保存
    const id = 'local_' + Date.now();
    const newMemo = { id, ...memo };
    const memos = getLocalCache() || [];
    memos.push(newMemo);
    setLocalCache(memos);
    notifyCallbacks(memos);
    return newMemo;
}

// メモ更新
export async function updateMemo(memoId, updates) {
    updates.updatedAt = Date.now();

    if (db && userId && !memoId.startsWith('local_')) {
        try {
            setSyncState(SyncState.SYNCING);
            const { ref, update } = window.firebaseModules;
            const memoRef = ref(db, `users/${userId}/memos/${memoId}`);
            await update(memoRef, updates);
            return true;
        } catch (error) {
            console.error('メモ更新エラー:', error);
            setSyncState(SyncState.OFFLINE);
        }
    }

    // オフライン: ローカルを更新
    const memos = getLocalCache() || [];
    const index = memos.findIndex(m => m.id === memoId);
    if (index !== -1) {
        memos[index] = { ...memos[index], ...updates };
        setLocalCache(memos);
        notifyCallbacks(memos);
    }
    return true;
}

// メモ削除
export async function deleteMemo(memoId) {
    if (db && userId && !memoId.startsWith('local_')) {
        try {
            setSyncState(SyncState.SYNCING);
            const { ref, remove } = window.firebaseModules;
            const memoRef = ref(db, `users/${userId}/memos/${memoId}`);
            await remove(memoRef);
            return true;
        } catch (error) {
            console.error('メモ削除エラー:', error);
            setSyncState(SyncState.OFFLINE);
        }
    }

    // オフライン: ローカルから削除
    const memos = (getLocalCache() || []).filter(m => m.id !== memoId);
    setLocalCache(memos);
    notifyCallbacks(memos);
    return true;
}

// ローカルキャッシュ操作
function getLocalCache() {
    try {
        const data = localStorage.getItem(LOCAL_STORAGE_KEY);
        return data ? JSON.parse(data) : null;
    } catch {
        return null;
    }
}

function setLocalCache(memos) {
    try {
        localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(memos));
    } catch (error) {
        console.error('キャッシュ保存エラー:', error);
    }
}

function notifyCallbacks(memos) {
    syncCallbacks.forEach(cb => cb(memos));
}
