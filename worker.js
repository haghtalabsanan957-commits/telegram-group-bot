// ═══════════════════════════════════════════════════════════════
//  ربات سنگ‌کاغذ‌قیچی - Cloudflare Worker
//  دیتابیس: Cloudflare KV
// ═══════════════════════════════════════════════════════════════

// ─── تنظیمات ───────────────────────────────────────────────────
const TOKEN          = "8874190064:AAGuoPMjrOPZvsvsNtjB9oaOA1_Wp1hvI1g";
const ADMIN_IDS      = [8261807538];
const SUPPORT        = "sananhaghtalab";
const GAME_COST      = 10000;
const WIN_REWARD     = 19000;
const ROUNDS         = 5;
const WAIT_TIME      = 30;
const MOVE_TIMEOUT   = 30;
const MIN_WITHDRAW   = 100000;
const REFERRAL_BONUS = 2000;
const API            = `https://api.telegram.org/bot${TOKEN}`;

// BOT_DATA از طریق KV Binding تعریف میشه

// ═══════════════════════════════════════════════════════════════
//  Entry Point
// ═══════════════════════════════════════════════════════════════

// ─── KV namespace باید در Cloudflare تعریف بشه ───
// Variable name: BOT_DATA

addEventListener("fetch", event => {
  event.respondWith(handleRequest(event.request));
});

addEventListener("scheduled", event => {
  event.waitUntil(runScheduled());
});

async function handleRequest(request) {
  if (request.method !== "POST") return new Response("OK");
  try {
    const update = await request.json();
    await handleUpdate(update);
  } catch (e) {
    console.error("fetch error:", e);
  }
  return new Response("OK");
}

// ═══════════════════════════════════════════════════════════════
//  KV Helper Functions
// ═══════════════════════════════════════════════════════════════

async function kvGet(key) {
  try {
    const val = await BOT_DATA.get(key, "json");
    return val;
  } catch { return null; }
}

async function kvSet(key, value) {
  await BOT_DATA.put(key, JSON.stringify(value));
}

async function kvDel(key) {
  await BOT_DATA.delete(key);
}

// ─── موجودی ───────────────────────────────────────────────────

async function getBalance(uid) {
  const bal = await kvGet(`bal:${uid}`);
  return bal ?? 0;
}

async function addBalance(uid, amount, note = "") {
  const cur = await getBalance(uid);
  const newBal = Math.round((cur + amount) * 10000) / 10000;
  await kvSet(`bal:${uid}`, newBal);
  await logTx(uid, amount, note);
  return newBal;
}

async function removeBalance(uid, amount, note = "") {
  const cur = await getBalance(uid);
  if (cur < amount) return false;
  const newBal = Math.round((cur - amount) * 10000) / 10000;
  await kvSet(`bal:${uid}`, newBal);
  await logTx(uid, -amount, note);
  return true;
}

async function logTx(uid, amount, note) {
  const txKey = `tx:${uid}`;
  const txs = (await kvGet(txKey)) || [];
  txs.push({ amount, note, time: new Date().toISOString() });
  if (txs.length > 100) txs.splice(0, txs.length - 100);
  await kvSet(txKey, txs);
}

// ─── آمار ─────────────────────────────────────────────────────

async function getStats(uid) {
  return (await kvGet(`stats:${uid}`)) || { win: 0, lose: 0, draw: 0, streak: 0, best_streak: 0 };
}

async function updateStats(uid, result) {
  const s = await getStats(uid);
  s[result]++;
  if (result === "win") {
    s.streak++;
    s.best_streak = Math.max(s.best_streak, s.streak);
  } else {
    s.streak = 0;
  }
  await kvSet(`stats:${uid}`, s);
}

// ─── کاربران ──────────────────────────────────────────────────

async function registerUser(uid) {
  const users = (await kvGet("users")) || [];
  if (!users.includes(String(uid))) {
    users.push(String(uid));
    await kvSet("users", users);
  }
}

async function getAllUsers() {
  return (await kvGet("users")) || [];
}

// ─── صف انتظار ────────────────────────────────────────────────

async function getWaiting() {
  return (await kvGet("waiting")) || [];
}

async function addToWaiting(uid) {
  const w = await getWaiting();
  if (!w.includes(String(uid))) {
    w.push(String(uid));
    await kvSet("waiting", w);
  }
}

async function removeFromWaiting(uid) {
  const w = await getWaiting();
  const idx = w.indexOf(String(uid));
  if (idx !== -1) {
    w.splice(idx, 1);
    await kvSet("waiting", w);
    return true;
  }
  return false;
}

// ─── بازی ─────────────────────────────────────────────────────

async function getGame(gid) {
  return await kvGet(`game:${gid}`);
}

async function saveGame(gid, game) {
  await kvSet(`game:${gid}`, game);
}

async function deleteGame(gid) {
  await kvDel(`game:${gid}`);
}

