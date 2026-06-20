import { auth, db } from './firebase-init.js';
import { signInWithEmailAndPassword } from 'https://www.gstatic.com/firebasejs/12.14.0/firebase-auth.js';
import { collection, getDocs, doc, setDoc, serverTimestamp } from 'https://www.gstatic.com/firebasejs/12.14.0/firebase-firestore.js';
import { createUserWithEmailAndPassword } from 'https://www.gstatic.com/firebasejs/12.14.0/firebase-auth.js';

/* ========== DOM 元素 ========== */
const loginCard = document.getElementById('loginCard');
const selectTrigger = document.getElementById('userSelectTrigger');
const selectedText = document.getElementById('selectedUserText');
const optionsContainer = document.getElementById('userOptions');
const passwordInput = document.getElementById('passwordInput');
const togglePwdBtn = document.getElementById('togglePwd');
const loginBtn = document.getElementById('loginBtn');
const errorMsgDiv = document.getElementById('errorMessage');

const initCard = document.getElementById('initCard');
const initCardTitle = document.getElementById('initCardTitle');
const initCardDesc = document.getElementById('initCardDesc');
const initNameInput = document.getElementById('initName');
const initEmailInput = document.getElementById('initEmail');
const initPasswordInput = document.getElementById('initPassword');
const initPasswordConfirmInput = document.getElementById('initPasswordConfirm');
const initBtn = document.getElementById('initBtn');
const initErrorDiv = document.getElementById('initError');

const devModal = document.getElementById('devModal');
const devCloseBtn = document.getElementById('devModalClose');
const devEmailInput = document.getElementById('devEmail');
const devPasswordInput = document.getElementById('devPassword');
const devLoginBtn = document.getElementById('devLoginBtn');
const devErrorDiv = document.getElementById('devError');

/* ========== 状态 ========== */
let members = [];
let selectedMember = null;
let isOptionsOpen = false;
let setupMode = null; // 'president' | 'member' | null

/* ========== 初始化 ========== */
document.addEventListener('DOMContentLoaded', async () => {
  try {
    const isEmpty = await checkMembersEmpty();
    if (isEmpty) {
      showInitMode('president');
    } else {
      await loadMembers();
      attachLoginEvents();
    }
    attachDevEvents();
  } catch (err) {
    console.error('初期化エラー:', err);
    // 如果连初始检查都失败，可能是网络问题
    showLoginMode();
    attachLoginEvents();
    attachDevEvents();
    showError(errorMsgDiv, 'サーバーに接続できません。ネットワークを確認してください。');
  }
});

/* ========== 检查 members 是否为空 ========== */
async function checkMembersEmpty() {
  try {
    const qs = await getDocs(collection(db, 'members'));
    return qs.empty;
  } catch (e) {
    console.error('メンバーリスト取得エラー:', e);
    throw e; // 抛出到上层处理
  }
}

/* ========== 模式切换 ========== */
function showInitMode(mode) {
  setupMode = mode;
  loginCard.style.display = 'none';
  initCard.style.display = 'block';

  if (mode === 'president') {
    initCardTitle.textContent = '初期設定';
    initCardDesc.textContent = 'メンバーが存在しません。最初の管理者を登録してください。';
    initNameInput.disabled = false;
    initNameInput.value = '';
    initBtn.textContent = '初期化';
  } else if (mode === 'member' && selectedMember) {
    initCardTitle.textContent = 'アカウント設定';
    initCardDesc.textContent = '初回ログインです。メールアドレスとパスワードを設定してください。';
    initNameInput.value = selectedMember.name;
    initNameInput.disabled = true;
    initBtn.textContent = '設定してログイン';
  }
  initEmailInput.value = '';
  initPasswordInput.value = '';
  initPasswordConfirmInput.value = '';
  clearError(initErrorDiv);
  attachInitEvents();
}

function showLoginMode() {
  setupMode = null;
  initCard.style.display = 'none';
  loginCard.style.display = 'block';
}

/* ========== 加载活跃成员 ========== */
async function loadMembers() {
  try {
    const qs = await getDocs(collection(db, 'members'));
    members = [];
    qs.forEach(doc => {
      const d = doc.data();
      // 只显示 active 成员
      if (d.active === true) {
        members.push({
          id: doc.id,
          name: d.name,
          position: d.position || '',
          role: d.role,
          email: d.email || null
        });
      }
    });
    // 排序
    members.sort((a, b) => {
      const order = { President: 0, Advisor: 1, Member: 2 };
      const oa = order[a.role] ?? 3, ob = order[b.role] ?? 3;
      if (oa !== ob) return oa - ob;
      return a.name.localeCompare(b.name);
    });
    renderUserOptions();
  } catch (e) {
    console.error('メンバー読み込み失敗:', e);
    // 显示错误并提供重试按钮
    members = [];
    renderUserOptions();
    showError(errorMsgDiv, 'メンバー情報を取得できませんでした。ページをリロードしてください。');
  }
}

