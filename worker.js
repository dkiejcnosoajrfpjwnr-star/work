// ============================================
// بوت إنشاء بوتات تواصل مع الاشتراك الإجباري
// يعمل على Cloudflare Workers + KV
// ============================================

const MAIN_BOT_TOKEN = "8446179685:AAHJsOuyJSjeHM0bPtyqtuHjsBlIHYH6CjY";
const OWNER_ID = 6668195885;

// دالة إرسال طلب إلى تيليجرام
async function tg(method, token, body = {}) {
  const url = `https://api.telegram.org/bot${token}/${method}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  return res.json();
}

// دالة إرسال رسالة
async function sendMsg(token, chatId, text, kb = null) {
  const payload = { chat_id: chatId, text, parse_mode: "HTML" };
  if (kb) payload.reply_markup = kb;
  return tg("sendMessage", token, payload);
}

// دالة حذف رسالة
async function delMsg(token, chatId, msgId) {
  return tg("deleteMessage", token, { chat_id: chatId, message_id: msgId });
}

// دالة الإجابة على callback query
async function answerCb(cbId, text, alert = false) {
  return tg("answerCallbackQuery", MAIN_BOT_TOKEN, {
    callback_query_id: cbId, text, show_alert: alert
  });
}

// لوحة المالك الرئيسية
function ownerPanel() {
  return {
    inline_keyboard: [
      [{ text: "➕ إضافة قناة/مجموعة اشتراك إجباري", callback_data: "add_sub" }],
      [{ text: "📋 قائمة الاشتراك الإجباري", callback_data: "list_subs" }],
      [{ text: "🗑️ حذف قناة/مجموعة", callback_data: "del_sub" }],
      [{ text: "🤖 إنشاء بوت تواصل", callback_data: "create_bot" }],
      [{ text: "📊 البوتات المنشأة", callback_data: "list_bots" }]
    ]
  };
}

// لوحة إعدادات بوت تواصل
function botSettingsPanel() {
  return {
    inline_keyboard: [
      [{ text: "✏️ تغيير كليشة Start", callback_data: "edit_start" }],
      [{ text: "🚫 حظر مستخدم", callback_data: "ban_user" }],
      [{ text: "✅ إلغاء حظر", callback_data: "unban_user" }],
      [{ text: "🗑️ مسح المحظورين", callback_data: "clear_bans" }],
      [{ text: "📋 قائمة المحظورين", callback_data: "list_bans" }],
      [{ text: "🔙 رجوع", callback_data: "back_owner" }]
    ]
  };
}

// التحقق من الاشتراك الإجباري
async function checkSubs(userId, subs) {
  if (!subs || subs.length === 0) return { ok: true, notJoined: [] };
  const notJoined = [];
  for (const sub of subs) {
    try {
      const res = await tg("getChatMember", MAIN_BOT_TOKEN, {
        chat_id: sub.id, user_id: userId
      });
      const status = res.result?.status;
      if (!status || status === "left" || status === "kicked") {
        notJoined.push(sub);
      }
    } catch (e) {
      notJoined.push(sub);
    }
  }
  return { ok: notJoined.length === 0, notJoined };
}

// الحصول على بوت تواصل من التوكن المخزن
async function getBotByToken(botToken, env) {
  const botsJson = await env.TALKING_BOT_KV.get("created_bots");
  const bots = botsJson ? JSON.parse(botsJson) : [];
  return bots.find(b => b.token === botToken);
}

// معالجة بوت التواصل (عندما يصل التحديث من webhook بوت فرعي)
async function handleTalkingBot(botToken, update, env) {
  const msg = update.message;
  if (!msg) return new Response("OK");
  const chatId = msg.chat.id;
  const text = msg.text;
  const userId = msg.from.id;

  // التحقق من الحظر
  const bansJson = await env.TALKING_BOT_KV.get(`bans:${botToken}`);
  const bans = bansJson ? JSON.parse(bansJson) : [];
  if (bans.includes(userId)) {
    return sendMsg(botToken, chatId, "🚫 أنت محظور من استخدام هذا البوت.");
  }

  // التحقق من الاشتراك الإجباري
  const subsJson = await env.TALKING_BOT_KV.get("force_subs");
  const subs = subsJson ? JSON.parse(subsJson) : [];
  const subCheck = await checkSubs(userId, subs);

  if (!subCheck.ok) {
    let msgText = "❌ <b>عذراً، يجب الاشتراك في القنوات/المجموعات التالية أولاً:</b>\n\n";
    for (const s of subCheck.notJoined) {
      const link = `https://t.me/${s.username}`;
      msgText += `🔹 <a href="${link}">${s.title}</a>\n`;
    }
    msgText += "\n✅ بعد الاشتراك، أرسل /start مرة أخرى.";

    // أزرار الاشتراك
    const kb = { inline_keyboard: subCheck.notJoined.map(s => [{
      text: `📢 ${s.title}`,
      url: `https://t.me/${s.username}`
    }]) };
    kb.inline_keyboard.push([{ text: "✅ تحقق", callback_data: "check_sub" }]);

    return sendMsg(botToken, chatId, msgText, kb);
  }

  // /start
  if (text === "/start") {
    const startMsg = await env.TALKING_BOT_KV.get(`start_msg:${botToken}`);
    const welcome = startMsg || "👋 مرحباً بك! يمكنك التواصل مع المالك عبر هذا البوت.\n\nأرسل رسالتك وسيتم إرسالها للمالك.";
    return sendMsg(botToken, chatId, welcome);
  }

  // إرسال رسالة المستخدم للمالك
  const userName = msg.from.first_name || "مستخدم";
  const userHandle = msg.from.username ? `@${msg.from.username}` : "لا يوجد";
  const forwarded = `📩 <b>رسالة جديدة</b>\n\n👤 الاسم: ${userName}\n🔗 المعرف: ${userHandle}\n🆔 ID: <code>${userId}</code>\n\n💬 الرسالة:\n${text}`;

  await sendMsg(MAIN_BOT_TOKEN, OWNER_ID, forwarded, {
    inline_keyboard: [
      [
        { text: "🚫 حظر", callback_data: `ban:${userId}:${botToken}` },
        { text: "💬 رد", callback_data: `reply:${userId}:${botToken}` }
      ]
    ]
  });

  return sendMsg(botToken, chatId, "✅ تم إرسال رسالتك إلى المالك. سيرد عليك قريباً.");
}

