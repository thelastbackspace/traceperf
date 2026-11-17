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
  /** Rows the scan reads (MySQL's estimate; Postgres: the table's size is used) */
  examined?: number;
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

/**
 * "CREATE INDEX ON orders (customer_id, created_at)" (Postgres names it);
 * MySQL needs a name: "CREATE INDEX idx_orders_customer_id ON orders (customer_id)"
 */
export function indexStatement(table: string, columns: string[], dialect: 'pg' | 'mysql' = 'pg'): string {
  if (dialect === 'mysql') {
    const quote = (name: string) => (/^[a-z_][a-z0-9_]*$/i.test(name) ? name : `\`${name.replace(/`/g, '``')}\``);
    const bare = table.split('.').pop() || table;
    const name = `idx_${bare}_${columns.join('_')}`.replace(/[^\w]/g, '_').slice(0, 64);
    return `CREATE INDEX ${name} ON ${table.split('.').map(quote).join('.')} (${columns.map(quote).join(', ')})`;
  }
  const quote = (name: string) => (/^[a-z_][a-z0-9_]*$/.test(name) ? name : `"${name.replace(/"/g, '""')}"`);
  return `CREATE INDEX ON ${table.split('.').map(quote).join('.')} (${columns.map(quote).join(', ')})`;
}

/**
 * Full table scans with a condition in MySQL / MariaDB EXPLAIN FORMAT=JSON
 * output ("access_type": "ALL"), in the same shape as seqScans.
 */
export function mysqlFullScans(plan: unknown): SeqScan[] {
  const out: SeqScan[] = [];
  const visit = (node: unknown, depth: number) => {
    if (!node || typeof node !== 'object' || depth > 50) return;
    if (Array.isArray(node)) {
      node.forEach(n => visit(n, depth + 1));
      return;
    }
    const n = node as Record<string, any>;
    if (n.access_type === 'ALL' && typeof n.table_name === 'string' && typeof n.attached_condition === 'string') {
      const examined = Number(n.rows_examined_per_scan ?? n.rows) || 0;
      const filtered = Number(n.filtered);
      const produced = n.rows_produced_per_join !== undefined
        ? Number(n.rows_produced_per_join) || 0
        : Number.isFinite(filtered) ? Math.round((examined * filtered) / 100) : examined;
      out.push({ table: n.table_name, filter: n.attached_condition, rows: produced, examined, columns: mysqlFilterColumns(n.attached_condition, n.table_name) });
    }
    for (const value of Object.values(n)) if (value && typeof value === 'object') visit(value, depth + 1);
  };
  visit(plan, 0);
  return out;
}

/**
 * Columns of `table` compared with a value in a MySQL attached_condition:
 * "(`shop`.`orders`.`customer_id` = 42)", "((`o`.`status` = 'paid') and (`o`.`created_at` > '2024-01-01'))",
 * MariaDB: "orders.customer_id = 42". Equality first, then ranges; <>, LIKE and joins left out.
 */
export function mysqlFilterColumns(condition: string, table?: string): string[] {
  const eq: string[] = [];
  const range: string[] = [];
  const ident = '(?:`[^`]+`|[A-Za-z_][\\w$]*)';
  const re = new RegExp(`((?:${ident}\\.)*${ident})\\s*(<=>|<>|!=|<=|>=|=|<|>|\\bin\\s*\\(|\\bbetween\\b|\\blike\\b)\\s*([^\\s)]*)`, 'gi');
  let m: RegExpExecArray | null;
  while ((m = re.exec(condition))) {
    const parts = m[1].split('.').map(p => p.replace(/`/g, ''));
    const column = parts[parts.length - 1];
    if (/^(and|or|not|null|true|false)$/i.test(column) || /^\d/.test(column)) continue;
    // Only the scanned table's own columns (not the other side of a join)
    if (table && parts.length > 1 && parts[parts.length - 2] !== table) continue;
    const op = m[2].toLowerCase().replace(/\s+/g, ' ');
    if (op === '<>' || op === '!=' || op === 'like') continue;
    // Column = other column (a join condition): the other table's index, not this one
    if (/^`|^[a-z_][\w$]*\.[`a-z_]/i.test(m[3])) continue;
    const list = op === '=' || op === '<=>' || op.startsWith('in') ? eq : range;
    if (!eq.includes(column) && !range.includes(column)) list.push(column);
  }
  return [...eq, ...range];
}
