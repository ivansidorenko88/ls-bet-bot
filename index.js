require("dotenv").config();

const requiredRuntimeEnv = ["DISCORD_TOKEN", "DATABASE_URL"];
const missingRuntimeEnv = requiredRuntimeEnv.filter((name) => !String(process.env[name] || "").trim());
if (missingRuntimeEnv.length) {
  console.error(`❌ Не заданы обязательные переменные окружения: ${missingRuntimeEnv.join(", ")}`);
  process.exit(1);
}

if (!/^postgres(ql)?:\/\//i.test(process.env.DATABASE_URL)) {
  console.error("❌ Основной DATABASE_URL должен указывать на PostgreSQL. SQLite разрешён только через SQLITE_DATABASE_URL для миграции.");
  process.exit(1);
}

console.log("🗄️ Основная база данных: PostgreSQL");

const {
  Client,
  GatewayIntentBits,
  Events,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  PermissionFlagsBits,
  ChannelType,
  MessageFlags,
} = require("discord.js");

const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
  ],
});

function normalizeInteractionPayload(payload, { forEdit = false } = {}) {
  if (payload === undefined || payload === null || typeof payload !== "object" || Array.isArray(payload)) {
    return payload;
  }

  const normalized = { ...payload };
  const isEphemeral = normalized.ephemeral === true;
  delete normalized.ephemeral;

  if (forEdit) {
    // Discord does not allow changing the ephemeral state after acknowledgement.
    delete normalized.flags;
  } else if (isEphemeral) {
    const currentFlags = Number(normalized.flags || 0);
    normalized.flags = currentFlags | MessageFlags.Ephemeral;
  }

  return normalized;
}

async function deferInteractionReply(interaction, payload = {}) {
  if (interaction.deferred || interaction.replied) return;
  return interaction.deferReply(normalizeInteractionPayload(payload));
}

async function respondInteraction(interaction, payload) {
  if (interaction.deferred) {
    return interaction.editReply(normalizeInteractionPayload(payload, { forEdit: true }));
  }

  if (interaction.replied) {
    return interaction.followUp(normalizeInteractionPayload(payload));
  }

  return interaction.reply(normalizeInteractionPayload(payload));
}

async function followUpInteraction(interaction, payload) {
  if (!interaction.deferred && !interaction.replied) {
    return respondInteraction(interaction, payload);
  }
  return interaction.followUp(normalizeInteractionPayload(payload));
}

async function safelyHandleInteractionError(interaction, error) {
  console.error("Ошибка InteractionCreate:", error);

  if (error?.code === 10062) {
    console.warn("Discord interaction уже истёк; повторный ответ пропущен.");
    return;
  }

  const payload = {
    content: "❌ Произошла ошибка. Попробуйте ещё раз.",
    ephemeral: true,
  };

  try {
    await respondInteraction(interaction, payload);
  } catch (responseError) {
    if (responseError?.code !== 10062) {
      console.error("Не удалось отправить сообщение об ошибке:", responseError);
    }
  }
}

function buttonOpensModal(customId) {
  const exactIds = new Set([
    "registration_start",
    "admin_event_create_button",
    "admin_event_edit_by_id_button",
    "admin_user_info_button",
    "admin_user_add_balance_button",
    "admin_user_remove_balance_button",
    "admin_user_set_balance_button",
    "promo_create",
    "promo_create_referral",
    "promo_edit",
    "promo_delete",
    "panel_promo",
    "panel_topup",
    "panel_withdraw",
    "lottery_custom",
  ]);

  if (exactIds.has(customId)) return true;

  return [
    "admin_event_edit:",
    "admin_event_cancel:",
    "crash_bet_auto:",
    "crash_bet_custom:",
    "coinflip_side:",
    "bet:",
  ].some((prefix) => customId.startsWith(prefix));
}

function buttonUsesMessageUpdate(customId) {
  return [
    "registration_approve:",
    "registration_reject:",
    "registration_ticket_close:",
  ].some((prefix) => customId.startsWith(prefix));
}

const START_BALANCE = Number(process.env.START_BALANCE ?? process.env.START_POINTS ?? 0);
const EVENT_CHANNEL_ID = process.env.EVENT_CHANNEL_ID || "1510916382395600936";
const RESULT_CHANNEL_ID = process.env.RESULT_CHANNEL_ID || "1510928118527950888";
const COINFLIP_CHANNEL_ID = process.env.COINFLIP_CHANNEL_ID || "1511707250668863578";
const LOTTERY_CHANNEL_ID = process.env.LOTTERY_CHANNEL_ID || "1510916530190417990";
const REGISTRATION_CHANNEL_ID = process.env.REGISTRATION_CHANNEL_ID || null;
const REGISTRATION_CATEGORY_ID = process.env.REGISTRATION_CATEGORY_ID || "1514552444552482906";
const REGISTRATION_ROLE_ID = process.env.REGISTRATION_ROLE_ID || null;
const REGISTRATION_TOPUP_BONUS_PERCENT = Number(process.env.REGISTRATION_TOPUP_BONUS_PERCENT || 1);
const UNVERIFIED_MAX_BET = Number(process.env.UNVERIFIED_MAX_BET || 1000);
const UNVERIFIED_MAX_TOPUP = Number(process.env.UNVERIFIED_MAX_TOPUP || 10000);
const WELCOME_DM_ENABLED = String(process.env.WELCOME_DM_ENABLED ?? "true").toLowerCase() !== "false";
const JACKPOT_WAR_ENABLED = String(process.env.JACKPOT_WAR_ENABLED ?? "true").toLowerCase() !== "false";
const JACKPOT_WAR_PERCENT = Number(process.env.JACKPOT_WAR_PERCENT || 1);
const JACKPOT_WAR_TARGET = Number(process.env.JACKPOT_WAR_TARGET || 500000);
const JACKPOT_WAR_CHANNEL_ID = process.env.JACKPOT_WAR_CHANNEL_ID || process.env.LOTTERY_CHANNEL_ID || "1510916530190417990";
const JACKPOT_WAR_NOTIFY_CHANNEL_ID = process.env.JACKPOT_WAR_NOTIFY_CHANNEL_ID || JACKPOT_WAR_CHANNEL_ID || "1515790753740357813";
const CRASH_CHANNEL_ID = process.env.CRASH_CHANNEL_ID || "1519242217699414096";
const CRASH_ROUND_INTERVAL_SECONDS = Number(process.env.CRASH_ROUND_INTERVAL_SECONDS || 10);
const CRASH_MIN_BET = Number(process.env.CRASH_MIN_BET || 100);
const CRASH_MAX_BET = Number(process.env.CRASH_MAX_BET || 1000);
const CRASH_JACKPOT_PERCENT = Number(process.env.CRASH_JACKPOT_PERCENT || 10);
const CRASH_HOUSE_EDGE_PERCENT = Number(process.env.CRASH_HOUSE_EDGE_PERCENT || 10);
const CRASH_INSTANT_CRASH_CHANCE = Number(process.env.CRASH_INSTANT_CRASH_CHANCE || 10);
const CRASH_MAX_MULTIPLIER = Number(process.env.CRASH_MAX_MULTIPLIER || 25);
const CRASH_AUTO_CASHOUT_OPTIONS = String(process.env.CRASH_AUTO_CASHOUT_OPTIONS || "1.5,2,3,5,10")
  .split(",")
  .map((value) => Number(String(value).trim()))
  .filter((value) => Number.isFinite(value) && value > 1)
  .slice(0, 5);
const CRASH_AUTO_CASHOUT_MIN = Number(process.env.CRASH_AUTO_CASHOUT_MIN || 1.1);
const CRASH_AUTO_CASHOUT_MAX = Number(process.env.CRASH_AUTO_CASHOUT_MAX || CRASH_MAX_MULTIPLIER || 25);
const PROMO_NEW_USER_DAYS = Number(process.env.PROMO_NEW_USER_DAYS || 3);
const FACEBROWSER_API_KEY = process.env.FACEBROWSER_API_KEY || null;
const FACEBROWSER_PAGE_ID = process.env.FACEBROWSER_PAGE_ID || null;
const FACEBROWSER_API_BASE = process.env.FACEBROWSER_API_BASE || "https://fbv2-api.gtaw.io/api/v1/page-api";
const FACEBROWSER_AUTOPOST_EVENTS = String(process.env.FACEBROWSER_AUTOPOST_EVENTS || "false").toLowerCase() === "true";
const WITHDRAW_COMMISSION_PERCENT = Number(process.env.WITHDRAW_COMMISSION_PERCENT || 5);

const LOTTERY_TICKET_PRICE = Number(process.env.LOTTERY_TICKET_PRICE || 1000);
const LOTTERY_MIN_NUMBER = 1;
const LOTTERY_MAX_NUMBER = 36;
const LOTTERY_NUMBERS_COUNT = 5;
const LOTTERY_MAX_TICKETS_PER_DRAW = 5;

const LS_THEME = {
  green: 0x18d875,
  gold: 0xf4c542,
  red: 0xff3333,
  blue: 0x60a5fa,
};

const LS_TEXT = {
  footer: "LS Bet • Events • Coinflip • Lottery",
  line: "━━━━━━━━━━━━━━━━━━━━",
};

function embed(color = LS_THEME.green) {
  return new EmbedBuilder().setColor(color).setTimestamp().setFooter({ text: LS_TEXT.footer });
}

function money(amount) {
  return `$${Number(amount || 0).toLocaleString("en-US")}`;
}

function unix(date) {
  return Math.floor(new Date(date).getTime() / 1000);
}

function isAdmin(interaction) {
  if (interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) return true;
  const adminRoleId = process.env.ADMIN_ROLE_ID;
  const modRoleId = process.env.MOD_ROLE_ID;
  if (adminRoleId && interaction.member?.roles?.cache?.has(adminRoleId)) return true;
  if (modRoleId && interaction.member?.roles?.cache?.has(modRoleId)) return true;
  return false;
}

async function adminOnly(interaction) {
  if (isAdmin(interaction)) return false;
  await respondInteraction(interaction, { content: "⛔ Эта команда доступна только администрации.", ephemeral: true });
  return true;
}

async function memberHasRole(guild, discordId, roleId) {
  if (!guild || !discordId || !roleId) return false;

  const member = await guild.members.fetch(discordId).catch(() => null);
  return Boolean(member?.roles?.cache?.has(roleId));
}

async function grantRegistrationRole(guild, discordId) {
  if (!guild || !discordId || !REGISTRATION_ROLE_ID) return false;

  const member = await guild.members.fetch(discordId).catch(() => null);
  if (!member) return false;

  if (member.roles.cache.has(REGISTRATION_ROLE_ID)) return true;
  await member.roles.add(REGISTRATION_ROLE_ID, "LS BET registration approved");
  return true;
}

function calcRegistrationTopupBonus(amount) {
  if (!REGISTRATION_ROLE_ID || !Number.isFinite(REGISTRATION_TOPUP_BONUS_PERCENT) || REGISTRATION_TOPUP_BONUS_PERCENT <= 0) return 0;
  return Math.floor((Number(amount || 0) * REGISTRATION_TOPUP_BONUS_PERCENT) / 100);
}

async function isVerifiedDiscordMember(interaction) {
  if (!REGISTRATION_ROLE_ID) return false;

  const member = interaction.member || await interaction.guild?.members.fetch(interaction.user.id).catch(() => null);
  return Boolean(member?.roles?.cache?.has(REGISTRATION_ROLE_ID));
}

function unverifiedLimitText() {
  return [
    `Максимальная ставка без верификации: **${money(UNVERIFIED_MAX_BET)}**.`,
    `Максимальное пополнение за раз без верификации: **${money(UNVERIFIED_MAX_TOPUP)}**.`,
    "Чтобы снять лимиты и получить бонус к пополнениям, пройди регистрацию."
  ].join("\n");
}

function welcomeDmEmbed() {
  return embed(LS_THEME.green)
    .setTitle("💚 Добро пожаловать в LS BET")
    .setDescription([
      "```",
      "LS BET PLAYER GUIDE",
      "```",
      "LS BET — платформа событий, ставок, Coinflip и лотереи",
      "",
      "**Обычный пользователь**",
      `• лимит ставки: ${money(UNVERIFIED_MAX_BET)}`,
      `• лимит пополнения за раз: ${money(UNVERIFIED_MAX_TOPUP)}`,
      "• можно пользоваться базовыми функциями",
      "",
      "**Верифицированный пользователь**",
      "• повышенное доверие аккаунта",
      `• бонус к пополнению`,
      "• регистрационные данные подтверждены модерацией",
      "",
      LS_TEXT.line,
      "**Навигация по меню**",
      "👤 Профиль — баланс, статистика и статус регистрации",
      "🎰 События — активные матчи и события",
      "🧾 Мои ставки — история и активные ставки",
      "🪙 Coinflip — дуэли игроков",
      "🎫 Лотерея — билеты 5 чисел от 1 до 36",
      "🎟️ Промокод — активация бонусов",
      "🏆 Top — рейтинг игроков",
      "💰 Пополнить — заявка на пополнение",
      "💸 Вывести — заявка на вывод",
      "",
      "Для верификации найди сообщение LS BET с кнопкой **Регистрация** и заполни форму."
    ].join("\n"));
}

async function userOf(discordUser) {
  return prisma.user.upsert({
    where: { discordId: discordUser.id },
    update: { username: discordUser.username },
    create: { discordId: discordUser.id, username: discordUser.username, balance: START_BALANCE },
  });
}

async function decrementBalanceOrThrow(tx, userId, amount) {
  const result = await tx.user.updateMany({
    where: {
      id: userId,
      balance: { gte: amount },
    },
    data: {
      balance: { decrement: amount },
    },
  });

  if (result.count !== 1) {
    const error = new Error("INSUFFICIENT_BALANCE");
    error.code = "INSUFFICIENT_BALANCE";
    throw error;
  }
}

function isInsufficientBalance(error) {
  return error?.code === "INSUFFICIENT_BALANCE" || error?.message === "INSUFFICIENT_BALANCE";
}


async function log(type, title, description, fields = [], options = {}) {
  try {
    await prisma.botLog.create({
      data: {
        type,
        message: `${title}
${description || ""}`,
        userId: options.userId ? String(options.userId) : null,
        channelId: options.channelId ? String(options.channelId) : null,
      },
    });
  } catch (error) {
    console.error("BOTLOG DB ERROR:", error.message);
  }

  const channelId = process.env.LOG_CHANNEL_ID;
  if (!channelId) {
    console.log("⚠️ LOG_CHANNEL_ID не указан в .env");
    return;
  }

  try {
    const channel = await client.channels.fetch(channelId).catch(() => null);
    if (!channel?.isTextBased()) {
      console.log("⚠️ Лог-канал не найден или бот не может туда писать.");
      return;
    }

    const e = embed(logColor(type))
      .setTitle(title)
      .setDescription(description || "Без описания");

    const cleanFields = Array.isArray(fields)
      ? fields
          .filter((field) => field && field.name)
          .map((field) => ({
            name: String(field.name).slice(0, 256),
            value: String(field.value ?? "—").slice(0, 1024),
            inline: field.inline ?? true,
          }))
          .slice(0, 25)
      : [];

    if (cleanFields.length) e.addFields(cleanFields);
    await channel.send({ embeds: [e] });
  } catch (error) {
    console.error("LOG ERROR:", error.message);
  }
}

function logColor(type) {
  const value = String(type || "").toUpperCase();

  if (value.includes("REJECT") || value.includes("ERROR") || value.includes("FAILED") || value.includes("REMOVE") || value.includes("CANCEL")) {
    return LS_THEME.red;
  }

  if (value.includes("APPROVED") || value.includes("WIN") || value.includes("FINISH") || value.includes("PAID") || value.includes("TOPUP")) {
    return LS_THEME.green;
  }

  if (value.includes("WITHDRAW") || value.includes("ADMIN") || value.includes("LOTTERY")) {
    return LS_THEME.gold;
  }

  if (value.includes("COINFLIP") || value.includes("EVENT") || value.includes("BET")) {
    return LS_THEME.blue;
  }

  if (value.includes("PROMO") || value.includes("REFERRAL")) {
    return 0x9b59b6;
  }

  return LS_THEME.green;
}

function txName(type) {
  return {
    EVENT_CREATED: "Событие создано",
    EVENT_AUTO_LIVE: "Событие автоматически LIVE",
    EVENT_MANUAL_LIVE: "Событие переведено в LIVE",
    EVENT_FINISHED: "Событие завершено",
    EVENT_CANCELLED: "Событие отменено",
    EVENT_REFUND: "Возврат ставки по событию",
    EVENT_BET: "Ставка на событие",
    EVENT_BET_FAILED: "Неудачная ставка",
    EVENT_WIN: "Выигрыш по событию",
    ADMIN_ADD: "Начисление админа",
    ADMIN_REMOVE: "Списание админа",
    BALANCE_SET: "Баланс установлен",
    TOPUP_CREATED: "Заявка на пополнение",
    TOPUP_SCREENSHOT: "Скриншот пополнения",
    TOPUP_APPROVED: "Пополнение одобрено",
    TOPUP_REJECTED: "Пополнение отклонено",
    PROMO_CREATED: "Промокод создан",
    REFERRAL_PROMO_CREATED: "Реферальный промокод создан",
    PROMO_EDITED: "Промокод изменён",
    PROMO_DELETED: "Промокод удалён",
    PROMO_ACTIVATED: "Промокод активирован",
    REFERRAL_BONUS: "Реферальный бонус",
    COINFLIP_CREATE: "Coinflip создан",
    COINFLIP_ACCEPT: "Coinflip принят",
    COINFLIP_WIN: "Coinflip выигрыш",
    COINFLIP_REFUND: "Coinflip возврат",
    COINFLIP_CANCELLED: "Coinflip отменён",
    WITHDRAW_CREATED: "Заявка на вывод создана",
    WITHDRAW_REQUEST: "Заявка на вывод",
    WITHDRAW_APPROVED: "Вывод одобрен",
    WITHDRAW_REJECTED: "Вывод отклонён",
    WITHDRAW_REFUND: "Возврат вывода",
    LOTTERY_TICKET: "Билет лотереи",
    LOTTERY_DRAW: "Розыгрыш лотереи",
    LOTTERY_WIN: "Выигрыш лотереи",
    CRASH_BET: "CRASH ставка",
    CRASH_CASHOUT: "CRASH вывод",
    CRASH_LOST: "CRASH проигрыш",
    CRASH_ROUND: "CRASH раунд",
    REGISTRATION_CREATED: "Заявка на регистрацию",
    REGISTRATION_APPROVED: "Регистрация одобрена",
    REGISTRATION_REJECTED: "Регистрация отклонена",
    TICKET_CLOSED: "Тикет закрыт",
  }[type] || type;
}

function statusEvent(status) {
  if (status === "OPEN") return "🟢 OPEN";
  if (status === "LIVE") return "🔴 LIVE";
  if (status === "FINISHED") return "🏁 FINISHED";
  if (status === "CANCELLED") return "⚫ CANCELLED";
  return status;
}

function registrationStatusName(status) {
  if (status === "APPROVED") return "✅ Одобрена";
  if (status === "PENDING") return "⏳ На модерации";
  if (status === "REJECTED") return "❌ Отклонена";
  return "⚪ Не пройдена";
}

function isEventClosed(event) {
  return new Date(event.closesAt).getTime() <= Date.now();
}

function optionTotal(option) {
  return (option.bets || []).filter((b) => b.status === "ACTIVE").reduce((s, b) => s + b.amount, 0);
}

function eventBank(event) {
  return (event.options || []).reduce((s, o) => s + optionTotal(o), 0);
}

async function fullEvent(id) {
  return prisma.rpEvent.findUnique({
    where: { id },
    include: { options: { orderBy: { id: "asc" }, include: { bets: true } } },
  });
}

function registrationPanel() {
  const e = embed(LS_THEME.green)
    .setTitle("📝 LS BET — Регистрация игрока")
    .setDescription([
      "```",
      "PLAYER REGISTRATION",
      "```",
      "Чтобы пользоваться LS BET, пройди регистрацию через тикет.",
      "",
      "Нужно указать:",
      "• Имя и фамилию",
      "• Номер телефона",
      "• Возраст",
      "",
      "После отправки заявка попадёт на модерацию администрации.",
      LS_TEXT.line,
    ].join("\n"));

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("registration_start").setLabel("📝 Регистрация").setStyle(ButtonStyle.Success)
  );

  return { embeds: [e], components: [row] };
}

function registrationModal() {
  const modal = new ModalBuilder().setCustomId("registration_modal").setTitle("LS BET — регистрация");
  modal.addComponents(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder().setCustomId("fullName").setLabel("Имя и фамилия").setPlaceholder("Например: Name Surname").setRequired(true).setStyle(TextInputStyle.Short).setMinLength(3).setMaxLength(80)
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder().setCustomId("phone").setLabel("Номер телефона").setPlaceholder("Например: 555-1234").setRequired(true).setStyle(TextInputStyle.Short).setMinLength(3).setMaxLength(40)
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder().setCustomId("age").setLabel("Возраст").setPlaceholder("Например: 21").setRequired(true).setStyle(TextInputStyle.Short).setMinLength(1).setMaxLength(3)
    )
  );
  return modal;
}

function registrationModerationRow(requestId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`registration_approve:${requestId}`).setLabel("✅ Одобрить").setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`registration_reject:${requestId}`).setLabel("❌ Отклонить").setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId(`registration_ticket_close:${requestId}`).setLabel("🔒 Закрыть").setStyle(ButtonStyle.Secondary)
  );
}

function closeRegistrationTicketRow(requestId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`registration_ticket_close:${requestId}`).setLabel("🔒 Закрыть тикет").setStyle(ButtonStyle.Secondary)
  );
}

async function createRegistrationRequest(interaction, fullName, phone, ageRaw) {
  const age = Number(ageRaw);
  if (!Number.isInteger(age) || age < 1 || age > 120) {
    return respondInteraction(interaction, { content: "Возраст должен быть числом от 1 до 120.", ephemeral: true });
  }

  const user = await userOf(interaction.user);
  if (user.registrationStatus === "APPROVED") {
    return respondInteraction(interaction, { content: "✅ Ты уже зарегистрирован в LS BET.", ephemeral: true });
  }

  const pending = await prisma.registrationRequest.findFirst({ where: { userId: user.id, status: "PENDING" } });
  if (pending) {
    return respondInteraction(interaction, {
      content: pending.ticketChannelId ? `⏳ У тебя уже есть заявка на модерации: <#${pending.ticketChannelId}>.` : "⏳ У тебя уже есть заявка на модерации.",
      ephemeral: true,
    });
  }

  const request = await prisma.registrationRequest.create({ data: { userId: user.id, fullName, phone, age, status: "PENDING" } });
  await prisma.user.update({ where: { id: user.id }, data: { registrationStatus: "PENDING" } });

  let channel;
  try {
    channel = await createTicketChannel(interaction, "registration", request.id);
    await prisma.registrationRequest.update({ where: { id: request.id }, data: { ticketChannelId: channel.id } });
  } catch (error) {
    console.error("REGISTRATION TICKET CREATE ERROR:", error);
    await prisma.$transaction([
      prisma.registrationRequest.update({
        where: { id: request.id },
        data: { status: "CANCELLED", processedAt: new Date(), rejectReason: "Не удалось создать Discord-тикет" },
      }),
      prisma.user.update({
        where: { id: user.id },
        data: { registrationStatus: null },
      }),
    ]);

    return respondInteraction(interaction, {
      content: "❌ Не удалось создать тикет регистрации. Попробуй ещё раз или сообщи администратору.",
      ephemeral: true,
    });
  }

  const e = embed(LS_THEME.gold)
    .setTitle(`📝 Заявка на регистрацию #${request.id}`)
    .setDescription([
      `Игрок: <@${interaction.user.id}>`,
      `Discord ID: \`${interaction.user.id}\``,
      "",
      "**Данные игрока:**",
      `Имя и фамилия: **${fullName}**`,
      `Телефон: **${phone}**`,
      `Возраст: **${age}**`,
      "",
      "Администратор должен одобрить или отклонить регистрацию.",
    ].join("\n"));

  await channel.send({ content: `<@${interaction.user.id}>`, embeds: [e], components: [registrationModerationRow(request.id)] });
  await log("REGISTRATION_CREATED", "📝 Создана заявка на регистрацию", `Игрок <@${interaction.user.id}> создал заявку #${request.id}.`, [
    { name: "Тикет", value: `<#${channel.id}>`, inline: true },
    { name: "Возраст", value: String(age), inline: true },
  ], { userId: user.id, channelId: channel.id });

  return respondInteraction(interaction, { content: `✅ Заявка на регистрацию создана: <#${channel.id}>. Ожидай решения администрации.`, ephemeral: true });
}

async function approveRegistration(interaction, requestId) {
  if (await adminOnly(interaction)) return;
  await interaction.deferUpdate();
  const request = await prisma.registrationRequest.findUnique({ where: { id: requestId }, include: { user: true } });
  if (!request) return respondInteraction(interaction, { content: "Заявка не найдена.", ephemeral: true });
  if (request.status !== "PENDING") return respondInteraction(interaction, { content: "Эта заявка уже обработана.", ephemeral: true });

  await prisma.$transaction(async (tx) => {
    const lock = await tx.registrationRequest.updateMany({ where: { id: request.id, status: "PENDING" }, data: { status: "APPROVED", processedBy: interaction.user.id, processedAt: new Date() } });
    if (lock.count !== 1) { const error = new Error("REGISTRATION_ALREADY_PROCESSED"); error.code = "REGISTRATION_ALREADY_PROCESSED"; throw error; }
    await tx.user.update({ where: { id: request.userId }, data: { registrationStatus: "APPROVED", registeredFullName: request.fullName, registeredPhone: request.phone, registeredAge: request.age, registeredAt: new Date() } });
  });

  const roleGranted = await grantRegistrationRole(interaction.guild, request.user.discordId).catch((error) => {
    console.error("grantRegistrationRole:", error.message);
    return false;
  });

  await interaction.editReply({
    content:
      `✅ Регистрация игрока <@${request.user.discordId}> одобрена модератором <@${interaction.user.id}>.` +
      (REGISTRATION_ROLE_ID
        ? roleGranted
          ? `\n🎖️ Роль <@&${REGISTRATION_ROLE_ID}> выдана. Бонус к пополнениям: **+${REGISTRATION_TOPUP_BONUS_PERCENT}%**.`
          : `\n⚠️ Регистрация одобрена, но роль <@&${REGISTRATION_ROLE_ID}> не удалось выдать. Проверь права и позицию роли бота.`
        : ""),
    components: [closeRegistrationTicketRow(request.id)],
  });

  await log("REGISTRATION_APPROVED", "✅ Регистрация одобрена", `Модератор <@${interaction.user.id}> одобрил заявку #${request.id}.`, [
    { name: "Игрок", value: `<@${request.user.discordId}>`, inline: true },
    { name: "Тикет", value: request.ticketChannelId ? `<#${request.ticketChannelId}>` : "—", inline: true },
    { name: "Роль", value: REGISTRATION_ROLE_ID ? (roleGranted ? `<@&${REGISTRATION_ROLE_ID}> выдана` : "Не выдана") : "Не настроена", inline: true },
    { name: "Бонус пополнения", value: REGISTRATION_ROLE_ID ? `+${REGISTRATION_TOPUP_BONUS_PERCENT}%` : "Не настроен", inline: true },
  ], { userId: request.userId, channelId: interaction.channelId });
}

async function rejectRegistration(interaction, requestId) {
  if (await adminOnly(interaction)) return;
  await interaction.deferUpdate();
  const request = await prisma.registrationRequest.findUnique({ where: { id: requestId }, include: { user: true } });
  if (!request) return respondInteraction(interaction, { content: "Заявка не найдена.", ephemeral: true });
  if (request.status !== "PENDING") return respondInteraction(interaction, { content: "Эта заявка уже обработана.", ephemeral: true });

  await prisma.$transaction(async (tx) => {
    const lock = await tx.registrationRequest.updateMany({ where: { id: request.id, status: "PENDING" }, data: { status: "REJECTED", processedBy: interaction.user.id, processedAt: new Date() } });
    if (lock.count !== 1) { const error = new Error("REGISTRATION_ALREADY_PROCESSED"); error.code = "REGISTRATION_ALREADY_PROCESSED"; throw error; }
    await tx.user.update({ where: { id: request.userId }, data: { registrationStatus: "REJECTED" } });
  });

  await interaction.editReply({ content: `❌ Регистрация игрока <@${request.user.discordId}> отклонена модератором <@${interaction.user.id}>.`, components: [closeRegistrationTicketRow(request.id)] });
  await log("REGISTRATION_REJECTED", "❌ Регистрация отклонена", `Модератор <@${interaction.user.id}> отклонил заявку #${request.id}.`, [
    { name: "Игрок", value: `<@${request.user.discordId}>`, inline: true },
    { name: "Тикет", value: request.ticketChannelId ? `<#${request.ticketChannelId}>` : "—", inline: true },
  ], { userId: request.userId, channelId: interaction.channelId });
}

async function closeRegistrationTicket(interaction, requestId) {
  if (await adminOnly(interaction)) return;
  await interaction.deferUpdate();
  await log("TICKET_CLOSED", "🔒 Тикет регистрации закрыт", `Модератор <@${interaction.user.id}> закрыл тикет регистрации #${requestId}.`, [], { channelId: interaction.channelId });
  return interaction.channel.delete(`Registration ticket #${requestId} closed by ${interaction.user.tag}`).catch(() => null);
}

function mainPanel() {
  const e = embed(LS_THEME.green)
    .setTitle("💚 LS Bet — Главное меню")
    .setDescription([
      "```",
      "LS BET PLATFORM",
      "EVENTS • COINFLIP • LOTTERY • PROMO",
      "```",
      "Cобытия, ставки, Coinflip, лотерея 5 чисел, промокоды, пополнение и вывод баланса.",
      "",
      LS_TEXT.line,
    ].join("\n"));

  const r1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("registration_start").setLabel("✅ Пройти верификацию").setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId("panel_profile").setLabel("👤 Профиль").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId("panel_events").setLabel("🎰 События").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId("panel_mybets").setLabel("🧾 Мои ставки").setStyle(ButtonStyle.Secondary)
  );

  const r2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("panel_coinflip").setLabel("🪙 Coinflip").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId("panel_lottery").setLabel("🎫 Лотерея").setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId("panel_promo").setLabel("🎟️ Промокод").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId("panel_top").setLabel("🏆 Top").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId("panel_history").setLabel("📜 История").setStyle(ButtonStyle.Secondary)
  );

  const r3 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("panel_jackpot").setLabel("💣 Jackpot War").setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId("panel_crash").setLabel("🚀 CRASH").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId("panel_topup").setLabel("💰 Пополнить").setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId("panel_withdraw").setLabel("💸 Вывести").setStyle(ButtonStyle.Danger)
  );

  return { embeds: [e], components: [r1, r2, r3] };
}

