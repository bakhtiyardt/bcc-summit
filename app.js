// Опросы BCC Life: статическая страница + Supabase (все права проверяются функциями в базе).
const CFG = window.OPROSY_CONFIG || {};
const APP_URL = location.origin + location.pathname;
const $app = document.getElementById("app");

const S = {
  key:null, clientId:null, polls:[], results:{}, loaded:false, loadErr:null,
  view:"list", pollId:null, draft:null, msg:null, busy:false, confirmDelete:false,
  pub:null, pubState:"loading", form:{}, formState:"idle", formMsg:"", already:false, showKey:false
};

// ---------- хранилище браузера ----------
const ls = {
  get(k){ try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v){ try { localStorage.setItem(k, v); } catch {} }
};
function randomToken(len){
  const abc = "abcdefghijklmnopqrstuvwxyz0123456789", a = new Uint8Array(len);
  crypto.getRandomValues(a);
  return Array.from(a, b => abc[b % abc.length]).join("");
}

// ---------- Supabase RPC ----------
async function rpc(fn, args){
  if (!CFG.supabaseUrl || !CFG.supabaseKey) throw new Error("no_config");
  const headers = {"Content-Type":"application/json", apikey:CFG.supabaseKey};
  if (!CFG.supabaseKey.startsWith("sb_")) headers.Authorization = "Bearer " + CFG.supabaseKey;
  const res = await fetch(CFG.supabaseUrl.replace(/\/$/, "") + "/rest/v1/rpc/" + fn, {method:"POST", headers, body:JSON.stringify(args)});
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) { const e = new Error((data && data.message) || "http_" + res.status); e.status = res.status; throw e; }
  return data;
}