async function getUserGame(uid) {
  const gameList = (await kvGet("gamelist")) || [];
  for (const gid of gameList) {
    const g = await getGame(gid);
    if (g && (g.p1 === String(uid) || g.p2 === String(uid))) {
      return { gid, game: g };
    }
  }
  return null;
}

async function createGame(p1, p2) {
  const counter = ((await kvGet("counter")) || 0) + 1;
  await kvSet("counter", counter);
  const gid = `g${counter}`;
  const game = {
    p1: String(p1), p2: String(p2),
    s1: 0, s2: 0,
    r: 1, m1: null, m2: null,
    extra: false,
    created: Date.now()
  };
  await saveGame(gid, game);
  const gameList = (await kvGet("gamelist")) || [];
  gameList.push(gid);
  await kvSet("gamelist", gameList);
  return gid;
}

async function removeGameFromList(gid) {
  const gameList = (await kvGet("gamelist")) || [];
  const idx = gameList.indexOf(gid);
  if (idx !== -1) {
    gameList.splice(idx, 1);
    await kvSet("gamelist", gameList);
  }
}

// ─── تایمر (ذخیره زمان شروع راند) ────────────────────────────

async function setRoundTimer(gid) {
  await kvSet(`timer:${gid}`, Date.now());
}

async function clearRoundTimer(gid) {
  await kvDel(`timer:${gid}`);
}

// ═══════════════════════════════════════════════════════════════
//  Telegram API
// ═══════════════════════════════════════════════════════════════

