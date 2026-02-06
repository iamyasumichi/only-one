// Main Application
import { initFirebase, subscribeToMemos, createMemo, updateMemo, deleteMemo, onSyncStateChange, SyncState } from './firebase-sync.js';
import { initOutliner, loadMemo, addItem, getItems, searchInMemo, indentCurrentItem, outdentCurrentItem } from './outliner.js';

// ===== State =====
let memos = [];
let currentMemoId = null;
let filteredMemos = [];

// ===== DOM Elements =====
const listView = document.getElementById('list-view');
const editorView = document.getElementById('editor-view');
const memoList = document.getElementById('memo-list');
const globalSearch = document.getElementById('global-search');
const editorSearch = document.getElementById('editor-search');
const memoTitle = document.getElementById('memo-title');
const syncStatus = document.getElementById('sync-status');

// Buttons
const addMemoBtn = document.getElementById('add-memo-btn');
const backBtn = document.getElementById('back-btn');
const deleteMemoBtn = document.getElementById('delete-memo-btn');
const addItemBtn = document.getElementById('add-item-btn');
const indentBtn = document.getElementById('indent-btn');
const outdentBtn = document.getElementById('outdent-btn');

// Modal
const newMemoModal = document.getElementById('new-memo-modal');
const newMemoTitleInput = document.getElementById('new-memo-title');
const createMemoBtn = document.getElementById('create-memo');
const cancelNewMemoBtn = document.getElementById('cancel-new-memo');

// ===== Init =====
async function init() {
    // Firebase初期化
    await initFirebase();

    // アウトライナー初期化
    initOutliner('outliner', handleOutlinerChange);

    // メモ購読
    subscribeToMemos((data) => {
        memos = data.sort((a, b) => b.updatedAt - a.updatedAt);
        filterAndRenderMemos();
    });

    // 同期状態監視
    onSyncStateChange(updateSyncStatus);

    // イベントリスナー設定
    setupEventListeners();
}

// ===== Event Listeners =====
function setupEventListeners() {
    // 新規メモボタン
    addMemoBtn.addEventListener('click', showNewMemoModal);

    // モーダル
    createMemoBtn.addEventListener('click', handleCreateMemo);
    cancelNewMemoBtn.addEventListener('click', hideNewMemoModal);
    newMemoModal.addEventListener('click', (e) => {
        if (e.target === newMemoModal) hideNewMemoModal();
    });
    newMemoTitleInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') handleCreateMemo();
        if (e.key === 'Escape') hideNewMemoModal();
    });

    // 戻るボタン
    backBtn.addEventListener('click', goBackToList);

    // 削除ボタン
    deleteMemoBtn.addEventListener('click', handleDeleteMemo);

    // アイテム追加ボタン
    addItemBtn.addEventListener('click', addItem);

    // インデント操作
    if (indentBtn) indentBtn.addEventListener('click', indentCurrentItem);
    if (outdentBtn) outdentBtn.addEventListener('click', outdentCurrentItem);

    // 検索
    globalSearch.addEventListener('input', (e) => {
        filterAndRenderMemos(e.target.value);
    });

    editorSearch.addEventListener('input', (e) => {
        searchInMemo(e.target.value);
    });

    // タイトル変更
    memoTitle.addEventListener('input', handleTitleChange);
    memoTitle.addEventListener('blur', handleTitleChange);

    // メモリスト クリック
    memoList.addEventListener('click', (e) => {
        const memoItem = e.target.closest('.memo-item');
        if (memoItem) {
            openMemo(memoItem.dataset.id);
        }
    });
}

// ===== Sync Status =====
function updateSyncStatus(state) {
    syncStatus.classList.remove('syncing', 'synced', 'offline');
    syncStatus.classList.add(state);

    const titles = {
        [SyncState.SYNCING]: '同期中...',
        [SyncState.SYNCED]: '同期済み',
        [SyncState.OFFLINE]: 'オフライン'
    };
    syncStatus.title = titles[state];
}

// ===== Memo List =====
function filterAndRenderMemos(query = '') {
    const q = query.toLowerCase();
    filteredMemos = q
        ? memos.filter(m =>
            m.title.toLowerCase().includes(q) ||
            getContentText(m.items).toLowerCase().includes(q)
        )
        : memos;
    renderMemoList();
}

function getContentText(items) {
    if (!items) return '';
    return items.map(item => {
        let text = item.content || '';
        if (item.children) {
            text += ' ' + getContentText(item.children);
        }
        return text;
    }).join(' ');
}

function renderMemoList() {
    if (filteredMemos.length === 0) {
        memoList.innerHTML = `
            <div class="empty-state">
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                    <polyline points="14 2 14 8 20 8"/>
                    <line x1="16" y1="13" x2="8" y2="13"/>
                    <line x1="16" y1="17" x2="8" y2="17"/>
                </svg>
                <p>メモがありません<br>右下の + ボタンで作成</p>
            </div>
        `;
        return;
    }

    memoList.innerHTML = filteredMemos.map(memo => `
        <div class="memo-item" data-id="${memo.id}">
            <div>
                <div class="memo-title">${escapeHtml(memo.title) || '無題'}</div>
                <div class="memo-date">${formatDate(memo.updatedAt)}</div>
            </div>
            <span class="memo-arrow">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <polyline points="9 18 15 12 9 6"/>
                </svg>
            </span>
        </div>
    `).join('');
}

// ===== Modal =====
function showNewMemoModal() {
    newMemoModal.classList.add('active');
    newMemoTitleInput.value = '';
    newMemoTitleInput.focus();
}

function hideNewMemoModal() {
    newMemoModal.classList.remove('active');
}

async function handleCreateMemo() {
    const title = newMemoTitleInput.value.trim() || '無題';
    hideNewMemoModal();

    const memo = await createMemo(title);
    if (memo) {
        openMemo(memo);  // メモオブジェクトを直接渡す
    }
}

// ===== Editor =====
function openMemo(idOrMemo) {
    let memo;
    if (typeof idOrMemo === 'string') {
        memo = memos.find(m => m.id === idOrMemo);
    } else {
        memo = idOrMemo;
    }
    if (!memo) return;

    currentMemoId = memo.id;
    memoTitle.value = memo.title;
    editorSearch.value = '';

    loadMemo(memo);
    showView('editor');
}

function goBackToList() {
    currentMemoId = null;
    editorSearch.value = '';
    showView('list');
}

function showView(view) {
    listView.classList.toggle('active', view === 'list');
    editorView.classList.toggle('active', view === 'editor');
}

let titleDebounce = null;
function handleTitleChange() {
    if (!currentMemoId) return;

    clearTimeout(titleDebounce);
    titleDebounce = setTimeout(() => {
        updateMemo(currentMemoId, { title: memoTitle.value });
    }, 500);
}

function handleOutlinerChange(items) {
    if (!currentMemoId) return;
    updateMemo(currentMemoId, { items });
}

async function handleDeleteMemo() {
    if (!currentMemoId) return;

    if (confirm('このメモを削除しますか？')) {
        await deleteMemo(currentMemoId);
        goBackToList();
    }
}

// ===== Utilities =====
function formatDate(timestamp) {
    if (!timestamp) return '';
    const date = new Date(timestamp);
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    const h = String(date.getHours()).padStart(2, '0');
    const min = String(date.getMinutes()).padStart(2, '0');
    return `${y}/${m}/${d} ${h}:${min}`;
}

function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// ===== Start =====
init();