function adminPanel() {
  const e = embed(LS_THEME.gold)
    .setTitle("🛠️ LS Bet — Admin Panel")
    .setDescription([
      "```",
      "ADMIN CONTROL CENTER",
      "EVENTS • USERS • TOPUPS • WITHDRAWS • PROMOS • LOTTERY",
      "```",
      "Выбери раздел ниже. Основные действия администрации теперь доступны через кнопки и формы.",
      LS_TEXT.line,
    ].join("\n"));

  const r1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("admin_events").setLabel("📢 События").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId("admin_users_panel").setLabel("👤 Пользователи").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId("admin_topups").setLabel("💰 Пополнения").setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId("admin_withdraws").setLabel("💸 Выводы").setStyle(ButtonStyle.Danger)
  );

  const r2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("admin_promos").setLabel("🎟️ Промокоды").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId("admin_lottery").setLabel("🎫 Лотерея").setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId("admin_registration_panel_publish").setLabel("✅ Панель регистрации").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId("admin_jackpot").setLabel("💣 Jackpot").setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId("admin_public_panel").setLabel("📌 Главное меню").setStyle(ButtonStyle.Success)
  );

  return { embeds: [e], components: [r1, r2], ephemeral: true };
}

function adminUsersPanel() {
  const e = embed(LS_THEME.gold)
    .setTitle("👤 LS Bet — Управление пользователями")
    .setDescription([
      "```",
      "USER CONTROL",
      "BALANCE • PROFILE • TOP PLAYERS",
      "```",
      "Укажи Discord ID пользователя в форме. Баланс, ставки и регистрационные данные сохраняются в базе.",
      LS_TEXT.line,
    ].join("\n"));

  const r1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("admin_user_info_button").setLabel("🔎 Информация").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId("admin_user_add_balance_button").setLabel("➕ Начислить").setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId("admin_user_remove_balance_button").setLabel("➖ Списать").setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId("admin_user_set_balance_button").setLabel("⚙️ Установить баланс").setStyle(ButtonStyle.Secondary)
  );

  const r2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("admin_users_top_button").setLabel("🏆 Топ игроков").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId("admin_back_main").setLabel("⬅️ Назад").setStyle(ButtonStyle.Secondary)
  );

  return { embeds: [e], components: [r1, r2], ephemeral: true };
}

function eventEmbeds(event) {
  const closed = event.status !== "OPEN" || isEventClosed(event);
  const color = event.status === "OPEN" ? LS_THEME.green : event.status === "LIVE" ? LS_THEME.red : event.status === "CANCELLED" ? 0x2b2d31 : LS_THEME.gold;
  const status = statusEvent(closed && event.status === "OPEN" ? "LIVE" : event.status);
  const bank = eventBank(event);
  const options = event.options || [];
  const bannerUrl = options.find((option) => option.imageUrl)?.imageUrl;

  const optionLine = (option, index) => {
    if (!option) return "—";
    const total = optionTotal(option);
    const share = bank > 0 ? Math.round((total / bank) * 100) : 0;
    const markers = ["🟢", "🟡", "🔵", "⚪", "🟣"];
    return `${markers[index] || "⚪"} **${option.title}**\nКоэфф: **x${option.odds}** • Ставок: **${money(total)}** • Банк: **${share}%**`;
  };

  const optionLines = options.length
    ? options.map((option, index) => optionLine(option, index)).join("\n\n")
    : "Исходы не указаны.";

  const main = embed(color)
    .setTitle(`💚 LS BET | EVENT #${event.id}`)
    .setDescription([
      "```",
      options.length >= 3 ? "FOOTBALL LINE: П1 • X • П2" : "BETTING LINE",
      "```",
      `# ${event.title}`,
      event.description || "Описание не указано.",
      "",
      "📊 **Исходы матча**",
      optionLines,
      "",
      LS_TEXT.line,
      `📊 **Статус:** ${status}`,
      `💰 **Банк события:** ${money(bank)}`,
      `⏳ **Закрытие ставок:** <t:${unix(event.closesAt)}:R>`,
      LS_TEXT.line,
      "Нажми кнопку ниже, чтобы сделать ставку.",
    ].join("\n"));

  if (bannerUrl) main.setImage(bannerUrl);

  return [main];
}

function eventButtons(event) {
  const disabled = event.status !== "OPEN" || isEventClosed(event);
  const rows = [];
  const options = (event.options || []).slice(0, 5);

  if (options.length) {
    const row = new ActionRowBuilder();
    for (const option of options) {
      row.addComponents(
        new ButtonBuilder()
          .setCustomId(`bet:${event.id}:${option.id}`)
          .setLabel(`💵 ${String(option.title).slice(0, 20)} | x${option.odds}`)
          .setStyle(ButtonStyle.Success)
          .setDisabled(disabled)
      );
    }
    rows.push(row);
  }

  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`event_stats:${event.id}`).setLabel("📊 Статистика").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId("panel_profile").setLabel("👤 Профиль").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId("panel_top").setLabel("🏆 Top").setStyle(ButtonStyle.Secondary)
  );
  rows.push(row2);

  return rows;
}

async function updateEventMessage(eventId) {
  const event = await fullEvent(eventId);
  if (!event?.messageId || !event?.channelId) return;
  try {
    const channel = await client.channels.fetch(event.channelId);
    const msg = await channel.messages.fetch(event.messageId);
    await msg.edit({ content: "📢 **LS Bet афиша события**", embeds: eventEmbeds(event), components: eventButtons(event) });
  } catch (e) {
    console.error("updateEventMessage:", e.message);
  }
}

async function closeExpiredEvents() {
  const events = await prisma.rpEvent.findMany({ where: { status: "OPEN", closesAt: { lte: new Date() } } });
  for (const event of events) {
    await prisma.rpEvent.update({ where: { id: event.id }, data: { status: "LIVE" } });
    await updateEventMessage(event.id);
    await log("EVENT_AUTO_LIVE", "🔴 Событие автоматически переведено в LIVE", `Событие **#${event.id} ${event.title}** закрыто по таймеру.`);
  }
}

async function publishEventResult(event, winnerOption, winnersCount, totalPaid) {
  try {
    const channel = await client.channels.fetch(RESULT_CHANNEL_ID);
    if (!channel?.isTextBased()) return;
    const e = embed(LS_THEME.gold)
      .setTitle("🏁 LS BET RESULT")
      .setDescription([
        "```",
        "EVENT FINISHED",
        "```",
        `# ${event.title}`,
        "",
        `**ID события:** #${event.id}`,
        `**Победный исход:** ${winnerOption.title}`,
        `**Победителей:** ${winnersCount}`,
        `**Выплачено:** ${money(totalPaid)}`,
      ].join("\n"));
    if (winnerOption.imageUrl) e.setImage(winnerOption.imageUrl);
    await channel.send({ content: "🏁 **Итоги события**", embeds: [e] });
  } catch (e) {
    console.error("publishEventResult:", e.message);
  }
}

async function publishEventCancel(event, refundedCount, totalRefunded, reason) {
  try {
    const channel = await client.channels.fetch(RESULT_CHANNEL_ID);
    if (!channel?.isTextBased()) return;

    const bannerUrl = event.options?.find((option) => option.imageUrl)?.imageUrl;
    const e = embed(0x2b2d31)
      .setTitle("⚠️ LS BET EVENT CANCELLED")
      .setDescription([
        "```",
        "EVENT CANCELLED",
        "```",
        `# ${event.title}`,
        "",
        `**ID события:** #${event.id}`,
        `**Причина:** ${reason || "Не указана"}`,
        `**Возвращено ставок:** ${refundedCount}`,
        `**Сумма возврата:** ${money(totalRefunded)}`,
      ].join("\n"));

    if (bannerUrl) e.setImage(bannerUrl);
    await channel.send({ content: "⚠️ **Событие отменено**", embeds: [e] });
  } catch (e) {
    console.error("publishEventCancel:", e.message);
  }
}


function facebrowserEnabled() {
  return Boolean(FACEBROWSER_API_KEY && FACEBROWSER_PAGE_ID);
}

function facebrowserAuthHeaders() {
  return {
    Authorization: `Bearer ${FACEBROWSER_API_KEY}`,
    "Content-Type": "application/json",
  };
}

async function facebrowserRequest(method, path, body = null, query = {}) {
  if (!facebrowserEnabled()) return null;
  const url = new URL(`${FACEBROWSER_API_BASE}${path}`);
  for (const [key, value] of Object.entries(query || {})) {
    if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
  }
  const res = await fetch(url, {
    method,
    headers: facebrowserAuthHeaders(),
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }
  if (!res.ok) {
    const error = new Error(`FACEBROWSER_${res.status}`);
    error.data = data;
    throw error;
  }
  return data;
}

function facebrowserEventBannerUrl(event) {
  return (event.options || []).find((option) => option.imageUrl)?.imageUrl || null;
}

function facebrowserEventContent(event) {
  const options = event.options || [];
  const bank = eventBank(event);
  const bannerUrl = facebrowserEventBannerUrl(event);

  const line = options.length
    ? options.map((option, index) => {
        const labels = ["П1", "X", "П2"];
        const label = labels[index] || option.title;
        const total = optionTotal(option);
        const share = bank > 0 ? Math.round((total / bank) * 100) : 0;
        return `${label} ${option.title} — x${option.odds} | Ставок: ${money(total)} | Банк: ${share}%`;
      }).join("\n")
    : "Линия скоро появится.";

  return [
    `💚 LS BET | EVENT #${event.id}`,
    "",
    `# ${event.title}`,
    event.description || "Событие открыто для ставок.",
    "",
    "📊 Исходы матча:",
    line,
    "",
    `📊 Статус: ${statusEvent(event.status)}`,
    `💰 Банк события: ${money(bank)}`,
    `⏳ Закрытие ставок: ${new Date(event.closesAt).toLocaleString("ru-RU")}`,
    bannerUrl ? `🖼 Афиша: ${bannerUrl}` : null,
    "",
    "Нажми кнопку в Discord LS BET, чтобы сделать ставку.",
    "LS BET — твоя игра, твои правила.",
  ].filter(Boolean).join("\n");
}

async function publishFacebrowserEvent(eventId) {
  console.log("FACEBROWSER START", { enabled: facebrowserEnabled(), pageId: FACEBROWSER_PAGE_ID, eventId });
  if (!facebrowserEnabled()) return null;
  const event = await fullEvent(eventId);
  if (!event) return null;

  const content = facebrowserEventContent(event);
  const bannerUrl = facebrowserEventBannerUrl(event);

  // По документации FACEBROWSER Page API принимает только page_id и content.
  // Поэтому картинку безопасно добавляем ссылкой в текст. Если площадка начнёт
  // поддерживать image_url/media_url, включи FACEBROWSER_SEND_IMAGE_FIELDS=true.
  const sendImageFields = String(process.env.FACEBROWSER_SEND_IMAGE_FIELDS || "false").toLowerCase() === "true";
  const body = { page_id: FACEBROWSER_PAGE_ID, content };
  if (sendImageFields && bannerUrl) {
    body.image_url = bannerUrl;
    body.media_url = bannerUrl;
    body.attachment_url = bannerUrl;
  }

  if (event.facebrowserPostId) {
    await facebrowserRequest("PUT", `/posts/${event.facebrowserPostId}`, sendImageFields ? body : { content }, { page_id: FACEBROWSER_PAGE_ID });
    console.log("FACEBROWSER UPDATED", { eventId: event.id, postId: event.facebrowserPostId, hasImage: Boolean(bannerUrl) });
    return { action: "updated", postId: event.facebrowserPostId, hasImage: Boolean(bannerUrl) };
  }

  const data = await facebrowserRequest("POST", "/posts", body);
  const postId = data?.post?.id || data?.id || data?.postId || data?.post?.postId;
  if (postId) await prisma.rpEvent.update({ where: { id: event.id }, data: { facebrowserPostId: String(postId) } });
  console.log("FACEBROWSER CREATED", { eventId: event.id, postId: postId || null, hasImage: Boolean(bannerUrl) });
  return { action: "created", postId: postId ? String(postId) : null, hasImage: Boolean(bannerUrl) };
}

async function deleteFacebrowserEventPost(event) {
  if (!facebrowserEnabled() || !event?.facebrowserPostId) return null;
  await facebrowserRequest("DELETE", `/posts/${event.facebrowserPostId}`, null, { page_id: FACEBROWSER_PAGE_ID });
  await prisma.rpEvent.update({ where: { id: event.id }, data: { facebrowserPostId: null } }).catch(() => null);
  return true;
}

async function getActiveJackpotWar(tx = prisma) {
  let round = await tx.jackpotWar.findFirst({ where: { status: "ACTIVE" }, orderBy: { id: "desc" } });
  if (!round) {
    round = await tx.jackpotWar.create({ data: { currentPool: 0, targetPool: JACKPOT_WAR_TARGET, status: "ACTIVE" } });
  }
  return round;
}

async function addJackpotContribution(tx, userId, source, sourceId, baseAmount) {
  if (!JACKPOT_WAR_ENABLED || !Number.isFinite(JACKPOT_WAR_PERCENT) || JACKPOT_WAR_PERCENT <= 0) return null;
  const contribution = Math.max(1, Math.floor((Number(baseAmount || 0) * JACKPOT_WAR_PERCENT) / 100));
  if (!Number.isInteger(contribution) || contribution <= 0) return null;

  const round = await getActiveJackpotWar(tx);
  await tx.jackpotContribution.create({
    data: {
      roundId: round.id,
      userId,
      amount: contribution,
      source,
      sourceId: sourceId ? String(sourceId) : null,
    },
  });
  await tx.jackpotWar.update({
    where: { id: round.id },
    data: { currentPool: { increment: contribution } },
  });
  await tx.transaction.create({
    data: {
      userId,
      amount: 0,
      type: "JACKPOT_CONTRIBUTION",
      comment: `Jackpot War: ${money(contribution)} с операции ${source}${sourceId ? ` #${sourceId}` : ""}`,
    },
  });
  return { roundId: round.id, contribution };
}


async function sendJackpotWarLiveNotification(lastContribution = null) {
  if (!JACKPOT_WAR_ENABLED) return;

  try {
    const round = await getActiveJackpotWar();
    const [totalAgg, contributors, top] = await Promise.all([
      prisma.jackpotContribution.aggregate({ where: { roundId: round.id }, _sum: { amount: true } }),
      prisma.jackpotContribution.groupBy({ by: ["userId"], where: { roundId: round.id }, _sum: { amount: true } }),
      prisma.jackpotContribution.groupBy({
        by: ["userId"],
        where: { roundId: round.id },
        _sum: { amount: true },
        orderBy: { _sum: { amount: "desc" } },
        take: 5,
      }),
    ]);

    const total = totalAgg._sum.amount || round.currentPool || 0;
    const left = Math.max(0, (round.targetPool || JACKPOT_WAR_TARGET) - total);
    const percent = round.targetPool > 0 ? ((total / round.targetPool) * 100).toFixed(2) : "0.00";

    const users = await prisma.user.findMany({ where: { id: { in: top.map((item) => item.userId) } } });
    const userMap = new Map(users.map((user) => [user.id, user]));

    const topText = top.length
      ? top.map((item, index) => `${index + 1}. <@${userMap.get(item.userId)?.discordId || item.userId}> — **${money(item._sum.amount || 0)}**`).join("\n")
      : "Пока нет вкладов.";

    let lastText = "—";
    if (lastContribution?.userId) {
      const user = await prisma.user.findUnique({ where: { id: lastContribution.userId } }).catch(() => null);
      const sourceName = {
        EVENT_BET: "ставка на событие",
        COINFLIP_CREATE: "создание Coinflip",
        COINFLIP_ACCEPT: "принятие Coinflip",
        LOTTERY_TICKET: "билет лотереи",
      }[lastContribution.source] || lastContribution.source || "операция";
      lastText = `<@${user?.discordId || lastContribution.userId}> +**${money(lastContribution.contribution || 0)}** • ${sourceName}${lastContribution.sourceId ? ` #${lastContribution.sourceId}` : ""}`;
    }

    const e = embed(LS_THEME.gold)
      .setTitle("💣 JACKPOT WAR — БАНК ОБНОВЛЁН")
      .setDescription([
        "```",
        "LIVE JACKPOT STATUS",
        "```",
        `💰 **Банк:** ${money(total)} / ${money(round.targetPool || JACKPOT_WAR_TARGET)}`,
        jackpotProgressBar(total, round.targetPool || JACKPOT_WAR_TARGET),
        `📈 **Прогресс:** ${percent}%`,
        `👥 **Участников:** ${contributors.length}`,
        `🎯 **До розыгрыша:** ${money(left)}`,
        "",
        `🧾 **Последний вклад:**\n${lastText}`,
        "",
        "🏆 **Топ вкладчиков:**",
        topText,
      ].join("\n"));

    const channel = await client.channels.fetch(JACKPOT_WAR_NOTIFY_CHANNEL_ID).catch(() => null);
    if (channel?.isTextBased()) {
      await channel.send({ embeds: [e] });
    } else {
      console.error("Jackpot notify channel not found:", JACKPOT_WAR_NOTIFY_CHANNEL_ID);
    }
  } catch (error) {
    console.error("sendJackpotWarLiveNotification:", error.message);
  }
}

async function maybeFinishJackpotWar() {
  if (!JACKPOT_WAR_ENABLED) return null;

  const active = await prisma.jackpotWar.findFirst({
    where: { status: "ACTIVE", currentPool: { gte: JACKPOT_WAR_TARGET } },
    orderBy: { id: "desc" },
    include: { contributions: { include: { user: true } } },
  });
  if (!active || !active.contributions.length) return null;

  const total = active.contributions.reduce((sum, item) => sum + item.amount, 0);
  if (total <= 0) return null;

  let ticket = Math.floor(Math.random() * total) + 1;
  let winnerContribution = active.contributions[0];
  for (const contribution of active.contributions) {
    ticket -= contribution.amount;
    if (ticket <= 0) {
      winnerContribution = contribution;
      break;
    }
  }

  const prize = active.currentPool;
  const result = await prisma.$transaction(async (tx) => {
    const lock = await tx.jackpotWar.updateMany({
      where: { id: active.id, status: "ACTIVE", currentPool: { gte: JACKPOT_WAR_TARGET } },
      data: { status: "FINISHED", winnerId: winnerContribution.userId, endedAt: new Date() },
    });
    if (lock.count !== 1) return null;

    await tx.user.update({ where: { id: winnerContribution.userId }, data: { balance: { increment: prize } } });
    await tx.transaction.create({
      data: {
        userId: winnerContribution.userId,
        amount: prize,
        type: "JACKPOT_WIN",
        comment: `Победа в Jackpot War #${active.id}`,
      },
    });
    const nextRound = await tx.jackpotWar.create({ data: { currentPool: 0, targetPool: JACKPOT_WAR_TARGET, status: "ACTIVE" } });
    return { nextRound };
  });

  if (!result) return null;

  const top = await prisma.jackpotContribution.groupBy({
    by: ["userId"],
    where: { roundId: active.id },
    _sum: { amount: true },
    orderBy: { _sum: { amount: "desc" } },
    take: 5,
  });
  const users = await prisma.user.findMany({ where: { id: { in: top.map((t) => t.userId) } } });
  const userMap = new Map(users.map((u) => [u.id, u]));
  const topText = top.map((item, index) => {
    const user = userMap.get(item.userId);
    return `${index + 1}. <@${user?.discordId || item.userId}> — ${money(item._sum.amount || 0)}`;
  }).join("\n") || "—";

  const e = embed(LS_THEME.gold)
    .setTitle("💣 JACKPOT WAR — ПОБЕДИТЕЛЬ")
    .setDescription([
      "```",
      "JACKPOT WAR FINISHED",
      "```",
      `Победитель: <@${winnerContribution.user.discordId}>`,
      `Выигрыш: **${money(prize)}**`,
      `Раунд: **#${active.id}**`,
      "",
      "🏆 **Топ вкладов раунда**",
      topText,
      "",
      `Новый раунд **#${result.nextRound.id}** уже начался.`
    ].join("\n"));

  const channel = await client.channels.fetch(JACKPOT_WAR_CHANNEL_ID).catch(() => null);
  if (channel?.isTextBased()) {
    await channel.send({ embeds: [e] });
  }
  await log("JACKPOT_WIN", "💣 Jackpot War завершён", `Победитель <@${winnerContribution.user.discordId}> получил ${money(prize)}.`, [
    { name: "Раунд", value: `#${active.id}`, inline: true },
    { name: "Выигрыш", value: money(prize), inline: true },
  ], { userId: winnerContribution.userId, channelId: JACKPOT_WAR_CHANNEL_ID });
  return { winner: winnerContribution.user, prize };
}

function jackpotProgressBar(current, target) {
  const width = 12;
  const ratio = target > 0 ? Math.min(1, current / target) : 0;
  const filled = Math.round(ratio * width);
  return "█".repeat(filled) + "░".repeat(width - filled);
}

async function jackpotWarPanel(interaction) {
  const user = await userOf(interaction.user);
  const round = await getActiveJackpotWar();
  const [totalAgg, myAgg, contributors, top] = await Promise.all([
    prisma.jackpotContribution.aggregate({ where: { roundId: round.id }, _sum: { amount: true } }),
    prisma.jackpotContribution.aggregate({ where: { roundId: round.id, userId: user.id }, _sum: { amount: true } }),
    prisma.jackpotContribution.groupBy({ by: ["userId"], where: { roundId: round.id }, _sum: { amount: true } }),
    prisma.jackpotContribution.groupBy({ by: ["userId"], where: { roundId: round.id }, _sum: { amount: true }, orderBy: { _sum: { amount: "desc" } }, take: 5 }),
  ]);

  const total = totalAgg._sum.amount || round.currentPool || 0;
  const mine = myAgg._sum.amount || 0;
  const chance = total > 0 ? ((mine / total) * 100).toFixed(2) : "0.00";
  const users = await prisma.user.findMany({ where: { id: { in: top.map((t) => t.userId) } } });
  const userMap = new Map(users.map((u) => [u.id, u]));
  const topText = top.length
    ? top.map((item, index) => `${index + 1}. <@${userMap.get(item.userId)?.discordId || item.userId}> — **${money(item._sum.amount || 0)}**`).join("\n")
    : "Пока нет вкладов.";

  const e = embed(LS_THEME.gold)
    .setTitle("💣 LS BET — JACKPOT WAR")
    .setDescription([
      "```",
      "EVERY BET FUELS THE WAR",
      "```",
      `Банк: **${money(total)} / ${money(round.targetPool)}**`,
      jackpotProgressBar(total, round.targetPool),
      "",
      `Участников: **${contributors.length}**`,
      `Твой вклад: **${money(mine)}**`,
      `Твой шанс: **${chance}%**`,
      "",
      "🏆 **Топ вкладов**",
      topText,
      "",
      `В Jackpot War автоматически попадает **${JACKPOT_WAR_PERCENT}%** с ставок, Coinflip и лотереи.`,
      "Когда банк достигает цели, бот сам выбирает победителя по весу вкладов."
    ].join("\n"));

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("jackpot_refresh").setLabel("🔄 Обновить").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId("panel_events").setLabel("🎰 К событиям").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId("panel_lottery").setLabel("🎫 Лотерея").setStyle(ButtonStyle.Success)
  );

  return respondInteraction(interaction, { embeds: [e], components: [row], ephemeral: true });
}


const crashRuntime = {
  active: false,
  roundId: null,
  multiplier: 1,
  messageId: null,
  status: "WAITING",
  nextStartsAt: null,
  bettingEndsAt: null,
  runningStartedAt: null,
  crashedAt: null,
};

function crashMultiplierText(value) {
  return `${Number(value || 1).toFixed(2)}x`;
}

function formatCrashTimer(seconds) {
  const safe = Math.max(0, Math.ceil(Number(seconds || 0)));
  const minutes = Math.floor(safe / 60);
  const secs = safe % 60;
  return `${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

function crashTimerLine(round) {
  const now = Date.now();

  if (round?.status === "BETTING") {
    const endsAt = crashRuntime.bettingEndsAt || (round.createdAt ? new Date(round.createdAt).getTime() + Math.max(3, CRASH_ROUND_INTERVAL_SECONDS) * 1000 : now);
    const left = Math.max(0, (endsAt - now) / 1000);
    return `⏳ До старта: **${formatCrashTimer(left)}**`;
  }

  if (round?.status === "RUNNING") {
    const startedAt = crashRuntime.runningStartedAt || (round.startedAt ? new Date(round.startedAt).getTime() : now);
    const elapsed = Math.max(0, (now - startedAt) / 1000);
    return `⏱️ Время раунда: **${formatCrashTimer(elapsed)}**`;
  }

  if (round?.status === "CRASHED") {
    if (crashRuntime.nextStartsAt) {
      const left = Math.max(0, (crashRuntime.nextStartsAt - now) / 1000);
      return `🔁 Следующий раунд через: **${formatCrashTimer(left)}**`;
    }
    return "🔁 Следующий раунд скоро.";
  }

  return "⏳ Подготовка раунда.";
}

function clampNumber(value, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return min;
  return Math.min(max, Math.max(min, number));
}

function normalizeCrashAutoCashout(value) {
  const multiplier = Number(String(value || "").replace(",", "."));
  const min = Math.max(1.01, Number(CRASH_AUTO_CASHOUT_MIN || 1.1));
  const max = Math.max(min, Number(CRASH_AUTO_CASHOUT_MAX || CRASH_MAX_MULTIPLIER || 25));
  if (!Number.isFinite(multiplier)) return null;
  if (multiplier < min || multiplier > max) return null;
  return Number(multiplier.toFixed(2));
}

function generateCrashPoint() {
  // CRASH с преимуществом казино: множитель генерируется заранее,
  // но распределение сделано так, чтобы на дистанции LS BET оставался в плюсе.
  const houseEdge = clampNumber(CRASH_HOUSE_EDGE_PERCENT, 1, 35) / 100;
  const instantChance = clampNumber(CRASH_INSTANT_CRASH_CHANCE, 0, 40) / 100;
  const maxMultiplier = clampNumber(CRASH_MAX_MULTIPLIER, 2, 100);

  const roll = Math.random();

  // Быстрые краши создают риск и не дают игрокам стабильно забирать 1.05x-1.20x.
  if (roll < instantChance) {
    return Number((1.01 + Math.random() * 0.14).toFixed(2));
  }

  // Inverse distribution: чем выше множитель, тем реже он выпадает.
  // (1 - houseEdge) уменьшает математическое ожидание в пользу казино.
  const r = Math.random();
  const raw = (1 - houseEdge) / Math.max(0.01, 1 - r);

  // Дополнительное сжатие хвоста: красивые иксы бывают, но редко.
  const shaped = 1 + Math.pow(Math.max(0, raw - 1), 0.82);
  return Number(Math.min(maxMultiplier, Math.max(1.01, shaped)).toFixed(2));
}

async function addCrashJackpotContribution(tx, userId, sourceId, baseAmount) {
  if (!JACKPOT_WAR_ENABLED || !Number.isFinite(CRASH_JACKPOT_PERCENT) || CRASH_JACKPOT_PERCENT <= 0) return null;
  const contribution = Math.max(1, Math.floor((Number(baseAmount || 0) * CRASH_JACKPOT_PERCENT) / 100));
  if (!Number.isInteger(contribution) || contribution <= 0) return null;

  const round = await getActiveJackpotWar(tx);
  await tx.jackpotContribution.create({
    data: {
      roundId: round.id,
      userId,
      amount: contribution,
      source: "CRASH_BET",
      sourceId: sourceId ? String(sourceId) : null,
    },
  });
  await tx.jackpotWar.update({ where: { id: round.id }, data: { currentPool: { increment: contribution } } });
  await tx.transaction.create({
    data: {
      userId,
      amount: 0,
      type: "JACKPOT_CONTRIBUTION",
      comment: `Jackpot War: ${money(contribution)} с CRASH${sourceId ? ` #${sourceId}` : ""}`,
    },
  });
  return { roundId: round.id, contribution, userId, source: "CRASH_BET", sourceId: sourceId ? String(sourceId) : null };
}

async function currentCrashRound() {
  if (crashRuntime.roundId) {
    const round = await prisma.crashRound.findUnique({ where: { id: crashRuntime.roundId }, include: { bets: { include: { user: true } } } });
    if (round) return round;
  }
  return prisma.crashRound.findFirst({ where: { status: { in: ["BETTING", "RUNNING"] } }, orderBy: { id: "desc" }, include: { bets: { include: { user: true } } } });
}

function crashEmbed(round) {
  const bets = round?.bets || [];
  const activeBets = bets.filter((bet) => bet.status === "ACTIVE");
  const cashedOut = bets.filter((bet) => bet.status === "CASHED_OUT");
  const bank = activeBets.reduce((sum, bet) => sum + bet.amount, 0) + cashedOut.reduce((sum, bet) => sum + bet.amount, 0);
  const statusText = round?.status === "BETTING" ? "🟢 Приём ставок" : round?.status === "RUNNING" ? "🚀 Полёт" : round?.status === "CRASHED" ? "💥 CRASH" : "⏳ Ожидание";
  const multiplier = round?.status === "RUNNING" ? crashRuntime.multiplier : round?.crashPoint || crashRuntime.multiplier || 1;
  const activeText = activeBets.length
    ? activeBets.slice(0, 10).map((bet) => `<@${bet.user.discordId}> — **${money(bet.amount)}**${bet.autoCashoutMultiplier ? ` • авто ${crashMultiplierText(bet.autoCashoutMultiplier)}` : ""}`).join("\n")
    : "Активных ставок пока нет.";
  const cashedText = cashedOut.length
    ? cashedOut.slice(0, 5).map((bet) => `<@${bet.user.discordId}> — ${crashMultiplierText(bet.cashoutMultiplier)} → **${money(bet.payout)}**`).join("\n")
    : "Пока никто не забрал.";

  return embed(round?.status === "CRASHED" ? LS_THEME.red : LS_THEME.green)
    .setTitle("🚀 LS BET — CRASH")
    .setDescription([
      "```",
      "CASH OUT BEFORE THE CRASH",
      "```",
      `Раунд: **#${round?.id || "—"}**`,
      `Статус: **${statusText}**`,
      crashTimerLine(round),
      `Множитель: **${crashMultiplierText(multiplier)}**`,
      `Банк раунда: **${money(bank)}**`,
      "",
      `Мин. ставка: **${money(CRASH_MIN_BET)}** • Макс. ставка: **${money(CRASH_MAX_BET)}**`,
      `В Jackpot War уходит: **${CRASH_JACKPOT_PERCENT}%** с каждой ставки`,
      `Интервал между раундами: **${CRASH_ROUND_INTERVAL_SECONDS} сек.**`,
      `Авто-кэшаут: **${CRASH_AUTO_CASHOUT_OPTIONS.map(crashMultiplierText).join(" • ")}**`,
      LS_TEXT.line,
      "🎫 **Активные ставки**",
      activeText,
      "",
      "💰 **Успели забрать**",
      cashedText,
    ].join("\n"));
}

