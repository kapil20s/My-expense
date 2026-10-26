/*
 * MyExpense core logic.
 * Pure functions only: no DOM, no storage. Shared by the app and by the Node test suite.
 *
 * Money rule: every amount is an integer number of paise (1 rupee = 100 paise).
 * Floating point is used only for display formatting, never for arithmetic.
 */
(function (root) {
  'use strict';

  const ME = 'me'; // stable person id for the device owner
  const SCHEMA_VERSION = 1;
  const BACKUP_FORMAT = 'myexpense-backup';
  const MAX_PAISE = 100000000000; // Rs 100 crore, a sanity ceiling for a single amount
  const PERCENT_TOLERANCE_BP = 1; // percentages must total 100.00 within +/- 0.01
  const PAYMENT_METHODS = ['UPI', 'Cash', 'Debit Card', 'Credit Card', 'Bank Transfer', 'Other'];
  const SPLIT_METHODS = ['equal', 'fixed', 'percent'];
  const TXN_TYPES = ['expense', 'income'];
  const CLASSIFICATIONS = ['personal', 'shared'];
  const CATEGORY_TYPES = ['expense', 'income', 'both'];
  const OTHER_CATEGORY_ID = 'cat_other';
  const STORES = ['transactions', 'categories', 'budgets', 'friends', 'groups', 'sharedExpenses', 'settlements'];
  const LIMITS = { name: 80, description: 200, notes: 1000, tag: 30, tags: 20, phone: 30 };

  const DEFAULT_CATEGORIES = [
    ['cat_food', 'Food & Dining', 'expense'],
    ['cat_groceries', 'Groceries', 'expense'],
    ['cat_shopping', 'Shopping', 'expense'],
    ['cat_travel', 'Travel', 'expense'],
    ['cat_rent', 'Rent', 'expense'],
    ['cat_bills', 'Bills & Utilities', 'expense'],
    ['cat_entertainment', 'Entertainment', 'expense'],
    ['cat_medical', 'Medical', 'expense'],
    ['cat_salary', 'Salary/Income', 'income'],
    ['cat_other', 'Other', 'both'],
  ];

  const DEFAULT_SETTINGS = { defaultBudget: 0, warnThreshold: 80 };

  /* ------------------------------------------------------------------ ids */

  function uid(prefix) {
    const c = typeof globalThis !== 'undefined' ? globalThis.crypto : undefined;
    let id;
    if (c && typeof c.randomUUID === 'function') {
      id = c.randomUUID();
    } else {
      const bytes = new Uint8Array(16);
      if (c && c.getRandomValues) c.getRandomValues(bytes);
      else for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
      bytes[6] = (bytes[6] & 0x0f) | 0x40;
      bytes[8] = (bytes[8] & 0x3f) | 0x80;
      const h = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
      id = `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
    }
    return prefix ? `${prefix}_${id}` : id;
  }

  function nowISO() {
    return new Date().toISOString();
  }

  function cmp(a, b) {
    return a < b ? -1 : a > b ? 1 : 0;
  }

  function sum(arr) {
    let s = 0;
    for (const v of arr) s += v;
    return s;
  }

  /* ---------------------------------------------------------------- money */

  /** Parse user text such as "1,234.50", "₹ 99", "12.5" into paise. Returns null when invalid. */
  function parseAmount(input) {
    if (typeof input === 'number') {
      if (!Number.isFinite(input) || input < 0) return null;
      input = String(input);
    }
    if (typeof input !== 'string') return null;
    const s = input.trim().replace(/^rs\.?/i, '').replace(/[₹,\s]/g, '');
    if (!/^(\d+(\.\d{0,2})?|\.\d{1,2})$/.test(s)) return null;
    const [whole, frac = ''] = s.split('.');
    const paise = Number(whole || '0') * 100 + Number((frac + '00').slice(0, 2));
    if (!Number.isSafeInteger(paise) || paise > MAX_PAISE) return null;
    return paise;
  }

  /** Parse a percentage such as "33.33" into basis points (1% = 100 bp). Returns null when invalid. */
  function parsePercent(input) {
    if (typeof input === 'number') input = String(input);
    if (typeof input !== 'string') return null;
    const s = input.trim().replace(/%$/, '').trim();
    if (!/^(\d{1,3}(\.\d{0,2})?|\.\d{1,2})$/.test(s)) return null;
    const [whole, frac = ''] = s.split('.');
    const bp = Number(whole || '0') * 100 + Number((frac + '00').slice(0, 2));
    if (bp > 10000) return null;
    return bp;
  }

  let fmt0 = null;
  let fmt2 = null;
  function formatters() {
    if (!fmt0) {
      fmt0 = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 0, maximumFractionDigits: 0 });
      fmt2 = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }
    return [fmt0, fmt2];
  }

  /** Format paise as Indian rupees: ₹1,23,456 or ₹1,23,456.50 */
  function formatINR(paise, opts) {
    const o = opts || {};
    const [f0, f2] = formatters();
    const neg = paise < 0;
    const abs = Math.abs(paise);
    let s = (o.always2 || abs % 100 !== 0 ? f2 : f0).format(abs / 100);
    if (neg) s = '\u2212' + s;
    else if (o.signed && abs > 0) s = '+' + s;
    return s;
  }

  /** Short form for chart axes: ₹950, ₹12.5K, ₹3.2L, ₹1.1Cr */
  function formatINRCompact(paise) {
    const r = Math.abs(paise) / 100;
    const sign = paise < 0 ? '\u2212' : '';
    const trim = (n) => (Math.round(n * 10) / 10).toString();
    if (r >= 1e7) return `${sign}₹${trim(r / 1e7)}Cr`;
    if (r >= 1e5) return `${sign}₹${trim(r / 1e5)}L`;
    if (r >= 1e3) return `${sign}₹${trim(r / 1e3)}K`;
    return `${sign}₹${Math.round(r)}`;
  }

  /** Paise to a plain editable string: 150000 -> "1500", 150050 -> "1500.50" */
  function amountToInput(paise) {
    if (!Number.isSafeInteger(paise)) return '';
    const whole = Math.trunc(paise / 100);
    const frac = Math.abs(paise % 100);
    return frac ? `${whole}.${String(frac).padStart(2, '0')}` : String(whole);
  }

  /** Paise to a CSV-friendly decimal string: 150050 -> "1500.50" */
  function amountToDecimal(paise) {
    const neg = paise < 0;
    const abs = Math.abs(paise);
    return `${neg ? '-' : ''}${Math.trunc(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
  }

  function percentToInput(bp) {
    if (!Number.isSafeInteger(bp)) return '';
    const whole = Math.trunc(bp / 100);
    const frac = bp % 100;
    return frac ? `${whole}.${String(frac).padStart(2, '0').replace(/0$/, '')}` : String(whole);
  }

  /* ---------------------------------------------------------------- dates */

  const pad = (n) => String(n).padStart(2, '0');

  function toISODate(d) {
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }

  function todayISO() {
    return toISODate(new Date());
  }

  function isISODate(s) {
    if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
    const [y, m, d] = s.split('-').map(Number);
    if (y < 1900 || y > 2200) return false;
    const dt = new Date(y, m - 1, d);
    return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d;
  }

  function isMonthKey(s) {
    return typeof s === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(s);
  }

  function parseISO(s) {
    const [y, m, d] = s.split('-').map(Number);
    return new Date(y, m - 1, d);
  }

  function monthOf(iso) {
    return iso.slice(0, 7);
  }

  function addDays(iso, n) {
    const d = parseISO(iso);
    d.setDate(d.getDate() + n);
    return toISODate(d);
  }

  function addMonths(monthKey, n) {
    let [y, m] = monthKey.split('-').map(Number);
    m += n;
    y += Math.floor((m - 1) / 12);
    m = (((m - 1) % 12) + 12) % 12 + 1;
    return `${y}-${pad(m)}`;
  }

  function monthRange(monthKey) {
    const [y, m] = monthKey.split('-').map(Number);
    const last = new Date(y, m, 0).getDate();
    return { from: `${monthKey}-01`, to: `${monthKey}-${pad(last)}` };
  }

  /** Monday to Sunday week containing iso. */
  function weekRange(iso) {
    const dow = (parseISO(iso).getDay() + 6) % 7;
    const from = addDays(iso, -dow);
    return { from, to: addDays(from, 6) };
  }

  function yearRange(year) {
    return { from: `${year}-01-01`, to: `${year}-12-31` };
  }

  function daysBetween(a, b) {
    return Math.round((parseISO(b) - parseISO(a)) / 86400000);
  }

  function inRange(iso, r) {
    return (!r || !r.from || iso >= r.from) && (!r || !r.to || iso <= r.to);
  }

  function listDays(r) {
    const out = [];
    let d = r.from;
    let guard = 0;
    while (d <= r.to && guard++ < 4000) {
      out.push(d);
      d = addDays(d, 1);
    }
    return out;
  }

  function listMonths(r) {
    const out = [];
    let m = monthOf(r.from);
    const end = monthOf(r.to);
    let guard = 0;
    while (m <= end && guard++ < 600) {
      out.push(m);
      m = addMonths(m, 1);
    }
    return out;
  }

  /* ---------------------------------------------------------------- split */

  /**
   * Compute exact per-person shares in paise.
   * entries: [{ personId, input }] where input is paise (fixed) or basis points (percent); ignored for equal.
   * Rounding: shares always add up exactly to total. Leftover paise are assigned
   *   equal   -> one paisa each to participants in ascending personId order
   *   percent -> largest-remainder method, ties broken by ascending personId
   */
  function computeSplit(total, method, entries) {
    if (!Number.isSafeInteger(total) || total <= 0) return { ok: false, error: 'Enter a total amount greater than zero.' };
    if (total > MAX_PAISE) return { ok: false, error: 'The total amount is too large.' };
    if (!Array.isArray(entries) || entries.length === 0) return { ok: false, error: 'Choose at least one person to split with.' };
    const ids = entries.map((e) => e.personId);
    if (ids.some((id) => typeof id !== 'string' || !id)) return { ok: false, error: 'Every share needs a person.' };
    if (new Set(ids).size !== ids.length) return { ok: false, error: 'A person appears twice in this split.' };
    const order = entries.map((_, i) => i).sort((a, b) => cmp(entries[a].personId, entries[b].personId));
    let shares;

    if (method === 'equal') {
      const n = entries.length;
      const base = Math.floor(total / n);
      let rem = total - base * n;
      shares = entries.map(() => base);
      for (const i of order) {
        if (rem <= 0) break;
        shares[i] += 1;
        rem -= 1;
      }
    } else if (method === 'fixed') {
      for (const e of entries) {
        if (!Number.isSafeInteger(e.input) || e.input < 0) return { ok: false, error: 'Enter a valid amount for every person.' };
      }
      const s = sum(entries.map((e) => e.input));
      if (s !== total) {
        const diff = total - s;
        return {
          ok: false,
          diff,
          error: diff > 0 ? `${formatINR(diff)} still to assign.` : `Shares are ${formatINR(-diff)} more than the total.`,
        };
      }
      shares = entries.map((e) => e.input);
    } else if (method === 'percent') {
      for (const e of entries) {
        if (!Number.isSafeInteger(e.input) || e.input < 0 || e.input > 10000) return { ok: false, error: 'Enter a valid percentage for every person.' };
      }
      const sumBp = sum(entries.map((e) => e.input));
      if (Math.abs(sumBp - 10000) > PERCENT_TOLERANCE_BP) {
        return { ok: false, diffBp: 10000 - sumBp, error: `Percentages add up to ${percentToInput(sumBp)}%. They need to total 100%.` };
      }
      const raw = entries.map((e) => total * e.input); // <= 1e11 * 1e4, inside safe integer range
      shares = raw.map((r) => Math.floor(r / sumBp));
      const remainders = raw.map((r, i) => r - shares[i] * sumBp);
      let left = total - sum(shares);
      const byRemainder = entries
        .map((_, i) => i)
        .sort((a, b) => remainders[b] - remainders[a] || cmp(entries[a].personId, entries[b].personId));
      for (const i of byRemainder) {
        if (left <= 0) break;
        shares[i] += 1;
        left -= 1;
      }
    } else {
      return { ok: false, error: 'Choose a split method.' };
    }

    return {
      ok: true,
      shares: entries.map((e, i) => ({ personId: e.personId, share: shares[i], input: method === 'equal' ? null : e.input })),
    };
  }

  /* --------------------------------------------------------------- ledger */

  /**
   * Pairwise ledger built from shared expenses and settlements.
   * owe[debtor][creditor] accumulates gross amounts; between(a, b) nets them.
   * A shared expense makes every participant owe the payer their share.
   * A settlement of X paying Y is booked as Y owing X the same amount, which cancels X's debt.
   */
  function buildLedger(sharedExpenses, settlements, filter) {
    const f = filter || {};
    const owe = new Map();
    const add = (debtor, creditor, amt) => {
      if (debtor === creditor || !amt) return;
      let m = owe.get(debtor);
      if (!m) owe.set(debtor, (m = new Map()));
      m.set(creditor, (m.get(creditor) || 0) + amt);
    };
    for (const se of sharedExpenses) {
      if (f.groupId && se.groupId !== f.groupId) continue;
      for (const ps of se.participantShares) add(ps.personId, se.payerPersonId, ps.share);
    }
    for (const st of settlements) {
      if (f.groupId && st.groupId !== f.groupId) continue;
      add(st.receiverPersonId, st.payerPersonId, st.amount);
    }
    const get = (d, c) => (owe.get(d) && owe.get(d).get(c)) || 0;
    return {
      /** How much b owes a, net. Negative means a owes b. */
      between(a, b) {
        return get(b, a) - get(a, b);
      },
      people() {
        const s = new Set();
        for (const [d, m] of owe) {
          s.add(d);
          for (const c of m.keys()) s.add(c);
        }
        return s;
      },
    };
  }

  /** Balances between the device owner and each friend, across all groups. */
  function myBalances(state) {
    const ledger = buildLedger(state.sharedExpenses, state.settlements);
    const perFriend = new Map();
    let receivable = 0;
    let payable = 0;
    const ids = new Set(state.friends.map((f) => f.id));
    for (const p of ledger.people()) if (p !== ME) ids.add(p);
    for (const id of ids) {
      const net = ledger.between(ME, id); // positive: friend owes me
      perFriend.set(id, net);
      if (net > 0) receivable += net;
      else payable -= net;
    }
    return { perFriend, receivable, payable, net: receivable - payable };
  }

  /** Net position of each person inside one group. Positive: the group owes them. */
  function personNets(sharedExpenses, settlements, groupId) {
    const nets = new Map();
    const bump = (p, a) => nets.set(p, (nets.get(p) || 0) + a);
    for (const se of sharedExpenses) {
      if (groupId && se.groupId !== groupId) continue;
      bump(se.payerPersonId, se.totalAmount);
      for (const ps of se.participantShares) bump(ps.personId, -ps.share);
    }
    for (const st of settlements) {
      if (groupId && st.groupId !== groupId) continue;
      bump(st.payerPersonId, st.amount);
      bump(st.receiverPersonId, -st.amount);
    }
    return nets;
  }

  /** Greedy minimal-transfer suggestion. Suggestions only; nothing is recorded automatically. */
  function suggestSettlements(nets) {
    const creditors = [];
    const debtors = [];
    for (const [p, v] of nets) {
      if (v > 0) creditors.push({ p, v });
      else if (v < 0) debtors.push({ p, v: -v });
    }
    const order = (a, b) => b.v - a.v || cmp(a.p, b.p);
    creditors.sort(order);
    debtors.sort(order);
    const out = [];
    let i = 0;
    let j = 0;
    while (i < debtors.length && j < creditors.length) {
      const amt = Math.min(debtors[i].v, creditors[j].v);
      if (amt > 0) out.push({ from: debtors[i].p, to: creditors[j].p, amount: amt });
      debtors[i].v -= amt;
      creditors[j].v -= amt;
      if (debtors[i].v === 0) i++;
      if (creditors[j].v === 0) j++;
    }
    return out;
  }

  /* ------------------------------------------------------------- spending */

  function myShare(se) {
    const p = se.participantShares.find((x) => x.personId === ME);
    return p ? p.share : 0;
  }

  /** Effect of a shared expense on the balance between me and friendId. Positive: friend owes me more. */
  function effectOnFriend(se, friendId) {
    let d = 0;
    for (const ps of se.participantShares) {
      if (se.payerPersonId === ME && ps.personId === friendId) d += ps.share;
      if (se.payerPersonId === friendId && ps.personId === ME) d -= ps.share;
    }
    return d;
  }

  /**
   * Personal spending items. Counted:
   *   - expense transactions classified "personal"
   *   - my own share of every shared expense, whoever paid
   * Not counted: shared transactions (cash I paid for a split bill), settlements, money owed to me.
   */
  function spendItems(state, range, categoryId) {
    const items = [];
    for (const t of state.transactions) {
      if (t.type !== 'expense' || t.classification !== 'personal' || !inRange(t.date, range)) continue;
      if (categoryId && t.categoryId !== categoryId) continue;
      items.push({ date: t.date, amount: t.amount, categoryId: t.categoryId, kind: 'personal', ref: t.id });
    }
    for (const se of state.sharedExpenses) {
      if (!inRange(se.date, range)) continue;
      const cat = se.categoryId || OTHER_CATEGORY_ID;
      if (categoryId && cat !== categoryId) continue;
      const share = myShare(se);
      if (share > 0) items.push({ date: se.date, amount: share, categoryId: cat, kind: 'share', ref: se.id });
    }
    return items;
  }

  function summarize(state, range, categoryId) {
    const spend = spendItems(state, range, categoryId);
    const byCategory = new Map();
    const byDay = new Map();
    const byMonth = new Map();
    for (const it of spend) {
      byCategory.set(it.categoryId, (byCategory.get(it.categoryId) || 0) + it.amount);
      byDay.set(it.date, (byDay.get(it.date) || 0) + it.amount);
      const m = monthOf(it.date);
      byMonth.set(m, (byMonth.get(m) || 0) + it.amount);
    }
    let income = 0;
    const incomeByMonth = new Map();
    const incomeByDay = new Map();
    for (const t of state.transactions) {
      if (t.type !== 'income' || !inRange(t.date, range)) continue;
      if (categoryId && t.categoryId !== categoryId) continue;
      income += t.amount;
      const m = monthOf(t.date);
      incomeByMonth.set(m, (incomeByMonth.get(m) || 0) + t.amount);
      incomeByDay.set(t.date, (incomeByDay.get(t.date) || 0) + t.amount);
    }
    let sharedCashPaid = 0;
    let paidForFriends = 0;
    for (const se of state.sharedExpenses) {
      if (se.payerPersonId !== ME || !inRange(se.date, range)) continue;
      if (categoryId && (se.categoryId || OTHER_CATEGORY_ID) !== categoryId) continue;
      sharedCashPaid += se.totalAmount;
      paidForFriends += se.totalAmount - myShare(se);
    }
    let settlementsReceived = 0;
    let settlementsPaid = 0;
    for (const st of state.settlements) {
      if (!inRange(st.date, range)) continue;
      if (st.receiverPersonId === ME) settlementsReceived += st.amount;
      if (st.payerPersonId === ME) settlementsPaid += st.amount;
    }
    return {
      spending: sum(spend.map((i) => i.amount)),
      spendCount: spend.length,
      income,
      byCategory,
      byDay,
      byMonth,
      incomeByMonth,
      incomeByDay,
      sharedCashPaid,
      paidForFriends,
      settlementsReceived,
      settlementsPaid,
    };
  }

  function budgetFor(state, monthKey) {
    const b = state.budgets.find((x) => x.month === monthKey);
    if (b) return { amount: b.amount, source: 'month', record: b };
    const d = state.settings && state.settings.defaultBudget;
    if (Number.isSafeInteger(d) && d > 0) return { amount: d, source: 'default', record: null };
    return null;
  }

  function budgetId(monthKey) {
    return `budget_${monthKey}`;
  }

  /* -------------------------------------------------- linked transactions */

  /** The cash transaction that mirrors a shared expense I paid for. Derived entirely from the shared expense. */
  function deriveLinkedTransaction(se, existing, now) {
    if (se.payerPersonId !== ME) return null;
    const ts = now || nowISO();
    return {
      id: existing ? existing.id : se.linkedTransactionId || uid('txn'),
      type: 'expense',
      amount: se.totalAmount,
      currency: 'INR',
      categoryId: se.categoryId || OTHER_CATEGORY_ID,
      date: se.date,
      paymentMethod: PAYMENT_METHODS.includes(se.paymentMethod) ? se.paymentMethod : 'Other',
      description: se.description,
      classification: 'shared',
      sharedExpenseId: se.id,
      tags: existing && Array.isArray(existing.tags) ? existing.tags : [],
      createdAt: existing ? existing.createdAt : ts,
      updatedAt: ts,
    };
  }

  /**
   * Rebuild every shared-classified transaction from its shared expense so derived values cannot drift.
   * Returns a new state; records that did not change keep their updatedAt.
   */
  function syncLinkedTransactions(state) {
    const now = nowISO();
    const txById = new Map(state.transactions.map((t) => [t.id, t]));
    const keepTx = state.transactions.filter((t) => t.classification !== 'shared');
    const linked = [];
    const ses = state.sharedExpenses.map((se) => {
      const existing = (se.linkedTransactionId && txById.get(se.linkedTransactionId)) ||
        state.transactions.find((t) => t.classification === 'shared' && t.sharedExpenseId === se.id) || null;
      const derived = deriveLinkedTransaction(se, existing, now);
      if (!derived) return se.linkedTransactionId ? { ...se, linkedTransactionId: null } : se;
      if (existing && stableStringify({ ...existing, updatedAt: 0 }) === stableStringify({ ...derived, updatedAt: 0 })) linked.push(existing);
      else linked.push(derived);
      return se.linkedTransactionId === derived.id ? se : { ...se, linkedTransactionId: derived.id };
    });
    return { ...state, transactions: keepTx.concat(linked), sharedExpenses: ses };
  }

  /* ----------------------------------------------------------- validation */

  const isStr = (v) => typeof v === 'string';
  const isTs = (v) => isStr(v) && !Number.isNaN(Date.parse(v));
  const isAmount = (v) => Number.isSafeInteger(v) && v > 0 && v <= MAX_PAISE;
  const isId = (v) => isStr(v) && v.length > 0 && v.length <= 100;
  const short = (id) => (isStr(id) ? id.slice(-8) : String(id));

  function checkCommon(r, errs, label) {
    if (!isId(r.id)) errs.push(`${label}: missing or invalid id.`);
    if (!isTs(r.createdAt)) errs.push(`${label}: invalid createdAt.`);
    if (!isTs(r.updatedAt)) errs.push(`${label}: invalid updatedAt.`);
  }

  function validateTransaction(t, ctx) {
    const e = [];
    const L = `Transaction ${short(t.id)}`;
    checkCommon(t, e, L);
    if (!TXN_TYPES.includes(t.type)) e.push(`${L}: type must be expense or income.`);
    if (!isAmount(t.amount)) e.push(`${L}: amount must be a positive whole number of paise.`);
    if (t.currency !== 'INR') e.push(`${L}: only INR is supported.`);
    if (!isISODate(t.date)) e.push(`${L}: invalid date.`);
    if (!PAYMENT_METHODS.includes(t.paymentMethod)) e.push(`${L}: unknown payment method.`);
    if (!CLASSIFICATIONS.includes(t.classification)) e.push(`${L}: classification must be personal or shared.`);
    if (!isStr(t.description) || t.description.length > LIMITS.description) e.push(`${L}: description is missing or too long.`);
    if (!Array.isArray(t.tags) || t.tags.length > LIMITS.tags || t.tags.some((g) => !isStr(g) || !g || g.length > LIMITS.tag)) e.push(`${L}: invalid tags.`);
    if (ctx && !ctx.categoryIds.has(t.categoryId)) e.push(`${L}: category does not exist.`);
    if (t.classification === 'shared') {
      if (t.type !== 'expense') e.push(`${L}: only expenses can be shared.`);
      if (!isId(t.sharedExpenseId)) e.push(`${L}: shared transaction is not linked to a split.`);
      else if (ctx && !ctx.sharedExpenseIds.has(t.sharedExpenseId)) e.push(`${L}: linked split does not exist.`);
    } else if (t.sharedExpenseId != null) {
      e.push(`${L}: personal transaction cannot link to a split.`);
    }
    return e;
  }

  function validateCategory(c) {
    const e = [];
    const L = `Category ${short(c.id)}`;
    checkCommon(c, e, L);
    if (!isStr(c.name) || !c.name.trim() || c.name.length > LIMITS.name) e.push(`${L}: name is missing or too long.`);
    if (!CATEGORY_TYPES.includes(c.type)) e.push(`${L}: type must be expense, income or both.`);
    if (typeof c.isCustom !== 'boolean') e.push(`${L}: isCustom must be true or false.`);
    return e;
  }

  function validateBudget(b) {
    const e = [];
    const L = `Budget ${isStr(b.month) ? b.month : short(b.id)}`;
    checkCommon(b, e, L);
    if (!isMonthKey(b.month)) e.push(`${L}: month must look like YYYY-MM.`);
    if (!isAmount(b.amount)) e.push(`${L}: amount must be positive.`);
    return e;
  }

  function validateFriend(f) {
    const e = [];
    const L = `Friend ${short(f.id)}`;
    checkCommon(f, e, L);
    if (f.id === ME) e.push(`${L}: id "me" is reserved.`);
    if (!isStr(f.name) || !f.name.trim() || f.name.length > LIMITS.name) e.push(`${L}: name is missing or too long.`);
    if (f.phone != null && (!isStr(f.phone) || f.phone.length > LIMITS.phone)) e.push(`${L}: invalid phone.`);
    if (f.notes != null && (!isStr(f.notes) || f.notes.length > LIMITS.notes)) e.push(`${L}: notes too long.`);
    if (typeof f.archived !== 'boolean') e.push(`${L}: archived must be true or false.`);
    return e;
  }

  function validateGroup(g, ctx) {
    const e = [];
    const L = `Group ${short(g.id)}`;
    checkCommon(g, e, L);
    if (!isStr(g.name) || !g.name.trim() || g.name.length > LIMITS.name) e.push(`${L}: name is missing or too long.`);
    if (!Array.isArray(g.memberFriendIds)) e.push(`${L}: members must be a list.`);
    else {
      if (new Set(g.memberFriendIds).size !== g.memberFriendIds.length) e.push(`${L}: duplicate member.`);
      if (ctx && g.memberFriendIds.some((id) => !ctx.friendIds.has(id))) e.push(`${L}: a member does not exist.`);
    }
    if (typeof g.archived !== 'boolean') e.push(`${L}: archived must be true or false.`);
    return e;
  }

  function validateSharedExpense(se, ctx) {
    const e = [];
    const L = `Split ${short(se.id)}`;
    checkCommon(se, e, L);
    if (!isStr(se.description) || !se.description.trim() || se.description.length > LIMITS.description) e.push(`${L}: description is missing or too long.`);
    if (!isAmount(se.totalAmount)) e.push(`${L}: total must be positive.`);
    if (!isISODate(se.date)) e.push(`${L}: invalid date.`);
    if (!SPLIT_METHODS.includes(se.splitMethod)) e.push(`${L}: unknown split method.`);
    if (ctx && !ctx.personIds.has(se.payerPersonId)) e.push(`${L}: payer does not exist.`);
    if (!Array.isArray(se.participantShares) || se.participantShares.length === 0) e.push(`${L}: needs at least one participant.`);
    else {
      const ids = se.participantShares.map((p) => p.personId);
      if (new Set(ids).size !== ids.length) e.push(`${L}: duplicate participant.`);
      if (se.participantShares.some((p) => !Number.isSafeInteger(p.share) || p.share < 0)) e.push(`${L}: shares must be whole paise and not negative.`);
      else if (Number.isSafeInteger(se.totalAmount) && sum(se.participantShares.map((p) => p.share)) !== se.totalAmount) e.push(`${L}: shares do not add up to the total.`);
      if (ctx && ids.some((id) => !ctx.personIds.has(id))) e.push(`${L}: a participant does not exist.`);
    }
    if (se.categoryId != null && ctx && !ctx.categoryIds.has(se.categoryId)) e.push(`${L}: category does not exist.`);
    if (se.groupId != null && ctx && !ctx.groupIds.has(se.groupId)) e.push(`${L}: group does not exist.`);
    if (se.paymentMethod != null && !PAYMENT_METHODS.includes(se.paymentMethod)) e.push(`${L}: unknown payment method.`);
    if (se.notes != null && (!isStr(se.notes) || se.notes.length > LIMITS.notes)) e.push(`${L}: notes too long.`);
    return e;
  }

  function validateSettlement(st, ctx) {
    const e = [];
    const L = `Payment ${short(st.id)}`;
    checkCommon(st, e, L);
    if (!isAmount(st.amount)) e.push(`${L}: amount must be positive.`);
    if (!isISODate(st.date)) e.push(`${L}: invalid date.`);
    if (st.payerPersonId === st.receiverPersonId) e.push(`${L}: payer and receiver must be different people.`);
    if (ctx && (!ctx.personIds.has(st.payerPersonId) || !ctx.personIds.has(st.receiverPersonId))) e.push(`${L}: a person does not exist.`);
    if (st.groupId != null && ctx && !ctx.groupIds.has(st.groupId)) e.push(`${L}: group does not exist.`);
    if (st.note != null && (!isStr(st.note) || st.note.length > LIMITS.notes)) e.push(`${L}: note too long.`);
    return e;
  }

  function buildContext(state) {
    const friendIds = new Set(state.friends.map((f) => f.id));
    return {
      friendIds,
      personIds: new Set([ME, ...friendIds]),
      categoryIds: new Set(state.categories.map((c) => c.id)),
      groupIds: new Set(state.groups.map((g) => g.id)),
      sharedExpenseIds: new Set(state.sharedExpenses.map((s) => s.id)),
    };
  }

  /** Validate a whole dataset, including references between records. Returns a list of error strings. */
  function validateState(state) {
    const errs = [];
    for (const s of STORES) {
      if (!Array.isArray(state[s])) {
        errs.push(`Missing list: ${s}.`);
        continue;
      }
      const seen = new Set();
      for (const r of state[s]) {
        if (!r || typeof r !== 'object') {
          errs.push(`${s}: a record is not an object.`);
          continue;
        }
        if (seen.has(r.id)) errs.push(`${s}: duplicate id ${short(r.id)}.`);
        seen.add(r.id);
      }
    }
    if (errs.length) return errs;
    const ctx = buildContext(state);
    state.categories.forEach((c) => errs.push(...validateCategory(c)));
    state.budgets.forEach((b) => errs.push(...validateBudget(b)));
    state.friends.forEach((f) => errs.push(...validateFriend(f)));
    state.groups.forEach((g) => errs.push(...validateGroup(g, ctx)));
    state.transactions.forEach((t) => errs.push(...validateTransaction(t, ctx)));
    state.sharedExpenses.forEach((se) => errs.push(...validateSharedExpense(se, ctx)));
    state.settlements.forEach((st) => errs.push(...validateSettlement(st, ctx)));
    if (!ctx.categoryIds.has(OTHER_CATEGORY_ID)) errs.push('The built-in "Other" category is missing.');
    const names = new Set();
    for (const c of state.categories) {
      const k = isStr(c.name) ? c.name.trim().toLowerCase() : '';
      if (names.has(k)) errs.push(`Two categories are both named "${c.name}".`);
      names.add(k);
    }
    const months = new Set();
    for (const b of state.budgets) {
      if (months.has(b.month)) errs.push(`Two budgets exist for ${b.month}.`);
      months.add(b.month);
    }
    const txById = new Map(state.transactions.map((t) => [t.id, t]));
    for (const se of state.sharedExpenses) {
      if (se.linkedTransactionId != null) {
        const t = txById.get(se.linkedTransactionId);
        if (!t || t.sharedExpenseId !== se.id) errs.push(`Split ${short(se.id)}: linked transaction is missing.`);
      }
    }
    if (state.settings) {
      const st = state.settings;
      if (!Number.isSafeInteger(st.defaultBudget) || st.defaultBudget < 0 || st.defaultBudget > MAX_PAISE) errs.push('Settings: default budget is invalid.');
      if (!Number.isSafeInteger(st.warnThreshold) || st.warnThreshold < 1 || st.warnThreshold > 100) errs.push('Settings: warning threshold must be 1 to 100.');
    }
    return errs;
  }

  /* --------------------------------------------------------------- seeding */

  function defaultCategories(now) {
    const ts = now || nowISO();
    return DEFAULT_CATEGORIES.map(([id, name, type]) => ({ id, name, type, isCustom: false, createdAt: ts, updatedAt: ts }));
  }

  function emptyState() {
    return {
      transactions: [],
      categories: defaultCategories(),
      budgets: [],
      friends: [],
      groups: [],
      sharedExpenses: [],
      settlements: [],
      settings: { ...DEFAULT_SETTINGS },
    };
  }

  /**
   * Data migrations. Each step upgrades a whole dataset by one schema version.
   * Add entries as { from: N, run(state) => state } when SCHEMA_VERSION increases.
   */
  const MIGRATIONS = [];

  function migrateState(state, fromVersion) {
    let v = fromVersion;
    let s = state;
    while (v < SCHEMA_VERSION) {
      const step = MIGRATIONS.find((m) => m.from === v);
      if (!step) throw new Error(`No migration from schema version ${v}.`);
      s = step.run(s);
      v += 1;
    }
    return s;
  }

  /* ---------------------------------------------------------------- backup */

  const PICK = {
    transactions: ['id', 'type', 'amount', 'currency', 'categoryId', 'date', 'paymentMethod', 'description', 'classification', 'sharedExpenseId', 'tags', 'createdAt', 'updatedAt'],
    categories: ['id', 'name', 'type', 'isCustom', 'createdAt', 'updatedAt'],
    budgets: ['id', 'month', 'amount', 'createdAt', 'updatedAt'],
    friends: ['id', 'name', 'phone', 'notes', 'archived', 'createdAt', 'updatedAt'],
    groups: ['id', 'name', 'memberFriendIds', 'archived', 'createdAt', 'updatedAt'],
    sharedExpenses: ['id', 'description', 'totalAmount', 'date', 'payerPersonId', 'participantShares', 'splitMethod', 'categoryId', 'groupId', 'linkedTransactionId', 'paymentMethod', 'notes', 'createdAt', 'updatedAt'],
    settlements: ['id', 'payerPersonId', 'receiverPersonId', 'amount', 'date', 'groupId', 'note', 'createdAt', 'updatedAt'],
  };
  const NULLABLE = new Set(['sharedExpenseId', 'phone', 'notes', 'categoryId', 'groupId', 'linkedTransactionId', 'paymentMethod', 'note']);

  function pickRecord(store, r) {
    if (!r || typeof r !== 'object' || Array.isArray(r)) return r;
    const out = {};
    for (const k of PICK[store]) {
      if (r[k] === undefined) {
        if (NULLABLE.has(k)) out[k] = null;
        else if (k === 'tags') out[k] = [];
        else out[k] = undefined;
      } else if (k === 'participantShares' && Array.isArray(r[k])) {
        out[k] = r[k].map((p) => (p && typeof p === 'object' ? { personId: p.personId, share: p.share, input: p.input === undefined ? null : p.input } : p));
      } else if ((k === 'memberFriendIds' || k === 'tags') && Array.isArray(r[k])) {
        out[k] = r[k].slice();
      } else {
        out[k] = r[k];
      }
    }
    return out;
  }

  function buildBackup(state, exportedAt) {
    const data = { settings: { defaultBudget: state.settings.defaultBudget, warnThreshold: state.settings.warnThreshold } };
    for (const s of STORES) data[s] = state[s].map((r) => pickRecord(s, r));
    return {
      format: BACKUP_FORMAT,
      app: 'MyExpense',
      schemaVersion: SCHEMA_VERSION,
      exportedAt: exportedAt || nowISO(),
      currency: 'INR',
      amountUnit: 'paise',
      data,
    };
  }

  function countRecords(state) {
    const c = {};
    for (const s of STORES) c[s] = state[s].length;
    return c;
  }

  /** Parse and fully validate backup text. Never throws. */
  function parseBackup(text) {
    let obj;
    try {
      obj = JSON.parse(text);
    } catch (err) {
      return { ok: false, errors: ['This file is not valid JSON. Choose a MyExpense backup file.'] };
    }
    if (!obj || typeof obj !== 'object' || obj.format !== BACKUP_FORMAT) {
      return { ok: false, errors: ['This file is not a MyExpense backup.'] };
    }
    if (!Number.isSafeInteger(obj.schemaVersion) || obj.schemaVersion < 1) return { ok: false, errors: ['The backup has no valid schema version.'] };
    if (obj.schemaVersion > SCHEMA_VERSION) {
      return { ok: false, errors: [`This backup was made by a newer version of MyExpense (schema ${obj.schemaVersion}). Update the app on this device first.`] };
    }
    if (obj.amountUnit !== 'paise' || obj.currency !== 'INR') return { ok: false, errors: ['The backup uses an unsupported currency or amount unit.'] };
    const d = obj.data;
    if (!d || typeof d !== 'object') return { ok: false, errors: ['The backup has no data section.'] };
    const missing = STORES.filter((s) => !Array.isArray(d[s]));
    if (missing.length) return { ok: false, errors: [`The backup is missing: ${missing.join(', ')}.`] };
    let state = { settings: { ...DEFAULT_SETTINGS } };
    if (d.settings && typeof d.settings === 'object') {
      if (d.settings.defaultBudget !== undefined) state.settings.defaultBudget = d.settings.defaultBudget;
      if (d.settings.warnThreshold !== undefined) state.settings.warnThreshold = d.settings.warnThreshold;
    }
    for (const s of STORES) state[s] = d[s].map((r) => pickRecord(s, r));
    try {
      state = migrateState(state, obj.schemaVersion);
    } catch (err) {
      return { ok: false, errors: [String(err.message || err)] };
    }
    const errors = validateState(state);
    if (errors.length) return { ok: false, errors };
    state = syncLinkedTransactions(state);
    return {
      ok: true,
      errors: [],
      state,
      meta: { exportedAt: isTs(obj.exportedAt) ? obj.exportedAt : null, schemaVersion: obj.schemaVersion, counts: countRecords(state) },
    };
  }

  function stableStringify(v) {
    if (v === null || typeof v !== 'object') return JSON.stringify(v === undefined ? null : v);
    if (Array.isArray(v)) return `[${v.map(stableStringify).join(',')}]`;
    return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${stableStringify(v[k])}`).join(',')}}`;
  }

  /**
   * Merge an imported dataset into the current one.
   * Policy (documented in README and shown in the import preview):
   *   - Records match by id. New ids are added.
   *   - Same id, identical content: unchanged.
   *   - Same id, different content: the version with the later updatedAt wins.
   *   - Categories with a different id but the same name are treated as the same category.
   *   - Budgets match by month.
   *   - Deletions are not carried over. Settings on this device are kept.
   * The merged result is revalidated; if it is inconsistent the merge is refused and nothing changes.
   */
  function planMerge(current, incoming) {
    const inc = {};
    for (const s of STORES) inc[s] = incoming[s].map((r) => ({ ...r }));

    const curCatByName = new Map(current.categories.map((c) => [c.name.trim().toLowerCase(), c.id]));
    const curCatIds = new Set(current.categories.map((c) => c.id));
    const remap = new Map();
    inc.categories = inc.categories.filter((c) => {
      if (curCatIds.has(c.id)) return true;
      const match = curCatByName.get(c.name.trim().toLowerCase());
      if (match) {
        remap.set(c.id, match);
        return false;
      }
      return true;
    });
    if (remap.size) {
      for (const t of inc.transactions) if (remap.has(t.categoryId)) t.categoryId = remap.get(t.categoryId);
      for (const se of inc.sharedExpenses) if (se.categoryId && remap.has(se.categoryId)) se.categoryId = remap.get(se.categoryId);
    }

    const stats = {};
    const merged = { settings: { ...current.settings } };
    for (const s of STORES) {
      const st = { added: 0, updated: 0, unchanged: 0, keptCurrent: 0 };
      const keyOf = s === 'budgets' ? (r) => r.month : (r) => r.id;
      const map = new Map(current[s].map((r) => [keyOf(r), r]));
      for (const r of inc[s]) {
        const k = keyOf(r);
        const cur = map.get(k);
        if (!cur) {
          map.set(k, r);
          st.added++;
        } else if (stableStringify({ ...cur, id: 0 }) === stableStringify({ ...r, id: 0 })) {
          st.unchanged++;
        } else if (Date.parse(r.updatedAt) > Date.parse(cur.updatedAt)) {
          map.set(k, s === 'budgets' ? { ...r, id: cur.id } : r);
          st.updated++;
        } else {
          st.keptCurrent++;
        }
      }
      merged[s] = Array.from(map.values());
      stats[s] = st;
    }
    // Linked transactions are derived; do not count them as separate changes.
    let state = syncLinkedTransactions(merged);
    const errors = validateState(state);
    return { ok: errors.length === 0, errors, state, stats, categoriesMatchedByName: remap.size };
  }

  /* ------------------------------------------------------------------ csv */

  function csvCell(v) {
    if (v === null || v === undefined) return '';
    if (typeof v === 'number') return String(v);
    let s = String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; // stop spreadsheet formula injection
    if (/[",\r\n]/.test(s)) s = `"${s.replace(/"/g, '""')}"`;
    return s;
  }

  /** Rows of cells to CSV text with a UTF-8 BOM so Excel reads ₹ and Indian names correctly. */
  function toCSV(rows) {
    return '\uFEFF' + rows.map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
  }

  const api = {
    ME,
    SCHEMA_VERSION,
    BACKUP_FORMAT,
    MAX_PAISE,
    PERCENT_TOLERANCE_BP,
    PAYMENT_METHODS,
    SPLIT_METHODS,
    CATEGORY_TYPES,
    OTHER_CATEGORY_ID,
    STORES,
    LIMITS,
    DEFAULT_SETTINGS,
    uid,
    nowISO,
    cmp,
    parseAmount,
    parsePercent,
    formatINR,
    formatINRCompact,
    amountToInput,
    amountToDecimal,
    percentToInput,
    toISODate,
    todayISO,
    isISODate,
    isMonthKey,
    parseISO,
    monthOf,
    addDays,
    addMonths,
    monthRange,
    weekRange,
    yearRange,
    daysBetween,
    inRange,
    listDays,
    listMonths,
    computeSplit,
    buildLedger,
    myBalances,
    personNets,
    suggestSettlements,
    myShare,
    effectOnFriend,
    spendItems,
    summarize,
    budgetFor,
    budgetId,
    deriveLinkedTransaction,
    syncLinkedTransactions,
    validateTransaction,
    validateCategory,
    validateBudget,
    validateFriend,
    validateGroup,
    validateSharedExpense,
    validateSettlement,
    validateState,
    buildContext,
    defaultCategories,
    emptyState,
    migrateState,
    buildBackup,
    parseBackup,
    planMerge,
    countRecords,
    stableStringify,
    csvCell,
    toCSV,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.MyExpenseCore = api;
})(typeof self !== 'undefined' ? self : this);
