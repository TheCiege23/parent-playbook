// An in-memory stand-in for the parts of the Supabase client the edge-function handlers use: from(table) with
// select, insert, update, eq, is, limit and maybeSingle, awaited as a query, and select(..., {count, head}) for
// counts. It records every write, and can be told to fail a given operation on a given table, so tests check
// what was written and what happens when a write fails. It is not a database: filters are equality only, and it
// enforces no constraint.
function fakeSupabase(tables = {}, { errors = {} } = {}) {
  const log = [];
  const client = {
    log,
    tables,
    from(table) {
      const state = { op: 'select', values: null, filters: [], single: false, options: null };
      const rows = () => (tables[table] ||= []);
      const matches = row => state.filters.every(([kind, column, value]) => kind === 'eq' ? row[column] === value : (row[column] ?? null) === value);
      const where = () => state.filters.map(([kind, column, value]) => column + (kind === 'is' ? ' is ' : '=') + value).join(' & ');
      const execute = () => {
        const failure = errors[state.op + ':' + table];
        if (failure) {
          log.push([state.op + ' failed', table, where()]);
          return { data: null, error: failure };
        }
        if (state.op === 'select') {
          const found = rows().filter(matches).map(row => ({ ...row }));
          if (state.options?.count) return { data: state.options.head ? null : found, count: found.length, error: null };
          return { data: state.single ? (found[0] ?? null) : found, error: null };
        }
        if (state.op === 'insert') {
          const list = Array.isArray(state.values) ? state.values : [state.values];
          for (const value of list) rows().push({ ...value });
          log.push(['insert', table, list.map(value => ({ ...value }))]);
          return { data: null, error: null };
        }
        const hit = rows().filter(matches);
        for (const row of hit) Object.assign(row, state.values);
        log.push(['update', table, { ...state.values }, where(), hit.length]);
        return { data: null, error: null };
      };
      const builder = {
        select(_columns, options) { if (options) state.options = options; return builder; },
        insert(values) { state.op = 'insert'; state.values = values; return builder; },
        update(values) { state.op = 'update'; state.values = values; return builder; },
        eq(column, value) { state.filters.push(['eq', column, value]); return builder; },
        is(column, value) { state.filters.push(['is', column, value]); return builder; },
        limit() { return builder; },
        maybeSingle() { state.single = true; return builder; },
        then(resolve, reject) { try { resolve(execute()); } catch (error) { reject(error); } },
      };
      return builder;
    },
  };
  return client;
}

const callerAs = user => () => ({ auth: { getUser: async () => ({ data: { user } }) } });

// A caller whose own queries run against `tables`, standing in for row-level security scoped to that user.
const callerWithTables = (user, tables = {}) => () => Object.assign(fakeSupabase(tables), { auth: { getUser: async () => ({ data: { user } }) } });

module.exports = { fakeSupabase, callerAs, callerWithTables };
