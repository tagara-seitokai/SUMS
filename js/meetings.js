import { auth, db } from './firebase-init.js';
import { onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/12.14.0/firebase-auth.js';
import {
  collection, getDocs, addDoc, updateDoc, doc, serverTimestamp,
  query, where, orderBy
} from 'https://www.gstatic.com/firebasejs/12.14.0/firebase-firestore.js';

let currentUser = null;
let currentMember = null;
let allMeetings = [];
let allMembers = [];
let currentMeetingId = null;

const createModal = new bootstrap.Modal(document.getElementById('createModal'));
const detailModal = new bootstrap.Modal(document.getElementById('detailModal'));

document.addEventListener('DOMContentLoaded', () => {
  onAuthStateChanged(auth, async (user) => {
    if (!user) { window.location.href = 'index.html'; return; }
    currentUser = user;
    await loadCurrentMember();
    await loadMembers();
    await loadMeetings();
    renderList();
    attachEvents();
  });
});

// ========== 用户信息 ==========
async function loadCurrentMember() {
  const q = query(collection(db, 'members'), where('email', '==', currentUser.email));
  const snap = await getDocs(q);
  if (!snap.empty) {
    currentMember = { id: snap.docs[0].id, ...snap.docs[0].data() };
  }
}

function hasAdminPermission() {
  return currentMember && (currentMember.role === 'President' || currentMember.role === 'Admin');
}

async function loadMembers() {
  const q = query(collection(db, 'members'), where('active', '==', true));
  const snap = await getDocs(q);
  allMembers = [];
  snap.forEach(d => allMembers.push({ id: d.id, name: d.data().name }));
  allMembers.sort((a, b) => a.name.localeCompare(b.name));
}

async function loadMeetings() {
  const q = query(collection(db, 'meetings'), orderBy('date', 'desc'));
  const snap = await getDocs(q);
  allMeetings = [];
  snap.forEach(d => {
    const data = d.data();
    allMeetings.push({
      id: d.id,
      title: data.title || '',
      date: data.date || '',
      time: data.time || '',
      location: data.location || '',
      attendees: data.attendees || [],
      agendas: data.agendas || [],
      carryover: data.carryover || []
    });
  });
}

// ========== 状态自动判定 ==========
function getMeetingStatus(dateStr, timeStr) {
  if (!dateStr || !timeStr) return 'upcoming';
  const [startTime, endTime] = timeStr.split('-').map(s => s.trim());
  if (!startTime) return 'upcoming';
  const now = new Date();
  const startDate = new Date(dateStr + 'T' + startTime.padStart(5, '0') + ':00');
  const endDate = new Date(dateStr + 'T' + (endTime || startTime).padStart(5, '0') + ':00');
  if (now < startDate) return 'upcoming';
  if (now >= startDate && now <= endDate) return 'ongoing';
  return 'completed';
}

// ========== 渲染列表 ==========
function renderList() {
  const filter = document.getElementById('filterStatus').value;
  const container = document.getElementById('meetingList');

  const meetingsWithStatus = allMeetings.map(m => ({
    ...m,
    computedStatus: getMeetingStatus(m.date, m.time)
  }));

  const filtered = filter === 'all'
    ? meetingsWithStatus
    : meetingsWithStatus.filter(m => m.computedStatus === filter);

  if (filtered.length === 0) {
    container.innerHTML = '<div class="empty-hint">会議がありません</div>';
    return;
  }

  container.innerHTML = filtered.map(m => {
    const d = new Date(m.date);
    const day = d.getDate();
    const month = d.getMonth() + 1 + '月';
    let badge = '';
    if (m.computedStatus === 'upcoming') badge = '<span class="meeting-badge badge-upcoming">予定</span>';
    else if (m.computedStatus === 'ongoing') badge = '<span class="meeting-badge badge-ongoing">会議中</span>';
    else badge = '<span class="meeting-badge badge-completed">完了</span>';
    return `
      <div class="meeting-card" data-id="${m.id}">
        <div class="meeting-date-box">
          <div class="meeting-date-day">${day}</div>
          <div class="meeting-date-month">${month}</div>
        </div>
        <div class="meeting-info">
          <div class="meeting-title">${escapeHtml(m.title)}</div>
          <div class="meeting-meta">${m.time} @ ${escapeHtml(m.location || '未定')} · 👥 ${m.attendees.length}名</div>
        </div>
        ${badge}
      </div>
    `;
  }).join('');

  document.querySelectorAll('.meeting-card').forEach(card => {
    card.addEventListener('click', () => openDetailModal(card.dataset.id));
  });
}

// ========== 详情弹窗 ==========
function openDetailModal(id) {
  currentMeetingId = id;
  const m = allMeetings.find(mt => mt.id === id);
  if (!m) return;

  document.getElementById('detailTitle').textContent = m.title || '無題';
  document.getElementById('detailDateTime').textContent = `${m.date} ${m.time}`;
  document.getElementById('detailLocation').textContent = m.location || '未定';
  document.getElementById('detailAttendees').textContent = m.attendees.join('、') || '未定';

  const status = getMeetingStatus(m.date, m.time);
  const statusText = status === 'upcoming' ? '予定' : status === 'ongoing' ? '会議中' : '完了';
  document.getElementById('detailStatus').textContent = statusText;

  // 权限控制
  const isAdmin = hasAdminPermission();
  document.getElementById('adminAgendaActions').style.display = isAdmin ? 'block' : 'none';
  document.getElementById('adminCarryoverActions').style.display = isAdmin ? 'block' : 'none';

  // 议题
  const agendaList = document.getElementById('detailAgendas');
  if (!m.agendas || m.agendas.length === 0) {
    agendaList.innerHTML = '<li class="text-muted small">議題はまだありません</li>';
  } else {
    agendaList.innerHTML = m.agendas.map((a, idx) => `
      <li class="checklist-item">
        <div class="check-box ${a.resolved ? 'checked' : ''}" data-index="${idx}"></div>
        <span class="checklist-text ${a.resolved ? 'checked' : ''}">${escapeHtml(a.title)}</span>
      </li>
    `).join('');

    if (isAdmin) {
      document.querySelectorAll('.check-box').forEach(box => {
        box.addEventListener('click', async function() {
          const idx = this.dataset.index;
          m.agendas[idx].resolved = !m.agendas[idx].resolved;
          await updateDoc(doc(db, 'meetings', m.id), { agendas: m.agendas });
          openDetailModal(m.id); // 刷新显示
        });
      });
    }
  }

  // 持ち越し事項
  renderCarryoverSection(m);

  detailModal.show();
}

function renderCarryoverSection(m) {
  const section = document.getElementById('carryoverSection');
  if (!m.carryover || m.carryover.length === 0) {
    section.innerHTML = '<p class="text-muted small">持ち越し事項はありません</p>';
    return;
  }
  section.innerHTML = m.carryover.map((c, idx) => `
    <div class="carryover-item">
      <span>• ${escapeHtml(c)}</span>
      ${hasAdminPermission() ? `<button class="remove-carryover" data-index="${idx}">×</button>` : ''}
    </div>
  `).join('');

  if (hasAdminPermission()) {
    document.querySelectorAll('.remove-carryover').forEach(btn => {
      btn.addEventListener('click', async function(e) {
        e.stopPropagation();
        const idx = this.dataset.index;
        m.carryover.splice(idx, 1);
        await updateDoc(doc(db, 'meetings', m.id), { carryover: m.carryover });
        renderCarryoverSection(m);
      });
    });
  }
}

// ========== 事件绑定 ==========
function attachEvents() {
  // 新建会议按钮（仅最高权限可操作）
  document.getElementById('addMeetingBtn').addEventListener('click', () => {
    if (!hasAdminPermission()) {
      alert('会議を作成するには最高権限が必要です。');
      return;
    }
    document.getElementById('meetingTitle').value = '';
    document.getElementById('meetingDate').value = '';
    document.getElementById('meetingTime').value = '';
    document.getElementById('meetingLocation').value = '';

    // 生成参会人勾选框
    const checkboxContainer = document.getElementById('attendeesCheckboxList');
    checkboxContainer.innerHTML = allMembers.map(m => `
      <div class="form-check form-check-inline">
        <input class="form-check-input" type="checkbox" value="${m.name}" id="attendee_${m.id}">
        <label class="form-check-label" for="attendee_${m.id}">${m.name}</label>
      </div>
    `).join('');

    // 前回の持ち越し
    const lastMeeting = allMeetings.find(m => m.carryover && m.carryover.length > 0);
    const carryoverPreview = document.getElementById('carryoverPreview');
    const carryoverList = document.getElementById('carryoverList');
    if (lastMeeting) {
      carryoverPreview.style.display = 'block';
      carryoverList.innerHTML = lastMeeting.carryover.map(c => `• ${c}`).join('<br>');
    } else {
      carryoverPreview.style.display = 'none';
    }

    createModal.show();
  });

  // 保存会议
  document.getElementById('saveMeetingBtn').addEventListener('click', async () => {
    if (!hasAdminPermission()) return;
    const title = document.getElementById('meetingTitle').value.trim();
    if (!title) { alert('会議名を入力してください。'); return; }
    const date = document.getElementById('meetingDate').value;
    const time = document.getElementById('meetingTime').value.trim();
    const location = document.getElementById('meetingLocation').value.trim();

    const checkedBoxes = document.querySelectorAll('#attendeesCheckboxList input:checked');
    const attendees = Array.from(checkedBoxes).map(cb => cb.value);

    // 持ち越し事項を初期議題に追加
    const lastMeeting = allMeetings.find(m => m.carryover && m.carryover.length > 0);
    const initialAgendas = [];
    if (lastMeeting) {
      lastMeeting.carryover.forEach(c => {
        initialAgendas.push({ title: c, resolved: false });
      });
      // 前回の持ち越しをクリア
      await updateDoc(doc(db, 'meetings', lastMeeting.id), { carryover: [] });
      lastMeeting.carryover = [];
    }

    const newMeeting = {
      title, date, time, location,
      attendees,
      agendas: initialAgendas,
      carryover: [],
      createdAt: serverTimestamp()
    };
    const docRef = await addDoc(collection(db, 'meetings'), newMeeting);
    newMeeting.id = docRef.id;
    allMeetings.unshift(newMeeting);
    createModal.hide();
    renderList();
  });

  // 过滤
  document.getElementById('filterStatus').addEventListener('change', renderList);

  // 添加议题
  document.getElementById('addAgendaBtn').addEventListener('click', async () => {
    if (!hasAdminPermission()) return;
    const title = prompt('議題名を入力してください');
    if (!title) return;
    const m = allMeetings.find(mt => mt.id === currentMeetingId);
    if (m) {
      m.agendas.push({ title, resolved: false });
      await updateDoc(doc(db, 'meetings', m.id), { agendas: m.agendas });
      openDetailModal(m.id);
    }
  });

  // 添加持ち越し事項
  document.getElementById('addCarryoverBtn').addEventListener('click', async () => {
    if (!hasAdminPermission()) return;
    const text = prompt('次回に持ち越す事項を入力してください');
    if (!text) return;
    const m = allMeetings.find(mt => mt.id === currentMeetingId);
    if (m) {
      if (!m.carryover) m.carryover = [];
      m.carryover.push(text);
      await updateDoc(doc(db, 'meetings', m.id), { carryover: m.carryover });
      renderCarryoverSection(m);
    }
  });
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text || '';
  return div.innerHTML;
}