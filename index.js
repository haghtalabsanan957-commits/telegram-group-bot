// ═══════════════════════════════════════════════════════
//  ربات سنگ‌کاغذ‌قیچی - Cloudflare Worker
// ═══════════════════════════════════════════════════════

import { TOKEN, OWNER_ID, SUPPORT, GAME_COST, WIN_REWARD, ROUNDS,
         WAIT_TIME, MOVE_TIMEOUT, MIN_WITHDRAW, REFERRAL_BONUS, API } from "./config.js";
import { kv, getBal, addBal, rmBal, regUser, allUsers, getAdmins,
         addAdmin, rmAdmin, isAdmin, isOwner, getMandatory, addMandatory,
         rmMandatory, getStats, updStats, setRef, getRefList, getWaiting,
         addWaiting, rmWaiting, getWTimers, getGame, saveGame, delGame,
         createGame, getGameList, getUserGame, setGTimer, getGTimer,
         setState, getState, clrState, getBotUser, setBotUser } from "./db.js";

// ═══════════════════════════════════════════════════════
//  Entry Point
// ═══════════════════════════════════════════════════════

export default {
  async fetch(req, env) {
    if (req.method !== "POST") return new Response("OK");
    try {
      const u = await req.json();
      await handleUpdate(u, env);
    } catch(e) { console.error(e); }
    return new Response("OK");
  },
  async scheduled(_, env, ctx) {
    ctx.waitUntil(runScheduled(env));
  }
};

// ═══════════════════════════════════════════════════════
//  Telegram API
// ═══════════════════════════════════════════════════════

async function tg(method, params) {
  try {
    const r = await fetch(`${API}/${method}`, {
      method:"POST",
      headers:{"Content-Type":"application/json"},
      body: JSON.stringify(params)
    });
    return r.json();
  } catch(e) { console.error(e); return null; }
}

const send  = (cid,text,ex={}) => tg("sendMessage",{chat_id:cid,text,parse_mode:"Markdown",...ex});
const sendP = (cid,fid,cap="",ex={}) => tg("sendPhoto",{chat_id:cid,photo:fid,caption:cap,parse_mode:"Markdown",...ex});
const sendV = (cid,fid,cap="",ex={}) => tg("sendVideo",{chat_id:cid,video:fid,caption:cap,parse_mode:"Markdown",...ex});
const answ  = (id,text,alert=false) => tg("answerCallbackQuery",{callback_query_id:id,text,show_alert:alert});
const editM = (cid,mid) => tg("editMessageReplyMarkup",{chat_id:cid,message_id:mid,reply_markup:{inline_keyboard:[]}});
const getCM = (cid,uid) => tg("getChatMember",{chat_id:cid,user_id:uid});

// ═══════════════════════════════════════════════════════
//  کیبوردها
// ═══════════════════════════════════════════════════════

function mainKB(admin=false,owner=false) {
  const kb = [
    [{text:"🎮 شروع بازی"},{text:"💰 موجودی"}],
    [{text:"📥 شارژ حساب"},{text:"📤 برداشت"}],
    [{text:"📊 آمار من"},{text:"🏆 لیدربورد"}],
    [{text:"🔗 دعوت دوستان"}],
  ];
  if (admin||owner) kb.push([{text:"⚙️ پنل ادمین"}]);
  return {keyboard:kb, resize_keyboard:true};
}

function adminKB(owner=false) {
  const kb = [
    [{text:"📊 آمار کل"}],
    [{text:"➕ افزودن موجودی"},{text:"➖ کسر موجودی"}],
    [{text:"📋 عضویت اجباری"},{text:"📢 پیام همگانی"}],
  ];
  if (owner) kb.push([{text:"👤 مدیریت ادمین‌ها"}]);
  kb.push([{text:"🏠 منوی اصلی"}]);
  return {keyboard:kb, resize_keyboard:true};
}

function cancelKB() { return {keyboard:[[{text:"❌ لغو جستجو"}]],resize_keyboard:true}; }
function gameKB(gid) {
  return {inline_keyboard:[[
    {text:"🪨 سنگ",   callback_data:`move:${gid}:rock`},
    {text:"📄 کاغذ",  callback_data:`move:${gid}:paper`},
    {text:"✂️ قیچی", callback_data:`move:${gid}:scissors`},
  ]]};
}
function mandatoryKB(channels) {
  const kb = channels.map(c => ([{
    text: c.type==="channel" ? `📢 ${c.title}` : `👥 ${c.title}`,
    url: c.link || (c.username ? `https://t.me/${c.username}` : null)
  }])).filter(r=>r[0].url);
  kb.push([{text:"✅ عضو شدم", callback_data:"check_join"}]);
  return {inline_keyboard:kb};
}

