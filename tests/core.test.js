// Run with: node --test tests/
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../js/core.js');

const ME = C.ME;
const TS = '2026-10-01T10:00:00.000Z';

function friend(id, name) {
  return { id, name, phone: null, notes: null, archived: false, createdAt: TS, updatedAt: TS };
}

function se(id, total, payer, shares, extra) {
  return {
    id,
    description: 'Dinner',
    totalAmount: total,
    date: '2026-10-10',
    payerPersonId: payer,
    participantShares: shares.map(([personId, share]) => ({ personId, share, input: null })),
    splitMethod: 'equal',
    categoryId: 'cat_food',
    groupId: null,
    linkedTransactionId: null,
    paymentMethod: 'UPI',
    notes: null,
    createdAt: TS,
    updatedAt: TS,
    ...extra,
  };
}

function baseState() {
  const s = C.emptyState();
  s.friends = [friend('fa', 'Asha'), friend('fb', 'Bilal')];
  return s;
}

test('parseAmount accepts Indian formats and rejects bad input', () => {
  assert.equal(C.parseAmount('1,23,456.50'), 12345650);
  assert.equal(C.parseAmount('₹ 99'), 9900);
  assert.equal(C.parseAmount('12.5'), 1250);
  assert.equal(C.parseAmount('.5'), 50);
  assert.equal(C.parseAmount('0'), 0);
  assert.equal(C.parseAmount('-5'), null);
  assert.equal(C.parseAmount('1.234'), null);
  assert.equal(C.parseAmount('abc'), null);
  assert.equal(C.parseAmount(''), null);
  assert.equal(C.parseAmount('1e5'), null);
});

test('formatINR uses Indian grouping', () => {
  assert.equal(C.formatINR(12345650), '₹1,23,456.50');
  assert.equal(C.formatINR(100000), '₹1,000');
  assert.equal(C.formatINR(-5000), '\u2212₹50');
  assert.equal(C.amountToDecimal(150005), '1500.05');
});

test('equal split always sums to total, remainder deterministic', () => {
  for (const total of [1, 2, 100, 1000, 99999, 300000, 1000001]) {
    for (let n = 1; n <= 7; n++) {
      const entries = Array.from({ length: n }, (_, i) => ({ personId: `p${i}` }));
      const r = C.computeSplit(total, 'equal', entries);
      assert.ok(r.ok);
      assert.equal(r.shares.reduce((a, b) => a + b.share, 0), total);
      const vals = r.shares.map((s) => s.share);
      assert.ok(Math.max(...vals) - Math.min(...vals) <= 1);
      // order of entries does not change who gets the extra paisa
      const r2 = C.computeSplit(total, 'equal', entries.slice().reverse());
      const m1 = Object.fromEntries(r.shares.map((s) => [s.personId, s.share]));
      const m2 = Object.fromEntries(r2.shares.map((s) => [s.personId, s.share]));
      assert.deepEqual(m1, m2);
    }
  }
  const r = C.computeSplit(10000, 'equal', [{ personId: 'b' }, { personId: 'a' }, { personId: ME }]);
  // 10000 / 3 = 3333 rem 1 -> goes to lowest id: "a"
  assert.deepEqual(r.shares.map((s) => [s.personId, s.share]), [['b', 3333], ['a', 3334], [ME, 3333]]);
});

test('fixed split must match total exactly', () => {
  assert.ok(C.computeSplit(1000, 'fixed', [{ personId: 'a', input: 600 }, { personId: 'b', input: 400 }]).ok);
  const under = C.computeSplit(1000, 'fixed', [{ personId: 'a', input: 600 }, { personId: 'b', input: 300 }]);
  assert.equal(under.ok, false);
  assert.equal(under.diff, 100);
  const over = C.computeSplit(1000, 'fixed', [{ personId: 'a', input: 600 }, { personId: 'b', input: 500 }]);
  assert.equal(over.ok, false);
  assert.equal(over.diff, -100);
});

