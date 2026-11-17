import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { indexStatement, mysqlFilterColumns, mysqlFullScans } from '../core/sql-plan';
import { batchAdvice, explain } from '../core/explain';
import { appLibraries, indexFindings, parseRunArgs, RunArgs } from '../run';
import { instrumentMysql2, observeSql, ObservedSql } from '../drivers';
import { instrumentModule, DRIVER_MODULES } from '../auto';
import { createTracePerf } from '../index';
import type { ExecutionRecord } from '../core/records';

describe('MySQL plans', () => {
  it('finds full scans with a condition in EXPLAIN FORMAT=JSON (MySQL and MariaDB shapes)', () => {
    const mysql = {
      query_block: {
        nested_loop: [
          { table: { table_name: 'customers', access_type: 'const', attached_condition: 'x' } },
          { table: { table_name: 'orders', access_type: 'ALL', rows_examined_per_scan: 20000, rows_produced_per_join: 2000, filtered: '10.00', attached_condition: "((`shop`.`orders`.`customer_id` = 7) and (`shop`.`orders`.`created_at` > '2024-01-01'))" } },
          { table: { table_name: 'notes', access_type: 'ALL', rows_examined_per_scan: 10 } },
        ],
      },
    };
    expect(mysqlFullScans(mysql)).toEqual([{ table: 'orders', filter: expect.any(String), rows: 2000, examined: 20000, columns: ['customer_id', 'created_at'] }]);
    const maria = { query_block: { table: { table_name: 'orders', access_type: 'ALL', rows: 5000, filtered: 1, attached_condition: 'orders.status = 3' } } };
    expect(mysqlFullScans(maria)).toEqual([{ table: 'orders', filter: 'orders.status = 3', rows: 50, examined: 5000, columns: ['status'] }]);
    const noFiltered = { query_block: { table: { table_name: 't', access_type: 'ALL', rows: 9, attached_condition: 't.a = 1' } } };
    expect(mysqlFullScans(noFiltered)[0].rows).toBe(9);
    expect(mysqlFullScans(null)).toEqual([]);
  });

  it('reads the scanned table\'s columns, equality first, and leaves out <>, LIKE and joins', () => {
    expect(mysqlFilterColumns("((`s`.`o`.`b` > 3) and (`s`.`o`.`a` = 'x') and (`s`.`o`.`c` <> 1) and (`s`.`o`.`d` like 'a%'))", 'o')).toEqual(['a', 'b']);
    expect(mysqlFilterColumns('(`s`.`o`.`customer_id` = `s`.`c`.`id`)', 'o')).toEqual([]);
    expect(mysqlFilterColumns('(`s`.`c`.`id` = 4)', 'o')).toEqual([]);
    expect(mysqlFilterColumns('(`s`.`o`.`id` in (1,2,3)) and o.total between 1 and 9 and (o.k <=> 1)', 'o')).toEqual(['id', 'k', 'total']);
    expect(mysqlFilterColumns('a = 1 and a = 2 and 1 = 1')).toEqual(['a']);
  });

  it('names MySQL indexes and quotes odd identifiers', () => {
    expect(indexStatement('orders', ['customer_id'], 'mysql')).toBe('CREATE INDEX idx_orders_customer_id ON orders (customer_id)');
    expect(indexStatement('shop.order items', ['a-b'], 'mysql')).toBe('CREATE INDEX idx_order_items_a_b ON shop.`order items` (`a-b`)');
  });

  it('reports a selective MySQL full scan (its 10% default guess included) with a named index', () => {
    const findings = indexFindings([{ driver: 'mysql', text: 'SELECT * FROM orders WHERE customer_id = ?', count: 40, scans: [{ table: 'orders', filter: 'c', rows: 2024, examined: 20244, columns: ['customer_id'], tableRows: 20000 }] }]);
    expect(findings).toHaveLength(1);
    expect(findings[0].message).toContain('to find the matching ones (full table scan');
    expect(findings[0].fix).toContain('CREATE INDEX idx_orders_customer_id ON orders (customer_id)');
    // Half the table: an index would not help
    expect(indexFindings([{ driver: 'mysql', text: 'q', count: 1, scans: [{ table: 'orders', filter: 'c', rows: 10000, examined: 20000, columns: ['status'], tableRows: 20000 }] }])).toEqual([]);
  });
});

describe('N+1 advice in the app\'s own ORM', () => {
  it.each([
    ['pg SELECT orders', ['sequelize', 'pg'], 'in Sequelize'],
    ['pg SELECT orders', ['typeorm'], 'in TypeORM'],
    ['mysql SELECT orders', ['@mikro-orm/core'], 'in MikroORM'],
    ['sqlite SELECT orders', ['drizzle-orm'], 'in Drizzle'],
    ['pg SELECT orders', ['objection', 'knex'], 'in Objection'],
    ['pg SELECT orders', ['kysely'], 'in Kysely'],
    ['pg SELECT orders', ['knex'], 'in Knex'],
    ['pg SELECT orders', ['bookshelf'], 'in Bookshelf'],
    ['pg SELECT orders', [], '= ANY($1)'],
    ['sqlite SELECT orders', [], 'WHERE id IN'],
    ['prisma.Order.findUnique', ['@prisma/client'], 'include'],
    ['mongo find users', ['mongoose'], 'populate()'],
    ['mongo find users', [], '$lookup'],
    ['redis GET', [], 'MGET'],
    ['http GET api/x', [], 'DataLoader'],
  ])('%s with %j', (label, libraries, expected) => {
    expect(batchAdvice(label, libraries)).toContain(expected);
  });

  it('explain uses the libraries it is given', () => {
    const root = { label: 'GET /o', duration: 50, children: Array.from({ length: 6 }, (_, i) => ({ label: 'pg SELECT items', start: i * 5, duration: 5, children: [] })) };
    const [f] = explain([root as any], { libraries: ['typeorm'] }).filter(x => x.kind === 'repeated');
    expect(f.fix).toContain('In(ids)');
  });
});