// ═══════════════════════════════════════════════════════
//  بررسی عضویت اجباری
// ═══════════════════════════════════════════════════════

async function checkMembership(env, uid) {
  const list = await getMandatory(env);
  if (!list.length) return true;
  for (const ch of list) {
    try {
      const r = await getCM(ch.id, uid);
      const status = r?.result?.status;
      if (!["member","administrator","creator"].includes(status)) return false;
    } catch { return false; }
  }
  return true;
}

async function sendJoinMsg(env, uid) {
  const list = await getMandatory(env);
  await send(uid,
    "⚠️ *برای استفاده از ربات باید در کانال/گروه‌های زیر عضو شوید:*",
    {reply_markup: mandatoryKB(list)}
  );
}

// ═══════════════════════════════════════════════════════
//  منطق بازی
// ═══════════════════════════════════════════════════════

const BEATS = {rock:"scissors",scissors:"paper",paper:"rock"};
const EMJ   = {rock:"🪨 سنگ",paper:"📄 کاغذ",scissors:"✂️ قیچی"};

function winner(m1,m2) {
  if (m1===m2) return "draw";
  return BEATS[m1]===m2 ? "p1" : "p2";
}

async function processRound(env, gid) {
  const g = await getGame(env,gid);
  if (!g) return;
  const res = winner(g.m1, g.m2);
  let rndWin = "";
  if (res==="p1") { g.s1++; rndWin="🏆 برنده راند: بازیکن اول"; }
  else if (res==="p2") { g.s2++; rndWin="🏆 برنده راند: بازیکن دوم"; }
  else rndWin="🤝 این راند مساوی شد";

  const detail = `${EMJ[g.m1]} vs ${EMJ[g.m2]}\n${rndWin}`;
  g.m1=null; g.m2=null; g.r++;
  await saveGame(env,gid,g);

  if (g.r > ROUNDS) {
    if (g.s1===g.s2) {
      // تمدید
      g.extra=true;
      await saveGame(env,gid,g);
      for (const pid of [g.p1,g.p2]) {
        const [my,op] = pid===g.p1 ? [g.s1,g.s2] : [g.s2,g.s1];
        const adm = await isAdmin(env,pid);
        await send(pid,
          `📊 *راند ${g.r-1} نتیجه:*\n${detail}\n\nامتیاز: شما ${my} - ${op} حریف\n\n🔄 *مساوی! راند تمدیدی!*`,
          {reply_markup:mainKB(adm,isOwner(pid))}
        );
        await send(pid,"⏰ حرکت کن:",{reply_markup:gameKB(gid)});
      }
      await setGTimer(env,gid);
      return;
    }
    // پایان
    for (const pid of [g.p1,g.p2]) {
      const [my,op] = pid===g.p1 ? [g.s1,g.s2] : [g.s2,g.s1];
      const adm = await isAdmin(env,pid);
      await send(pid,
        `📊 *راند ${g.r-1} نتیجه:*\n${detail}\n\nامتیاز نهایی: شما ${my} - ${op} حریف`,
        {reply_markup:mainKB(adm,isOwner(pid))}
      );
    }
    await finalizeGame(env,gid,g);
    return;
  }

  // راند بعدی
  for (const pid of [g.p1,g.p2]) {
    const [my,op] = pid===g.p1 ? [g.s1,g.s2] : [g.s2,g.s1];
    const adm = await isAdmin(env,pid);
    const ex = g.extra?" (تمدیدی 🔄)":"";
    await send(pid,
      `📊 *راند ${g.r-1} نتیجه:*\n${detail}\n\nامتیاز: شما ${my} - ${op} حریف\n\n🎮 *راند ${g.r}${ex} شروع شد!*\n⏰ ${MOVE_TIMEOUT} ثانیه`,
      {reply_markup:mainKB(adm,isOwner(pid))}
    );
    await send(pid,"✊ حرکت کن:",{reply_markup:gameKB(gid)});
  }
  await setGTimer(env,gid);
}