// ---------- утилиты ----------
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const rid = () => randomToken(8);
const plural = (n, one, few, many) => { const a = n % 10, b = n % 100; return a === 1 && b !== 11 ? one : a >= 2 && a <= 4 && (b < 10 || b >= 20) ? few : many; };
const hashPoll = () => { const m = location.hash.match(/^#p-([a-z0-9]+)$/i); return m ? m[1] : null; };
const pollLink = id => APP_URL + "#p-" + id;
const fmtDate = t => t ? new Date(t).toLocaleString("ru-RU", {day:"numeric", month:"long", hour:"2-digit", minute:"2-digit"}) : "";
function on(sel, fn){ const el = $app.querySelector(sel); if (el) el.onclick = fn; }

// ---------- автоподбор вариантов ----------
const TEMPLATES = [
  [/темп|скорост/i, ["Слишком быстро","В самый раз","Слишком медленно"]],
  [/порекоменд|посовету/i, ["Да, обязательно","Скорее да","Скорее нет","Нет"]],
  [/длительн|продолжительн|длин/i, ["Слишком коротко","В самый раз","Слишком долго"]],
  [/как часто/i, ["Каждый день","Несколько раз в неделю","Раз в неделю","Реже","Никогда"]],
  [/формат|онлайн|офлайн|очно/i, ["Очно","Онлайн","Гибридный формат"]],
  [/в какое время|когда удобн|время/i, ["Утром","Днём","Вечером"]],
  [/насколько.*(полез|интерес|понят|важн|удобн)/i, ["Очень","Скорее да","Нейтрально","Скорее нет","Совсем нет"]],
  [/довольн|удовлетвор/i, ["Полностью доволен","Скорее доволен","Нейтрально","Скорее недоволен","Недоволен"]],
  [/оцен|как вам|качеств/i, ["Отлично","Хорошо","Удовлетворительно","Плохо"]],
  [/сложн|трудн/i, ["Слишком сложно","В самый раз","Слишком просто"]],
];
function suggestOptions(text){
  const t = (text || "").trim();
  for (const [re, opts] of TEMPLATES) if (re.test(t)) return opts.slice();
  return ["Да","Нет","Затрудняюсь ответить"];
}

const EXAMPLE = () => ({
  id:null, title:"Обратная связь о воркшопе",
  description:"Помогите сделать следующий воркшоп лучше. Три вопроса, около минуты.",
  questions:[
    {id:rid(), text:"Насколько полезным был воркшоп?", options:["Очень полезным","Скорее полезным","Нейтрально","Скорее бесполезным"], auto:false},
    {id:rid(), text:"Как вам темп подачи материала?", options:["Слишком быстро","В самый раз","Слишком медленно"], auto:false},
    {id:rid(), text:"Порекомендуете ли вы воркшоп коллегам?", options:["Да, обязательно","Скорее да","Скорее нет","Нет"], auto:false},
  ]
});
const BLANK = () => ({id:null, title:"", description:"", questions:[{id:rid(), text:"", options:[], auto:false}]});

// ---------- загрузка данных автора ----------
async function loadPolls(){
  try { S.polls = await rpc("list_my_polls", {p_key:S.key}) || []; S.loadErr = null; }
  catch (e) { S.loadErr = e.message === "no_config" ? "no_config" : "net"; }
  S.loaded = true;
}
async function loadResults(id){
  try { const r = await rpc("get_results", {p_key:S.key, p_id:id}); if (r) S.results[id] = r; } catch {}
}
let pollTimer = null;
function startResultsPolling(id){
  stopResultsPolling();
  pollTimer = setInterval(async () => {
    if (document.hidden || S.view !== "poll" || S.pollId !== id) return;
    const before = JSON.stringify(S.results[id]);
    await loadResults(id);
    if (JSON.stringify(S.results[id]) !== before) render();
  }, 5000);
}
function stopResultsPolling(){ if (pollTimer) clearInterval(pollTimer); pollTimer = null; }

// ---------- рендер ----------
function render(){
  const hp = hashPoll();
  document.getElementById("role").textContent = hp ? "Анкета" : "Автор";
  if (!CFG.supabaseUrl || !CFG.supabaseKey){
    $app.innerHTML = `<div class="card stack"><h2>База ещё не подключена</h2><p class="muted">Заполните адрес и ключ Supabase в файле config.js.</p></div>`; return;
  }
  if (hp) return renderForm(hp);
  if (S.view === "edit") return renderEditor();
  if (S.view === "poll") return renderPoll();
  renderList();
}

function statusPill(p){
  return p.status === "published" ? `<span class="pill live">Идёт приём ответов</span>`
       : p.status === "closed" ? `<span class="pill closed">Приём закрыт</span>`
       : `<span class="pill draft">Черновик</span>`;
}

function renderList(){
  if (!S.loaded){ $app.innerHTML = `<p class="muted">Загрузка опросов…</p>`; return; }
  const authorLink = APP_URL + "#a-" + S.key;
  const items = S.polls.map(p => `
    <button class="card poll-item" data-open="${esc(p.id)}" type="button">
      <div class="stack" style="gap:4px">
        <h3>${esc(p.title || "Без названия")}</h3>
        <span class="muted small">${p.questions.length} ${plural(p.questions.length,"вопрос","вопроса","вопросов")}</span>
      </div>
      <div class="meta">
        ${statusPill(p)}
        ${p.status !== "draft" ? `<span class="small muted"><span class="count">${p.responses}</span> ${plural(+p.responses,"анкета","анкеты","анкет")}</span>` : ""}
      </div>
    </button>`).join("");
  $app.innerHTML = `
    <div class="stack">
      <div class="row between">
        <h1>Мои опросы</h1>
        <div class="row">
          <button type="button" id="newEx">Создать из примера</button>
          <button type="button" class="primary" id="newBlank">Новый опрос</button>
        </div>
      </div>
      ${S.loadErr ? `<div class="notice err">Не удалось загрузить опросы. Проверьте интернет и обновите страницу.</div>` : ""}
      ${S.msg ? `<div class="notice ${S.msg.type||""}">${esc(S.msg.text)}</div>` : ""}
      ${items || `<div class="card stack"><h2>Опросов пока нет</h2><p class="muted">Начните с готового примера «Обратная связь о воркшопе» или создайте свой опрос. Варианты ответов приложение предложит само, вы сможете их поправить.</p><div class="row"><button type="button" class="primary" id="newEx2">Создать из примера</button></div></div>`}
      <div class="card stack">
        <div class="row between"><h3>Ключ автора</h3><button type="button" class="ghost" id="toggleKey">${S.showKey ? "Скрыть" : "Показать"}</button></div>
        <p class="muted small">Ваши опросы привязаны к этому браузеру. Чтобы открыть их на другом устройстве, откройте там эту ссылку. Никому её не передавайте: по ней видны результаты и управление опросами.</p>
        ${S.showKey ? `<div class="linkbox"><input type="text" id="keyField" readonly value="${esc(authorLink)}" aria-label="Ссылка автора"><button type="button" id="copyKey">Копировать</button></div>` : ""}
      </div>
    </div>`;
  on("#newEx", () => openEditor(EXAMPLE()));
  on("#newEx2", () => openEditor(EXAMPLE()));
  on("#newBlank", () => openEditor(BLANK()));
  on("#toggleKey", () => { S.showKey = !S.showKey; render(); });
  on("#copyKey", () => copyText(authorLink, "keyField", "copyKey"));
  $app.querySelectorAll("[data-open]").forEach(b => b.onclick = () => openPoll(b.dataset.open));
}

async function openPoll(id){
  S.view = "poll"; S.pollId = id; S.msg = null; S.confirmDelete = false;
  render(); scrollTo(0,0);
  await loadResults(id); render();
  startResultsPolling(id);
}
function openEditor(d){ stopResultsPolling(); S.draft = d; S.view = "edit"; S.msg = null; render(); scrollTo(0,0); }
function toList(){ stopResultsPolling(); S.view = "list"; render(); loadPolls().then(render); }

function renderEditor(){
  const d = S.draft;
  const qs = d.questions.map((q, qi) => `
    <div class="q-edit" data-q="${qi}">
      <div class="row between"><span class="q-num">Вопрос ${qi+1}</span>
        ${d.questions.length > 1 ? `<button type="button" class="ghost danger" data-delq="${qi}">Удалить вопрос</button>` : ""}</div>
      <label class="f">Текст вопроса<input type="text" id="q-${q.id}" data-qtext="${qi}" value="${esc(q.text)}" placeholder="Например: Как вам темп подачи материала?" maxlength="200"></label>
      <div class="stack" style="gap:8px">
        <div class="row between">
          <span class="small" style="font-weight:700">Варианты ответа (один выбор)</span>
          ${q.auto ? `<span class="pill auto">Предложено автоматически</span>` : ""}
        </div>
        ${q.options.length ? q.options.map((o, oi) => `
          <div class="opt-edit">
            <input type="text" id="o-${q.id}-${oi}" data-opt="${qi}:${oi}" value="${esc(o)}" maxlength="120" aria-label="Вариант ${oi+1}">
            <button type="button" data-delo="${qi}:${oi}" aria-label="Удалить вариант" ${q.options.length <= 2 ? "disabled" : ""}>✕</button>
          </div>`).join("") : `<p class="muted small">Введите текст вопроса, и варианты появятся автоматически.</p>`}
        <div class="row">
          <button type="button" class="ghost" data-addo="${qi}" ${q.options.length >= 10 ? "disabled" : ""}>+ Вариант</button>
          <button type="button" class="ghost" data-auto="${qi}">Подобрать варианты</button>
        </div>
      </div>
    </div>`).join("");
  $app.innerHTML = `
    <div class="stack">
      <div class="row between"><button type="button" class="ghost" id="back">← К опросам</button><span class="pill draft">Черновик</span></div>
      <h1>${d.id ? "Редактирование опроса" : "Новый опрос"}</h1>
      <div class="card stack">
        <label class="f">Название<input type="text" id="t-title" value="${esc(d.title)}" maxlength="120" placeholder="Например: Обратная связь о воркшопе"></label>
        <label class="f">Описание<textarea id="t-desc" maxlength="500" placeholder="Коротко: зачем опрос и сколько времени займёт">${esc(d.description)}</textarea></label>
      </div>
      ${qs}
      <button type="button" id="addQ">+ Добавить вопрос</button>
      ${S.msg ? `<div class="notice ${S.msg.type||""}">${esc(S.msg.text)}</div>` : ""}
      <div class="row">
        <button type="button" id="save" ${S.busy ? "disabled" : ""}>Сохранить черновик</button>
        <button type="button" class="primary" id="publish" ${S.busy ? "disabled" : ""}>Опубликовать и получить ссылку</button>
      </div>
      <p class="muted small">После публикации вопросы и варианты менять нельзя, чтобы не исказить уже собранные ответы.</p>
    </div>`;
  on("#back", toList);
  on("#addQ", () => { d.questions.push({id:rid(), text:"", options:[], auto:false}); render(); document.getElementById("q-" + d.questions.at(-1).id)?.focus(); });
  on("#save", () => savePoll("draft"));
  on("#publish", () => savePoll("published"));
  document.getElementById("t-title").oninput = e => d.title = e.target.value;
  document.getElementById("t-desc").oninput = e => d.description = e.target.value;
  $app.querySelectorAll("[data-qtext]").forEach(inp => {
    const q = d.questions[+inp.dataset.qtext];
    inp.oninput = () => q.text = inp.value;
    inp.onchange = () => { if (!q.options.length && q.text.trim()){ q.options = suggestOptions(q.text); q.auto = true; render(); } };
  });
  $app.querySelectorAll("[data-opt]").forEach(inp => { const [qi, oi] = inp.dataset.opt.split(":").map(Number); inp.oninput = () => { d.questions[qi].options[oi] = inp.value; }; });
  $app.querySelectorAll("[data-delo]").forEach(b => b.onclick = () => { const [qi, oi] = b.dataset.delo.split(":").map(Number); d.questions[qi].options.splice(oi, 1); render(); });
  $app.querySelectorAll("[data-addo]").forEach(b => b.onclick = () => { const q = d.questions[+b.dataset.addo]; q.options.push(""); render(); document.getElementById(`o-${q.id}-${q.options.length-1}`)?.focus(); });
  $app.querySelectorAll("[data-delq]").forEach(b => b.onclick = () => { d.questions.splice(+b.dataset.delq, 1); render(); });
  $app.querySelectorAll("[data-auto]").forEach(b => b.onclick = () => { const q = d.questions[+b.dataset.auto]; if (!q.text.trim()){ S.msg = {type:"err", text:"Сначала введите текст вопроса."}; return render(); } q.options = suggestOptions(q.text); q.auto = true; S.msg = null; render(); });
}

function validate(d){
  if (!d.title.trim()) return "Укажите название опроса.";
  if (!d.questions.length) return "Добавьте хотя бы один вопрос.";
  for (let i = 0; i < d.questions.length; i++){
    const q = d.questions[i];
    if (!q.text.trim()) return `Заполните текст вопроса ${i+1}.`;
    const opts = q.options.map(o => o.trim()).filter(Boolean);
    if (opts.length < 2) return `В вопросе ${i+1} нужно минимум два непустых варианта.`;
    if (new Set(opts.map(o => o.toLowerCase())).size !== opts.length) return `В вопросе ${i+1} есть одинаковые варианты.`;
  }
  return null;
}

async function savePoll(status){
  const d = S.draft;
  const err = validate(d);
  if (err){ S.msg = {type:"err", text:err}; return render(); }
  S.busy = true; render();
  try {
    const id = await rpc("save_poll", {
      p_key:S.key, p_id:d.id, p_title:d.title.trim(), p_description:d.description.trim(), p_status:status,
      p_questions:d.questions.map(q => ({id:q.id, text:q.text.trim(), options:q.options.map(o => o.trim()).filter(Boolean)}))
    });
    S.busy = false; S.draft = null;
    await loadPolls();
    if (status === "published"){ S.msg = null; await openPoll(id); S.msg = {type:"ok", text:"Опрос опубликован. Отправьте ссылку участникам или покажите QR-код."}; render(); }
    else { S.view = "list"; S.msg = {type:"ok", text:"Черновик сохранён."}; render(); scrollTo(0,0); }
  } catch (e) {
    S.busy = false;
    S.msg = {type:"err", text: /locked/.test(e.message) ? "Опрос уже опубликован, его вопросы менять нельзя." : "Не удалось сохранить опрос. Проверьте интернет и попробуйте снова."};
    render();
  }
}

function renderPoll(){
  const p = S.polls.find(x => x.id === S.pollId);
  if (!p){ S.view = "list"; return renderList(); }
  const link = pollLink(p.id);
  const r = S.results[p.id];
  const total = r ? r.total : +p.responses || 0;
  const share = p.status === "draft" ? `
      <div class="card stack"><h2>Черновик</h2><p class="muted">Опубликуйте опрос, чтобы получить ссылку и QR-код для участников.</p>
        <div class="row"><button type="button" id="edit">Редактировать</button><button type="button" class="primary" id="pub">Опубликовать</button></div></div>` : `
      <div class="card stack">
        <div class="row between"><h2>Ссылка для участников</h2>${statusPill(p)}</div>
        <div class="linkbox"><input type="text" id="linkField" readonly value="${esc(link)}" aria-label="Ссылка на опрос"><button type="button" id="copy">Копировать</button></div>
        <div class="qr-wrap"><canvas id="qr" width="1200" height="1200" aria-label="QR-код со ссылкой на опрос"></canvas>
          <button type="button" class="primary" id="full">Показать QR на весь экран</button></div>
        <div class="row">
          ${p.status === "published" ? `<button type="button" id="close">Закрыть приём ответов</button>` : `<button type="button" id="reopen">Возобновить приём</button>`}
        </div>
      </div>`;
  const results = p.status === "draft" ? "" : `
      <div class="card stack">
        <div class="row between" style="align-items:flex-end">
          <div class="stack" style="gap:4px"><span class="eyebrow">Результаты · видите только вы</span><h2>Собрано анкет</h2></div>
          <div class="big-num" id="total">${total}</div>
        </div>
        ${total === 0 ? `<p class="muted">Ответов пока нет. Они появятся здесь через несколько секунд после отправки, с любого устройства.</p>` : ""}
      </div>
      ${p.questions.map((q, i) => {
        const counts = (r && r.counts && r.counts[q.id]) || q.options.map(() => 0);
        const answered = counts.reduce((a, b) => a + b, 0);
        return `
        <div class="card res-q">
          <span class="q-num">Вопрос ${i+1}</span>
          <h3>${esc(q.text)}</h3>
          <p class="muted small">Ответили: <span class="count">${answered}</span> из ${total}</p>
          ${q.options.map((o, oi) => resultRow(o, counts[oi] || 0, answered)).join("")}
        </div>`; }).join("")}`;
  $app.innerHTML = `
    <div class="stack">
      <button type="button" class="ghost" id="back" style="align-self:flex-start">← К опросам</button>
      <div class="stack" style="gap:6px"><h1>${esc(p.title)}</h1>${p.description ? `<p class="muted">${esc(p.description)}</p>` : ""}
        ${p.published_at ? `<p class="muted small">Опубликован ${esc(fmtDate(p.published_at))}</p>` : ""}</div>
      ${S.msg ? `<div class="notice ${S.msg.type||""}">${esc(S.msg.text)}</div>` : ""}
      ${share}
      ${results}
      <div class="stack" style="gap:8px">
        ${S.confirmDelete ? `<div class="confirm"><span class="small">Удалить опрос вместе со всеми ответами?</span>
            <button type="button" class="danger solid" id="delYes">Удалить</button><button type="button" id="delNo">Отмена</button></div>`
          : `<button type="button" class="ghost danger" id="del" style="align-self:flex-start">Удалить опрос</button>`}
      </div>
    </div>`;
  on("#back", toList);
  on("#edit", () => openEditor(JSON.parse(JSON.stringify({id:p.id, title:p.title, description:p.description, questions:p.questions.map(q => ({...q, auto:false}))}))));
  on("#pub", () => setStatus(p, "published"));
  on("#close", () => setStatus(p, "closed"));
  on("#reopen", () => setStatus(p, "published"));
  on("#del", () => { S.confirmDelete = true; render(); });
  on("#delNo", () => { S.confirmDelete = false; render(); });
  on("#delYes", async () => {
    try { await rpc("delete_poll", {p_key:S.key, p_id:p.id}); S.confirmDelete = false; S.msg = {type:"ok", text:"Опрос удалён."}; toList(); }
    catch { S.msg = {type:"err", text:"Не удалось удалить опрос. Попробуйте снова."}; render(); }
  });
  on("#copy", () => copyText(link, "linkField", "copy"));
  on("#full", () => openOverlay(p, link));
  const cv = document.getElementById("qr");
  if (cv) drawQR(cv, link);
}

function resultRow(label, n, answered){
  const w = answered ? Math.round(n / answered * 100) : 0;
  return `<div class="res-opt"><div class="lbl"><span>${esc(label)}</span><span>${n} ${plural(n,"ответ","ответа","ответов")} · ${w}%</span></div>
    <div class="track"><div class="fill" style="width:${w}%"></div></div></div>`;
}

async function setStatus(p, status){
  try {
    if (p.status === "draft" && status === "published"){
      await rpc("save_poll", {p_key:S.key, p_id:p.id, p_title:p.title, p_description:p.description, p_questions:p.questions, p_status:"published"});
    } else {
      await rpc("set_poll_status", {p_key:S.key, p_id:p.id, p_status:status});
    }
    await loadPolls();
    S.msg = {type:"ok", text: status === "closed" ? "Приём ответов закрыт." : "Опрос опубликован. Отправьте ссылку участникам или покажите QR-код."};
  } catch { S.msg = {type:"err", text:"Не удалось изменить статус. Попробуйте снова."}; }
  render();
}

async function copyText(text, fieldId, btnId){
  const btn = document.getElementById(btnId);
  try { await navigator.clipboard.writeText(text); btn.textContent = "Скопировано"; }
  catch { document.getElementById(fieldId).select(); btn.textContent = "Выделено, нажмите Ctrl+C"; }
}

// ---------- QR с логотипом ----------
function drawQR(canvas, text){
  if (typeof qrcode !== "function" || !text) return;
  const qr = qrcode(0, "H"); qr.addData(text, "Byte"); qr.make();
  const n = qr.getModuleCount(), quiet = 4, size = canvas.width;
  const cell = Math.floor(size / (n + quiet * 2)), off = Math.floor((size - cell * n) / 2);
  const c = canvas.getContext("2d");
  c.fillStyle = "#FFFFFF"; c.fillRect(0, 0, size, size);
  c.fillStyle = "#1B1B3A";
  for (let r = 0; r < n; r++) for (let k = 0; k < n; k++) if (qr.isDark(r, k)) c.fillRect(off + k * cell, off + r * cell, cell, cell);
  // Логотип в центре закрывает меньше 10% площади; коррекция H выдерживает до 30%.
  const lw = Math.round(cell * n * 0.36), lh = Math.round(cell * n * 0.13);
  const lx = Math.round((size - lw) / 2), ly = Math.round((size - lh) / 2), rad = lh * 0.22;
  c.fillStyle = "#FFFFFF"; roundRect(c, lx - cell, ly - cell, lw + cell * 2, lh + cell * 2, rad + cell); c.fill();
  c.fillStyle = "#1B1B3A"; roundRect(c, lx, ly, lw, lh, rad); c.fill();
  const fs = Math.round(lh * 0.5);
  c.font = `700 ${fs}px Unbounded, Manrope, system-ui, sans-serif`; c.textBaseline = "middle";
  const a = "BCC ", b = "Life", wa = c.measureText(a).width, wb = c.measureText(b).width;
  const x = size / 2 - (wa + wb) / 2, y = ly + lh / 2 + fs * 0.04;
  c.fillStyle = "#FFFFFF"; c.fillText(a, x, y); c.fillStyle = "#3FD3E4"; c.fillText(b, x + wa, y);
}
function roundRect(c, x, y, w, h, r){ c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r); c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath(); }
function openOverlay(p, link){
  document.getElementById("ovTitle").textContent = p.title;
  drawQR(document.getElementById("ovCanvas"), link);
  document.getElementById("overlay").hidden = false;
  document.documentElement.requestFullscreen?.().catch(() => {});
}
function closeOverlay(){ document.getElementById("overlay").hidden = true; if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {}); }
document.getElementById("ovClose").onclick = closeOverlay;
document.addEventListener("keydown", e => { if (e.key === "Escape") closeOverlay(); });

