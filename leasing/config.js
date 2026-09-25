// Параметры калькулятора: ставка удорожания, допустимые диапазоны, адрес ИИ.
window.LEASE_CONFIG = {
  annualRatePct: 18,    // ставка удорожания, % годовых (i = 18 / 12 = 1,5% в месяц)
  minTermMonths: 12,
  maxTermMonths: 60,
  minDownPct: 0,        // минимальный аванс, % от стоимости (0 — можно без аванса)
  // ИИ: Supabase Edge Function «lease-ai». Пустая строка — только разбор правилами.
  aiUrl: "https://khkbpdtoiiezpazwwkvt.supabase.co/functions/v1/lease-ai",
  // Публичный publishable-ключ проекта (тот же, что у опросов). Секретный ключ сюда не вставлять.
  supabaseKey: "sb_publishable_ijzVdWR7cwnhQzuazwyFlg_b_3X52PS"
};