async function finalizeGame(env, gid, g) {
  await delGame(env,gid);
  const p1=g.p1, p2=g.p2, s1=g.s1, s2=g.s2;
  let win=null, lose=null;
  if (s1>s2){win=p1;lose=p2;} else if(s2>s1){win=p2;lose=p1;}

  if (win) {
    await addBal(env,win,WIN_REWARD,`جایزه بازی ${gid}`);
    await updStats(env,win,"win");
    await updStats(env,lose,"lose");
    const wBal = await getBal(env,win);
    const lBal = await getBal(env,lose);
    const [ws,ls] = win===p1 ? [s1,s2] : [s2,s1];
    const wadm = await isAdmin(env,win);
    const ladm = await isAdmin(env,lose);
    await send(win,
      `🏆 *تبریک! برنده شدید!*\n\n📊 امتیاز: ${ws} - ${ls}\n🎁 جایزه: ${WIN_REWARD.toLocaleString()} تومان\n💰 موجودی: ${wBal.toLocaleString()} تومان`,
      {reply_markup:mainKB(wadm,isOwner(win))}
    );
    await send(lose,
      `❌ *باختید!*\n\n📊 امتیاز: ${ls} - ${ws}\n💰 موجودی: ${lBal.toLocaleString()} تومان`,
      {reply_markup:mainKB(ladm,isOwner(lose))}
    );
  } else {
    for (const pid of [p1,p2]) {
      await updStats(env,pid,"draw");
      const bal = await getBal(env,pid);
      const adm = await isAdmin(env,pid);
      await send(pid,
        `🤝 *بازی مساوی!*\n\n📊 امتیاز: ${s1} - ${s2}\n💰 موجودی: ${bal.toLocaleString()} تومان`,
        {reply_markup:mainKB(adm,isOwner(pid))}
      );
    }
  }
}

async function endGame(env, gid, reason="normal") {
  const g = await getGame(env,gid);
  if (!g) return;
  const p1=g.p1, p2=g.p2;

  if (reason==="timeout_both") {
    await delGame(env,gid);
    for (const pid of [p1,p2]) {
      const adm = await isAdmin(env,pid);
      await send(pid,"⏰ *تایم‌اوت!* هر دو حرکت نکردند.\n💸 هزینه سوخت.",
        {reply_markup:mainKB(adm,isOwner(pid))});
    }
    return;
  }
  const lose = reason==="timeout_p1" ? p1 : p2;
  const win  = reason==="timeout_p1" ? p2 : p1;
  for (const pid of [p1,p2]) {
    const adm = await isAdmin(env,pid);
    await send(pid,"⏰ حریف شما در وقت مقرر حرکت نکرد!",
      {reply_markup:mainKB(adm,isOwner(pid))});
  }
  g.s1 = win===p1 ? ROUNDS : 0;
  g.s2 = win===p2 ? ROUNDS : 0;
  await finalizeGame(env,gid,g);
}

async function matchPlayers(env) {
  const w = await getWaiting(env);
  if (w.length < 2) return;
  const [p1,p2] = [w[0],w[1]];
  for (const uid of [p1,p2]) {
    if (await getBal(env,uid) < GAME_COST) {
      await rmWaiting(env,uid);
      const adm = await isAdmin(env,uid);
      await send(uid,"❌ موجودی کافی نیست! از صف خارج شدید.",
        {reply_markup:mainKB(adm,isOwner(uid))});
      return;
    }
  }
  await rmWaiting(env,p1); await rmWaiting(env,p2);
  await rmBal(env,p1,GAME_COST,"هزینه بازی");
  await rmBal(env,p2,GAME_COST,"هزینه بازی");
  const gid = await createGame(env,p1,p2);
  for (const pid of [p1,p2]) {
    const adm = await isAdmin(env,pid);
    await send(pid,
      `🎮 *حریف پیدا شد!*\n\n💸 ${GAME_COST.toLocaleString()} تومان کسر شد.\n📊 راند *1* از ${ROUNDS}\n\n⏰ ${MOVE_TIMEOUT} ثانیه وقت داری!`,
      {reply_markup:mainKB(adm,isOwner(pid))}
    );
    await send(pid,"✊ حرکت خود را انتخاب کنید:",{reply_markup:gameKB(gid)});
  }
}

// ═══════════════════════════════════════════════════════
//  Scheduled - تایم‌اوت خودکار
// ═══════════════════════════════════════════════════════

async function runScheduled(env) {
  const now = Date.now();

  // چک تایم‌اوت بازی‌ها
  for (const gid of await getGameList(env)) {
    const t = await getGTimer(env,gid);
    if (!t) continue;
    if ((now-t)/1000 >= MOVE_TIMEOUT) {
      const g = await getGame(env,gid);
      if (!g) continue;
      if (!g.m1 && !g.m2) await endGame(env,gid,"timeout_both");
      else if (!g.m1)      await endGame(env,gid,"timeout_p1");
      else if (!g.m2)      await endGame(env,gid,"timeout_p2");
    }
  }

  // چک تایم‌اوت صف انتظار
  const timers = await getWTimers(env);
  for (const uid of await getWaiting(env)) {
    const t = timers[uid];
    if (!t) continue;
    if ((now-t)/1000 >= WAIT_TIME) {
      await rmWaiting(env,uid);
      const adm = await isAdmin(env,uid);
      await send(uid,"❌ *حریفی پیدا نشد!* دوباره امتحان کنید.",
        {reply_markup:mainKB(adm,isOwner(uid))});
    }
  }

  // جفت کردن بازیکنان
  await matchPlayers(env);
}