function crashButtons(round) {
  const isBetting = round?.status === "BETTING";
  const isRunning = round?.status === "RUNNING";
  return [new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("crash_bet").setLabel("💵 Поставить").setStyle(ButtonStyle.Success).setDisabled(!isBetting),
    new ButtonBuilder().setCustomId("crash_cashout").setLabel("💰 Забрать").setStyle(ButtonStyle.Danger).setDisabled(!isRunning),
    new ButtonBuilder().setCustomId("crash_refresh").setLabel("🔄 Обновить").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId("crash_history").setLabel("📊 История").setStyle(ButtonStyle.Secondary)
  )];
}

async function sendOrUpdateCrashPanel(round) {
  const channel = await client.channels.fetch(CRASH_CHANNEL_ID).catch(() => null);
  if (!channel?.isTextBased()) return;
  const payload = { content: "🚀 **LS BET CRASH**", embeds: [crashEmbed(round)], components: crashButtons(round) };

  let message = null;
  const messageId = crashRuntime.messageId || round?.messageId;
  if (messageId) message = await channel.messages.fetch(messageId).catch(() => null);
  if (message) {
    await message.edit(payload).catch((error) => console.error("CRASH panel edit:", error.message));
    return message;
  }
  message = await channel.send(payload);
  crashRuntime.messageId = message.id;
  if (round?.id) await prisma.crashRound.update({ where: { id: round.id }, data: { messageId: message.id, channelId: CRASH_CHANNEL_ID } }).catch(() => null);
  return message;
}

function crashBetAutoCashoutSelector(roundId) {
  const buttons = CRASH_AUTO_CASHOUT_OPTIONS.map((multiplier) =>
    new ButtonBuilder()
      .setCustomId(`crash_bet_auto:${roundId}:${multiplier}`)
      .setLabel(`🟢 ${crashMultiplierText(multiplier)}`)
      .setStyle(ButtonStyle.Success)
  );
  const customButton = new ButtonBuilder()
    .setCustomId(`crash_bet_custom:${roundId}`)
    .setLabel("⚙️ Свой множитель")
    .setStyle(ButtonStyle.Secondary);

  const rows = [new ActionRowBuilder().addComponents(buttons.slice(0, 5))];
  rows.push(new ActionRowBuilder().addComponents(customButton));
  return rows;
}

function crashBetModal(autoCashoutMultiplier = null, custom = false, roundId = null) {
  const normalizedRoundId = Number(roundId);
  const customId = custom
    ? `crash_bet_custom_modal:${normalizedRoundId}`
    : `crash_bet_modal:${normalizedRoundId}:${autoCashoutMultiplier}`;
  const modal = new ModalBuilder().setCustomId(customId).setTitle("LS BET CRASH — ставка");
  const rows = [
    new ActionRowBuilder().addComponents(
      new TextInputBuilder().setCustomId("amount").setLabel(`Сумма ставки (${CRASH_MIN_BET}-${CRASH_MAX_BET})`).setPlaceholder("Например: 500").setRequired(true).setStyle(TextInputStyle.Short)
    )
  ];

  if (custom) {
    rows.push(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("autoCashout")
          .setLabel(`Авто-кэшаут x${CRASH_AUTO_CASHOUT_MIN}-${CRASH_AUTO_CASHOUT_MAX}`)
          .setPlaceholder("Например: 2.75")
          .setRequired(true)
          .setStyle(TextInputStyle.Short)
      )
    );
  }

  modal.addComponents(...rows);
  return modal;
}

async function showCrashPanel(interaction) {
  if (interaction.channelId !== CRASH_CHANNEL_ID) {
    return respondInteraction(interaction, { content: `🚀 CRASH доступен только в канале <#${CRASH_CHANNEL_ID}>.`, ephemeral: true });
  }
  const round = await currentCrashRound();
  return respondInteraction(interaction, { embeds: [crashEmbed(round)], components: crashButtons(round), ephemeral: true });
}

async function handleCrashBet(interaction) {
  if (interaction.channelId !== CRASH_CHANNEL_ID) {
    return respondInteraction(interaction, { content: `🚀 CRASH доступен только в канале <#${CRASH_CHANNEL_ID}>.`, ephemeral: true });
  }
  const round = await currentCrashRound();
  if (!round || round.status !== "BETTING") {
    return respondInteraction(interaction, { content: "Сейчас ставки не принимаются. Дождись следующего раунда.", ephemeral: true });
  }
  return respondInteraction(interaction, {
    content: [
      "🚀 **CRASH — выбери авто-кэшаут**",
      "",
      "Бот сам заберёт выигрыш, когда множитель дойдёт до выбранного значения.",
      "После выбора откроется форма суммы ставки."
    ].join("\n"),
    components: crashBetAutoCashoutSelector(round.id),
    ephemeral: true,
  });
}

async function handleCrashAutoCashoutButton(interaction, autoCashoutRaw, roundIdRaw) {
  if (interaction.channelId !== CRASH_CHANNEL_ID) {
    return respondInteraction(interaction, { content: `🚀 CRASH доступен только в канале <#${CRASH_CHANNEL_ID}>.`, ephemeral: true });
  }

  const roundId = Number(roundIdRaw);
  const autoCashoutMultiplier = normalizeCrashAutoCashout(autoCashoutRaw);
  if (!Number.isInteger(roundId) || !autoCashoutMultiplier) {
    return respondInteraction(interaction, { content: "Некорректный или устаревший выбор CRASH.", ephemeral: true });
  }

  // Показываем форму сразу, без запроса к БД. Актуальность раунда проверяется при отправке формы.
  return interaction.showModal(crashBetModal(autoCashoutMultiplier, false, roundId));
}

async function handleCrashCustomAutoCashoutButton(interaction, roundIdRaw) {
  if (interaction.channelId !== CRASH_CHANNEL_ID) {
    return respondInteraction(interaction, { content: `🚀 CRASH доступен только в канале <#${CRASH_CHANNEL_ID}>.`, ephemeral: true });
  }

  const roundId = Number(roundIdRaw);
  if (!Number.isInteger(roundId)) {
    return respondInteraction(interaction, { content: "Некорректный или устаревший выбор CRASH.", ephemeral: true });
  }

  return interaction.showModal(crashBetModal(null, true, roundId));
}

async function applyCrashBet(interaction) {
  if (interaction.channelId !== CRASH_CHANNEL_ID) {
    return respondInteraction(interaction, { content: `🚀 CRASH доступен только в канале <#${CRASH_CHANNEL_ID}>.`, ephemeral: true });
  }
  const amount = Number(interaction.fields.getTextInputValue("amount"));
  let autoCashoutMultiplier = null;
  let selectedRoundId = null;

  if (interaction.customId.startsWith("crash_bet_custom_modal:")) {
    selectedRoundId = Number(interaction.customId.split(":")[1]);
    autoCashoutMultiplier = normalizeCrashAutoCashout(interaction.fields.getTextInputValue("autoCashout"));
  } else if (interaction.customId.startsWith("crash_bet_modal:")) {
    const [, roundIdRaw, autoCashoutRaw] = interaction.customId.split(":");
    selectedRoundId = Number(roundIdRaw);
    autoCashoutMultiplier = normalizeCrashAutoCashout(autoCashoutRaw);
  }
  if (!autoCashoutMultiplier) {
    return respondInteraction(interaction, { content: `Укажи авто-кэшаут от **${crashMultiplierText(CRASH_AUTO_CASHOUT_MIN)}** до **${crashMultiplierText(CRASH_AUTO_CASHOUT_MAX)}**.`, ephemeral: true });
  }
  if (!Number.isInteger(amount) || amount < CRASH_MIN_BET || amount > CRASH_MAX_BET) {
    return respondInteraction(interaction, { content: `Укажи сумму от **${money(CRASH_MIN_BET)}** до **${money(CRASH_MAX_BET)}**.`, ephemeral: true });
  }
  const user = await userOf(interaction.user);
  if (user.balance < amount) {
    return respondInteraction(interaction, { content: `Недостаточно средств. Баланс: **${money(user.balance)}**.`, ephemeral: true });
  }
  const round = await currentCrashRound();
  if (!round || round.status !== "BETTING" || round.id !== selectedRoundId) {
    return respondInteraction(interaction, { content: "Раунд уже стартовал или выбор устарел. Дождись следующего.", ephemeral: true });
  }
  const existing = await prisma.crashBet.findFirst({ where: { roundId: round.id, userId: user.id, status: "ACTIVE" } });
  if (existing) {
    return respondInteraction(interaction, { content: "У тебя уже есть активная ставка в этом раунде.", ephemeral: true });
  }

  let jackpotInfo = null;
  await prisma.$transaction(async (tx) => {
    const freshRound = await tx.crashRound.findFirst({ where: { id: round.id, status: "BETTING" } });
    if (!freshRound) { const error = new Error("CRASH_ROUND_STARTED"); error.code = "CRASH_ROUND_STARTED"; throw error; }
    await decrementBalanceOrThrow(tx, user.id, amount);
    const bet = await tx.crashBet.create({ data: { roundId: round.id, userId: user.id, amount, status: "ACTIVE", autoCashoutMultiplier } });
    jackpotInfo = await addCrashJackpotContribution(tx, user.id, bet.id, amount);
    await tx.transaction.create({ data: { userId: user.id, amount: -amount, type: "CRASH_BET", comment: `Ставка CRASH #${round.id}. Авто-кэшаут: ${crashMultiplierText(autoCashoutMultiplier)}` } });
  });

  await log("CRASH_BET", "🚀 CRASH — ставка принята", `Игрок <@${interaction.user.id}> поставил **${money(amount)}** в CRASH раунд #${round.id}. Авто-кэшаут: **${crashMultiplierText(autoCashoutMultiplier)}**.`, [
    { name: "Игрок", value: `<@${interaction.user.id}>`, inline: true },
    { name: "Раунд", value: `#${round.id}`, inline: true },
    { name: "Ставка", value: money(amount), inline: true },
    { name: "Авто-кэшаут", value: crashMultiplierText(autoCashoutMultiplier), inline: true },
    { name: "Jackpot War", value: jackpotInfo?.contribution ? money(jackpotInfo.contribution) : "—", inline: true },
  ], { userId: user.id, channelId: interaction.channelId });

  const updatedRound = await currentCrashRound();
  await sendOrUpdateCrashPanel(updatedRound);
  await sendJackpotWarLiveNotification(jackpotInfo);
  return respondInteraction(interaction, { content: `✅ Ставка CRASH принята: **${money(amount)}**. Авто-кэшаут: **${crashMultiplierText(autoCashoutMultiplier)}**.`, ephemeral: true });
}

async function handleCrashCashout(interaction) {
  if (interaction.channelId !== CRASH_CHANNEL_ID) {
    return respondInteraction(interaction, { content: `🚀 CRASH доступен только в канале <#${CRASH_CHANNEL_ID}>.`, ephemeral: true });
  }
  const round = await currentCrashRound();
  if (!round || round.status !== "RUNNING") {
    return respondInteraction(interaction, { content: "Сейчас нельзя забрать выигрыш.", ephemeral: true });
  }
  const user = await userOf(interaction.user);
  const bet = await prisma.crashBet.findFirst({ where: { roundId: round.id, userId: user.id, status: "ACTIVE" } });
  if (!bet) {
    return respondInteraction(interaction, { content: "У тебя нет активной ставки в текущем раунде.", ephemeral: true });
  }

  const multiplier = Math.max(1, Number(crashRuntime.multiplier || 1));
  const payout = Math.floor(bet.amount * multiplier);
  await prisma.$transaction(async (tx) => {
    const lock = await tx.crashBet.updateMany({ where: { id: bet.id, status: "ACTIVE" }, data: { status: "CASHED_OUT", cashoutMultiplier: multiplier, payout, cashedOutAt: new Date() } });
    if (lock.count !== 1) return;
    await tx.user.update({ where: { id: user.id }, data: { balance: { increment: payout } } });
    await tx.transaction.create({ data: { userId: user.id, amount: payout, type: "CRASH_CASHOUT", comment: `CRASH #${round.id}: вывод на ${crashMultiplierText(multiplier)}` } });
  });

  await log("CRASH_CASHOUT", "💰 CRASH — игрок забрал выигрыш", `Игрок <@${interaction.user.id}> забрал **${money(payout)}** с ставки **${money(bet.amount)}** в CRASH раунде #${round.id}.`, [
    { name: "Игрок", value: `<@${interaction.user.id}>`, inline: true },
    { name: "Раунд", value: `#${round.id}`, inline: true },
    { name: "Ставка", value: money(bet.amount), inline: true },
    { name: "Множитель", value: crashMultiplierText(multiplier), inline: true },
    { name: "Авто-кэшаут", value: bet.autoCashoutMultiplier ? crashMultiplierText(bet.autoCashoutMultiplier) : "Ручной", inline: true },
    { name: "Выплата", value: money(payout), inline: true },
    { name: "Чистый результат", value: money(payout - bet.amount), inline: true },
  ], { userId: user.id, channelId: interaction.channelId });

  const updatedRound = await currentCrashRound();
  await sendOrUpdateCrashPanel(updatedRound);
  return respondInteraction(interaction, { content: `💰 Забрал на **${crashMultiplierText(multiplier)}**. Выплата: **${money(payout)}**.`, ephemeral: true });
}

async function processCrashAutoCashouts(roundId, multiplier) {
  const activeAutoBets = await prisma.crashBet.findMany({
    where: {
      roundId,
      status: "ACTIVE",
      autoCashoutMultiplier: { lte: multiplier },
    },
    include: { user: true },
  });

  for (const bet of activeAutoBets) {
    const cashoutMultiplier = Number(bet.autoCashoutMultiplier || multiplier);
    const payout = Math.floor(bet.amount * cashoutMultiplier);
    let paid = false;

    await prisma.$transaction(async (tx) => {
      const lock = await tx.crashBet.updateMany({
        where: { id: bet.id, status: "ACTIVE" },
        data: { status: "CASHED_OUT", cashoutMultiplier, payout, cashedOutAt: new Date() },
      });
      if (lock.count !== 1) return;
      paid = true;
      await tx.user.update({ where: { id: bet.userId }, data: { balance: { increment: payout } } });
      await tx.transaction.create({
        data: {
          userId: bet.userId,
          amount: payout,
          type: "CRASH_CASHOUT",
          comment: `CRASH #${roundId}: авто-вывод на ${crashMultiplierText(cashoutMultiplier)}. Ставка ${money(bet.amount)}, выплата ${money(payout)}`,
        },
      });
    });

    if (paid) {
      await log("CRASH_CASHOUT", "🤖 CRASH — авто-кэшаут", `Игрок <@${bet.user.discordId}> автоматически забрал **${money(payout)}** с ставки **${money(bet.amount)}** в CRASH раунде #${roundId}.`, [
        { name: "Игрок", value: `<@${bet.user.discordId}>`, inline: true },
        { name: "Раунд", value: `#${roundId}`, inline: true },
        { name: "Ставка", value: money(bet.amount), inline: true },
        { name: "Авто-кэшаут", value: crashMultiplierText(cashoutMultiplier), inline: true },
        { name: "Выплата", value: money(payout), inline: true },
        { name: "Чистый результат", value: money(payout - bet.amount), inline: true },
      ], { userId: bet.userId, channelId: CRASH_CHANNEL_ID });
    }
  }
}

async function showCrashHistory(interaction) {
  const rounds = await prisma.crashRound.findMany({ where: { status: "CRASHED" }, orderBy: { id: "desc" }, take: 10 });
  const text = rounds.length ? rounds.map((round) => `#${round.id} — 💥 **${crashMultiplierText(round.crashPoint)}**`).join("\n") : "Истории пока нет.";
  return respondInteraction(interaction, { embeds: [embed(LS_THEME.gold).setTitle("📊 CRASH — история раундов").setDescription(text)], ephemeral: true });
}

async function cancelCrashRoundAndRefund(roundId, reason) {
  return prisma.$transaction(async (tx) => {
    const lock = await tx.crashRound.updateMany({
      where: { id: roundId, status: { in: ["BETTING", "RUNNING"] } },
      data: { status: "CANCELLED", endedAt: new Date() },
    });

    if (lock.count !== 1) {
      return { cancelled: false, refundedBets: 0, refundedAmount: 0 };
    }

    const activeBets = await tx.crashBet.findMany({
      where: { roundId, status: "ACTIVE" },
    });

    let refundedBets = 0;
    let refundedAmount = 0;

    for (const bet of activeBets) {
      const betLock = await tx.crashBet.updateMany({
        where: { id: bet.id, status: "ACTIVE" },
        data: { status: "REFUNDED", payout: bet.amount, cashedOutAt: new Date() },
      });

      if (betLock.count !== 1) continue;

      await tx.user.update({
        where: { id: bet.userId },
        data: { balance: { increment: bet.amount } },
      });

      await tx.transaction.create({
        data: {
          userId: bet.userId,
          amount: bet.amount,
          type: "CRASH_REFUND",
          comment: `Возврат ставки CRASH #${roundId}: ${reason}`,
        },
      });

      refundedBets += 1;
      refundedAmount += bet.amount;
    }

    return { cancelled: true, refundedBets, refundedAmount };
  });
}

async function recoverStaleCrashRounds() {
  const staleRounds = await prisma.crashRound.findMany({
    where: { status: { in: ["BETTING", "RUNNING"] } },
    orderBy: { id: "asc" },
  });

  if (!staleRounds.length) return;

  let cancelledRounds = 0;
  let refundedBets = 0;
  let refundedAmount = 0;

  for (const round of staleRounds) {
    const result = await cancelCrashRoundAndRefund(round.id, "восстановление после перезапуска бота");
    if (!result.cancelled) continue;
    cancelledRounds += 1;
    refundedBets += result.refundedBets;
    refundedAmount += result.refundedAmount;
  }

  crashRuntime.roundId = null;
  crashRuntime.status = "IDLE";
  crashRuntime.multiplier = 1;
  crashRuntime.bettingEndsAt = null;
  crashRuntime.runningStartedAt = null;
  crashRuntime.crashedAt = null;
  crashRuntime.nextStartsAt = null;

  console.warn(
    `⚠️ Восстановление CRASH: отменено раундов ${cancelledRounds}, возвращено ставок ${refundedBets} на ${money(refundedAmount)}.`
  );
}

async function startCrashGameLoop() {
  if (crashRuntime.active) return;
  crashRuntime.active = true;

  while (true) {
    let activeRoundId = null;
    try {
      let round = await prisma.crashRound.create({ data: { status: "BETTING", crashPoint: generateCrashPoint(), channelId: CRASH_CHANNEL_ID } });
      activeRoundId = round.id;
      crashRuntime.roundId = round.id;
      crashRuntime.status = "BETTING";
      crashRuntime.multiplier = 1;
      crashRuntime.runningStartedAt = null;
      crashRuntime.crashedAt = null;
      crashRuntime.nextStartsAt = null;
      crashRuntime.bettingEndsAt = Date.now() + Math.max(3, CRASH_ROUND_INTERVAL_SECONDS) * 1000;
      round = await prisma.crashRound.findUnique({ where: { id: round.id }, include: { bets: { include: { user: true } } } });
      await sendOrUpdateCrashPanel(round);

      while (Date.now() < crashRuntime.bettingEndsAt) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
        const bettingRound = await prisma.crashRound.findUnique({ where: { id: round.id }, include: { bets: { include: { user: true } } } });
        if (!bettingRound || bettingRound.status !== "BETTING") break;
        await sendOrUpdateCrashPanel(bettingRound);
      }

      await prisma.crashRound.update({ where: { id: round.id }, data: { status: "RUNNING", startedAt: new Date() } });
      crashRuntime.status = "RUNNING";
      crashRuntime.multiplier = 1;
      crashRuntime.runningStartedAt = Date.now();
      crashRuntime.bettingEndsAt = null;

      const crashPoint = round.crashPoint || 2;
      while (crashRuntime.multiplier < crashPoint) {
        const nextMultiplier = Number(
          (crashRuntime.multiplier + Math.max(0.03, crashRuntime.multiplier * 0.08)).toFixed(2)
        );

        // Не даём авто-кэшауту сработать выше фактической точки краша.
        if (nextMultiplier >= crashPoint) break;

        crashRuntime.multiplier = nextMultiplier;
        await processCrashAutoCashouts(round.id, crashRuntime.multiplier);
        const runningRound = await prisma.crashRound.findUnique({ where: { id: round.id }, include: { bets: { include: { user: true } } } });
        await sendOrUpdateCrashPanel(runningRound);
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }

      await prisma.$transaction(async (tx) => {
        await tx.crashRound.update({ where: { id: round.id }, data: { status: "CRASHED", endedAt: new Date() } });
        await tx.crashBet.updateMany({ where: { roundId: round.id, status: "ACTIVE" }, data: { status: "LOST" } });
      });

      const finishedRound = await prisma.crashRound.findUnique({ where: { id: round.id }, include: { bets: { include: { user: true } } } });

      const lostBets = (finishedRound?.bets || []).filter((bet) => bet.status === "LOST");
      for (const bet of lostBets) {
        await log("CRASH_LOST", "💥 CRASH — ставка проиграла", `Игрок <@${bet.user.discordId}> поставил **${money(bet.amount)}** и получил **${money(0)}** в CRASH раунде #${round.id}.`, [
          { name: "Игрок", value: `<@${bet.user.discordId}>`, inline: true },
          { name: "Раунд", value: `#${round.id}`, inline: true },
          { name: "Ставка", value: money(bet.amount), inline: true },
          { name: "Краш", value: crashMultiplierText(crashPoint), inline: true },
          { name: "Авто-кэшаут", value: bet.autoCashoutMultiplier ? crashMultiplierText(bet.autoCashoutMultiplier) : "—", inline: true },
          { name: "Получил", value: money(0), inline: true },
        ], { userId: bet.userId, channelId: CRASH_CHANNEL_ID });
      }

      crashRuntime.status = "CRASHED";
      crashRuntime.multiplier = crashPoint;
      crashRuntime.crashedAt = Date.now();
      crashRuntime.runningStartedAt = null;
      crashRuntime.nextStartsAt = Date.now() + 5000;
      await sendOrUpdateCrashPanel(finishedRound);
      const cashoutBets = (finishedRound?.bets || []).filter((bet) => bet.status === "CASHED_OUT");
      const crashSummary = (finishedRound?.bets || []).length
        ? (finishedRound.bets || []).slice(0, 20).map((bet) => {
            const got = bet.status === "CASHED_OUT" ? money(bet.payout || 0) : money(0);
            const auto = bet.autoCashoutMultiplier ? `, авто ${crashMultiplierText(bet.autoCashoutMultiplier)}` : "";
            return `<@${bet.user.discordId}> — ставка ${money(bet.amount)}${auto}, получил ${got}`;
          }).join("\n")
        : "Ставок в раунде не было.";
      await log("CRASH_ROUND", "💥 CRASH раунд завершён", `Раунд #${round.id} упал на ${crashMultiplierText(crashPoint)}.`, [
        { name: "Раунд", value: `#${round.id}`, inline: true },
        { name: "Краш", value: crashMultiplierText(crashPoint), inline: true },
        { name: "Ставок", value: String((finishedRound?.bets || []).length), inline: true },
        { name: "Забрали", value: String(cashoutBets.length), inline: true },
        { name: "Проиграли", value: String(lostBets.length), inline: true },
        { name: "Итоги", value: crashSummary.slice(0, 1024), inline: false },
      ], { channelId: CRASH_CHANNEL_ID });
      await maybeFinishJackpotWar();
      while (Date.now() < crashRuntime.nextStartsAt) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
        await sendOrUpdateCrashPanel(finishedRound);
      }
      crashRuntime.nextStartsAt = null;
      activeRoundId = null;
    } catch (error) {
      console.error("CRASH LOOP ERROR:", error.message);

      if (activeRoundId) {
        try {
          const recovery = await cancelCrashRoundAndRefund(activeRoundId, "внутренняя ошибка игрового цикла");
          if (recovery.cancelled) {
            console.warn(
              `⚠️ CRASH #${activeRoundId} отменён: возвращено ставок ${recovery.refundedBets} на ${money(recovery.refundedAmount)}.`
            );
          }
        } catch (recoveryError) {
          console.error("CRASH RECOVERY ERROR:", recoveryError);
        }
      }

      crashRuntime.roundId = null;
      crashRuntime.status = "IDLE";
      crashRuntime.multiplier = 1;
      crashRuntime.bettingEndsAt = null;
      crashRuntime.runningStartedAt = null;
      crashRuntime.crashedAt = null;
      crashRuntime.nextStartsAt = null;

      await new Promise((resolve) => setTimeout(resolve, 10000));
    }
  }
}

async function showProfile(interaction) {
  const user = await userOf(interaction.user);

  const [totalBets, activeBets, wonBets, lostBets, coinflipWins, referralsCount, referralEarned, lotteryTickets] =
    await Promise.all([
      prisma.bet.count({ where: { userId: user.id } }),
      prisma.bet.count({ where: { userId: user.id, status: "ACTIVE" } }),
      prisma.bet.count({ where: { userId: user.id, status: "WON" } }),
      prisma.bet.count({ where: { userId: user.id, status: "LOST" } }),
      prisma.coinflipGame.count({ where: { winnerUserId: user.id } }),
      prisma.user.count({ where: { referredByUserId: user.id } }),
      prisma.referralReward.aggregate({ where: { referrerId: user.id }, _sum: { amount: true } }),
      prisma.lotteryTicket.count({ where: { userId: user.id } }),
    ]);

  const winPercent = wonBets + lostBets > 0 ? ((wonBets / (wonBets + lostBets)) * 100).toFixed(1) : "0.0";

  const e = embed(LS_THEME.green)
    .setTitle("👤 LS Bet — Профиль игрока")
    .setThumbnail(interaction.user.displayAvatarURL())
    .setDescription(["```", "PLAYER PROFILE", "```", `Игрок: <@${interaction.user.id}>`, LS_TEXT.line].join("\n"))
    .addFields(
      { name: "Баланс", value: money(user.balance), inline: true },
      { name: "Регистрация", value: registrationStatusName(user.registrationStatus), inline: true },
      { name: "Всего ставок", value: String(totalBets), inline: true },
      { name: "Активные ставки", value: String(activeBets), inline: true },
      { name: "Выиграно ставок", value: String(wonBets), inline: true },
      { name: "Процент побед", value: `${winPercent}%`, inline: true },
      { name: "Coinflip побед", value: String(coinflipWins), inline: true },
      { name: "Билетов лотереи", value: String(lotteryTickets), inline: true },
      { name: "Рефералов", value: String(referralsCount), inline: true },
      { name: "С рефералов", value: money(referralEarned._sum.amount || 0), inline: true }
    );

  return respondInteraction(interaction, { embeds: [e], ephemeral: true });
}

async function showHistory(interaction) {
  const user = await userOf(interaction.user);

  const transactions = await prisma.transaction.findMany({
    where: { userId: user.id },
    orderBy: { id: "desc" },
    take: 10,
  });

  const text = transactions.length
    ? transactions
        .map((t) => {
          const sign = t.amount > 0 ? "+" : "";
          return `**#${t.id} — ${txName(t.type)}**\nСумма: ${sign}${money(t.amount)}\nКомментарий: ${
            t.comment || "Без комментария"
          }\nДата: <t:${unix(t.createdAt)}:R>`;
        })
        .join("\n\n")
    : "Операций пока нет.";

  return respondInteraction(interaction, {
    embeds: [embed(LS_THEME.green).setTitle("📜 История операций").setDescription(text.slice(0, 4000))],
    ephemeral: true,
  });
}

