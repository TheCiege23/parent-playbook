// An in-memory stand-in for the parts of the Supabase client the edge-function handlers use: from(table) with
// select (including {count, head}), insert, update, delete, eq, in, gte, is, not(column, 'is', null), order,
// limit and maybeSingle, awaited as a query, plus rpc(name, args). It records every write, and can be told to fail a given operation on
// a given table, so tests check what was written and what happens when a write fails. It is not a database:
// filters are simple comparisons, and it enforces no constraint.
function fakeSupabase(tables = {}, { errors = {}, rpcs = {} } = {}) {
  const log = [];
  const client = {
    log,
    tables,
    // rpc(name, args) answers with rpcs[name](args, tables), a stand-in for the database function that the test
    // supplies. Fail it with errors['rpc:' + name].
    rpc(name, args = {}) {
      const execute = () => {
        const failure = errors['rpc:' + name];
        if (failure) {
          log.push(['rpc failed', name]);
          return { data: null, error: failure };
        }
        if (typeof rpcs[name] !== 'function') throw new Error('fake-supabase has no stand-in for rpc ' + name);
        log.push(['rpc', name, { ...args }]);
        return { data: rpcs[name](args, tables), error: null };
      };
      return { then(resolve, reject) { try { resolve(execute()); } catch (error) { reject(error); } } };
    },
    from(table) {
      const state = { op: 'select', values: null, filters: [], single: false, options: null, order: null, limit: null };
      const rows = () => (tables[table] ||= []);
      const test = row => state.filters.every(([kind, column, value]) => {
        const cell = row[column] ?? null;
        if (kind === 'eq') return cell === value;
        if (kind === 'is') return cell === value;
        if (kind === 'notnull') return cell !== null;
        if (kind === 'in') return value.includes(cell);
        if (kind === 'gte') return cell !== null && cell >= value;
        return true;
      });
      const where = () => state.filters.map(([kind, column, value]) => column + ' ' + kind + ' ' + (Array.isArray(value) ? '[' + value.join(',') + ']' : value)).join(' & ');
      const execute = () => {
        const failure = errors[state.op + ':' + table];
        if (failure) {
          log.push([state.op + ' failed', table, where()]);
          return { data: null, error: failure };
        }
        if (state.op === 'select') {
          let found = rows().filter(test).map(row => ({ ...row }));
          if (state.order) {
            const [column, ascending] = state.order;
            found.sort((a, b) => (a[column] < b[column] ? -1 : a[column] > b[column] ? 1 : 0) * (ascending ? 1 : -1));
          }
          if (state.limit != null) found = found.slice(0, state.limit);
          if (state.options?.count) return { data: state.options.head ? null : found, count: found.length, error: null };
          return { data: state.single ? (found[0] ?? null) : found, error: null };
        }
        if (state.op === 'insert') {
          const list = Array.isArray(state.values) ? state.values : [state.values];
          for (const value of list) rows().push({ ...value });
          log.push(['insert', table, list.map(value => ({ ...value }))]);
          return { data: null, error: null };
        }
        if (state.op === 'delete') {
          const before = rows().length;
          tables[table] = rows().filter(row => !test(row));
          log.push(['delete', table, where(), before - tables[table].length]);
          return { data: null, error: null };
        }
        const hit = rows().filter(test);
        for (const row of hit) Object.assign(row, state.values);
        log.push(['update', table, { ...state.values }, where(), hit.length]);
        return { data: null, error: null };
      };
      const builder = {
        select(_columns, options) { if (options) state.options = options; return builder; },
        insert(values) { state.op = 'insert'; state.values = values; return builder; },
        update(values) { state.op = 'update'; state.values = values; return builder; },
        delete() { state.op = 'delete'; return builder; },
        eq(column, value) { state.filters.push(['eq', column, value]); return builder; },
        is(column, value) { state.filters.push(['is', column, value]); return builder; },
        in(column, values) { state.filters.push(['in', column, values]); return builder; },
        gte(column, value) { state.filters.push(['gte', column, value]); return builder; },
        not(column, operator, value) {
          if (operator !== 'is' || value !== null) throw new Error('fake-supabase supports only not(column, "is", null)');
          state.filters.push(['notnull', column, null]);
          return builder;
        },
        order(column, { ascending = true } = {}) { state.order = [column, ascending]; return builder; },
        limit(count) { state.limit = count; return builder; },
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

// A stand-in for npm:web-push. Endpoints named 'gone' fail with 410, 'expired' with 404, and 'broken' with 403.
function fakeWebPush() {
  const sent = [];
  const vapid = [];
  return {
    sent,
    vapid,
    setVapidDetails(subject, publicKey, privateKey) { vapid.push([subject, publicKey, privateKey]); },
    async sendNotification(subscription, payload) {
      const failure = { gone: 410, expired: 404, broken: 403 }[subscription.endpoint];
      if (failure) throw Object.assign(new Error('push failed'), { statusCode: failure, body: 'push service said ' + failure });
      sent.push({ endpoint: subscription.endpoint, keys: subscription.keys, payload: JSON.parse(payload) });
    },
  };
}

module.exports = { fakeSupabase, callerAs, callerWithTables, fakeWebPush };