// ═══════════════════════════════════════════════════════
//  هندلر اصلی
// ═══════════════════════════════════════════════════════

async function handleUpdate(u, env) {
  if (u.callback_query) { await handleCB(u.callback_query,env); return; }
  if (!u.message) return;

  const msg  = u.message;
  const uid  = msg.from.id;
  const text = msg.text || "";

  await regUser(env,uid);

  // چک عضویت اجباری (بجز ادمین‌ها)
  if (!(await isAdmin(env,uid))) {
    const joined = await checkMembership(env,uid);
    if (!joined && text !== "❌ لغو جستجو") {
      await sendJoinMsg(env,uid);
      return;
    }
  }

  // state
  const st = await getState(env,uid);
  if (st) { await handleState(msg,st,env); return; }

  const adm = await isAdmin(env,uid);
  const own = isOwner(uid);

  if (text.startsWith("/start"))            await cmdStart(msg,env);
  else if (text==="💰 موجودی")             await cmdBal(msg,env);
  else if (text==="📥 شارژ حساب")          await cmdCharge(msg,env);
  else if (text==="📤 برداشت")             await cmdWithdraw(msg,env);
  else if (text==="📊 آمار من")            await cmdStats(msg,env);
  else if (text==="🏆 لیدربورد")           await cmdLeader(msg,env);
  else if (text==="🔗 دعوت دوستان")        await cmdRef(msg,env);
  else if (text==="🎮 شروع بازی")          await cmdStartGame(msg,env);
  else if (text==="❌ لغو جستجو")          await cmdCancel(msg,env);
  else if (text==="🏠 منوی اصلی")          await send(uid,"🏠 منوی اصلی",{reply_markup:mainKB(adm,own)});
  else if (text==="⚙️ پنل ادمین" && adm)   await send(uid,"⚙️ *پنل مدیریت*",{reply_markup:adminKB(own)});
  else if (text==="📊 آمار کل" && adm)     await cmdAdminStats(msg,env);
  else if (text==="➕ افزودن موجودی"&&adm) { await setState(env,uid,"add"); await send(uid,"🆔 آیدی و مقدار:\nمثال: `123456 10000`"); }
  else if (text==="➖ کسر موجودی"&&adm)    { await setState(env,uid,"rem"); await send(uid,"🆔 آیدی و مقدار:\nمثال: `123456 10000`"); }
  else if (text==="📢 پیام همگانی"&&adm)   { await setState(env,uid,"bcast"); await send(uid,"📝 پیام، عکس یا ویدیو بفرست:"); }
  else if (text==="📋 عضویت اجباری"&&adm)  await cmdMandatoryMenu(msg,env);
  else if (text==="👤 مدیریت ادمین‌ها"&&own) await cmdAdminMenu(msg,env);
  else if (text.startsWith("/add")&&adm)    await cmdAdminAdd(msg,env);
  else if (text.startsWith("/remove")&&adm) await cmdAdminRem(msg,env);
  else if (text.startsWith("/bal")&&adm)    await cmdAdminBal(msg,env);
  else if (text.startsWith("/endgame")&&adm) await cmdEndgame(msg,env);
  else if (text.startsWith("/addadmin")&&own) await cmdAddAdmin(msg,env);
  else if (text.startsWith("/remadmin")&&own) await cmdRemAdmin(msg,env);
  else if (text.startsWith("/admins")&&own)   await cmdListAdmins(msg,env);
  else if (text.startsWith("/addch")&&adm)    await cmdAddMandatory(msg,env,"channel");
  else if (text.startsWith("/addgroup")&&adm) await cmdAddMandatory(msg,env,"group");
  else if (text.startsWith("/rmch")&&adm)     await cmdRmMandatory(msg,env);
  else if (text.startsWith("/channels")&&adm) await cmdListMandatory(msg,env);
}

// ═══════════════════════════════════════════════════════
//  State Machine
// ═══════════════════════════════════════════════════════

