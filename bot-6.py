import telebot
from flask import Flask
from threading import Thread
import random

# ─── Keep Alive (برای PythonAnywhere) ───────────────────────
_app = Flask(__name__)

@_app.route('/')
def _home():
    return "✅ ربات سنگ‌کاغذ‌قیچی آنلاینه!"

def keep_alive():
    port = random.randint(10000, 60000)
    t = Thread(target=lambda: _app.run(host='0.0.0.0', port=port))
    t.daemon = True
    t.start()

from telebot.types import ReplyKeyboardMarkup, KeyboardButton, InlineKeyboardMarkup, InlineKeyboardButton
import threading
import time
import json
import os
import logging
from datetime import datetime

# ─── تنظیمات اصلی ───────────────────────────────────────────
TOKEN         = "8874190064:AAGuoPMjrOPZvsvsNtjB9oaOA1_Wp1hvI1g"
ADMIN_IDS     = [8261807538]          # می‌تونی چند ادمین بذاری
SUPPORT_USERNAME = "sananhaghtalab"
TOKEN_PRICE   = 10000
GAME_FEE_PCT  = 0                     # بدون کارمزد
WIN_REWARD    = 1.9      # جایزه برنده به RPS
ROUNDS        = 5
WAIT_TIME     = 30                    # ثانیه انتظار برای یافتن حریف
MOVE_TIMEOUT  = 30                    # ثانیه فرصت برای حرکت
GAME_COST     = 1
DATA_FILE     = "game_data.json"

# ─── لاگ‌گذاری ──────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)s | %(message)s",
    handlers=[
        logging.FileHandler("bot.log", encoding="utf-8"),
        logging.StreamHandler()
    ]
)
log = logging.getLogger(__name__)

bot = telebot.TeleBot(TOKEN)

# ═══════════════════════════════════════════════════════════════
#  دیتابیس (JSON)
# ═══════════════════════════════════════════════════════════════

def load_data() -> dict:
    if not os.path.exists(DATA_FILE):
        d = _default_data()
        save_data(d)
        return d
    try:
        with open(DATA_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)
        _ensure_keys(data)
        return data
    except Exception as e:
        log.error(f"load_data error: {e}")
        d = _default_data()
        save_data(d)
        return d

def _default_data() -> dict:
    return {
        "balances":      {str(aid): 100 for aid in ADMIN_IDS},
        "users":         [str(aid) for aid in ADMIN_IDS],  # همه کاربران
        "waiting":       [],
        "games":         {},
        "game_counter":  0,
        "stats":         {},          # تاریخچه آماری هر کاربر
        "referrals":     {},          # کد معرف‌ها
        "transactions":  [],          # لاگ تراکنش‌ها (آخرین ۵۰۰)
    }

def _ensure_keys(data: dict):
    defaults = _default_data()
    for k, v in defaults.items():
        if k not in data:
            data[k] = v
    if "welcomed" not in data:
        data["welcomed"] = []
    if "users" not in data:
        data["users"] = list(data.get("balances", {}).keys())

def save_data(data: dict):
    try:
        with open(DATA_FILE, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=4, ensure_ascii=False)
    except Exception as e:
        log.error(f"save_data error: {e}")

# ─── موجودی ─────────────────────────────────────────────────

def get_balance(user_id) -> float:
    return load_data()["balances"].get(str(user_id), 0)

def add_balance(user_id, amount: float, note: str = ""):
    data = load_data()
    uid = str(user_id)
    data["balances"][uid] = round(data["balances"].get(uid, 0) + amount, 4)
    _log_tx(data, uid, amount, note)
    save_data(data)

def remove_balance(user_id, amount: float, note: str = "") -> bool:
    data = load_data()
    uid = str(user_id)
    if data["balances"].get(uid, 0) >= amount:
        data["balances"][uid] = round(data["balances"][uid] - amount, 4)
        _log_tx(data, uid, -amount, note)
        save_data(data)
        return True
    return False

def _log_tx(data: dict, uid: str, amount: float, note: str):
    data["transactions"].append({
        "uid": uid,
        "amount": amount,
        "note": note,
        "time": datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    })
    if len(data["transactions"]) > 500:
        data["transactions"] = data["transactions"][-500:]

# ─── آمار بازیکن ────────────────────────────────────────────

def update_stats(user_id, result: str):
    """result: 'win' | 'lose' | 'draw'"""
    data = load_data()
    uid = str(user_id)
    s = data["stats"].setdefault(uid, {"win": 0, "lose": 0, "draw": 0, "streak": 0, "best_streak": 0})
    s[result] += 1
    if result == "win":
        s["streak"] += 1
        s["best_streak"] = max(s["best_streak"], s["streak"])
    else:
        s["streak"] = 0
    save_data(data)