test('percent split uses largest remainder and tolerates 0.01%', () => {
  const r = C.computeSplit(10000, 'percent', [
    { personId: 'a', input: 3333 },
    { personId: 'b', input: 3333 },
    { personId: 'c', input: 3334 },
  ]);
  assert.ok(r.ok);
  assert.equal(r.shares.reduce((a, b) => a + b.share, 0), 10000);
  const loose = C.computeSplit(10000, 'percent', [
    { personId: 'a', input: 3333 },
    { personId: 'b', input: 3333 },
    { personId: 'c', input: 3333 },
  ]);
  assert.ok(loose.ok, '99.99% is within tolerance');
  assert.equal(loose.shares.reduce((a, b) => a + b.share, 0), 10000);
  assert.equal(C.computeSplit(10000, 'percent', [{ personId: 'a', input: 5000 }, { personId: 'b', input: 4000 }]).ok, false);
  // randomized sum check
  for (let k = 0; k < 500; k++) {
    const total = 1 + Math.floor(Math.random() * 5000000);
    const a = Math.floor(Math.random() * 10001);
    const b = Math.floor(Math.random() * (10001 - a));
    const c = 10000 - a - b;
    const res = C.computeSplit(total, 'percent', [{ personId: 'x', input: a }, { personId: 'y', input: b }, { personId: 'z', input: c }]);
    assert.ok(res.ok);
    assert.equal(res.shares.reduce((s, v) => s + v.share, 0), total);
  }
});

test('PRD dinner example: personal spending counts only my share', () => {
  const s = baseState();
  const e = se('se1', 300000, ME, [[ME, 100000], ['fa', 100000], ['fb', 100000]]);
  s.sharedExpenses.push(e);
  const synced = C.syncLinkedTransactions(s);
  assert.equal(synced.transactions.length, 1);
  assert.equal(synced.transactions[0].classification, 'shared');
  assert.equal(synced.transactions[0].amount, 300000);
  const sum = C.summarize(synced, C.monthRange('2026-10'));
  assert.equal(sum.spending, 100000, 'personal spending is my ₹1,000 share');
  assert.equal(sum.sharedCashPaid, 300000);
  assert.equal(sum.paidForFriends, 200000);
  assert.equal(sum.income, 0, 'money owed to me is not income');
  const b = C.myBalances(synced);
  assert.equal(b.perFriend.get('fa'), 100000);
  assert.equal(b.perFriend.get('fb'), 100000);
  assert.equal(b.receivable, 200000);
  assert.equal(b.payable, 0);
  assert.deepEqual(C.validateState(synced), []);
});

test('friend pays: I owe my share and spend only my share', () => {
  const s = baseState();
  s.sharedExpenses.push(se('se1', 90000, 'fa', [[ME, 30000], ['fa', 30000], ['fb', 30000]]));
  const synced = C.syncLinkedTransactions(s);
  assert.equal(synced.transactions.length, 0, 'no cash left my pocket');
  assert.equal(C.summarize(synced, C.monthRange('2026-10')).spending, 30000);
  const b = C.myBalances(synced);
  assert.equal(b.perFriend.get('fa'), -30000);
  assert.equal(b.payable, 30000);
  assert.equal(b.perFriend.get('fb'), 0, 'Bilal owes Asha, not me');
  const l = C.buildLedger(synced.sharedExpenses, synced.settlements);
  assert.equal(l.between('fa', 'fb'), 30000);
});

test('settlements reduce balances and can be partial', () => {
  const s = baseState();
  s.sharedExpenses.push(se('se1', 300000, ME, [[ME, 100000], ['fa', 100000], ['fb', 100000]]));
  s.settlements.push({ id: 'st1', payerPersonId: 'fa', receiverPersonId: ME, amount: 100000, date: '2026-10-12', groupId: null, note: null, createdAt: TS, updatedAt: TS });
  s.settlements.push({ id: 'st2', payerPersonId: 'fb', receiverPersonId: ME, amount: 40000, date: '2026-10-12', groupId: null, note: null, createdAt: TS, updatedAt: TS });
  const b = C.myBalances(s);
  assert.equal(b.perFriend.get('fa'), 0);
  assert.equal(b.perFriend.get('fb'), 60000);
  assert.equal(b.receivable, 60000);
  const sum = C.summarize(C.syncLinkedTransactions(s), C.monthRange('2026-10'));
  assert.equal(sum.spending, 100000, 'settlements do not change spending');
  assert.equal(sum.income, 0, 'settlements are not income');
  assert.equal(sum.settlementsReceived, 140000);
});

test('payer not participating counts zero personal spending', () => {
  const s = baseState();
  s.sharedExpenses.push(se('se1', 50000, ME, [['fa', 25000], ['fb', 25000]]));
  const sum = C.summarize(C.syncLinkedTransactions(s), C.monthRange('2026-10'));
  assert.equal(sum.spending, 0);
  assert.equal(sum.sharedCashPaid, 50000);
  assert.equal(C.myBalances(s).receivable, 50000);
});

