import type pg from 'pg';

export type PriceKind = 'part' | 'material';
export type PriceLookup = (kind: PriceKind, key: string, date: string) => number | null;
export interface PriceEvent {
  entity_type: PriceKind;
  entity_key: string;
  effective_date: string;
  new_price: string | number | null;
}
const keyOf = (kind: PriceKind, key: string) => `${kind}:${kind === 'part' ? key.trim().toUpperCase() : key}`;

/** Events must be in ascending timestamp/id order. Same-day changes use the last recorded price.
 * No inference before the first recorded event; null explicitly clears a price. */
export function priceLookup(events: readonly PriceEvent[]): PriceLookup {
  const series = new Map<string, Map<string, number | null>>();
  for (const e of events) {
    const key = keyOf(e.entity_type, e.entity_key);
    const dates = series.get(key) ?? new Map<string, number | null>();
    const value = e.new_price === null ? null : Number(e.new_price);
    dates.set(e.effective_date, value !== null && Number.isFinite(value) && value >= 0 ? value : null);
    series.set(key, dates);
  }
  const timelines = new Map([...series].map(([key, dates]) => [key, [...dates].sort(([a], [b]) => a.localeCompare(b))]));
  return (kind, key, date) => {
    const eventsForKey = timelines.get(keyOf(kind, key));
    if (!eventsForKey) return null;
    let lo = 0, hi = eventsForKey.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (eventsForKey[mid]![0] <= date) lo = mid + 1;
      else hi = mid;
    }
    return lo ? eventsForKey[lo - 1]![1] : null;
  };
}

/** Use plant-local civil dates, including the last price change recorded on each date. */
export async function loadPriceLookup(pool: pg.Pool, from: string, to: string, offsetMinutes: number): Promise<PriceLookup> {
  const result = await pool.query<PriceEvent>(`WITH dated AS (
    SELECT entity_type,CASE WHEN entity_type='part' THEN upper(btrim(entity_key)) ELSE entity_key END AS entity_key,new_price,changed_at,id,
      COALESCE(effective_date,((changed_at AT TIME ZONE 'UTC') + ($3::integer * interval '1 minute'))::date) AS effective
    FROM md_price_history
    WHERE effective_date <= $2::date OR (effective_date IS NULL AND changed_at < (($2::date + 1)::timestamp - ($3::integer * interval '1 minute')) AT TIME ZONE 'UTC')
  ), prior AS (
    SELECT DISTINCT ON (entity_type,entity_key) * FROM dated WHERE effective < $1::date
    ORDER BY entity_type,entity_key,effective DESC,changed_at DESC,id DESC
  ), relevant AS (
    SELECT * FROM prior UNION ALL SELECT * FROM dated WHERE effective BETWEEN $1::date AND $2::date
  ) SELECT entity_type,entity_key,new_price,effective::text AS effective_date
    FROM relevant ORDER BY effective,changed_at,id`, [from,to,offsetMinutes]);
  return priceLookup(result.rows);
}

/** A single price is displayed only when every record used the same price. */
export function uniformPrice(values: (number | null)[]): number | null {
  const first = values[0];
  return first !== undefined && values.every(v => v === first) ? first : null;
}

export type MaterialLookup = (part: string, date: string) => string | null;
export async function loadMaterialLookup(pool: pg.Pool, from: string, to: string): Promise<MaterialLookup> {
  const result = await pool.query<{dp_no:string;material_code:string|null;effective_date:string}>(
    `WITH prior AS (
      SELECT DISTINCT ON (upper(btrim(dp_no))) upper(btrim(dp_no)) AS dp_no,material_code,effective_date,id
      FROM md_part_material_history WHERE effective_date<$1::date ORDER BY upper(btrim(dp_no)),effective_date DESC,id DESC
    ), relevant AS (SELECT * FROM prior UNION ALL SELECT upper(btrim(dp_no)),material_code,effective_date,id FROM md_part_material_history WHERE effective_date BETWEEN $1::date AND $2::date)
    SELECT dp_no,material_code,effective_date::text FROM relevant ORDER BY effective_date,id`,[from,to]);
  const series = new Map<string, Map<string,string|null>>();
  for (const row of result.rows) {
    const dates=series.get(row.dp_no) ?? new Map<string,string|null>();
    dates.set(row.effective_date,row.material_code);series.set(row.dp_no,dates);
  }
  return (part,date) => {
    let value:string|null=null;
    for (const [day,code] of series.get(part.trim().toUpperCase()) ?? []) { if(day>date) break; value=code; }
    return value;
  };
}