def get_stats(user_id) -> dict:
    return load_data()["stats"].get(str(user_id), {"win": 0, "lose": 0, "draw": 0, "streak": 0, "best_streak": 0})

# ─── صف انتظار ──────────────────────────────────────────────

def remove_from_waiting(user_id) -> bool:
    data = load_data()
    uid = str(user_id)
    if uid in data["waiting"]:
        data["waiting"].remove(uid)
        save_data(data)
        return True
    return False

# ═══════════════════════════════════════════════════════════════
#  کیبوردها
# ═══════════════════════════════════════════════════════════════

def main_menu(is_admin=False):
    markup = ReplyKeyboardMarkup(resize_keyboard=True, row_width=2)
    markup.add(KeyboardButton("🎮 شروع بازی"), KeyboardButton("💰 موجودی"))
    markup.add(KeyboardButton("📥 خرید توکن"), KeyboardButton("📤 برداشت توکن"))
    markup.add(KeyboardButton("📊 آمار من"), KeyboardButton("🏆 لیدربورد"))
    markup.add(KeyboardButton("🔗 دعوت دوستان"))
    if is_admin:
        markup.add(KeyboardButton("⚙️ پنل ادمین"))
    return markup

def game_buttons(gid: str):
    markup = InlineKeyboardMarkup(row_width=3)
    markup.add(
        InlineKeyboardButton("🪨 سنگ",   callback_data=f"move:{gid}:rock"),
        InlineKeyboardButton("📄 کاغذ",  callback_data=f"move:{gid}:paper"),
        InlineKeyboardButton("✂️ قیچی", callback_data=f"move:{gid}:scissors"),
    )
    return markup

def cancel_button():
    markup = ReplyKeyboardMarkup(resize_keyboard=True)
    markup.add(KeyboardButton("❌ لغو جستجو"))
    return markup

def admin_menu():
    markup = ReplyKeyboardMarkup(resize_keyboard=True, row_width=2)
    markup.add(KeyboardButton("👥 لیست کاربران"), KeyboardButton("📊 آمار کل"))
    markup.add(KeyboardButton("💸 تراکنش‌ها"), KeyboardButton("🎮 بازی‌های فعال"))
    markup.add(KeyboardButton("➕ افزودن توکن"), KeyboardButton("➖ کسر توکن"))
    markup.add(KeyboardButton("📢 پیام همگانی"), KeyboardButton("🏠 منوی اصلی"))
    return markup

# ═══════════════════════════════════════════════════════════════
#  منطق بازی
# ═══════════════════════════════════════════════════════════════

BEATS = {"rock": "scissors", "scissors": "paper", "paper": "rock"}

def get_winner(m1, m2):
    if m1 == m2:   return "draw"
    if BEATS[m1] == m2: return "p1"
    return "p2"

EMOJI_MAP = {"rock": "🪨 سنگ", "paper": "📄 کاغذ", "scissors": "✂️ قیچی"}
def emoji(move): return EMOJI_MAP.get(move, move)

def is_admin(uid) -> bool:
    return int(uid) in ADMIN_IDS

# ═══════════════════════════════════════════════════════════════
#  تایمر حرکت (تایم‌اوت بازی)
# ═══════════════════════════════════════════════════════════════

move_timers: dict[str, threading.Timer] = {}

def start_move_timer(gid: str):
    cancel_move_timer(gid)

    def on_timeout():
        data = load_data()
        game = data["games"].get(gid)
        if not game:
            return
        # هر کسی که حرکت نکرده، بازنده است
        if not game["m1"] and not game["m2"]:
            # هر دو حرکت نکردن → مساوی محسوب، توکن سوخته
            _end_game(gid, "timeout_both")
        elif not game["m1"]:
            _end_game(gid, "timeout_p1")   # p1 حرکت نکرد → p2 برنده
        elif not game["m2"]:
            _end_game(gid, "timeout_p2")   # p2 حرکت نکرد → p1 برنده

    t = threading.Timer(MOVE_TIMEOUT, on_timeout)
    t.daemon = True
    t.start()

    move_timers[gid] = t

def cancel_move_timer(gid: str):
    t = move_timers.pop(gid, None)
    if t:
        t.cancel()

# ═══════════════════════════════════════════════════════════════
#  پایان بازی / تسویه امتیاز
# ═══════════════════════════════════════════════════════════════

