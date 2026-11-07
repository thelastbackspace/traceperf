/**
 * Reading Postgres query plans (EXPLAIN (FORMAT JSON), not ANALYZE: the
 * query is planned, never run) for scans an index would avoid.
 */

export interface PlanNode {
  'Node Type'?: string;
  'Relation Name'?: string;
  'Alias'?: string;
  'Filter'?: string;
  'Plan Rows'?: number;
  'Total Cost'?: number;
  Plans?: PlanNode[];
  [key: string]: unknown;
}

export interface SeqScan {
  table: string;
  filter: string;
  /** Rows the planner expects the scan to return (after the filter) */
  rows: number;
  /** Columns compared in the filter, in order: the index to suggest */
  columns: string[];
}

/** Every sequential scan with a filter in a plan (the root of EXPLAIN (FORMAT JSON) output, or its "Plan") */
export function seqScans(plan: unknown): SeqScan[] {
  const out: SeqScan[] = [];
  const top: PlanNode | undefined = Array.isArray(plan) ? (plan[0] && (plan[0] as any).Plan) : (plan as any)?.Plan ?? plan;
  const visit = (node: PlanNode | undefined) => {
    if (!node || typeof node !== 'object') return;
    if (node['Node Type'] === 'Seq Scan' && node['Relation Name'] && typeof node.Filter === 'string') {
      out.push({ table: node['Relation Name'], filter: node.Filter, rows: Number(node['Plan Rows']) || 0, columns: filterColumns(node.Filter) });
    }
    for (const child of node.Plans || []) visit(child);
  };
  visit(top);
  return out;
}

/**
 * Columns compared with a value in a Postgres filter expression:
 * "(customer_id = $1)", "((status)::text = 'paid'::text)", "((a = 1) AND (b > $2))".
 * Equality columns come first (they lead a composite index), then ranges.
 */
export function filterColumns(filter: string): string[] {
  const eq: string[] = [];
  const range: string[] = [];
  const re = /\(*("?[a-z_][\w$]*"?)\)?(?:::[\w ]+)?\s*(=|<>|!=|<=|>=|<|>|~~\*?|= ANY)\s*(\(?\$\d+|'|\(?-?\d|ANY|\(?'|true|false|NULL|\(?[a-z_]+\()/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(filter))) {
    const column = m[1].replace(/"/g, '');
    if (/^(and|or|not|true|false|null)$/i.test(column)) continue;
    // "<>" and LIKE '%x' can't use a btree index: leave them out
    if (m[2] === '<>' || m[2] === '!=') continue;
    if (/^~~/.test(m[2])) continue;
    const list = m[2] === '=' || m[2] === '= ANY' ? eq : range;
    if (!eq.includes(column) && !range.includes(column)) list.push(column);
  }
  return [...eq, ...range];
}

/** "CREATE INDEX ON orders (customer_id, created_at)" */
export function indexStatement(table: string, columns: string[]): string {
  const quote = (name: string) => (/^[a-z_][a-z0-9_]*$/.test(name) ? name : `"${name.replace(/"/g, '""')}"`);
  return `CREATE INDEX ON ${table.split('.').map(quote).join('.')} (${columns.map(quote).join(', ')})`;
}