async function showTop(interaction) {
  const users = await prisma.user.findMany({ orderBy: { balance: "desc" }, take: 10 });

  if (!users.length) {
    return respondInteraction(interaction, { content: "Рейтинг пока пуст.", ephemeral: true });
  }

  const medals = ["🥇", "🥈", "🥉"];
  const text = users
    .map((u, i) => `${medals[i] || `#${i + 1}`} <@${u.discordId}> — **${money(u.balance)}**`)
    .join("\n");

  return respondInteraction(interaction, {
    embeds: [embed(LS_THEME.gold).setTitle("🏆 LS Bet Top").setDescription(["```", "LEADERBOARD", "```", text].join("\n"))],
    ephemeral: true,
  });
}

async function showMyBets(interaction) {
  const user = await userOf(interaction.user);

  const bets = await prisma.bet.findMany({
    where: { userId: user.id },
    orderBy: { id: "desc" },
    take: 10,
    include: { event: true, option: true },
  });

  if (!bets.length) {
    return respondInteraction(interaction, { content: "У тебя пока нет ставок.", ephemeral: true });
  }

  const text = bets
    .map((b) => {
      const status = b.status === "ACTIVE" ? "🟢 Активна" : b.status === "WON" ? "✅ Выиграла" : "❌ Проиграла";
      return `**#${b.id} — ${b.event.title}**\nИсход: ${b.option.title}\nСумма: ${money(
        b.amount
      )}\nВозможный выигрыш: ${money(b.potentialWin)}\nСтатус: ${status}`;
    })
    .join("\n\n");

  return respondInteraction(interaction, {
    embeds: [embed(LS_THEME.green).setTitle("🧾 Мои ставки").setDescription(text.slice(0, 4000))],
    ephemeral: true,
  });
}

async function showEvents(interaction) {
  await closeExpiredEvents();
  await userOf(interaction.user);

  const events = await prisma.rpEvent.findMany({
    where: { status: { in: ["OPEN", "LIVE"] } },
    orderBy: { id: "desc" },
    take: 3,
    include: { options: { orderBy: { id: "asc" }, include: { bets: true } } },
  });

  if (!events.length) {
    return respondInteraction(interaction, { content: "Сейчас нет активных событий LS Bet.", ephemeral: true });
  }

  const embeds = [];
  const components = [];

  for (const event of events) {
    embeds.push(eventEmbeds(event)[0]);
    components.push(eventButtons(event)[0]);
  }

  return respondInteraction(interaction, { embeds, components, ephemeral: true });
}

function topupModal() {
  const modal = new ModalBuilder().setCustomId("topup_modal").setTitle("LS Bet — пополнение");

  modal.addComponents(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder().setCustomId("login").setLabel("Логин / ник").setRequired(true).setStyle(TextInputStyle.Short)
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder().setCustomId("amount").setLabel("Сумма пополнения в $").setRequired(true).setStyle(TextInputStyle.Short)
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder().setCustomId("comment").setLabel("Комментарий").setRequired(false).setStyle(TextInputStyle.Paragraph)
    )
  );

  return modal;
}

function withdrawModal() {
  const modal = new ModalBuilder().setCustomId("withdraw_modal").setTitle("LS Bet — вывод средств");

  modal.addComponents(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder().setCustomId("login").setLabel("Логин / ник").setRequired(true).setStyle(TextInputStyle.Short)
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder().setCustomId("amount").setLabel("Сумма вывода в $").setRequired(true).setStyle(TextInputStyle.Short)
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder().setCustomId("details").setLabel("Реквизиты / способ получения").setRequired(true).setStyle(TextInputStyle.Paragraph)
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder().setCustomId("comment").setLabel("Комментарий").setRequired(false).setStyle(TextInputStyle.Paragraph)
    )
  );

  return modal;
}

function closeTicketRow(id) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`ticket_close:${id}`).setLabel("🔒 Закрыть тикет").setStyle(ButtonStyle.Secondary)
  );
}

function closeWithdrawTicketRow(id) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`withdraw_ticket_close:${id}`).setLabel("🔒 Закрыть тикет").setStyle(ButtonStyle.Secondary)
  );
}

async function createTicketChannel(interaction, prefix, requestId) {
  const guild = interaction.guild;
  const modRoleId = process.env.MOD_ROLE_ID || process.env.ADMIN_ROLE_ID || null;

  const permissionOverwrites = [
    { id: guild.id, deny: [PermissionFlagsBits.ViewChannel] },
    {
      id: interaction.user.id,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.AttachFiles,
      ],
    },
    {
      id: client.user.id,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.AttachFiles,
        PermissionFlagsBits.ManageChannels,
      ],
    },
  ];

  if (modRoleId) {
    permissionOverwrites.push({
      id: modRoleId,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.AttachFiles,
        PermissionFlagsBits.ManageChannels,
      ],
    });
  }

  const safeName = interaction.user.username.toLowerCase().replace(/[^a-z0-9а-яё-]/gi, "-").slice(0, 40);

  const options = {
    name: `${prefix}-${requestId}-${safeName}`,
    type: ChannelType.GuildText,
    permissionOverwrites,
  };

  if (prefix === "registration" && REGISTRATION_CATEGORY_ID) {
    options.parent = REGISTRATION_CATEGORY_ID;
  } else if (prefix === "withdraw" && process.env.WITHDRAW_CATEGORY_ID) {
    options.parent = process.env.WITHDRAW_CATEGORY_ID;
  } else if (process.env.TOPUP_CATEGORY_ID) {
    options.parent = process.env.TOPUP_CATEGORY_ID;
  }

  return guild.channels.create(options);
}

async function createTopUpTicket(interaction, login, amount, comment) {
  const user = await userOf(interaction.user);

  const request = await prisma.topUpRequest.create({
    data: {
      userId: user.id,
      login,
      amount,
      comment: comment || null,
      status: "WAITING_SCREENSHOT",
    },
  });

  let channel;
  try {
    channel = await createTicketChannel(interaction, "topup", request.id);

    await prisma.topUpRequest.update({
      where: { id: request.id },
      data: { ticketChannelId: channel.id },
    });
  } catch (error) {
    console.error("TOPUP TICKET CREATE ERROR:", error);
    await prisma.topUpRequest.update({
      where: { id: request.id },
      data: { status: "CANCELLED", processedAt: new Date() },
    });

    return respondInteraction(interaction, {
      content: "❌ Не удалось создать тикет пополнения. Попробуй ещё раз или сообщи администратору.",
      ephemeral: true,
    });
  }

  const e = embed(LS_THEME.green)
    .setTitle(`💰 Заявка на пополнение #${request.id}`)
    .setDescription(`<@${interaction.user.id}>, заявка создана.\n\n**Отправь в этот канал скриншот перевода.**`)
    .addFields(
      { name: "Логин", value: login, inline: true },
      { name: "Сумма", value: money(amount), inline: true },
      { name: "Комментарий", value: comment || "Не указан", inline: false }
    );

  await channel.send({ content: `<@${interaction.user.id}>`, embeds: [e] });

  await log("TOPUP_CREATED", "💰 Создана заявка на пополнение", `Игрок <@${interaction.user.id}> создал заявку #${request.id}.`, [
    { name: "Сумма", value: money(amount), inline: true },
    { name: "Ticket", value: `<#${channel.id}>`, inline: true },
  ]);

  return respondInteraction(interaction, {
    content: `✅ Заявка создана: <#${channel.id}>. Загрузи туда скриншот перевода.`,
    ephemeral: true,
  });
}

async function createWithdrawTicket(interaction, login, amount, details, comment) {
  const user = await userOf(interaction.user);

  if (!Number.isInteger(amount) || amount <= 0) {
    return respondInteraction(interaction, { content: "Введи корректную сумму вывода.", ephemeral: true });
  }

  if (user.balance < amount) {
    await log("WITHDRAW_FAILED", "⚠️ Неудачная заявка на вывод", `Игрок <@${interaction.user.id}> попытался вывести больше баланса.`, [
      { name: "Запрошено", value: money(amount), inline: true },
      { name: "Баланс", value: money(user.balance), inline: true },
    ], { userId: user.id, channelId: interaction.channelId });

    return respondInteraction(interaction, { content: `Недостаточно средств. Баланс: **${money(user.balance)}**.`, ephemeral: true });
  }

  const commission = Math.floor((amount * WITHDRAW_COMMISSION_PERCENT) / 100);
  const payoutAmount = amount - commission;

  let request;
  try {
    request = await prisma.$transaction(async (tx) => {
      await decrementBalanceOrThrow(tx, user.id, amount);

      const created = await tx.withdrawRequest.create({
        data: {
          userId: user.id,
          login,
          amount,
          commission,
          payoutAmount,
          details,
          comment: comment || null,
          status: "PENDING",
        },
      });

      await tx.transaction.create({
        data: {
          userId: user.id,
          amount: -amount,
          type: "WITHDRAW_REQUEST",
          comment: `Заявка на вывод #${created.id}. Комиссия ${WITHDRAW_COMMISSION_PERCENT}%: ${money(commission)}. К получению: ${money(payoutAmount)}`,
        },
      });

      return created;
    });
  } catch (error) {
    if (isInsufficientBalance(error)) {
      const freshUser = await prisma.user.findUnique({ where: { id: user.id } });
      return respondInteraction(interaction, {
        content: `Недостаточно средств. Баланс: **${money(freshUser?.balance || 0)}**.`,
        ephemeral: true,
      });
    }
    throw error;
  }

  let channel;
  try {
    channel = await createTicketChannel(interaction, "withdraw", request.id);

    await prisma.withdrawRequest.update({
      where: { id: request.id },
      data: { ticketChannelId: channel.id },
    });
  } catch (error) {
    console.error("WITHDRAW TICKET CREATE ERROR:", error);

    await prisma.$transaction(async (tx) => {
      const lock = await tx.withdrawRequest.updateMany({
        where: { id: request.id, status: "PENDING", ticketChannelId: null },
        data: { status: "CANCELLED", processedAt: new Date() },
      });

      if (lock.count !== 1) return;

      await tx.user.update({
        where: { id: user.id },
        data: { balance: { increment: amount } },
      });

      await tx.transaction.create({
        data: {
          userId: user.id,
          amount,
          type: "WITHDRAW_REFUND",
          comment: `Возврат по заявке #${request.id}: не удалось создать тикет`,
        },
      });
    });

    return respondInteraction(interaction, {
      content: "❌ Не удалось создать тикет вывода. Списанная сумма автоматически возвращена на баланс.",
      ephemeral: true,
    });
  }

  const e = embed(LS_THEME.red)
    .setTitle(`💸 Заявка на вывод #${request.id}`)
    .setDescription(
      [
        `<@${interaction.user.id}>, заявка создана.`,
        "",
        `**Сумма:** ${money(amount)}`,
        `**Комиссия:** ${money(commission)}`,
        `**К получению:** ${money(payoutAmount)}`,
        "",
        "Сумма списана с баланса до решения администрации.",
      ].join("\n")
    )
    .addFields(
      { name: "Логин", value: login, inline: true },
      { name: "Реквизиты", value: details, inline: false },
      { name: "Комментарий", value: comment || "Не указан", inline: false }
    );

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`withdraw_approve:${request.id}`).setLabel("✅ Одобрить").setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`withdraw_reject:${request.id}`).setLabel("❌ Отклонить").setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId(`withdraw_ticket_close:${request.id}`).setLabel("🔒 Закрыть").setStyle(ButtonStyle.Secondary)
  );

  await channel.send({ content: `<@${interaction.user.id}>`, embeds: [e], components: [row] });

  await log("WITHDRAW_CREATED", "💸 Создана заявка на вывод", `Игрок <@${interaction.user.id}> создал заявку #${request.id}.`, [
    { name: "Сумма", value: money(amount), inline: true },
    { name: "К получению", value: money(payoutAmount), inline: true },
    { name: "Ticket", value: `<#${channel.id}>`, inline: true },
  ]);

  return respondInteraction(interaction, {
    content: `✅ Заявка на вывод создана: <#${channel.id}>.\nК получению: **${money(payoutAmount)}**`,
    ephemeral: true,
  });
}
async function sendTopUpModerationLog(requestId) {
  const request = await prisma.topUpRequest.findUnique({
    where: {
      id: requestId,
    },
    include: {
      user: true,
    },
  });

  if (!request) return;

  const logChannelId = process.env.LOG_CHANNEL_ID;
  if (!logChannelId) return;

  const channel = await client.channels.fetch(logChannelId).catch(() => null);
  if (!channel?.isTextBased()) return;

  const e = embed(LS_THEME.gold)
    .setTitle(`💰 Заявка на пополнение #${request.id}`)
    .setDescription("Игрок загрузил скриншот перевода. Требуется проверка.")
    .addFields(
      {
        name: "Игрок",
        value: `<@${request.user.discordId}>`,
        inline: true,
      },
      {
        name: "Логин",
        value: request.login,
        inline: true,
      },
      {
        name: "Сумма",
        value: money(request.amount),
        inline: true,
      },
      {
        name: "Ticket",
        value: request.ticketChannelId
          ? `<#${request.ticketChannelId}>`
          : "Не найден",
        inline: true,
      }
    );

  if (request.screenshotUrl) e.setImage(request.screenshotUrl);

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`topup_approve:${request.id}`)
      .setLabel("✅ Одобрить")
      .setStyle(ButtonStyle.Success),

    new ButtonBuilder()
      .setCustomId(`topup_reject:${request.id}`)
      .setLabel("❌ Отклонить")
      .setStyle(ButtonStyle.Danger)
  );

  await channel.send({
    embeds: [e],
    components: [row],
  });
}

async function approveTopUp(interaction, requestId) {
  if (await adminOnly(interaction)) return;

  const request = await prisma.topUpRequest.findUnique({
    where: {
      id: requestId,
    },
    include: {
      user: {
        include: {
          referredBy: true,
        },
      },
    },
  });

  if (!request) {
    return respondInteraction(interaction, {
      content: "Заявка не найдена.",
      ephemeral: true,
    });
  }

  if (request.status === "APPROVED") {
    return respondInteraction(interaction, {
      content: "Эта заявка уже одобрена.",
      ephemeral: true,
    });
  }

  if (request.status === "REJECTED") {
    return respondInteraction(interaction, {
      content: "Эта заявка уже отклонена.",
      ephemeral: true,
    });
  }

  let referralBonus = 0;
  let referrer = null;
  const refPercent = request.user.refPercent || 0;

  if (request.user.referredBy && refPercent >= 1 && refPercent <= 100) {
    referrer = request.user.referredBy;
    referralBonus = Math.floor((request.amount * refPercent) / 100);
  }

  const hasRegistrationBonusRole = await memberHasRole(interaction.guild, request.user.discordId, REGISTRATION_ROLE_ID);
  const registrationBonus = hasRegistrationBonusRole ? calcRegistrationTopupBonus(request.amount) : 0;
  const totalPlayerTopup = request.amount + registrationBonus;

  const approved = await prisma.$transaction(async (tx) => {
    const lock = await tx.topUpRequest.updateMany({
      where: { id: request.id, status: { notIn: ["APPROVED", "REJECTED"] } },
      data: { status: "APPROVED", processedBy: interaction.user.id, processedAt: new Date() },
    });

    if (lock.count !== 1) return false;

    await tx.user.update({
      where: {
        id: request.userId,
      },
      data: {
        balance: {
          increment: totalPlayerTopup,
        },
      },
    });

    await tx.transaction.create({
      data: {
        userId: request.userId,
        amount: request.amount,
        type: "TOPUP_APPROVED",
        comment: `Пополнение через ticket #${request.id}. Одобрил ${interaction.user.username}`,
      },
    });

    if (registrationBonus > 0) {
      await tx.transaction.create({
        data: {
          userId: request.userId,
          amount: registrationBonus,
          type: "REGISTRATION_TOPUP_BONUS",
          comment: `Бонус +${REGISTRATION_TOPUP_BONUS_PERCENT}% за роль регистрации с пополнения #${request.id}`,
        },
      });
    }

    if (referrer && referralBonus > 0) {
      await tx.user.update({
        where: {
          id: referrer.id,
        },
        data: {
          balance: {
            increment: referralBonus,
          },
        },
      });

      await tx.transaction.create({
        data: {
          userId: referrer.id,
          amount: referralBonus,
          type: "REFERRAL_BONUS",
          comment: `Реферальный бонус ${refPercent}% с пополнения <@${request.user.discordId}> на ${money(
            request.amount
          )}`,
        },
      });

      await tx.referralReward.create({
        data: {
          referrerId: referrer.id,
          referredId: request.userId,
          topUpId: request.id,
          amount: referralBonus,
          percent: refPercent,
          sourceAmount: request.amount,
        },
      });
    }
    return true;
  });

  if (!approved) {
    return respondInteraction(interaction, { content: "Эта заявка уже обработана.", ephemeral: true });
  }



  if (request.ticketChannelId) {
    const ticketChannel = await client.channels
      .fetch(request.ticketChannelId)
      .catch(() => null);

    if (ticketChannel?.isTextBased()) {
      await ticketChannel.send({
        content:
          `✅ <@${request.user.discordId}>, заявка **#${request.id}** одобрена.\n` +
          `На баланс начислено **${money(totalPlayerTopup)}**.` +
          (registrationBonus > 0 ? `\n🎖️ Бонус регистрации: **+${money(registrationBonus)}**.` : ""),
        components: [closeTicketRow(request.id)],
      });
    }
  }

  await log(
    "TOPUP_APPROVED",
    "✅ Пополнение одобрено",
    `Модератор <@${interaction.user.id}> одобрил заявку #${request.id}.`,
    [
      {
        name: "Игрок",
        value: `<@${request.user.discordId}>`,
        inline: true,
      },
      {
        name: "Сумма",
        value: money(request.amount),
        inline: true,
      },
      ...(registrationBonus > 0
        ? [
            {
              name: "Бонус регистрации",
              value: `+${money(registrationBonus)} (+${REGISTRATION_TOPUP_BONUS_PERCENT}%)`,
              inline: true,
            },
          ]
        : []),
      ...(referrer && referralBonus > 0
        ? [
            {
              name: "Реферер",
              value: `<@${referrer.discordId}>`,
              inline: true,
            },
            {
              name: "Реф. бонус",
              value: money(referralBonus),
              inline: true,
            },
          ]
        : []),
    ]
  );

  return respondInteraction(interaction, {
    content:
      `✅ Заявка #${request.id} одобрена. Игроку начислено **${money(
        totalPlayerTopup
      )}**.` +
      (registrationBonus > 0 ? `\n🎖️ Бонус регистрации: **+${money(registrationBonus)}**.` : "") +
      (referrer && referralBonus > 0
        ? `\n🤝 Реферер <@${referrer.discordId}> получил **${money(
            referralBonus
          )}**.`
        : ""),
    ephemeral: true,
  });
}

async function rejectTopUp(interaction, requestId) {
  if (await adminOnly(interaction)) return;

  const request = await prisma.topUpRequest.findUnique({
    where: {
      id: requestId,
    },
    include: {
      user: true,
    },
  });

  if (!request) {
    return respondInteraction(interaction, {
      content: "Заявка не найдена.",
      ephemeral: true,
    });
  }

  if (request.status === "APPROVED" || request.status === "REJECTED") {
    return respondInteraction(interaction, {
      content: "Эта заявка уже обработана.",
      ephemeral: true,
    });
  }

  const rejected = await prisma.topUpRequest.updateMany({
    where: { id: request.id, status: { notIn: ["APPROVED", "REJECTED"] } },
    data: { status: "REJECTED", processedBy: interaction.user.id, processedAt: new Date() },
  });

  if (rejected.count !== 1) {
    return respondInteraction(interaction, { content: "Эта заявка уже обработана.", ephemeral: true });
  }

  if (request.ticketChannelId) {
    const ticketChannel = await client.channels
      .fetch(request.ticketChannelId)
      .catch(() => null);

    if (ticketChannel?.isTextBased()) {
      await ticketChannel.send({
        content:
          `❌ <@${request.user.discordId}>, заявка **#${request.id}** отклонена.\n` +
          `Если это ошибка — свяжись с модератором.`,
        components: [closeTicketRow(request.id)],
      });
    }
  }

  await log(
    "TOPUP_REJECTED",
    "❌ Пополнение отклонено",
    `Модератор <@${interaction.user.id}> отклонил заявку #${request.id}.`,
    [
      {
        name: "Игрок",
        value: `<@${request.user.discordId}>`,
        inline: true,
      },
      {
        name: "Сумма",
        value: money(request.amount),
        inline: true,
      },
    ]
  );

  return respondInteraction(interaction, {
    content: `❌ Заявка #${request.id} отклонена.`,
    ephemeral: true,
  });
}

async function approveWithdraw(interaction, requestId) {
  if (await adminOnly(interaction)) return;

  const request = await prisma.withdrawRequest.findUnique({
    where: {
      id: requestId,
    },
    include: {
      user: true,
    },
  });

  if (!request) {
    return respondInteraction(interaction, {
      content: "Заявка на вывод не найдена.",
      ephemeral: true,
    });
  }

  if (request.status !== "PENDING") {
    return respondInteraction(interaction, {
      content: "Эта заявка уже обработана.",
      ephemeral: true,
    });
  }

  const approved = await prisma.$transaction(async (tx) => {
    const lock = await tx.withdrawRequest.updateMany({
      where: { id: request.id, status: "PENDING" },
      data: { status: "APPROVED", processedBy: interaction.user.id, processedAt: new Date() },
    });

    if (lock.count !== 1) return false;

    await tx.transaction.create({
      data: {
        userId: request.userId,
        amount: 0,
        type: "WITHDRAW_APPROVED",
        comment: `Вывод #${request.id} одобрен. Сумма: ${money(request.amount)}. Комиссия: ${money(request.commission)}. К получению: ${money(request.payoutAmount)}`,
      },
    });

    return true;
  });

  if (!approved) {
    return respondInteraction(interaction, { content: "Эта заявка уже обработана.", ephemeral: true });
  }

  if (request.ticketChannelId) {
    const ticketChannel = await client.channels
      .fetch(request.ticketChannelId)
      .catch(() => null);

    if (ticketChannel?.isTextBased()) {
      await ticketChannel.send({
        content:
          `✅ <@${request.user.discordId}>, заявка на вывод **#${request.id}** одобрена.\n` +
          `Сумма вывода: **${money(request.amount)}**\n` +
          `Комиссия LS Bet: **${money(request.commission)}**\n` +
          `К получению: **${money(request.payoutAmount)}**`,
        components: [closeWithdrawTicketRow(request.id)],
      });
    }
  }

  await log(
    "WITHDRAW_APPROVED",
    "✅ Вывод одобрен",
    `Модератор <@${interaction.user.id}> одобрил вывод #${request.id}.`,
    [
      {
        name: "Игрок",
        value: `<@${request.user.discordId}>`,
        inline: true,
      },
      {
        name: "К получению",
        value: money(request.payoutAmount),
        inline: true,
      },
    ]
  );

  return respondInteraction(interaction, {
    content:
      `✅ Вывод #${request.id} одобрен.\n` +
      `Игроку к выплате: **${money(request.payoutAmount)}**.`,
    ephemeral: true,
  });
}

async function rejectWithdraw(interaction, requestId) {
  if (await adminOnly(interaction)) return;

  const request = await prisma.withdrawRequest.findUnique({
    where: {
      id: requestId,
    },
    include: {
      user: true,
    },
  });

  if (!request) {
    return respondInteraction(interaction, {
      content: "Заявка на вывод не найдена.",
      ephemeral: true,
    });
  }

  if (request.status !== "PENDING") {
    return respondInteraction(interaction, {
      content: "Эта заявка уже обработана.",
      ephemeral: true,
    });
  }

  const rejected = await prisma.$transaction(async (tx) => {
    const lock = await tx.withdrawRequest.updateMany({
      where: { id: request.id, status: "PENDING" },
      data: { status: "REJECTED", processedBy: interaction.user.id, processedAt: new Date() },
    });

    if (lock.count !== 1) return false;

    await tx.user.update({
      where: { id: request.userId },
      data: { balance: { increment: request.amount } },
    });

    await tx.transaction.create({
      data: {
        userId: request.userId,
        amount: request.amount,
        type: "WITHDRAW_REFUND",
        comment: `Возврат средств по отклонённому выводу #${request.id}`,
      },
    });

    await tx.transaction.create({
      data: {
        userId: request.userId,
        amount: 0,
        type: "WITHDRAW_REJECTED",
        comment: `Вывод #${request.id} отклонён модератором ${interaction.user.username}`,
      },
    });

    return true;
  });

  if (!rejected) {
    return respondInteraction(interaction, { content: "Эта заявка уже обработана.", ephemeral: true });
  }

  if (request.ticketChannelId) {
    const ticketChannel = await client.channels
      .fetch(request.ticketChannelId)
      .catch(() => null);

    if (ticketChannel?.isTextBased()) {
      await ticketChannel.send({
        content:
          `❌ <@${request.user.discordId}>, заявка на вывод **#${request.id}** отклонена.\n` +
          `На баланс возвращено **${money(request.amount)}**.`,
        components: [closeWithdrawTicketRow(request.id)],
      });
    }
  }

  await log(
    "WITHDRAW_REJECTED",
    "❌ Вывод отклонён",
    `Модератор <@${interaction.user.id}> отклонил вывод #${request.id}.`,
    [
      {
        name: "Игрок",
        value: `<@${request.user.discordId}>`,
        inline: true,
      },
      {
        name: "Возврат",
        value: money(request.amount),
        inline: true,
      },
    ]
  );

  return respondInteraction(interaction, {
    content: `❌ Вывод #${request.id} отклонён. Игроку возвращено **${money(
      request.amount
    )}**.`,
    ephemeral: true,
  });
}

async function closeTicket(interaction, requestId) {
  const request = await prisma.topUpRequest.findUnique({
    where: {
      id: requestId,
    },
    include: {
      user: true,
    },
  });

  if (!request) {
    return respondInteraction(interaction, {
      content: "Заявка не найдена.",
      ephemeral: true,
    });
  }

  const isOwner = request.user.discordId === interaction.user.id;
  const isModerator = isAdmin(interaction);

  if (!isOwner && !isModerator) {
    return respondInteraction(interaction, {
      content: "⛔ Закрыть этот тикет может только владелец заявки или модератор.",
      ephemeral: true,
    });
  }

  await respondInteraction(interaction, {
    content: "🔒 Тикет будет закрыт через 5 секунд.",
  });

  setTimeout(async () => {
    try {
      await interaction.channel.delete(
        `LS Bet ticket closed by ${interaction.user.username}`
      );
    } catch (error) {
      console.error("Не смог закрыть тикет:", error.message);
    }
  }, 5000);
}

async function closeWithdrawTicket(interaction, requestId) {
  const request = await prisma.withdrawRequest.findUnique({
    where: {
      id: requestId,
    },
    include: {
      user: true,
    },
  });

  if (!request) {
    return respondInteraction(interaction, {
      content: "Заявка на вывод не найдена.",
      ephemeral: true,
    });
  }

  const isOwner = request.user.discordId === interaction.user.id;
  const isModerator = isAdmin(interaction);

  if (!isOwner && !isModerator) {
    return respondInteraction(interaction, {
      content: "⛔ Закрыть этот тикет может только владелец заявки или модератор.",
      ephemeral: true,
    });
  }

  await respondInteraction(interaction, {
    content: "🔒 Тикет вывода будет закрыт через 5 секунд.",
  });

  setTimeout(async () => {
    try {
      await interaction.channel.delete(
        `LS Bet withdraw ticket closed by ${interaction.user.username}`
      );
    } catch (error) {
      console.error("Не смог закрыть тикет вывода:", error.message);
    }
  }, 5000);
}

async function showAdminTopUps(interaction) {
  if (await adminOnly(interaction)) return;

  const requests = await prisma.topUpRequest.findMany({
    where: {
      status: {
        in: ["WAITING_SCREENSHOT", "PENDING"],
      },
    },
    orderBy: {
      id: "desc",
    },
    take: 5,
    include: {
      user: true,
    },
  });

  if (requests.length === 0) {
    return respondInteraction(interaction, {
      content: "Активных заявок на пополнение сейчас нет.",
      ephemeral: true,
    });
  }

  const embeds = [];
  const components = [];

  for (const request of requests) {
    const e = embed(
      request.status === "PENDING" ? LS_THEME.gold : LS_THEME.blue
    )
      .setTitle(`💰 Заявка #${request.id}`)
      .setDescription(
        [
          `**Статус:** ${request.status}`,
          `**Игрок:** <@${request.user.discordId}>`,
          `**Логин:** ${request.login}`,
          `**Сумма:** ${money(request.amount)}`,
          `**Ticket:** ${
            request.ticketChannelId
              ? `<#${request.ticketChannelId}>`
              : "Не создан"
          }`,
          `**Создана:** <t:${unix(request.createdAt)}:R>`,
        ].join("\n")
      );

    if (request.screenshotUrl) e.setImage(request.screenshotUrl);

    embeds.push(e);

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`topup_approve:${request.id}`)
        .setLabel(`✅ Одобрить #${request.id}`)
        .setStyle(ButtonStyle.Success)
        .setDisabled(["APPROVED", "REJECTED"].includes(request.status)),

      new ButtonBuilder()
        .setCustomId(`topup_reject:${request.id}`)
        .setLabel(`❌ Отклонить #${request.id}`)
        .setStyle(ButtonStyle.Danger)
        .setDisabled(["APPROVED", "REJECTED"].includes(request.status))
    );

    components.push(row);
  }

  return respondInteraction(interaction, {
    embeds,
    components,
    ephemeral: true,
  });
}

async function showAdminWithdraws(interaction) {
  if (await adminOnly(interaction)) return;

  const requests = await prisma.withdrawRequest.findMany({
    where: {
      status: "PENDING",
    },
    orderBy: {
      id: "desc",
    },
    take: 5,
    include: {
      user: true,
    },
  });

  if (requests.length === 0) {
    return respondInteraction(interaction, {
      content: "Активных заявок на вывод сейчас нет.",
      ephemeral: true,
    });
  }

  const embeds = [];
  const components = [];

  for (const request of requests) {
    const e = embed(LS_THEME.red)
      .setTitle(`💸 Заявка на вывод #${request.id}`)
      .setDescription(
        [
          `**Статус:** ${request.status}`,
          `**Игрок:** <@${request.user.discordId}>`,
          `**Логин:** ${request.login}`,
          `**Сумма вывода:** ${money(request.amount)}`,
          `**Комиссия:** ${money(request.commission)}`,
          `**К получению:** ${money(request.payoutAmount)}`,
          `**Реквизиты:** ${request.details}`,
          `**Ticket:** ${
            request.ticketChannelId
              ? `<#${request.ticketChannelId}>`
              : "Не создан"
          }`,
          `**Создана:** <t:${unix(request.createdAt)}:R>`,
        ].join("\n")
      );

    embeds.push(e);

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`withdraw_approve:${request.id}`)
        .setLabel(`✅ Одобрить #${request.id}`)
        .setStyle(ButtonStyle.Success),

      new ButtonBuilder()
        .setCustomId(`withdraw_reject:${request.id}`)
        .setLabel(`❌ Отклонить #${request.id}`)
        .setStyle(ButtonStyle.Danger)
    );

    components.push(row);
  }

  return respondInteraction(interaction, {
    embeds,
    components,
    ephemeral: true,
  });
}

