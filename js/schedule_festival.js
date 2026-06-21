import { auth, db } from './firebase-init.js';
import { onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/12.14.0/firebase-auth.js';
import {
  collection, getDocs, addDoc, updateDoc, doc, setDoc, serverTimestamp,
  query, where, orderBy
} from 'https://www.gstatic.com/firebasejs/12.14.0/firebase-firestore.js';

let currentUser = null;
let currentMember = null;
let dateRange = [];           // 日期数组
let allShifts = [];           // 当前所有 shift 文档（{id, memberName, ...dates}）
let allMembers = [];          // 活跃成员列表

const noPermissionModal = new bootstrap.Modal(document.getElementById('noPermissionModal'));

document.addEventListener('DOMContentLoaded', () => {
  onAuthStateChanged(auth, async (user) => {
    if (!user) { window.location.href = 'index.html'; return; }
    currentUser = user;
    await loadCurrentMember();
    await loadMembers();
    await loadDateRange();
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
      // 如果已有但缺少 memberId，补充
      if (!shiftMap[member.name].memberId) {
        shiftMap[member.name].memberId = member.id;
        await updateDoc(doc(db, 'festivalShifts', shiftMap[member.name].id), { memberId: member.id });
      }
    }
  }

  // 重新加载完整列表
  await loadAllShifts();
  renderTable();
}

// ========== 渲染表格 ==========
function renderTable() {
  const head = document.getElementById('shiftTableHead');
  const body = document.getElementById('shiftTableBody');

  if (dateRange.length === 0) {
    head.innerHTML = '';
    body.innerHTML = '<tr><td colspan="1" class="text-center text-muted py-3">期間が設定されていません。右上の「期間設定」から日付を指定してください。（最高権限が必要）</td></tr>';
    return;
  }

  // 表头
  let headHTML = '<tr><th>メンバー</th>';
  dateRange.forEach(d => headHTML += `<th>${d}</th>`);
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
    body.innerHTML = '<tr><td colspan="' + (dateRange.length + 1) + '" class="text-center text-muted py-3">メンバーがいません</td></tr>';
    return;
  }

  displayShifts.forEach(shift => {
    const row = document.createElement('tr');
    row.innerHTML = `<td>${escapeHtml(shift.memberName || '')}</td>` + dateRange.map(d => {
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

      // 创建下拉框
      const select = document.createElement('select');
      select.className = 'shift-select';
      select.innerHTML = `
        <option value="morning" ${currentVal === 'morning' ? 'selected' : ''}>午前 (8:30-12:30)</option>
        <option value="afternoon" ${currentVal === 'afternoon' ? 'selected' : ''}>午後 (12:00-16:00)</option>
        <option value="allday" ${currentVal === 'allday' ? 'selected' : ''}>終日 (8:30-16:00)</option>
        <option value="none" ${currentVal === 'none' ? 'selected' : ''}>シフトなし</option>
      `;

      // 替换内容为下拉框
      this.innerHTML = '';
      this.appendChild(select);
      select.focus();

      // 选择后更新 Firestore 并刷新
      select.addEventListener('change', async () => {
        const newVal = select.value;
        shiftEntry[date] = newVal;
        await updateDoc(doc(db, 'festivalShifts', shiftEntry.id), { [date]: newVal });
        renderTable();
      });

      // 失去焦点时恢复显示（如果没有选择）
      select.addEventListener('blur', () => {
        setTimeout(() => {
          // 如果还没选，恢复原状
          if (shiftEntry[date] === currentVal) {
            renderTable();
          }
        }, 150);
      });
    });
  });
}

// ========== 事件绑定 ==========
function attachEvents() {
  // 期间设定
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
      for (const d of dates) {
        if (!shift[d]) shift[d] = 'none';
      }
      await updateDoc(doc(db, 'festivalShifts', shift.id), shift);
    }
    location.reload();
  });

  // 添加临时成员
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
    // 重新加载并渲染
    await loadAllShifts();
    renderTable();
  });
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text || '';
  return div.innerHTML;
}