async function tgRequest(method, params) {
  try {
    const res = await fetch(`${API}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(params)
    });
    return await res.json();
  } catch (e) {
    console.error(`tgRequest ${method} error:`, e);
    return null;
  }
}

async function sendMsg(chatId, text, extra = {}) {
  return tgRequest("sendMessage", {
    chat_id: chatId,
    text,
    parse_mode: "Markdown",
    ...extra
  });
}

async function sendPhoto(chatId, fileId, caption = "", extra = {}) {
  return tgRequest("sendPhoto", {
    chat_id: chatId,
    photo: fileId,
    caption,
    parse_mode: "Markdown",
    ...extra
  });
}

async function sendVideo(chatId, fileId, caption = "", extra = {}) {
  return tgRequest("sendVideo", {
    chat_id: chatId,
    video: fileId,
    caption,
    parse_mode: "Markdown",
    ...extra
  });
}

async function answerCallback(callId, text, showAlert = false) {
  return tgRequest("answerCallbackQuery", {
    callback_query_id: callId,
    text,
    show_alert: showAlert
  });
}

async function editMarkup(chatId, msgId) {
  return tgRequest("editMessageReplyMarkup", {
    chat_id: chatId,
    message_id: msgId,
    reply_markup: { inline_keyboard: [] }
  });
}

async function getBotUsername() {
  let username = await kvGet("bot_username");
  if (!username) {
    const me = await tgRequest("getMe", {});
    username = me?.result?.username || "RockPaperScissors_ARS_Bot";
    await kvSet("bot_username", username);
  }
  return username;
}

// ═══════════════════════════════════════════════════════════════
//  کیبوردها
// ═══════════════════════════════════════════════════════════════

function mainMenu(isAdmin = false) {
  const kb = [
    [{ text: "🎮 شروع بازی" }, { text: "💰 موجودی" }],
    [{ text: "📥 شارژ حساب" }, { text: "📤 برداشت" }],
    [{ text: "📊 آمار من" }, { text: "🏆 لیدربورد" }],
    [{ text: "🔗 دعوت دوستان" }]
  ];
  if (isAdmin) kb.push([{ text: "⚙️ پنل ادمین" }]);
  return { keyboard: kb, resize_keyboard: true };
}

function adminMenu() {
  return {
    keyboard: [
      [{ text: "📊 آمار کل" }],
      [{ text: "➕ افزودن موجودی" }, { text: "➖ کسر موجودی" }],
      [{ text: "📢 پیام همگانی" }, { text: "🏠 منوی اصلی" }]
    ],
    resize_keyboard: true
  };
}

function cancelButton() {
  return {
    keyboard: [[{ text: "❌ لغو جستجو" }]],
    resize_keyboard: true
  };
}

function gameButtons(gid) {
  return {
    inline_keyboard: [[
      { text: "🪨 سنگ",   callback_data: `move:${gid}:rock` },
      { text: "📄 کاغذ",  callback_data: `move:${gid}:paper` },
      { text: "✂️ قیچی", callback_data: `move:${gid}:scissors` }
    ]]
  };
}

// ═══════════════════════════════════════════════════════════════
//  منطق بازی
// ═══════════════════════════════════════════════════════════════

const BEATS = { rock: "scissors", scissors: "paper", paper: "rock" };
const EMOJI_MAP = { rock: "🪨 سنگ", paper: "📄 کاغذ", scissors: "✂️ قیچی" };

function getWinner(m1, m2) {
  if (m1 === m2) return "draw";
  if (BEATS[m1] === m2) return "p1";
  return "p2";
}

function emojiMove(move) {
  return EMOJI_MAP[move] || move;
}

function isAdmin(uid) {
  return ADMIN_IDS.includes(Number(uid));
}

// ═══════════════════════════════════════════════════════════════
//  پردازش راند
// ═══════════════════════════════════════════════════════════════

async function processRound(gid) {
  const game = await getGame(gid);
  if (!game) return;

  const p1 = game.p1, p2 = game.p2;
  const m1 = game.m1, m2 = game.m2;
  const result = getWinner(m1, m2);

  let roundWinner = "";
  if (result === "p1") {
    game.s1++;
    roundWinner = "🏆 برنده راند: بازیکن اول";
  } else if (result === "p2") {
    game.s2++;
    roundWinner = "🏆 برنده راند: بازیکن دوم";
  } else {
    roundWinner = "🤝 این راند مساوی شد";
  }

  const roundDetail = `${emojiMove(m1)} vs ${emojiMove(m2)}\n${roundWinner}`;
  game.m1 = null;
  game.m2 = null;
  game.r++;
  await saveGame(gid, game);
  await clearRoundTimer(gid);

  if (game.r > ROUNDS) {
    const s1 = game.s1, s2 = game.s2;

    if (s1 === s2) {
      // راند تمدیدی
      game.extra = true;
      await saveGame(gid, game);
      for (const pid of [p1, p2]) {
        const myS = pid === p1 ? s1 : s2;
        const opS = pid === p1 ? s2 : s1;
        await sendMsg(pid,
          `📊 *راند ${game.r - 1} نتیجه:*\n${roundDetail}\n\n` +
          `امتیاز: شما ${myS} - ${opS} حریف\n\n` +
          `🔄 *مساوی! راند تمدیدی شروع شد!*`,
          { reply_markup: mainMenu(isAdmin(pid)) }
        );
        await sendMsg(pid, `⏰ ${MOVE_TIMEOUT} ثانیه وقت داری:`,
          { reply_markup: gameButtons(gid) });
      }
      await setRoundTimer(gid);
      return;
    } else {
      // پایان بازی
      for (const pid of [p1, p2]) {
        const myS = pid === p1 ? s1 : s2;
        const opS = pid === p1 ? s2 : s1;
        await sendMsg(pid,
          `📊 *راند ${game.r - 1} نتیجه:*\n${roundDetail}\n\nامتیاز نهایی: شما ${myS} - ${opS} حریف`,
          { reply_markup: mainMenu(isAdmin(pid)) }
        );
      }
      await endGame(gid);
      return;
    }
  }

  // راند بعدی
  for (const pid of [p1, p2]) {
    const myS = pid === p1 ? game.s1 : game.s2;
    const opS = pid === p1 ? game.s2 : game.s1;
    const extraTxt = game.extra ? " (تمدیدی 🔄)" : "";
    await sendMsg(pid,
      `📊 *راند ${game.r - 1} نتیجه:*\n${roundDetail}\n\n` +
      `امتیاز: شما ${myS} - ${opS} حریف\n\n` +
      `🎮 *راند ${game.r}${extraTxt} شروع شد!*\n⏰ ${MOVE_TIMEOUT} ثانیه وقت داری`,
      { reply_markup: mainMenu(isAdmin(pid)) }
    );
    await sendMsg(pid, "✊ حرکت کن:", { reply_markup: gameButtons(gid) });
  }
  await setRoundTimer(gid);
}

// ═══════════════════════════════════════════════════════════════
//  پایان بازی
// ═══════════════════════════════════════════════════════════════

async function endGame(gid, reason = "normal") {
  await clearRoundTimer(gid);
  const game = await getGame(gid);
  if (!game) return;

  const p1 = game.p1, p2 = game.p2;
  const s1 = game.s1, s2 = game.s2;

  if (reason === "timeout_p1" || reason === "timeout_p2") {
    const winner = reason === "timeout_p1" ? p2 : p1;
    const loser  = reason === "timeout_p1" ? p1 : p2;
    for (const pid of [p1, p2]) {
      await sendMsg(pid, "⏰ حریف شما در وقت مقرر حرکت نکرد!",
        { reply_markup: mainMenu(isAdmin(pid)) });
    }
    await finalizeGame(gid, game, winner, loser);
    return;
  }

  if (reason === "timeout_both") {
    await deleteGame(gid);
    await removeGameFromList(gid);
    for (const pid of [p1, p2]) {
      await sendMsg(pid,
        "⏰ *تایم‌اوت!* هر دو بازیکن حرکت نکردند.\n💸 هزینه بازی سوخت.",
        { reply_markup: mainMenu(isAdmin(pid)) }
      );
    }
    return;
  }

  let winner = null, loser = null;
  if (s1 > s2) { winner = p1; loser = p2; }
  else if (s2 > s1) { winner = p2; loser = p1; }

  await finalizeGame(gid, game, winner, loser);
}

async function finalizeGame(gid, game, winner, loser) {
  const p1 = game.p1, p2 = game.p2;
  const s1 = game.s1, s2 = game.s2;

  await deleteGame(gid);
  await removeGameFromList(gid);

  if (winner) {
    await addBalance(winner, WIN_REWARD, `جایزه بازی ${gid}`);
    await updateStats(winner, "win");
    await updateStats(loser, "lose");

    const wBal = await getBalance(winner);
    const lBal = await getBalance(loser);
    const wS = winner === p1 ? s1 : s2;
    const lS = winner === p1 ? s2 : s1;

    await sendMsg(winner,
      `🏆 *تبریک! برنده شدید!*\n\n` +
      `📊 امتیاز نهایی: ${wS} - ${lS}\n` +
      `🎁 جایزه: ${WIN_REWARD.toLocaleString()} تومان\n` +
      `💰 موجودی: ${wBal.toLocaleString()} تومان`,
      { reply_markup: mainMenu(isAdmin(winner)) }
    );
    await sendMsg(loser,
      `❌ *باختید!*\n\n` +
      `📊 امتیاز نهایی: ${lS} - ${wS}\n` +
      `💰 موجودی: ${lBal.toLocaleString()} تومان`,
      { reply_markup: mainMenu(isAdmin(loser)) }
    );
  } else {
    for (const pid of [p1, p2]) {
      await updateStats(pid, "draw");
      const bal = await getBalance(pid);
      await sendMsg(pid,
        `🤝 *بازی مساوی شد!*\n\n📊 امتیاز: ${s1} - ${s2}\n💰 موجودی: ${bal.toLocaleString()} تومان`,
        { reply_markup: mainMenu(isAdmin(pid)) }
      );
    }
  }
}

// ═══════════════════════════════════════════════════════════════
//  Scheduled: تایم‌اوت و صف انتظار
// ═══════════════════════════════════════════════════════════════

async function runScheduled() {
  const now = Date.now();
  const gameList = (await kvGet("gamelist")) || [];

  for (const gid of gameList) {
    const timerStart = await kvGet(`timer:${gid}`);
    if (!timerStart) continue;
    const elapsed = (now - timerStart) / 1000;
    if (elapsed >= MOVE_TIMEOUT) {
      const game = await getGame(gid);
      if (!game) continue;
      if (!game.m1 && !game.m2) {
        await endGame(gid, "timeout_both");
      } else if (!game.m1) {
        await endGame(gid, "timeout_p1");
      } else if (!game.m2) {
        await endGame(gid, "timeout_p2");
      }
    }
  }

  // صف انتظار - تایم‌اوت
  const waitingTimers = (await kvGet("waiting_timers")) || {};
  const waiting = await getWaiting();
  for (const uid of [...waiting]) {
    const joinTime = waitingTimers[uid];
    if (!joinTime) continue;
    const elapsed = (now - joinTime) / 1000;
    if (elapsed >= WAIT_TIME) {
      await removeFromWaiting(uid);
      delete waitingTimers[uid];
      await sendMsg(uid, "❌ *حریفی پیدا نشد!* دوباره امتحان کنید.",
        { reply_markup: mainMenu(isAdmin(uid)) });
    }
  }
  await kvSet("waiting_timers", waitingTimers);

  // جفت کردن بازیکنان در صف
  await matchPlayers();
}

// ═══════════════════════════════════════════════════════════════
//  جفت کردن بازیکنان
// ═══════════════════════════════════════════════════════════════

async function matchPlayers() {
  const waiting = await getWaiting();
  if (waiting.length < 2) return;

  const p1uid = waiting[0];
  const p2uid = waiting[1];

  const p1Bal = await getBalance(p1uid);
  const p2Bal = await getBalance(p2uid);

  if (p1Bal < GAME_COST) {
    await removeFromWaiting(p1uid);
    await sendMsg(p1uid, "❌ موجودی کافی نیست! از صف خارج شدید.",
      { reply_markup: mainMenu(isAdmin(p1uid)) });
    return;
  }
  if (p2Bal < GAME_COST) {
    await removeFromWaiting(p2uid);
    await sendMsg(p2uid, "❌ موجودی کافی نیست! از صف خارج شدید.",
      { reply_markup: mainMenu(isAdmin(p2uid)) });
    return;
  }

  await removeFromWaiting(p1uid);
  await removeFromWaiting(p2uid);

  await removeBalance(p1uid, GAME_COST, "هزینه بازی");
  await removeBalance(p2uid, GAME_COST, "هزینه بازی");

  const gid = await createGame(p1uid, p2uid);

  for (const pid of [p1uid, p2uid]) {
    await sendMsg(pid,
      `🎮 *حریف پیدا شد!*\n\n` +
      `💸 ${GAME_COST.toLocaleString()} تومان از حساب شما کسر شد.\n` +
      `📊 راند *1* از ${ROUNDS}\nامتیاز: 0 - 0\n\n⏰ ${MOVE_TIMEOUT} ثانیه وقت داری!`,
      { reply_markup: mainMenu(isAdmin(pid)) }
    );
    await sendMsg(pid, "✊ حرکت خود را انتخاب کنید:", { reply_markup: gameButtons(gid) });
  }
  await setRoundTimer(gid);
}

// ═══════════════════════════════════════════════════════════════
//  پردازش Update
// ═══════════════════════════════════════════════════════════════

async function handleUpdate(update) {
  if (update.callback_query) {
    await handleCallback(update.callback_query);
    return;
  }
  if (!update.message) return;
  const msg = update.message;
  const uid = msg.from.id;
  const text = msg.text || "";

  // ثبت کاربر
  await registerUser(uid);

  // state machine برای ادمین
  const state = await kvGet(`state:${uid}`);
  if (state) {
    await handleState(msg, state);
    return;
  }

  // دستورات
  if (text.startsWith("/start")) {
    await cmdStart(msg);
  } else if (text === "💰 موجودی") {
    await cmdBalance(msg);
  } else if (text === "📥 شارژ حساب") {
    await cmdCharge(msg);
  } else if (text === "📤 برداشت") {
    await cmdWithdraw(msg);
  } else if (text === "📊 آمار من") {
    await cmdMyStats(msg);
  } else if (text === "🏆 لیدربورد") {
    await cmdLeaderboard(msg);
  } else if (text === "🔗 دعوت دوستان") {
    await cmdReferral(msg);
  } else if (text === "🎮 شروع بازی") {
    await cmdStartGame(msg);
  } else if (text === "❌ لغو جستجو") {
    await cmdCancelSearch(msg);
  } else if (text === "⚙️ پنل ادمین" && isAdmin(uid)) {
    await sendMsg(uid, "⚙️ *پنل مدیریت*", { reply_markup: adminMenu() });
  } else if (text === "🏠 منوی اصلی") {
    await sendMsg(uid, "🏠 منوی اصلی", { reply_markup: mainMenu(isAdmin(uid)) });
  } else if (text === "📊 آمار کل" && isAdmin(uid)) {
    await cmdAdminStats(msg);
  } else if (text === "➕ افزودن موجودی" && isAdmin(uid)) {
    await kvSet(`state:${uid}`, "admin_add");
    await sendMsg(uid, "🆔 آیدی کاربر و مقدار (تومان) را بفرستید:\nمثال: `123456789 10000`");
  } else if (text === "➖ کسر موجودی" && isAdmin(uid)) {
    await kvSet(`state:${uid}`, "admin_remove");
    await sendMsg(uid, "🆔 آیدی کاربر و مقدار (تومان) را بفرستید:\nمثال: `123456789 10000`");
  } else if (text === "📢 پیام همگانی" && isAdmin(uid)) {
    await kvSet(`state:${uid}`, "broadcast");
    await sendMsg(uid, "📝 پیام همگانی خود را بفرستید:\n✅ متن، عکس یا ویدیو مجاز است.");
  } else if (text.startsWith("/add") && isAdmin(uid)) {
    await cmdAdd(msg);
  } else if (text.startsWith("/remove") && isAdmin(uid)) {
    await cmdRemove(msg);
  } else if (text.startsWith("/bal") && isAdmin(uid)) {
    await cmdBal(msg);
  } else if (text.startsWith("/endgame") && isAdmin(uid)) {
    await cmdEndgame(msg);
  }
}

// ─── State Machine ─────────────────────────────────────────────

async function handleState(msg, state) {
  const uid = msg.from.id;
  await kvDel(`state:${uid}`);

  if (state === "admin_add") {
    const parts = (msg.text || "").trim().split(/\s+/);
    if (parts.length < 2) { await sendMsg(uid, "❌ فرمت اشتباه!"); return; }
    const [targetUid, val] = [parseInt(parts[0]), parseFloat(parts[1])];
    if (isNaN(targetUid) || isNaN(val)) { await sendMsg(uid, "❌ مقدار نامعتبر!"); return; }
    await addBalance(targetUid, val, "افزودن دستی ادمین");
    const newBal = await getBalance(targetUid);
    await sendMsg(uid,
      `✅ *${val.toLocaleString()} تومان* به \`${targetUid}\` اضافه شد.\n💰 موجودی جدید: ${newBal.toLocaleString()} تومان`,
      { reply_markup: adminMenu() }
    );
    try {
      await sendMsg(targetUid,
        `🎁 *${val.toLocaleString()} تومان* توسط ادمین به حساب شما اضافه شد.\n💰 موجودی: ${newBal.toLocaleString()} تومان`
      );
    } catch {}

  } else if (state === "admin_remove") {
    const parts = (msg.text || "").trim().split(/\s+/);
    if (parts.length < 2) { await sendMsg(uid, "❌ فرمت اشتباه!"); return; }
    const [targetUid, val] = [parseInt(parts[0]), parseFloat(parts[1])];
    if (isNaN(targetUid) || isNaN(val)) { await sendMsg(uid, "❌ مقدار نامعتبر!"); return; }
    const ok = await removeBalance(targetUid, val, "کسر دستی ادمین");
    const newBal = await getBalance(targetUid);
    if (ok) {
      await sendMsg(uid,
        `✅ *${val.toLocaleString()} تومان* از \`${targetUid}\` کسر شد.\n💰 موجودی جدید: ${newBal.toLocaleString()} تومان`,
        { reply_markup: adminMenu() }
      );
      try {
        await sendMsg(targetUid,
          `⚠️ *${val.toLocaleString()} تومان* توسط ادمین از حساب شما کسر شد.\n💰 موجودی: ${newBal.toLocaleString()} تومان`
        );
      } catch {}
    } else {
      await sendMsg(uid, `❌ موجودی کاربر کافی نیست! (موجودی: ${newBal.toLocaleString()} تومان)`);
    }

  } else if (state === "broadcast") {
    await doBroadcast(msg);
  }
}

