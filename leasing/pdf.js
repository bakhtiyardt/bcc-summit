// Выгрузка расчёта в PDF: параметры, итоги, пояснение, дисклеймер и график платежей.
// Библиотеки и шрифт (Inter с кириллицей и знаком ₸) загружаются только при первом нажатии.
(function () {
  "use strict";
  const BLUE = [35, 86, 217], INK = [30, 35, 44], MUTED = [107, 114, 128], FIELD = [237, 239, 242], LINE = [226, 229, 234];
  const WARN_BG = [251, 241, 218], WARN = [138, 90, 0];
  let ready = null;

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = src; s.onload = resolve; s.onerror = () => reject(new Error("load " + src));
      document.head.appendChild(s);
    });
  }
  async function fontBase64(url) {
    const bytes = new Uint8Array(await (await fetch(url)).arrayBuffer());
    let bin = "";
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(bin);
  }
  function prepare() {
    if (!ready) ready = (async () => {
      await loadScript("vendor/jspdf.umd.min.js");
      await loadScript("vendor/jspdf.plugin.autotable.min.js");
      const [regular, bold] = await Promise.all([fontBase64("fonts/Inter-Regular.ttf"), fontBase64("fonts/Inter-Bold.ttf")]);
      return { regular, bold };
    })().catch(e => { ready = null; throw e; });
    return ready;
  }

  const n0 = n => Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  const money = n => n0(n) + " ₸";
  const pct = n => (Math.round(n * 100) / 100).toString().replace(".", ",") + "%";
  const plural = (n, one, few, many) => { const a = n % 10, b = n % 100; return a === 1 && b !== 11 ? one : a >= 2 && a <= 4 && (b < 10 || b >= 20) ? few : many; };

  // r — результат расчёта из app.js; meta — {explain, url, client?: {name, phone}}.
  async function build(r, meta) {
    const fonts = await prepare();
    const doc = new window.jspdf.jsPDF({ unit: "mm", format: "a4" });
    doc.addFileToVFS("Inter-Regular.ttf", fonts.regular); doc.addFont("Inter-Regular.ttf", "Inter", "normal");
    doc.addFileToVFS("Inter-Bold.ttf", fonts.bold); doc.addFont("Inter-Bold.ttf", "Inter", "bold");
    const W = 210, M = 16, CW = W - M * 2;
    const date = new Date().toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric" });

    // Шапка: логотип bcc △ leasing
    doc.setFont("Inter", "bold"); doc.setFontSize(17); doc.setTextColor(...INK);
    doc.text("bcc", M, 20);
    const bx = M + doc.getTextWidth("bcc") + 1.6;
    doc.setDrawColor(...BLUE); doc.setLineWidth(0.9); doc.setLineJoin("round");
    doc.triangle(bx + 2.6, 14.4, bx + 5.4, 19.6, bx, 19.6, "S");
    doc.setFont("Inter", "normal"); doc.setTextColor(...MUTED);
    doc.text("leasing", bx + 7, 20);
    doc.setFontSize(9); doc.text(`Лизинг для бизнеса · ${date}`, W - M, 20, { align: "right" });
    doc.setDrawColor(...LINE); doc.setLineWidth(0.3); doc.line(M, 25, W - M, 25);

    doc.setFont("Inter", "bold"); doc.setFontSize(18); doc.setTextColor(...INK);
    doc.text(meta.client ? "Заявка на лизинг" : "Предварительный расчёт лизинга", M, 36);
    let shift = 0;
    if (meta.client) {  // блок с контактами клиента для менеджера
      const two = !!meta.client.bin;
      doc.setFillColor(...FIELD); doc.roundedRect(M, 41, CW, two ? 17 : 12, 2, 2, "F");
      doc.setFont("Inter", "normal"); doc.setFontSize(8.5); doc.setTextColor(...MUTED); doc.text("Клиент", M + 4, 46);
      doc.setFont("Inter", "bold"); doc.setFontSize(11); doc.setTextColor(...INK);
      doc.text([meta.client.name, meta.client.phone, meta.client.email].filter(Boolean).join(" · "), M + 4, 50.8);
      if (two) { doc.setFont("Inter", "normal"); doc.setFontSize(10); doc.text(`${meta.client.type} · ${meta.client.idLabel} ${meta.client.bin}`, M + 4, 55.6); }
      shift = two ? 21 : 16;
    }

    // Параметры сделки: две колонки «подпись — значение»
    const params = [
      ["Стоимость предмета лизинга", money(r.cost)],
      ["Первоначальный взнос", `${money(r.down)} (${pct(r.downPct)})`],
      ["Сумма финансирования", money(r.financed)],
      ["Срок лизинга", `${r.months} ${plural(r.months, "месяц", "месяца", "месяцев")}`],
      ["Ставка удорожания", `${r.rate}% годовых`],
      ["Всего платежей за срок", money(r.total)],
    ];
    let y = 46 + shift;
    params.forEach((p, k) => {
      const x = k % 2 === 0 ? M : M + CW / 2 + 4, yy = y + Math.floor(k / 2) * 12;
      doc.setFont("Inter", "normal"); doc.setFontSize(8.5); doc.setTextColor(...MUTED); doc.text(p[0], x, yy);
      doc.setFont("Inter", "bold"); doc.setFontSize(11); doc.setTextColor(...INK); doc.text(p[1], x, yy + 5.2);
    });
    y += 36;

    // Итоги: три плашки, главная — синяя
    const kpis = [["Ежемесячный платёж", money(r.payment)], ["Переплата", money(r.overpayment)], ["Сумма финансирования", money(r.financed)]];
    const kw = (CW - 8) / 3;
    kpis.forEach((k, i) => {
      const x = M + i * (kw + 4);
      doc.setFillColor(...(i === 0 ? BLUE : FIELD)); doc.roundedRect(x, y, kw, 20, 3, 3, "F");
      doc.setTextColor(...(i === 0 ? [255, 255, 255] : MUTED)); doc.setFont("Inter", "normal"); doc.setFontSize(8.5); doc.text(k[0], x + 4, y + 6.5);
      doc.setTextColor(...(i === 0 ? [255, 255, 255] : INK)); doc.setFont("Inter", "bold"); doc.setFontSize(14); doc.text(k[1], x + 4, y + 15);
    });
    y += 28;

    // Пояснение простым языком
    doc.setFont("Inter", "normal"); doc.setFontSize(10); doc.setTextColor(...INK);
    const lines = doc.splitTextToSize(meta.explain, CW - 5);
    doc.setDrawColor(...BLUE); doc.setLineWidth(0.8); doc.line(M, y - 3.5, M, y - 3.5 + lines.length * 4.6);
    doc.text(lines, M + 4, y);
    y += lines.length * 4.6 + 4;

    // Дисклеймер
    doc.setFillColor(...WARN_BG); doc.roundedRect(M, y, CW, 10, 2, 2, "F");
    doc.setFont("Inter", "bold"); doc.setFontSize(9); doc.setTextColor(...WARN);
    doc.text("Предварительный расчёт, не является офертой. Точные условия рассчитает менеджер BCC Leasing.", M + 4, y + 6.3);
    y += 18;

    doc.setFont("Inter", "bold"); doc.setFontSize(13); doc.setTextColor(...INK);
    doc.text("График платежей", M, y);
    doc.autoTable({
      startY: y + 3,
      margin: { left: M, right: M, bottom: 18 },
      head: [["Месяц", "Платёж, ₸", "Погашение стоимости, ₸", "Удорожание, ₸", "Остаток, ₸"]],
      body: r.schedule.map(x => [x.month, n0(x.payment), n0(x.principal), n0(x.interest), n0(x.rest)]),
      foot: [["Итого", n0(r.total), n0(r.financed), n0(r.overpayment), ""]],
      showFoot: "lastPage",
      styles: { font: "Inter", fontSize: 9, cellPadding: 2.2, textColor: INK, lineColor: LINE, lineWidth: 0.2 },
      headStyles: { font: "Inter", fontStyle: "bold", fillColor: BLUE, textColor: [255, 255, 255], halign: "right" },
      footStyles: { font: "Inter", fontStyle: "bold", fillColor: FIELD, textColor: INK, halign: "right" },
      columnStyles: { 0: { halign: "left" }, 1: { halign: "right" }, 2: { halign: "right" }, 3: { halign: "right" }, 4: { halign: "right" } },
      alternateRowStyles: { fillColor: [248, 249, 251] },
      didParseCell: d => { if (d.column.index === 0 && d.section !== "body") d.cell.styles.halign = "left"; },
    });

    // Подвал на каждой странице
    const pages = doc.getNumberOfPages();
    for (let i = 1; i <= pages; i++) {
      doc.setPage(i);
      doc.setFont("Inter", "normal"); doc.setFontSize(7.5); doc.setTextColor(...MUTED);
      doc.text("BCC Leasing · предварительный расчёт · не является офертой", M, 289);
      doc.text(`Стр. ${i} из ${pages}`, W - M, 289, { align: "right" });
      if (i === pages && meta.url) doc.textWithLink("Открыть расчёт онлайн", M, 284, { url: meta.url });
    }
    return doc;
  }
  const fileName = r => `BCC_Leasing_raschet_${Math.round(r.cost)}_${r.months}m.pdf`;
  async function download(r, meta) { (await build(r, meta)).save(fileName(r)); }
  async function asBase64(r, meta) { return {filename: fileName(r), base64: (await build(r, meta)).output("datauristring").split(",")[1]}; }

  window.LeasePdf = { download, asBase64, prepare };
})();