def _end_game(gid: str, reason: str = "normal"):
    cancel_move_timer(gid)
    data = load_data()
    game = data["games"].get(gid)
    if not game:
        return

    p1, p2 = int(game["p1"]), int(game["p2"])
    s1, s2 = game["s1"], game["s2"]

    if reason == "timeout_p1":
        # p1 تایم‌اوت کرد
        _send_result(p1, p2, s1, s2, winner=p2, reason="⏰ حریف شما در وقت مقرر حرکت نکرد!")
        return _finalize(data, gid, loser=p1, winner=p2)

    if reason == "timeout_p2":
        _send_result(p1, p2, s1, s2, winner=p1, reason="⏰ حریف شما در وقت مقرر حرکت نکرد!")
        return _finalize(data, gid, loser=p2, winner=p1)

    if reason == "timeout_both":
        for pid in [p1, p2]:
            bot.send_message(pid,
                "⏰ **تایم‌اوت!** هر دو بازیکن حرکت نکردند.\n💸 هزینه بازی سوخت.",
                reply_markup=main_menu(is_admin(pid)))
        del data["games"][gid]
        save_data(data)
        return

    # پایان عادی — مشخص کردن برنده
    if s1 > s2:
        winner, loser = p1, p2
    elif s2 > s1:
        winner, loser = p2, p1
    else:
        winner, loser = None, None

    _finalize(data, gid, winner=winner, loser=loser)

def _finalize(data: dict, gid: str, winner=None, loser=None):
    game = data["games"].get(gid)
    if not game:
        return
    p1, p2 = int(game["p1"]), int(game["p2"])
    s1, s2 = game["s1"], game["s2"]

    # اول بازی رو از دیتا حذف و ذخیره کن تا بعد از add_balance overwrite نشه
    del data["games"][gid]
    save_data(data)

    if winner:
        prize = WIN_REWARD
        add_balance(winner, prize, note=f"جایزه بازی {gid}")
        update_stats(winner, "win")
        update_stats(loser,  "lose")

        w_bal = get_balance(winner)
        l_bal = get_balance(loser)
        w_s   = s1 if winner == p1 else s2
        l_s   = s2 if winner == p1 else s1

        bot.send_message(winner,
            f"🏆 **تبریک! برنده شدید!**\n\n"
            f"📊 امتیاز نهایی: {w_s} - {l_s}\n"
            f"🎁 جایزه: {prize} RPS\n"
            f"💰 موجودی: {w_bal} RPS",
            reply_markup=main_menu(is_admin(winner)), parse_mode="Markdown")
        bot.send_message(loser,
            f"❌ **باختید!**\n\n"
            f"📊 امتیاز نهایی: {l_s} - {w_s}\n"
            f"💰 موجودی: {l_bal} RPS",
            reply_markup=main_menu(is_admin(loser)), parse_mode="Markdown")
    else:
        # مساوی نهایی
        for pid in [p1, p2]:
            update_stats(pid, "draw")
            bot.send_message(pid,
                f"🤝 **بازی مساوی شد!**\n\n"
                f"📊 امتیاز: {s1} - {s2}\n"
                f"💰 موجودی: {get_balance(pid)} RPS",
                reply_markup=main_menu(is_admin(pid)), parse_mode="Markdown")

def _send_result(p1, p2, s1, s2, winner, reason=""):
    """ارسال نتیجه پایان بازی به هر دو"""
    loser = p2 if winner == p1 else p1
    w_s = s1 if winner == p1 else s2
    l_s = s2 if winner == p1 else s1
    if reason:
        for pid in [p1, p2]:
            bot.send_message(pid, reason, parse_mode="Markdown")

# ═══════════════════════════════════════════════════════════════
#  هندلرهای اصلی
# ═══════════════════════════════════════════════════════════════

@bot.message_handler(commands=["start"])
def cmd_start(msg):
    uid = msg.chat.id

    # ثبت کاربر در لیست users
    _data = load_data()
    if str(uid) not in _data["users"]:
        _data["users"].append(str(uid))
        save_data(_data)

    # ثبت رفرال
    parts = msg.text.split()
    if len(parts) > 1:
        ref_code = parts[1]
        data = load_data()
        if ref_code != str(uid) and str(uid) not in data.get("referred_by", {}):
            data.setdefault("referred_by", {})[str(uid)] = ref_code
            save_data(data)
            try:
                add_balance(int(ref_code), 0.2, "هدیه رفرال (معرف)")
                bot.send_message(int(ref_code), "🎁 یک نفر با لینک شما عضو شد! 0.2 RPS به حسابت اضافه شد.", parse_mode="Markdown")
            except: pass

    bot.send_message(uid,
        "🤖 **ربات سنگ‌کاغذ‌قیچی حرفه‌ای**\n\n"
        f"🎮 هر بازی: {GAME_COST} RPS\n"
        f"🏆 جایزه برنده: {WIN_REWARD} RPS\n"
        f"⏰ فرصت هر حرکت: {MOVE_TIMEOUT} ثانیه\n"
        f"📞 پشتیبانی: @{SUPPORT_USERNAME}",
        reply_markup=main_menu(is_admin(uid)), parse_mode="Markdown")