// ═══════════════════════════════════════════════════════════════
//  دستورات
// ═══════════════════════════════════════════════════════════════

async function cmdStart(msg) {
  const uid = msg.from.id;
  const parts = (msg.text || "").split(" ");

  // رفرال
  if (parts.length > 1 && parts[1] !== String(uid)) {
    const refCode = parts[1];
    const alreadyReferred = await kvGet(`ref:${uid}`);
    if (!alreadyReferred) {
      await kvSet(`ref:${uid}`, refCode);
      const refList = (await kvGet(`reflist:${refCode}`)) || [];
      if (!refList.includes(String(uid))) {
        refList.push(String(uid));
        await kvSet(`reflist:${refCode}`, refList);
        await addBalance(refCode, REFERRAL_BONUS, "هدیه رفرال");
        try {
          await sendMsg(refCode, `🎁 یک نفر با لینک شما عضو شد! ${REFERRAL_BONUS.toLocaleString()} تومان به حسابت اضافه شد.`);
        } catch {}
      }
    }
  }

  await sendMsg(uid,
    `🤖 *ربات سنگ‌کاغذ‌قیچی حرفه‌ای*\n\n` +
    `🎮 هر بازی: ${GAME_COST.toLocaleString()} تومان\n` +
    `🏆 جایزه برنده: ${WIN_REWARD.toLocaleString()} تومان\n` +
    `📞 پشتیبانی: @${SUPPORT}`,
    { reply_markup: mainMenu(isAdmin(uid)) }
  );
}