// ---------- форма участника ----------
async function loadPublicPoll(id){
  S.pub = null; S.pubState = "loading"; S.form = {}; S.formState = "idle"; S.formMsg = "";
  S.already = ls.get("oprosy.sent." + id) === "1";
  render();
  try { const rows = await rpc("get_poll", {p_id:id}); S.pub = rows && rows[0] || null; S.pubState = S.pub ? "ok" : "missing"; }
  catch { S.pubState = "error"; }
  render();
}

function renderForm(id){
  const p = S.pub;
  if (S.pubState === "loading"){ $app.innerHTML = `<p class="muted">Загрузка опроса…</p>`; return; }
  if (S.pubState === "error"){ $app.innerHTML = `<div class="card stack"><h2>Нет связи</h2><p class="muted">Не удалось загрузить опрос. Проверьте интернет и обновите страницу.</p></div>`; return; }
  if (!p || p.id !== id){ $app.innerHTML = `<div class="card stack"><h2>Опрос не найден</h2><p class="muted">Проверьте ссылку или попросите автора прислать её ещё раз.</p></div>`; return; }
  if (S.formState === "sent" || S.already){
    $app.innerHTML = `<div class="card stack center"><h1>Спасибо!</h1><p class="muted">${S.formState === "sent" ? "Ваша анкета отправлена." : "Вы уже отправили анкету в этом опросе."}</p></div>`; return;
  }
  if (p.status === "closed"){ $app.innerHTML = `<div class="card stack"><h2>${esc(p.title)}</h2><p class="muted">Приём ответов закрыт.</p></div>`; return; }
  $app.innerHTML = `
    <form class="stack" id="pform" novalidate>
      <div class="stack" style="gap:6px"><h1>${esc(p.title)}</h1>${p.description ? `<p class="muted">${esc(p.description)}</p>` : ""}</div>
      ${p.questions.map((q, qi) => `
        <fieldset class="card form-q" style="margin:0">
          <legend class="q-num" style="padding:0">Вопрос ${qi+1} из ${p.questions.length}</legend>
          <h3>${esc(q.text)}</h3>
          ${q.options.map((o, oi) => `<label class="opt"><input type="radio" name="q_${esc(q.id)}" id="r-${esc(q.id)}-${oi}" value="${oi}" ${S.form[q.id] === oi ? "checked" : ""}><span>${esc(o)}</span></label>`).join("")}
        </fieldset>`).join("")}
      ${S.formMsg ? `<div class="notice err">${esc(S.formMsg)}</div>` : ""}
      <button type="submit" class="primary" ${S.formState === "sending" ? "disabled" : ""}>${S.formState === "sending" ? `<span class="spin"></span> Отправка…` : "Отправить анкету"}</button>
      <p class="muted small center">Анкета анонимна: имя и контакты не запрашиваются. Результаты видит только автор опроса.</p>
    </form>`;
  const f = document.getElementById("pform");
  f.addEventListener("change", e => { if (e.target.type === "radio") S.form[e.target.name.slice(2)] = +e.target.value; });
  f.addEventListener("submit", e => { e.preventDefault(); submitForm(p); });
}