@bot.message_handler(func=lambda m: m.text == "💰 موجودی")
def show_balance(msg):
    bal = get_balance(msg.chat.id)
    bot.reply_to(msg, f"💰 موجودی: **{bal} RPS**\n💵 معادل: {int(bal * TOKEN_PRICE):,} تومان", parse_mode="Markdown")

@bot.message_handler(func=lambda m: m.text == "📥 خرید توکن")
def buy_token(msg):
    bot.reply_to(msg,
        f"💳 برای خرید به @{SUPPORT_USERNAME} پیام دهید.\n"
        f"💰 قیمت هر RPS: {TOKEN_PRICE:,} تومان\n"
        f"🆔 آیدی شما: `{msg.chat.id}`",
        parse_mode="Markdown")

@bot.message_handler(func=lambda m: m.text == "📤 برداشت توکن")
def withdraw_token(msg):
    bal = get_balance(msg.chat.id)
    MIN_WITHDRAW = 10
    if bal < MIN_WITHDRAW:
        bot.reply_to(msg,
            f"❌ حداقل موجودی برای برداشت **{MIN_WITHDRAW} RPS** است!\n"
            f"💰 موجودی فعلی شما: {bal} RPS",
            parse_mode="Markdown")
        return
    bot.reply_to(msg,
        f"💸 برای برداشت به @{SUPPORT_USERNAME} پیام دهید.\n"
        f"💰 موجودی: **{bal} RPS**\n"
        f"💵 معادل: {int(bal * TOKEN_PRICE):,} تومان\n"
        f"🆔 آیدی شما: `{msg.chat.id}`",
        parse_mode="Markdown")

@bot.message_handler(func=lambda m: m.text == "🔗 دعوت دوستان")
def referral_menu(msg):
    uid = msg.chat.id
    data = load_data()
    # شمارش تعداد دعوت‌شدگان
    referred_by = data.get("referred_by", {})
    count = sum(1 for v in referred_by.values() if v == str(uid))
    earned = round(count * 0.2, 2)
    bot_username = bot.get_me().username
    link = f"https://t.me/{bot_username}?start={uid}"
    bot.reply_to(msg,
        f"🔗 **لینک دعوت شما:**\n"
        f"`{link}`\n\n"
        f"👥 تعداد دعوت‌شدگان: **{count} نفر**\n"
        f"💰 درآمد رفرال: **{earned} RPS**\n\n"
        f"🎁 به ازای هر نفر دعوت‌شده **0.2 RPS** دریافت می‌کنید!\n"
        f"لینک را کپی کنید و برای دوستانتان بفرستید 👆",
        parse_mode="Markdown")

@bot.message_handler(func=lambda m: m.text == "📊 آمار من")
def my_stats(msg):
    s = get_stats(msg.chat.id)
    total = s["win"] + s["lose"] + s["draw"]
    wr = round(s["win"] / total * 100, 1) if total else 0
    bot.reply_to(msg,
        f"📊 **آمار بازی‌های شما**\n\n"
        f"✅ برد: {s['win']}\n"
        f"❌ باخت: {s['lose']}\n"
        f"🤝 مساوی: {s['draw']}\n"
        f"🎯 کل بازی‌ها: {total}\n"
        f"📈 نرخ برد: {wr}%\n"
        f"🔥 بهترین پیاپی: {s['best_streak']}\n"
        f"⚡ پیاپی فعلی: {s['streak']}",
        parse_mode="Markdown")

@bot.message_handler(func=lambda m: m.text == "🏆 لیدربورد")
def leaderboard(msg):
    data = load_data()
    if not data["stats"]:
        bot.reply_to(msg, "🏆 هنوز هیچ بازی‌ای ثبت نشده!")
        return
    ranked = sorted(
        data["stats"].items(),
        key=lambda x: (x[1].get("win", 0), -x[1].get("lose", 0)),
        reverse=True
    )[:10]
    text = "🏆 **برترین بازیکنان**\n\n"
    medals = ["🥇", "🥈", "🥉"] + ["🏅"] * 7
    for i, (uid, s) in enumerate(ranked):
        total = s["win"] + s["lose"] + s["draw"]
        wr = round(s["win"] / total * 100, 1) if total else 0
        bal = data["balances"].get(uid, 0)
        text += f"{medals[i]} `{uid[:6]}...` | برد:{s['win']} باخت:{s['lose']} | {wr}% | 💰{bal} RPS\n"
    bot.reply_to(msg, text, parse_mode="Markdown")

# ─── شروع بازی ──────────────────────────────────────────────

