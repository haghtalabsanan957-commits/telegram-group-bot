from telegram import Update, InlineKeyboardButton, InlineKeyboardMarkup
from telegram.ext import (
    ApplicationBuilder, CommandHandler, MessageHandler, CallbackQueryHandler,
    ContextTypes, filters
)

# ====== تنظیمات ======
TOKEN = "توکن_ربات_تو"  # توکن BotFather
ADMIN_ID = 123456789     # آی‌دی خودت
MAX_WORDS = 150          # حداکثر طول پیام
recent_messages = {}     # برای پیام‌های تکراری
forbidden_words = []     # لیست کلمات ممنوع

# ====== منوی شیشه‌ای ======
def build_menu():
    kb = [
        [InlineKeyboardButton("➕ افزودن کلمه ممنوع", callback_data="add_word")],
        [InlineKeyboardButton("➖ حذف کلمه ممنوع", callback_data="remove_word")],
        [InlineKeyboardButton("📃 لیست کلمات ممنوع", callback_data="list_words")],
        [InlineKeyboardButton("❌ بستن منو", callback_data="close_menu")]
    ]
    return InlineKeyboardMarkup(kb)

# ====== دستور /start ======
async def start(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if update.effective_user.id != ADMIN_ID:
        return
    await update.message.reply_text(
        "🛡 پنل مدیریت ربات", reply_markup=build_menu()
    )

# ====== کنترل پیام‌ها در گروه ======
async def check_message(update: Update, context: ContextTypes.DEFAULT_TYPE):
    msg = update.message
    if not msg:
        return

    user_id = msg.from_user.id
    text = msg.text or ""
    
    # حذف لینک و آیدی
    if "t.me/" in text or "@" in text or msg.forward_from:
        await msg.delete()
        return

    # حذف پیام‌های بلند
    if len(text.split()) > MAX_WORDS:
        await msg.delete()
        return

    # حذف پیام تکراری
    user_msgs = recent_messages.get(user_id, [])
    if user_msgs and user_msgs[-1] == text:
        await msg.delete()
        return
    user_msgs.append(text)
    if len(user_msgs) > 10:
        user_msgs.pop(0)
    recent_messages[user_id] = user_msgs

# ====== مدیریت کلمات ممنوع در پیوی ======
async def handle_private(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if update.effective_user.id != ADMIN_ID:
        return
    msg = update.message
    if not msg or not msg.text:
        return
    text = msg.text.lower()
    
    # حذف پیام حاوی کلمات ممنوع
    for word in forbidden_words:
        if word.lower() in text:
            await msg.delete()
            return

# ====== پاسخ دکمه‌های منو ======
async def button_handler(update: Update, context: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    await query.answer()
    data = query.data

    if data == "add_word":
        await query.edit_message_text("📥 لطفاً کلمه جدید را در پیوی ارسال کنید")
    elif data == "remove_word":
        await query.edit_message_text("🗑 لطفاً کلمه‌ای که می‌خوای حذف کنی را بفرست")
    elif data == "list_words":
        await query.edit_message_text(f"📃 کلمات ممنوع: {', '.join(forbidden_words) or 'هیچ'}")
    elif data == "close_menu":
        await query.edit_message_text("منو بسته شد")

# ====== اجرا ======
app = ApplicationBuilder().token(TOKEN).build()

app.add_handler(CommandHandler("start", start))
app.add_handler(MessageHandler(filters.ALL & filters.ChatType.GROUPS, check_message))
app.add_handler(MessageHandler(filters.ALL & filters.ChatType.PRIVATE, handle_private))
app.add_handler(CallbackQueryHandler(button_handler))

print("ربات روشن است ✅")
app.run_polling()