/* ========== 渲染下拉选项 ========== */
function renderUserOptions() {
  optionsContainer.innerHTML = '';
  if (members.length === 0) {
    const opt = document.createElement('div');
    opt.className = 'custom-option text-muted';
    opt.textContent = 'ユーザーが見つかりません';
    optionsContainer.appendChild(opt);
    return;
  }
  members.forEach(m => {
    const opt = document.createElement('div');
    opt.className = 'custom-option';
    opt.textContent = m.name; // 只显示姓名
    opt.dataset.memberId = m.id;
    opt.addEventListener('click', () => {
      selectMember(m);
      closeOptions();
    });
    optionsContainer.appendChild(opt);
  });
}

/* ========== 选择成员 ========== */
function selectMember(member) {
  selectedMember = member;
  selectedText.textContent = member.name;
  selectedText.classList.remove('placeholder');
  document.querySelectorAll('.custom-option').forEach(opt => {
    opt.classList.toggle('selected', opt.dataset.memberId === member.id);
  });
  clearError(errorMsgDiv);
}

/* ========== 下拉框开关 ========== */
function toggleOptions() { isOptionsOpen ? closeOptions() : openOptions(); }

function openOptions() {
  if (members.length === 0) return;
  isOptionsOpen = true;
  optionsContainer.classList.add('open');
  selectTrigger.classList.add('active');
  if (selectedMember) {
    document.querySelectorAll('.custom-option').forEach(opt => {
      opt.classList.toggle('selected', opt.dataset.memberId === selectedMember.id);
    });
  }
}

function closeOptions() {
  isOptionsOpen = false;
  optionsContainer.classList.remove('open');
  selectTrigger.classList.remove('active');
}

/* ========== 登录事件绑定 ========== */
function attachLoginEvents() {
  selectTrigger.addEventListener('click', toggleOptions);
  document.addEventListener('click', (e) => {
    if (!selectTrigger.contains(e.target) && !optionsContainer.contains(e.target)) closeOptions();
  });
  togglePwdBtn.addEventListener('click', () => {
    const type = passwordInput.getAttribute('type') === 'password' ? 'text' : 'password';
    passwordInput.setAttribute('type', type);
    togglePwdBtn.textContent = type === 'password' ? '👁️' : '🙈';
  });
  passwordInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') loginBtn.click(); });
  loginBtn.addEventListener('click', handleLogin);
}

/* ========== 登录处理 ========== */
async function handleLogin() {
  clearError(errorMsgDiv);
  if (!selectedMember) { showError(errorMsgDiv, 'ユーザーを選択してください。'); return; }
  const pw = passwordInput.value.trim();
  if (!pw) { showError(errorMsgDiv, 'パスワードを入力してください。'); return; }

  // 成员未设定邮箱 → 进入初期設定流程
  if (!selectedMember.email) {
    if (pw !== '123456') {
      showError(errorMsgDiv, 'パスワードが正しくありません。初回ログインは「123456」を入力してください。');
      return;
    }
    showInitMode('member');
    return;
  }

  loginBtn.disabled = true; loginBtn.textContent = 'ログイン中…';
  try {
    await signInWithEmailAndPassword(auth, selectedMember.email, pw);
    window.location.href = 'dashboard.html';
  } catch (error) {
    console.error(error);
    loginBtn.disabled = false; loginBtn.textContent = 'ログイン';
    if (error.code === 'auth/invalid-credential' || error.code === 'auth/wrong-password')
      showError(errorMsgDiv, 'パスワードが正しくありません。');
    else if (error.code === 'auth/user-not-found')
      showError(errorMsgDiv, 'ユーザー情報が見つかりません。システム管理者に連絡してください。');
    else if (error.code === 'auth/network-request-failed')
      showError(errorMsgDiv, 'ネットワークエラーが発生しました。');
    else
      showError(errorMsgDiv, 'ログインに失敗しました。もう一度お試しください。');
  }
}

/* ========== 初期設定事件 ========== */
function attachInitEvents() {
  initBtn.addEventListener('click', handleInit);
  initPasswordConfirmInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') initBtn.click(); });
}