async function cmdBalance(msg) {
  const bal = await getBalance(msg.from.id);
  await sendMsg(msg.from.id, `💰 موجودی: *${bal.toLocaleString()} تومان*`);
}

async function cmdCharge(msg) {
  await sendMsg(msg.from.id,
    `💳 برای شارژ حساب به آیدی زیر پیام دهید:\n` +
    `📲 @${SUPPORT}\n` +
    `🆔 آیدی شما: \`${msg.from.id}\`\n` +
    `_(جهت دریافت الزامی است)_`
  );
}

async function cmdWithdraw(msg) {
  const bal = await getBalance(msg.from.id);
  if (bal < MIN_WITHDRAW) {
    await sendMsg(msg.from.id,
      `❌ حداقل موجودی برای برداشت *${MIN_WITHDRAW.toLocaleString()} تومان* است!\n` +
      `💰 موجودی فعلی: ${bal.toLocaleString()} تومان`
    );
    return;
  }
  await sendMsg(msg.from.id,
    `💸 برای برداشت به آیدی زیر پیام دهید:\n` +
    `📲 @${SUPPORT}\n` +
    `💰 موجودی: *${bal.toLocaleString()} تومان*\n` +
    `🆔 آیدی شما: \`${msg.from.id}\`\n` +
    `_(برای برداشت الزامی است)_`
  );
}

