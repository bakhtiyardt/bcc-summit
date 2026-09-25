// Калькулятор лизинга BCC Leasing: чат и форма → параметры → расчёт по формуле → график.
(function () {
  "use strict";
  const CFG = window.LEASE_CONFIG;
  const { annuity, parseDeal } = window.LeaseCalc;
  const COST_MIN = 1e6, COST_MAX = 300e6;

  const S = {
    cost: null, down: null, months: null,   // down: {type: "pct" | "amt", value}
    pending: null, msgs: [], busy: false,
    // Режим: калькулятор или помощник. У каждого свои параметры; расчёт идёт от активного.
    mode: "calc",
    saved: {chat: {cost: null, down: null, months: null, pending: null}},
    ai: CFG.aiUrl ? "unknown" : "off",
    result: null, explain: null,
    lead: null, leadBin: "", leadName: "", leadEmail: "", leadPhone: "", leadConsent: false, leadErr: null   // lead: null | "form" | "sending" | {name, phone, email}
  };
  const $ = id => document.getElementById(id);
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const plain = n => Math.round(n).toLocaleString("ru-RU");
  const money = n => plain(n) + " ₸";
  const pctStr = n => (Math.round(n * 100) / 100).toLocaleString("ru-RU") + "%";
  const plural = (n, one, few, many) => { const a = n % 10, b = n % 100; return a === 1 && b !== 11 ? one : a >= 2 && a <= 4 && (b < 10 || b >= 20) ? few : many; };
  const monthsStr = n => `${n} ${plural(n, "месяц", "месяца", "месяцев")}`;
  const digits = s => { const v = parseFloat(String(s).replace(/[^\d.,]/g, "").replace(",", ".")); return isFinite(v) ? v : null; };

  const EXAMPLES = [
    "Оборудование за 10 млн тенге, аванс 20%, на 24 месяца",
    "Спецтехника 45 000 000, первоначальный взнос 9 млн, срок 3 года",
    "Автомобиль 18,5 млн на 5 лет, аванс 15%",
    "Экскаватор за 25 млн",
  ];
  const QUESTIONS = {
    cost: "Какова стоимость предмета лизинга? Например: 10 млн тенге.",
    down: CFG.minDownPct > 0
      ? `Какой аванс вы готовы внести? Можно процентом (20%) или суммой (2 млн). Минимум ${CFG.minDownPct}% от стоимости.`
      : "Какой аванс вы готовы внести? Можно процентом (20%), суммой (2 млн) или «без аванса».",
    months: `На какой срок нужен лизинг? От ${CFG.minTermMonths} до ${CFG.maxTermMonths} месяцев.`,
  };

  // ---------- ИИ (Supabase Edge Function) ----------
  async function ai(action, payload) {
    if (S.ai === "off") return null;
    const ctrl = new AbortController(), timer = setTimeout(() => ctrl.abort(), 9000);
    try {
      const res = await fetch(CFG.aiUrl, {
        method: "POST", signal: ctrl.signal,
        headers: {"Content-Type": "application/json", apikey: CFG.supabaseKey},
        body: JSON.stringify({action, ...payload})
      });
      if (!res.ok) throw new Error("http_" + res.status);
      const data = await res.json();
      setAi("on");
      return data;
    } catch {
      setAi("off");
      return null;
    } finally { clearTimeout(timer); }
  }
  function setAi(state){
    S.ai = state;
    const el = $("aiStatus");
    el.className = "pill " + (state === "on" ? "ai" : "rules");
    el.innerHTML = `<span class="dot"></span>${state === "on" ? "ИИ подключён" : state === "off" ? "Режим правил" : "ИИ + правила"}`;
    el.title = state === "off" ? "ИИ недоступен: параметры распознаются правилами" : "";
  }

  // ---------- состояние ----------
  function downAmount(){ return S.down == null || S.cost == null ? null : S.down.type === "pct" ? S.cost * S.down.value / 100 : S.down.value; }
  function downPct(){ const d = downAmount(); return d == null ? null : d / S.cost * 100; }
  const complete = () => S.cost != null && S.down != null && S.months != null;
  function describeParams(){
    const parts = [];
    if (S.cost != null) parts.push(`стоимость ${money(S.cost)}`);
    if (S.down != null) parts.push(S.down.value === 0 ? "без аванса" : S.down.type === "pct" ? `аванс ${pctStr(S.down.value)}` : `аванс ${money(S.down.value)}`);
    if (S.months != null) parts.push(`срок ${monthsStr(S.months)}`);
    return parts.join(", ");
  }

  // Правила блока E: ошибка ввода → сообщение и повторный вопрос по этому полю.
  function validate(){
    if (S.cost != null && !(S.cost > 0)) return {field: "cost", text: "Стоимость должна быть больше нуля."};
    if (S.months != null && S.months <= 0) return {field: "months", text: "Срок не может быть нулевым."};
    if (S.months != null && (S.months < CFG.minTermMonths || S.months > CFG.maxTermMonths))
      return {field: "months", text: `Срок ${monthsStr(S.months)} вне диапазона: доступно от ${CFG.minTermMonths} до ${CFG.maxTermMonths} месяцев.`};
    if (S.down != null && S.down.value < 0) return {field: "down", text: "Аванс не может быть отрицательным."};
    if (S.down != null && S.down.type === "pct" && S.down.value >= 100) return {field: "down", text: "Аванс не может быть 100% стоимости и больше."};
    const d = downAmount();
    if (d != null && d >= S.cost) return {field: "down", text: `Аванс ${money(d)} не может быть больше или равен стоимости ${money(S.cost)}.`};
    if (d != null && d < S.cost * CFG.minDownPct / 100 - 0.5)
      return {field: "down", text: `Минимальный аванс — ${CFG.minDownPct}% стоимости, то есть от ${money(S.cost * CFG.minDownPct / 100)}.`};
    return null;
  }
  function apply(p){
    if (p.cost != null) S.cost = p.cost;
    if (p.downPct != null) S.down = {type: "pct", value: p.downPct};
    else if (p.downAmt != null) S.down = {type: "amt", value: p.downAmt};
    if (p.months != null) S.months = p.months;
  }
  function fromAi(x){
    if (!x) return null;
    const n = v => typeof v === "number" && isFinite(v) ? v : null;
    return {cost: n(x.cost_tenge), downPct: n(x.down_payment_percent), downAmt: n(x.down_payment_tenge), months: n(x.term_months) != null ? Math.round(x.term_months) : null};
  }
  const has = p => !!p && (p.cost != null || p.downPct != null || p.downAmt != null || p.months != null);

  // ---------- чат ----------
  function say(role, text, extra){ S.msgs.push({role, text, ...extra}); renderMsgs(); }
  function renderMsgs(){
    const box = $("msgs");
    box.innerHTML = S.msgs.map(m => `<div class="msg ${m.role}${m.bad ? " bad" : ""}">${esc(m.text)}${m.src ? `<span class="src">${esc(m.src)}</span>` : ""}</div>`).join("")
      + (S.busy ? `<div class="msg bot"><span class="typing" aria-label="Помощник печатает"><i></i><i></i><i></i></span></div>` : "");
    box.scrollTop = box.scrollHeight;
  }
  function renderChips(){
    $("chips").innerHTML = (S.msgs.length > 1 ? `<button type="button" class="chip" id="reset">↺ Начать заново</button>` : "")
      + EXAMPLES.map((e, k) => `<button type="button" class="chip" data-ex="${k}">${esc(e)}</button>`).join("");
    $("chips").querySelectorAll("[data-ex]").forEach(b => b.onclick = () => handle(EXAMPLES[+b.dataset.ex]));
    const r = $("reset"); if (r) r.onclick = reset;
  }
  function renderCtx(){
    const items = [];
    if (S.cost != null) items.push(money(S.cost));
    if (S.down != null) items.push(S.down.value === 0 ? "без аванса" : "аванс " + (S.down.type === "pct" ? pctStr(S.down.value) : money(S.down.value)));
    if (S.months != null) items.push(monthsStr(S.months));
    $("ctx").innerHTML = items.map(i => `<span>${esc(i)}</span>`).join("");
    $("ctx").hidden = !items.length;
  }

  async function handle(text){
    text = text.trim();
    if (!text || S.busy) return;
    say("me", text);
    S.busy = true; renderMsgs(); $("send").disabled = true;

    // Гибрид: правила разбирают мгновенно; если после них чего-то не хватает, подключаем ИИ.
    const rules = parseDeal(text, S.pending);
    const before = {cost: S.cost, down: S.down, months: S.months};
    apply(rules);
    let source = has(rules) ? "распознано правилами" : "";
    if (!complete() || !has(rules)) {
      Object.assign(S, before);
      const r = await ai("extract", {text, pending: S.pending});
      const p = fromAi(r && r.params);
      apply(rules);
      if (has(p)) { apply(p); source = "распознано ИИ"; }
    }
    S.busy = false; $("send").disabled = false;

    if (!source) {
      say("bot", S.pending ? `Не понял ответ. ${QUESTIONS[S.pending]}` : "Не удалось распознать параметры. Напишите стоимость, аванс и срок, например: «оборудование за 10 млн, аванс 20%, на 24 месяца».");
    } else {
      if (rules.guessedMillions && source === "распознано правилами") source += " · сумма понята в миллионах";
      step(source);
    }
    renderChips();
  }

  function step(source){
    const err = validate();
    if (err) {
      S[err.field] = null; S.pending = err.field; S.result = null;
      say("bot", `${err.text}\n${QUESTIONS[err.field]}`, {bad: true});
      renderAll(); return;
    }
    const missing = ["cost", "down", "months"].find(f => S[f] == null);
    if (missing) {
      S.pending = missing;
      const got = describeParams();
      say("bot", (got ? `Понял: ${got}.\n` : "") + QUESTIONS[missing], {src: source});
      S.result = null; renderAll(); return;
    }
    S.pending = null;
    calculate();
    renderParams();
    const r = S.result;
    say("bot", `Понял: ${describeParams()}.\nЕжемесячный платёж — ${money(r.payment)}, переплата — ${money(r.overpayment)}. График и пояснение ниже.`, {src: source});
  }

  // ---------- расчёт ----------
  let explainTimer = null;
  function calculate(){
    const d = downAmount();
    S.result = {cost: S.cost, down: d, downPct: d / S.cost * 100, months: S.months, rate: CFG.annualRatePct, ...annuity(S.cost, d, S.months, CFG.annualRatePct)};
    if (S.lead !== "sending") { S.lead = null; S.leadErr = null; }
    S.explain = {text: templateExplain(S.result), src: "шаблон"};
    renderResult(); renderCtx(); writeHash();
    // Пояснение от ИИ запрашиваем после паузы, чтобы не дёргать модель при движении ползунка.
    clearTimeout(explainTimer);
    const r = S.result;
    explainTimer = setTimeout(() => {
      ai("explain", {data: {cost: plain(r.cost), down: plain(r.down), downPct: Math.round(r.downPct * 100) / 100, financed: plain(r.financed),
        months: r.months, rate: r.rate, payment: plain(r.payment), total: plain(r.total), overpayment: plain(r.overpayment)}})
        .then(x => {
          if (!(x && x.text && S.result === r)) return;
          S.explain = {text: x.text, src: "ИИ"};
          // Обновляем только абзац пояснения, чтобы не сбивать ввод в форме заявки.
          const t = $("explainText"), src = $("explainSrc");
          if (t && src) { t.textContent = x.text; src.textContent = "Пояснение: ИИ"; } else renderResult();
        });
    }, 700);
  }
  function templateExplain(r){
    return `Вы вносите аванс ${money(r.down)} (${pctStr(r.downPct)} стоимости), остальные ${money(r.financed)} финансирует лизинговая компания. ` +
      `Дальше в течение ${r.months} ${plural(r.months, "месяца", "месяцев", "месяцев")} вы платите одинаковую сумму — ${money(r.payment)} в месяц, всего ${money(r.total)}. ` +
      `Переплата ${money(r.overpayment)} — это удорожание за пользование финансированием по ставке ${r.rate}% годовых.`;
  }

  // ---------- карточка параметров ----------
  function renderParams(){
    const d = downAmount(), p = downPct();
    const pctSlider = p == null ? 20 : Math.min(90, Math.max(CFG.minDownPct, Math.round(p)));
    $("params").innerHTML = `
      <div class="row between"><h2>Параметры лизинга</h2><span class="muted small">из чата или вручную</span></div>
      <div>
        <div class="field"><div class="col"><label for="pCost">Стоимость предмета лизинга</label>
          <input type="text" id="pCost" inputmode="numeric" placeholder="Например, 15 000 000" value="${S.cost != null ? plain(S.cost) : ""}"></div><span class="suffix">₸</span></div>
        <div class="range"><input type="range" id="rCost" min="${COST_MIN}" max="${COST_MAX}" step="500000" value="${S.cost != null ? Math.min(COST_MAX, Math.max(COST_MIN, S.cost)) : 15e6}" aria-label="Стоимость, ползунок">
          <div class="ends"><span>1 млн ₸</span><span>300 млн ₸</span></div></div>
      </div>
      <div>
        <div class="pair">
          <div class="field"><div class="col"><label for="pDown">Первоначальный взнос</label>
            <input type="text" id="pDown" inputmode="numeric" placeholder="${S.cost != null && CFG.minDownPct > 0 ? plain(S.cost * CFG.minDownPct / 100) + " и больше" : "Сумма, можно 0"}" value="${d != null ? plain(d) : ""}"></div><span class="suffix">₸</span></div>
          <div class="field"><div class="col"><label for="pPct">Аванс</label>
            <input type="text" id="pPct" inputmode="decimal" placeholder="от ${CFG.minDownPct}" value="${p != null ? Math.round(p * 100) / 100 : ""}"></div><span class="suffix">%</span></div>
        </div>
        <div class="range"><input type="range" id="rPct" min="${CFG.minDownPct}" max="90" step="1" value="${pctSlider}" aria-label="Аванс в процентах, ползунок" ${S.cost == null ? "disabled" : ""}>
          <div class="ends"><span>${CFG.minDownPct}%</span><span>90%</span></div></div>
      </div>
      <div>
        <div class="field"><div class="col"><label for="pMonths">Срок лизинга</label>
          <input type="text" id="pMonths" inputmode="numeric" placeholder="${CFG.minTermMonths}–${CFG.maxTermMonths}" value="${S.months ?? ""}"></div><span class="suffix">мес.</span></div>
        <div class="range"><input type="range" id="rMonths" min="${CFG.minTermMonths}" max="${CFG.maxTermMonths}" step="1" value="${S.months ?? 24}" aria-label="Срок, ползунок">
          <div class="ends"><span>${CFG.minTermMonths} мес.</span><span>${CFG.maxTermMonths} мес.</span></div></div>
      </div>
      <div class="err" id="pErr" hidden></div>
      <p class="muted small">Ставка удорожания — ${CFG.annualRatePct}% годовых. Ползунки меняют расчёт сразу.</p>`;

    const recalcFromForm = () => {
      const err = validate(), box = $("pErr");
      box.hidden = !err; box.textContent = err ? err.text : "";
      if (err) { S.result = null; renderResult(); renderCtx(); return; }
      if (complete()) calculate(); else { S.result = null; renderResult(); renderCtx(); }
    };
    const syncDown = () => { const d2 = downAmount(), p2 = downPct();
      if (d2 != null) { $("pDown").value = plain(d2); $("pPct").value = Math.round(p2 * 100) / 100; $("rPct").value = Math.min(90, Math.max(CFG.minDownPct, Math.round(p2))); } };

    $("pCost").addEventListener("change", e => { S.cost = digits(e.target.value); if (S.cost) $("rCost").value = S.cost; $("rPct").disabled = S.cost == null; e.target.value = S.cost != null ? plain(S.cost) : ""; syncDown(); recalcFromForm(); });
    $("rCost").addEventListener("input", e => { S.cost = +e.target.value; $("pCost").value = plain(S.cost); $("rPct").disabled = false; syncDown(); recalcFromForm(); });
    $("pDown").addEventListener("change", e => { const v = digits(e.target.value); S.down = v == null ? null : {type: "amt", value: v}; syncDown(); recalcFromForm(); });
    $("pPct").addEventListener("change", e => { const v = digits(e.target.value); S.down = v == null ? null : {type: "pct", value: v}; syncDown(); recalcFromForm(); });
    $("rPct").addEventListener("input", e => { S.down = {type: "pct", value: +e.target.value}; syncDown(); recalcFromForm(); });
    $("pMonths").addEventListener("change", e => { const v = digits(e.target.value); S.months = v == null ? null : Math.round(v); if (S.months) $("rMonths").value = S.months; recalcFromForm(); });
    $("rMonths").addEventListener("input", e => { S.months = +e.target.value; $("pMonths").value = S.months; recalcFromForm(); });
  }

  // ---------- результат ----------
  function renderResult(){
    const box = $("result"), r = S.result;
    $("heroPay").textContent = r ? money(r.payment) : "—";
    if (!r) {
      box.innerHTML = `<div class="card empty stack" style="gap:6px"><h2>Здесь появится расчёт</h2>
        <p class="muted">${S.mode === "chat" ? "Опишите сделку помощнику: стоимость, аванс и срок. Как только параметров хватит, здесь появятся платёж и график." : "Заполните стоимость, аванс и срок — платёж и график появятся сразу."}</p></div>`;
      return;
    }
    box.innerHTML = `
      <div class="card pad stack">
        <div class="row between"><h2>Предварительный расчёт</h2><span class="muted small">${esc(describeParams())}</span></div>
        <div class="kpis">
          <div class="kpi main"><div class="lbl">Ежемесячный платёж</div><div class="val">${money(r.payment)}</div></div>
          <div class="kpi"><div class="lbl">Переплата</div><div class="val">${money(r.overpayment)}</div></div>
          <div class="kpi"><div class="lbl">Сумма финансирования</div><div class="val">${money(r.financed)}</div></div>
        </div>
        <div class="explain stack" style="gap:4px"><p id="explainText">${esc(S.explain.text)}</p><span class="muted small" id="explainSrc">Пояснение: ${esc(S.explain.src)}</span></div>
        <div class="disclaimer">Предварительный расчёт, не является офертой. Ставка удорожания — ${r.rate}% годовых.</div>
        <div class="row">
          <button type="button" class="primary" id="leadBtn">Оставить заявку менеджеру для точного расчёта</button>
          <button type="button" id="pdfBtn">Скачать PDF</button>
          <button type="button" id="copyBtn">Скопировать расчёт</button>
          <button type="button" class="ghost" id="linkBtn">Ссылка на расчёт</button>
        </div>
        ${leadMarkup(r)}
      </div>
      <div class="card pad stack">
        <div class="row between"><h2>График платежей</h2><span class="muted small">${monthsStr(r.months)} · суммы в тенге</span></div>
        <div class="table-wrap"><table>
          <thead><tr><th>Месяц</th><th>Платёж</th><th>Погашение стоимости</th><th>Удорожание</th><th>Остаток</th></tr></thead>
          <tbody>${r.schedule.map(x => `<tr><td>${x.month}</td><td>${plain(x.payment)}</td><td>${plain(x.principal)}</td><td>${plain(x.interest)}</td><td>${plain(x.rest)}</td></tr>`).join("")}</tbody>
          <tfoot><tr><td>Итого</td><td>${plain(r.total)}</td><td>${plain(r.financed)}</td><td>${plain(r.overpayment)}</td><td></td></tr></tfoot>
        </table></div>
      </div>`;
    $("leadBtn").onclick = () => { if (!S.lead) { S.lead = "form"; renderResult(); } const f = $("leadName"); if (f) f.focus(); };
    bindLead(r);
    $("copyBtn").onclick = () => copy(summaryText(), "copyBtn");
    $("pdfBtn").onclick = async () => {
      const b = $("pdfBtn"); b.disabled = true; b.textContent = "Готовлю PDF…";
      try { await window.LeasePdf.download(r, {explain: S.explain.text, url: location.href}); b.textContent = "PDF скачан"; }
      catch { b.textContent = "Не удалось создать PDF"; }
      setTimeout(() => { if (document.body.contains(b)) { b.disabled = false; b.textContent = "Скачать PDF"; } }, 2000);
    };
    $("linkBtn").onclick = () => copy(location.href, "linkBtn");
  }
  // ---------- заявка менеджеру ----------
  const phoneDigits = s => { let d = String(s).replace(/\D/g, ""); if (d.length === 11 && d[0] === "8") d = "7" + d.slice(1); if (d.length === 10) d = "7" + d; return d; };
  const phonePretty = d => d.length === 11 ? `+${d[0]} ${d.slice(1, 4)} ${d.slice(4, 7)} ${d.slice(7, 9)} ${d.slice(9)}` : d;
  // Маска ввода: «+7» ставится сам, дальше группы 3-3-2-2. 8 в начале заменяется на 7.
  function phoneMask(raw){
    let d = String(raw).replace(/\D/g, "");
    if (!d) return "";
    if (d[0] === "8") d = "7" + d.slice(1);
    if (d[0] !== "7") d = "7" + d;
    d = d.slice(0, 11);
    return "+7" + (d.length > 1 ? " " + d.slice(1, 4) : "") + (d.length > 4 ? " " + d.slice(4, 7) : "")
      + (d.length > 7 ? " " + d.slice(7, 9) : "") + (d.length > 9 ? " " + d.slice(9, 11) : "");
  }

  const emailOk = s => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s);
  // ИИН/БИН Казахстана: 12 цифр, последняя — контрольная (два прохода весов по модулю 11).
  function kzIdOk(id){
    if (!/^\d{12}$/.test(id)) return false;
    const d = [...id].map(Number);
    let c = d.slice(0, 11).reduce((s, x, i) => s + x * (i + 1), 0) % 11;
    if (c === 10) c = d.slice(0, 11).reduce((s, x, i) => s + x * ((i + 2) % 11 + 1), 0) % 11;
    return c !== 10 && c === d[11];
  }
  // Тип клиента по номеру: у БИН 5-я цифра 4–6 (юрлицо), у ИИН — 0–3 (месяц рождения).
  const clientTypeOf = id => /^\d{4}[4-6]/.test(id) ? "ТОО" : "ИП";
  const idLabelOf = id => clientTypeOf(id) === "ТОО" ? "БИН" : "ИИН";
  const idLabel = () => "ИИН / БИН";

  function leadMarkup(r){
    if (!S.lead) return "";
    if (typeof S.lead === "object") return `
      <div class="lead-box stack" style="gap:8px" id="leadDone">
        <h3>Спасибо, ${esc(S.lead.name)}! Заявка отправлена</h3>
        <p>Ваш расчёт: ${esc(describeParams())}. Ежемесячный платёж — <b>${money(r.payment)}</b>, переплата — ${money(r.overpayment)}.</p>
        <p>Заявку получил менеджер BCC Leasing. В ближайшее время он свяжется с вами по телефону <b>${esc(S.lead.phone)}</b> или по почте <b>${esc(S.lead.email)}</b>, уточнит условия и подготовит точный расчёт.</p>
        <div class="row"><button type="button" id="leadPdf">Скачать PDF расчёта</button></div>
      </div>`;
    const sending = S.lead === "sending";
    return `
      <form class="lead-box stack" id="leadForm" novalidate style="gap:10px">
        <h3>Заявка менеджеру</h3>
        <p class="muted small">Менеджер получит расчёт с графиком платежей и свяжется с вами.</p>
        <div class="field"><div class="col"><label for="leadBin">ИИН / БИН</label>
          <input type="text" id="leadBin" inputmode="numeric" autocomplete="off" maxlength="24" placeholder="12 цифр" value="${esc(S.leadBin)}"></div></div>
        <div class="field"><div class="col"><label for="leadName">Имя</label>
          <input type="text" id="leadName" autocomplete="name" maxlength="80" placeholder="Как к вам обращаться" value="${esc(S.leadName)}"></div></div>
        <div class="pair" style="grid-template-columns:repeat(auto-fit,minmax(200px,1fr))">
          <div class="field"><div class="col"><label for="leadEmail">E-mail</label>
            <input type="email" id="leadEmail" autocomplete="email" inputmode="email" maxlength="120" placeholder="name@company.kz" value="${esc(S.leadEmail)}"></div></div>
          <div class="field"><div class="col"><label for="leadPhone">Телефон</label>
            <input type="tel" id="leadPhone" autocomplete="tel" inputmode="tel" maxlength="20" placeholder="+7 7XX XXX XX XX" value="${esc(S.leadPhone)}"></div></div>
        </div>
        <label class="consent"><input type="checkbox" id="leadConsent" ${S.leadConsent ? "checked" : ""}>
          <span>Я даю <a class="linklike" id="consentOpen" href="consent.html">согласие на сбор и обработку персональных данных</a></span></label>
        ${S.leadErr ? `<div class="err">${esc(S.leadErr)}</div>` : ""}
        <button type="submit" class="primary" ${sending ? "disabled" : ""}>${sending ? "Отправляю заявку…" : "Отправить заявку"}</button>
      </form>`;
  }

  function bindLead(r){
    const pdfBtn = $("leadPdf");
    if (pdfBtn) pdfBtn.onclick = () => window.LeasePdf.download(r, {explain: S.explain.text, url: location.href}).catch(() => {});
    const form = $("leadForm");
    if (!form) return;
    $("leadBin").oninput = e => {
      e.target.value = e.target.value.replace(/\D/g, "").slice(0, 12); S.leadBin = e.target.value;
      if (S.leadErr && S.leadErr.includes("ИИН") && kzIdOk(S.leadBin)) { S.leadErr = null; form.querySelector(".err")?.remove(); }
    };
    $("leadName").oninput = e => { S.leadName = e.target.value; };
    $("leadEmail").oninput = e => { S.leadEmail = e.target.value; };
    const ph = $("leadPhone");
    ph.onfocus = () => { if (!ph.value) { ph.value = S.leadPhone = "+7 "; } };
    ph.onblur = () => { if (ph.value.replace(/\D/g, "") === "7") ph.value = S.leadPhone = ""; };
    ph.oninput = e => {
      // Вставка 10 цифр без кода страны (701…) — добавляем 7 спереди.
      const raw = ph.value, digits = raw.replace(/\D/g, "");
      const v = e.inputType === "insertFromPaste" && digits.length === 10 && digits[0] !== "8" ? "7" + digits : raw;
      ph.value = S.leadPhone = phoneMask(v);
    };
    $("consentOpen").onclick = e => { e.preventDefault(); openConsent(); };
    $("leadConsent").onchange = e => {
      S.leadConsent = e.target.checked;
      if (S.leadConsent && S.leadErr && S.leadErr.includes("согласие")) { S.leadErr = null; form.querySelector(".err")?.remove(); }
    };
    form.onsubmit = async e => {
      e.preventDefault();
      const name = S.leadName.trim(), email = S.leadEmail.trim(), d = phoneDigits(S.leadPhone), bin = S.leadBin.trim();
      S.leadErr = !/^\d{12}$/.test(bin) ? `Укажите ${idLabel()}: 12 цифр.`
        : !kzIdOk(bin) ? `${idLabel()} указан с ошибкой: проверьте цифры.`
        : name.length < 2 ? "Укажите имя."
        : !emailOk(email) ? "Укажите e-mail, например name@company.kz."
        : !(d.length === 11 && d[0] === "7") ? "Укажите телефон в формате +7 7XX XXX XX XX."
        : !S.leadConsent ? "Чтобы отправить заявку, подтвердите согласие на обработку персональных данных."
        : null;
      if (S.leadErr) { renderResult(); return; }
      const phone = phonePretty(d), consentAt = new Date().toISOString();
      S.lead = "sending"; renderResult();
      try {
        const pdf = await window.LeasePdf.asBase64(r, {explain: S.explain.text, url: location.href, client: {name, phone, email, type: clientTypeOf(bin), idLabel: idLabelOf(bin), bin}});
        const res = await fetch(CFG.aiUrl, {
          method: "POST",
          headers: {"Content-Type": "application/json", apikey: CFG.supabaseKey},
          body: JSON.stringify({action: "lead", clientType: clientTypeOf(bin), bin, name, email, phone, consent: true, consentAt, url: location.href, filename: pdf.filename, pdfBase64: pdf.base64,
            summary: {cost: money(r.cost), down: `${money(r.down)} (${pctStr(r.downPct)})`, months: monthsStr(r.months),
              payment: money(r.payment), overpayment: money(r.overpayment), rate: `${r.rate}% годовых`}})
        });
        if (!res.ok) { let code = "http_" + res.status; try { code = (await res.json()).error || code; } catch {} throw new Error(code); }
        S.lead = {name, phone, email}; S.leadErr = null;
      } catch (err) {
        S.lead = "form";
        const code = err && err.message && !/fetch|network|load/i.test(err.message) ? err.message : "network";
        S.leadErr = (code === "network" ? "Нет связи с сервером. Проверьте интернет и попробуйте ещё раз." : "Не удалось отправить заявку. Попробуйте ещё раз или скачайте PDF и отправьте его менеджеру.")
          + ` Код ошибки: ${code}.`;
        console.warn("lead failed:", code);
      }
      if (S.result === r) renderResult();
      const done = $("leadDone"); if (done) done.scrollIntoView({behavior: "smooth", block: "center"});
    };
  }

  // ---------- согласие: боковая панель, текст берётся со страницы consent.html ----------
  let consentHtml = null;
  async function openConsent(){
    const drawer = $("consentDrawer"), body = $("consentBody");
    drawer.hidden = false; requestAnimationFrame(() => drawer.classList.add("open"));
    document.body.style.overflow = "hidden";
    $("consentClose").focus();
    if (!consentHtml) {
      body.innerHTML = `<p class="muted">Загружаю текст…</p>`;
      try {
        const doc = new DOMParser().parseFromString(await (await fetch("consent.html")).text(), "text/html");
        consentHtml = (doc.querySelector(".notice")?.outerHTML || "") + (doc.querySelector(".doc")?.outerHTML || "");
      } catch { consentHtml = `<p>Не удалось загрузить текст. <a href="consent.html" target="_blank" rel="noopener">Открыть в новой вкладке</a></p>`; }
    }
    body.innerHTML = consentHtml;
  }
  function closeConsent(){
    const drawer = $("consentDrawer");
    drawer.classList.remove("open"); document.body.style.overflow = "";
    setTimeout(() => { drawer.hidden = true; }, 250);
    $("consentOpen")?.focus();
  }
  $("consentClose").onclick = closeConsent;
  $("consentShade").onclick = closeConsent;
  $("consentAccept").onclick = () => {
    S.leadConsent = true;
    const cb = $("leadConsent"); if (cb) { cb.checked = true; cb.dispatchEvent(new Event("change")); }
    closeConsent();
  };
  document.addEventListener("keydown", e => { if (e.key === "Escape" && !$("consentDrawer").hidden) closeConsent(); });

  function renderAll(){ renderParams(); renderResult(); renderCtx(); }

  function summaryText(){
    const r = S.result;
    return ["Предварительный расчёт лизинга, BCC Leasing",
      `Стоимость: ${money(r.cost)}`, `Аванс: ${money(r.down)} (${pctStr(r.downPct)})`, `Срок: ${monthsStr(r.months)}`,
      `Ежемесячный платёж: ${money(r.payment)}`, `Переплата: ${money(r.overpayment)}`, "Не является офертой.", location.href].join("\n");
  }
  async function copy(text, btnId){
    const b = $(btnId), label = b.textContent;
    try { await navigator.clipboard.writeText(text); b.textContent = "Скопировано"; }
    catch { b.textContent = "Не удалось скопировать"; }
    setTimeout(() => { b.textContent = label; }, 1800);
  }

  // Параметры в адресе: #c=10000000&d=20p&m=24 (p — проценты). Нигде не сохраняются.
  function writeHash(){
    const d = S.down.type === "pct" ? S.down.value + "p" : Math.round(S.down.value);
    history.replaceState(null, "", `#c=${Math.round(S.cost)}&d=${d}&m=${S.months}`);
  }
  function readHash(){
    const q = new URLSearchParams(location.hash.slice(1));
    const c = parseFloat(q.get("c")), dRaw = q.get("d") || "", m = parseInt(q.get("m"), 10);
    if (!isFinite(c) || !dRaw || !isFinite(m)) return false;
    S.cost = c; S.months = m;
    S.down = {type: dRaw.endsWith("p") ? "pct" : "amt", value: parseFloat(dRaw)};
    if (!isFinite(S.down.value) || validate()) { S.cost = S.down = S.months = null; return false; }
    return true;
  }

  function reset(){
    Object.assign(S, {cost: null, down: null, months: null, pending: null, msgs: [], result: null, explain: null, lead: null, leadErr: null});
    history.replaceState(null, "", location.pathname);
    greet(); renderResult(); renderCtx();
  }
  function greet(){
    say("bot", "Здравствуйте! Посчитаю предварительный график платежей по лизингу.\nНапишите, что берёте, за сколько, какой аванс и на какой срок. Можно своими словами.");
    renderChips();
  }

  // ---------- шапка: тема и полный экран ----------
  const root = document.documentElement;
  try { const t = localStorage.getItem("lease.theme"); if (t) root.dataset.theme = t; } catch {}
  $("themeBtn").onclick = () => {
    const dark = root.dataset.theme ? root.dataset.theme === "dark" : matchMedia("(prefers-color-scheme: dark)").matches;
    root.dataset.theme = dark ? "light" : "dark";
    try { localStorage.setItem("lease.theme", root.dataset.theme); } catch {}
  };
  $("fsBtn").onclick = () => { (document.fullscreenElement ? document.exitFullscreen() : root.requestFullscreen?.())?.catch?.(() => {}); };
  const CHAT_ICON = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/><path d="M8 9h8M8 13h5"/></svg>`;
  const CALC_ICON = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="5" y="3" width="14" height="18" rx="2"/><path d="M8 7h8M8 12h2M12 12h2M16 12h0M8 16h2M12 16h2M16 16h0"/></svg>`;
  function renderMode(){
    const chat = S.mode === "chat";
    $("chatCard").hidden = !chat; $("params").hidden = chat;
    $("modeBtn").innerHTML = chat ? `${CALC_ICON} Использовать калькулятор` : `${CHAT_ICON} Спросить помощника`;
  }
  function switchMode(to){
    if (to === S.mode) return;
    const cur = {cost: S.cost, down: S.down, months: S.months, pending: S.pending};
    S.saved[S.mode] = cur;
    Object.assign(S, S.saved[to] || {cost: null, down: null, months: null, pending: null});
    S.mode = to; S.lead = null; S.leadErr = null;
    renderMode();
    if (complete() && !validate()) { calculate(); } else { S.result = null; renderResult(); }
    if (to === "calc") renderParams(); else { renderCtx(); $("input").focus({preventScroll: true}); }
    $(to === "chat" ? "chatCard" : "params").scrollIntoView({behavior: "smooth", block: "start"});
  }
  $("modeBtn").onclick = () => switchMode(S.mode === "calc" ? "chat" : "calc");

  $("composer").addEventListener("submit", e => { e.preventDefault(); const v = $("input").value; $("input").value = ""; handle(v); });
  // Enter отправляет, Shift+Enter — перенос строки.
  $("input").addEventListener("keydown", e => { if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); $("composer").requestSubmit(); } });
  setAi(S.ai);
  greet();
  if (!readHash()) Object.assign(S, {cost: 15e6, down: {type: "pct", value: 20}, months: 24});  // пример, как на сайте BCC Leasing
  renderMode(); calculate(); renderParams();
})();
