// ── Canonical field definitions (display side) ──
const FIELDS = [
  { key: 'fullName',   label: 'Full name' },
  { key: 'firstName',  label: 'First name' },
  { key: 'lastName',   label: 'Last name' },
  { key: 'email',      label: 'Email' },
  { key: 'phone',      label: 'Phone' },
  { key: 'jobTitle',   label: 'Job title' },
  { key: 'department', label: 'Department' },
  { key: 'startDate',  label: 'Start date' },
  { key: 'manager',    label: 'Manager' },
  { key: 'screeningLevel', label: 'Screening level' },
  { key: 'addressLine1', label: 'Address' },
  { key: 'city',       label: 'City' },
  { key: 'postcode',   label: 'Postcode' },
  { key: 'salary',     label: 'Salary', sensitive: true },
  { key: 'dob',        label: 'Date of birth', sensitive: true },
  { key: 'nino',       label: 'NI number', sensitive: true },
];

const $ = (id) => document.getElementById(id);
let state = { profiles: [], activeId: null };

async function load() {
  const s = await chrome.storage.local.get(['profiles', 'activeId']);
  state.profiles = Array.isArray(s.profiles) ? s.profiles : [];
  state.activeId = s.activeId || (state.profiles[0] && state.profiles[0].id) || null;
  render();
}

function activeProfile() {
  return state.profiles.find((p) => p.id === state.activeId) || null;
}

function render() {
  const sel = $('profileSelect');
  sel.innerHTML = state.profiles
    .map((p) => `<option value="${p.id}"${p.id === state.activeId ? ' selected' : ''}>${esc(p.label)}</option>`)
    .join('');
  const has = state.profiles.length > 0;
  $('empty').hidden = has;
  sel.hidden = !has;
  $('fillBtn').disabled = !has;

  const p = activeProfile();
  const incl = $('sensitive').checked;
  $('fields').innerHTML = !p ? '' : FIELDS
    .filter((f) => p.data[f.key])
    .map((f) => {
      const masked = f.sensitive && !incl;
      const val = masked ? '••••••' : p.data[f.key];
      return `<div class="row">
        <span class="k">${f.label}</span>
        <span class="v ${f.sensitive ? 'sens' : ''}">${esc(val)}</span>
        <button class="copy" data-val="${esc(p.data[f.key])}">Copy</button>
      </div>`;
    }).join('');

  document.querySelectorAll('.copy').forEach((b) => {
    b.onclick = () => {
      navigator.clipboard.writeText(b.dataset.val);
      b.textContent = 'Copied';
      setTimeout(() => (b.textContent = 'Copy'), 1000);
    };
  });
}

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"]/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

// ── Events ──
$('profileSelect').onchange = (e) => {
  state.activeId = e.target.value;
  chrome.storage.local.set({ activeId: state.activeId });
  render();
};
$('sensitive').onchange = render;

$('fillBtn').onclick = async () => {
  const p = activeProfile();
  if (!p) return;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.id) return;
  const opts = { includeSensitive: $('sensitive').checked };
  try {
    const [res] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: breezeFillPage,
      args: [p.data, opts],
    });
    const r = res && res.result;
    const st = $('status');
    if (!r) { st.textContent = 'Could not run on this page.'; st.className = 'status'; return; }
    st.textContent = r.filled + ' field' + (r.filled === 1 ? '' : 's') + ' filled'
      + (r.skippedSensitive ? ' · ' + r.skippedSensitive + ' sensitive skipped' : '');
    st.className = 'status ok';
  } catch (e) {
    $('status').textContent = 'This page blocks autofill (try the Copy buttons).';
    $('status').className = 'status';
  }
};

// ── Manual add/edit ──
$('addToggle').onclick = () => {
  const f = $('addForm');
  f.hidden = !f.hidden;
  if (!f.hidden && !f.dataset.built) {
    f.innerHTML = FIELDS.map((x) =>
      `<input data-key="${x.key}" placeholder="${x.label}${x.sensitive ? ' (sensitive)' : ''}">`
    ).join('') + '<button type="submit" class="save">Save employee</button>';
    f.dataset.built = '1';
    const p = activeProfile();
    if (p) f.querySelectorAll('input').forEach((i) => (i.value = p.data[i.dataset.key] || ''));
  }
};
$('addForm').onsubmit = async (e) => {
  e.preventDefault();
  const data = {};
  e.target.querySelectorAll('input').forEach((i) => {
    if (i.value.trim()) data[i.dataset.key] = i.value.trim();
  });
  if (!data.fullName && (data.firstName || data.lastName)) {
    data.fullName = [data.firstName, data.lastName].filter(Boolean).join(' ');
  }
  if (!Object.keys(data).length) return;
  const id = 'p_' + Math.random().toString(36).slice(2, 10);
  state.profiles.unshift({ id, label: data.fullName || data.email || 'Profile', data });
  state.activeId = id;
  await chrome.storage.local.set({ profiles: state.profiles, activeId: id });
  e.target.hidden = true;
  render();
};

