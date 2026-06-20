import { auth, db } from './firebase-init.js';
import { onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/12.14.0/firebase-auth.js';
import {
  collection, doc, getDocs, addDoc, updateDoc,
  query, orderBy, serverTimestamp
} from 'https://www.gstatic.com/firebasejs/12.14.0/firebase-firestore.js';

let currentUser = null;
let groups = [];
let activeGroupId = null;
let currentMonth = new Date().getMonth() + 1;
let currentYear = new Date().getFullYear();
const dayNames = ['日', '月', '火', '水', '木', '金', '土'];
const todayStr = new Date().toISOString().slice(0, 10);

let createGroupModal = null;
let editEventModal = null;
let editingEvent = null;
let editingEventGroup = null;

document.addEventListener('DOMContentLoaded', () => {
  createGroupModal = new bootstrap.Modal(document.getElementById('createGroupModal'));
  editEventModal = new bootstrap.Modal(document.getElementById('editEventModal'));

  onAuthStateChanged(auth, async (user) => {
    if (user) {
      currentUser = user;
      await loadGroups();
      // 不再自动创建默认数据，直接使用 groups（可能为空）
      activeGroupId = groups.length > 0 ? groups[0].id : null;
      renderAll();
      attachModalListeners();
    } else {
      window.location.href = 'index.html';
    }
  });
});

// ========== Firestore 操作 ==========
async function loadGroups() {
  try {
    const q = query(collection(db, 'scheduleGroups'), orderBy('createdAt', 'asc'));
    const snap = await getDocs(q);
    groups = [];
    snap.forEach(doc => {
      const data = doc.data();
      groups.push({
        id: doc.id,
        name: data.name,
        type: data.type,
        events: data.events || [],
        shifts: data.shifts || [],
        shiftDates: data.shiftDates || [],
        shiftDays: data.shiftDays || ['月','火','水','木','金','土','日'],
        createdAt: data.createdAt
      });
    });
  } catch (e) {
    console.error('スケジュールグループの読み込みに失敗:', e);
  }
}

async function saveGroupToDB(group) {
  try {
    const ref = doc(db, 'scheduleGroups', group.id);
    await updateDoc(ref, {
      name: group.name,
      type: group.type,
      events: group.events || [],
      shifts: group.shifts || [],
      shiftDates: group.shiftDates || [],
      shiftDays: group.shiftDays || ['月','火','水','木','金','土','日']
    });
  } catch (e) {
    console.error('グループの保存に失敗:', e);
    alert('変更を保存できませんでした。');
  }
}

// ========== UI 渲染 ==========
function renderAll() {
  renderTabs();
  renderCalendar();
}

function renderTabs() {
  const tabBar = document.getElementById('tabBar');
  if (!tabBar) return;
  tabBar.innerHTML = '';
  if (groups.length === 0) {
    // 无分组时仅显示创建按钮
    const emptyMsg = document.createElement('span');
    emptyMsg.className = 'text-muted me-2';
    emptyMsg.textContent = 'スケジュールグループがありません';
    tabBar.appendChild(emptyMsg);
  } else {
    groups.forEach(g => {
      const tab = document.createElement('button');
      tab.className = 'tab-item' + (g.id === activeGroupId ? ' active' : '');
      tab.textContent = g.name;
      tab.addEventListener('click', () => {
        activeGroupId = g.id;
        renderAll();
      });
      tabBar.appendChild(tab);
    });
  }
  const addBtn = document.createElement('button');
  addBtn.className = 'tab-add-btn';
  addBtn.textContent = '+ 新規作成';
  addBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    openCreateGroupModal();
  });
  tabBar.appendChild(addBtn);
}

function getActiveGroup() {
  return groups.find(g => g.id === activeGroupId) || null;
}

function renderCalendar() {
  const group = getActiveGroup();
  const container = document.getElementById('calendarContainer');
  if (!container) return;
  if (!group) {
    container.innerHTML = `<div class="text-center py-5 text-muted">「+ 新規作成」からスケジュールグループを追加してください</div>`;
    return;
  }
  let html = '';
  if (group.type === 'monthly') html = renderMonthView(group);
  else if (group.type === 'weekly') html = renderWeekView(group);
  else if (group.type === 'shift' || group.type === 'weekly_shift') html = renderShiftView(group);
  container.innerHTML = html;
  requestAnimationFrame(() => attachCalendarEvents(group));
}