@bot.message_handler(func=lambda m: m.text == "🎮 شروع بازی")
def start_game(msg):
    uid = str(msg.chat.id)

    if get_balance(int(uid)) < GAME_COST:
        bot.reply_to(msg,
            f"❌ موجودی کافی نیست!\n"
            f"💰 نیاز: {GAME_COST} RPS | موجودی: {get_balance(int(uid))} RPS\n"
            f"📥 برای خرید از دکمه خرید RPS استفاده کنید.")
        return

    data = load_data()

    for g in data["games"].values():
        if g["p1"] == uid or g["p2"] == uid:
            bot.reply_to(msg, "⚠️ شما در حال حاضر در یک بازی فعال هستید!")
            return

    if uid in data["waiting"]:
        bot.reply_to(msg, "⏳ قبلاً در صف انتظار هستید!")
        return

    data["waiting"].append(uid)
    save_data(data)

    bot.send_message(msg.chat.id,
        f"🔍 **در حال جستجوی حریف...**\n"
        f"⏱ حداکثر {WAIT_TIME} ثانیه\n"
        f"💰 هزینه: {GAME_COST} RPS",
        reply_markup=cancel_button(), parse_mode="Markdown")

    def search_timer():
        time.sleep(WAIT_TIME)
        if remove_from_waiting(msg.chat.id):
            bot.send_message(msg.chat.id,
                "❌ **حریفی پیدا نشد!** دوباره امتحان کنید.",
                reply_markup=main_menu(is_admin(uid)), parse_mode="Markdown")

    threading.Thread(target=search_timer, daemon=True).start()

    def check_match():
        time.sleep(2)
        data = load_data()
        waiting = data["waiting"]
        if len(waiting) >= 2 and uid in waiting:
            other = [w for w in waiting if w != uid]
            if not other:
                return
            opponent = other[0]

            # چک موجودی حریف
            if get_balance(int(opponent)) < GAME_COST:
                waiting.remove(opponent)
                save_data(data)
                return

            waiting.remove(uid)
            waiting.remove(opponent)
            save_data(data)
            remove_balance(int(uid),      GAME_COST, "هزینه بازی")
            remove_balance(int(opponent), GAME_COST, "هزینه بازی")

            # دیتا رو دوباره لود کن تا تغییرات remove_balance حفظ بشه
            data = load_data()
            gid = f"g{data['game_counter']}"
            data["game_counter"] += 1
            data["games"][gid] = {
                "p1": uid, "p2": opponent,
                "s1": 0,   "s2": 0,
                "r":  1,   "m1": None, "m2": None,
                "extra": False          # آیا در راند تمدیدی هستیم
            }
            save_data(data)

            for pid in [int(uid), int(opponent)]:
                bot.send_message(pid,
                    f"🎮 **حریف پیدا شد!**\n\n"
                    f"💸 {GAME_COST} RPS از حساب شما کسر شد.\n"
                    f"📊 راند **1** از {ROUNDS}\n"
                    f"امتیاز: 0 - 0\n\n"
                    f"⏰ {MOVE_TIMEOUT} ثانیه وقت داری!",
                    reply_markup=main_menu(is_admin(pid)), parse_mode="Markdown")
                bot.send_message(pid, "✊ حرکت خود را انتخاب کنید:", reply_markup=game_buttons(gid))

            start_move_timer(gid)

    threading.Thread(target=check_match, daemon=True).start()

@bot.message_handler(func=lambda m: m.text == "❌ لغو جستجو")
def cancel_search(msg):
    uid = msg.chat.id
    if remove_from_waiting(uid):
        bot.send_message(uid, "✅ جستجو لغو شد.", reply_markup=main_menu(is_admin(uid)))
    else:
        bot.send_message(uid, "⚠️ در حال جستجو نیستید!", reply_markup=main_menu(is_admin(uid)))

# ─── پردازش حرکت ────────────────────────────────────────────

@bot.callback_query_handler(func=lambda call: call.data.startswith("move:"))
def handle_move(call):
    _, gid, move = call.data.split(":")
    uid = str(call.from_user.id)

    data = load_data()
    game = data["games"].get(gid)

    if not game:
        bot.answer_callback_query(call.id, "⚠️ این بازی دیگر وجود ندارد!", show_alert=True)
        return

    if game["p1"] == uid:
        if game["m1"]:
            bot.answer_callback_query(call.id, "⏳ منتظر حریف باش...", show_alert=True)
            return
        game["m1"] = move
    elif game["p2"] == uid:
        if game["m2"]:
            bot.answer_callback_query(call.id, "⏳ منتظر حریف باش...", show_alert=True)
            return
        game["m2"] = move
    else:
        bot.answer_callback_query(call.id, "⚠️ تو در این بازی نیستی!", show_alert=True)
        return

    save_data(data)
    bot.answer_callback_query(call.id, f"✅ {emoji(move)} ثبت شد!")
    try:
        bot.edit_message_reply_markup(call.message.chat.id, call.message.message_id, reply_markup=None)
    except: pass

    if game["m1"] and game["m2"]:
        cancel_move_timer(gid)
        _process_round(gid)