async function handleState(msg, st, env) {
  const uid = msg.from.id;
  await clrState(env,uid);
  const adm = await isAdmin(env,uid);
  const own = isOwner(uid);

  if (st.state==="add"||st.state==="rem") {
    const parts = (msg.text||"").trim().split(/\s+/);
    if (parts.length<2) { await send(uid,"❌ فرمت اشتباه!"); return; }
    const [tid,val] = [parseInt(parts[0]),parseFloat(parts[1])];
    if (isNaN(tid)||isNaN(val)) { await send(uid,"❌ مقدار نامعتبر!"); return; }
    if (st.state==="add") {
      const nb = await addBal(env,tid,val,"افزودن دستی ادمین");
      await send(uid,`✅ *${val.toLocaleString()} تومان* به \`${tid}\` اضافه شد.\n💰 موجودی: ${nb.toLocaleString()} تومان`,{reply_markup:adminKB(own)});
      try { await send(tid,`🎁 *${val.toLocaleString()} تومان* توسط ادمین به حسابت اضافه شد.\n💰 موجودی: ${nb.toLocaleString()} تومان`); } catch{}
    } else {
      const ok = await rmBal(env,tid,val,"کسر دستی ادمین");
      const nb = await getBal(env,tid);
      if (ok) {
        await send(uid,`✅ *${val.toLocaleString()} تومان* از \`${tid}\` کسر شد.\n💰 موجودی: ${nb.toLocaleString()} تومان`,{reply_markup:adminKB(own)});
        try { await send(tid,`⚠️ *${val.toLocaleString()} تومان* توسط ادمین از حسابت کسر شد.\n💰 موجودی: ${nb.toLocaleString()} تومان`); } catch{}
      } else {
        await send(uid,`❌ موجودی کافی نیست! (${nb.toLocaleString()} تومان)`,{reply_markup:adminKB(own)});
      }
    }

  } else if (st.state==="bcast") {
    const users = await allUsers(env);
    let ok=0,fail=0;
    const cap = msg.caption||msg.text||"";
    for (const tid of users) {
      try {
        if (msg.photo)      await sendP(tid,msg.photo.at(-1).file_id,cap);
        else if (msg.video) await sendV(tid,msg.video.file_id,cap);
        else if (msg.text)  await send(tid,msg.text);
        ok++;
      } catch { fail++; }
      await new Promise(r=>setTimeout(r,50));
    }
    await send(uid,`✅ ارسال شد!\n📨 موفق: ${ok} | ❌ ناموفق: ${fail}\n👥 کل: ${users.length}`,{reply_markup:adminKB(own)});

  } else if (st.state==="addch_id") {
    // گرفتن ID کانال/گروه خصوصی
    const id = (msg.text||"").trim();
    const type = st.data?.type || "channel";
    await setState(env,uid,"addch_title",{type,id});
    await send(uid,"📝 عنوان نمایشی را بفرست (مثال: کانال ما):");

  } else if (st.state==="addch_title") {
    const {type, id, username} = st.data;
    const title = (msg.text||"").trim();
    let link = null;
    if (username) link = `https://t.me/${username}`;
    const item = {id, type, title, username:username||null, link};
    const ok = await addMandatory(env,item);
    if (ok) {
      await send(uid,`✅ ${type==="channel"?"کانال":"گروه"} *${title}* اضافه شد!`,{reply_markup:adminKB(own)});
    } else {
      await send(uid,"⚠️ این آیدی قبلاً اضافه شده!",{reply_markup:adminKB(own)});
    }
  }
}

// ═══════════════════════════════════════════════════════
//  Callback
// ═══════════════════════════════════════════════════════

async function handleCB(call, env) {
  const data = call.data||"";
  const uid  = String(call.from.id);

  // چک عضویت مجدد
  if (data==="check_join") {
    const joined = await checkMembership(env,uid);
    if (joined) {
      await answ(call.id,"✅ عضویت تأیید شد!",true);
      const adm = await isAdmin(env,uid);
      await send(uid,"✅ *خوش اومدی!* الان میتونی از ربات استفاده کنی.",
        {reply_markup:mainKB(adm,isOwner(uid))});
    } else {
      await answ(call.id,"❌ هنوز عضو نشدی!",true);
    }
    return;
  }

  if (!data.startsWith("move:")) return;
  const [,gid,move] = data.split(":");
  const g = await getGame(env,gid);
  if (!g) { await answ(call.id,"⚠️ بازی وجود ندارد!",true); return; }

  if (g.p1===uid) {
    if (g.m1) { await answ(call.id,"⏳ منتظر حریف...",true); return; }
    g.m1=move;
  } else if (g.p2===uid) {
    if (g.m2) { await answ(call.id,"⏳ منتظر حریف...",true); return; }
    g.m2=move;
  } else {
    await answ(call.id,"⚠️ تو در این بازی نیستی!",true); return;
  }

  await saveGame(env,gid,g);
  await answ(call.id,`✅ ${EMJ[move]} ثبت شد!`);
  try { await editM(call.message.chat.id,call.message.message_id); } catch{}

  if (g.m1 && g.m2) await processRound(env,gid);
}

// ═══════════════════════════════════════════════════════
//  دستورات کاربر
// ═══════════════════════════════════════════════════════