async function submitForm(p){
  const missing = p.questions.findIndex(q => !Number.isInteger(S.form[q.id]));
  if (missing >= 0){ S.formMsg = `Ответьте на вопрос ${missing + 1}.`; return render(); }
  S.formState = "sending"; S.formMsg = ""; render();
  const answers = {}; p.questions.forEach(q => answers[q.id] = S.form[q.id]);
  try {
    const res = await rpc("submit_response", {p_poll_id:p.id, p_client_id:S.clientId, p_answers:answers});
    if (res === "ok" || res === "already"){ ls.set("oprosy.sent." + p.id, "1"); S.already = res === "already"; S.formState = res === "ok" ? "sent" : "idle"; }
    else if (res === "closed"){ S.pub = {...p, status:"closed"}; S.formState = "idle"; }
    else { S.formState = "idle"; S.formMsg = "Опрос изменился. Обновите страницу и ответьте заново."; }
  } catch { S.formState = "idle"; S.formMsg = "Не удалось отправить анкету. Проверьте интернет и попробуйте снова."; }
  render(); scrollTo(0,0);
}

// ---------- запуск ----------
function route(){
  const m = location.hash.match(/^#a-([a-z0-9]{24,64})$/i);
  if (m){ // импорт ключа автора на другом устройстве
    ls.set("oprosy.authorKey", m[1]); S.key = m[1];
    history.replaceState(null, "", location.pathname + location.search);
    S.view = "list"; S.loaded = false; S.msg = {type:"ok", text:"Ключ автора сохранён в этом браузере."};
    render(); loadPolls().then(render); return;
  }
  const hp = hashPoll();
  if (hp){ stopResultsPolling(); loadPublicPoll(hp); return; }
  render();
  if (!S.loaded) loadPolls().then(render);
}

S.key = ls.get("oprosy.authorKey") || (() => { const k = randomToken(32); ls.set("oprosy.authorKey", k); return k; })();
S.clientId = ls.get("oprosy.clientId") || (() => { const k = randomToken(24); ls.set("oprosy.clientId", k); return k; })();
window.addEventListener("hashchange", route);
document.fonts?.ready.then(() => { if (S.view === "poll" && !hashPoll()) render(); });
route();
