// Invented accounts at an industrial scale, for the gallery's many-accounts
// page and the account map's benchmark: the same every time (a seeded
// sequence), every name, number and ID made up.
//
//   manyAccounts({ externals: 2000, accounts: 1500 })
//     -> { external_accounts, accounts, links }
//
// About a third of the external accounts are linked. Of the rest, a good share
// have a deployment account named as they are, or named by their number, or
// carrying their number, so the map suggests them; some names are shared by
// two deployment accounts, so those are not suggested; some deployment
// accounts are closed.

const CUSTODIANS = ["Interactive Brokers", "Fidelity", "Schwab", "Vanguard", "Pershing", "Northern Trust", "State Street", "BNY"];
const TYPES = ["Margin", "Cash", "IRA", "Roth IRA", "Trust", "Joint", "Custody", "Fund"];
const CLIENTS = ["Harbour", "Aster", "Linden", "Meridian", "Calder", "Wren", "Solent", "Kestrel", "Juniper", "Tamar", "Fenwick", "Orrin"];

function sequence(seed) {
  let s = seed >>> 0;
  return (n) => {
    s = (Math.imul(s, 1103515245) + 12345) >>> 0;
    // The high bits: an LCG's low bits repeat with a short period.
    return Math.floor((s / 4294967296) * n);
  };
}

export function manyAccounts({ externals = 2000, accounts = 1500, seed = 20260930 } = {}) {
  const rand = sequence(seed);
  const pad = (n, w) => String(n).padStart(w, "0");
  const connections = Array.from({ length: Math.max(4, Math.round(externals / 30)) }, (_, i) => {
    const custodian = CUSTODIANS[i % CUSTODIANS.length];
    return { id: `conn-${pad(i, 4)}`, name: `${custodian} · desk ${Math.floor(i / CUSTODIANS.length) + 1}`, custodian };
  });
  const external_accounts = [];
  for (let i = 0; i < externals; i++) {
    const c = connections[rand(connections.length)];
    const type = TYPES[rand(TYPES.length)];
    const client = `${CLIENTS[rand(CLIENTS.length)]} ${pad(i, 5)}`;
    const number = c.custodian === "Interactive Brokers" ? `U${pad(1000000 + i * 7, 7)}` : `${c.custodian.slice(0, 2).toUpperCase()}-${pad(40000 + i * 13, 6)}`;
    external_accounts.push({
      external_account_id: `ext-${pad(i, 6)}`,
      name: `${client} ${type}`,
      detail: `${c.custodian} · ${type}`,
      custodian: c.custodian,
      account_type: type,
      number,
      connection: c.name,
      connection_id: c.id,
      note: rand(40) === 0 ? "No stable ID from the venue: after a reconnect it appears as a new account." : "",
    });
  }

  const deployment = [];
  const links = [];
  const add = (name, x, extra = {}) => {
    const account = { account_id: `ACC-${pad(deployment.length, 6)}`, name, custodian: x ? x.custodian : "", account_type: x ? x.account_type : "", open: true, ...extra };
    deployment.push(account);
    return account;
  };
  // A third linked, each to an account named from it.
  const order = external_accounts.map((_, i) => i);
  for (let i = order.length - 1; i > 0; i--) {
    const j = rand(i + 1);
    [order[i], order[j]] = [order[j], order[i]];
  }
  let at = 0;
  const next = () => external_accounts[order[at++ % order.length]];
  const linked = Math.min(Math.round(accounts * 0.4), Math.round(externals / 3));
  for (let i = 0; i < linked; i++) {
    const x = next();
    const a = add(x.name, x);
    links.push({ external_account_id: x.external_account_id, account_id: a.account_id, account_name: a.name });
  }
  // Of the rest: named as the external account, named by its number, or carrying its number.
  const left = accounts - deployment.length;
  for (let i = 0; i < Math.round(left * 0.35); i++) add(next().name, null);
  for (let i = 0; i < Math.round(left * 0.1); i++) add(next().number, null);
  for (let i = 0; i < Math.round(left * 0.1); i++) {
    const x = next();
    add(`Book ${pad(deployment.length, 5)}`, x, { number: x.number });
  }
  // Two accounts of one name: neither is suggested.
  for (let i = 0; i < Math.round(left * 0.05); i++) {
    const x = next();
    add(x.name, x);
    add(x.name, null);
  }
  while (deployment.length < accounts) add(`Book ${pad(deployment.length, 5)}`, null, { custodian: CUSTODIANS[rand(CUSTODIANS.length)], open: rand(8) !== 0 });
  deployment.length = accounts;
  const kept = new Set(deployment.map((a) => a.account_id));
  return { external_accounts, accounts: deployment, links: links.filter((l) => kept.has(l.account_id)) };
}