async function cmdMyStats(msg) {
  const s = await getStats(msg.from.id);
  const total = s.win + s.lose + s.draw;
  const wr = total ? ((s.win / total) * 100).toFixed(1) : 0;
  await sendMsg(msg.from.id,
    `📊 *آمار بازی‌های شما*\n\n` +
    `✅ برد: ${s.win}\n❌ باخت: ${s.lose}\n🤝 مساوی: ${s.draw}\n` +
    `🎯 کل: ${total}\n📈 نرخ برد: ${wr}%\n` +
    `🔥 بهترین پیاپی: ${s.best_streak}\n⚡ پیاپی فعلی: ${s.streak}`
  );
}

async function cmdLeaderboard(msg) {
  const users = await getAllUsers();
  const entries = [];
  for (const uid of users) {
    const s = await getStats(uid);
    if (s.win + s.lose + s.draw > 0) {
      entries.push({ uid, ...s });
    }
  }
  entries.sort((a, b) => b.win - a.win || a.lose - b.lose);
  const top = entries.slice(0, 10);
  if (!top.length) {
    await sendMsg(msg.from.id, "🏆 هنوز هیچ بازی‌ای ثبت نشده!");
    return;
  }
  const medals = ["🥇","🥈","🥉","🏅","🏅","🏅","🏅","🏅","🏅","🏅"];
  let text = "🏆 *برترین بازیکنان*\n\n";
  for (let i = 0; i < top.length; i++) {
    const e = top[i];
    const total = e.win + e.lose + e.draw;
    const wr = ((e.win / total) * 100).toFixed(1);
    const bal = await getBalance(e.uid);
    text += `${medals[i]} \`${e.uid.slice(0,6)}...\` | برد:${e.win} باخت:${e.lose} | ${wr}% | 💰${bal.toLocaleString()} تومان\n`;
  }
  await sendMsg(msg.from.id, text);
}