test('group nets and suggestions balance to zero', () => {
  const s = baseState();
  s.groups.push({ id: 'g1', name: 'Trip', memberFriendIds: ['fa', 'fb'], archived: false, createdAt: TS, updatedAt: TS });
  s.sharedExpenses.push(se('se1', 300000, ME, [[ME, 100000], ['fa', 100000], ['fb', 100000]], { groupId: 'g1' }));
  s.sharedExpenses.push(se('se2', 60000, 'fa', [[ME, 20000], ['fa', 20000], ['fb', 20000]], { groupId: 'g1' }));
  const nets = C.personNets(s.sharedExpenses, s.settlements, 'g1');
  assert.equal([...nets.values()].reduce((a, b) => a + b, 0), 0);
  const sug = C.suggestSettlements(nets);
  const after = new Map(nets);
  for (const x of sug) {
    after.set(x.from, after.get(x.from) + x.amount);
    after.set(x.to, after.get(x.to) - x.amount);
  }
  for (const v of after.values()) assert.equal(v, 0);
});

test('budget falls back to default', () => {
  const s = baseState();
  assert.equal(C.budgetFor(s, '2026-10'), null);
  s.settings.defaultBudget = 4000000;
  assert.equal(C.budgetFor(s, '2026-10').source, 'default');
  s.budgets.push({ id: C.budgetId('2026-10'), month: '2026-10', amount: 5000000, createdAt: TS, updatedAt: TS });
  assert.equal(C.budgetFor(s, '2026-10').amount, 5000000);
  assert.equal(C.budgetFor(s, '2026-11').amount, 4000000);
});

function richState() {
  const s = baseState();
  s.groups.push({ id: 'g1', name: 'Flat', memberFriendIds: ['fa', 'fb'], archived: false, createdAt: TS, updatedAt: TS });
  s.transactions.push({ id: 't1', type: 'income', amount: 8000000, currency: 'INR', categoryId: 'cat_salary', date: '2026-10-01', paymentMethod: 'Bank Transfer', description: 'Salary', classification: 'personal', sharedExpenseId: null, tags: [], createdAt: TS, updatedAt: TS });
  s.transactions.push({ id: 't2', type: 'expense', amount: 45050, currency: 'INR', categoryId: 'cat_groceries', date: '2026-10-03', paymentMethod: 'UPI', description: 'Veggies, "fresh"', classification: 'personal', sharedExpenseId: null, tags: ['home'], createdAt: TS, updatedAt: TS });
  s.sharedExpenses.push(se('se1', 300000, ME, [[ME, 100000], ['fa', 100000], ['fb', 100000]], { groupId: 'g1' }));
  s.settlements.push({ id: 'st1', payerPersonId: 'fa', receiverPersonId: ME, amount: 100000, date: '2026-10-12', groupId: 'g1', note: 'UPI', createdAt: TS, updatedAt: TS });
  s.budgets.push({ id: C.budgetId('2026-10'), month: '2026-10', amount: 5000000, createdAt: TS, updatedAt: TS });
  return C.syncLinkedTransactions(s);
}

test('backup round trip preserves everything', () => {
  const s = richState();
  const text = JSON.stringify(C.buildBackup(s));
  const parsed = C.parseBackup(text);
  assert.ok(parsed.ok, parsed.errors.join('\n'));
  for (const k of C.STORES) {
    const a = C.stableStringify(s[k].slice().sort((x, y) => C.cmp(x.id, y.id)));
    const b = C.stableStringify(parsed.state[k].slice().sort((x, y) => C.cmp(x.id, y.id)));
    assert.equal(a, b, k);
  }
  assert.deepEqual(C.myBalances(parsed.state).perFriend, C.myBalances(s).perFriend);
});

test('backup validation rejects bad data', () => {
  assert.equal(C.parseBackup('not json').ok, false);
  assert.equal(C.parseBackup('{"format":"other"}').ok, false);
  const s = richState();
  const b = C.buildBackup(s);
  b.data.sharedExpenses[0].participantShares[0].share += 1;
  assert.equal(C.parseBackup(JSON.stringify(b)).ok, false, 'shares not summing is rejected');
  const b2 = C.buildBackup(s);
  b2.data.transactions[1].amount = -5;
  assert.equal(C.parseBackup(JSON.stringify(b2)).ok, false, 'negative amount rejected');
  const b3 = C.buildBackup(s);
  b3.data.transactions[0].date = '2026-02-30';
  assert.equal(C.parseBackup(JSON.stringify(b3)).ok, false, 'invalid date rejected');
  const b4 = C.buildBackup(s);
  b4.data.settlements[0].payerPersonId = 'ghost';
  assert.equal(C.parseBackup(JSON.stringify(b4)).ok, false, 'unknown person rejected');
  const b5 = C.buildBackup(s);
  b5.schemaVersion = 99;
  assert.match(C.parseBackup(JSON.stringify(b5)).errors[0], /newer version/);
});