async function showEventStats(interaction, eventId) {
  const event = await fullEvent(eventId);

  if (!event) {
    return respondInteraction(interaction, {
      content: "Событие не найдено.",
      ephemeral: true,
    });
  }

  const lines = event.options.map((option) => {
    const total = optionTotal(option);
    const count = option.bets.filter((bet) => bet.status === "ACTIVE").length;

    return `**${option.title}** — ${money(total)} / ставок: ${count}`;
  });

  const e = embed(LS_THEME.green)
    .setTitle(`📊 Статистика события #${event.id}`)
    .setDescription(
      [
        `**${event.title}**`,
        "",
        `Банк события: **${money(eventBank(event))}**`,
        "",
        ...lines,
      ].join("\n")
    );

  return respondInteraction(interaction, {
    embeds: [e],
    ephemeral: true,
  });
}


function adminEventEditModal(event) {
  const option1 = event.options?.[0];
  const option2 = event.options?.[1];
  const option3 = event.options?.[2];

  const modal = new ModalBuilder()
    .setCustomId(`admin_event_edit_modal:${event.id}`)
    .setTitle(`Изменить событие #${event.id}`);

  modal.addComponents(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId("title")
        .setLabel("Название события")
        .setRequired(false)
        .setValue(String(event.title || "").slice(0, 100))
        .setStyle(TextInputStyle.Short)
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId("description")
        .setLabel("Описание")
        .setRequired(false)
        .setValue(String(event.description || "").slice(0, 900))
        .setStyle(TextInputStyle.Paragraph)
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId("odds")
        .setLabel("Коэффициенты: П1 / X / П2")
        .setPlaceholder("Например: 1.34 / 3.10 / 2.02")
        .setRequired(false)
        .setValue(`${option1?.odds || ""} / ${option2?.odds || ""}${option3 ? ` / ${option3.odds}` : ""}`.slice(0, 100))
        .setStyle(TextInputStyle.Short)
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId("names")
        .setLabel("Исходы: П1 / X / П2")
        .setPlaceholder("Например: США / X / Парагвай")
        .setRequired(false)
        .setValue(`${option1?.title || ""} / ${option2?.title || ""}${option3 ? ` / ${option3.title}` : ""}`.slice(0, 100))
        .setStyle(TextInputStyle.Short)
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId("minutes")
        .setLabel("Через сколько минут закрыть ставки")
        .setPlaceholder("Оставь пустым, чтобы не менять")
        .setRequired(false)
        .setStyle(TextInputStyle.Short)
    )
  );

  return modal;
}


function adminEventEditByIdModal() {
  const modal = new ModalBuilder()
    .setCustomId("admin_event_edit_by_id_modal")
    .setTitle("Изменить событие по ID");

  modal.addComponents(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId("eventId")
        .setLabel("ID события")
        .setPlaceholder("Например: 41")
        .setRequired(true)
        .setStyle(TextInputStyle.Short)
    )
  );

  return modal;
}

function adminEventCancelModal(eventId) {
  const modal = new ModalBuilder()
    .setCustomId(`admin_event_cancel_modal:${eventId}`)
    .setTitle(`Отмена события #${eventId}`);

  modal.addComponents(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId("reason")
        .setLabel("Причина отмены")
        .setPlaceholder("Например: матч перенесён / событие отменено")
        .setRequired(true)
        .setStyle(TextInputStyle.Paragraph)
    )
  );

  return modal;
}

async function adminApplyEventEdit(interaction, eventId) {
  if (await adminOnly(interaction)) return;

  const event = await fullEvent(eventId);
  if (!event) return respondInteraction(interaction, { content: "Событие не найдено.", ephemeral: true });
  if (["FINISHED", "CANCELLED"].includes(event.status)) {
    return respondInteraction(interaction, { content: "Завершённые или отменённые события нельзя редактировать.", ephemeral: true });
  }

  const title = interaction.fields.getTextInputValue("title").trim();
  const description = interaction.fields.getTextInputValue("description").trim();
  const oddsRaw = interaction.fields.getTextInputValue("odds").trim();
  const namesRaw = interaction.fields.getTextInputValue("names").trim();
  const minutesRaw = interaction.fields.getTextInputValue("minutes").trim();

  const eventData = {};
  const changes = [];

  if (title && title !== event.title) {
    eventData.title = title;
    changes.push(`Название: ${event.title} → ${title}`);
  }

  if (description && description !== (event.description || "")) {
    eventData.description = description;
    changes.push("Описание обновлено");
  }

  if (minutesRaw) {
    const minutes = Number(minutesRaw);
    if (!Number.isInteger(minutes) || minutes <= 0) {
      return respondInteraction(interaction, { content: "Время должно быть целым числом больше 0.", ephemeral: true });
    }
    eventData.closesAt = new Date(Date.now() + minutes * 60 * 1000);
    changes.push(`Закрытие ставок: через ${minutes} мин.`);
  }

  const optionUpdates = [];
  if (oddsRaw) {
    const parts = oddsRaw.split(/[\/|,;]/).map((v) => Number(String(v).trim())).filter((v) => !Number.isNaN(v));
    if (parts.length >= 1 && parts[0] <= 1) return respondInteraction(interaction, { content: "Коэффициент П1 должен быть больше 1.00.", ephemeral: true });
    if (parts.length >= 2 && parts[1] <= 1) return respondInteraction(interaction, { content: "Коэффициент X должен быть больше 1.00.", ephemeral: true });
    if (parts.length >= 3 && parts[2] <= 1) return respondInteraction(interaction, { content: "Коэффициент П2 должен быть больше 1.00.", ephemeral: true });
    if (parts[0] && event.options[0]) optionUpdates.push({ id: event.options[0].id, data: { odds: parts[0] }, text: `${event.options[0].title}: x${event.options[0].odds} → x${parts[0]}` });
    if (parts[1] && event.options[1]) optionUpdates.push({ id: event.options[1].id, data: { odds: parts[1] }, text: `${event.options[1].title}: x${event.options[1].odds} → x${parts[1]}` });
    if (parts[2] && event.options[2]) optionUpdates.push({ id: event.options[2].id, data: { odds: parts[2] }, text: `${event.options[2].title}: x${event.options[2].odds} → x${parts[2]}` });
  }

  if (namesRaw) {
    const parts = namesRaw.split(/[\/|;]/).map((v) => String(v).trim()).filter(Boolean);
    if (parts[0] && event.options[0]) optionUpdates.push({ id: event.options[0].id, data: { title: parts[0] }, text: `Исход 1: ${event.options[0].title} → ${parts[0]}` });
    if (parts[1] && event.options[1]) optionUpdates.push({ id: event.options[1].id, data: { title: parts[1] }, text: `Исход 2: ${event.options[1].title} → ${parts[1]}` });
    if (parts[2] && event.options[2]) optionUpdates.push({ id: event.options[2].id, data: { title: parts[2] }, text: `Исход 3: ${event.options[2].title} → ${parts[2]}` });
  }

  await prisma.$transaction(async (tx) => {
    if (Object.keys(eventData).length) await tx.rpEvent.update({ where: { id: event.id }, data: eventData });
    for (const update of optionUpdates) {
      await tx.eventOption.update({ where: { id: update.id }, data: update.data });
    }
  });

  changes.push(...optionUpdates.map((u) => u.text));
  await updateEventMessage(event.id);
  const freshEditedEvent = await fullEvent(event.id);
  if (freshEditedEvent?.facebrowserPostId) {
    publishFacebrowserEvent(event.id).catch((error) => console.error("Facebrowser update after edit:", error.message, error.data || ""));
  }

  await log("EVENT_EDITED", "✏️ Событие изменено", `Администратор <@${interaction.user.id}> изменил событие #${event.id}.`, [
    { name: "Событие", value: event.title, inline: false },
    { name: "Изменения", value: changes.length ? changes.join("\n").slice(0, 1024) : "Без изменений", inline: false },
  ], { channelId: interaction.channelId });

  return respondInteraction(interaction, {
    content: changes.length ? `✅ Событие #${event.id} обновлено.\n${changes.map((c) => `• ${c}`).join("\n")}` : "Изменений нет.",
    ephemeral: true,
  });
}


function adminCreateEventModal() {
  const modal = new ModalBuilder()
    .setCustomId("admin_create_event_modal")
    .setTitle("Создать событие LS BET");

  modal.addComponents(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId("title")
        .setLabel("Название события")
        .setPlaceholder("Например: США vs Парагвай")
        .setRequired(true)
        .setStyle(TextInputStyle.Short)
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId("description")
        .setLabel("Описание / событие")
        .setPlaceholder("Например: FIFA World Cup 2026")
        .setRequired(true)
        .setStyle(TextInputStyle.Paragraph)
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId("names")
        .setLabel("Исходы: П1 / X / П2")
        .setPlaceholder("США / X / Парагвай")
        .setRequired(true)
        .setStyle(TextInputStyle.Short)
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId("odds")
        .setLabel("Коэффициенты: П1 / X / П2")
        .setPlaceholder("1.34 / 3.10 / 2.02")
        .setRequired(true)
        .setStyle(TextInputStyle.Short)
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId("minutes")
        .setLabel("Через сколько минут закрыть ставки")
        .setPlaceholder("Например: 1440")
        .setRequired(true)
        .setStyle(TextInputStyle.Short)
    )
  );

  return modal;
}

function adminUserIdModal(customId, title, withAmount = false) {
  const modal = new ModalBuilder().setCustomId(customId).setTitle(title);
  const rows = [
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId("discordId")
        .setLabel("Discord ID пользователя")
        .setPlaceholder("Например: 123456789012345678")
        .setRequired(true)
        .setStyle(TextInputStyle.Short)
    ),
  ];

  if (withAmount) {
    rows.push(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("amount")
          .setLabel("Сумма")
          .setPlaceholder("Например: 10000")
          .setRequired(true)
          .setStyle(TextInputStyle.Short)
      )
    );
  }

  modal.addComponents(...rows);
  return modal;
}

function fakeDiscordUserFromId(discordId) {
  return {
    id: String(discordId),
    username: String(discordId),
    displayAvatarURL: () => "https://cdn.discordapp.com/embed/avatars/0.png",
  };
}

async function adminApplyCreateEvent(interaction) {
  if (await adminOnly(interaction)) return;

  const title = interaction.fields.getTextInputValue("title").trim();
  const description = interaction.fields.getTextInputValue("description").trim();
  const namesRaw = interaction.fields.getTextInputValue("names").trim();
  const oddsRaw = interaction.fields.getTextInputValue("odds").trim();
  const minutesRaw = interaction.fields.getTextInputValue("minutes").trim();

  const names = namesRaw.split(/[\/|;]/).map((v) => v.trim()).filter(Boolean);
  const odds = oddsRaw.split(/[\/|,;]/).map((v) => Number(String(v).trim())).filter((v) => !Number.isNaN(v));
  const minutes = Number(minutesRaw);

  if (names.length < 2 || names.length > 3) {
    return respondInteraction(interaction, { content: "Укажи 2 или 3 исхода через /. Например: США / X / Парагвай", ephemeral: true });
  }

  if (odds.length !== names.length || odds.some((value) => value <= 1)) {
    return respondInteraction(interaction, { content: "Количество коэффициентов должно совпадать с исходами. Каждый коэффициент должен быть больше 1.00.", ephemeral: true });
  }

  if (!Number.isInteger(minutes) || minutes <= 0) {
    return respondInteraction(interaction, { content: "Время закрытия должно быть целым числом больше 0.", ephemeral: true });
  }

  const eventChannel = await client.channels.fetch(EVENT_CHANNEL_ID).catch(() => null);
  if (!eventChannel?.isTextBased()) {
    return respondInteraction(interaction, { content: `⛔ Канал событий <#${EVENT_CHANNEL_ID}> не найден или бот не может туда писать.`, ephemeral: true });
  }

  const closesAt = new Date(Date.now() + minutes * 60 * 1000);
  const event = await prisma.rpEvent.create({
    data: {
      title,
      description,
      status: "OPEN",
      closesAt,
      createdBy: interaction.user.id,
      channelId: EVENT_CHANNEL_ID,
      options: {
        create: names.map((name, index) => ({ title: name, odds: odds[index] })),
      },
    },
    include: { options: { orderBy: { id: "asc" }, include: { bets: true } } },
  });

  const message = await eventChannel.send({
    content: "📢 **LS Bet афиша события**",
    embeds: eventEmbeds(event),
    components: eventButtons(event),
  });

  await prisma.rpEvent.update({ where: { id: event.id }, data: { messageId: message.id, channelId: EVENT_CHANNEL_ID } });

  if (FACEBROWSER_AUTOPOST_EVENTS) {
    publishFacebrowserEvent(event.id).catch((error) => console.error("Facebrowser auto post:", error.message, error.data || ""));
  }

  await log("EVENT_CREATED", "📢 Событие создано через админ-панель", `Администратор <@${interaction.user.id}> создал событие #${event.id}.`, [
    { name: "Событие", value: title, inline: false },
    { name: "Исходы", value: names.map((name, i) => `${i + 1}. ${name} | x${odds[i]}`).join("\n"), inline: false },
    { name: "Закрытие ставок", value: `<t:${unix(closesAt)}:R>`, inline: true },
  ], { channelId: interaction.channelId });

  return respondInteraction(interaction, { content: `✅ Событие #${event.id} создано и опубликовано в <#${EVENT_CHANNEL_ID}>. Баннер можно добавить через /event_edit или пересоздать событие через /event_create с attachment.`, ephemeral: true });
}

async function adminApplyUserAction(interaction, action) {
  if (await adminOnly(interaction)) return;

  const discordId = interaction.fields.getTextInputValue("discordId").trim().replace(/[<@!>]/g, "");
  if (!/^\d{15,25}$/.test(discordId)) {
    return respondInteraction(interaction, { content: "Укажи корректный Discord ID пользователя.", ephemeral: true });
  }

  const member = await interaction.guild.members.fetch(discordId).catch(() => null);
  const targetUser = member?.user || fakeDiscordUserFromId(discordId);

  if (action === "info") {
    return showUserInfo(interaction, targetUser);
  }

  const amount = Number(interaction.fields.getTextInputValue("amount"));
  if (!Number.isInteger(amount) || amount < 0) {
    return respondInteraction(interaction, { content: "Сумма должна быть целым числом 0 или больше.", ephemeral: true });
  }

  if (action === "add") {
    if (amount <= 0) return respondInteraction(interaction, { content: "Сумма начисления должна быть больше 0.", ephemeral: true });
    const user = await userOf(targetUser);
    await prisma.$transaction([
      prisma.user.update({ where: { id: user.id }, data: { balance: { increment: amount } } }),
      prisma.transaction.create({ data: { userId: user.id, amount, type: "ADMIN_ADD", comment: `Администратор ${interaction.user.username} начислил баланс через кнопку.` } }),
    ]);
    await log("ADMIN_ADD", "➕ Баланс начислен", `Администратор <@${interaction.user.id}> начислил <@${targetUser.id}> ${money(amount)}.`, [{ name: "Сумма", value: money(amount), inline: true }], { channelId: interaction.channelId });
    return respondInteraction(interaction, { content: `✅ <@${targetUser.id}> начислено **${money(amount)}**.`, ephemeral: true });
  }

  if (action === "remove") return removeUserBalance(interaction, targetUser, amount);
  if (action === "set") return setUserBalance(interaction, targetUser, amount);
}

async function showAdminEventsMenu(interaction) {
  if (await adminOnly(interaction)) return;

  const e = embed(LS_THEME.gold)
    .setTitle("📢 LS Bet — Управление событиями")
    .setDescription([
      "```",
      "EVENT CONTROL",
      "CREATE • EDIT • FINISH • CANCEL • REFUND",
      "```",
      "Создание через кнопку работает без загрузки баннера. Для афиши-картинки можно использовать /event_create или позже заменить баннер через команду.",
      LS_TEXT.line,
    ].join("\n"));

  const r1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("admin_event_create_button").setLabel("➕ Создать").setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId("admin_events_active_button").setLabel("📋 Активные").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId("admin_event_edit_by_id_button").setLabel("✏️ Изменить по ID").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId("admin_back_main").setLabel("⬅️ Назад").setStyle(ButtonStyle.Secondary)
  );

  return respondInteraction(interaction, { embeds: [e], components: [r1], ephemeral: true });
}

async function showAdminEvents(interaction) {
  if (await adminOnly(interaction)) return;

  const events = await prisma.rpEvent.findMany({
    where: { status: { in: ["OPEN", "LIVE"] } },
    orderBy: { id: "desc" },
    take: 5,
    include: { options: { orderBy: { id: "asc" }, include: { bets: true } } },
  });

  if (events.length === 0) {
    return respondInteraction(interaction, { content: "Сейчас нет активных событий.", ephemeral: true });
  }

  await respondInteraction(interaction, { content: `📢 **Активные события LS BET:** ${events.length}\nКаждое событие отправлено отдельной карточкой, чтобы поддерживать П1 / X / П2.`, ephemeral: true });

  for (const event of events) {
    const optionsText = (event.options || [])
      .map((option, index) => `${index + 1}️⃣ ${option.title} — x${option.odds} • ${money(optionTotal(option))}`)
      .join("\n");

    const e = embed(event.status === "OPEN" ? LS_THEME.green : LS_THEME.red)
      .setTitle(`Событие #${event.id}: ${event.title}`)
      .setDescription([
        `**Статус:** ${statusEvent(event.status)}`,
        `**Банк:** ${money(eventBank(event))}`,
        `**Закрытие ставок:** <t:${unix(event.closesAt)}:R>`,
        "",
        optionsText || "Исходы не найдены.",
      ].join("\n"));

    const finishRow = new ActionRowBuilder();
    finishRow.addComponents(
      new ButtonBuilder()
        .setCustomId(`admin_live:${event.id}`)
        .setLabel("🔴 LIVE")
        .setStyle(ButtonStyle.Danger)
        .setDisabled(event.status !== "OPEN")
    );

    for (const [index, option] of (event.options || []).slice(0, 4).entries()) {
      finishRow.addComponents(
        new ButtonBuilder()
          .setCustomId(`admin_finish:${event.id}:${index + 1}`)
          .setLabel(`🏆 ${String(option.title).slice(0, 16)}`)
          .setStyle(ButtonStyle.Success)
      );
    }

    const manageRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`admin_event_edit:${event.id}`)
        .setLabel("✏️ Изменить")
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId(`admin_event_facebrowser:${event.id}`)
        .setLabel("🌐 FACEBROWSER")
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(`admin_event_cancel:${event.id}`)
        .setLabel("❌ Отменить")
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(event.status === "FINISHED" || event.status === "CANCELLED")
    );

    await followUpInteraction(interaction, { embeds: [e], components: [finishRow, manageRow], ephemeral: true });
  }
}

async function showUserInfo(interaction, targetDiscordUser) {
  if (!interaction.deferred && !interaction.replied) {
    await deferInteractionReply(interaction, { ephemeral: true });
  }

  const user = await userOf(targetDiscordUser);

  const totalBets = await prisma.bet.count({
    where: {
      userId: user.id,
    },
  });

  const activeBets = await prisma.bet.count({
    where: {
      userId: user.id,
      status: "ACTIVE",
    },
  });

  const wonBets = await prisma.bet.count({
    where: {
      userId: user.id,
      status: "WON",
    },
  });

  const lostBets = await prisma.bet.count({
    where: {
      userId: user.id,
      status: "LOST",
    },
  });

  const topUps = await prisma.topUpRequest.aggregate({
    where: {
      userId: user.id,
      status: "APPROVED",
    },
    _sum: {
      amount: true,
    },
  });

  const withdraws = await prisma.withdrawRequest.aggregate({
    where: {
      userId: user.id,
      status: "APPROVED",
    },
    _sum: {
      amount: true,
      payoutAmount: true,
    },
  });

  const lotteryPrize = await prisma.lotteryTicket.aggregate({
    where: {
      userId: user.id,
    },
    _sum: {
      prize: true,
    },
  });

  const referralsCount = await prisma.user.count({
    where: {
      referredByUserId: user.id,
    },
  });

  const referralEarned = await prisma.referralReward.aggregate({
    where: {
      referrerId: user.id,
    },
    _sum: {
      amount: true,
    },
  });

  const winPercent =
    wonBets + lostBets > 0
      ? ((wonBets / (wonBets + lostBets)) * 100).toFixed(1)
      : "0.0";

  const e = embed(LS_THEME.gold)
    .setTitle("👤 LS Bet — информация об игроке")
    .setThumbnail(targetDiscordUser.displayAvatarURL())
    .setDescription(
      [
        `**Игрок:** <@${targetDiscordUser.id}>`,
        `**Discord ID:** \`${targetDiscordUser.id}\``,
        `**Username:** \`${targetDiscordUser.username}\``,
        "",
        LS_TEXT.line,
      ].join("\n")
    )
    .addFields(
      {
        name: "Баланс",
        value: money(user.balance),
        inline: true,
      },
      {
        name: "Создан в базе",
        value: `<t:${unix(user.createdAt)}:R>`,
        inline: true,
      },
      {
        name: "Статус регистрации",
        value: registrationStatusName(user.registrationStatus),
        inline: true,
      },
      {
        name: "Имя и фамилия",
        value: user.registeredFullName || "Не указано",
        inline: true,
      },
      {
        name: "Телефон",
        value: user.registeredPhone || "Не указан",
        inline: true,
      },
      {
        name: "Возраст",
        value: user.registeredAge ? String(user.registeredAge) : "Не указан",
        inline: true,
      },
      {
        name: "Всего ставок",
        value: String(totalBets),
        inline: true,
      },
      {
        name: "Активные ставки",
        value: String(activeBets),
        inline: true,
      },
      {
        name: "Выиграно ставок",
        value: String(wonBets),
        inline: true,
      },
      {
        name: "Проиграно ставок",
        value: String(lostBets),
        inline: true,
      },
      {
        name: "Процент побед",
        value: `${winPercent}%`,
        inline: true,
      },
      {
        name: "Пополнено всего",
        value: money(topUps._sum.amount || 0),
        inline: true,
      },
      {
        name: "Выводов одобрено",
        value: money(withdraws._sum.amount || 0),
        inline: true,
      },
      {
        name: "К выплате выводами",
        value: money(withdraws._sum.payoutAmount || 0),
        inline: true,
      },
      {
        name: "Выигрыш в лотерее",
        value: money(lotteryPrize._sum.prize || 0),
        inline: true,
      },
      {
        name: "Рефералов",
        value: String(referralsCount),
        inline: true,
      },
      {
        name: "Заработано с рефералов",
        value: money(referralEarned._sum.amount || 0),
        inline: true,
      }
    );

  return interaction.editReply({
    embeds: [e],
  });
}

async function setUserBalance(interaction, targetDiscordUser, amount) {
  if (await adminOnly(interaction)) return;

  if (!Number.isInteger(amount) || amount < 0) {
    return respondInteraction(interaction, {
      content: "Баланс должен быть числом 0 или больше.",
      ephemeral: true,
    });
  }

  const user = await userOf(targetDiscordUser);
  const oldBalance = user.balance;
  const difference = amount - oldBalance;

  await prisma.$transaction([
    prisma.user.update({
      where: {
        id: user.id,
      },
      data: {
        balance: amount,
      },
    }),

    prisma.transaction.create({
      data: {
        userId: user.id,
        amount: difference,
        type: "BALANCE_SET",
        comment: `Администратор ${interaction.user.username} установил баланс. Было: ${money(
          oldBalance
        )}, стало: ${money(amount)}`,
      },
    }),
  ]);

  return respondInteraction(interaction, {
    content:
      `✅ Баланс игрока <@${targetDiscordUser.id}> установлен.\n` +
      `Было: **${money(oldBalance)}**\n` +
      `Стало: **${money(amount)}**`,
    ephemeral: true,
  });
}

async function removeUserBalance(interaction, targetDiscordUser, amount) {
  if (await adminOnly(interaction)) return;

  if (!Number.isInteger(amount) || amount <= 0) {
    return respondInteraction(interaction, {
      content: "Сумма списания должна быть больше 0.",
      ephemeral: true,
    });
  }

  const user = await userOf(targetDiscordUser);
  const removeAmount = Math.min(amount, user.balance);
  const newBalance = user.balance - removeAmount;

  await prisma.$transaction([
    prisma.user.update({
      where: {
        id: user.id,
      },
      data: {
        balance: newBalance,
      },
    }),

    prisma.transaction.create({
      data: {
        userId: user.id,
        amount: -removeAmount,
        type: "ADMIN_REMOVE",
        comment: `Администратор ${interaction.user.username} списал баланс.`,
      },
    }),
  ]);

  return respondInteraction(interaction, {
    content:
      `✅ У игрока <@${targetDiscordUser.id}> списано **${money(
        removeAmount
      )}**.\n` +
      `Новый баланс: **${money(newBalance)}**.`,
    ephemeral: true,
  });
}

async function showAdminUsers(interaction) {
  if (await adminOnly(interaction)) return;

  const users = await prisma.user.findMany({
    orderBy: {
      balance: "desc",
    },
    take: 15,
    include: {
      bets: true,
      topUpRequests: true,
      withdrawRequests: true,
      referrals: true,
    },
  });

  if (users.length === 0) {
    return respondInteraction(interaction, {
      content: "Пользователей пока нет.",
      ephemeral: true,
    });
  }

  const text = users
    .map((user, index) => {
      const approvedTopups = user.topUpRequests.filter(
        (request) => request.status === "APPROVED"
      );
      const approvedWithdraws = user.withdrawRequests.filter(
        (request) => request.status === "APPROVED"
      );

      const totalTopups = approvedTopups.reduce(
        (sum, item) => sum + item.amount,
        0
      );

      const totalWithdraws = approvedWithdraws.reduce(
        (sum, item) => sum + item.amount,
        0
      );

      return [
        `**#${index + 1} — <@${user.discordId}>**`,
        `Баланс: **${money(user.balance)}**`,
        `Ставок: **${user.bets.length}**`,
        `Пополнено: **${money(totalTopups)}**`,
        `Выведено: **${money(totalWithdraws)}**`,
        `Рефералов: **${user.referrals.length}**`,
        `Discord ID: \`${user.discordId}\``,
      ].join("\n");
    })
    .join("\n\n");

  const e = embed(LS_THEME.gold)
    .setTitle("👥 LS Bet — список игроков")
    .setDescription(text.slice(0, 4000));

  return respondInteraction(interaction, {
    embeds: [e],
    ephemeral: true,
  });
}

async function adminSetEventLive(interaction, eventId) {
  if (await adminOnly(interaction)) return;

  const event = await prisma.rpEvent.findUnique({
    where: {
      id: eventId,
    },
  });

  if (!event) {
    return respondInteraction(interaction, {
      content: "Событие не найдено.",
      ephemeral: true,
    });
  }

  if (event.status !== "OPEN") {
    return respondInteraction(interaction, {
      content: "В LIVE можно перевести только открытое событие.",
      ephemeral: true,
    });
  }

  await prisma.rpEvent.update({
    where: {
      id: eventId,
    },
    data: {
      status: "LIVE",
    },
  });

  await updateEventMessage(eventId);

  await log("EVENT_MANUAL_LIVE", "🔴 Событие переведено в LIVE", `Администратор <@${interaction.user.id}> закрыл ставки по событию #${event.id}.`, [
    { name: "Событие", value: event.title, inline: false },
  ], { channelId: interaction.channelId });

  return respondInteraction(interaction, {
    content: `🔴 Событие **${event.title}** переведено в LIVE. Ставки закрыты.`,
    ephemeral: true,
  });
}

async function adminFinishEvent(interaction, eventId, winnerNumber) {
  if (await adminOnly(interaction)) return;

  const event = await prisma.rpEvent.findUnique({
    where: {
      id: eventId,
    },
    include: {
      options: {
        orderBy: {
          id: "asc",
        },
      },
    },
  });

  if (!event) {
    return respondInteraction(interaction, {
      content: "Событие не найдено.",
      ephemeral: true,
    });
  }

  if (event.status === "FINISHED") {
    return respondInteraction(interaction, {
      content: "Это событие уже завершено.",
      ephemeral: true,
    });
  }

  const winnerOption = event.options[winnerNumber - 1];

  if (!winnerOption) {
    return respondInteraction(interaction, {
      content: "Победный исход не найден.",
      ephemeral: true,
    });
  }

  let winnersCount = 0;
  let totalPaid = 0;

  await prisma.$transaction(async (tx) => {
    await tx.rpEvent.update({
      where: {
        id: event.id,
      },
      data: {
        status: "FINISHED",
      },
    });

    await tx.eventOption.updateMany({
      where: {
        eventId: event.id,
      },
      data: {
        isWinner: false,
      },
    });

    await tx.eventOption.update({
      where: {
        id: winnerOption.id,
      },
      data: {
        isWinner: true,
      },
    });

    const bets = await tx.bet.findMany({
      where: {
        eventId: event.id,
        status: "ACTIVE",
      },
    });

    for (const bet of bets) {
      if (bet.optionId === winnerOption.id) {
        winnersCount++;
        totalPaid += bet.potentialWin;

        await tx.bet.update({
          where: {
            id: bet.id,
          },
          data: {
            status: "WON",
          },
        });

        await tx.user.update({
          where: {
            id: bet.userId,
          },
          data: {
            balance: {
              increment: bet.potentialWin,
            },
          },
        });

        await tx.transaction.create({
          data: {
            userId: bet.userId,
            amount: bet.potentialWin,
            type: "EVENT_WIN",
            comment: `Выигрыш по событию "${event.title}". Победный исход: ${winnerOption.title}`,
          },
        });
      } else {
        await tx.bet.update({
          where: {
            id: bet.id,
          },
          data: {
            status: "LOST",
          },
        });
      }
    }
  });

  await updateEventMessage(event.id);
  await publishEventResult(event, winnerOption, winnersCount, totalPaid);

  await log("EVENT_FINISHED", "🏁 Cобытие завершено", `Администратор <@${interaction.user.id}> завершил событие #${event.id}.`, [
    { name: "Событие", value: event.title, inline: false },
    { name: "Победный исход", value: winnerOption.title, inline: true },
    { name: "Победителей", value: String(winnersCount), inline: true },
    { name: "Выплачено", value: money(totalPaid), inline: true },
  ], { channelId: interaction.channelId });

  return respondInteraction(interaction, {
    content:
      `✅ **Событие завершено**\n` +
      `Событие: **${event.title}**\n` +
      `Победный исход: **${winnerOption.title}**\n` +
      `Победителей: **${winnersCount}**\n` +
      `Выплачено: **${money(totalPaid)}**\n` +
      `Итоги опубликованы в <#${RESULT_CHANNEL_ID}>`,
    ephemeral: true,
  });
}

