import { auth, db } from './firebase-init.js';
import { onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/12.14.0/firebase-auth.js';
import {
  collection, getDocs, addDoc, updateDoc, deleteDoc, doc, serverTimestamp,
  query, where
} from 'https://www.gstatic.com/firebasejs/12.14.0/firebase-firestore.js';

let currentUser = null;
let currentMember = null;
let allEvents = [];       // 手动添加的追加予定
let allTasks = [];        // 所有 Task
let currentEvent = null;

let createModal, taskDetailModal, eventDetailModal;

const dayNames = ['日', '月', '火', '水', '木', '金', '土'];
const todayStr = new Date().toISOString().slice(0, 10);
let currentYear = new Date().getFullYear();
let currentMonth = new Date().getMonth() + 1;

document.addEventListener('DOMContentLoaded', () => {
  createModal = new bootstrap.Modal(document.getElementById('createModal'));
  taskDetailModal = new bootstrap.Modal(document.getElementById('taskDetailModal'));
  eventDetailModal = new bootstrap.Modal(document.getElementById('eventDetailModal'));

  onAuthStateChanged(auth, async (user) => {
    if (!user) { window.location.href = 'index.html'; return; }
    currentUser = user;
    await loadCurrentMember();
    await loadAllData();
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

async function loadAllData() {
  const [eventsSnap, tasksSnap] = await Promise.all([
    getDocs(collection(db, 'calendarEvents')),
    getDocs(collection(db, 'tasks'))
  ]);
  allEvents = [];
  eventsSnap.forEach(d => allEvents.push({ id: d.id, ...d.data() }));

  allTasks = [];
  tasksSnap.forEach(d => allTasks.push({ id: d.id, ...d.data() }));
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
    const dateStr = `${currentYear}-${String(currentMonth).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
    const isToday = dateStr === todayStr;
    html += `<div class="calendar-cell ${isToday ? 'today' : ''}"><div class="day-num">${day}</div>`;

    // Task
    const dayTasks = allTasks.filter(t => {
      if (!t.dueDate) return false;
      let dueStr;
      if (t.dueDate.toDate) dueStr = t.dueDate.toDate().toISOString().slice(0, 10);
      else if (typeof t.dueDate === 'string') dueStr = t.dueDate.slice(0, 10);
      else return false;
      return dueStr === dateStr;
    });

    dayTasks.forEach(t => {
      const isOverdue = t.status !== 'completed' && (() => {
        let dueStr;
        if (t.dueDate.toDate) dueStr = t.dueDate.toDate().toISOString().slice(0, 10);
        else if (typeof t.dueDate === 'string') dueStr = t.dueDate.slice(0, 10);
        return dueStr < todayStr;
      })();
      let taskClass = 'task-open';
      if (t.status === 'completed') taskClass = 'task-completed';
      else if (isOverdue) taskClass = 'task-overdue';
      else if (t.status === 'in_progress') taskClass = 'task-progress';

      const safeData = JSON.stringify({
        id: t.id, title: t.title || '無題', assignee: t.assignee || '未定',
        project: t.project || '', dueDate: t.dueDate ? formatDueDate(t.dueDate) : '未設定',
        status: t.status || 'open', desc: t.desc || ''
      }).replace(/'/g, "&#39;");
      html += `<div class="event-chip ${taskClass}" data-task='${safeData}'>📋 ${escapeHtml(t.title || '無題')}</div>`;
    });

    // 追加予定
    const dayEvents = allEvents.filter(e => e.date === dateStr);
    dayEvents.forEach(ev => {
      const safeData = JSON.stringify({
        id: ev.id, title: ev.title || '無題', date: ev.date || '',
        time: ev.time || '', location: ev.location || '', participants: ev.participants || '',
        desc: ev.desc || ''
      }).replace(/'/g, "&#39;");
      html += `<div class="event-chip event-blue" data-event='${safeData}'>📅 ${escapeHtml(ev.title || '無題')}</div>`;
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

  // 月份切换
  document.getElementById('prevMonthBtn').addEventListener('click', () => changeMonth(-1));
  document.getElementById('nextMonthBtn').addEventListener('click', () => changeMonth(1));

  // 绑定点击事件
  document.querySelectorAll('.event-chip[data-task]').forEach(chip => {
    chip.addEventListener('click', (e) => {
      e.stopPropagation();
      const task = JSON.parse(chip.dataset.task);
      showTaskDetail(task);
    });
  });
  document.querySelectorAll('.event-chip[data-event]').forEach(chip => {
    chip.addEventListener('click', (e) => {
      e.stopPropagation();
      const ev = JSON.parse(chip.dataset.event);
      showEventDetail(ev);
    });
  });
}

function changeMonth(delta) {
  currentMonth += delta;
  if (currentMonth > 12) { currentMonth = 1; currentYear++; }
  if (currentMonth < 1) { currentMonth = 12; currentYear--; }
  renderCalendar();
}

function formatDueDate(dueDate) {
  if (!dueDate) return '未設定';
  let date;
  if (dueDate.toDate) date = dueDate.toDate();
  else if (typeof dueDate === 'string') date = new Date(dueDate);
  else return '未設定';
  return date.toLocaleDateString('ja-JP');
}

// ========== 弹窗 ==========
function showTaskDetail(task) {
  document.getElementById('taskDetailTitle').textContent = '📋 ' + task.title;
  document.getElementById('taskDetailAssignee').textContent = task.assignee;
  document.getElementById('taskDetailProject').textContent = task.project || 'なし';
  document.getElementById('taskDetailDue').textContent = task.dueDate;
  document.getElementById('taskDetailDesc').textContent = task.desc || '説明なし';

  const isOverdue = task.status !== 'completed' && task.dueDate < todayStr;
  let statusClass = '';
  let statusText = '';
  if (task.status === 'completed') { statusClass = 'status-completed'; statusText = '完了'; }
  else if (isOverdue) { statusClass = 'status-overdue'; statusText = '期限超過'; }
  else if (task.status === 'in_progress') { statusClass = 'status-progress'; statusText = '進行中'; }
  else { statusClass = 'status-open'; statusText = '未着手'; }
  document.getElementById('taskDetailStatus').innerHTML = `<span class="detail-status ${statusClass}">${statusText}</span>`;

  taskDetailModal.show();
}

function showEventDetail(ev) {
  document.getElementById('eventDetailTitle').textContent = '📅 ' + ev.title;
  document.getElementById('eventDetailDateTime').textContent = (ev.date || '') + ' ' + (ev.time || '');
  document.getElementById('eventDetailLocation').textContent = ev.location || '未定';
  document.getElementById('eventDetailParticipants').textContent = ev.participants || '未定';
  document.getElementById('eventDetailDesc').textContent = ev.desc || '説明なし';
  eventDetailModal.show();
}

// ========== 新增追加予定 ==========
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
    const docRef = await addDoc(collection(db, 'calendarEvents'), newEvent);
    newEvent.id = docRef.id;
    allEvents.push(newEvent);
    createModal.hide();
    renderCalendar();
  });
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text || '';
  return div.innerHTML;
}