async function cmdStart(msg, env) {
  const uid  = msg.from.id;
  const parts = (msg.text||"").split(" ");
  if (parts[1] && parts[1]!==String(uid)) {
    const already = await kv.get(env,`ref:${uid}`);
    if (!already) {
      const ok = await setRef(env,uid,parts[1]);
      if (ok) {
        try {
          const nb = await addBal(env,parts[1],REFERRAL_BONUS,"هدیه رفرال");
          await send(parts[1],`🎁 یک نفر با لینک شما عضو شد!\n+${REFERRAL_BONUS.toLocaleString()} تومان\n💰 موجودی: ${nb.toLocaleString()} تومان`);
        } catch{}
      }
    }
  }
  // ذخیره username ربات
  const me = await tg("getMe",{});
  if (me?.result?.username) await setBotUser(env,me.result.username);

  const adm = await isAdmin(env,uid);
  await send(uid,
    `🤖 *ربات سنگ‌کاغذ‌قیچی حرفه‌ای*\n\n` +
    `🎮 هر بازی: ${GAME_COST.toLocaleString()} تومان\n` +
    `🏆 جایزه برنده: ${WIN_REWARD.toLocaleString()} تومان\n` +
    `📞 پشتیبانی: @${SUPPORT}`,
    {reply_markup:mainKB(adm,isOwner(uid))}
  );
}

async function cmdBal(msg, env) {
  const bal = await getBal(env,msg.from.id);
  await send(msg.from.id,`💰 موجودی: *${bal.toLocaleString()} تومان*`);
}

async function cmdCharge(msg, env) {
  await send(msg.from.id,
    `💳 برای شارژ حساب به آیدی زیر پیام دهید:\n📲 @${SUPPORT}\n🆔 آیدی شما: \`${msg.from.id}\`\n_(جهت دریافت الزامی است)_`
  );
}

async function cmdWithdraw(msg, env) {
  const bal = await getBal(env,msg.from.id);
  if (bal < MIN_WITHDRAW) {
    await send(msg.from.id,
      `❌ حداقل برداشت *${MIN_WITHDRAW.toLocaleString()} تومان* است!\n💰 موجودی: ${bal.toLocaleString()} تومان`
    );
    return;
  }
  await send(msg.from.id,
    `💸 برای برداشت به آیدی زیر پیام دهید:\n📲 @${SUPPORT}\n💰 موجودی: *${bal.toLocaleString()} تومان*\n🆔 آیدی شما: \`${msg.from.id}\`\n_(برای برداشت الزامی است)_`
  );
}

async function cmdStats(msg, env) {
  const s = await getStats(env,msg.from.id);
  const total = s.win+s.lose+s.draw;
  const wr = total ? ((s.win/total)*100).toFixed(1) : 0;
  await send(msg.from.id,
    `📊 *آمار بازی‌های شما*\n\n✅ برد: ${s.win}\n❌ باخت: ${s.lose}\n🤝 مساوی: ${s.draw}\n🎯 کل: ${total}\n📈 نرخ برد: ${wr}%\n🔥 بهترین پیاپی: ${s.best}\n⚡ پیاپی فعلی: ${s.streak}`
  );
}

async function cmdLeader(msg, env) {
  const users = await allUsers(env);
  const entries = [];
  for (const u of users) {
    const s = await getStats(env,u);
    if (s.win+s.lose+s.draw>0) entries.push({uid:u,...s});
  }
  entries.sort((a,b)=>b.win-a.win||a.lose-b.lose);
  if (!entries.length) { await send(msg.from.id,"🏆 هنوز هیچ بازی‌ای ثبت نشده!"); return; }
  const medals = ["🥇","🥈","🥉","🏅","🏅","🏅","🏅","🏅","🏅","🏅"];
  let text = "🏆 *برترین بازیکنان*\n\n";
  for (let i=0;i<Math.min(10,entries.length);i++) {
    const e=entries[i];
    const tot=e.win+e.lose+e.draw;
    const wr=((e.win/tot)*100).toFixed(1);
    const bal=await getBal(env,e.uid);
    text+=`${medals[i]} \`${e.uid.slice(0,6)}...\` | برد:${e.win} | ${wr}% | 💰${bal.toLocaleString()}\n`;
  }
  await send(msg.from.id,text);
}

async function cmdRef(msg, env) {
  const uid = msg.from.id;
  const username = await getBotUser(env);
  const link = `https://t.me/${username}?start=${uid}`;
  const list = await getRefList(env,uid);
  await send(uid,
    `🔗 *لینک دعوت شما:*\n\`${link}\`\n\n👥 دعوت‌شدگان: *${list.length} نفر*\n💰 درآمد رفرال: *${(list.length*REFERRAL_BONUS).toLocaleString()} تومان*\n\n🎁 هر دعوت = ${REFERRAL_BONUS.toLocaleString()} تومان`
  );
}

