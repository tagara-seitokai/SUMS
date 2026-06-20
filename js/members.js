import { auth, db } from './firebase-init.js';
import { onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/12.14.0/firebase-auth.js';
import {
  collection, getDocs, addDoc, query, where, serverTimestamp
} from 'https://www.gstatic.com/firebasejs/12.14.0/firebase-firestore.js';

let currentUser = null;
let currentMember = null;
const positionOrder = ['顧問', '会長', '副会長', '書記', '会計', 'メンバー'];

const memberList = document.getElementById('memberList');
const addBtn = document.getElementById('addMemberBtn');
const addFormCard = document.getElementById('addFormCard');
const saveAddBtn = document.getElementById('saveAddBtn');
const cancelAddBtn = document.getElementById('cancelAddBtn');
const addError = document.getElementById('addError');
const addName = document.getElementById('addName');
const addAttNum = document.getElementById('addAttNum');
const addPosition = document.getElementById('addPosition');

document.addEventListener('DOMContentLoaded', () => {
  onAuthStateChanged(auth, async (user) => {
    if (!user) { window.location.href = 'index.html'; return; }
    currentUser = user;
    await loadCurrentMember();
    // 权限检查：只有最高权限可进入
    if (!currentMember || (currentMember.role !== 'President' && currentMember.role !== 'Admin')) {
      alert('この機能を利用するには最高権限が必要です。');
      window.location.href = 'dashboard.html';
      return;
    }
    loadMembers();
    bindEvents();
  });
});

async function loadCurrentMember() {
  const q = query(collection(db, 'members'), where('email', '==', currentUser.email));
  const snap = await getDocs(q);
  if (!snap.empty) {
    currentMember = { id: snap.docs[0].id, ...snap.docs[0].data() };
  }
}

async function loadMembers() {
  const snap = await getDocs(collection(db, 'members'));
  const members = [];
  snap.forEach(d => members.push({ id: d.id, ...d.data() }));
  members.sort((a, b) => {
    const ia = positionOrder.indexOf(a.position), ib = positionOrder.indexOf(b.position);
    if (ia !== -1 && ib !== -1) return ia - ib;
    if (ia !== -1) return -1;
    if (ib !== -1) return 1;
    return (a.name || '').localeCompare(b.name || '');
  });
  renderList(members);
}

function renderList(members) {
  if (members.length === 0) {
    memberList.innerHTML = '<div class="text-center py-4 text-muted">メンバーがいません</div>';
    return;
  }
  memberList.innerHTML = '';
  members.forEach(m => {
    const roleLabel = m.role === 'President' ? '最高権限' : '一般権限';
    const div = document.createElement('div');
    div.className = 'member-item';
    div.innerHTML = `
      <div class="member-name">${escapeHtml(m.name)} <span class="badge-role ms-1">${roleLabel}</span></div>
      <div class="member-position">${escapeHtml(m.position || 'メンバー')} · 出席番号 ${m.attendanceNumber || '-'}</div>
      <span class="member-status ${m.active ? 'status-active' : 'status-inactive'}">${m.active ? 'Active' : 'Inactive'}</span>
    `;
    div.addEventListener('click', () => {
      window.location.href = `member_detail.html?id=${m.id}`;
    });
    memberList.appendChild(div);
  });
}

function bindEvents() {
  addBtn.addEventListener('click', () => {
    addFormCard.style.display = 'block';
    addBtn.style.display = 'none';
  });
  cancelAddBtn.addEventListener('click', () => {
    addFormCard.style.display = 'none';
    addBtn.style.display = 'inline-block';
    clearForm();
  });
  saveAddBtn.addEventListener('click', addMember);
}

async function addMember() {
  const name = addName.value.trim();
  const attNum = parseInt(addAttNum.value) || 0;
  const position = addPosition.value;
  if (!name) {
    addError.textContent = '氏名を入力してください。';
    addError.style.display = 'block';
    return;
  }
  saveAddBtn.disabled = true; saveAddBtn.textContent = '保存中…';
  try {
    await addDoc(collection(db, 'members'), {
      name, attendanceNumber: attNum, position,
      role: 'Member',
      email: null,
      active: true,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });
    addFormCard.style.display = 'none';
    addBtn.style.display = 'inline-block';
    clearForm();
    loadMembers();
  } catch (e) {
    console.error(e);
    addError.textContent = '保存に失敗しました。';
    addError.style.display = 'block';
  }
  saveAddBtn.disabled = false; saveAddBtn.textContent = '保存';
}

function clearForm() {
  addName.value = '';
  addAttNum.value = '';
  addPosition.value = 'メンバー';
  addError.style.display = 'none';
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text || '';
  return div.innerHTML;
}