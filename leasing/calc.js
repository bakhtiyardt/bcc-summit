// Расчёт лизинга и разбор параметров из текста. Чистые функции без DOM:
// подключаются на странице и проверяются тестами в Node.
(function (root) {
  "use strict";

  // Аннуитет: Платёж = P × i × (1+i)^n / ((1+i)^n − 1), переплата = Платёж × n − P.
  function annuity(cost, down, months, annualRatePct) {
    const P = cost - down;
    const i = annualRatePct / 100 / 12;
    const k = Math.pow(1 + i, months);
    const payment = i === 0 ? P / months : P * i * k / (k - 1);
    const schedule = [];
    let rest = P;
    for (let m = 1; m <= months; m++) {
      const interest = rest * i;
      const principal = payment - interest;
      rest = m === months ? 0 : rest - principal;
      schedule.push({ month: m, payment, principal, interest, rest });
    }
    const total = payment * months;
    return { financed: P, monthlyRate: i, payment, total, overpayment: total - P, schedule };
  }

  // ---------- разбор свободного текста ----------
  const WORD_NUM = { "один": 1, "одного": 1, "два": 2, "двух": 2, "три": 3, "трёх": 3, "трех": 3, "четыре": 4, "четырёх": 4, "четырех": 4, "пять": 5, "пяти": 5 };
  const DOWN_WORDS = /(аванс|взнос|предоплат|первоначал|первый плат|сразу|внесу|вношу|плачу)/i;
  const MONEY_UNIT = /^(млрд|миллиард|млн|мил+[иь]?он|лям|лимон|тыс|к$|k$|₸|тг|тенге)/i;

  function num(s) { return parseFloat(s.replace(/[\s ]/g, "").replace(",", ".")); }
  function unitMult(u) {
    if (!u) return 1;
    u = u.toLowerCase();
    if (/^(млрд|миллиард)/.test(u)) return 1e9;
    if (/^(млн|мил+[иь]?он|лям|лимон)/.test(u)) return 1e6;
    if (/^(тыс|к$|k$)/.test(u)) return 1e3;
    return 1;
  }

  // Возвращает {cost, downPct, downAmt, months} — найденное, остальное null.
  function parseDeal(text, pending) {
    const t = " " + String(text || "").toLowerCase().replace(/ё/g, "е") + " ";
    const out = { cost: null, downPct: null, downAmt: null, months: null };
    const amounts = [];

    if (/без (аванса|взноса|первоначального)/.test(t)) out.downAmt = 0;
    if (/полтора года/.test(t)) out.months = 18;
    const wy = t.match(/(один|одного|два|двух|три|трех|четыре|четырех|пять|пяти)\s+(год|года|лет)/);
    if (wy && out.months == null) out.months = WORD_NUM[wy[1]] * 12;
    if (out.months == null && /на (один )?год(?![а-я])/.test(t)) out.months = 12;

    const re = /(\d+(?:[  ]\d{3})*(?:[.,]\d+)?)\s*(%|процент\w*|млрд\w*|миллиард\w*|млн\w*|мил+[иь]?он\w*|лям\w*|лимон\w*|тыс\w*|k(?![a-z])|к(?![а-я])|мес\w*|год\w*|лет(?![а-я])|₸|тг(?![а-я])|тенге)?/gi;
    let m;
    while ((m = re.exec(t))) {
      const v = num(m[1]), unit = (m[2] || "").toLowerCase(), at = m.index;
      // Слово «аванс» относится к числу, только если стоит рядом в той же части фразы.
      const before = t.slice(Math.max(0, at - 25), at).split(/[,;.]/).pop();
      const after = t.slice(at + m[0].length, at + m[0].length + 12).split(/[,;.]/)[0];
      const nearDown = out.downAmt !== 0 && (DOWN_WORDS.test(before) || DOWN_WORDS.test(after));
      if (unit === "%" || unit.startsWith("процент")) { out.downPct = v; continue; }
      if (unit.startsWith("мес")) { out.months = Math.round(v); continue; }
      if (unit.startsWith("год") || unit === "лет") { out.months = Math.round(v * 12); continue; }
      if (MONEY_UNIT.test(unit)) { amounts.push({ v: v * unitMult(unit), nearDown }); continue; }
      // Число без единиц: трактуем по контексту.
      if (pending === "months" && v > 0 && v <= 120) { out.months = Math.round(v); continue; }
      if (pending === "down" && v <= 100) { out.downPct = v; continue; }
      if (pending === "cost" && v < 1000) { amounts.push({ v: v * 1e6, nearDown: false, guessed: true }); continue; }
      if (v >= 10000) { amounts.push({ v, nearDown }); continue; }
      if (/срок/.test(before) && v <= 120) { out.months = Math.round(v); continue; }
    }

    const downs = amounts.filter(a => a.nearDown), costs = amounts.filter(a => !a.nearDown);
    if (pending === "down" && amounts.length === 1 && out.downPct == null) { out.downAmt = amounts[0].v; }
    else {
      if (downs.length) out.downAmt = downs[0].v;
      if (costs.length) out.cost = Math.max(...costs.map(a => a.v));
      else if (!downs.length && amounts.length) out.cost = amounts[0].v;
    }
    out.guessedMillions = amounts.some(a => a.guessed);
    return out;
  }

  const api = { annuity, parseDeal };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.LeaseCalc = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