async function adminCancelEvent(interaction, eventId, reason) {
  if (await adminOnly(interaction)) return;

  const event = await prisma.rpEvent.findUnique({
    where: { id: eventId },
    include: {
      options: { orderBy: { id: "asc" }, include: { bets: true } },
      bets: { where: { status: "ACTIVE" } },
    },
  });

  if (!event) {
    return respondInteraction(interaction, { content: "Событие не найдено.", ephemeral: true });
  }

  if (event.status === "FINISHED") {
    return respondInteraction(interaction, { content: "Завершённое событие нельзя отменить. Используй отдельный ручной разбор.", ephemeral: true });
  }

  if (event.status === "CANCELLED") {
    return respondInteraction(interaction, { content: "Это событие уже отменено.", ephemeral: true });
  }

  let refundedCount = 0;
  let totalRefunded = 0;

  await prisma.$transaction(async (tx) => {
    const locked = await tx.rpEvent.updateMany({
      where: { id: event.id, status: { in: ["OPEN", "LIVE"] } },
      data: { status: "CANCELLED" },
    });

    if (locked.count !== 1) {
      throw new Error("EVENT_ALREADY_PROCESSED");
    }

    const activeBets = await tx.bet.findMany({
      where: { eventId: event.id, status: "ACTIVE" },
    });

    for (const bet of activeBets) {
      const updatedBet = await tx.bet.updateMany({
        where: { id: bet.id, status: "ACTIVE" },
        data: { status: "REFUNDED" },
      });

      if (updatedBet.count !== 1) continue;

      refundedCount++;
      totalRefunded += bet.amount;

      await tx.user.update({
        where: { id: bet.userId },
        data: { balance: { increment: bet.amount } },
      });

      await tx.transaction.create({
        data: {
          userId: bet.userId,
          amount: bet.amount,
          type: "EVENT_REFUND",
          comment: `Возврат ставки по отменённому событию #${event.id} "${event.title}". Причина: ${reason || "Не указана"}`,
        },
      });
    }
  });

  await updateEventMessage(event.id);

  const updatedEvent = await fullEvent(event.id);
  await publishEventCancel(updatedEvent || event, refundedCount, totalRefunded, reason);
  await deleteFacebrowserEventPost(updatedEvent || event).catch((error) => console.error("Facebrowser delete after cancel:", error.message, error.data || ""));

  await log("EVENT_CANCELLED", "⚠️ Событие отменено", `Администратор <@${interaction.user.id}> отменил событие #${event.id}.`, [
    { name: "Событие", value: event.title, inline: false },
    { name: "Причина", value: reason || "Не указана", inline: false },
    { name: "Возвращено ставок", value: String(refundedCount), inline: true },
    { name: "Сумма возврата", value: money(totalRefunded), inline: true },
  ], { channelId: interaction.channelId });

  return respondInteraction(interaction, {
    content:
      `⚠️ **Событие отменено**\n` +
      `Событие: **${event.title}**\n` +
      `Причина: **${reason || "Не указана"}**\n` +
      `Возвращено ставок: **${refundedCount}**\n` +
      `Сумма возврата: **${money(totalRefunded)}**\n` +
      `Информация опубликована в <#${RESULT_CHANNEL_ID}>`,
    ephemeral: true,
  });
}

function coinSideName(side) {
  if (side === "HEADS") return "Орёл";
  if (side === "TAILS") return "Решка";
  return side;
}

function oppositeSide(side) {
  return side === "HEADS" ? "TAILS" : "HEADS";
}

function coinflipPanel() {
  const e = embed(LS_THEME.gold)
    .setTitle("🪙 LS Bet Coinflip")
    .setDescription(
      [
        "```",
        "COINFLIP DUEL",
        "1 VS 1 • DOUBLE OR NOTHING",
        "```",
        "Создай игру, выбери сторону монеты и сумму.",
        "Второй игрок принимает игру кнопкой.",
        "Победитель забирает весь банк.",
        "",
        LS_TEXT.line,
      ].join("\n")
    );

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("coinflip_side:HEADS")
      .setLabel("🦅 Орёл")
      .setStyle(ButtonStyle.Success),

    new ButtonBuilder()
      .setCustomId("coinflip_side:TAILS")
      .setLabel("🪙 Решка")
      .setStyle(ButtonStyle.Primary)
  );

  return {
    embeds: [e],
    components: [row],
    ephemeral: true,
  };
}

function coinflipAmountModal(side) {
  const modal = new ModalBuilder()
    .setCustomId(`coinflip_modal:${side}`)
    .setTitle(`Coinflip — ${coinSideName(side)}`);

  modal.addComponents(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId("amount")
        .setLabel("Сумма игры в $")
        .setPlaceholder("Например: 500")
        .setRequired(true)
        .setStyle(TextInputStyle.Short)
    )
  );

  return modal;
}

function coinflipEmbed(game) {
  const color =
    game.status === "WAITING"
      ? LS_THEME.gold
      : game.status === "CANCELLED"
      ? LS_THEME.red
      : LS_THEME.green;

  const statusText =
    game.status === "WAITING"
      ? "⏳ Ожидает второго игрока"
      : game.status === "CANCELLED"
      ? "❌ Игра отменена"
      : "🏁 Игра завершена";

  const e = embed(color)
    .setTitle(`🪙 COINFLIP #${game.id}`)
    .setDescription(
      [
        "```",
        "DOUBLE OR NOTHING",
        "```",
        `**Создатель:** <@${game.creator.discordId}>`,
        `**Ставка:** ${money(game.amount)}`,
        `**Банк:** ${money(game.amount * 2)}`,
        `**Сторона создателя:** ${coinSideName(game.creatorSide)}`,
        `**Статус:** ${statusText}`,
        "",
        LS_TEXT.line,
      ].join("\n")
    );

  if (game.status === "FINISHED") {
    e.addFields(
      {
        name: "Выпало",
        value: coinSideName(game.resultSide),
        inline: true,
      },
      {
        name: "Победитель",
        value: game.winner ? `<@${game.winner.discordId}>` : "Не найден",
        inline: true,
      },
      {
        name: "Выигрыш",
        value: money(game.amount * 2),
        inline: true,
      }
    );
  }

  return e;
}

function coinflipButtons(game) {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`coinflip_accept:${game.id}`)
        .setLabel("✅ Принять игру")
        .setStyle(ButtonStyle.Success)
        .setDisabled(game.status !== "WAITING"),

      new ButtonBuilder()
        .setCustomId(`coinflip_cancel:${game.id}`)
        .setLabel("❌ Отменить")
        .setStyle(ButtonStyle.Danger)
        .setDisabled(game.status !== "WAITING")
    ),
  ];
}

async function getCoinflipGame(gameId) {
  return prisma.coinflipGame.findUnique({
    where: {
      id: gameId,
    },
    include: {
      creator: true,
      opponent: true,
      winner: true,
    },
  });
}

async function createCoinflipGame(interaction, side, amount) {
  if (interaction.channelId !== COINFLIP_CHANNEL_ID) {
    return respondInteraction(interaction, {
      content: `🪙 Coinflip можно создавать только в канале <#${COINFLIP_CHANNEL_ID}>.`,
      ephemeral: true,
    });
  }

  if (!Number.isInteger(amount) || amount <= 0) {
    return respondInteraction(interaction, {
      content: "Введи корректную сумму.",
      ephemeral: true,
    });
  }

  const user = await userOf(interaction.user);

  let game;
  try {
    game = await prisma.$transaction(async (tx) => {
      await decrementBalanceOrThrow(tx, user.id, amount);

    await tx.transaction.create({
      data: {
        userId: user.id,
        amount: -amount,
        type: "COINFLIP_CREATE",
        comment: `Создание Coinflip на ${coinSideName(side)}`,
      },
    });

      await addJackpotContribution(tx, user.id, "COINFLIP_CREATE", null, amount);

      return tx.coinflipGame.create({
        data: {
          creatorUserId: user.id,
          amount,
          creatorSide: side,
          opponentSide: oppositeSide(side),
          status: "WAITING",
          channelId: interaction.channelId,
        },
        include: {
          creator: true,
          opponent: true,
          winner: true,
        },
      });
    });
  } catch (error) {
    if (isInsufficientBalance(error)) {
      const freshUser = await prisma.user.findUnique({ where: { id: user.id } });
      return respondInteraction(interaction, {
        content: `Недостаточно средств. Твой баланс: **${money(freshUser?.balance || 0)}**.`,
        ephemeral: true,
      });
    }
    throw error;
  }

  const message = await interaction.channel.send({
    content: "🪙 **Новая игра Coinflip**",
    embeds: [coinflipEmbed(game)],
    components: coinflipButtons(game),
  });

  await prisma.coinflipGame.update({
    where: {
      id: game.id,
    },
    data: {
      messageId: message.id,
    },
  });

  await log("COINFLIP_CREATE", "🪙 Coinflip создан", `Игрок <@${interaction.user.id}> создал Coinflip #${game.id}.`, [
    { name: "Сторона", value: coinSideName(side), inline: true },
    { name: "Ставка", value: money(amount), inline: true },
    { name: "Банк", value: money(amount * 2), inline: true },
    { name: "Канал", value: `<#${interaction.channelId}>`, inline: true },
  ], { userId: user.id, channelId: interaction.channelId });

  return respondInteraction(interaction, {
    content: `✅ Coinflip создан на сумму **${money(amount)}**.`,
    ephemeral: true,
  });
}

async function updateCoinflipMessage(gameId) {
  const game = await getCoinflipGame(gameId);

  if (!game || !game.channelId || !game.messageId) return;

  try {
    const channel = await client.channels.fetch(game.channelId);
    const message = await channel.messages.fetch(game.messageId);

    await message.edit({
      content:
        game.status === "FINISHED"
          ? "🏁 **Coinflip завершён**"
          : game.status === "CANCELLED"
          ? "❌ **Coinflip отменён**"
          : "🪙 **Новая игра Coinflip**",
      embeds: [coinflipEmbed(game)],
      components: game.status === "WAITING" ? coinflipButtons(game) : [],
    });
  } catch (error) {
    console.error("Не смог обновить Coinflip:", error.message);
  }
}

async function acceptCoinflip(interaction, gameId) {
  const game = await getCoinflipGame(gameId);

  if (!game) {
    return respondInteraction(interaction, {
      content: "Coinflip не найден.",
      ephemeral: true,
    });
  }

  if (game.status !== "WAITING") {
    return respondInteraction(interaction, {
      content: "Эта игра уже недоступна.",
      ephemeral: true,
    });
  }

  if (game.creator.discordId === interaction.user.id) {
    return respondInteraction(interaction, {
      content: "Нельзя принять свою же игру.",
      ephemeral: true,
    });
  }

  const opponent = await userOf(interaction.user);

  if (opponent.balance < game.amount) {
    return respondInteraction(interaction, {
      content: `Недостаточно средств. Твой баланс: **${money(opponent.balance)}**.`,
      ephemeral: true,
    });
  }

  const resultSide = Math.random() < 0.5 ? "HEADS" : "TAILS";
  const winnerUserId =
    resultSide === game.creatorSide ? game.creatorUserId : opponent.id;
  const winnerDiscordId =
    resultSide === game.creatorSide ? game.creator.discordId : opponent.discordId;

  const bank = game.amount * 2;

  try {
    await prisma.$transaction(async (tx) => {
      const lock = await tx.coinflipGame.updateMany({
        where: { id: game.id, status: "WAITING" },
        data: { status: "PROCESSING" },
      });

      if (lock.count !== 1) {
        const error = new Error("COINFLIP_UNAVAILABLE");
        error.code = "COINFLIP_UNAVAILABLE";
        throw error;
      }

      await decrementBalanceOrThrow(tx, opponent.id, game.amount);

      await tx.transaction.create({
        data: {
          userId: opponent.id,
          amount: -game.amount,
          type: "COINFLIP_ACCEPT",
          comment: `Принятие Coinflip #${game.id}`,
        },
      });

      await addJackpotContribution(tx, opponent.id, "COINFLIP_ACCEPT", game.id, game.amount);

      await tx.user.update({
        where: { id: winnerUserId },
        data: { balance: { increment: bank } },
      });

      await tx.transaction.create({
        data: {
          userId: winnerUserId,
          amount: bank,
          type: "COINFLIP_WIN",
          comment: `Победа в Coinflip #${game.id}. Выпало: ${coinSideName(resultSide)}`,
        },
      });

      await tx.coinflipGame.update({
        where: { id: game.id },
        data: {
          opponentUserId: opponent.id,
          winnerUserId,
          resultSide,
          opponentSide: oppositeSide(game.creatorSide),
          status: "FINISHED",
          finishedAt: new Date(),
        },
      });
    });
  } catch (error) {
    if (error?.code === "COINFLIP_UNAVAILABLE") {
      return respondInteraction(interaction, { content: "Эта игра уже недоступна.", ephemeral: true });
    }

    if (isInsufficientBalance(error)) {
      const freshOpponent = await prisma.user.findUnique({ where: { id: opponent.id } });
      return respondInteraction(interaction, {
        content: `Недостаточно средств. Твой баланс: **${money(freshOpponent?.balance || 0)}**.`,
        ephemeral: true,
      });
    }

    throw error;
  }

  await updateCoinflipMessage(game.id);
  await maybeFinishJackpotWar();

  await log("COINFLIP_WIN", "🏆 Coinflip завершён", `Coinflip #${game.id} принят и завершён.`, [
    { name: "Создатель", value: `<@${game.creator.discordId}>`, inline: true },
    { name: "Оппонент", value: `<@${interaction.user.id}>`, inline: true },
    { name: "Выпало", value: coinSideName(resultSide), inline: true },
    { name: "Победитель", value: `<@${winnerDiscordId}>`, inline: true },
    { name: "Банк", value: money(bank), inline: true },
  ], { userId: winnerUserId, channelId: interaction.channelId });

  return respondInteraction(interaction, {
    content:
      `🏁 **Coinflip завершён**\n` +
      `Выпало: **${coinSideName(resultSide)}**\n` +
      `Победитель: <@${winnerDiscordId}>\n` +
      `Выигрыш: **${money(bank)}**`,
  });
}

async function cancelCoinflip(interaction, gameId) {
  const game = await getCoinflipGame(gameId);

  if (!game) {
    return respondInteraction(interaction, {
      content: "Coinflip не найден.",
      ephemeral: true,
    });
  }

  if (game.status !== "WAITING") {
    return respondInteraction(interaction, {
      content: "Эту игру уже нельзя отменить.",
      ephemeral: true,
    });
  }

  const isOwner = game.creator.discordId === interaction.user.id;
  const isModerator = isAdmin(interaction);

  if (!isOwner && !isModerator) {
    return respondInteraction(interaction, {
      content: "Отменить Coinflip может только создатель или модератор.",
      ephemeral: true,
    });
  }

  const cancelled = await prisma.$transaction(async (tx) => {
    const lock = await tx.coinflipGame.updateMany({
      where: { id: game.id, status: "WAITING" },
      data: { status: "CANCELLED", finishedAt: new Date() },
    });

    if (lock.count !== 1) return false;

    await tx.user.update({
      where: { id: game.creatorUserId },
      data: { balance: { increment: game.amount } },
    });

    await tx.transaction.create({
      data: {
        userId: game.creatorUserId,
        amount: game.amount,
        type: "COINFLIP_REFUND",
        comment: `Возврат за отмену Coinflip #${game.id}`,
      },
    });

    return true;
  });

  if (!cancelled) {
    return respondInteraction(interaction, { content: "Эту игру уже нельзя отменить.", ephemeral: true });
  }

  await updateCoinflipMessage(game.id);

  await log("COINFLIP_CANCELLED", "❌ Coinflip отменён", `Coinflip #${game.id} отменил <@${interaction.user.id}>.`, [
    { name: "Создатель", value: `<@${game.creator.discordId}>`, inline: true },
    { name: "Возврат", value: money(game.amount), inline: true },
  ], { userId: game.creatorUserId, channelId: interaction.channelId });

  return respondInteraction(interaction, {
    content: `❌ Coinflip #${game.id} отменён. Создателю возвращено **${money(
      game.amount
    )}**.`,
    ephemeral: true,
  });
}

function promoModal() {
  const modal = new ModalBuilder()
    .setCustomId("promo_activate_modal")
    .setTitle("LS Bet — активация промокода");

  modal.addComponents(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId("code")
        .setLabel("Промокод")
        .setPlaceholder("Например: START")
        .setRequired(true)
        .setStyle(TextInputStyle.Short)
    )
  );

  return modal;
}

function promoCreateModal() {
  const modal = new ModalBuilder()
    .setCustomId("promo_create_modal")
    .setTitle("LS Bet — обычный промокод");

  modal.addComponents(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId("code")
        .setLabel("Код")
        .setPlaceholder("Например: START")
        .setRequired(true)
        .setStyle(TextInputStyle.Short)
    ),

    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId("amount")
        .setLabel("Сумма выдачи в $")
        .setPlaceholder("Например: 100")
        .setRequired(true)
        .setStyle(TextInputStyle.Short)
    ),

    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId("maxUses")
        .setLabel("Лимит активаций")
        .setPlaceholder("Например: 30. Можно оставить пустым.")
        .setRequired(false)
        .setStyle(TextInputStyle.Short)
    )
  );

  return modal;
}

function referralPromoCreateModal() {
  const modal = new ModalBuilder()
    .setCustomId("promo_create_referral_modal")
    .setTitle("LS Bet — реферальный промокод");

  modal.addComponents(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId("code")
        .setLabel("Код")
        .setPlaceholder("Например: AILANI")
        .setRequired(true)
        .setStyle(TextInputStyle.Short)
    ),

    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId("ownerDiscordId")
        .setLabel("Discord ID владельца")
        .setRequired(true)
        .setStyle(TextInputStyle.Short)
    ),

    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId("amount")
        .setLabel("Бонус новому игроку в $")
        .setPlaceholder("Например: 100")
        .setRequired(true)
        .setStyle(TextInputStyle.Short)
    ),

    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId("refPercent")
        .setLabel("Процент рефереру от 1 до 100")
        .setPlaceholder("Например: 5")
        .setRequired(true)
        .setStyle(TextInputStyle.Short)
    ),

    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId("maxUses")
        .setLabel("Лимит активаций")
        .setPlaceholder("Например: 30. Можно оставить пустым.")
        .setRequired(false)
        .setStyle(TextInputStyle.Short)
    )
  );

  return modal;
}

function promoEditModal() {
  const modal = new ModalBuilder()
    .setCustomId("promo_edit_modal")
    .setTitle("LS Bet — изменить промокод");

  modal.addComponents(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId("code")
        .setLabel("Какой промокод изменить?")
        .setRequired(true)
        .setStyle(TextInputStyle.Short)
    ),

    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId("amount")
        .setLabel("Новая сумма бонуса")
        .setPlaceholder("Пусто = не менять")
        .setRequired(false)
        .setStyle(TextInputStyle.Short)
    ),

    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId("maxUses")
        .setLabel("Новый лимит активаций")
        .setPlaceholder("Пусто = не менять. 0 = без лимита")
        .setRequired(false)
        .setStyle(TextInputStyle.Short)
    ),

    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId("active")
        .setLabel("Статус")
        .setPlaceholder("on / off / пусто = не менять")
        .setRequired(false)
        .setStyle(TextInputStyle.Short)
    ),

    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId("referral")
        .setLabel("Рефералка")
        .setPlaceholder("ID:процент или none")
        .setRequired(false)
        .setStyle(TextInputStyle.Short)
    )
  );

  return modal;
}

function promoDeleteModal() {
  const modal = new ModalBuilder()
    .setCustomId("promo_delete_modal")
    .setTitle("LS Bet — удалить промокод");

  modal.addComponents(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId("code")
        .setLabel("Какой промокод удалить?")
        .setRequired(true)
        .setStyle(TextInputStyle.Short)
    )
  );

  return modal;
}

function adminPromoPanel() {
  const e = embed(LS_THEME.gold)
    .setTitle("🎟️ LS Bet — Промокоды")
    .setDescription(
      [
        "```",
        "PROMO CONTROL",
        "BONUS • REFERRAL • EDIT • DELETE",
        "```",
        "Создание, редактирование, удаление и статистика промокодов.",
        "",
        LS_TEXT.line,
      ].join("\n")
    );

  const r1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("promo_create")
      .setLabel("➕ Обычный")
      .setStyle(ButtonStyle.Success),

    new ButtonBuilder()
      .setCustomId("promo_create_referral")
      .setLabel("🤝 Реферальный")
      .setStyle(ButtonStyle.Primary),

    new ButtonBuilder()
      .setCustomId("promo_edit")
      .setLabel("✏️ Изменить")
      .setStyle(ButtonStyle.Secondary),

    new ButtonBuilder()
      .setCustomId("promo_delete")
      .setLabel("🗑️ Удалить")
      .setStyle(ButtonStyle.Danger)
  );

  const r2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("promo_stats")
      .setLabel("📊 Промокоды")
      .setStyle(ButtonStyle.Secondary),

    new ButtonBuilder()
      .setCustomId("referral_stats")
      .setLabel("📈 Рефералы")
      .setStyle(ButtonStyle.Secondary)
  );

  return {
    embeds: [e],
    components: [r1, r2],
    ephemeral: true,
  };
}

function parseActiveValue(value) {
  const raw = String(value || "").trim().toLowerCase();

  if (!raw) return null;

  if (["on", "true", "yes", "1", "вкл", "активен"].includes(raw)) {
    return true;
  }

  if (["off", "false", "no", "0", "выкл", "выключен"].includes(raw)) {
    return false;
  }

  return "INVALID";
}

async function createPromoCode(interaction, codeRaw, amount, maxUsesRaw) {
  if (await adminOnly(interaction)) return;

  const code = codeRaw.trim().toUpperCase();
  const maxUses =
    maxUsesRaw && String(maxUsesRaw).trim() !== ""
      ? Number(maxUsesRaw)
      : null;

  if (!code || code.length < 3) {
    return respondInteraction(interaction, {
      content: "Код должен быть минимум 3 символа.",
      ephemeral: true,
    });
  }

  if (!Number.isInteger(amount) || amount <= 0) {
    return respondInteraction(interaction, {
      content: "Введи корректную сумму промокода.",
      ephemeral: true,
    });
  }

  if (maxUses !== null && (!Number.isInteger(maxUses) || maxUses <= 0)) {
    return respondInteraction(interaction, {
      content: "Лимит активаций должен быть числом больше 0.",
      ephemeral: true,
    });
  }

  try {
    const promo = await prisma.promoCode.create({
      data: {
        code,
        amount,
        maxUses,
        createdBy: interaction.user.id,
        isActive: true,
        type: "BONUS",
      },
    });

    await log("PROMO_CREATED", "🎟️ Создан промокод", `Администратор <@${interaction.user.id}> создал обычный промокод.`, [
      { name: "Код", value: promo.code, inline: true },
      { name: "Сумма", value: money(amount), inline: true },
      { name: "Лимит", value: maxUses ? String(maxUses) : "Без лимита", inline: true },
    ], { channelId: interaction.channelId });

    return respondInteraction(interaction, {
      content: `✅ Обычный промокод **${promo.code}** создан. Сумма: **${money(
        amount
      )}**.`,
      ephemeral: true,
    });
  } catch (error) {
    return respondInteraction(interaction, {
      content: "Такой промокод уже существует.",
      ephemeral: true,
    });
  }
}

async function createReferralPromoCode(
  interaction,
  codeRaw,
  ownerDiscordIdRaw,
  amount,
  refPercentRaw,
  maxUsesRaw
) {
  if (await adminOnly(interaction)) return;

  const code = codeRaw.trim().toUpperCase();
  const ownerDiscordId = ownerDiscordIdRaw.trim();
  const refPercent = Number(refPercentRaw);

  const maxUses =
    maxUsesRaw && String(maxUsesRaw).trim() !== ""
      ? Number(maxUsesRaw)
      : null;

  if (!code || code.length < 3) {
    return respondInteraction(interaction, {
      content: "Код должен быть минимум 3 символа.",
      ephemeral: true,
    });
  }

  if (!ownerDiscordId || !/^\d+$/.test(ownerDiscordId)) {
    return respondInteraction(interaction, {
      content: "Введи корректный Discord ID владельца.",
      ephemeral: true,
    });
  }

  if (!Number.isInteger(amount) || amount < 0) {
    return respondInteraction(interaction, {
      content: "Бонус новому игроку должен быть числом 0 или больше.",
      ephemeral: true,
    });
  }

  if (!Number.isInteger(refPercent) || refPercent < 1 || refPercent > 100) {
    return respondInteraction(interaction, {
      content: "Процент рефереру должен быть от 1 до 100.",
      ephemeral: true,
    });
  }

  if (maxUses !== null && (!Number.isInteger(maxUses) || maxUses <= 0)) {
    return respondInteraction(interaction, {
      content: "Лимит активаций должен быть числом больше 0.",
      ephemeral: true,
    });
  }

  const ownerDiscordUser = await client.users
    .fetch(ownerDiscordId)
    .catch(() => null);

  if (!ownerDiscordUser) {
    return respondInteraction(interaction, {
      content: "Не смог найти пользователя Discord по этому ID.",
      ephemeral: true,
    });
  }

  const ownerUser = await userOf(ownerDiscordUser);

  try {
    const promo = await prisma.promoCode.create({
      data: {
        code,
        amount,
        maxUses,
        createdBy: interaction.user.id,
        isActive: true,
        type: "REFERRAL",
        ownerUserId: ownerUser.id,
        refPercent,
      },
    });

    return respondInteraction(interaction, {
      content:
        `✅ Реферальный промокод **${promo.code}** создан.\n` +
        `Владелец: <@${ownerDiscordId}>\n` +
        `Бонус новому игроку: **${money(amount)}**\n` +
        `Процент с пополнений: **${refPercent}%**`,
      ephemeral: true,
    });
  } catch (error) {
    return respondInteraction(interaction, {
      content: "Такой промокод уже существует.",
      ephemeral: true,
    });
  }
}
async function editPromoCode(
  interaction,
  codeRaw,
  amountRaw,
  maxUsesRaw,
  activeRaw,
  referralRaw
) {
  if (await adminOnly(interaction)) return;

  const code = codeRaw.trim().toUpperCase();

  const promo = await prisma.promoCode.findUnique({
    where: {
      code,
    },
    include: {
      owner: true,
    },
  });

  if (!promo) {
    return respondInteraction(interaction, {
      content: `❌ Промокод **${code}** не найден.`,
      ephemeral: true,
    });
  }

  const data = {};
  const changes = [];

  if (String(amountRaw || "").trim() !== "") {
    const amount = Number(amountRaw);

    if (!Number.isInteger(amount) || amount < 0) {
      return respondInteraction(interaction, {
        content: "❌ Сумма бонуса должна быть числом 0 или больше.",
        ephemeral: true,
      });
    }

    data.amount = amount;
    changes.push(`Бонус: **${money(promo.amount)} → ${money(amount)}**`);
  }

  if (String(maxUsesRaw || "").trim() !== "") {
    const maxUses = Number(maxUsesRaw);

    if (!Number.isInteger(maxUses) || maxUses < 0) {
      return respondInteraction(interaction, {
        content: "❌ Лимит активаций должен быть числом 0 или больше.",
        ephemeral: true,
      });
    }

    data.maxUses = maxUses === 0 ? null : maxUses;

    changes.push(
      `Лимит: **${promo.maxUses ? promo.maxUses : "без лимита"} → ${
        data.maxUses ? data.maxUses : "без лимита"
      }**`
    );
  }

  if (String(activeRaw || "").trim() !== "") {
    const activeValue = parseActiveValue(activeRaw);

    if (activeValue === "INVALID") {
      return respondInteraction(interaction, {
        content: "❌ Статус укажи так: `on` или `off`.",
        ephemeral: true,
      });
    }

    data.isActive = activeValue;

    changes.push(
      `Статус: **${promo.isActive ? "активен" : "выключен"} → ${
        activeValue ? "активен" : "выключен"
      }**`
    );
  }

  if (String(referralRaw || "").trim() !== "") {
    const referralValue = referralRaw.trim();
    const normalized = referralValue.toLowerCase();

    if (["none", "bonus", "обычный", "нет", "remove"].includes(normalized)) {
      data.type = "BONUS";
      data.ownerUserId = null;
      data.refPercent = null;

      changes.push("Тип: **реферальный → обычный**");
    } else {
      const cleanReferral = referralValue.replace(/[<@!>]/g, "");
      const [ownerDiscordIdRaw, percentRaw] = cleanReferral.split(":");

      const ownerDiscordId = String(ownerDiscordIdRaw || "").trim();

      const refPercent =
        percentRaw && String(percentRaw).trim() !== ""
          ? Number(percentRaw)
          : promo.refPercent || 5;

      if (!ownerDiscordId || !/^\d+$/.test(ownerDiscordId)) {
        return respondInteraction(interaction, {
          content:
            "❌ Рефералку укажи в формате:\n" +
            "`DiscordID:процент`\n\n" +
            "Пример:\n" +
            "`123456789012345678:5`\n\n" +
            "Чтобы сделать обычный промокод, напиши:\n" +
            "`none`",
          ephemeral: true,
        });
      }

      if (!Number.isInteger(refPercent) || refPercent < 1 || refPercent > 100) {
        return respondInteraction(interaction, {
          content: "❌ Процент рефералки должен быть от 1 до 100.",
          ephemeral: true,
        });
      }

      const ownerDiscordUser = await client.users
        .fetch(ownerDiscordId)
        .catch(() => null);

      if (!ownerDiscordUser) {
        return respondInteraction(interaction, {
          content: "❌ Не смог найти пользователя Discord по этому ID.",
          ephemeral: true,
        });
      }

      const ownerUser = await userOf(ownerDiscordUser);

      data.type = "REFERRAL";
      data.ownerUserId = ownerUser.id;
      data.refPercent = refPercent;

      changes.push(
        `Рефералка: **владелец <@${ownerDiscordId}>, процент ${refPercent}%**`
      );
    }
  }

  if (Object.keys(data).length === 0) {
    return respondInteraction(interaction, {
      content:
        "Ты не указал, что изменить.\n\n" +
        "Заполни хотя бы одно поле: сумма, лимит, статус или рефералка.",
      ephemeral: true,
    });
  }

  const updatedPromo = await prisma.promoCode.update({
    where: {
      id: promo.id,
    },
    data,
    include: {
      owner: true,
    },
  });

  return respondInteraction(interaction, {
    content:
      `✅ Промокод **${updatedPromo.code}** изменён.\n\n` +
      changes.join("\n"),
    ephemeral: true,
  });
}