test('merge is idempotent and does not duplicate', () => {
  const s = richState();
  const parsed = C.parseBackup(JSON.stringify(C.buildBackup(s)));
  const m = C.planMerge(s, parsed.state);
  assert.ok(m.ok, m.errors.join('\n'));
  for (const k of C.STORES) assert.equal(m.state[k].length, s[k].length, k);
  for (const k of C.STORES) assert.equal(m.stats[k].added, 0);
  assert.deepEqual(C.myBalances(m.state).perFriend, C.myBalances(s).perFriend);
});

test('merge from another device adds records and maps same-named categories', () => {
  const phoneA = richState();
  const phoneB = baseState();
  phoneB.friends = [friend('fc', 'Chitra')];
  phoneB.categories.push({ id: 'cat_x_b', name: 'Pets', type: 'expense', isCustom: true, createdAt: TS, updatedAt: TS });
  phoneA.categories.push({ id: 'cat_x_a', name: 'pets', type: 'expense', isCustom: true, createdAt: TS, updatedAt: TS });
  phoneB.transactions.push({ id: 'tb1', type: 'expense', amount: 20000, currency: 'INR', categoryId: 'cat_x_b', date: '2026-10-05', paymentMethod: 'Cash', description: 'Dog food', classification: 'personal', sharedExpenseId: null, tags: [], createdAt: TS, updatedAt: TS });
  phoneB.sharedExpenses.push(se('seb', 40000, 'fc', [[ME, 20000], ['fc', 20000]]));
  const parsed = C.parseBackup(JSON.stringify(C.buildBackup(C.syncLinkedTransactions(phoneB))));
  assert.ok(parsed.ok, parsed.errors.join('\n'));
  const m = C.planMerge(phoneA, parsed.state);
  assert.ok(m.ok, m.errors.join('\n'));
  assert.equal(m.categoriesMatchedByName, 1);
  assert.equal(m.state.transactions.find((t) => t.id === 'tb1').categoryId, 'cat_x_a');
  assert.equal(m.state.friends.length, 3);
  assert.equal(C.myBalances(m.state).perFriend.get('fc'), -20000);
  // Merging the same file again changes nothing
  const again = C.planMerge(m.state, parsed.state);
  for (const k of C.STORES) assert.equal(again.state[k].length, m.state[k].length, k);
});

test('merge keeps the newer version of an edited record', () => {
  const s = richState();
  const newer = JSON.parse(JSON.stringify(s));
  const t = newer.transactions.find((x) => x.id === 't2');
  t.amount = 50000;
  t.updatedAt = '2026-10-20T00:00:00.000Z';
  const m = C.planMerge(s, newer);
  assert.ok(m.ok);
  assert.equal(m.state.transactions.find((x) => x.id === 't2').amount, 50000);
  assert.equal(m.stats.transactions.updated, 1);
  const older = C.planMerge(newer, s);
  assert.equal(older.state.transactions.find((x) => x.id === 't2').amount, 50000, 'older import does not overwrite');
});

test('linked transaction follows payer changes', () => {
  const s = baseState();
  s.sharedExpenses.push(se('se1', 300000, ME, [[ME, 150000], ['fa', 150000]]));
  let synced = C.syncLinkedTransactions(s);
  assert.equal(synced.transactions.length, 1);
  synced.sharedExpenses[0] = { ...synced.sharedExpenses[0], payerPersonId: 'fa' };
  synced = C.syncLinkedTransactions(synced);
  assert.equal(synced.transactions.length, 0);
  assert.equal(synced.sharedExpenses[0].linkedTransactionId, null);
});

test('csv escapes quotes and blocks formula injection', () => {
  const out = C.toCSV([['a', '=SUM(A1)', 'x,"y"', 12.5, '-cmd']]);
  assert.equal(out, '\uFEFFa,\'=SUM(A1),"x,""y""",12.5,\'-cmd\r\n');
});

test('date helpers', () => {
  assert.deepEqual(C.monthRange('2024-02'), { from: '2024-02-01', to: '2024-02-29' });
  assert.equal(C.addMonths('2026-01', -1), '2025-12');
  assert.equal(C.addMonths('2026-12', 1), '2027-01');
  assert.deepEqual(C.weekRange('2026-10-26'), { from: '2026-10-26', to: '2026-11-01' });
  assert.equal(C.isISODate('2026-02-29'), false);
  assert.equal(C.listMonths({ from: '2026-11-15', to: '2027-02-01' }).length, 4);
});
