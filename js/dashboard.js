import { auth, db } from './firebase-init.js';
import { onAuthStateChanged, signOut } from 'https://www.gstatic.com/firebasejs/12.14.0/firebase-auth.js';
import {
  doc, getDoc,
  collection, getDocs, addDoc,
  query, where, orderBy, serverTimestamp
} from 'https://www.gstatic.com/firebasejs/12.14.0/firebase-firestore.js';

let currentUser = null;
let currentMember = null;
const today = new Date();
today.setHours(0, 0, 0, 0);

// DOM
const welcomeName = document.getElementById('welcomeName');
const welcomeDate = document.getElementById('welcomeDate');
const logoutBtn = document.getElementById('logoutBtn');
const orgMembers = document.getElementById('orgMembers');
const orgProjects = document.getElementById('orgProjects');
const orgCases = document.getElementById('orgCases');
const orgTasks = document.getElementById('orgTasks');

const commentModal = new bootstrap.Modal(document.getElementById('commentModal'));

document.addEventListener('DOMContentLoaded', () => {
  onAuthStateChanged(auth, async (user) => {
    if (user) {
      currentUser = user;
      await loadMemberProfile();
      attachLogout();
      attachQuickCards();
      await loadOrgOverview();
    } else {
      window.location.href = 'index.html';
    }
  });
});

// ========== 用户档案 ==========
async function loadMemberProfile() {
  try {
    if (currentUser.email) {
      const q = query(collection(db, 'members'), where('email', '==', currentUser.email));
      const snap = await getDocs(q);
      if (!snap.empty) {
        currentMember = { id: snap.docs[0].id, ...snap.docs[0].data() };
        welcomeName.textContent = `${currentMember.name}さん、お疲れ様です`;
        renderDate();
        return;
      }
    }
    const snap = await getDoc(doc(db, 'members', currentUser.uid));
    if (snap.exists()) {
      currentMember = { id: snap.id, ...snap.data() };
      welcomeName.textContent = `${currentMember.name}さん、お疲れ様です`;
    } else {
      currentMember = { id: currentUser.uid, name: currentUser.email || 'ユーザー', role: 'Member', active: true };
      welcomeName.textContent = `${currentMember.name}さん、お疲れ様です`;
    }
  } catch (e) {
    currentMember = { id: currentUser.uid, name: 'ユーザー', role: 'Member', active: true };
    welcomeName.textContent = 'ようこそ';
  }
  renderDate();
}

function renderDate() {
  const opts = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
  welcomeDate.textContent = today.toLocaleDateString('ja-JP', opts);
}

// ========== 退出 ==========
function attachLogout() {
  logoutBtn.addEventListener('click', async () => {
    await signOut(auth);
    window.location.href = 'index.html';
  });
}

// ========== 快捷卡片 + 权限 ==========
function attachQuickCards() {
  document.getElementById('cardSchedules').addEventListener('click', () => window.location.href = 'schedules.html');
  document.getElementById('cardProjects').addEventListener('click', () => window.location.href = 'projects.html');
  document.getElementById('cardCases').addEventListener('click', () => window.location.href = 'cases.html');
  document.getElementById('cardTasks').addEventListener('click', () => window.location.href = 'tasks.html');
  document.getElementById('cardMeetings').addEventListener('click', () => window.location.href = 'meetings.html');

  const memberCard = document.getElementById('cardMembers');
  memberCard.addEventListener('click', () => {
    if (currentMember && (currentMember.role === 'President' || currentMember.role === 'Admin')) {
      window.location.href = 'members.html';
    } else {
      alert('この機能を利用するには最高権限が必要です。');
    }
  });

  document.getElementById('commentButton').addEventListener('click', openCommentModal);
}

// ========== 组织概览（极简可靠版） ==========
async function loadOrgOverview() {
  // 直接读取每个集合，捕获错误并设置文字为错误信息
  try {
    const msSnap = await getDocs(collection(db, 'members'));
    orgMembers.textContent = msSnap.size;
  } catch (e) {
    console.error('members read failed', e);
    orgMembers.textContent = '?';
  }

  try {
    const psSnap = await getDocs(collection(db, 'projects'));
    orgProjects.textContent = psSnap.size;
  } catch (e) {
    console.error('projects read failed', e);
    orgProjects.textContent = '?';
  }

  try {
    const csSnap = await getDocs(collection(db, 'cases'));
    orgCases.textContent = csSnap.size;
  } catch (e) {
    console.error('cases read failed', e);
    orgCases.textContent = '?';
  }

  try {
    const tsSnap = await getDocs(collection(db, 'tasks'));
    orgTasks.textContent = tsSnap.size;
  } catch (e) {
    console.error('tasks read failed', e);
    orgTasks.textContent = '?';
  }
}

// ========== 评论弹窗 ==========
async function openCommentModal() {
  const commentListView = document.getElementById('commentListView');
  const commentInputView = document.getElementById('commentInputView');
  const commentModalTitle = document.getElementById('commentModalTitle');

  if (currentMember && (currentMember.role === 'President' || currentMember.role === 'Admin')) {
    commentModalTitle.textContent = '会長へのコメント一覧';
    commentListView.style.display = 'block';
    commentInputView.style.display = 'none';
    await loadComments();
  } else {
    commentModalTitle.textContent = '会長へコメントを送る';
    commentListView.style.display = 'none';
    commentInputView.style.display = 'block';
    document.getElementById('commentText').value = '';
    document.getElementById('commentSuccess').style.display = 'none';
  }
  commentModal.show();
}

async function loadComments() {
  const list = document.getElementById('commentList');
  try {
    const q = query(collection(db, 'comments'), orderBy('timestamp', 'desc'));
    const snap = await getDocs(q);
    list.innerHTML = '';
    if (snap.empty) {
      list.innerHTML = '<div class="text-muted">まだコメントはありません</div>';
      return;
    }
    snap.forEach(doc => {
      const c = doc.data();
      const time = c.timestamp?.toDate().toLocaleString('ja-JP') || '';
      const div = document.createElement('div');
      div.className = 'comment-item';
      div.innerHTML = `
        <div><span class="comment-from">${escapeHtml(c.from || '不明')}</span><span class="comment-time">${time}</span></div>
        <div class="comment-text">${escapeHtml(c.text || '')}</div>
      `;
      list.appendChild(div);
    });
  } catch (e) {
    console.error('コメント読み込みエラー:', e);
    list.innerHTML = '<div class="text-muted">コメントの読み込みに失敗しました</div>';
  }
}

// 提交评论
document.addEventListener('DOMContentLoaded', () => {
  setTimeout(() => {
    const submitBtn = document.getElementById('submitCommentBtn');
    if (submitBtn) {
      submitBtn.addEventListener('click', async () => {
        const text = document.getElementById('commentText').value.trim();
        if (!text) { alert('コメントを入力してください。'); return; }
        try {
          await addDoc(collection(db, 'comments'), {
            from: currentMember?.name || '不明',
            userId: currentUser?.uid || '',
            text: text,
            timestamp: serverTimestamp()
          });
          document.getElementById('commentText').value = '';
          document.getElementById('commentSuccess').style.display = 'block';
          setTimeout(() => {
            document.getElementById('commentSuccess').style.display = 'none';
          }, 2000);
        } catch (e) {
          console.error('コメント送信エラー:', e);
          alert('送信に失敗しました。');
        }
      });
    }
  }, 500);
});

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text || '';
  return div.innerHTML;
}