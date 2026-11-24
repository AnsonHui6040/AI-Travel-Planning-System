import type { Row } from "@atps/schemas";
import { EVIDENCE_ORDER } from "./dedupe";
import { applyVerificationCap, type ModelRef, type VerificationStatus } from "./states";

// T25：交叉核查（D07、第 2.5 節證據順序、第 9.3 節 E4）。
// 每個事實欄位收集 Research 與 Verification 的主張，採用證據順序最高的來源；
// 最高等級的來源之間不一致時無法判定，標示 Conflict（不得進入行程草案）。
// 營業時間、門票、休館與交通服務以官方資訊為準：只有非官方來源時，最高為 Partially Verified。

type Item = Row<"itinerary_items">;
export type FactClaimRecord = Item["fact_claims"][number];
export type ResolvedFact = Item["facts"][number];
export type FactField = FactClaimRecord["field"];

const FIELD_ORDER: readonly FactField[] = ["opening_hours", "closed_days", "admission", "reservation", "transport_service"];
const OFFICIAL_REQUIRED: ReadonlySet<FactField> = new Set(["opening_hours", "closed_days", "admission", "transport_service"]);
const OFFICIAL_GRADES: ReadonlySet<string> = new Set(["facility_official", "official_transport_tourism"]);

// 寫法差異（全形半形、空白、各種破折號）不算不一致
function normalizeValue(value: string): string {
  return value
    .normalize("NFKC")
    .replace(/[‐-―−~〜～]/g, "-")
    .replace(/\s+/g, "")
    .toLowerCase();
}

export function resolveFact(claims: readonly FactClaimRecord[]): ResolvedFact {
  const first = claims[0];
  if (!first) throw new Error("沒有事實主張");
  const rank = (c: FactClaimRecord) => EVIDENCE_ORDER.indexOf(c.source.grade);
  const best = Math.min(...claims.map(rank));
  const top = claims.filter((c) => rank(c) === best);
  const grade = EVIDENCE_ORDER[best] ?? first.source.grade;
  const values = new Set(top.map((c) => normalizeValue(c.value)));
  if (values.size > 1) return { field: first.field, status: "conflict", value: null, grade };
  return { field: first.field, status: "resolved", value: top[0]?.value ?? first.value, grade };
}

export function resolveFacts(claims: readonly FactClaimRecord[]): ResolvedFact[] {
  return FIELD_ORDER.flatMap((field) => {
    const forField = claims.filter((c) => c.field === field);
    return forField.length > 0 ? [resolveFact(forField)] : [];
  });
}

export interface VerificationInput {
  status: VerificationStatus;
  facts: readonly FactClaimRecord[];
  verifiedBy: ModelRef;
}

export interface CrossCheckResult {
  status: VerificationStatus;
  facts: ResolvedFact[];
}

export function crossCheck(
  item: { generated_by: ModelRef | null; fact_claims: readonly FactClaimRecord[] },
  verification: VerificationInput,
): CrossCheckResult {
  const facts = resolveFacts([...item.fact_claims, ...verification.facts]);
  let status: VerificationStatus = verification.status;
  if (facts.some((f) => f.status === "conflict")) status = "conflict";
  else if (
    status === "verified" &&
    facts.some((f) => OFFICIAL_REQUIRED.has(f.field) && (f.grade === null || !OFFICIAL_GRADES.has(f.grade)))
  ) {
    status = "partially_verified";
  }
  return { status: applyVerificationCap(status, item.generated_by, verification.verifiedBy), facts };
}