async function cmdReferral(msg) {
  const uid = msg.from.id;
  const username = await getBotUsername();
  const link = `https://t.me/${username}?start=${uid}`;
  const refList = (await kvGet(`reflist:${uid}`)) || [];
  const count = refList.length;
  const earned = count * REFERRAL_BONUS;
  await sendMsg(uid,
    `🔗 *لینک دعوت شما:*\n\`${link}\`\n\n` +
    `👥 تعداد دعوت‌شدگان: *${count} نفر*\n` +
    `💰 درآمد رفرال: *${earned.toLocaleString()} تومان*\n\n` +
    `🎁 به ازای هر نفر دعوت‌شده *${REFERRAL_BONUS.toLocaleString()} تومان* دریافت می‌کنید!\nلینک را کپی کنید و برای دوستانتان بفرستید 👆`
  );
}

async function cmdStartGame(msg) {
  const uid = String(msg.from.id);
  const bal = await getBalance(uid);

  if (bal < GAME_COST) {
    await sendMsg(msg.from.id,
      `❌ موجودی کافی نیست!\n` +
      `💰 نیاز: ${GAME_COST.toLocaleString()} تومان | موجودی: ${bal.toLocaleString()} تومان\n` +
      `📥 برای شارژ از دکمه شارژ حساب استفاده کنید.`
    );
    return;
  }

  const activeGame = await getUserGame(uid);
  if (activeGame) {
    await sendMsg(msg.from.id, "⚠️ شما در حال حاضر در یک بازی فعال هستید!");
    return;
  }

  const waiting = await getWaiting();
  if (waiting.includes(uid)) {
    await sendMsg(msg.from.id, "⏳ قبلاً در صف انتظار هستید!");
    return;
  }

  await addToWaiting(uid);

  // زمان ورود به صف
  const waitingTimers = (await kvGet("waiting_timers")) || {};
  waitingTimers[uid] = Date.now();
  await kvSet("waiting_timers", waitingTimers);

  await sendMsg(msg.from.id,
    `🔍 *در حال جستجوی حریف...*\n⏱ حداکثر ${WAIT_TIME} ثانیه\n💰 هزینه: ${GAME_COST.toLocaleString()} تومان`,
    { reply_markup: cancelButton() }
  );

  // تلاش فوری برای جفت کردن
  await matchPlayers();
}

async function cmdCancelSearch(msg) {
  const uid = msg.from.id;
  const removed = await removeFromWaiting(uid);
  if (removed) {
    const waitingTimers = (await kvGet("waiting_timers")) || {};
    delete waitingTimers[String(uid)];
    await kvSet("waiting_timers", waitingTimers);
    await sendMsg(uid, "✅ جستجو لغو شد.", { reply_markup: mainMenu(isAdmin(uid)) });
  } else {
    await sendMsg(uid, "⚠️ در حال جستجو نیستید!", { reply_markup: mainMenu(isAdmin(uid)) });
  }
}

// ═══════════════════════════════════════════════════════════════
//  دستورات ادمین
// ═══════════════════════════════════════════════════════════════

async function cmdAdminStats(msg) {
  const users = await getAllUsers();
  const gameList = (await kvGet("gamelist")) || [];
  const waiting = await getWaiting();
  let totalBal = 0;
  for (const uid of users) {
    totalBal += await getBalance(uid);
  }
  await sendMsg(msg.from.id,
    `📊 *آمار کلی ربات*\n\n` +
    `👥 کاربران: ${users.length}\n` +
    `🎮 بازی‌های فعال: ${gameList.length}\n` +
    `⏳ صف انتظار: ${waiting.length}\n` +
    `💰 مجموع موجودی: ${totalBal.toLocaleString()} تومان`
  );
}