// معالجة callback queries للبوت الرئيسي
async function handleMainBotCallback(cb, env) {
  const data = cb.data;
  const chatId = cb.message.chat.id;
  const msgId = cb.message.message_id;
  const userId = cb.from.id;

  if (userId !== OWNER_ID) {
    return answerCb(cb.id, "❌ هذه اللوحة خاصة بالمالك فقط");
  }

  // رجوع للوحة الرئيسية
  if (data === "back_owner") {
    await delMsg(MAIN_BOT_TOKEN, chatId, msgId);
    return sendMsg(MAIN_BOT_TOKEN, chatId, "🏠 <b>لوحة المالك الرئيسية</b>", ownerPanel());
  }

  // إضافة اشتراك إجباري
  if (data === "add_sub") {
    await delMsg(MAIN_BOT_TOKEN, chatId, msgId);
    await env.TALKING_BOT_KV.put("owner_mode", "add_sub");
    return sendMsg(MAIN_BOT_TOKEN, chatId,
      "➕ <b>إضافة اشتراك إجباري</b>\n\nأرسل معرف القناة أو المجموعة:\n\nمثال: <code>@username</code>");
  }

  // قائمة الاشتراك الإجباري
  if (data === "list_subs") {
    const subsJson = await env.TALKING_BOT_KV.get("force_subs");
    const subs = subsJson ? JSON.parse(subsJson) : [];
    if (subs.length === 0) {
      return answerCb(cb.id, "❌ لا توجد قنوات أو مجموعات مضافة", true);
    }
    let text = "📋 <b>قائمة الاشتراك الإجباري:</b>\n\n";
    subs.forEach((s, i) => {
      text += `${i+1}. <a href="https://t.me/${s.username}">${s.title}</a>\n`;
    });
    return sendMsg(MAIN_BOT_TOKEN, chatId, text);
  }

  // حذف اشتراك
  if (data === "del_sub") {
    const subsJson = await env.TALKING_BOT_KV.get("force_subs");
    const subs = subsJson ? JSON.parse(subsJson) : [];
    if (subs.length === 0) return answerCb(cb.id, "❌ لا يوجد للحذف", true);
    const kb = { inline_keyboard: subs.map(s => [{
      text: `🗑️ ${s.title}`, callback_data: `confirm_del:${s.id}`
    }]) };
    kb.inline_keyboard.push([{ text: "🔙 رجوع", callback_data: "back_owner" }]);
    await delMsg(MAIN_BOT_TOKEN, chatId, msgId);
    return sendMsg(MAIN_BOT_TOKEN, chatId, "اختر للحذف:", kb);
  }

  if (data.startsWith("confirm_del:")) {
    const subId = data.split(":")[1];
    const subsJson = await env.TALKING_BOT_KV.get("force_subs");
    const subs = subsJson ? JSON.parse(subsJson) : [];
    const newSubs = subs.filter(s => s.id !== subId);
    await env.TALKING_BOT_KV.put("force_subs", JSON.stringify(newSubs));
    await delMsg(MAIN_BOT_TOKEN, chatId, msgId);
    return sendMsg(MAIN_BOT_TOKEN, chatId, "✅ تم الحذف بنجاح.", ownerPanel());
  }

  // إنشاء بوت تواصل
  if (data === "create_bot") {
    await delMsg(MAIN_BOT_TOKEN, chatId, msgId);
    await env.TALKING_BOT_KV.put("owner_mode", "create_bot");
    return sendMsg(MAIN_BOT_TOKEN, chatId,
      "🤖 <b>إنشاء بوت تواصل جديد</b>\n\nأرسل <b>توكن البوت</b> من @BotFather:\n\n<code>1234567890:ABCdef...</code>");
  }

  // قائمة البوتات المنشأة
  if (data === "list_bots") {
    const botsJson = await env.TALKING_BOT_KV.get("created_bots");
    const bots = botsJson ? JSON.parse(botsJson) : [];
    if (bots.length === 0) return answerCb(cb.id, "❌ لم يتم إنشاء أي بوت", true);
    let text = "📊 <b>البوتات المنشأة:</b>\n\n";
    const kb = { inline_keyboard: [] };
    bots.forEach((b, i) => {
      text += `${i+1}. 🤖 @${b.username}\n`;
      kb.inline_keyboard.push([{
        text: `⚙️ إعدادات @${b.username}`,
        callback_data: `bot_settings:${b.token}`
      }]);
    });
    return sendMsg(MAIN_BOT_TOKEN, chatId, text, kb);
  }

  // إعدادات بوت معين
  if (data.startsWith("bot_settings:")) {
    const token = data.split(":").slice(1).join(":");
    await env.TALKING_BOT_KV.put("current_bot", token);
    await delMsg(MAIN_BOT_TOKEN, chatId, msgId);
    return sendMsg(MAIN_BOT_TOKEN, chatId, "⚙️ <b>إعدادات البوت</b>", botSettingsPanel());
  }

  // تغيير كليشة Start
  if (data === "edit_start") {
    const token = await env.TALKING_BOT_KV.get("current_bot");
    await delMsg(MAIN_BOT_TOKEN, chatId, msgId);
    await env.TALKING_BOT_KV.put("owner_mode", "edit_start");
    return sendMsg(MAIN_BOT_TOKEN, chatId, "✏️ أرسل النص الجديد لكليشة Start:");
  }

  // حظر مستخدم
  if (data === "ban_user") {
    await delMsg(MAIN_BOT_TOKEN, chatId, msgId);
    await env.TALKING_BOT_KV.put("owner_mode", "ban_user");
    return sendMsg(MAIN_BOT_TOKEN, chatId, "🚫 أرسل ID المستخدم للحظر:");
  }

  // إلغاء حظر
  if (data === "unban_user") {
    await delMsg(MAIN_BOT_TOKEN, chatId, msgId);
    await env.TALKING_BOT_KV.put("owner_mode", "unban_user");
    return sendMsg(MAIN_BOT_TOKEN, chatId, "✅ أرسل ID المستخدم لإلغاء الحظر:");
  }

  // مسح المحظورين
  if (data === "clear_bans") {
    const token = await env.TALKING_BOT_KV.get("current_bot");
    await env.TALKING_BOT_KV.put(`bans:${token}`, "[]");
    await delMsg(MAIN_BOT_TOKEN, chatId, msgId);
    return sendMsg(MAIN_BOT_TOKEN, chatId, "✅ تم مسح جميع المحظورين.", botSettingsPanel());
  }

  // قائمة المحظورين
  if (data === "list_bans") {
    const token = await env.TALKING_BOT_KV.get("current_bot");
    const bansJson = await env.TALKING_BOT_KV.get(`bans:${token}`);
    const bans = bansJson ? JSON.parse(bansJson) : [];
    if (bans.length === 0) return answerCb(cb.id, "✅ لا يوجد محظورين", true);
    let text = "📋 <b>المحظورين:</b>\n\n";
    bans.forEach((id, i) => text += `${i+1}. <code>${id}</code>\n`);
    return sendMsg(MAIN_BOT_TOKEN, chatId, text);
  }

  // حظر سريع من رسالة مستخدم
  if (data.startsWith("ban:")) {
    const parts = data.split(":");
    const targetId = parseInt(parts[1]);
    const botToken = parts.slice(2).join(":");
    const bansJson = await env.TALKING_BOT_KV.get(`bans:${botToken}`);
    const bans = bansJson ? JSON.parse(bansJson) : [];
    if (!bans.includes(targetId)) bans.push(targetId);
    await env.TALKING_BOT_KV.put(`bans:${botToken}`, JSON.stringify(bans));
    return answerCb(cb.id, `🚫 تم حظر المستخدم ${targetId}`);
  }

  // رد على مستخدم
  if (data.startsWith("reply:")) {
    const parts = data.split(":");
    const targetId = parseInt(parts[1]);
    const botToken = parts.slice(2).join(":");
    await env.TALKING_BOT_KV.put("reply_to", JSON.stringify({ id: targetId, bot: botToken }));
    await env.TALKING_BOT_KV.put("owner_mode", "reply");
    return sendMsg(MAIN_BOT_TOKEN, chatId, `💬 أرسل رسالتك للرد على المستخدم <code>${targetId}</code>:`);
  }

  // تحقق من الاشتراك (من بوت فرعي)
  if (data === "check_sub") {
    return answerCb(cb.id, "✅ تم التحقق. أرسل /start مرة أخرى.");
  }
}