load();

// ════════════════════════════════════════════════════════════════════════
// Injected into the target page. Self-contained — no access to popup scope.
// Heuristic field matching: inspects each input's type, autocomplete, name,
// id, placeholder, aria-label and nearby <label> text, and fills the best
// canonical match. Only fills empty fields; never overwrites.
// ════════════════════════════════════════════════════════════════════════
function breezeFillPage(profile, opts) {
  const SENSITIVE = { salary: 1, dob: 1, nino: 1 };
  // Priority order: specific before generic (fullName last).
  const RULES = [
    { key: 'email', ac: ['email'], kw: ['email', 'e-mail'] },
    { key: 'phone', ac: ['tel', 'tel-national'], kw: ['phone', 'mobile', 'telephone', 'contact number', 'tel'] },
    { key: 'firstName', ac: ['given-name'], kw: ['first name', 'firstname', 'given name', 'forename', 'first'] },
    { key: 'lastName', ac: ['family-name'], kw: ['last name', 'lastname', 'surname', 'family name', 'last'] },
    { key: 'dob', ac: ['bday'], kw: ['date of birth', 'dob', 'birth date', 'birthday'] },
    { key: 'nino', ac: [], kw: ['national insurance', 'ni number', 'nino', 'insurance number'] },
    { key: 'postcode', ac: ['postal-code'], kw: ['postcode', 'post code', 'postal code', 'zip'] },
    { key: 'city', ac: ['address-level2'], kw: ['city', 'town'] },
    { key: 'addressLine1', ac: ['street-address', 'address-line1'], kw: ['address', 'street', 'address line'] },
    { key: 'startDate', ac: [], kw: ['start date', 'commencement', 'joining date', 'date of joining', 'start'] },
    { key: 'manager', ac: [], kw: ['manager', 'line manager', 'supervisor', 'reporting to'] },
    { key: 'department', ac: [], kw: ['department', 'dept', 'team'] },
    { key: 'screeningLevel', ac: [], kw: ['screening level', 'check level', 'level of check', 'dbs level', 'screening'] },
    { key: 'salary', ac: [], kw: ['salary', 'annual salary', 'remuneration', 'compensation'] },
    { key: 'jobTitle', ac: ['organization-title'], kw: ['job title', 'jobtitle', 'position', 'role'] },
    { key: 'fullName', ac: ['name'], kw: ['full name', 'fullname', 'candidate name', 'employee name', 'applicant name', 'name'] },
  ];
  const EXCLUDE = ['username', 'user name', 'company', 'employer', 'file', 'search', 'password', 'confirm'];

  function sig(el) {
    let label = '';
    if (el.id) {
      const l = document.querySelector('label[for="' + CSS.escape(el.id) + '"]');
      if (l) label = l.textContent;
    }
    if (!label) {
      const wrap = el.closest('label');
      if (wrap) label = wrap.textContent;
    }
    if (!label && el.getAttribute('aria-labelledby')) {
      const ref = document.getElementById(el.getAttribute('aria-labelledby'));
      if (ref) label = ref.textContent;
    }
    return [
      el.name, el.id, el.placeholder, el.getAttribute('aria-label'),
      el.getAttribute('autocomplete'), label,
    ].filter(Boolean).join(' ').toLowerCase();
  }

  function setValue(el, value) {
    const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
    setter.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function setSelect(el, value) {
    const want = String(value).toLowerCase();
    const opt = [...el.options].find(
      (o) => o.textContent.toLowerCase().includes(want) || o.value.toLowerCase().includes(want)
    );
    if (opt) {
      el.value = opt.value;
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    }
    return false;
  }

  let filled = 0, skippedSensitive = 0;
  const els = document.querySelectorAll('input, select, textarea');
  els.forEach((el) => {
    if (el.disabled || el.readOnly) return;
    const type = (el.type || '').toLowerCase();
    if (['password', 'hidden', 'file', 'submit', 'button', 'checkbox', 'radio', 'search'].includes(type)) return;
    const isSelect = el.tagName === 'SELECT';
    if (!isSelect && el.value && el.value.trim()) return; // don't overwrite

    const s = sig(el);
    if (!s) return;
    if (EXCLUDE.some((x) => s.includes(x))) return;

    const ac = (el.getAttribute('autocomplete') || '').toLowerCase();
    for (const rule of RULES) {
      const hit = (rule.ac.includes(ac) && ac) || rule.kw.some((k) => s.includes(k));
      if (!hit) continue;
      const value = profile[rule.key];
      if (value == null || value === '') break;
      if (SENSITIVE[rule.key] && !opts.includeSensitive) { skippedSensitive++; break; }
      const ok = isSelect ? setSelect(el, value) : (setValue(el, value), true);
      if (ok) filled++;
      break;
    }
  });
  return { filled, skippedSensitive };
}