// ===== 月视图 =====
function renderMonthView(group) {
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
    (group.events || []).filter(e => e.date === dateStr).forEach(ev => {
      const safeEvent = JSON.stringify(ev).replace(/'/g, "&#39;");
      html += `<div class="event-chip ${ev.color || 'event-blue'}" data-event='${safeEvent}'>${ev.title}</div>`;
    });
    html += '</div>';
    cellCount++;
  }
  const rem = 7 - (cellCount % 7);
  if (rem < 7) {
    for (let i = 1; i <= rem; i++) html += `<div class="calendar-cell other-month"><div class="day-num">${i}</div></div>`;
  }
  html += '</div>';
  return html;
}

// ===== 周视图 =====
function renderWeekView(group) {
  const hours = ['9:00','10:00','11:00','12:00','13:00','14:00','15:00','16:00','17:00'];
  const weekDays = ['6/15(月)','6/16(火)','6/17(水)','6/18(木)','6/19(金)','6/20(土)','6/21(日)'];
  let html = '<div class="week-header"><strong>📆 週間ビュー</strong><span class="text-muted small">2026年6月15日 〜 6月21日</span></div>';
  html += '<div class="week-grid"><div class="week-time"></div>';
  weekDays.forEach(d => html += `<div class="week-time">${d}</div>`);
  hours.forEach(h => {
    html += `<div class="week-time">${h}</div>`;
    for (let i = 0; i < 7; i++) {
      const ev = (group.events || []).find(e => e.day === i && e.time === h);
      html += `<div class="week-cell ${ev ? 'has-event' : ''}" data-day="${i}" data-time="${h}">${ev ? '●' : ''}</div>`;
    }
  });
  html += '</div>';
  return html;
}

// ===== シフト表视图 =====
function renderShiftView(group) {
  const isWeekly = group.type === 'weekly_shift';
  const columns = isWeekly ? (group.shiftDays || ['月','火','水','木','金','土','日']) : (group.shiftDates || []);
  let html = '<div class="shift-table-wrapper" style="overflow-x:auto;"><table class="shift-table"><thead><tr><th class="member-col">メンバー</th>';
  columns.forEach(d => html += `<th>${d}</th>`);
  html += '</tr></thead><tbody>';
  (group.shifts || []).forEach(s => {
    html += `<tr><td class="member-col">${s.member}</td>`;
    columns.forEach(key => {
      const val = s[key] || '-';
      const cls = val === '-' ? 'time-slot empty' : 'time-slot';
      html += `<td><div class="${cls}" data-member="${s.member}" data-key="${key}">${val}</div></td>`;
    });
    html += '</tr>';
  });
  html += '</tbody></table></div>';
  return html;
}

// ===== 日历事件 =====
function attachCalendarEvents(group) {
  if (!group) return;
  if (group.type === 'monthly') {
    document.getElementById('prevMonthBtn')?.addEventListener('click', () => changeMonth(-1));
    document.getElementById('nextMonthBtn')?.addEventListener('click', () => changeMonth(1));
    document.querySelectorAll('.event-chip').forEach(chip => {
      chip.addEventListener('click', (e) => {
        e.stopPropagation();
        const ev = JSON.parse(chip.dataset.event);
        openEditEventModal(group, ev);
      });
    });
  } else if (group.type === 'weekly') {
    document.querySelectorAll('.week-cell').forEach(cell => {
      cell.addEventListener('click', () => {
        const day = parseInt(cell.dataset.day);
        const time = cell.dataset.time;
        const ev = (group.events || []).find(e => e.day === day && e.time === time);
        if (ev) openEditEventModal(group, ev);
        else {
          const newEv = { day, time, title: '新しい予定', location: '', participants: '', desc: '' };
          group.events.push(newEv);
          openEditEventModal(group, newEv);
        }
      });
    });
  } else if (group.type === 'shift' || group.type === 'weekly_shift') {
    document.querySelectorAll('.time-slot').forEach(slot => {
      slot.addEventListener('click', () => {
        const member = slot.dataset.member;
        const key = slot.dataset.key;
        const shiftEntry = (group.shifts || []).find(s => s.member === member);
        if (shiftEntry) editShiftCell(group, shiftEntry, key);
      });
    });
  }
}