async function deletePromoCode(interaction, codeRaw) {
  if (await adminOnly(interaction)) return;

  const code = codeRaw.trim().toUpperCase();

  const promo = await prisma.promoCode.findUnique({
    where: {
      code,
    },
    include: {
      activations: true,
      owner: true,
    },
  });

  if (!promo) {
    return respondInteraction(interaction, {
      content: `❌ Промокод **${code}** не найден.`,
      ephemeral: true,
    });
  }

  const activationsCount = promo.activations.length;

  await prisma.$transaction(async (tx) => {
    await tx.promoActivation.deleteMany({
      where: {
        promoCodeId: promo.id,
      },
    });

    await tx.promoCode.delete({
      where: {
        id: promo.id,
      },
    });
  });

  return respondInteraction(interaction, {
    content:
      `🗑️ Промокод **${promo.code}** удалён.\n` +
      `Удалено активаций: **${activationsCount}**.`,
    ephemeral: true,
  });
}

async function showPromoStats(interaction) {
  if (await adminOnly(interaction)) return;

  const promos = await prisma.promoCode.findMany({
    orderBy: {
      id: "desc",
    },
    take: 10,
    include: {
      activations: true,
      owner: true,
    },
  });

  if (promos.length === 0) {
    return respondInteraction(interaction, {
      content: "Промокодов пока нет.",
      ephemeral: true,
    });
  }

  const text = promos
    .map((promo) => {
      const totalIssued = promo.activations.reduce(
        (sum, activation) => sum + activation.amount,
        0
      );

      return [
        `${promo.type === "REFERRAL" ? "🤝" : "🎟️"} **${promo.code}**`,
        `Тип: **${promo.type === "REFERRAL" ? "Реферальный" : "Обычный"}**`,
        promo.type === "REFERRAL" && promo.owner
          ? `Владелец: <@${promo.owner.discordId}>`
          : null,
        promo.type === "REFERRAL"
          ? `Процент: **${promo.refPercent || 5}%**`
          : null,
        `Бонус игроку: **${money(promo.amount)}**`,
        `Использований: **${promo.usesCount}${
          promo.maxUses ? ` / ${promo.maxUses}` : ""
        }**`,
        `Выдано всего: **${money(totalIssued)}**`,
        `Статус: **${promo.isActive ? "Активен" : "Выключен"}**`,
      ]
        .filter(Boolean)
        .join("\n");
    })
    .join("\n\n");

  const e = embed(LS_THEME.gold)
    .setTitle("📊 Статистика промокодов")
    .setDescription(text.slice(0, 4000));

  return respondInteraction(interaction, {
    embeds: [e],
    ephemeral: true,
  });
}

async function showReferralStats(interaction) {
  if (await adminOnly(interaction)) return;

  const referralPromos = await prisma.promoCode.findMany({
    where: {
      type: "REFERRAL",
    },
    orderBy: {
      id: "desc",
    },
    take: 10,
    include: {
      owner: {
        include: {
          referrals: true,
          referralRewardsReceived: true,
        },
      },
      activations: true,
    },
  });

  if (referralPromos.length === 0) {
    return respondInteraction(interaction, {
      content: "Реферальных промокодов пока нет.",
      ephemeral: true,
    });
  }

  const text = referralPromos
    .map((promo) => {
      const owner = promo.owner;

      const referralsCount = owner?.referrals?.length || 0;

      const totalEarned =
        owner?.referralRewardsReceived?.reduce((sum, item) => {
          return sum + item.amount;
        }, 0) || 0;

      const totalTopups =
        owner?.referralRewardsReceived?.reduce((sum, item) => {
          return sum + item.sourceAmount;
        }, 0) || 0;

      return [
        `🤝 **${promo.code}**`,
        `Владелец: ${owner ? `<@${owner.discordId}>` : "Не найден"}`,
        `Бонус новому игроку: **${money(promo.amount)}**`,
        `Процент: **${promo.refPercent || 5}%**`,
        `Активаций: **${promo.usesCount}${
          promo.maxUses ? ` / ${promo.maxUses}` : ""
        }**`,
        `Рефералов у владельца: **${referralsCount}**`,
        `Пополнений рефералов: **${money(totalTopups)}**`,
        `Заработано владельцем: **${money(totalEarned)}**`,
      ].join("\n");
    })
    .join("\n\n");

  const e = embed(LS_THEME.gold)
    .setTitle("📈 Статистика рефералов")
    .setDescription(text.slice(0, 4000));

  return respondInteraction(interaction, {
    embeds: [e],
    ephemeral: true,
  });
}

async function activatePromoCode(interaction, codeRaw) {
  const member = interaction.member;

  if (!member?.joinedTimestamp) {
    return respondInteraction(interaction, {
      content:
        "Не удалось проверить дату входа на сервер. Проверь, что включён Server Members Intent.",
      ephemeral: true,
    });
  }

  const joinedAt = member.joinedTimestamp;
  const maxAgeMs = PROMO_NEW_USER_DAYS * 24 * 60 * 60 * 1000;

  if (Date.now() - joinedAt > maxAgeMs) {
    return respondInteraction(interaction, {
      content: `⛔ Этот промокод доступен только новым пользователям, которые зашли на сервер за последние ${PROMO_NEW_USER_DAYS} дня.`,
      ephemeral: true,
    });
  }

  const code = codeRaw.trim().toUpperCase();
  const user = await userOf(interaction.user);

  const promo = await prisma.promoCode.findUnique({
    where: {
      code,
    },
    include: {
      owner: true,
    },
  });

  if (!promo || !promo.isActive) {
    return respondInteraction(interaction, {
      content: "Промокод не найден или уже выключен.",
      ephemeral: true,
    });
  }

  if (promo.maxUses && promo.usesCount >= promo.maxUses) {
    return respondInteraction(interaction, {
      content: "Лимит активаций этого промокода уже закончился.",
      ephemeral: true,
    });
  }

  const alreadyUsed = await prisma.promoActivation.findFirst({
    where: {
      promoCodeId: promo.id,
      userId: user.id,
    },
  });

  if (alreadyUsed) {
    return respondInteraction(interaction, {
      content: "Ты уже активировал этот промокод.",
      ephemeral: true,
    });
  }

  if (promo.type === "REFERRAL") {
    if (!promo.ownerUserId || !promo.owner) {
      return respondInteraction(interaction, {
        content: "У этого реферального промокода не найден владелец.",
        ephemeral: true,
      });
    }

    if (promo.ownerUserId === user.id) {
      return respondInteraction(interaction, {
        content: "Нельзя активировать свой собственный реферальный промокод.",
        ephemeral: true,
      });
    }

    if (user.referredByUserId && user.referredByUserId !== promo.ownerUserId) {
      return respondInteraction(interaction, {
        content: "За тобой уже закреплён другой реферер. Сменить его нельзя.",
        ephemeral: true,
      });
    }
  }

  await prisma.$transaction(async (tx) => {
    if (promo.amount > 0) {
      await tx.user.update({
        where: {
          id: user.id,
        },
        data: {
          balance: {
            increment: promo.amount,
          },
        },
      });

      await tx.transaction.create({
        data: {
          userId: user.id,
          amount: promo.amount,
          type: "PROMO_ACTIVATED",
          comment: `Активация промокода ${promo.code}`,
        },
      });
    }

    if (promo.type === "REFERRAL") {
      await tx.user.update({
        where: {
          id: user.id,
        },
        data: {
          referredByUserId: promo.ownerUserId,
          refPercent: promo.refPercent || 5,
        },
      });
    }

    await tx.promoCode.update({
      where: {
        id: promo.id,
      },
      data: {
        usesCount: {
          increment: 1,
        },
      },
    });

    await tx.promoActivation.create({
      data: {
        promoCodeId: promo.id,
        userId: user.id,
        amount: promo.amount,
      },
    });
  });

  await log("PROMO_ACTIVATED", "🎁 Промокод активирован", `Игрок <@${interaction.user.id}> активировал промокод **${promo.code}**.`, [
    { name: "Код", value: promo.code, inline: true },
    { name: "Тип", value: promo.type || "BONUS", inline: true },
    { name: "Сумма", value: money(promo.amount), inline: true },
    ...(promo.type === "REFERRAL" && promo.owner ? [{ name: "Реферер", value: `<@${promo.owner.discordId}>`, inline: true }] : []),
  ], { userId: user.id, channelId: interaction.channelId });

  return respondInteraction(interaction, {
    content:
      promo.type === "REFERRAL"
        ? `✅ Реферальный промокод **${promo.code}** активирован.\nТы получил **${money(
            promo.amount
          )}**.\nТвой реферер: <@${promo.owner.discordId}>.`
        : `✅ Промокод **${promo.code}** активирован. Начислено **${money(
            promo.amount
          )}**.`,
    ephemeral: true,
  });
}

function numbersToString(numbers) {
  return numbers.join(",");
}

function stringToNumbers(value) {
  return String(value || "")
    .split(",")
    .map((n) => Number(n.trim()))
    .filter((n) => Number.isInteger(n));
}

function formatLotteryNumbers(value) {
  const numbers = Array.isArray(value) ? value : stringToNumbers(value);
  return numbers.map((n) => `**${n}**`).join(" • ");
}

function generateLotteryNumbers() {
  const numbers = [];

  while (numbers.length < LOTTERY_NUMBERS_COUNT) {
    const number =
      Math.floor(Math.random() * (LOTTERY_MAX_NUMBER - LOTTERY_MIN_NUMBER + 1)) +
      LOTTERY_MIN_NUMBER;

    if (!numbers.includes(number)) {
      numbers.push(number);
    }
  }

  return numbers.sort((a, b) => a - b);
}

function parseLotteryNumbers(raw) {
  const numbers = String(raw || "")
    .replace(/[;,]/g, " ")
    .split(/\s+/)
    .map((n) => Number(n.trim()))
    .filter((n) => Number.isInteger(n));

  const unique = [...new Set(numbers)].sort((a, b) => a - b);

  if (unique.length !== LOTTERY_NUMBERS_COUNT) {
    return {
      ok: false,
      error: `Нужно указать ровно ${LOTTERY_NUMBERS_COUNT} разных чисел.`,
    };
  }

  const invalid = unique.find(
    (n) => n < LOTTERY_MIN_NUMBER || n > LOTTERY_MAX_NUMBER
  );

  if (invalid) {
    return {
      ok: false,
      error: `Числа должны быть от ${LOTTERY_MIN_NUMBER} до ${LOTTERY_MAX_NUMBER}.`,
    };
  }

  return {
    ok: true,
    numbers: unique,
  };
}

function calculateLotteryPrize(matches, price) {
  if (matches === 5) return price * 25;
  if (matches === 4) return price * 5;
  if (matches === 3) return price * 2;
  return 0;
}

function countMatches(ticketNumbers, resultNumbers) {
  return ticketNumbers.filter((n) => resultNumbers.includes(n)).length;
}

function lotteryPanel() {
  const e = embed(LS_THEME.gold)
    .setTitle("🎫 LS BET LOTTERY")
    .setDescription(
      [
        "```",
        "5 NUMBERS LOTTERY",
        "```",
        `Выбери **${LOTTERY_NUMBERS_COUNT} чисел** от **${LOTTERY_MIN_NUMBER}** до **${LOTTERY_MAX_NUMBER}**.`,
        `Цена билета: **${money(LOTTERY_TICKET_PRICE)}**`,
        "",
        "**Выплаты:**",
        `5 совпадений — x25 = **${money(LOTTERY_TICKET_PRICE * 25)}**`,
        `4 совпадения — x5 = **${money(LOTTERY_TICKET_PRICE * 5)}**`,
        `3 совпадения — x2 = **${money(LOTTERY_TICKET_PRICE * 2)}**`,
        `0-2 совпадения — без выигрыша`,
        "",
        `Максимум активных билетов на игрока: **${LOTTERY_MAX_TICKETS_PER_DRAW}**`,
        LS_TEXT.line,
      ].join("\n")
    );

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("lottery_random")
      .setLabel("🎲 Случайный билет")
      .setStyle(ButtonStyle.Success),

    new ButtonBuilder()
      .setCustomId("lottery_custom")
      .setLabel("✍️ Свои числа")
      .setStyle(ButtonStyle.Primary),

    new ButtonBuilder()
      .setCustomId("lottery_mine")
      .setLabel("🧾 Мои билеты")
      .setStyle(ButtonStyle.Secondary),

    new ButtonBuilder()
      .setCustomId("lottery_last")
      .setLabel("🏆 Последний розыгрыш")
      .setStyle(ButtonStyle.Secondary)
  );

  return {
    embeds: [e],
    components: [row],
    ephemeral: true,
  };
}

function lotteryCustomModal() {
  const modal = new ModalBuilder()
    .setCustomId("lottery_custom_modal")
    .setTitle("LS Bet Lottery — свои числа");

  modal.addComponents(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId("numbers")
        .setLabel("Введи 5 чисел от 1 до 36")
        .setPlaceholder("Например: 5 12 18 24 33")
        .setRequired(true)
        .setStyle(TextInputStyle.Short)
    )
  );

  return modal;
}

async function buyLotteryTicket(interaction, numbers) {
  const send = async (payload) => {
    if (interaction.deferred || interaction.replied) {
      return interaction.editReply(payload);
    }

    return respondInteraction(interaction, {
      ...payload,
      ephemeral: true,
    });
  };

  const user = await userOf(interaction.user);

  let ticket;
  try {
    ticket = await prisma.$transaction(async (tx) => {
      const activeCount = await tx.lotteryTicket.count({
        where: { userId: user.id, status: "ACTIVE" },
      });

      if (activeCount >= LOTTERY_MAX_TICKETS_PER_DRAW) {
        const error = new Error("LOTTERY_LIMIT");
        error.code = "LOTTERY_LIMIT";
        throw error;
      }

      await decrementBalanceOrThrow(tx, user.id, LOTTERY_TICKET_PRICE);

      const createdTicket = await tx.lotteryTicket.create({
      data: {
        userId: user.id,
        numbers: numbersToString(numbers),
        price: LOTTERY_TICKET_PRICE,
        status: "ACTIVE",
      },
    });

    await tx.transaction.create({
      data: {
        userId: user.id,
        amount: -LOTTERY_TICKET_PRICE,
        type: "LOTTERY_TICKET",
        comment: `Покупка билета лотереи #${createdTicket.id}. Числа: ${numbers.join(
          ", "
        )}`,
      },
    });

      await addJackpotContribution(tx, user.id, "LOTTERY_TICKET", createdTicket.id, LOTTERY_TICKET_PRICE);

      return createdTicket;
    });
  } catch (error) {
    if (error?.code === "LOTTERY_LIMIT") {
      return send({ content: `⛔ У тебя уже максимум активных билетов: **${LOTTERY_MAX_TICKETS_PER_DRAW}**.` });
    }

    if (isInsufficientBalance(error)) {
      const freshUser = await prisma.user.findUnique({ where: { id: user.id } });
      return send({ content: `Недостаточно средств. Твой баланс: **${money(freshUser?.balance || 0)}**.` });
    }

    throw error;
  }

  await maybeFinishJackpotWar();

  return send({
    content:
      `✅ **Билет куплен**\n\n` +
      `Билет: **#${ticket.id}**\n` +
      `Числа: ${formatLotteryNumbers(numbers)}\n` +
      `Цена: **${money(LOTTERY_TICKET_PRICE)}**\n\n` +
      `Ожидай ближайший розыгрыш.`,
  });
}

async function showMyLotteryTickets(interaction) {
  const user = await userOf(interaction.user);

  const tickets = await prisma.lotteryTicket.findMany({
    where: {
      userId: user.id,
    },
    orderBy: {
      id: "desc",
    },
    take: 10,
  });

  if (tickets.length === 0) {
    return respondInteraction(interaction, {
      content: "У тебя пока нет билетов лотереи.",
      ephemeral: true,
    });
  }

  const text = tickets
    .map((ticket) => {
      const status =
        ticket.status === "ACTIVE"
          ? "🟢 Активен"
          : ticket.prize > 0
          ? "✅ Выигрыш"
          : "❌ Без выигрыша";

      return [
        `**Билет #${ticket.id}**`,
        `Числа: ${formatLotteryNumbers(ticket.numbers)}`,
        `Статус: ${status}`,
        ticket.status !== "ACTIVE"
          ? `Совпадений: **${ticket.matches}**`
          : null,
        ticket.status !== "ACTIVE"
          ? `Результат: ${formatLotteryNumbers(ticket.resultNumbers)}`
          : null,
        ticket.prize > 0 ? `Выигрыш: **${money(ticket.prize)}**` : null,
        `Дата: <t:${unix(ticket.createdAt)}:R>`,
      ]
        .filter(Boolean)
        .join("\n");
    })
    .join("\n\n");

  const e = embed(LS_THEME.gold)
    .setTitle("🧾 Мои билеты лотереи")
    .setDescription(text.slice(0, 4000));

  return respondInteraction(interaction, {
    embeds: [e],
    ephemeral: true,
  });
}

async function showLastLotteryDraw(interaction, adminView = false) {
  const draw = await prisma.lotteryDraw.findFirst({
    orderBy: {
      id: "desc",
    },
    include: {
      tickets: {
        include: {
          user: true,
        },
      },
    },
  });

  if (!draw) {
    return respondInteraction(interaction, {
      content: "Розыгрышей ещё не было.",
      ephemeral: true,
    });
  }

  const winners = draw.tickets.filter((ticket) => ticket.prize > 0);
  const totalPaid = winners.reduce((sum, ticket) => sum + ticket.prize, 0);

  const winnersText =
    winners.length === 0
      ? "Победителей в этом розыгрыше нет."
      : winners
          .sort((a, b) => b.prize - a.prize)
          .slice(0, 10)
          .map((ticket) => {
            return `<@${ticket.user.discordId}> — **${ticket.matches} совп.** — **${money(
              ticket.prize
            )}**`;
          })
          .join("\n");

  const e = embed(LS_THEME.gold)
    .setTitle(`🏆 Последний розыгрыш LS Lottery #${draw.id}`)
    .setDescription(
      [
        `**Выигрышные числа:** ${formatLotteryNumbers(draw.numbers)}`,
        `**Билетов участвовало:** ${draw.tickets.length}`,
        `**Победителей:** ${winners.length}`,
        `**Выплачено:** ${money(totalPaid)}`,
        "",
        "**Победители:**",
        winnersText,
      ].join("\n")
    );

  return respondInteraction(interaction, {
    embeds: [e],
    ephemeral: !adminView,
  });
}

function adminLotteryPanel() {
  const e = embed(LS_THEME.gold)
    .setTitle("🎫 LS Bet — Админ лотерея")
    .setDescription(
      [
        "```",
        "LOTTERY CONTROL",
        "```",
        "Здесь можно провести розыгрыш и посмотреть активные билеты.",
        "",
        `Канал результатов: <#${LOTTERY_CHANNEL_ID}>`,
        LS_TEXT.line,
      ].join("\n")
    );

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("lottery_draw")
      .setLabel("🎲 Провести розыгрыш")
      .setStyle(ButtonStyle.Success),

    new ButtonBuilder()
      .setCustomId("lottery_active")
      .setLabel("📊 Активные билеты")
      .setStyle(ButtonStyle.Secondary),

    new ButtonBuilder()
      .setCustomId("lottery_last_admin")
      .setLabel("🏆 Последний розыгрыш")
      .setStyle(ButtonStyle.Secondary)
  );

  return {
    embeds: [e],
    components: [row],
    ephemeral: true,
  };
}

async function showActiveLotteryTickets(interaction) {
  if (await adminOnly(interaction)) return;

  const tickets = await prisma.lotteryTicket.findMany({
    where: {
      status: "ACTIVE",
    },
    orderBy: {
      id: "asc",
    },
    take: 25,
    include: {
      user: true,
    },
  });

  if (tickets.length === 0) {
    return respondInteraction(interaction, {
      content: "Активных билетов сейчас нет.",
      ephemeral: true,
    });
  }

  const text = tickets
    .map((ticket) => {
      return `#${ticket.id} — <@${ticket.user.discordId}> — ${formatLotteryNumbers(
        ticket.numbers
      )}`;
    })
    .join("\n");

  const e = embed(LS_THEME.gold)
    .setTitle("📊 Активные билеты лотереи")
    .setDescription(text.slice(0, 4000));

  return respondInteraction(interaction, {
    embeds: [e],
    ephemeral: true,
  });
}

async function runLotteryDraw(interaction) {
  if (await adminOnly(interaction)) return;

  const tickets = await prisma.lotteryTicket.findMany({
    where: {
      status: "ACTIVE",
    },
    include: {
      user: true,
    },
  });

  if (tickets.length === 0) {
    return respondInteraction(interaction, {
      content: "Активных билетов для розыгрыша нет.",
      ephemeral: true,
    });
  }

  const resultNumbers = generateLotteryNumbers();
  const resultNumbersString = numbersToString(resultNumbers);

  let winnersCount = 0;
  let totalPaid = 0;

  let draw;
  try {
    draw = await prisma.$transaction(async (tx) => {
    const ticketIds = tickets.map((ticket) => ticket.id);
    const locked = await tx.lotteryTicket.updateMany({
      where: { id: { in: ticketIds }, status: "ACTIVE" },
      data: { status: "PROCESSING" },
    });

    if (locked.count !== ticketIds.length) {
      const error = new Error("LOTTERY_DRAW_ALREADY_RUNNING");
      error.code = "LOTTERY_DRAW_ALREADY_RUNNING";
      throw error;
    }

    const createdDraw = await tx.lotteryDraw.create({
      data: {
        numbers: resultNumbersString,
      },
    });

    for (const ticket of tickets) {
      const ticketNumbers = stringToNumbers(ticket.numbers);
      const matches = countMatches(ticketNumbers, resultNumbers);
      const prize = calculateLotteryPrize(matches, ticket.price);

      if (prize > 0) {
        winnersCount++;
        totalPaid += prize;

        await tx.user.update({
          where: {
            id: ticket.userId,
          },
          data: {
            balance: {
              increment: prize,
            },
          },
        });

        await tx.transaction.create({
          data: {
            userId: ticket.userId,
            amount: prize,
            type: "LOTTERY_WIN",
            comment: `Выигрыш по билету лотереи #${ticket.id}. Совпадений: ${matches}`,
          },
        });
      }

      await tx.lotteryTicket.update({
        where: {
          id: ticket.id,
        },
        data: {
          status: "FINISHED",
          drawId: createdDraw.id,
          resultNumbers: resultNumbersString,
          matches,
          prize,
        },
      });
    }

      return createdDraw;
    });
  } catch (error) {
    if (error?.code === "LOTTERY_DRAW_ALREADY_RUNNING") {
      return respondInteraction(interaction, {
        content: "Розыгрыш уже обрабатывается. Повторный запуск отменён.",
        ephemeral: true,
      });
    }

    throw error;
  }

  const finishedTickets = await prisma.lotteryTicket.findMany({
    where: {
      drawId: draw.id,
    },
    include: {
      user: true,
    },
  });

  const winners = finishedTickets
    .filter((ticket) => ticket.prize > 0)
    .sort((a, b) => b.prize - a.prize);

  const winnersText =
    winners.length === 0
      ? "Победителей нет."
      : winners
          .slice(0, 10)
          .map((ticket) => {
            return `<@${ticket.user.discordId}> — **${ticket.matches} совп.** — **${money(
              ticket.prize
            )}**`;
          })
          .join("\n");

  const resultEmbed = embed(LS_THEME.gold)
    .setTitle(`🏆 LS BET LOTTERY RESULT #${draw.id}`)
    .setDescription(
      [
        "```",
        "5 NUMBERS DRAW",
        "```",
        `**Выигрышные числа:** ${formatLotteryNumbers(resultNumbers)}`,
        "",
        `**Билетов участвовало:** ${tickets.length}`,
        `**Победителей:** ${winnersCount}`,
        `**Выплачено всего:** ${money(totalPaid)}`,
        "",
        "**Победители:**",
        winnersText,
      ].join("\n")
    );

  const lotteryChannel = await client.channels
    .fetch(LOTTERY_CHANNEL_ID)
    .catch(() => null);

  if (lotteryChannel?.isTextBased()) {
    await lotteryChannel.send({
      content: "🏆 **Итоги лотереи LS BET**",
      embeds: [resultEmbed],
    });
  }

  await log("LOTTERY_DRAW", "🏆 Проведён розыгрыш лотереи", `Администратор <@${interaction.user.id}> провёл розыгрыш #${draw.id}.`, [
    { name: "Выигрышные числа", value: formatLotteryNumbers(resultNumbers), inline: true },
    { name: "Билетов", value: String(tickets.length), inline: true },
    { name: "Победителей", value: String(winnersCount), inline: true },
    { name: "Выплачено", value: money(totalPaid), inline: true },
  ], { channelId: interaction.channelId });

  return respondInteraction(interaction, {
    content:
      `✅ Розыгрыш проведён.\n` +
      `Результат: ${formatLotteryNumbers(resultNumbers)}\n` +
      `Билетов: **${tickets.length}**\n` +
      `Победителей: **${winnersCount}**\n` +
      `Выплачено: **${money(totalPaid)}**\n` +
      `Итоги опубликованы в <#${LOTTERY_CHANNEL_ID}>.`,
    ephemeral: true,
  });
}

client.once(Events.ClientReady, async () => {
  console.log(`LS Bet Bot запущен как ${client.user.tag}`);

  await closeExpiredEvents();
  await recoverStaleCrashRounds();
  startCrashGameLoop().catch((error) => console.error("CRASH START ERROR:", error.message));

  setInterval(async () => {
    try {
      await closeExpiredEvents();
    } catch (error) {
      console.error("Ошибка авто-закрытия событий:", error);
    }
  }, 60 * 1000);
});

client.on(Events.GuildMemberAdd, async (member) => {
  try {
    if (!WELCOME_DM_ENABLED || member.user?.bot) return;
    await member.send({ embeds: [welcomeDmEmbed()] }).catch(() => null);
  } catch (error) {
    console.error("WELCOME DM ERROR:", error.message);
  }
});

client.on(Events.MessageCreate, async (message) => {
  try {
    if (message.author.bot) return;
    if (!message.guild) return;

    const request = await prisma.topUpRequest.findFirst({
      where: {
        ticketChannelId: message.channelId,
        status: "WAITING_SCREENSHOT",
      },
      include: {
        user: true,
      },
    });

    if (!request) return;

    if (message.attachments.size === 0) {
      await message.reply("📎 Счет для перевода 0301 0458 3. Прикрепи скриншот перевода файлом или картинкой.");
      return;
    }

    const attachment = message.attachments.first();

    await prisma.topUpRequest.update({
      where: {
        id: request.id,
      },
      data: {
        screenshotUrl: attachment.url,
        status: "PENDING",
      },
    });

    await message.reply(
      "✅ Скриншот получен. Заявка отправлена модераторам на проверку."
    );

    await sendTopUpModerationLog(request.id);

    await log("TOPUP_SCREENSHOT", "📎 Скриншот пополнения загружен", `Игрок <@${request.user.discordId}> загрузил скриншот по заявке #${request.id}.`, [
      { name: "Сумма", value: money(request.amount), inline: true },
      { name: "Ticket", value: `<#${message.channelId}>`, inline: true },
      { name: "Файл", value: attachment.url, inline: false },
    ], { userId: request.userId, channelId: message.channelId });
  } catch (error) {
    console.error("Ошибка обработки скриншота:", error);
  }
});