def _process_round(gid: str):
    data = load_data()
    game = data["games"].get(gid)
    if not game:
        return

    p1, p2 = int(game["p1"]), int(game["p2"])
    m1, m2  = game["m1"], game["m2"]
    result  = get_winner(m1, m2)

    if result == "p1":
        game["s1"] += 1
        round_winner = f"🏆 برنده راند: بازیکن اول"
    elif result == "p2":
        game["s2"] += 1
        round_winner = f"🏆 برنده راند: بازیکن دوم"
    else:
        round_winner = "🤝 این راند مساوی شد"

    round_detail = f"{emoji(m1)} vs {emoji(m2)}\n{round_winner}"
    game["m1"] = None
    game["m2"] = None
    game["r"]  += 1
    save_data(data)

    # ─── آیا بازی تموم شده؟
    if game["r"] > ROUNDS:
        s1, s2 = game["s1"], game["s2"]

        if s1 == s2:
            # مساوی: راند اضافه تا برنده مشخص شه
            game["extra"] = True
            data["games"][gid] = game
            save_data(data)
            for pid in [p1, p2]:
                my_s = s1 if pid == p1 else s2
                op_s = s2 if pid == p1 else s1
                bot.send_message(pid,
                    f"📊 **راند {game['r']-1} نتیجه:**\n{round_detail}\n\n"
                    f"امتیاز: شما {my_s} - {op_s} حریف\n\n"
                    f"🔄 **مساوی! راند تمدیدی شروع شد تا برنده مشخص شود!**",
                    parse_mode="Markdown", reply_markup=main_menu(is_admin(pid)))
                bot.send_message(pid, f"⏰ {MOVE_TIMEOUT}ث وقت داری:", reply_markup=game_buttons(gid))
            start_move_timer(gid)
            return
        else:
            # اطلاع آخرین راند
            for pid in [p1, p2]:
                my_s = s1 if pid == p1 else s2
                op_s = s2 if pid == p1 else s1
                bot.send_message(pid,
                    f"📊 **راند {game['r']-1} نتیجه:**\n{round_detail}\n\n"
                    f"امتیاز نهایی: شما {my_s} - {op_s} حریف",
                    parse_mode="Markdown", reply_markup=main_menu(is_admin(pid)))
            _end_game(gid)
            return

    # ─── راند بعدی
    for pid in [p1, p2]:
        my_s = game["s1"] if pid == p1 else game["s2"]
        op_s = game["s2"] if pid == p1 else game["s1"]
        extra_txt = " (تمدیدی 🔄)" if game.get("extra") else ""
        bot.send_message(pid,
            f"📊 **راند {game['r']-1} نتیجه:**\n{round_detail}\n\n"
            f"امتیاز: شما {my_s} - {op_s} حریف\n\n"
            f"🎮 **راند {game['r']}{extra_txt} شروع شد!**\n"
            f"⏰ {MOVE_TIMEOUT} ثانیه وقت داری",
            parse_mode="Markdown", reply_markup=main_menu(is_admin(pid)))
        bot.send_message(pid, "✊ حرکت کن:", reply_markup=game_buttons(gid))

    start_move_timer(gid)

# ═══════════════════════════════════════════════════════════════
#  پنل ادمین
# ═══════════════════════════════════════════════════════════════

def admin_only(func):
    def wrapper(msg):
        if not is_admin(msg.chat.id):
            bot.reply_to(msg, "⛔ دسترسی ندارید!")
            return
        func(msg)
    return wrapper

@bot.message_handler(func=lambda m: m.text == "⚙️ پنل ادمین")
@admin_only
def admin_panel(msg):
    bot.send_message(msg.chat.id, "⚙️ **پنل مدیریت**", reply_markup=admin_menu(), parse_mode="Markdown")

@bot.message_handler(func=lambda m: m.text == "🏠 منوی اصلی")
def back_home(msg):
    bot.send_message(msg.chat.id, "🏠 منوی اصلی", reply_markup=main_menu(is_admin(msg.chat.id)))

@bot.message_handler(func=lambda m: m.text == "📊 آمار کل")
@admin_only
def admin_stats(msg):
    data = load_data()
    total_bal = sum(data["balances"].values())
    active    = len(data["games"])
    waiting   = len(data["waiting"])
    users     = len(data.get("users", data["balances"]))
    total_games = sum(s.get("win", 0) + s.get("lose", 0) for s in data["stats"].values()) // 2
    bot.reply_to(msg,
        f"📊 **آمار کلی ربات**\n\n"
        f"👥 کاربران: {users}\n"
        f"🎮 بازی‌های فعال: {active}\n"
        f"⏳ صف انتظار: {waiting}\n"
        f"🃏 کل بازی‌های انجام‌شده: {total_games}\n"
        f"💰 مجموع موجودی کاربران: {total_bal:.2f} RPS",
        parse_mode="Markdown")

