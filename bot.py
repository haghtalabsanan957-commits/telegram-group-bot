import asyncio
import random
import sys
import os
import time
from rubpy import Client
from datetime import datetime

print("🤖 ربات ارسال دوره‌ای")
print()

# سشن ثابت
SESSION_NAME = "rubika_session"

# متغیرهای آماری
TOTAL_SENT = 0
TOTAL_FAILED = 0

def generate_message():
    """تولید پیام ثابت"""
    # ساخت پیام ساده (بدون ایموجی‌های تصادفی)
    message = f"""گپ چت کالاف : https://rubika.ir/joing/JDDGGBEB0FTCVEGLVJUOQLGNMZJYNMIK
اکانت رایگان کالاف : @callofduty_mobile_2025"""
    
    return message

async def get_all_groups(client):
    """دریافت همه گروه‌ها"""
    try:
        groups = []
        result = await client.get_chats()
        
        if hasattr(result, 'chats'):
            chats = result.chats
        elif isinstance(result, list):
            chats = result
        else:
            return []
        
        for chat in chats:
            guid = None
            if hasattr(chat, 'object_guid'):
                guid = chat.object_guid
            elif hasattr(chat, 'guid'):
                guid = chat.guid
            
            if guid and guid.startswith('g'):
                groups.append(guid)
        
        return groups
    except Exception:
        return []

async def send_to_group(client, group_guid, message):
    """ارسال پیام به یک گروه"""
    global TOTAL_SENT, TOTAL_FAILED
    
    try:
        await client.send_message(group_guid, message)
        TOTAL_SENT += 1
        return True
    except Exception as e:
        TOTAL_FAILED += 1
        return False

async def periodic_sender():
    """ربات ارسال دوره‌ای"""
    global TOTAL_SENT, TOTAL_FAILED
    
    try:
        # اتصال با سشن ثابت
        client = Client(SESSION_NAME)
        await client.start()
        
        # پاک کردن ترمینال
        os.system('cls' if sys.platform == "win32" else 'clear')
        print("🤖 ربات فعال - ارسال هر ۲-۳ دقیقه")
        print("🎮 پیام ساده و ثابت")
        print("="*50)
        
        cycle = 1
        
        while True:
            try:
                # تولید پیام جدید برای این دور
                message = generate_message()
                
                # دریافت گروه‌ها
                groups = await get_all_groups(client)
                
                if not groups:
                    print(f"دور {cycle}: ❌ گروهی یافت نشد")
                    await asyncio.sleep(180)  # 3 دقیقه
                    cycle += 1
                    continue
                
                # آمار این دور
                sent_in_cycle = 0
                failed_in_cycle = 0
                
                # ارسال به همه گروه‌ها
                for i, group_guid in enumerate(groups, 1):
                    try:
                        success = await send_to_group(client, group_guid, message)
                        
                        if success:
                            sent_in_cycle += 1
                        else:
                            failed_in_cycle += 1
                        
                        # تاخیر ۲-۳ ثانیه بین ارسال‌ها
                        delay = random.uniform(2.0, 3.0)
                        await asyncio.sleep(delay)
                        
                    except Exception:
                        failed_in_cycle += 1
                        await asyncio.sleep(2.5)
                
                # نمایش آمار این دور
                print(f"دور {cycle}: ✅ {sent_in_cycle} | ❌ {failed_in_cycle} | کل گروه‌ها: {len(groups)}")
                
                # تاخیر ۲-۳ دقیقه تا دور بعدی
                delay_minutes = random.uniform(2.0, 3.0)
                delay_seconds = int(delay_minutes * 60)
                
                # نمایش زمان باقی‌مانده
                for remaining in range(delay_seconds, 0, -1):
                    if remaining % 30 == 0 or remaining <= 5:
                        mins = remaining // 60
                        secs = remaining % 60
                        print(f"\r⏳ دور بعدی: {mins:02d}:{secs:02d}", end="", flush=True)
                    await asyncio.sleep(1)
                print()
                
                cycle += 1
                
            except Exception as e:
                print(f"خطا در دور {cycle}: {str(e)[:50]}")
                await asyncio.sleep(180)
                cycle += 1
                
    except KeyboardInterrupt:
        print(f"\n\n📊 آمار نهایی: ✅ {TOTAL_SENT} | ❌ {TOTAL_FAILED}")
        try:
            await client.disconnect()
        except:
            pass
        
    except Exception as e:
        print(f"\n❌ خطای اصلی: {str(e)[:50]}")
        try:
            await client.disconnect()
        except:
            pass

# اجرای ربات
if __name__ == "__main__":
    try:
        # پاک کردن ترمینال
        os.system('cls' if sys.platform == "win32" else 'clear')
        
        print("="*50)
        print("🤖 ربات ارسال دوره‌ای روبیکا")
        print("="*50)
        print("🎮 ویژگی‌ها:")
        print("  • ارسال هر ۲-۳ دقیقه")
        print("  • تاخیر ۲-۳ ثانیه بین پیام‌ها")
        print("  • پیام کاملاً ثابت و بدون تغییر")
        print("  • سشن قبلی حفظ می‌شود")
        print("  • فقط آمار نمایش داده می‌شود")
        print("="*50)
        
        print("\n🚀 شروع در 5 ثانیه...")
        for i in range(5, 0, -1):
            print(f"\r   {i}...", end="", flush=True)
            time.sleep(1)
        print("\n")
        
        asyncio.run(periodic_sender())
        
    except KeyboardInterrupt:
        print("\n\n🛑 ربات متوقف شد")
        sys.exit(0)