// Supabase Edge Function «lease-ai»: ИИ для лизингового калькулятора BCC Leasing.
// Только два действия — извлечь параметры из текста и объяснить готовый расчёт.
// Сам расчёт делает страница по формуле; модель цифры не считает.
// Секрет: ANTHROPIC_API_KEY (Edge Functions → Secrets).
import Anthropic from "npm:@anthropic-ai/sdk";

const client = new Anthropic(); // ключ берётся из ANTHROPIC_API_KEY
const MODEL = "claude-haiku-4-5";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

const nullable = (type: string) => ({ anyOf: [{ type }, { type: "null" }] });
const EXTRACT_SCHEMA = {
  type: "object",
  properties: {
    cost_tenge: nullable("number"),
    down_payment_percent: nullable("number"),
    down_payment_tenge: nullable("number"),
    term_months: nullable("integer"),
  },
  required: ["cost_tenge", "down_payment_percent", "down_payment_tenge", "term_months"],
  additionalProperties: false,
};

const EXTRACT_SYSTEM = `Ты извлекаешь параметры лизинговой сделки из сообщения клиента (русский или казахский язык).
Параметры: стоимость предмета лизинга в тенге, аванс (процентом или суммой в тенге), срок в месяцах.
Правила:
- «млн», «миллион», «лям» = 1 000 000; «тыс» = 1 000; «млрд» = 1 000 000 000.
- Срок в годах переводи в месяцы: «2 года» = 24, «полтора года» = 18.
- Аванс процентом записывай в down_payment_percent, суммой — в down_payment_tenge. «Без аванса» = 0 тенге. «Половину» = 50%.
- Если параметр не назван, верни null. Никогда не придумывай и не подставляй значения по умолчанию.
- Если клиент отвечает на уточняющий вопрос коротко (например, «24» на вопрос о сроке), относи ответ к этому вопросу.`;

const FIELD_RU: Record<string, string> = { cost: "стоимость предмета лизинга", down: "аванс", months: "срок в месяцах" };

async function extract(text: string, pending: string | null) {
  const hint = pending && FIELD_RU[pending] ? `\nКлиенту только что задали вопрос: ${FIELD_RU[pending]}.` : "";
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 256,
    system: EXTRACT_SYSTEM,
    messages: [{ role: "user", content: `Сообщение клиента: «${text}»${hint}` }],
    output_config: { format: { type: "json_schema", schema: EXTRACT_SCHEMA } },
  });
  const block = response.content.find((b) => b.type === "text");
  if (response.stop_reason !== "end_turn" || !block || block.type !== "text") throw new Error("no_output");
  return JSON.parse(block.text);
}

async function explain(d: Record<string, unknown>) {
  const facts = [
    `Стоимость предмета лизинга: ${d.cost} ₸`,
    `Аванс: ${d.down} ₸ (${d.downPct}%)`,
    `Сумма финансирования: ${d.financed} ₸`,
    `Срок: ${d.months} мес.`,
    `Ставка удорожания (тестовая): ${d.rate}% годовых`,
    `Ежемесячный платёж: ${d.payment} ₸`,
    `Всего платежей за срок: ${d.total} ₸`,
    `Переплата (удорожание): ${d.overpayment} ₸`,
  ].join("\n");
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 400,
    system: `Ты помогаешь клиенту лизинговой компании понять предварительный расчёт.
Объясни простым языком в 3–4 коротких предложениях: сколько он вносит сразу, сколько платит каждый месяц и сколько всего, откуда переплата.
Используй только числа из данных, ничего не пересчитывай и не добавляй новых чисел. Пиши суммы так же, как в данных.
Обращайся на «вы». Без заголовков, списков и markdown. Не давай советов и не обещай одобрения.`,
    messages: [{ role: "user", content: facts }],
  });
  const block = response.content.find((b) => b.type === "text");
  if (!block || block.type !== "text") throw new Error("no_output");
  return block.text.trim();
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ error: "bad_json" }, 400); }

  try {
    if (body.action === "extract") {
      const text = String(body.text ?? "").slice(0, 500);
      if (!text.trim()) return json({ error: "empty_text" }, 400);
      const pending = typeof body.pending === "string" ? body.pending : null;
      return json({ params: await extract(text, pending) });
    }
    if (body.action === "explain" && body.data && typeof body.data === "object") {
      return json({ text: await explain(body.data as Record<string, unknown>) });
    }
    return json({ error: "bad_action" }, 400);
  } catch (e) {
    if (e instanceof Anthropic.RateLimitError) return json({ error: "rate_limited" }, 429);
    if (e instanceof Anthropic.APIError) return json({ error: "ai_error", status: e.status }, 502);
    return json({ error: "ai_error" }, 502);
  }
});