client.on(Events.InteractionCreate, async (interaction) => {
  try {
    if (interaction.isChatInputCommand()) {
      await deferInteractionReply(interaction, { ephemeral: true });
      if (interaction.commandName === "panel") {
        if (await adminOnly(interaction)) return;
        return respondInteraction(interaction, mainPanel());
      }

      if (interaction.commandName === "admin_panel") {
        if (await adminOnly(interaction)) return;
        return respondInteraction(interaction, adminPanel());
      }

      if (interaction.commandName === "registration_panel") {
        if (await adminOnly(interaction)) return;
        const channelId = REGISTRATION_CHANNEL_ID || interaction.channelId;
        const channel = await client.channels.fetch(channelId).catch(() => null);
        if (!channel?.isTextBased()) {
          return respondInteraction(interaction, { content: "⛔ Канал регистрации не найден или бот не может туда писать.", ephemeral: true });
        }
        await channel.send(registrationPanel());
        return respondInteraction(interaction, { content: `✅ Панель регистрации опубликована в <#${channelId}>.`, ephemeral: true });
      }

      if (interaction.commandName === "user_info") {
        if (await adminOnly(interaction)) return;

        await deferInteractionReply(interaction, {
          ephemeral: true,
        });

        const targetDiscordUser = interaction.options.getUser("user");

        return showUserInfo(interaction, targetDiscordUser);
      }

      if (interaction.commandName === "set_balance") {
        if (await adminOnly(interaction)) return;

        const targetDiscordUser = interaction.options.getUser("user");
        const amount = interaction.options.getInteger("amount");

        return setUserBalance(interaction, targetDiscordUser, amount);
      }

      if (interaction.commandName === "remove_balance") {
        if (await adminOnly(interaction)) return;

        const targetDiscordUser = interaction.options.getUser("user");
        const amount = interaction.options.getInteger("amount");

        return removeUserBalance(interaction, targetDiscordUser, amount);
      }

      if (interaction.commandName === "admin_users") {
        if (await adminOnly(interaction)) return;

        return showAdminUsers(interaction);
      }

      if (interaction.commandName === "event_create") {
        if (await adminOnly(interaction)) return;

        if (interaction.channelId !== EVENT_CHANNEL_ID) {
          return respondInteraction(interaction, {
            content: `⛔ Создавать события можно только в канале <#${EVENT_CHANNEL_ID}>.`,
            ephemeral: true,
          });
        }

        const title = interaction.options.getString("title");
        const description = interaction.options.getString("description");
        const option1 = interaction.options.getString("option1");
        const odds1 = interaction.options.getNumber("odds1");
        const option2 = interaction.options.getString("option2");
        const odds2 = interaction.options.getNumber("odds2");
        const option3 = interaction.options.getString("option3");
        const odds3 = interaction.options.getNumber("odds3");
        const banner = interaction.options.getAttachment("banner");
        const minutes = interaction.options.getInteger("minutes");

        if (odds1 <= 1 || odds2 <= 1 || (odds3 !== null && odds3 !== undefined && odds3 <= 1)) {
          return respondInteraction(interaction, {
            content: "Коэффициент должен быть больше 1.00.",
            ephemeral: true,
          });
        }

        if ((option3 && !odds3) || (!option3 && odds3)) {
          return respondInteraction(interaction, {
            content: "Для третьего исхода нужно указать и название, и коэффициент.",
            ephemeral: true,
          });
        }

        if (minutes <= 0) {
          return respondInteraction(interaction, {
            content: "Время закрытия ставок должно быть больше 0 минут.",
            ephemeral: true,
          });
        }

        const eventChannel = await client.channels.fetch(EVENT_CHANNEL_ID);

        if (!eventChannel || !eventChannel.isTextBased()) {
          return respondInteraction(interaction, {
            content:
              "⛔ Канал для публикации событий не найден или бот не может туда писать.",
            ephemeral: true,
          });
        }

        const closesAt = new Date(Date.now() + minutes * 60 * 1000);

        const event = await prisma.rpEvent.create({
          data: {
            title,
            description,
            status: "OPEN",
            closesAt,
            createdBy: interaction.user.id,
            channelId: EVENT_CHANNEL_ID,
            options: {
              create: [
                { title: option1, odds: odds1, imageUrl: banner.url },
                { title: option2, odds: odds2, imageUrl: banner.url },
                ...(option3 ? [{ title: option3, odds: odds3, imageUrl: banner.url }] : []),
              ],
            },
          },
          include: {
            options: {
              orderBy: {
                id: "asc",
              },
              include: {
                bets: true,
              },
            },
          },
        });

        const message = await eventChannel.send({
          content: "📢 **LS Bet афиша события**",
          embeds: eventEmbeds(event),
          components: eventButtons(event),
        });

        await prisma.rpEvent.update({
          where: {
            id: event.id,
          },
          data: {
            messageId: message.id,
            channelId: EVENT_CHANNEL_ID,
          },
        });

        await log("EVENT_CREATED", "📢 Создано событие", `Администратор <@${interaction.user.id}> создал событие #${event.id}.`, [
          { name: "Событие", value: title, inline: false },
          { name: "Исход 1", value: `${option1} | x${odds1}`, inline: true },
          { name: "Исход 2", value: `${option2} | x${odds2}`, inline: true },
          ...(option3 ? [{ name: "Исход 3", value: `${option3} | x${odds3}`, inline: true }] : []),
          { name: "Закрытие ставок", value: `<t:${unix(closesAt)}:R>`, inline: true },
          { name: "Канал", value: `<#${EVENT_CHANNEL_ID}>`, inline: true },
        ], { channelId: interaction.channelId });

        return respondInteraction(interaction, {
          content: `✅ Событие создано и опубликовано в канале <#${EVENT_CHANNEL_ID}>.`,
          ephemeral: true,
        });
      }

      if (interaction.commandName === "finish_event") {
        if (await adminOnly(interaction)) return;

        const eventId = interaction.options.getInteger("event_id");
        const winnerNumber = interaction.options.getInteger("winner");

        return adminFinishEvent(interaction, eventId, winnerNumber);
      }


      if (interaction.commandName === "event_cancel") {
        if (await adminOnly(interaction)) return;

        const eventId = interaction.options.getInteger("event_id");
        const reason = interaction.options.getString("reason") || "Не указана";

        return adminCancelEvent(interaction, eventId, reason);
      }

      if (interaction.commandName === "add_balance") {
        if (await adminOnly(interaction)) return;

        const targetDiscordUser = interaction.options.getUser("user");
        const amount = interaction.options.getInteger("amount");

        if (!amount || amount <= 0) {
          return respondInteraction(interaction, {
            content: "Сумма должна быть больше 0.",
            ephemeral: true,
          });
        }

        const targetUser = await userOf(targetDiscordUser);

        await prisma.$transaction([
          prisma.user.update({
            where: {
              id: targetUser.id,
            },
            data: {
              balance: {
                increment: amount,
              },
            },
          }),

          prisma.transaction.create({
            data: {
              userId: targetUser.id,
              amount,
              type: "ADMIN_ADD",
              comment: `Начисление от администратора ${interaction.user.username}`,
            },
          }),
        ]);

        await log("ADMIN_ADD", "🛡 Админ начислил баланс", `Администратор <@${interaction.user.id}> начислил баланс игроку <@${targetDiscordUser.id}>.`, [
          { name: "Сумма", value: money(amount), inline: true },
        ], { userId: targetUser.id, channelId: interaction.channelId });

        return respondInteraction(interaction, {
          content: `✅ <@${targetDiscordUser.id}> начислено **${money(amount)}**.`,
        });
      }
    }

    if (interaction.isButton()) {
      if (!buttonOpensModal(interaction.customId) && !buttonUsesMessageUpdate(interaction.customId)) {
        await deferInteractionReply(interaction, { ephemeral: true });
      }
      if (interaction.customId === "registration_start") {
        return interaction.showModal(registrationModal());
      }
      if (interaction.customId.startsWith("registration_approve:")) {
        const [, requestIdRaw] = interaction.customId.split(":");
        return approveRegistration(interaction, Number(requestIdRaw));
      }
      if (interaction.customId.startsWith("registration_reject:")) {
        const [, requestIdRaw] = interaction.customId.split(":");
        return rejectRegistration(interaction, Number(requestIdRaw));
      }
      if (interaction.customId.startsWith("registration_ticket_close:")) {
        const [, requestIdRaw] = interaction.customId.split(":");
        return closeRegistrationTicket(interaction, Number(requestIdRaw));
      }

      if (interaction.customId === "admin_events") {
        return showAdminEventsMenu(interaction);
      }

      if (interaction.customId === "admin_events_active_button") {
        return showAdminEvents(interaction);
      }

      if (interaction.customId === "admin_event_create_button") {
        if (await adminOnly(interaction)) return;
        return interaction.showModal(adminCreateEventModal());
      }

      if (interaction.customId === "admin_event_edit_by_id_button") {
        if (await adminOnly(interaction)) return;
        return interaction.showModal(adminEventEditByIdModal());
      }

      if (interaction.customId === "admin_users_panel") {
        if (await adminOnly(interaction)) return;
        return respondInteraction(interaction, adminUsersPanel());
      }

      if (interaction.customId === "admin_back_main") {
        if (await adminOnly(interaction)) return;
        return respondInteraction(interaction, adminPanel());
      }

      if (interaction.customId === "admin_user_info_button") {
        if (await adminOnly(interaction)) return;
        return interaction.showModal(adminUserIdModal("admin_user_info_modal", "Информация об игроке"));
      }

      if (interaction.customId === "admin_user_add_balance_button") {
        if (await adminOnly(interaction)) return;
        return interaction.showModal(adminUserIdModal("admin_user_add_balance_modal", "Начислить баланс", true));
      }

      if (interaction.customId === "admin_user_remove_balance_button") {
        if (await adminOnly(interaction)) return;
        return interaction.showModal(adminUserIdModal("admin_user_remove_balance_modal", "Списать баланс", true));
      }

      if (interaction.customId === "admin_user_set_balance_button") {
        if (await adminOnly(interaction)) return;
        return interaction.showModal(adminUserIdModal("admin_user_set_balance_modal", "Установить баланс", true));
      }

      if (interaction.customId === "admin_users_top_button") {
        if (await adminOnly(interaction)) return;
        return showAdminUsers(interaction);
      }

      if (interaction.customId === "admin_registration_panel_publish") {
        if (await adminOnly(interaction)) return;
        await interaction.channel.send(registrationPanel());
        return respondInteraction(interaction, { content: "✅ Панель регистрации опубликована.", ephemeral: true });
      }

      if (interaction.customId === "admin_topups") {
        return showAdminTopUps(interaction);
      }

      if (interaction.customId === "admin_withdraws") {
        return showAdminWithdraws(interaction);
      }

      if (interaction.customId === "admin_promos") {
        if (await adminOnly(interaction)) return;
        return respondInteraction(interaction, adminPromoPanel());
      }

      if (interaction.customId === "admin_lottery") {
        if (await adminOnly(interaction)) return;
        return respondInteraction(interaction, adminLotteryPanel());
      }

      if (interaction.customId === "admin_public_panel") {
        if (await adminOnly(interaction)) return;

        await interaction.channel.send(mainPanel());

        return respondInteraction(interaction, {
          content: "✅ Главное меню опубликовано.",
          ephemeral: true,
        });
      }

      if (interaction.customId === "promo_create") {
        if (await adminOnly(interaction)) return;
        return interaction.showModal(promoCreateModal());
      }

      if (interaction.customId === "promo_create_referral") {
        if (await adminOnly(interaction)) return;
        return interaction.showModal(referralPromoCreateModal());
      }

      if (interaction.customId === "promo_edit") {
        if (await adminOnly(interaction)) return;
        return interaction.showModal(promoEditModal());
      }

      if (interaction.customId === "promo_delete") {
        if (await adminOnly(interaction)) return;
        return interaction.showModal(promoDeleteModal());
      }

      if (interaction.customId === "promo_stats") {
        return showPromoStats(interaction);
      }

      if (interaction.customId === "referral_stats") {
        return showReferralStats(interaction);
      }

      if (interaction.customId === "lottery_draw") {
        return runLotteryDraw(interaction);
      }

      if (interaction.customId === "lottery_active") {
        return showActiveLotteryTickets(interaction);
      }

      if (interaction.customId === "lottery_last_admin") {
        if (await adminOnly(interaction)) return;
        return showLastLotteryDraw(interaction, true);
      }

      if (interaction.customId.startsWith("admin_event_edit:")) {
        if (await adminOnly(interaction)) return;
        const [, eventIdRaw] = interaction.customId.split(":");
        const event = await fullEvent(Number(eventIdRaw));
        if (!event) return respondInteraction(interaction, { content: "Событие не найдено.", ephemeral: true });
        return interaction.showModal(adminEventEditModal(event));
      }

      if (interaction.customId.startsWith("admin_event_facebrowser:")) {
        if (await adminOnly(interaction)) return;
        const [, eventIdRaw] = interaction.customId.split(":");
        const eventId = Number(eventIdRaw);

        await deferInteractionReply(interaction, { ephemeral: true });

        try {
          const result = await publishFacebrowserEvent(eventId);
          if (!result) {
            return interaction.editReply("❌ FACEBROWSER не настроен. Проверь FACEBROWSER_API_KEY и FACEBROWSER_PAGE_ID.");
          }

          return interaction.editReply([
            `✅ FACEBROWSER: пост ${result.action === "updated" ? "обновлён" : "создан"}.`,
            result.postId ? `Post ID: ${result.postId}` : "Post ID не вернулся от API.",
            result.hasImage ? "🖼 Ссылка на афишу добавлена в текст поста." : "⚠️ У события нет афиши/imageUrl."
          ].join("\n"));
        } catch (error) {
          console.error("FACEBROWSER BUTTON ERROR:", error.message, error.data || "");
          return interaction.editReply(`❌ Ошибка FACEBROWSER: ${error.message}${error.data ? `\n${JSON.stringify(error.data).slice(0, 1500)}` : ""}`);
        }
      }

      if (interaction.customId.startsWith("admin_event_cancel:")) {
        if (await adminOnly(interaction)) return;
        const [, eventIdRaw] = interaction.customId.split(":");
        return interaction.showModal(adminEventCancelModal(Number(eventIdRaw)));
      }

      if (interaction.customId.startsWith("admin_live:")) {
        const [, eventIdRaw] = interaction.customId.split(":");
        return adminSetEventLive(interaction, Number(eventIdRaw));
      }

      if (interaction.customId.startsWith("admin_finish:")) {
        const [, eventIdRaw, winnerRaw] = interaction.customId.split(":");

        return adminFinishEvent(
          interaction,
          Number(eventIdRaw),
          Number(winnerRaw)
        );
      }

      if (interaction.customId.startsWith("admin_refresh:")) {
        if (await adminOnly(interaction)) return;

        const [, eventIdRaw] = interaction.customId.split(":");
        const eventId = Number(eventIdRaw);

        await updateEventMessage(eventId);

        return respondInteraction(interaction, {
          content: "🔄 Афиша обновлена.",
          ephemeral: true,
        });
      }

      if (interaction.customId.startsWith("topup_approve:")) {
        const [, requestIdRaw] = interaction.customId.split(":");
        return approveTopUp(interaction, Number(requestIdRaw));
      }

      if (interaction.customId.startsWith("topup_reject:")) {
        const [, requestIdRaw] = interaction.customId.split(":");
        return rejectTopUp(interaction, Number(requestIdRaw));
      }

      if (interaction.customId.startsWith("ticket_close:")) {
        const [, requestIdRaw] = interaction.customId.split(":");
        return closeTicket(interaction, Number(requestIdRaw));
      }

      if (interaction.customId.startsWith("withdraw_approve:")) {
        const [, requestIdRaw] = interaction.customId.split(":");
        return approveWithdraw(interaction, Number(requestIdRaw));
      }

      if (interaction.customId.startsWith("withdraw_reject:")) {
        const [, requestIdRaw] = interaction.customId.split(":");
        return rejectWithdraw(interaction, Number(requestIdRaw));
      }

      if (interaction.customId.startsWith("withdraw_ticket_close:")) {
        const [, requestIdRaw] = interaction.customId.split(":");
        return closeWithdrawTicket(interaction, Number(requestIdRaw));
      }

      if (interaction.customId === "panel_crash" || interaction.customId === "crash_refresh") {
        return showCrashPanel(interaction);
      }

      if (interaction.customId === "crash_bet") {
        return handleCrashBet(interaction);
      }

      if (interaction.customId.startsWith("crash_bet_auto:")) {
        const [, roundIdRaw, autoCashoutRaw] = interaction.customId.split(":");
        return handleCrashAutoCashoutButton(interaction, autoCashoutRaw, roundIdRaw);
      }

      if (interaction.customId.startsWith("crash_bet_custom:")) {
        const [, roundIdRaw] = interaction.customId.split(":");
        return handleCrashCustomAutoCashoutButton(interaction, roundIdRaw);
      }

      if (interaction.customId === "crash_cashout") {
        return handleCrashCashout(interaction);
      }

      if (interaction.customId === "crash_history") {
        return showCrashHistory(interaction);
      }

      if (interaction.customId === "panel_profile") {
        return showProfile(interaction);
      }

      if (interaction.customId === "panel_events") {
        return showEvents(interaction);
      }

      if (interaction.customId === "panel_jackpot" || interaction.customId === "jackpot_refresh") {
        return jackpotWarPanel(interaction);
      }

      if (interaction.customId === "admin_jackpot") {
        if (await adminOnly(interaction)) return;
        return jackpotWarPanel(interaction);
      }

      if (interaction.customId === "panel_mybets") {
        return showMyBets(interaction);
      }

      if (interaction.customId === "panel_top") {
        return showTop(interaction);
      }

      if (interaction.customId === "panel_history") {
        return showHistory(interaction);
      }

      if (interaction.customId === "panel_promo") {
        return interaction.showModal(promoModal());
      }

      if (interaction.customId === "panel_topup") {
        return interaction.showModal(topupModal());
      }

      if (interaction.customId === "panel_withdraw") {
        return interaction.showModal(withdrawModal());
      }

      if (interaction.customId === "panel_coinflip") {
        if (interaction.channelId !== COINFLIP_CHANNEL_ID) {
          return respondInteraction(interaction, {
            content: `🪙 Coinflip доступен только в канале <#${COINFLIP_CHANNEL_ID}>.`,
            ephemeral: true,
          });
        }

        return respondInteraction(interaction, coinflipPanel());
      }

      if (interaction.customId === "panel_lottery") {
        return respondInteraction(interaction, lotteryPanel());
      }

      if (interaction.customId === "lottery_random") {
        return buyLotteryTicket(interaction, generateLotteryNumbers());
      }

      if (interaction.customId === "lottery_custom") {
        return interaction.showModal(lotteryCustomModal());
      }

      if (interaction.customId === "lottery_mine") {
        return showMyLotteryTickets(interaction);
      }

      if (interaction.customId === "lottery_last") {
        return showLastLotteryDraw(interaction);
      }

      if (interaction.customId.startsWith("coinflip_side:")) {
        const [, side] = interaction.customId.split(":");
        return interaction.showModal(coinflipAmountModal(side));
      }

      if (interaction.customId.startsWith("coinflip_accept:")) {
        const [, gameIdRaw] = interaction.customId.split(":");
        return acceptCoinflip(interaction, Number(gameIdRaw));
      }

      if (interaction.customId.startsWith("coinflip_cancel:")) {
        const [, gameIdRaw] = interaction.customId.split(":");
        return cancelCoinflip(interaction, Number(gameIdRaw));
      }

      if (interaction.customId.startsWith("event_stats:")) {
        const [, eventIdRaw] = interaction.customId.split(":");
        return showEventStats(interaction, Number(eventIdRaw));
      }

      if (interaction.customId.startsWith("bet:")) {
        const [, eventIdRaw, optionIdRaw] = interaction.customId.split(":");
        const eventId = Number(eventIdRaw);
        const optionId = Number(optionIdRaw);

        if (!Number.isInteger(eventId) || !Number.isInteger(optionId)) {
          return respondInteraction(interaction, {
            content: "Некорректная кнопка ставки. Обнови карточку события.",
            ephemeral: true,
          });
        }

        // Форму открываем сразу, чтобы Discord не успел аннулировать interaction.
        // Существование события, исхода и доступность ставок проверяются после отправки формы.
        const modal = new ModalBuilder()
          .setCustomId(`bet_modal:${eventId}:${optionId}`)
          .setTitle("LS Bet — сумма ставки");

        modal.addComponents(
          new ActionRowBuilder().addComponents(
            new TextInputBuilder()
              .setCustomId("amount")
              .setLabel("Сумма ставки в $")
              .setPlaceholder("Например: 500")
              .setRequired(true)
              .setStyle(TextInputStyle.Short)
          )
        );

        return interaction.showModal(modal);
      }
    }

    if (interaction.isModalSubmit()) {
      await deferInteractionReply(interaction, { ephemeral: true });
      if (interaction.customId === "registration_modal") {
        const fullName = interaction.fields.getTextInputValue("fullName").trim();
        const phone = interaction.fields.getTextInputValue("phone").trim();
        const age = interaction.fields.getTextInputValue("age").trim();
        return createRegistrationRequest(interaction, fullName, phone, age);
      }

      if (interaction.customId === "admin_create_event_modal") {
        return adminApplyCreateEvent(interaction);
      }

      if (interaction.customId === "admin_user_info_modal") {
        return adminApplyUserAction(interaction, "info");
      }

      if (interaction.customId === "admin_user_add_balance_modal") {
        return adminApplyUserAction(interaction, "add");
      }

      if (interaction.customId === "admin_user_remove_balance_modal") {
        return adminApplyUserAction(interaction, "remove");
      }

      if (interaction.customId === "admin_user_set_balance_modal") {
        return adminApplyUserAction(interaction, "set");
      }

      if (interaction.customId === "admin_event_edit_by_id_modal") {
        if (await adminOnly(interaction)) return;
        const eventId = Number(interaction.fields.getTextInputValue("eventId").trim());
        if (!Number.isInteger(eventId) || eventId <= 0) {
          return respondInteraction(interaction, { content: "Укажи корректный ID события.", ephemeral: true });
        }
        const event = await fullEvent(eventId);
        if (!event) {
          return respondInteraction(interaction, { content: `Событие #${eventId} не найдено.`, ephemeral: true });
        }
        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(`admin_event_edit:${event.id}`).setLabel(`✏️ Открыть редактор #${event.id}`).setStyle(ButtonStyle.Primary)
        );
        return respondInteraction(interaction, { content: `Нашёл событие **#${event.id}: ${event.title}**. Нажми кнопку ниже, чтобы открыть форму редактирования.`, components: [row], ephemeral: true });
      }

      if (interaction.customId.startsWith("admin_event_edit_modal:")) {
        const [, eventIdRaw] = interaction.customId.split(":");
        return adminApplyEventEdit(interaction, Number(eventIdRaw));
      }

      if (interaction.customId.startsWith("admin_event_cancel_modal:")) {
        const [, eventIdRaw] = interaction.customId.split(":");
        const reason = interaction.fields.getTextInputValue("reason").trim();
        return adminCancelEvent(interaction, Number(eventIdRaw), reason);
      }

      if (interaction.customId === "promo_edit_modal") {
        const code = interaction.fields.getTextInputValue("code");
        const amount = interaction.fields.getTextInputValue("amount");
        const maxUses = interaction.fields.getTextInputValue("maxUses");
        const active = interaction.fields.getTextInputValue("active");
        const referral = interaction.fields.getTextInputValue("referral");

        return editPromoCode(
          interaction,
          code,
          amount,
          maxUses,
          active,
          referral
        );
      }

      if (interaction.customId === "promo_delete_modal") {
        const code = interaction.fields.getTextInputValue("code");
        return deletePromoCode(interaction, code);
      }

      if (interaction.customId === "promo_create_modal") {
        const code = interaction.fields.getTextInputValue("code");
        const amount = Number(interaction.fields.getTextInputValue("amount"));
        const maxUses = interaction.fields.getTextInputValue("maxUses");

        return createPromoCode(interaction, code, amount, maxUses);
      }

      if (interaction.customId === "promo_create_referral_modal") {
        const code = interaction.fields.getTextInputValue("code");
        const ownerDiscordId =
          interaction.fields.getTextInputValue("ownerDiscordId");
        const amount = Number(interaction.fields.getTextInputValue("amount"));
        const refPercent = interaction.fields.getTextInputValue("refPercent");
        const maxUses = interaction.fields.getTextInputValue("maxUses");

        return createReferralPromoCode(
          interaction,
          code,
          ownerDiscordId,
          amount,
          refPercent,
          maxUses
        );
      }

      if (interaction.customId === "promo_activate_modal") {
        const code = interaction.fields.getTextInputValue("code");
        return activatePromoCode(interaction, code);
      }

      if (interaction.customId === "lottery_custom_modal") {
        await deferInteractionReply(interaction, {
          ephemeral: true,
        });
      
        const raw = interaction.fields.getTextInputValue("numbers");
        const parsed = parseLotteryNumbers(raw);
      
        if (!parsed.ok) {
          return interaction.editReply({
            content: `❌ ${parsed.error}`,
          });
        }
      
        return buyLotteryTicket(interaction, parsed.numbers);
      }

      if (interaction.customId.startsWith("coinflip_modal:")) {
        const [, side] = interaction.customId.split(":");
        const amount = Number(interaction.fields.getTextInputValue("amount"));

        return createCoinflipGame(interaction, side, amount);
      }

      if (interaction.customId === "topup_modal") {
        const login = interaction.fields.getTextInputValue("login");
        const amount = Number(interaction.fields.getTextInputValue("amount"));
        const comment = interaction.fields.getTextInputValue("comment");

        if (!Number.isInteger(amount) || amount <= 0) {
          return respondInteraction(interaction, {
            content: "Введи корректную сумму пополнения.",
            ephemeral: true,
          });
        }

        const verified = await isVerifiedDiscordMember(interaction);
        if (!verified && amount > UNVERIFIED_MAX_TOPUP) {
          return respondInteraction(interaction, {
            content: `⛔ Для неверифицированных пользователей лимит пополнения за раз: **${money(UNVERIFIED_MAX_TOPUP)}**.\n\n${unverifiedLimitText()}`,
            ephemeral: true,
          });
        }

        return createTopUpTicket(interaction, login, amount, comment);
      }

      if (interaction.customId === "withdraw_modal") {
        const login = interaction.fields.getTextInputValue("login");
        const amount = Number(interaction.fields.getTextInputValue("amount"));
        const details = interaction.fields.getTextInputValue("details");
        const comment = interaction.fields.getTextInputValue("comment");

        return createWithdrawTicket(
          interaction,
          login,
          amount,
          details,
          comment
        );
      }

      if (interaction.customId.startsWith("crash_bet_modal:") || interaction.customId.startsWith("crash_bet_custom_modal:")) {
        return applyCrashBet(interaction);
      }

      if (!interaction.customId.startsWith("bet_modal:")) return;

      const [, eventIdRaw, optionIdRaw] = interaction.customId.split(":");

      const eventId = Number(eventIdRaw);
      const optionId = Number(optionIdRaw);
      const amount = Number(interaction.fields.getTextInputValue("amount"));

      if (!Number.isInteger(amount) || amount <= 0) {
        return respondInteraction(interaction, {
          content: "Введи корректную сумму ставки.",
          ephemeral: true,
        });
      }

      const verified = await isVerifiedDiscordMember(interaction);
      if (!verified && amount > UNVERIFIED_MAX_BET) {
        return respondInteraction(interaction, {
          content: `⛔ Для неверифицированных пользователей лимит ставки: **${money(UNVERIFIED_MAX_BET)}**.\n\n${unverifiedLimitText()}`,
          ephemeral: true,
        });
      }

      const user = await userOf(interaction.user);

      const event = await prisma.rpEvent.findUnique({
        where: {
          id: eventId,
        },
        include: {
          options: true,
        },
      });

      if (!event) {
        return respondInteraction(interaction, {
          content: "Событие не найдено.",
          ephemeral: true,
        });
      }

      if (event.status !== "OPEN" || isEventClosed(event)) {
        await closeExpiredEvents();

        return respondInteraction(interaction, {
          content: "Ставки на это событие уже закрыты.",
          ephemeral: true,
        });
      }

      const option = event.options.find((item) => item.id === optionId);

      if (!option) {
        return respondInteraction(interaction, {
          content: "Исход не найден.",
          ephemeral: true,
        });
      }

      if (user.balance < amount) {
        await log("EVENT_BET_FAILED", "⚠️ Неудачная ставка", `Игрок <@${interaction.user.id}> попытался сделать ставку, но не хватило баланса.`, [
          { name: "Событие", value: event.title, inline: false },
          { name: "Исход", value: option.title, inline: true },
          { name: "Ставка", value: money(amount), inline: true },
          { name: "Баланс", value: money(user.balance), inline: true },
        ], { userId: user.id, channelId: interaction.channelId });

        return respondInteraction(interaction, {
          content: `Недостаточно средств. Твой баланс: **${money(
            user.balance
          )}**.`,
          ephemeral: true,
        });
      }

      const potentialWin = Math.floor(amount * option.odds);

      let jackpotInfo = null;
      try {
        await prisma.$transaction(async (tx) => {
          const freshEvent = await tx.rpEvent.findFirst({
            where: {
              id: eventId,
              status: "OPEN",
              closesAt: { gt: new Date() },
              options: { some: { id: optionId } },
            },
          });

          if (!freshEvent) {
            const error = new Error("EVENT_CLOSED");
            error.code = "EVENT_CLOSED";
            throw error;
          }

          await decrementBalanceOrThrow(tx, user.id, amount);

          const createdBet = await tx.bet.create({
            data: {
              userId: user.id,
              eventId,
              optionId,
              amount,
              potentialWin,
              status: "ACTIVE",
            },
          });

          jackpotInfo = await addJackpotContribution(tx, user.id, "EVENT_BET", createdBet.id, amount);

          await tx.transaction.create({
            data: {
              userId: user.id,
              amount: -amount,
              type: "EVENT_BET",
              comment: `Ставка на событие "${event.title}". Исход: ${option.title}. Возможный выигрыш: ${money(potentialWin)}`,
            },
          });
        });
      } catch (error) {
        if (error?.code === "EVENT_CLOSED") {
          await closeExpiredEvents();
          return respondInteraction(interaction, { content: "Ставки на это событие уже закрыты.", ephemeral: true });
        }

        if (isInsufficientBalance(error)) {
          const freshUser = await prisma.user.findUnique({ where: { id: user.id } });
          await log("EVENT_BET_FAILED", "⚠️ Неудачная ставка", `Игрок <@${interaction.user.id}> попытался сделать ставку, но не хватило баланса.`, [
            { name: "Событие", value: event.title, inline: false },
            { name: "Исход", value: option.title, inline: true },
            { name: "Ставка", value: money(amount), inline: true },
            { name: "Баланс", value: money(freshUser?.balance || 0), inline: true },
          ], { userId: user.id, channelId: interaction.channelId });

          return respondInteraction(interaction, {
            content: `Недостаточно средств. Твой баланс: **${money(freshUser?.balance || 0)}**.`,
            ephemeral: true,
          });
        }

        throw error;
      }

      await updateEventMessage(eventId);
      await maybeFinishJackpotWar();
      await sendJackpotWarLiveNotification(jackpotInfo);

      await log("EVENT_BET", "🎯 Новая ставка на событие", `Игрок <@${interaction.user.id}> сделал ставку на событие #${event.id}.`, [
        { name: "Событие", value: event.title, inline: false },
        { name: "Исход", value: option.title, inline: true },
        { name: "Сумма", value: money(amount), inline: true },
        { name: "Коэффициент", value: `x${option.odds}`, inline: true },
        { name: "Возможный выигрыш", value: money(potentialWin), inline: true },
      ], { userId: user.id, channelId: interaction.channelId });

      return respondInteraction(interaction, {
        content:
          `✅ **Ставка принята**\n` +
          `Событие: **${event.title}**\n` +
          `Исход: **${option.title}**\n` +
          `Сумма: **${money(amount)}**\n` +
          `Коэффициент: **x${option.odds}**\n` +
          `Возможный выигрыш: **${money(potentialWin)}**`,
        ephemeral: true,
      });
    }
  } catch (error) {
    await safelyHandleInteractionError(interaction, error);
  }
});

let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`🛑 Получен ${signal}. Завершаю работу...`);

  try {
    client.destroy();
    await prisma.$disconnect();
  } catch (error) {
    console.error("Ошибка при завершении работы:", error);
  } finally {
    process.exit(0);
  }
}

process.once("SIGTERM", () => shutdown("SIGTERM"));
process.once("SIGINT", () => shutdown("SIGINT"));

client.login(process.env.DISCORD_TOKEN).catch(async (error) => {
  console.error("❌ Не удалось авторизовать Discord-бота:", error);
  await prisma.$disconnect().catch(() => null);
  process.exit(1);
});