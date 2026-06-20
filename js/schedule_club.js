import { auth, db } from './firebase-init.js';
import { onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/12.14.0/firebase-auth.js';
import {
  collection, getDocs, addDoc, updateDoc, doc, serverTimestamp,
  query, where
} from 'https://www.gstatic.com/firebasejs/12.14.0/firebase-firestore.js';

const days = ['月', '火', '水', '木', '金', '土', '日'];
let currentUser = null;
let currentMember = null;
const noPermissionModal = new bootstrap.Modal(document.getElementById('noPermissionModal'));

document.addEventListener('DOMContentLoaded', () => {
  onAuthStateChanged(auth, async (user) => {
    if (!user) { window.location.href = 'index.html'; return; }
    currentUser = user;
    await loadCurrentMember();
    await syncMembersAndRender();
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

async function loadActiveMembers() {
  const q = query(collection(db, 'members'), where('active', '==', true));
  const snap = await getDocs(q);
  const members = [];
  snap.forEach(d => members.push({ id: d.id, name: d.data().name }));
  return members;
}

async function loadAllShifts() {
  const snap = await getDocs(collection(db, 'clubShifts'));
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
      days.forEach(d => newShift[d] = '-');
      const docRef = await addDoc(collection(db, 'clubShifts'), newShift);
      shiftMap[member.name] = { id: docRef.id, ...newShift };
    } else if (!shiftMap[member.name].memberId) {
      shiftMap[member.name].memberId = member.id;
      await updateDoc(doc(db, 'clubShifts', shiftMap[member.name].id), { memberId: member.id });
    }
  }

  const finalShifts = await loadAllShifts();
  renderTable(finalShifts, activeMembers);
}

function renderTable(shifts, activeMembers) {
  const head = document.getElementById('clubTableHead');
  const body = document.getElementById('clubTableBody');

  let headHTML = '<tr><th>メンバー</th>';
  days.forEach(d => headHTML += `<th>${d}</th>`);
  headHTML += '</tr>';
  head.innerHTML = headHTML;

  const activeMemberNames = activeMembers.map(m => m.name);
  const regularShifts = shifts.filter(s => s.memberName && activeMemberNames.includes(s.memberName));
  const tempShifts = shifts.filter(s => s.memberName && !activeMemberNames.includes(s.memberName));
  regularShifts.sort((a, b) => (a.memberName || '').localeCompare(b.memberName || ''));

  const displayShifts = [...regularShifts, ...tempShifts];

  body.innerHTML = '';
  if (displayShifts.length === 0) {
    body.innerHTML = '<tr><td colspan="8" class="text-center text-muted py-3">メンバーがいません</td></tr>';
    return;
  }

  displayShifts.forEach(shift => {
    const row = document.createElement('tr');
    row.innerHTML = `<td>${escapeHtml(shift.memberName || '')}</td>` + days.map(d => {
      const val = shift[d] || '-';
      return `<td><div class="time-slot ${val === '-' ? 'empty' : ''}" data-member="${shift.memberName}" data-day="${d}">${val}</div></td>`;
    }).join('');
    body.appendChild(row);
  });

  document.querySelectorAll('.time-slot').forEach(slot => {
    slot.addEventListener('click', async () => {
      if (!hasAdminPermission()) {
        noPermissionModal.show();
        return;
      }
      const member = slot.dataset.member;
      const day = slot.dataset.day;
      const shift = shifts.find(s => s.memberName === member);
      const currentVal = shift?.[day] || '-';
      const newVal = prompt(`${member} の ${day}曜日 の予定`, currentVal === '-' ? '' : currentVal);
      if (newVal !== null && shift) {
        shift[day] = newVal.trim() || '-';
        await updateDoc(doc(db, 'clubShifts', shift.id), { [day]: shift[day] });
        slot.textContent = shift[day] || '-';
        slot.className = `time-slot ${shift[day] === '-' ? 'empty' : ''}`;
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
  days.forEach(d => newShift[d] = '-');
  await addDoc(collection(db, 'clubShifts'), newShift);
  location.reload();
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text || '';
  return div.innerHTML;
}