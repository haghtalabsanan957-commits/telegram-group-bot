// ═══════════════════════════════════════════════════════
//  دیتابیس - Cloudflare KV
// ═══════════════════════════════════════════════════════

import { OWNER_ID, REFERRAL_BONUS, GAME_COST } from "./config.js";

// ─── پایه ───────────────────────────────────────────────
export const kv = {
  get:    (e,k)   => e.BOT_DATA.get(k,"json").catch(()=>null),
  set:    (e,k,v) => e.BOT_DATA.put(k, JSON.stringify(v)),
  del:    (e,k)   => e.BOT_DATA.delete(k),
};

// ─── موجودی ─────────────────────────────────────────────
export async function getBal(e, uid) {
  return (await kv.get(e, `bal:${uid}`)) ?? 0;
}
export async function addBal(e, uid, amt, note="") {
  const n = Math.round(((await getBal(e,uid)) + amt)*1e4)/1e4;
  await kv.set(e, `bal:${uid}`, n);
  const txs = (await kv.get(e,`tx:${uid}`)) || [];
  txs.push({ amt, note, t: new Date().toISOString() });
  if (txs.length>100) txs.splice(0, txs.length-100);
  await kv.set(e, `tx:${uid}`, txs);
  return n;
}
export async function rmBal(e, uid, amt, note="") {
  const cur = await getBal(e, uid);
  if (cur < amt) return false;
  await kv.set(e, `bal:${uid}`, Math.round((cur-amt)*1e4)/1e4);
  const txs = (await kv.get(e,`tx:${uid}`)) || [];
  txs.push({ amt:-amt, note, t: new Date().toISOString() });
  if (txs.length>100) txs.splice(0, txs.length-100);
  await kv.set(e, `tx:${uid}`, txs);
  return true;
}

// ─── کاربران ────────────────────────────────────────────
export async function regUser(e, uid) {
  const users = (await kv.get(e,"users")) || [];
  if (!users.includes(String(uid))) {
    users.push(String(uid));
    await kv.set(e,"users",users);
  }
}
export async function allUsers(e) { return (await kv.get(e,"users")) || []; }

// ─── ادمین ──────────────────────────────────────────────
export async function getAdmins(e) {
  const a = (await kv.get(e,"admins")) || [];
  if (!a.includes(String(OWNER_ID))) a.unshift(String(OWNER_ID));
  return a;
}
export async function addAdmin(e, uid) {
  const a = await getAdmins(e);
  if (a.includes(String(uid))) return false;
  a.push(String(uid));
  await kv.set(e,"admins",a);
  return true;
}
export async function rmAdmin(e, uid) {
  if (String(uid)===String(OWNER_ID)) return false;
  const a = await getAdmins(e);
  const i = a.indexOf(String(uid));
  if (i===-1) return false;
  a.splice(i,1);
  await kv.set(e,"admins",a);
  return true;
}
export async function isAdmin(e, uid) {
  return (await getAdmins(e)).includes(String(uid));
}
export function isOwner(uid) { return String(uid)===String(OWNER_ID); }

// ─── عضویت اجباری ───────────────────────────────────────
// item = { id, title, type:"channel"|"group", username?, link? }
export async function getMandatory(e) { return (await kv.get(e,"mandatory")) || []; }
export async function addMandatory(e, item) {
  const list = await getMandatory(e);
  if (list.find(i=>String(i.id)===String(item.id))) return false;
  list.push(item);
  await kv.set(e,"mandatory",list);
  return true;
}
export async function rmMandatory(e, id) {
  const list = await getMandatory(e);
  const i = list.findIndex(x=>String(x.id)===String(id));
  if (i===-1) return false;
  list.splice(i,1);
  await kv.set(e,"mandatory",list);
  return true;
}

// ─── آمار ───────────────────────────────────────────────
export async function getStats(e, uid) {
  return (await kv.get(e,`stats:${uid}`)) ||
    {win:0,lose:0,draw:0,streak:0,best:0};
}
export async function updStats(e, uid, res) {
  const s = await getStats(e,uid);
  s[res]++;
  if (res==="win") { s.streak++; s.best=Math.max(s.best,s.streak); }
  else s.streak=0;
  await kv.set(e,`stats:${uid}`,s);
}