async function cmdAdd(msg) {
  const parts = (msg.text || "").split(/\s+/);
  if (parts.length < 3) { await sendMsg(msg.from.id, "❌ /add [آیدی] [مقدار]"); return; }
  const uid = parseInt(parts[1]), val = parseFloat(parts[2]);
  await addBalance(uid, val, "افزودن دستی ادمین");
  const bal = await getBalance(uid);
  await sendMsg(msg.from.id, `✅ ${val.toLocaleString()} تومان به \`${uid}\` اضافه شد.\n💰 موجودی: ${bal.toLocaleString()} تومان`);
}

async function cmdRemove(msg) {
  const parts = (msg.text || "").split(/\s+/);
  if (parts.length < 3) { await sendMsg(msg.from.id, "❌ /remove [آیدی] [مقدار]"); return; }
  const uid = parseInt(parts[1]), val = parseFloat(parts[2]);
  const ok = await removeBalance(uid, val, "کسر دستی ادمین");
  const bal = await getBalance(uid);
  if (ok) {
    await sendMsg(msg.from.id, `✅ ${val.toLocaleString()} تومان از \`${uid}\` کسر شد.\n💰 موجودی: ${bal.toLocaleString()} تومان`);
  } else {
    await sendMsg(msg.from.id, "❌ موجودی کافی نیست!");
  }
}

async function cmdBal(msg) {
  const parts = (msg.text || "").split(/\s+/);
  if (parts.length < 2) { await sendMsg(msg.from.id, "❌ /bal [آیدی]"); return; }
  const uid = parseInt(parts[1]);
  const bal = await getBalance(uid);
  await sendMsg(msg.from.id, `💰 موجودی \`${uid}\`: ${bal.toLocaleString()} تومان`);
}

async function cmdEndgame(msg) {
  const parts = (msg.text || "").split(/\s+/);
  if (parts.length < 2) { await sendMsg(msg.from.id, "❌ /endgame [gid]"); return; }
  const gid = parts[1];
  const game = await getGame(gid);
  if (!game) { await sendMsg(msg.from.id, "❌ بازی پیدا نشد!"); return; }
  await addBalance(game.p1, GAME_COST, "لغو بازی توسط ادمین");
  await addBalance(game.p2, GAME_COST, "لغو بازی توسط ادمین");
  await deleteGame(gid);
  await removeGameFromList(gid);
  for (const pid of [game.p1, game.p2]) {
    await sendMsg(pid, `⚠️ بازی توسط ادمین لغو شد. ${GAME_COST.toLocaleString()} تومان به حسابت برگشت داده شد.`,
      { reply_markup: mainMenu(isAdmin(pid)) });
  }
  await sendMsg(msg.from.id, `✅ بازی \`${gid}\` لغو شد.`);
}

// ─── پیام همگانی ──────────────────────────────────────────────

async function doBroadcast(msg) {
  const uid = msg.from.id;
  if (!isAdmin(uid)) return;
  const users = await getAllUsers();
  let ok = 0, fail = 0;
  const caption = msg.caption || msg.text || "";

  for (const targetUid of users) {
    try {
      if (msg.photo) {
        await sendPhoto(targetUid, msg.photo[msg.photo.length - 1].file_id, caption);
      } else if (msg.video) {
        await sendVideo(targetUid, msg.video.file_id, caption);
      } else if (msg.text) {
        await sendMsg(targetUid, msg.text);
      }
      ok++;
    } catch { fail++; }
    await new Promise(r => setTimeout(r, 50));
  }
  await sendMsg(uid,
    `✅ ارسال شد!\n📨 موفق: ${ok} | ❌ ناموفق: ${fail}\n👥 کل کاربران: ${users.length}`,
    { reply_markup: adminMenu() }
  );
}

// ═══════════════════════════════════════════════════════════════
//  پردازش Callback (حرکت بازی)
// ═══════════════════════════════════════════════════════════════

async function handleCallback(call) {
  const data = call.data || "";
  const uid = String(call.from.id);

  if (!data.startsWith("move:")) return;

  const parts = data.split(":");
  const gid = parts[1];
  const move = parts[2];

  const game = await getGame(gid);
  if (!game) {
    await answerCallback(call.id, "⚠️ این بازی دیگر وجود ندارد!", true);
    return;
  }

  if (game.p1 === uid) {
    if (game.m1) { await answerCallback(call.id, "⏳ منتظر حریف باش...", true); return; }
    game.m1 = move;
  } else if (game.p2 === uid) {
    if (game.m2) { await answerCallback(call.id, "⏳ منتظر حریف باش...", true); return; }
    game.m2 = move;
  } else {
    await answerCallback(call.id, "⚠️ تو در این بازی نیستی!", true);
    return;
  }

  await saveGame(gid, game);
  await answerCallback(call.id, `✅ ${emojiMove(move)} ثبت شد!`);

  try { await editMarkup(call.message.chat.id, call.message.message_id); } catch {}

  if (game.m1 && game.m2) {
    await clearRoundTimer(gid);
    await processRound(gid);
  }
}
