import { filterColumns, indexStatement, seqScans } from '../core/sql-plan';

describe('sql plans (real Postgres 16 EXPLAIN output)', () => {
  test('filter columns: equality first, then ranges; <> and LIKE left out', () => {
    expect(filterColumns('(customer_id = 5)')).toEqual(['customer_id']);
    expect(filterColumns('(customer_id = $1)')).toEqual(['customer_id']);
    expect(filterColumns("((customer_id <> 3) AND (status = 'paid'::text) AND (created_at > (now() - '1 day'::interval)))")).toEqual(['status', 'created_at']);
    expect(filterColumns("((status)::text = 'paid'::text)")).toEqual(['status']);
    expect(filterColumns('("userId" = $1)')).toEqual(['userId']);
    expect(filterColumns("(name ~~ '%x%'::text)")).toEqual([]);
    expect(filterColumns('(id = ANY ($1))')).toEqual(['id']);
  });

  test('every filtered seq scan in the plan tree', () => {
    const plan = [{ Plan: {
      'Node Type': 'Nested Loop', 'Plan Rows': 12,
      Plans: [
        { 'Node Type': 'Seq Scan', 'Relation Name': 'tp_plan_demo', Alias: 'p', 'Plan Rows': 1, Filter: '(id = 7)' },
        { 'Node Type': 'Seq Scan', 'Relation Name': 'tp_plan_demo', Alias: 'o', 'Plan Rows': 12, Filter: '(customer_id = 7)' },
        { 'Node Type': 'Seq Scan', 'Relation Name': 'everything' },
        { 'Node Type': 'Index Scan', 'Relation Name': 'users', Filter: '(x = 1)' },
      ],
    } }];
    expect(seqScans(plan)).toEqual([
      { table: 'tp_plan_demo', filter: '(id = 7)', rows: 1, columns: ['id'] },
      { table: 'tp_plan_demo', filter: '(customer_id = 7)', rows: 12, columns: ['customer_id'] },
    ]);
    expect(seqScans(undefined)).toEqual([]);
  });

  test('index statement quotes what needs quoting', () => {
    expect(indexStatement('orders', ['customer_id', 'created_at'])).toBe('CREATE INDEX ON orders (customer_id, created_at)');
    expect(indexStatement('public.Post', ['authorId'])).toBe('CREATE INDEX ON public."Post" ("authorId")');
  });
});
