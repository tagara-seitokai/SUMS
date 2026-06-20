import { auth, db } from './firebase-init.js';
import { onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/12.14.0/firebase-auth.js';
import {
  collection, getDocs, addDoc, updateDoc, deleteDoc, doc, serverTimestamp,
  query, where
} from 'https://www.gstatic.com/firebasejs/12.14.0/firebase-firestore.js';

let currentUser = null;
let currentMember = null;
let allEvents = [];
let currentEvent = null;

let createModal, detailModal, noPermissionModal;

const dayNames = ['日', '月', '火', '水', '木', '金', '土'];
const todayStr = new Date().toISOString().slice(0, 10);
let currentYear = new Date().getFullYear();
let currentMonth = new Date().getMonth() + 1;

document.addEventListener('DOMContentLoaded', () => {
  createModal = new bootstrap.Modal(document.getElementById('createModal'));
  detailModal = new bootstrap.Modal(document.getElementById('detailModal'));
  noPermissionModal = new bootstrap.Modal(document.getElementById('noPermissionModal'));

  onAuthStateChanged(auth, async (user) => {
    if (!user) { window.location.href = 'index.html'; return; }
    currentUser = user;
    await loadCurrentMember();
    await loadEvents();
    renderCalendar();
    attachEventListeners();
  });
});

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

async function loadEvents() {
  const snap = await getDocs(collection(db, 'calendarEvents'));
  allEvents = [];
  snap.forEach(d => allEvents.push({ id: d.id, ...d.data() }));
}

// ========== 月视图渲染 ==========
function renderCalendar() {
  const container = document.getElementById('calendarContainer');
  const firstDay = new Date(currentYear, currentMonth - 1, 1);
  const startDow = firstDay.getDay();
  const daysInMonth = new Date(currentYear, currentMonth, 0).getDate();
  const daysInPrev = new Date(currentYear, currentMonth - 1, 0).getDate();

  let html = `<div class="d-flex justify-content-between align-items-center p-3">
    <button class="btn btn-sm btn-outline-secondary" id="prevMonthBtn">◀ 前月</button>
    <strong>${currentYear}年${currentMonth}月</strong>
    <button class="btn btn-sm btn-outline-secondary" id="nextMonthBtn">翌月 ▶</button>
  </div>`;

  html += '<div class="calendar-header">';
  dayNames.forEach((d, i) => {
    let cls = i === 0 ? 'sunday' : i === 6 ? 'saturday' : '';
    html += `<div class="${cls}">${d}</div>`;
  });
  html += '</div><div class="calendar-grid">';

  let cellCount = 0;
  for (let i = startDow - 1; i >= 0; i--) {
    html += `<div class="calendar-cell other-month"><div class="day-num">${daysInPrev - i}</div></div>`;
    cellCount++;
  }

  for (let day = 1; day <= daysInMonth; day++) {
    const dateStr = `${currentYear}-${String(currentMonth).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const isToday = dateStr === todayStr;
    html += `<div class="calendar-cell ${isToday ? 'today' : ''}"><div class="day-num">${day}</div>`;
    const dayEvents = allEvents.filter(e => e.date === dateStr);
    dayEvents.forEach(ev => {
      html += `<div class="event-chip event-blue" data-event-id="${ev.id}">${escapeHtml(ev.title)}</div>`;
    });
    html += '</div>';
    cellCount++;
  }

  const rem = 7 - (cellCount % 7);
  if (rem < 7) {
    for (let i = 1; i <= rem; i++) html += `<div class="calendar-cell other-month"><div class="day-num">${i}</div></div>`;
  }
  html += '</div>';
  container.innerHTML = html;

  // 绑定月份切换
  document.getElementById('prevMonthBtn').addEventListener('click', () => changeMonth(-1));
  document.getElementById('nextMonthBtn').addEventListener('click', () => changeMonth(1));

  // 绑定事件点击
  document.querySelectorAll('.event-chip').forEach(chip => {
    chip.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = chip.dataset.eventId;
      const event = allEvents.find(ev => ev.id === id);
      if (event) openDetailModal(event);
    });
  });
}

function changeMonth(delta) {
  currentMonth += delta;
  if (currentMonth > 12) { currentMonth = 1; currentYear++; }
  if (currentMonth < 1) { currentMonth = 12; currentYear--; }
  renderCalendar();
}

// ========== 新增预定 ==========
function attachEventListeners() {
  document.getElementById('addEventBtn').addEventListener('click', () => {
    document.getElementById('eventTitle').value = '';
    document.getElementById('eventDate').value = '';
    document.getElementById('eventTime').value = '';
    document.getElementById('eventLocation').value = '';
    document.getElementById('eventParticipants').value = '';
    document.getElementById('eventDesc').value = '';
    createModal.show();
  });

  document.getElementById('saveEventBtn').addEventListener('click', async () => {
    const title = document.getElementById('eventTitle').value.trim();
    if (!title) { alert('タイトルを入力してください。'); return; }
    const date = document.getElementById('eventDate').value;
    const time = document.getElementById('eventTime').value.trim();
    const location = document.getElementById('eventLocation').value.trim();
    const participants = document.getElementById('eventParticipants').value.trim();
    const desc = document.getElementById('eventDesc').value.trim();

    const newEvent = { title, date, time, location, participants, desc, createdAt: serverTimestamp() };
    try {
      const docRef = await addDoc(collection(db, 'calendarEvents'), newEvent);
      newEvent.id = docRef.id;
      allEvents.push(newEvent);
      createModal.hide();
      renderCalendar();
    } catch (e) {
      console.error(e);
      alert('予定の追加に失敗しました。');
    }
  });

  // 编辑与删除按钮事件
  document.getElementById('editToggleBtn').addEventListener('click', () => {
    if (!hasAdminPermission()) { noPermissionModal.show(); return; }
    document.getElementById('editTitle').value = currentEvent.title;
    document.getElementById('editDate').value = currentEvent.date || '';
    document.getElementById('editTime').value = currentEvent.time || '';
    document.getElementById('editLocation').value = currentEvent.location || '';
    document.getElementById('editParticipants').value = currentEvent.participants || '';
    document.getElementById('editDesc').value = currentEvent.desc || '';

    document.getElementById('detailViewMode').style.display = 'none';
    document.getElementById('detailEditMode').style.display = 'block';
    document.getElementById('editToggleBtn').style.display = 'none';
    document.getElementById('saveEditBtn').style.display = 'inline-block';
    document.getElementById('deleteEventBtn').style.display = 'none';
  });

  document.getElementById('saveEditBtn').addEventListener('click', async () => {
    currentEvent.title = document.getElementById('editTitle').value.trim();
    currentEvent.date = document.getElementById('editDate').value;
    currentEvent.time = document.getElementById('editTime').value.trim();
    currentEvent.location = document.getElementById('editLocation').value.trim();
    currentEvent.participants = document.getElementById('editParticipants').value.trim();
    currentEvent.desc = document.getElementById('editDesc').value.trim();

    try {
      await updateDoc(doc(db, 'calendarEvents', currentEvent.id), {
        title: currentEvent.title, date: currentEvent.date, time: currentEvent.time,
        location: currentEvent.location, participants: currentEvent.participants, desc: currentEvent.desc
      });
      const idx = allEvents.findIndex(e => e.id === currentEvent.id);
      if (idx >= 0) allEvents[idx] = { ...currentEvent };

      // 更新查看视图
      document.getElementById('viewTitle').textContent = currentEvent.title;
      document.getElementById('viewDateTime').textContent = `${currentEvent.date} ${currentEvent.time}`;
      document.getElementById('viewLocation').textContent = currentEvent.location || '未定';
      document.getElementById('viewParticipants').textContent = currentEvent.participants || '未定';
      document.getElementById('viewDesc').textContent = currentEvent.desc || 'なし';

      document.getElementById('detailViewMode').style.display = 'block';
      document.getElementById('detailEditMode').style.display = 'none';
      document.getElementById('editToggleBtn').style.display = 'inline-block';
      document.getElementById('saveEditBtn').style.display = 'none';
      document.getElementById('deleteEventBtn').style.display = 'inline-block';
      renderCalendar();
    } catch (e) {
      console.error(e);
      alert('更新に失敗しました。');
    }
  });

  document.getElementById('deleteEventBtn').addEventListener('click', async () => {
    if (!hasAdminPermission()) { noPermissionModal.show(); return; }
    if (!confirm('この予定を削除しますか？')) return;
    try {
      await deleteDoc(doc(db, 'calendarEvents', currentEvent.id));
      allEvents = allEvents.filter(e => e.id !== currentEvent.id);
      detailModal.hide();
      renderCalendar();
    } catch (e) {
      console.error(e);
      alert('削除に失敗しました。');
    }
  });
}

// ========== 详情弹窗（提升到模块作用域） ==========
function openDetailModal(event) {
  currentEvent = event;
  document.getElementById('viewTitle').textContent = event.title;
  document.getElementById('viewDateTime').textContent = `${event.date || ''} ${event.time || ''}`;
  document.getElementById('viewLocation').textContent = event.location || '未定';
  document.getElementById('viewParticipants').textContent = event.participants || '未定';
  document.getElementById('viewDesc').textContent = event.desc || 'なし';

  document.getElementById('detailViewMode').style.display = 'block';
  document.getElementById('detailEditMode').style.display = 'none';
  document.getElementById('editToggleBtn').style.display = 'inline-block';
  document.getElementById('saveEditBtn').style.display = 'none';
  document.getElementById('deleteEventBtn').style.display = 'inline-block';

  if (hasAdminPermission()) {
    document.getElementById('adminActions').style.display = 'block';
  } else {
    document.getElementById('adminActions').style.display = 'none';
  }

  detailModal.show();
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text || '';
  return div.innerHTML;
}