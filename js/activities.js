import { auth, db } from './firebase-init.js';
import { onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/12.14.0/firebase-auth.js';
import { collection, getDocs, query, orderBy } from 'https://www.gstatic.com/firebasejs/12.14.0/firebase-firestore.js';

document.addEventListener('DOMContentLoaded', () => {
  onAuthStateChanged(auth, async (user) => {
    if (!user) { window.location.href = 'index.html'; return; }
    await loadAllActivities();
  });
});

async function loadAllActivities() {
  const feed = document.getElementById('allActivityFeed');
  try {
    const q = query(collection(db, 'activityLogs'), orderBy('timestamp', 'desc'));
    const snap = await getDocs(q);
    feed.innerHTML = '';
    if (snap.empty) {
      feed.innerHTML = '<div class="empty-hint">アクティビティはまだありません</div>';
      return;
    }
    snap.forEach(doc => {
      const l = doc.data();
      const time = l.timestamp?.toDate().toLocaleString('ja-JP') || '';
      const initials = l.userName?.charAt(0) || '?';
      const div = document.createElement('div');
      div.className = 'activity-item';
      div.dataset.time = time;
      div.dataset.user = l.userName || '';
      div.dataset.action = l.action || '';
      div.dataset.taskTitle = l.taskTitle || '';
      div.dataset.taskId = l.taskId || '';
      div.innerHTML = `
        <div class="activity-avatar">${initials}</div>
        <div class="activity-text">${l.action || ''}</div>
        <div class="activity-time">${time}</div>
      `;
      div.addEventListener('click', () => {
        document.getElementById('activityDetailTime').textContent = div.dataset.time;
        document.getElementById('activityDetailUser').textContent = div.dataset.user;
        document.getElementById('activityDetailAction').textContent = div.dataset.action;
        document.getElementById('activityDetailTask').textContent = div.dataset.taskTitle || '関連タスクなし';
        const link = document.getElementById('activityDetailLink');
        if (div.dataset.taskId) {
          link.href = `task_detail.html?id=${div.dataset.taskId}`;
          link.style.display = 'inline-block';
        } else {
          link.style.display = 'none';
        }
        new bootstrap.Modal(document.getElementById('activityDetailModal')).show();
      });
      feed.appendChild(div);
    });
  } catch (e) {
    console.error('アクティビティ読み込みエラー:', e);
    feed.innerHTML = '<div class="empty-hint">アクティビティの読み込みに失敗しました</div>';
  }
}