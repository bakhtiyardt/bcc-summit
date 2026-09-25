// Сверка расчёта приложения с эталоном и проверка разбора фраз. Запуск: node leasing/tests/test.js
const { annuity, parseDeal } = require("../calc.js");
const ref = require("./reference.json");
let fail = 0;
const ok = (c, msg) => { if (!c) { fail++; console.log("FAIL", msg); } };
for (const s of ref) {
  const r = annuity(...s.args);
  ok(Math.abs(r.payment - s.payment) < 0.01, s.name + " платёж");
  ok(Math.abs(r.overpayment - s.overpayment) < 0.01, s.name + " переплата");
  s.rows.forEach((row, k) => ["month","payment","principal","interest","rest"].forEach((f, j) =>
    ok(Math.abs(r.schedule[k][f] - row[j]) < 0.01, `${s.name} месяц ${k+1} ${f}`)));
  console.log(`${s.name}: платёж ${Math.round(r.payment).toLocaleString("ru")} ₸, переплата ${Math.round(r.overpayment).toLocaleString("ru")} ₸`);
}
const cases = [
  ["оборудование за 10 млн тенге, аванс 20%, на 24 месяца", {cost:1e7, downPct:20, months:24}],
  ["Хочу спецтехнику за 45 000 000, первоначальный взнос 9 млн, срок 3 года", {cost:45e6, downAmt:9e6, months:36}],
  ["машина 18,5 млн на 5 лет с авансом 15 процентов", {cost:18.5e6, downPct:15, months:60}],
  ["грузовик 32млн 30% 12 мес", {cost:32e6, downPct:30, months:12}],
  ["на полтора года, стоимость 7 млн, аванс 1,4 млн", {cost:7e6, downAmt:1.4e6, months:18}],
  ["экскаватор за 25 млн на два года", {cost:25e6, downPct:null, downAmt:null, months:24}],
  ["без аванса, 5 млн, 36 мес", {cost:5e6, downAmt:0, months:36}],
];
for (const [text, exp] of cases) {
  const p = parseDeal(text);
  for (const k of Object.keys(exp)) ok(p[k] === exp[k], `"${text}" ${k}: ${p[k]} вместо ${exp[k]}`);
}
ok(parseDeal("24", "months").months === 24, "ответ 24 на вопрос о сроке");
ok(parseDeal("20", "down").downPct === 20, "ответ 20 на вопрос об авансе");
ok(parseDeal("2 млн", "down").downAmt === 2e6, "ответ 2 млн на вопрос об авансе");
ok(parseDeal("10", "cost").cost === 1e7, "ответ 10 на вопрос о стоимости");
ok(parseDeal("2 милиона", "down").downAmt === 2e6, "опечатка «милиона» в ответе об авансе");
ok(parseDeal("авто за 15 мильонов, аванс 3 лимона, 24 мес").cost === 15e6, "опечатка «мильонов»");
ok(parseDeal("авто за 15 мильонов, аванс 3 лимона, 24 мес").downAmt === 3e6, "сленг «лимона»");
console.log(fail ? `Провалено: ${fail}` : "Все проверки пройдены");
process.exit(fail ? 1 : 0);