describe('run options for routes', () => {
  it('reads --routes and --param, and the same from the config file', () => {
    const a = parseRunArgs(['server.js', '--routes', '--param', 'id=1', '--param', ':slug=a=b']) as RunArgs;
    expect(a.routes).toBe(true);
    expect(a.params).toEqual({ id: '1', slug: 'a=b' });
    expect(parseRunArgs(['server.js', '--param', 'x'])).toMatch(/--param expects name=value/);
    const c = parseRunArgs([], () => JSON.stringify({ app: 'server.js', routes: true, params: { id: '9' } })) as RunArgs;
    expect(c.routes).toBe(true);
    expect(c.params).toEqual({ id: '9' });
  });

  it('reads the app\'s dependencies from the nearest package.json', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'traceperf-libs-'));
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ dependencies: { sequelize: '6' }, devDependencies: { jest: '29' } }));
    fs.mkdirSync(path.join(dir, 'src'));
    expect(appLibraries(fs, path, path.join(dir, 'src'))).toEqual(['sequelize', 'jest']);
    fs.writeFileSync(path.join(dir, 'src', 'package.json'), '{ not json');
    expect(appLibraries(fs, path, path.join(dir, 'src'))).toEqual(['sequelize', 'jest']);
    fs.rmSync(dir, { recursive: true, force: true });
    expect(appLibraries(fs, path, '/')).toEqual(expect.any(Array));
  });
});

describe('mysql2 (>= 3.10 class layout) and the SQL observer', () => {
  // mysql2 3.10+: query/execute live on BaseConnection, which PoolConnection extends without Connection
  function fakeMysql2() {
    class BaseConnection {
      sent: string[] = [];
      query(sql: any, values: any, cb?: any) { return this.send(sql, values, cb); }
      execute(sql: any, values: any, cb?: any) { return this.send(sql, values, cb); }
      send(sql: any, values: any, cb?: any) {
        const done = typeof values === 'function' ? values : cb;
        const text = typeof sql === 'string' ? sql : sql.sql;
        this.sent.push(text);
        setImmediate(() => (done ? done(null, text.includes('EXPLAIN') ? [{ EXPLAIN: '{}' }] : [{ n: 1 }]) : undefined));
        return { text };
      }
    }
    class Connection extends BaseConnection {}
    class PoolConnection extends BaseConnection {}
    class BasePool { getConnection(cb: any) { setImmediate(() => cb(null, new PoolConnection())); } }
    class Pool extends BasePool {}
    return { Connection, PoolConnection, Pool };
  }

  it('tracks pooled connections, shows statements to the observer and runs its EXPLAIN untracked', async () => {
    const mysql2 = fakeMysql2();
    const roots: ExecutionRecord[] = [];
    const tp = createTracePerf({ silent: true, trackMemory: false, onComplete: r => roots.push(r) });
    const uninstall = instrumentMysql2(tp, mysql2);
    const seen: ObservedSql[] = [];
    observeSql(q => seen.push(q));
    const conn = new mysql2.PoolConnection();
    try {
      await tp.track(async () => {
        await new Promise(r => conn.execute('SELECT * FROM orders WHERE id = ?', [1], r));
        await new Promise(r => conn.query({ sql: 'SELECT 2 FROM t' }, r));
      }, { label: 'job' });
      expect(roots[0].children.map(c => c.label)).toEqual(['mysql SELECT orders', 'mysql SELECT t']);
      expect(seen.map(q => [q.driver, q.text, q.values])).toEqual([['mysql', 'SELECT * FROM orders WHERE id = ?', [1]], ['mysql', 'SELECT 2 FROM t', undefined]]);
      const rows = await seen[0].run('EXPLAIN FORMAT=JSON SELECT 1', []);
      expect(rows).toEqual([{ EXPLAIN: '{}' }]);
      expect(conn.sent[2]).toBe('/* traceperf */ EXPLAIN FORMAT=JSON SELECT 1');
      expect(roots).toHaveLength(1);
      // a failing statement rejects
      (conn as any).query = function (_s: string, _v: unknown, cb: (e: Error) => void) { cb(new Error('no')); };
      await expect(seen[1].run('EXPLAIN x')).rejects.toThrow('no');
    } finally {
      observeSql(undefined);
      uninstall();
    }
  });
});

describe('instrumentModule', () => {
  it('knows the driver names, and ignores others', () => {
    const tp = createTracePerf({ silent: true });
    expect(DRIVER_MODULES).toContain('pg');
    expect(instrumentModule(tp, 'left-pad', {})).toBeUndefined();
    for (const name of DRIVER_MODULES) expect(() => { const u = instrumentModule(tp, name, {}); if (u) u(); }).not.toThrow();
  });
});