async function cmdStartGame(msg, env) {
  const uid = String(msg.from.id);
  const bal = await getBal(env,uid);
  if (bal < GAME_COST) {
    await send(msg.from.id,`❌ موجودی کافی نیست!\n💰 نیاز: ${GAME_COST.toLocaleString()} | موجودی: ${bal.toLocaleString()} تومان`);
    return;
  }
  if (await getUserGame(env,uid)) { await send(msg.from.id,"⚠️ در یک بازی فعال هستید!"); return; }
  const w = await getWaiting(env);
  if (w.includes(uid)) { await send(msg.from.id,"⏳ در صف انتظار هستید!"); return; }

  await addWaiting(env,uid);
  await send(msg.from.id,
    `🔍 *در حال جستجوی حریف...*\n⏱ حداکثر ${WAIT_TIME} ثانیه\n💰 هزینه: ${GAME_COST.toLocaleString()} تومان`,
    {reply_markup:cancelKB()}
  );
  await matchPlayers(env);
}

async function cmdCancel(msg, env) {
  const uid = msg.from.id;
  const adm = await isAdmin(env,uid);
  if (await rmWaiting(env,uid)) {
    await send(uid,"✅ جستجو لغو شد.",{reply_markup:mainKB(adm,isOwner(uid))});
  } else {
    await send(uid,"⚠️ در صف انتظار نیستید!",{reply_markup:mainKB(adm,isOwner(uid))});
  }
}

// ═══════════════════════════════════════════════════════
//  دستورات ادمین
// ═══════════════════════════════════════════════════════

async function cmdAdminStats(msg, env) {
  const users = await allUsers(env);
  const games = await getGameList(env);
  const waiting = await getWaiting(env);
  let total = 0;
  for (const u of users) total += await getBal(env,u);
  await send(msg.from.id,
    `📊 *آمار کلی ربات*\n\n👥 کاربران: ${users.length}\n🎮 بازی‌های فعال: ${games.length}\n⏳ صف انتظار: ${waiting.length}\n💰 مجموع موجودی: ${total.toLocaleString()} تومان`
  );
}

async function cmdAdminAdd(msg, env) {
  const [,uid,val] = (msg.text||"").split(/\s+/);
  if (!uid||!val) { await send(msg.from.id,"❌ /add [آیدی] [مقدار]"); return; }
  const nb = await addBal(env,uid,parseFloat(val),"افزودن دستی");
  await send(msg.from.id,`✅ اضافه شد. موجودی: ${nb.toLocaleString()} تومان`);
}

async function cmdAdminRem(msg, env) {
  const [,uid,val] = (msg.text||"").split(/\s+/);
  if (!uid||!val) { await send(msg.from.id,"❌ /remove [آیدی] [مقدار]"); return; }
  const ok = await rmBal(env,uid,parseFloat(val),"کسر دستی");
  const nb = await getBal(env,uid);
  await send(msg.from.id, ok ? `✅ کسر شد. موجودی: ${nb.toLocaleString()}` : "❌ موجودی کافی نیست!");
}

async function cmdAdminBal(msg, env) {
  const [,uid] = (msg.text||"").split(/\s+/);
  if (!uid) { await send(msg.from.id,"❌ /bal [آیدی]"); return; }
  const b = await getBal(env,uid);
  await send(msg.from.id,`💰 موجودی \`${uid}\`: ${b.toLocaleString()} تومان`);
}

async function cmdEndgame(msg, env) {
  const [,gid] = (msg.text||"").split(/\s+/);
  if (!gid) { await send(msg.from.id,"❌ /endgame [gid]"); return; }
  const g = await getGame(env,gid);
  if (!g) { await send(msg.from.id,"❌ بازی پیدا نشد!"); return; }
  await addBal(env,g.p1,GAME_COST,"لغو بازی");
  await addBal(env,g.p2,GAME_COST,"لغو بازی");
  await delGame(env,gid);
  for (const pid of [g.p1,g.p2]) {
    const adm = await isAdmin(env,pid);
    await send(pid,`⚠️ بازی توسط ادمین لغو شد. ${GAME_COST.toLocaleString()} تومان برگشت داده شد.`,
      {reply_markup:mainKB(adm,isOwner(pid))});
  }
  await send(msg.from.id,`✅ بازی \`${gid}\` لغو شد.`);
}

// ─── مدیریت ادمین (فقط مالک) ───────────────────────────

async function cmdAdminMenu(msg, env) {
  const admins = await getAdmins(env);
  let text = "👤 *ادمین‌های ربات:*\n\n";
  admins.forEach((a,i) => {
    text += `${i+1}. \`${a}\`${a===String(OWNER_ID)?" 👑":""}\n`;
  });
  text += "\n📌 دستورات:\n/addadmin [آیدی]\n/remadmin [آیدی]\n/admins";
  await send(msg.from.id,text);
}