/* ========== 初期設定处理 ========== */
async function handleInit() {
  clearError(initErrorDiv);
  const name = initNameInput.value.trim();
  const email = initEmailInput.value.trim();
  const pw = initPasswordInput.value;
  const pw2 = initPasswordConfirmInput.value;

  if (!name) { showError(initErrorDiv, '氏名を入力してください。'); return; }
  if (!email) { showError(initErrorDiv, 'メールアドレスを入力してください。'); return; }
  if (!pw) { showError(initErrorDiv, 'パスワードを入力してください。'); return; }
  if (pw.length < 6) { showError(initErrorDiv, 'パスワードは6文字以上で設定してください。'); return; }
  if (pw !== pw2) { showError(initErrorDiv, 'パスワードが一致しません。'); return; }

  initBtn.disabled = true; initBtn.textContent = setupMode === 'president' ? '初期化中…' : '設定中…';

  try {
    if (setupMode === 'president') {
      // 会长初始化：创建 Auth 用户，并写入完整 members 文档
      const uc = await createUserWithEmailAndPassword(auth, email, pw);
      const uid = uc.user.uid;
      await setDoc(doc(db, 'members', uid), {
        name, attendanceNumber: 1, role: 'President', position: '', email,
        active: true, color: '#3B82F6', createdAt: serverTimestamp(), updatedAt: serverTimestamp()
      });
    } else if (setupMode === 'member' && selectedMember) {
      // 成员初期设定：创建 Auth 用户，并更新已有 members 文档的 email
      const uc = await createUserWithEmailAndPassword(auth, email, pw);
      await setDoc(doc(db, 'members', selectedMember.id), {
        email: email,
        updatedAt: serverTimestamp()
      }, { merge: true });
    }
    window.location.href = 'dashboard.html';
  } catch (error) {
    console.error(error);
    initBtn.disabled = false;
    initBtn.textContent = setupMode === 'president' ? '初期化' : '設定してログイン';
    if (error.code === 'auth/email-already-in-use')
      showError(initErrorDiv, 'このメールアドレスは既に使用されています。');
    else if (error.code === 'auth/network-request-failed')
      showError(initErrorDiv, 'ネットワークエラーが発生しました。');
    else
      showError(initErrorDiv, '設定に失敗しました。もう一度お試しください。');
  }
}

/* ========== 开发者弹窗 ========== */
function attachDevEvents() {
  const logos = document.querySelectorAll('.logo-click-area');
  let cnt = 0, timer = null;
  logos.forEach(el => {
    el.addEventListener('click', () => {
      cnt++;
      if (cnt === 1) timer = setTimeout(() => { cnt = 0; }, 1500);
      if (cnt >= 5) { clearTimeout(timer); cnt = 0; openDevModal(); }
    });
  });
  devCloseBtn.addEventListener('click', closeDevModal);
  devModal.addEventListener('click', (e) => { if (e.target === devModal) closeDevModal(); });
  devLoginBtn.addEventListener('click', handleDevLogin);
  devPasswordInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') devLoginBtn.click(); });
}

function openDevModal() {
  devModal.classList.add('open'); devEmailInput.value = ''; devPasswordInput.value = ''; clearError(devErrorDiv);
}
function closeDevModal() { devModal.classList.remove('open'); }

async function handleDevLogin() {
  clearError(devErrorDiv);
  const email = devEmailInput.value.trim(), pw = devPasswordInput.value.trim();
  if (!email) { showError(devErrorDiv, 'メールアドレスを入力してください。'); return; }
  if (!pw) { showError(devErrorDiv, 'パスワードを入力してください。'); return; }
  devLoginBtn.disabled = true; devLoginBtn.textContent = 'ログイン中…';
  try {
    await signInWithEmailAndPassword(auth, email, pw);
    closeDevModal();
    window.location.href = 'dashboard.html';
  } catch (error) {
    devLoginBtn.disabled = false; devLoginBtn.textContent = 'ログイン';
    if (error.code === 'auth/invalid-credential' || error.code === 'auth/wrong-password')
      showError(devErrorDiv, 'パスワードが正しくありません。');
    else if (error.code === 'auth/user-not-found')
      showError(devErrorDiv, 'ユーザー情報が見つかりません。');
    else if (error.code === 'auth/network-request-failed')
      showError(devErrorDiv, 'ネットワークエラーが発生しました。');
    else showError(devErrorDiv, 'ログインに失敗しました。');
  }
}

/* ========== 工具函数 ========== */
function showError(el, msg) { el.textContent = msg; el.style.display = 'block'; }
function clearError(el) { el.textContent = ''; el.style.display = 'none'; }