@bot.message_handler(func=lambda m: m.text == "👥 لیست کاربران")
@admin_only
def admin_users(msg):
    data = load_data()
    items = sorted(data["balances"].items(), key=lambda x: x[1], reverse=True)[:20]
    text = "👥 **۲۰ کاربر با بیشترین موجودی**\n\n"
    for uid, bal in items:
        s = data["stats"].get(uid, {})
        text += f"🆔 `{uid}` | 💰{bal} RPS | ✅{s.get('win',0)} ❌{s.get('lose',0)}\n"
    bot.reply_to(msg, text, parse_mode="Markdown")

@bot.message_handler(func=lambda m: m.text == "💸 تراکنش‌ها")
@admin_only
def admin_transactions(msg):
    data = load_data()
    txs = data["transactions"][-15:][::-1]
    if not txs:
        bot.reply_to(msg, "📭 هنوز تراکنشی ثبت نشده.")
        return
    text = "💸 **آخرین ۱۵ تراکنش**\n\n"
    for tx in txs:
        sign = "+" if tx["amount"] > 0 else ""
        text += f"🆔`{tx['uid']}` | {sign}{tx['amount']} | {tx['note']} | {tx['time']}\n"
    bot.reply_to(msg, text, parse_mode="Markdown")

@bot.message_handler(func=lambda m: m.text == "🎮 بازی‌های فعال")
@admin_only
def admin_active_games(msg):
    data = load_data()
    if not data["games"]:
        bot.reply_to(msg, "🎮 هیچ بازی فعالی وجود ندارد.")
        return
    text = "🎮 **بازی‌های فعال**\n\n"
    for gid, g in data["games"].items():
        text += f"🔑 `{gid}` | {g['p1']} vs {g['p2']} | راند {g['r']} | {g['s1']}-{g['s2']}\n"
    bot.reply_to(msg, text, parse_mode="Markdown")

@bot.message_handler(func=lambda m: m.text == "➕ افزودن توکن")
@admin_only
def admin_add_token_prompt(msg):
    sent = bot.reply_to(msg, "🆔 آیدی کاربر و مقدار توکن را بفرستید:\nمثال: `123456789 10`", parse_mode="Markdown")
    bot.register_next_step_handler(sent, admin_add_token_do)

def admin_add_token_do(msg):
    if not is_admin(msg.chat.id):
        return
    try:
        parts = msg.text.strip().split()
        uid, val = int(parts[0]), float(parts[1])
        add_balance(uid, val, "افزودن دستی ادمین")
        bot.reply_to(msg,
            f"✅ **{val} توکن** به `{uid}` اضافه شد.\n"
            f"💰 موجودی جدید: {get_balance(uid)} توکن",
            parse_mode="Markdown", reply_markup=admin_menu())
        try:
            bot.send_message(uid, f"🎁 **{val} RPS** توسط ادمین به حساب شما اضافه شد.\n💰 موجودی: {get_balance(uid)} RPS", parse_mode="Markdown")
        except: pass
    except:
        bot.reply_to(msg, "❌ فرمت اشتباه! مثال: `123456789 10`", parse_mode="Markdown")

@bot.message_handler(func=lambda m: m.text == "➖ کسر توکن")
@admin_only
def admin_remove_token_prompt(msg):
    sent = bot.reply_to(msg, "🆔 آیدی کاربر و مقدار توکن را بفرستید:\nمثال: `123456789 5`", parse_mode="Markdown")
    bot.register_next_step_handler(sent, admin_remove_token_do)

def admin_remove_token_do(msg):
    if not is_admin(msg.chat.id):
        return
    try:
        parts = msg.text.strip().split()
        uid, val = int(parts[0]), float(parts[1])
        if remove_balance(uid, val, "کسر دستی ادمین"):
            bot.reply_to(msg,
                f"✅ **{val} توکن** از `{uid}` کسر شد.\n"
                f"💰 موجودی جدید: {get_balance(uid)} توکن",
                parse_mode="Markdown", reply_markup=admin_menu())
            try:
                bot.send_message(uid, f"⚠️ **{val} RPS** توسط ادمین از حساب شما کسر شد.\n💰 موجودی: {get_balance(uid)} RPS", parse_mode="Markdown")
            except: pass
        else:
            bot.reply_to(msg, f"❌ موجودی کاربر `{uid}` کافی نیست! (موجودی: {get_balance(uid)} RPS)", parse_mode="Markdown")
    except:
        bot.reply_to(msg, "❌ فرمت اشتباه! مثال: `123456789 5`", parse_mode="Markdown")