// المعالج الرئيسي
export default {
  async fetch(request, env) {
    if (request.method !== "POST") {
      return new Response("OK", { status: 200 });
    }

    try {
      const update = await request.json();
      const url = new URL(request.url);

      // === Webhook لبوت تواصل فرعي ===
      if (url.pathname.startsWith("/webhook/")) {
        const botToken = url.pathname.replace("/webhook/", "");
        await handleTalkingBot(botToken, update, env);
        return new Response("OK", { status: 200 });
      }

      // === Webhook البوت الرئيسي ===
      const msg = update.message;
      const cb = update.callback_query;

      if (cb) {
        await handleMainBotCallback(cb, env);
        return new Response("OK", { status: 200 });
      }

      if (msg) {
        const chatId = msg.chat.id;
        const text = msg.text;
        const userId = msg.from.id;

        // فقط المالك
        if (userId !== OWNER_ID) {
          return new Response("OK", { status: 200 });
        }

        // /start يفتح لوحة المالك
        if (text === "/start") {
          await env.TALKING_BOT_KV.put("owner_mode", "");
          return sendMsg(MAIN_BOT_TOKEN, chatId,
            "🏠 <b>مرحباً بك في لوحة التحكم</b>\n\nيمكنك من هنا:\n• إدارة الاشتراك الإجباري\n• إنشاء بوتات تواصل\n• إدارة الإعدادات",
            ownerPanel());
        }

        const mode = await env.TALKING_BOT_KV.get("owner_mode");

        // وضع إضافة اشتراك إجباري
        if (mode === "add_sub" && text) {
          try {
            const chatInfo = await tg("getChat", MAIN_BOT_TOKEN, { chat_id: text });
            if (chatInfo.ok) {
              const subsJson = await env.TALKING_BOT_KV.get("force_subs");
              const subs = subsJson ? JSON.parse(subsJson) : [];
              // تجنب التكرار
              if (!subs.find(s => s.id === text)) {
                subs.push({
                  id: text,
                  title: chatInfo.result.title,
                  username: chatInfo.result.username,
                  type: chatInfo.result.type
                });
                await env.TALKING_BOT_KV.put("force_subs", JSON.stringify(subs));
              }
              await env.TALKING_BOT_KV.put("owner_mode", "");
              await delMsg(MAIN_BOT_TOKEN, chatId, msg.message_id);
              return sendMsg(MAIN_BOT_TOKEN, chatId,
                `✅ تم إضافة <b>${chatInfo.result.title}</b> للاشتراك الإجباري!`, ownerPanel());
            } else {
              return sendMsg(MAIN_BOT_TOKEN, chatId,
                "❌ تعذر العثور على القناة. تأكد من:\n• البوت عضو في القناة/المجموعة\n• المعرف صحيح\n\nأرسل المعرف مرة أخرى:");
            }
          } catch (e) {
            return sendMsg(MAIN_BOT_TOKEN, chatId, "❌ خطأ. تأكد من المعرف وأرسله مرة أخرى:");
          }
        }

        // وضع إنشاء بوت تواصل
        if (mode === "create_bot" && text && text.includes(":")) {
          const botToken = text.trim();
          const botInfo = await tg("getMe", botToken);

          if (!botInfo.ok) {
            return sendMsg(MAIN_BOT_TOKEN, chatId, "❌ توكن غير صالح. أرسل توكن صحيح:");
          }

          // حفظ البوت
          const botsJson = await env.TALKING_BOT_KV.get("created_bots");
          const bots = botsJson ? JSON.parse(botsJson) : [];
          bots.push({
            id: botToken.split(":")[0],
            token: botToken,
            username: botInfo.result.username,
            createdAt: new Date().toISOString()
          });
          await env.TALKING_BOT_KV.put("created_bots", JSON.stringify(bots));

          // تعيين webhook
          const workerUrl = `https://${env.WORKER_URL}`;
          const webhookUrl = `${workerUrl}/webhook/${botToken}`;
          await tg("setWebhook", botToken, { url: webhookUrl });

          await env.TALKING_BOT_KV.put("owner_mode", "");
          await delMsg(MAIN_BOT_TOKEN, chatId, msg.message_id);
          return sendMsg(MAIN_BOT_TOKEN, chatId,
            `✅ <b>تم إنشاء البوت بنجاح!</b>\n\n🤖 @${botInfo.result.username}\n🆔 <code>${botToken.split(":")[0]}</code>\n\nتم ربط الـ Webhook تلقائياً.`,
            ownerPanel());
        }

        // وضع تغيير كليشة Start
        if (mode === "edit_start" && text) {
          const token = await env.TALKING_BOT_KV.get("current_bot");
          await env.TALKING_BOT_KV.put(`start_msg:${token}`, text);
          await env.TALKING_BOT_KV.put("owner_mode", "");
          await delMsg(MAIN_BOT_TOKEN, chatId, msg.message_id);
          return sendMsg(MAIN_BOT_TOKEN, chatId, "✅ تم تغيير كليشة Start بنجاح!", botSettingsPanel());
        }

        // وضع حظر مستخدم
        if (mode === "ban_user" && text) {
          const token = await env.TALKING_BOT_KV.get("current_bot");
          const targetId = parseInt(text);
          if (isNaN(targetId)) {
            return sendMsg(MAIN_BOT_TOKEN, chatId, "❌ أرسل ID رقمي صحيح:");
          }
          const bansJson = await env.TALKING_BOT_KV.get(`bans:${token}`);
          const bans = bansJson ? JSON.parse(bansJson) : [];
          if (!bans.includes(targetId)) bans.push(targetId);
          await env.TALKING_BOT_KV.put(`bans:${token}`, JSON.stringify(bans));
          await env.TALKING_BOT_KV.put("owner_mode", "");
          await delMsg(MAIN_BOT_TOKEN, chatId, msg.message_id);
          return sendMsg(MAIN_BOT_TOKEN, chatId, `🚫 تم حظر <code>${targetId}</code>`, botSettingsPanel());
        }

        // وضع إلغاء حظر
        if (mode === "unban_user" && text) {
          const token = await env.TALKING_BOT_KV.get("current_bot");
          const targetId = parseInt(text);
          const bansJson = await env.TALKING_BOT_KV.get(`bans:${token}`);
          const bans = bansJson ? JSON.parse(bansJson) : [];
          const newBans = bans.filter(id => id !== targetId);
          await env.TALKING_BOT_KV.put(`bans:${token}`, JSON.stringify(newBans));
          await env.TALKING_BOT_KV.put("owner_mode", "");
          await delMsg(MAIN_BOT_TOKEN, chatId, msg.message_id);
          return sendMsg(MAIN_BOT_TOKEN, chatId, `✅ تم إلغاء حظر <code>${targetId}</code>`, botSettingsPanel());
        }

        // وضع الرد على مستخدم
        if (mode === "reply" && text) {
          const replyData = JSON.parse(await env.TALKING_BOT_KV.get("reply_to"));
          if (replyData) {
            await sendMsg(replyData.bot, replyData.id, `💬 <b>رد من المالك:</b>\n\n${text}`);
          }
          await env.TALKING_BOT_KV.put("owner_mode", "");
          await env.TALKING_BOT_KV.delete("reply_to");
          await delMsg(MAIN_BOT_TOKEN, chatId, msg.message_id);
          return sendMsg(MAIN_BOT_TOKEN, chatId, "✅ تم إرسال الرد.", ownerPanel());
        }
      }

      return new Response("OK", { status: 200 });
    } catch (e) {
      return new Response("OK", { status: 200 });
    }
  }
};
