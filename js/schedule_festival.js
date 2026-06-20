import { auth, db } from './firebase-init.js';
import { onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/12.14.0/firebase-auth.js';
import {
  collection, getDocs, addDoc, updateDoc, doc, setDoc, serverTimestamp,
  query, where, orderBy
} from 'https://www.gstatic.com/firebasejs/12.14.0/firebase-firestore.js';

let currentUser = null;
let currentMember = null;
let dateRange = [];

const noPermissionModal = new bootstrap.Modal(document.getElementById('noPermissionModal'));

document.addEventListener('DOMContentLoaded', () => {
  onAuthStateChanged(auth, async (user) => {
    if (!user) { window.location.href = 'index.html'; return; }
    currentUser = user;
    await loadCurrentMember();
    await loadDateRange();
    await syncMembersAndRender();
    document.getElementById('setDatesBtn').addEventListener('click', setDateRange);
    document.getElementById('addMemberBtn').addEventListener('click', addTemporaryMember);
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

async function loadDateRange() {
  const metaSnap = await getDocs(query(collection(db, 'festivalMeta'), orderBy('updatedAt', 'desc')));
  if (!metaSnap.empty) {
    dateRange = metaSnap.docs[0].data().dates || [];
  } else {
    dateRange = [];
  }
}

async function setDateRange() {
  if (!hasAdminPermission()) {
    noPermissionModal.show();
    return;
  }
  const start = prompt('開始日（YYYY-MM-DD）', dateRange[0] || '');
  const end = prompt('終了日（YYYY-MM-DD）', dateRange[dateRange.length - 1] || '');
  if (!start || !end) return;
  const dates = [];
  let cur = new Date(start);
  const endDate = new Date(end);
  while (cur <= endDate) {
    dates.push(cur.toISOString().slice(0, 10));
    cur.setDate(cur.getDate() + 1);
  }
  dateRange = dates;
  try {
    await setDoc(doc(db, 'festivalMeta', 'current'), { dates, updatedAt: serverTimestamp() });
  } catch (e) {
    await setDoc(doc(db, 'festivalMeta', 'current'), { dates, updatedAt: serverTimestamp() });
  }
  location.reload();
}

async function loadActiveMembers() {
  const q = query(collection(db, 'members'), where('active', '==', true));
  const snap = await getDocs(q);
  const members = [];
  snap.forEach(d => members.push({ id: d.id, name: d.data().name }));
  return members;
}

async function loadAllShifts() {
  const snap = await getDocs(collection(db, 'festivalShifts'));
  const shifts = [];
  snap.forEach(d => shifts.push({ id: d.id, ...d.data() }));
  return shifts;
}

async function syncMembersAndRender() {
  const activeMembers = await loadActiveMembers();
  const existingShifts = await loadAllShifts();

  const shiftMap = {};
  existingShifts.forEach(s => {
    if (s.memberName) shiftMap[s.memberName] = s;
  });

  for (const member of activeMembers) {
    if (!shiftMap[member.name]) {
      const newShift = {
        memberId: member.id,
        memberName: member.name,
        createdAt: serverTimestamp()
      };
      dateRange.forEach(d => newShift[d] = '-');
      const docRef = await addDoc(collection(db, 'festivalShifts'), newShift);
      shiftMap[member.name] = { id: docRef.id, ...newShift };
    } else if (!shiftMap[member.name].memberId) {
      shiftMap[member.name].memberId = member.id;
      await updateDoc(doc(db, 'festivalShifts', shiftMap[member.name].id), { memberId: member.id });
    }
  }

  const finalShifts = await loadAllShifts();
  renderTable(finalShifts, activeMembers);
}

function renderTable(shifts, activeMembers) {
  const container = document.getElementById('festivalTableContainer');
  if (dateRange.length === 0) {
    container.innerHTML = '<div class="text-center text-muted py-3">期間が設定されていません。右上の「期間設定」から日付を指定してください。（最高権限が必要）</div>';
    return;
  }

  const activeMemberNames = activeMembers.map(m => m.name);
  const regularShifts = shifts.filter(s => s.memberName && activeMemberNames.includes(s.memberName));
  const tempShifts = shifts.filter(s => s.memberName && !activeMemberNames.includes(s.memberName));
  regularShifts.sort((a, b) => (a.memberName || '').localeCompare(b.memberName || ''));

  const displayShifts = [...regularShifts, ...tempShifts];

  let html = '<div class="shift-table-wrapper"><table class="shift-table"><thead><tr><th>メンバー</th>';
  dateRange.forEach(d => html += `<th>${d}</th>`);
  html += '</tr></thead><tbody>';

  if (displayShifts.length === 0) {
    html += '<tr><td colspan="' + (dateRange.length + 1) + '" class="text-center text-muted py-3">メンバーがいません</td></tr>';
  } else {
    displayShifts.forEach(shift => {
      html += `<tr><td>${escapeHtml(shift.memberName || '')}</td>`;
      dateRange.forEach(d => {
        const val = shift[d] || '-';
        html += `<td><div class="time-slot ${val === '-' ? 'empty' : ''}" data-member="${shift.memberName}" data-date="${d}">${val}</div></td>`;
      });
      html += '</tr>';
    });
  }
  html += '</tbody></table></div>';
  container.innerHTML = html;

  document.querySelectorAll('.time-slot').forEach(slot => {
    slot.addEventListener('click', async () => {
      if (!hasAdminPermission()) {
        noPermissionModal.show();
        return;
      }
      const member = slot.dataset.member;
      const date = slot.dataset.date;
      const shift = shifts.find(s => s.memberName === member);
      const currentVal = shift?.[date] || '-';
      const newVal = prompt(`${member} の ${date} のシフト`, currentVal === '-' ? '' : currentVal);
      if (newVal !== null && shift) {
        shift[date] = newVal.trim() || '-';
        await updateDoc(doc(db, 'festivalShifts', shift.id), { [date]: shift[date] });
        slot.textContent = shift[date] || '-';
        slot.className = `time-slot ${shift[date] === '-' ? 'empty' : ''}`;
      }
    });
  });
}

async function addTemporaryMember() {
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
  dateRange.forEach(d => newShift[d] = '-');
  await addDoc(collection(db, 'festivalShifts'), newShift);
  location.reload();
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text || '';
  return div.innerHTML;
}