async function cmdAddAdmin(msg, env) {
  const [,uid] = (msg.text||"").split(/\s+/);
  if (!uid) { await send(msg.from.id,"❌ /addadmin [آیدی]"); return; }
  const ok = await addAdmin(env,uid);
  if (ok) {
    await send(msg.from.id,`✅ \`${uid}\` به عنوان ادمین اضافه شد.`);
    try { await send(uid,"🎉 شما به عنوان ادمین ربات تعیین شدید!"); } catch{}
  } else {
    await send(msg.from.id,"⚠️ این کاربر قبلاً ادمین است!");
  }
}

async function cmdRemAdmin(msg, env) {
  const [,uid] = (msg.text||"").split(/\s+/);
  if (!uid) { await send(msg.from.id,"❌ /remadmin [آیدی]"); return; }
  if (uid===String(OWNER_ID)) { await send(msg.from.id,"❌ نمیتوانید مالک را حذف کنید!"); return; }
  const ok = await rmAdmin(env,uid);
  if (ok) {
    await send(msg.from.id,`✅ \`${uid}\` از ادمین‌ها حذف شد.`);
    try { await send(uid,"⚠️ دسترسی ادمین شما حذف شد."); } catch{}
  } else {
    await send(msg.from.id,"❌ این کاربر ادمین نیست!");
  }
}

async function cmdListAdmins(msg, env) {
  const admins = await getAdmins(env);
  let text = "👤 *لیست ادمین‌ها:*\n\n";
  admins.forEach((a,i) => text+=`${i+1}. \`${a}\`${a===String(OWNER_ID)?" 👑":""}\n`);
  await send(msg.from.id,text);
}

// ─── عضویت اجباری ───────────────────────────────────────

async function cmdMandatoryMenu(msg, env) {
  const list = await getMandatory(env);
  const own = isOwner(msg.from.id);
  let text = "📋 *عضویت اجباری*\n\n";
  if (!list.length) {
    text += "هیچ کانال/گروهی تعریف نشده.\n\n";
  } else {
    list.forEach((c,i) => {
      text += `${i+1}. ${c.type==="channel"?"📢":"👥"} *${c.title}*\n   ID: \`${c.id}\`\n`;
    });
  }
  text += "\n📌 دستورات:\n";
  text += "/addch [آیدی] [یوزرنیم یا -] [عنوان] — کانال عمومی\n";
  text += "/addch_private — کانال/گروه خصوصی (مرحله‌ای)\n";
  text += "/addgroup [آیدی] [یوزرنیم یا -] [عنوان] — گروه عمومی\n";
  text += "/rmch [آیدی] — حذف\n";
  text += "/channels — لیست";
  await send(msg.from.id,text,{reply_markup:adminKB(own)});
}

async function cmdAddMandatory(msg, env, type) {
  // فرمت: /addch -100123456 username عنوان کانال
  //        /addch -100123456 - عنوان بدون یوزرنیم (خصوصی)
  const parts = (msg.text||"").trim().split(/\s+/);
  if (parts.length < 3) {
    await send(msg.from.id,`❌ فرمت: /${type==="channel"?"addch":"addgroup"} [آیدی] [یوزرنیم یا -] [عنوان]`);
    return;
  }
  const id       = parts[1];
  const username = parts[2]==="-" ? null : parts[2];
  const title    = parts.slice(3).join(" ") || (username||id);
  const link     = username ? `https://t.me/${username}` : null;
  const ok = await addMandatory(env,{id,type,title,username,link});
  const own = isOwner(msg.from.id);
  if (ok) {
    await send(msg.from.id,`✅ ${type==="channel"?"کانال":"گروه"} *${title}* اضافه شد!`,{reply_markup:adminKB(own)});
  } else {
    await send(msg.from.id,"⚠️ این آیدی قبلاً اضافه شده!",{reply_markup:adminKB(own)});
  }
}

async function cmdRmMandatory(msg, env) {
  const [,id] = (msg.text||"").split(/\s+/);
  if (!id) { await send(msg.from.id,"❌ /rmch [آیدی]"); return; }
  const ok = await rmMandatory(env,id);
  const own = isOwner(msg.from.id);
  await send(msg.from.id, ok ? "✅ حذف شد." : "❌ پیدا نشد!",{reply_markup:adminKB(own)});
}

async function cmdListMandatory(msg, env) {
  const list = await getMandatory(env);
  if (!list.length) { await send(msg.from.id,"📋 هیچ کانال/گروهی تعریف نشده."); return; }
  let text = "📋 *کانال/گروه‌های اجباری:*\n\n";
  list.forEach((c,i) => {
    text += `${i+1}. ${c.type==="channel"?"📢":"👥"} *${c.title}*\n`;
    text += `   ID: \`${c.id}\`\n`;
    if (c.username) text += `   یوزرنیم: @${c.username}\n`;
    text += `   نوع: ${c.type==="channel"?"کانال":"گروه"}\n\n`;
  });
  await send(msg.from.id,text);
}
