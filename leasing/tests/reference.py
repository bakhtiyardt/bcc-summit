# Независимый эталон: график аннуитета по формуле из блока E (Decimal, без кода приложения).
from decimal import Decimal as D, getcontext
import json, sys
getcontext().prec = 40
def ref(cost, down, months, annual):
    P = D(cost) - D(down); i = D(annual) / 100 / 12; k = (1 + i) ** months
    A = P * i * k / (k - 1); rest = P; rows = []
    for m in range(1, months + 1):
        it = rest * i; pr = A - it; rest = D(0) if m == months else rest - pr
        rows.append([m, float(A), float(pr), float(it), float(rest)])
    return {"payment": float(A), "overpayment": float(A * months - P), "rows": rows}
SCEN = [  # стоимость, аванс, срок, ставка % годовых
  ("Оборудование 10 млн, аванс 20%, 24 мес", 10_000_000, 2_000_000, 24, 18),
  ("Спецтехника 45 млн, аванс 9 млн, 36 мес", 45_000_000, 9_000_000, 36, 18),
  ("Автомобиль 18,5 млн, аванс 15%, 60 мес", 18_500_000, 2_775_000, 60, 18),
  ("Грузовик 32 млн, аванс 30%, 12 мес", 32_000_000, 9_600_000, 12, 18),
]
json.dump([{"name": n, "args": [c, d, m, r], **ref(c, d, m, r)} for n, c, d, m, r in SCEN], sys.stdout, ensure_ascii=False)
