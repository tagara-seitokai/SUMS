import { auth, db } from './firebase-init.js';
import { onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/12.14.0/firebase-auth.js';
import {
  collection, getDocs, addDoc, updateDoc, doc, setDoc, serverTimestamp,
  query, where, orderBy
} from 'https://www.gstatic.com/firebasejs/12.14.0/firebase-firestore.js';

let currentUser = null;
let currentMember = null;
let dateRange = [];           // 完整的日期范围（string[]）
let allShifts = [];           // 当前所有 shift 文档
let allMembers = [];          // 活跃成员列表
let currentWeekIndex = 0;     // 当前显示的周索引
let weekBlocks = [];          // 按周分组的日期块（每个块最多7天）

const dayNames = ['日', '月', '火', '水', '木', '金', '土'];
const noPermissionModal = new bootstrap.Modal(document.getElementById('noPermissionModal'));

document.addEventListener('DOMContentLoaded', () => {
  onAuthStateChanged(auth, async (user) => {
    if (!user) { window.location.href = 'index.html'; return; }
    currentUser = user;
    await loadCurrentMember();
    await loadMembers();
    await loadDateRange();
    if (dateRange.length > 0) {
      buildWeekBlocks();
    }
    await syncMembersAndRender();
    attachEvents();
  });
});

// ========== 用户权限 ==========
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

// ========== 日期范围 ==========
async function loadDateRange() {
  const metaSnap = await getDocs(query(collection(db, 'festivalMeta'), orderBy('updatedAt', 'desc')));
  if (!metaSnap.empty) {
    dateRange = metaSnap.docs[0].data().dates || [];
  } else {
    dateRange = [];
  }
}

async function saveDateRange(dates) {
  try {
    await setDoc(doc(db, 'festivalMeta', 'current'), { dates, updatedAt: serverTimestamp() });
  } catch (e) {
    await setDoc(doc(db, 'festivalMeta', 'current'), { dates, updatedAt: serverTimestamp() });
  }
}

// 将完整日期范围切割成周块（每块最多7天）
function buildWeekBlocks() {
  weekBlocks = [];
  let start = 0;
  while (start < dateRange.length) {
    const currentDate = new Date(dateRange[start] + 'T00:00:00');
    const dayOfWeek = currentDate.getDay(); // 0=日, 1=月, ...
    // 第一块不是周一且不是第一周：实际上我们是从整个范围的开始算，第一块可能不完整
    // 计算到下一个周日（包括当前）最多取7个
    let end = start;
    // 如果当前日期不是周一，则本块延续到周日（最多7天）
    // 但我们需要在开始处，如果不是周一，则一直取到周日（最多到周日）
    const daysToSunday = 7 - dayOfWeek; // 到周日还有几天（如果周日当天则为7）
    // 取从 start 开始的 daysToSunday 天，但不超过 dateRange 长度
    const blockEnd = Math.min(start + daysToSunday, dateRange.length);
    const block = dateRange.slice(start, blockEnd);
    weekBlocks.push(block);
    start = blockEnd;
  }
  // 修正 currentWeekIndex 范围
  if (currentWeekIndex >= weekBlocks.length) {
    currentWeekIndex = Math.max(0, weekBlocks.length - 1);
  }
}

// 获取当前周的日期数组
function getCurrentWeekDates() {
  if (weekBlocks.length === 0) return [];
  return weekBlocks[currentWeekIndex] || [];
}

// ========== 加载所有 shift ==========
async function loadAllShifts() {
  const snap = await getDocs(collection(db, 'festivalShifts'));
  allShifts = [];
  snap.forEach(d => allShifts.push({ id: d.id, ...d.data() }));
}

// ========== 同步成员与 shift ==========
async function syncMembersAndRender() {
  await loadAllShifts();

  const shiftMap = {};
  allShifts.forEach(s => {
    if (s.memberName) shiftMap[s.memberName] = s;
  });

  // 为每个活跃成员创建 shift（如果不存在）
  for (const member of allMembers) {
    if (!shiftMap[member.name]) {
      const newShift = {
        memberId: member.id,
        memberName: member.name,
        createdAt: serverTimestamp()
      };
      dateRange.forEach(d => newShift[d] = 'none');
      const docRef = await addDoc(collection(db, 'festivalShifts'), newShift);
      shiftMap[member.name] = { id: docRef.id, ...newShift };
    } else {
      // 补充 memberId
      if (!shiftMap[member.name].memberId) {
        shiftMap[member.name].memberId = member.id;
        await updateDoc(doc(db, 'festivalShifts', shiftMap[member.name].id), { memberId: member.id });
      }
    }
  }

  await loadAllShifts();
  renderTable();
  updateWeekNav();
}

// ========== 渲染表格 ==========
function renderTable() {
  const head = document.getElementById('shiftTableHead');
  const body = document.getElementById('shiftTableBody');
  const currentWeekDates = getCurrentWeekDates();

  if (dateRange.length === 0) {
    head.innerHTML = '';
    body.innerHTML = '<tr><td colspan="1" class="text-center text-muted py-3">期間が設定されていません。右上の「期間設定」から日付を指定してください。（最高権限が必要）</td></tr>';
    return;
  }

  if (currentWeekDates.length === 0) {
    head.innerHTML = '';
    body.innerHTML = '<tr><td colspan="1" class="text-center text-muted py-3">表示する週がありません。</td></tr>';
    return;
  }

  // 表头：显示日期和星期
  let headHTML = '<tr><th>メンバー</th>';
  currentWeekDates.forEach(d => {
    const dateObj = new Date(d + 'T00:00:00');
    const month = dateObj.getMonth() + 1;
    const day = dateObj.getDate();
    const weekday = dayNames[dateObj.getDay()];
    headHTML += `<th>${month}/${day} (${weekday})</th>`;
  });
  headHTML += '</tr>';
  head.innerHTML = headHTML;

  // 排序：活跃成员在前，临时成员在后
  const activeNames = allMembers.map(m => m.name);
  const regularShifts = allShifts.filter(s => activeNames.includes(s.memberName));
  const tempShifts = allShifts.filter(s => !activeNames.includes(s.memberName));
  regularShifts.sort((a, b) => (a.memberName || '').localeCompare(b.memberName || ''));
  const displayShifts = [...regularShifts, ...tempShifts];

  body.innerHTML = '';
  if (displayShifts.length === 0) {
    body.innerHTML = '<tr><td colspan="' + (currentWeekDates.length + 1) + '" class="text-center text-muted py-3">メンバーがいません</td></tr>';
    return;
  }

  displayShifts.forEach(shift => {
    const row = document.createElement('tr');
    row.innerHTML = `<td>${escapeHtml(shift.memberName || '')}</td>` + currentWeekDates.map(d => {
      const val = shift[d] || 'none';
      let slotClass = '';
      let displayText = '';
      if (val === 'morning') { slotClass = 'shift-morning'; displayText = '午前'; }
      else if (val === 'afternoon') { slotClass = 'shift-afternoon'; displayText = '午後'; }
      else if (val === 'allday') { slotClass = 'shift-allday'; displayText = '終日'; }
      else { slotClass = 'shift-none'; displayText = ''; }
      return `<td><div class="shift-slot ${slotClass}" data-member="${shift.memberName}" data-date="${d}">${displayText}</div></td>`;
    }).join('');
    body.appendChild(row);
  });

  // 绑定单元格点击事件
  document.querySelectorAll('.shift-slot').forEach(slot => {
    slot.addEventListener('click', function() {
      if (!hasAdminPermission()) {
        noPermissionModal.show();
        return;
      }
      const member = this.dataset.member;
      const date = this.dataset.date;
      const shiftEntry = allShifts.find(s => s.memberName === member);
      if (!shiftEntry) return;

      const currentVal = shiftEntry[date] || 'none';

      const select = document.createElement('select');
      select.className = 'shift-select';
      select.innerHTML = `
        <option value="morning" ${currentVal === 'morning' ? 'selected' : ''}>午前 (8:30-12:30)</option>
        <option value="afternoon" ${currentVal === 'afternoon' ? 'selected' : ''}>午後 (12:00-16:00)</option>
        <option value="allday" ${currentVal === 'allday' ? 'selected' : ''}>終日 (8:30-16:00)</option>
        <option value="none" ${currentVal === 'none' ? 'selected' : ''}>シフトなし</option>
      `;

      this.innerHTML = '';
      this.appendChild(select);
      select.focus();

      select.addEventListener('change', async () => {
        const newVal = select.value;
        shiftEntry[date] = newVal;
        await updateDoc(doc(db, 'festivalShifts', shiftEntry.id), { [date]: newVal });
        renderTable();
      });

      select.addEventListener('blur', () => {
        setTimeout(() => {
          if (shiftEntry[date] === currentVal) {
            renderTable();
          }
        }, 150);
      });
    });
  });
}

// 更新周导航按钮状态和标签
function updateWeekNav() {
  const prevBtn = document.getElementById('prevWeekBtn');
  const nextBtn = document.getElementById('nextWeekBtn');
  const label = document.getElementById('weekLabel');

  if (weekBlocks.length === 0) {
    prevBtn.disabled = true;
    nextBtn.disabled = true;
    label.textContent = '日程なし';
    return;
  }

  const currentBlock = weekBlocks[currentWeekIndex];
  if (!currentBlock || currentBlock.length === 0) {
    prevBtn.disabled = true;
    nextBtn.disabled = true;
    label.textContent = '日程なし';
    return;
  }

  const startDate = currentBlock[0];
  const endDate = currentBlock[currentBlock.length - 1];
  const format = (d) => {
    const [y, m, day] = d.split('-');
    return `${parseInt(m)}/${parseInt(day)}`;
  };
  label.textContent = `${format(startDate)} 〜 ${format(endDate)}`;

  prevBtn.disabled = (currentWeekIndex === 0);
  nextBtn.disabled = (currentWeekIndex === weekBlocks.length - 1);
}

function changeWeek(delta) {
  const newIndex = currentWeekIndex + delta;
  if (newIndex < 0 || newIndex >= weekBlocks.length) return;
  currentWeekIndex = newIndex;
  renderTable();
  updateWeekNav();
}

// ========== 事件绑定 ==========
function attachEvents() {
  document.getElementById('prevWeekBtn').addEventListener('click', () => changeWeek(-1));
  document.getElementById('nextWeekBtn').addEventListener('click', () => changeWeek(1));

  document.getElementById('setDatesBtn').addEventListener('click', async () => {
    if (!hasAdminPermission()) {
      noPermissionModal.show();
      return;
    }
    const start = prompt('開始日（YYYY-MM-DD）', dateRange[0] || '');
    if (!start) return;
    const end = prompt('終了日（YYYY-MM-DD）', dateRange[dateRange.length - 1] || '');
    if (!end) return;
    const dates = [];
    let cur = new Date(start);
    const endDate = new Date(end);
    while (cur <= endDate) {
      dates.push(cur.toISOString().slice(0, 10));
      cur.setDate(cur.getDate() + 1);
    }
    dateRange = dates;
    await saveDateRange(dateRange);
    // 更新所有 shift 的字段（补充新日期，默认 none）
    for (const shift of allShifts) {
      let needUpdate = false;
      for (const d of dates) {
        if (shift[d] === undefined) {
          shift[d] = 'none';
          needUpdate = true;
        }
      }
      if (needUpdate) {
        await updateDoc(doc(db, 'festivalShifts', shift.id), shift);
      }
    }
    // 重新构建周视图并重置当前周
    currentWeekIndex = 0;
    buildWeekBlocks();
    await syncMembersAndRender();
  });

  document.getElementById('addMemberBtn').addEventListener('click', async () => {
    if (!hasAdminPermission()) {
      noPermissionModal.show();
      return;
    }
    const name = prompt('臨時メンバーの名前を入力してください');
    if (!name) return;
    const newShift = {
      memberId: null,
      memberName: name,
      createdAt: serverTimestamp()
    };
    dateRange.forEach(d => newShift[d] = 'none');
    await addDoc(collection(db, 'festivalShifts'), newShift);
    await loadAllShifts();
    renderTable();
  });
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text || '';
  return div.innerHTML;
}