@bot.message_handler(func=lambda m: m.text == "📢 پیام همگانی")
@admin_only
def broadcast_prompt(msg):
    sent = bot.reply_to(msg, "📝 متن پیام را بفرستید:")
    bot.register_next_step_handler(sent, do_broadcast)

def do_broadcast(msg):
    if not is_admin(msg.chat.id):
        return
    text = msg.text.strip()
    if not text:
        bot.reply_to(msg, "❌ متن خالی!")
        return
    data = load_data()
    ok = fail = 0
    all_users = data.get("users", list(data["balances"].keys()))
    for uid in all_users:
        try:
            bot.send_message(int(uid), f"📢 **اعلان همگانی**\n\n{text}", parse_mode="Markdown")
            ok += 1
        except:
            fail += 1
        time.sleep(0.05)
    bot.reply_to(msg, f"✅ ارسال شد!\n📨 موفق: {ok} | ❌ ناموفق: {fail}\n👥 کل کاربران: {len(all_users)}")

# ─── دستورات ادمین متنی ──────────────────────────────────────

@bot.message_handler(commands=["add"])
@admin_only
def cmd_add(msg):
    parts = msg.text.split()
    if len(parts) != 3:
        bot.reply_to(msg, "❌ /add [آیدی] [مقدار]"); return
    try:
        uid, val = int(parts[1]), float(parts[2])
        add_balance(uid, val, "افزودن دستی ادمین")
        bot.reply_to(msg, f"✅ {val} RPS به `{uid}` اضافه شد.\n💰 موجودی: {get_balance(uid)} RPS", parse_mode="Markdown")
    except:
        bot.reply_to(msg, "❌ خطا!")

@bot.message_handler(commands=["remove"])
@admin_only
def cmd_remove(msg):
    parts = msg.text.split()
    if len(parts) != 3:
        bot.reply_to(msg, "❌ /remove [آیدی] [مقدار]"); return
    try:
        uid, val = int(parts[1]), float(parts[2])
        if remove_balance(uid, val, "کسر دستی ادمین"):
            bot.reply_to(msg, f"✅ {val} توکن از `{uid}` کسر شد.\n💰 موجودی: {get_balance(uid)}", parse_mode="Markdown")
        else:
            bot.reply_to(msg, "❌ موجودی کافی نیست!")
    except:
        bot.reply_to(msg, "❌ خطا!")

@bot.message_handler(commands=["bal"])
@admin_only
def cmd_bal(msg):
    parts = msg.text.split()
    if len(parts) != 2:
        bot.reply_to(msg, "❌ /bal [آیدی]"); return
    try:
        uid = int(parts[1])
        bot.reply_to(msg, f"💰 موجودی `{uid}`: {get_balance(uid)} RPS", parse_mode="Markdown")
    except:
        bot.reply_to(msg, "❌ خطا!")

@bot.message_handler(commands=["endgame"])
@admin_only
def cmd_endgame(msg):
    """لغو اجباری یک بازی و بازگشت توکن‌ها"""
    parts = msg.text.split()
    if len(parts) != 2:
        bot.reply_to(msg, "❌ /endgame [gid]"); return
    gid = parts[1]
    data = load_data()
    game = data["games"].get(gid)
    if not game:
        bot.reply_to(msg, "❌ بازی پیدا نشد!"); return
    # بازگشت توکن
    add_balance(int(game["p1"]), GAME_COST, "لغو بازی توسط ادمین")
    add_balance(int(game["p2"]), GAME_COST, "لغو بازی توسط ادمین")
    cancel_move_timer(gid)
    del data["games"][gid]
    save_data(data)
    for pid in [int(game["p1"]), int(game["p2"])]:
        bot.send_message(pid, "⚠️ بازی توسط ادمین لغو شد. 1 RPS به حسابت برگشت داده شد.",
                         reply_markup=main_menu(is_admin(pid)))
    bot.reply_to(msg, f"✅ بازی `{gid}` لغو شد.", parse_mode="Markdown")

# ═══════════════════════════════════════════════════════════════
#  اجرا
# ═══════════════════════════════════════════════════════════════

log.info("=" * 45)
log.info("🤖  ربات سنگ‌کاغذ‌قیچی حرفه‌ای روشن شد")
log.info(f"💰  هزینه بازی: {GAME_COST} RPS | جایزه برنده: {WIN_REWARD} RPS | کارمزد: {GAME_FEE_PCT}%")
log.info(f"⏰  تایم‌اوت حرکت: {MOVE_TIMEOUT}ث | انتظار حریف: {WAIT_TIME}ث")
log.info("=" * 45)

keep_alive()

while True:
    try:
        bot.polling(none_stop=True, interval=1, timeout=60)
    except Exception as e:
        log.error(f"polling error: {e}")
        time.sleep(5)