function changeMonth(delta) {
  currentMonth += delta;
  if (currentMonth > 12) { currentMonth = 1; currentYear++; }
  if (currentMonth < 1) { currentMonth = 12; currentYear--; }
  renderCalendar();
}

// ===== 弹窗 =====
function openCreateGroupModal() {
  document.getElementById('groupName').value = '';
  document.getElementById('groupType').value = 'monthly';
  document.getElementById('shiftDateRange').style.display = 'none';
  createGroupModal.show();
}

function openEditEventModal(group, ev) {
  editingEvent = ev;
  editingEventGroup = group;
  document.getElementById('editEventTitle').value = ev.title || '';
  document.getElementById('editEventTime').value = ev.time || '';
  document.getElementById('editEventLocation').value = ev.location || '';
  document.getElementById('editEventParticipants').value = ev.participants || '';
  document.getElementById('editEventDesc').value = ev.desc || '';
  editEventModal.show();
}

function closeEditEventModal() {
  if (document.activeElement) document.activeElement.blur();
  editEventModal.hide();
}

function editShiftCell(group, shiftEntry, key) {
  const currentVal = shiftEntry[key] || '-';
  const newVal = prompt(`${shiftEntry.member} の ${key} の予定を入力（キャンセルで変更なし）`, currentVal);
  if (newVal !== null) {
    shiftEntry[key] = newVal.trim() || '-';
    saveGroupToDB(group).then(() => renderCalendar());
  }
}

// ===== 模态框监听 =====
function attachModalListeners() {
  document.getElementById('groupType').addEventListener('change', (e) => {
    document.getElementById('shiftDateRange').style.display = e.target.value === 'shift' ? 'block' : 'none';
  });

  document.getElementById('saveGroupBtn').addEventListener('click', async () => {
    const name = document.getElementById('groupName').value.trim();
    if (!name) { alert('グループ名を入力してください。'); return; }
    const type = document.getElementById('groupType').value;
    const newGroup = {
      name, type,
      events: [],
      shifts: [],
      shiftDates: [],
      shiftDays: ['月','火','水','木','金','土','日'],
      createdAt: serverTimestamp()
    };
    if (type === 'shift') {
      const start = document.getElementById('shiftStart').value;
      const end = document.getElementById('shiftEnd').value;
      if (!start || !end) { alert('シフトの期間を設定してください。'); return; }
      const dates = [];
      let cur = new Date(start);
      const endDate = new Date(end);
      while (cur <= endDate) {
        dates.push(cur.toISOString().slice(0,10));
        cur.setDate(cur.getDate() + 1);
      }
      newGroup.shiftDates = dates;
    }
    try {
      const docRef = await addDoc(collection(db, 'scheduleGroups'), newGroup);
      groups.push({ id: docRef.id, ...newGroup });
      activeGroupId = docRef.id;
      createGroupModal.hide();
      renderAll();
    } catch (e) {
      console.error('グループ作成失敗:', e);
      alert('グループの作成に失敗しました。');
    }
  });

  document.getElementById('saveEventBtn').addEventListener('click', async () => {
    if (!editingEvent || !editingEventGroup) return;
    editingEvent.title = document.getElementById('editEventTitle').value.trim();
    editingEvent.time = document.getElementById('editEventTime').value.trim();
    editingEvent.location = document.getElementById('editEventLocation').value.trim();
    editingEvent.participants = document.getElementById('editEventParticipants').value.trim();
    editingEvent.desc = document.getElementById('editEventDesc').value.trim();
    await saveGroupToDB(editingEventGroup);
    closeEditEventModal();
    renderCalendar();
  });

  document.getElementById('deleteEventBtn').addEventListener('click', async () => {
    if (!editingEvent || !editingEventGroup) return;
    editingEventGroup.events = editingEventGroup.events.filter(e => e !== editingEvent);
    await saveGroupToDB(editingEventGroup);
    closeEditEventModal();
    renderCalendar();
  });
}