// ─── رفرال ──────────────────────────────────────────────
export async function setRef(e, uid, ref) {
  if (await kv.get(e,`ref:${uid}`)) return false;
  await kv.set(e,`ref:${uid}`,ref);
  const list = (await kv.get(e,`reflist:${ref}`)) || [];
  if (!list.includes(String(uid))) {
    list.push(String(uid));
    await kv.set(e,`reflist:${ref}`,list);
    return true;
  }
  return false;
}
export async function getRefList(e,uid) { return (await kv.get(e,`reflist:${uid}`)) || []; }

// ─── صف انتظار ──────────────────────────────────────────
export async function getWaiting(e) { return (await kv.get(e,"waiting")) || []; }
export async function addWaiting(e, uid) {
  const w = await getWaiting(e);
  if (!w.includes(String(uid))) { w.push(String(uid)); await kv.set(e,"waiting",w); }
  const t = (await kv.get(e,"wtimers")) || {};
  t[String(uid)] = Date.now();
  await kv.set(e,"wtimers",t);
}
export async function rmWaiting(e, uid) {
  const w = await getWaiting(e);
  const i = w.indexOf(String(uid));
  if (i===-1) return false;
  w.splice(i,1);
  await kv.set(e,"waiting",w);
  const t = (await kv.get(e,"wtimers")) || {};
  delete t[String(uid)];
  await kv.set(e,"wtimers",t);
  return true;
}
export async function getWTimers(e) { return (await kv.get(e,"wtimers")) || {}; }

// ─── بازی ───────────────────────────────────────────────
export async function getGame(e, gid) { return kv.get(e,`game:${gid}`); }
export async function saveGame(e, gid, g) { await kv.set(e,`game:${gid}`,g); }
export async function delGame(e, gid) {
  await kv.del(e,`game:${gid}`);
  await kv.del(e,`gtimer:${gid}`);
  const l = (await kv.get(e,"gamelist")) || [];
  const i = l.indexOf(gid);
  if (i!==-1) { l.splice(i,1); await kv.set(e,"gamelist",l); }
}
export async function createGame(e, p1, p2) {
  const n = ((await kv.get(e,"gcounter"))||0)+1;
  await kv.set(e,"gcounter",n);
  const gid = `g${n}`;
  await kv.set(e,`game:${gid}`,{
    p1:String(p1), p2:String(p2),
    s1:0, s2:0, r:1, m1:null, m2:null,
    extra:false, created:Date.now()
  });
  const l = (await kv.get(e,"gamelist")) || [];
  l.push(gid);
  await kv.set(e,"gamelist",l);
  await kv.set(e,`gtimer:${gid}`,Date.now());
  return gid;
}
export async function getGameList(e) { return (await kv.get(e,"gamelist")) || []; }
export async function getUserGame(e, uid) {
  for (const gid of await getGameList(e)) {
    const g = await getGame(e,gid);
    if (g && (g.p1===String(uid)||g.p2===String(uid))) return {gid,game:g};
  }
  return null;
}
export async function setGTimer(e,gid) { await kv.set(e,`gtimer:${gid}`,Date.now()); }
export async function getGTimer(e,gid) { return kv.get(e,`gtimer:${gid}`); }

// ─── State ───────────────────────────────────────────────
export async function setState(e,uid,state,data=null) { await kv.set(e,`state:${uid}`,{state,data}); }
export async function getState(e,uid) { return kv.get(e,`state:${uid}`); }
export async function clrState(e,uid) { await kv.del(e,`state:${uid}`); }

// ─── Bot info ────────────────────────────────────────────
export async function getBotUser(e) { return (await kv.get(e,"botuser")) || "RockPaperScissors_ARS_Bot"; }
export async function setBotUser(e,u) { await kv.set(e,"botuser",u); }
