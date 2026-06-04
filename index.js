require("dotenv").config();

const { execSync } = require("child_process");

try {
  console.log("🔧 Prisma generate...");
  execSync("npx prisma generate --schema=prisma/schema.prisma", { stdio: "inherit" });
  console.log("🔧 Prisma db push...");
  execSync("npx prisma db push --schema=prisma/schema.prisma", { stdio: "inherit" });
  console.log("✅ Prisma ready");
} catch (error) {
  console.error("❌ Prisma prepare error:", error.message);
}

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

const START_BALANCE = Number(process.env.START_BALANCE || 0);
const EVENT_CHANNEL_ID = process.env.EVENT_CHANNEL_ID || "1510916382395600936";
const RESULT_CHANNEL_ID = process.env.RESULT_CHANNEL_ID || "1510928118527950888";
const COINFLIP_CHANNEL_ID = process.env.COINFLIP_CHANNEL_ID || "1511707250668863578";
const LOTTERY_CHANNEL_ID = process.env.LOTTERY_CHANNEL_ID || "1510916530190417990";
const PROMO_NEW_USER_DAYS = Number(process.env.PROMO_NEW_USER_DAYS || 3);
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
  footer: "LS Bet • RP Events • Coinflip • Lottery",
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
  await interaction.reply({ content: "⛔ Эта команда доступна только администрации.", ephemeral: true });
  return true;
}

async function userOf(discordUser) {
  return prisma.user.upsert({
    where: { discordId: discordUser.id },
    update: { username: discordUser.username },
    create: { discordId: discordUser.id, username: discordUser.username, balance: START_BALANCE },
  });
}

async function log(type, title, description, fields = []) {
  try {
    await prisma.botLog.create({ data: { type, message: `${title}\n${description || ""}` } });
  } catch (e) {}

  const channelId = process.env.LOG_CHANNEL_ID;
  if (!channelId) return;

  try {
    const channel = await client.channels.fetch(channelId);
    if (!channel?.isTextBased()) return;
    const e = embed(LS_THEME.green).setTitle(title).setDescription(description || "Без описания");
    if (fields.length) e.addFields(fields);
    await channel.send({ embeds: [e] });
  } catch (error) {
    console.error("LOG ERROR:", error.message);
  }
}

function txName(type) {
  return {
    EVENT_BET: "Ставка",
    EVENT_WIN: "Выигрыш",
    ADMIN_ADD: "Начисление админа",
    ADMIN_REMOVE: "Списание админа",
    BALANCE_SET: "Баланс установлен",
    TOPUP_APPROVED: "Пополнение",
    PROMO_ACTIVATED: "Промокод",
    REFERRAL_BONUS: "Реферальный бонус",
    COINFLIP_CREATE: "Coinflip создан",
    COINFLIP_ACCEPT: "Coinflip принят",
    COINFLIP_WIN: "Coinflip выигрыш",
    COINFLIP_REFUND: "Coinflip возврат",
    WITHDRAW_REQUEST: "Заявка на вывод",
    WITHDRAW_APPROVED: "Вывод одобрен",
    WITHDRAW_REJECTED: "Вывод отклонён",
    WITHDRAW_REFUND: "Возврат вывода",
    LOTTERY_TICKET: "Билет лотереи",
    LOTTERY_WIN: "Выигрыш лотереи",
  }[type] || type;
}

function statusEvent(status) {
  if (status === "OPEN") return "🟢 OPEN";
  if (status === "LIVE") return "🔴 LIVE";
  if (status === "FINISHED") return "🏁 FINISHED";
  return status;
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

function mainPanel() {
  const e = embed(LS_THEME.green)
    .setTitle("💚 LS Bet — Главное меню")
    .setDescription([
      "```",
      "LS BET PLATFORM",
      "RP EVENTS • COINFLIP • LOTTERY • PROMO",
      "```",
      "RP-события, ставки, Coinflip, лотерея 5 чисел, промокоды, пополнение и вывод баланса.",
      "",
      LS_TEXT.line,
    ].join("\n"));

  const r1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("panel_profile").setLabel("👤 Профиль").setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId("panel_events").setLabel("🎰 RP-события").setStyle(ButtonStyle.Primary),
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
    new ButtonBuilder().setCustomId("panel_topup").setLabel("💰 Пополнить").setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId("panel_withdraw").setLabel("💸 Вывести").setStyle(ButtonStyle.Danger)
  );

  return { embeds: [e], components: [r1, r2, r3] };
}

function adminPanel() {
  const e = embed(LS_THEME.gold)
    .setTitle("🛠️ LS Bet — Admin Panel")
    .setDescription(["```", "ADMIN CONTROL CENTER", "EVENTS • TOPUPS • WITHDRAWS • PROMOS • LOTTERY", "```", LS_TEXT.line].join("\n"));

  const r1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("admin_events").setLabel("📢 События").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId("admin_topups").setLabel("💰 Заявки").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId("admin_withdraws").setLabel("💸 Выводы").setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId("admin_promos").setLabel("🎟️ Промокоды").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId("admin_public_panel").setLabel("📌 Меню").setStyle(ButtonStyle.Success)
  );

  const r2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("admin_lottery").setLabel("🎫 Лотерея").setStyle(ButtonStyle.Success)
  );

  return { embeds: [e], components: [r1, r2], ephemeral: true };
}

function eventEmbeds(event) {
  const closed = event.status !== "OPEN" || isEventClosed(event);
  const color = event.status === "OPEN" ? LS_THEME.green : event.status === "LIVE" ? LS_THEME.red : LS_THEME.gold;

  const main = embed(color)
    .setTitle(`🎰 LS BET EVENT #${event.id}`)
    .setDescription([
      `# ${event.title}`,
      "",
      event.description || "Описание не указано.",
      "",
      LS_TEXT.line,
      `**Статус:** ${statusEvent(closed && event.status === "OPEN" ? "LIVE" : event.status)}`,
      `**Закрытие ставок:** <t:${unix(event.closesAt)}:R>`,
      `**Банк события:** ${money(eventBank(event))}`,
      LS_TEXT.line,
    ].join("\n"));

  const options = event.options.map((o, i) => {
    const e = embed(i === 0 ? LS_THEME.green : LS_THEME.gold)
      .setTitle(`${i === 0 ? "1️⃣" : "2️⃣"} ${o.title}`)
      .setDescription(`**Коэффициент:** x${o.odds}\n**Поставлено:** ${money(optionTotal(o))}`);
    if (o.imageUrl) e.setImage(o.imageUrl);
    return e;
  });

  return [main, ...options];
}

function eventButtons(event) {
  const disabled = event.status !== "OPEN" || isEventClosed(event);
  const row = new ActionRowBuilder();

  for (const option of event.options.slice(0, 2)) {
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(`bet:${event.id}:${option.id}`)
        .setLabel(`💵 Поставить на ${option.title}`)
        .setStyle(ButtonStyle.Success)
        .setDisabled(disabled)
    );
  }

  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`event_stats:${event.id}`).setLabel("📊 Статистика").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId("panel_profile").setLabel("👤 Профиль").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId("panel_top").setLabel("🏆 Top").setStyle(ButtonStyle.Secondary)
  );

  return [row, row2];
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
        "RP EVENT FINISHED",
        "```",
        `# ${event.title}`,
        "",
        `**ID события:** #${event.id}`,
        `**Победный исход:** ${winnerOption.title}`,
        `**Победителей:** ${winnersCount}`,
        `**Выплачено:** ${money(totalPaid)}`,
      ].join("\n"));
    if (winnerOption.imageUrl) e.setImage(winnerOption.imageUrl);
    await channel.send({ content: "🏁 **Итоги RP-события**", embeds: [e] });
  } catch (e) {
    console.error("publishEventResult:", e.message);
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
      { name: "Всего ставок", value: String(totalBets), inline: true },
      { name: "Активные ставки", value: String(activeBets), inline: true },
      { name: "Выиграно ставок", value: String(wonBets), inline: true },
      { name: "Процент побед", value: `${winPercent}%`, inline: true },
      { name: "Coinflip побед", value: String(coinflipWins), inline: true },
      { name: "Билетов лотереи", value: String(lotteryTickets), inline: true },
      { name: "Рефералов", value: String(referralsCount), inline: true },
      { name: "С рефералов", value: money(referralEarned._sum.amount || 0), inline: true }
    );

  return interaction.reply({ embeds: [e], ephemeral: true });
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

  return interaction.reply({
    embeds: [embed(LS_THEME.green).setTitle("📜 История операций").setDescription(text.slice(0, 4000))],
    ephemeral: true,
  });
}

async function showTop(interaction) {
  const users = await prisma.user.findMany({ orderBy: { balance: "desc" }, take: 10 });

  if (!users.length) {
    return interaction.reply({ content: "Рейтинг пока пуст.", ephemeral: true });
  }

  const medals = ["🥇", "🥈", "🥉"];
  const text = users
    .map((u, i) => `${medals[i] || `#${i + 1}`} <@${u.discordId}> — **${money(u.balance)}**`)
    .join("\n");

  return interaction.reply({
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
    return interaction.reply({ content: "У тебя пока нет ставок.", ephemeral: true });
  }

  const text = bets
    .map((b) => {
      const status = b.status === "ACTIVE" ? "🟢 Активна" : b.status === "WON" ? "✅ Выиграла" : "❌ Проиграла";
      return `**#${b.id} — ${b.event.title}**\nИсход: ${b.option.title}\nСумма: ${money(
        b.amount
      )}\nВозможный выигрыш: ${money(b.potentialWin)}\nСтатус: ${status}`;
    })
    .join("\n\n");

  return interaction.reply({
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
    return interaction.reply({ content: "Сейчас нет активных событий LS Bet.", ephemeral: true });
  }

  const embeds = [];
  const components = [];

  for (const event of events) {
    embeds.push(eventEmbeds(event)[0]);
    components.push(eventButtons(event)[0]);
  }

  return interaction.reply({ embeds, components, ephemeral: true });
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

  if (prefix === "withdraw" && process.env.WITHDRAW_CATEGORY_ID) {
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

  const channel = await createTicketChannel(interaction, "topup", request.id);

  await prisma.topUpRequest.update({
    where: { id: request.id },
    data: { ticketChannelId: channel.id },
  });

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

  return interaction.reply({
    content: `✅ Заявка создана: <#${channel.id}>. Загрузи туда скриншот перевода.`,
    ephemeral: true,
  });
}

async function createWithdrawTicket(interaction, login, amount, details, comment) {
  const user = await userOf(interaction.user);

  if (!Number.isInteger(amount) || amount <= 0) {
    return interaction.reply({ content: "Введи корректную сумму вывода.", ephemeral: true });
  }

  if (user.balance < amount) {
    return interaction.reply({ content: `Недостаточно средств. Баланс: **${money(user.balance)}**.`, ephemeral: true });
  }

  const commission = Math.floor((amount * WITHDRAW_COMMISSION_PERCENT) / 100);
  const payoutAmount = amount - commission;

  const request = await prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id: user.id }, data: { balance: { decrement: amount } } });

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

  const channel = await createTicketChannel(interaction, "withdraw", request.id);

  await prisma.withdrawRequest.update({
    where: { id: request.id },
    data: { ticketChannelId: channel.id },
  });

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

  return interaction.reply({
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
    return interaction.reply({
      content: "Заявка не найдена.",
      ephemeral: true,
    });
  }

  if (request.status === "APPROVED") {
    return interaction.reply({
      content: "Эта заявка уже одобрена.",
      ephemeral: true,
    });
  }

  if (request.status === "REJECTED") {
    return interaction.reply({
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

  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: {
        id: request.userId,
      },
      data: {
        balance: {
          increment: request.amount,
        },
      },
    });

    await tx.topUpRequest.update({
      where: {
        id: request.id,
      },
      data: {
        status: "APPROVED",
        processedBy: interaction.user.id,
        processedAt: new Date(),
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
  });

  if (request.ticketChannelId) {
    const ticketChannel = await client.channels
      .fetch(request.ticketChannelId)
      .catch(() => null);

    if (ticketChannel?.isTextBased()) {
      await ticketChannel.send({
        content:
          `✅ <@${request.user.discordId}>, заявка **#${request.id}** одобрена.\n` +
          `На баланс начислено **${money(request.amount)}**.`,
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

  return interaction.reply({
    content:
      `✅ Заявка #${request.id} одобрена. Игроку начислено **${money(
        request.amount
      )}**.` +
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
    return interaction.reply({
      content: "Заявка не найдена.",
      ephemeral: true,
    });
  }

  if (request.status === "APPROVED" || request.status === "REJECTED") {
    return interaction.reply({
      content: "Эта заявка уже обработана.",
      ephemeral: true,
    });
  }

  await prisma.topUpRequest.update({
    where: {
      id: request.id,
    },
    data: {
      status: "REJECTED",
      processedBy: interaction.user.id,
      processedAt: new Date(),
    },
  });

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

  return interaction.reply({
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
    return interaction.reply({
      content: "Заявка на вывод не найдена.",
      ephemeral: true,
    });
  }

  if (request.status !== "PENDING") {
    return interaction.reply({
      content: "Эта заявка уже обработана.",
      ephemeral: true,
    });
  }

  await prisma.$transaction([
    prisma.withdrawRequest.update({
      where: {
        id: request.id,
      },
      data: {
        status: "APPROVED",
        processedBy: interaction.user.id,
        processedAt: new Date(),
      },
    }),

    prisma.transaction.create({
      data: {
        userId: request.userId,
        amount: 0,
        type: "WITHDRAW_APPROVED",
        comment: `Вывод #${request.id} одобрен. Сумма: ${money(
          request.amount
        )}. Комиссия: ${money(request.commission)}. К получению: ${money(
          request.payoutAmount
        )}`,
      },
    }),
  ]);

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

  return interaction.reply({
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
    return interaction.reply({
      content: "Заявка на вывод не найдена.",
      ephemeral: true,
    });
  }

  if (request.status !== "PENDING") {
    return interaction.reply({
      content: "Эта заявка уже обработана.",
      ephemeral: true,
    });
  }

  await prisma.$transaction([
    prisma.withdrawRequest.update({
      where: {
        id: request.id,
      },
      data: {
        status: "REJECTED",
        processedBy: interaction.user.id,
        processedAt: new Date(),
      },
    }),

    prisma.user.update({
      where: {
        id: request.userId,
      },
      data: {
        balance: {
          increment: request.amount,
        },
      },
    }),

    prisma.transaction.create({
      data: {
        userId: request.userId,
        amount: request.amount,
        type: "WITHDRAW_REFUND",
        comment: `Возврат средств по отклонённому выводу #${request.id}`,
      },
    }),

    prisma.transaction.create({
      data: {
        userId: request.userId,
        amount: 0,
        type: "WITHDRAW_REJECTED",
        comment: `Вывод #${request.id} отклонён модератором ${interaction.user.username}`,
      },
    }),
  ]);

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

  return interaction.reply({
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
    return interaction.reply({
      content: "Заявка не найдена.",
      ephemeral: true,
    });
  }

  const isOwner = request.user.discordId === interaction.user.id;
  const isModerator = isAdmin(interaction);

  if (!isOwner && !isModerator) {
    return interaction.reply({
      content: "⛔ Закрыть этот тикет может только владелец заявки или модератор.",
      ephemeral: true,
    });
  }

  await interaction.reply({
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
    return interaction.reply({
      content: "Заявка на вывод не найдена.",
      ephemeral: true,
    });
  }

  const isOwner = request.user.discordId === interaction.user.id;
  const isModerator = isAdmin(interaction);

  if (!isOwner && !isModerator) {
    return interaction.reply({
      content: "⛔ Закрыть этот тикет может только владелец заявки или модератор.",
      ephemeral: true,
    });
  }

  await interaction.reply({
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
    return interaction.reply({
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
        .setDisabled(request.status !== "PENDING"),

      new ButtonBuilder()
        .setCustomId(`topup_reject:${request.id}`)
        .setLabel(`❌ Отклонить #${request.id}`)
        .setStyle(ButtonStyle.Danger)
        .setDisabled(request.status !== "PENDING")
    );

    components.push(row);
  }

  return interaction.reply({
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
    return interaction.reply({
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

  return interaction.reply({
    embeds,
    components,
    ephemeral: true,
  });
}

async function showEventStats(interaction, eventId) {
  const event = await fullEvent(eventId);

  if (!event) {
    return interaction.reply({
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

  return interaction.reply({
    embeds: [e],
    ephemeral: true,
  });
}

async function showAdminEvents(interaction) {
  if (await adminOnly(interaction)) return;

  const events = await prisma.rpEvent.findMany({
    where: {
      status: {
        in: ["OPEN", "LIVE"],
      },
    },
    orderBy: {
      id: "desc",
    },
    take: 5,
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

  if (events.length === 0) {
    return interaction.reply({
      content: "Сейчас нет активных событий.",
      ephemeral: true,
    });
  }

  const embeds = [];
  const components = [];

  for (const event of events) {
    const option1 = event.options[0];
    const option2 = event.options[1];

    const e = embed(
      event.status === "OPEN" ? LS_THEME.green : LS_THEME.red
    )
      .setTitle(`Событие #${event.id}: ${event.title}`)
      .setDescription(
        [
          `**Статус:** ${statusEvent(event.status)}`,
          `**Банк:** ${money(eventBank(event))}`,
          `**Закрытие ставок:** <t:${unix(event.closesAt)}:R>`,
          "",
          `1️⃣ ${option1 ? option1.title : "Исход 1"}`,
          `2️⃣ ${option2 ? option2.title : "Исход 2"}`,
        ].join("\n")
      );

    embeds.push(e);

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`admin_live:${event.id}`)
        .setLabel("🔴 LIVE")
        .setStyle(ButtonStyle.Danger)
        .setDisabled(event.status !== "OPEN"),

      new ButtonBuilder()
        .setCustomId(`admin_finish:${event.id}:1`)
        .setLabel("🏆 Победил 1")
        .setStyle(ButtonStyle.Success),

      new ButtonBuilder()
        .setCustomId(`admin_finish:${event.id}:2`)
        .setLabel("🏆 Победил 2")
        .setStyle(ButtonStyle.Success),

      new ButtonBuilder()
        .setCustomId(`admin_refresh:${event.id}`)
        .setLabel("🔄 Обновить")
        .setStyle(ButtonStyle.Secondary)
    );

    components.push(row);
  }

  return interaction.reply({
    embeds,
    components,
    ephemeral: true,
  });
}

async function showUserInfo(interaction, targetDiscordUser) {
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
    return interaction.reply({
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

  return interaction.reply({
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
    return interaction.reply({
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

  return interaction.reply({
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
    return interaction.reply({
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

  return interaction.reply({
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
    return interaction.reply({
      content: "Событие не найдено.",
      ephemeral: true,
    });
  }

  if (event.status !== "OPEN") {
    return interaction.reply({
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

  return interaction.reply({
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
    return interaction.reply({
      content: "Событие не найдено.",
      ephemeral: true,
    });
  }

  if (event.status === "FINISHED") {
    return interaction.reply({
      content: "Это событие уже завершено.",
      ephemeral: true,
    });
  }

  const winnerOption = event.options[winnerNumber - 1];

  if (!winnerOption) {
    return interaction.reply({
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

  return interaction.reply({
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
    return interaction.reply({
      content: `🪙 Coinflip можно создавать только в канале <#${COINFLIP_CHANNEL_ID}>.`,
      ephemeral: true,
    });
  }

  if (!Number.isInteger(amount) || amount <= 0) {
    return interaction.reply({
      content: "Введи корректную сумму.",
      ephemeral: true,
    });
  }

  const user = await userOf(interaction.user);

  if (user.balance < amount) {
    return interaction.reply({
      content: `Недостаточно средств. Твой баланс: **${money(user.balance)}**.`,
      ephemeral: true,
    });
  }

  const game = await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: {
        id: user.id,
      },
      data: {
        balance: {
          decrement: amount,
        },
      },
    });

    await tx.transaction.create({
      data: {
        userId: user.id,
        amount: -amount,
        type: "COINFLIP_CREATE",
        comment: `Создание Coinflip на ${coinSideName(side)}`,
      },
    });

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

  return interaction.reply({
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
    return interaction.reply({
      content: "Coinflip не найден.",
      ephemeral: true,
    });
  }

  if (game.status !== "WAITING") {
    return interaction.reply({
      content: "Эта игра уже недоступна.",
      ephemeral: true,
    });
  }

  if (game.creator.discordId === interaction.user.id) {
    return interaction.reply({
      content: "Нельзя принять свою же игру.",
      ephemeral: true,
    });
  }

  const opponent = await userOf(interaction.user);

  if (opponent.balance < game.amount) {
    return interaction.reply({
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

  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: {
        id: opponent.id,
      },
      data: {
        balance: {
          decrement: game.amount,
        },
      },
    });

    await tx.transaction.create({
      data: {
        userId: opponent.id,
        amount: -game.amount,
        type: "COINFLIP_ACCEPT",
        comment: `Принятие Coinflip #${game.id}`,
      },
    });

    await tx.user.update({
      where: {
        id: winnerUserId,
      },
      data: {
        balance: {
          increment: bank,
        },
      },
    });

    await tx.transaction.create({
      data: {
        userId: winnerUserId,
        amount: bank,
        type: "COINFLIP_WIN",
        comment: `Победа в Coinflip #${game.id}. Выпало: ${coinSideName(
          resultSide
        )}`,
      },
    });

    await tx.coinflipGame.update({
      where: {
        id: game.id,
      },
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

  await updateCoinflipMessage(game.id);

  return interaction.reply({
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
    return interaction.reply({
      content: "Coinflip не найден.",
      ephemeral: true,
    });
  }

  if (game.status !== "WAITING") {
    return interaction.reply({
      content: "Эту игру уже нельзя отменить.",
      ephemeral: true,
    });
  }

  const isOwner = game.creator.discordId === interaction.user.id;
  const isModerator = isAdmin(interaction);

  if (!isOwner && !isModerator) {
    return interaction.reply({
      content: "Отменить Coinflip может только создатель или модератор.",
      ephemeral: true,
    });
  }

  await prisma.$transaction([
    prisma.user.update({
      where: {
        id: game.creatorUserId,
      },
      data: {
        balance: {
          increment: game.amount,
        },
      },
    }),

    prisma.transaction.create({
      data: {
        userId: game.creatorUserId,
        amount: game.amount,
        type: "COINFLIP_REFUND",
        comment: `Возврат за отмену Coinflip #${game.id}`,
      },
    }),

    prisma.coinflipGame.update({
      where: {
        id: game.id,
      },
      data: {
        status: "CANCELLED",
        finishedAt: new Date(),
      },
    }),
  ]);

  await updateCoinflipMessage(game.id);

  return interaction.reply({
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
    return interaction.reply({
      content: "Код должен быть минимум 3 символа.",
      ephemeral: true,
    });
  }

  if (!Number.isInteger(amount) || amount <= 0) {
    return interaction.reply({
      content: "Введи корректную сумму промокода.",
      ephemeral: true,
    });
  }

  if (maxUses !== null && (!Number.isInteger(maxUses) || maxUses <= 0)) {
    return interaction.reply({
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

    return interaction.reply({
      content: `✅ Обычный промокод **${promo.code}** создан. Сумма: **${money(
        amount
      )}**.`,
      ephemeral: true,
    });
  } catch (error) {
    return interaction.reply({
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
    return interaction.reply({
      content: "Код должен быть минимум 3 символа.",
      ephemeral: true,
    });
  }

  if (!ownerDiscordId || !/^\d+$/.test(ownerDiscordId)) {
    return interaction.reply({
      content: "Введи корректный Discord ID владельца.",
      ephemeral: true,
    });
  }

  if (!Number.isInteger(amount) || amount < 0) {
    return interaction.reply({
      content: "Бонус новому игроку должен быть числом 0 или больше.",
      ephemeral: true,
    });
  }

  if (!Number.isInteger(refPercent) || refPercent < 1 || refPercent > 100) {
    return interaction.reply({
      content: "Процент рефереру должен быть от 1 до 100.",
      ephemeral: true,
    });
  }

  if (maxUses !== null && (!Number.isInteger(maxUses) || maxUses <= 0)) {
    return interaction.reply({
      content: "Лимит активаций должен быть числом больше 0.",
      ephemeral: true,
    });
  }

  const ownerDiscordUser = await client.users
    .fetch(ownerDiscordId)
    .catch(() => null);

  if (!ownerDiscordUser) {
    return interaction.reply({
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

    return interaction.reply({
      content:
        `✅ Реферальный промокод **${promo.code}** создан.\n` +
        `Владелец: <@${ownerDiscordId}>\n` +
        `Бонус новому игроку: **${money(amount)}**\n` +
        `Процент с пополнений: **${refPercent}%**`,
      ephemeral: true,
    });
  } catch (error) {
    return interaction.reply({
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
    return interaction.reply({
      content: `❌ Промокод **${code}** не найден.`,
      ephemeral: true,
    });
  }

  const data = {};
  const changes = [];

  if (String(amountRaw || "").trim() !== "") {
    const amount = Number(amountRaw);

    if (!Number.isInteger(amount) || amount < 0) {
      return interaction.reply({
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
      return interaction.reply({
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
      return interaction.reply({
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
        return interaction.reply({
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
        return interaction.reply({
          content: "❌ Процент рефералки должен быть от 1 до 100.",
          ephemeral: true,
        });
      }

      const ownerDiscordUser = await client.users
        .fetch(ownerDiscordId)
        .catch(() => null);

      if (!ownerDiscordUser) {
        return interaction.reply({
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
    return interaction.reply({
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

  return interaction.reply({
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
    return interaction.reply({
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

  return interaction.reply({
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
    return interaction.reply({
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

  return interaction.reply({
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
    return interaction.reply({
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

  return interaction.reply({
    embeds: [e],
    ephemeral: true,
  });
}

async function activatePromoCode(interaction, codeRaw) {
  const member = interaction.member;

  if (!member?.joinedTimestamp) {
    return interaction.reply({
      content:
        "Не удалось проверить дату входа на сервер. Проверь, что включён Server Members Intent.",
      ephemeral: true,
    });
  }

  const joinedAt = member.joinedTimestamp;
  const maxAgeMs = PROMO_NEW_USER_DAYS * 24 * 60 * 60 * 1000;

  if (Date.now() - joinedAt > maxAgeMs) {
    return interaction.reply({
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
    return interaction.reply({
      content: "Промокод не найден или уже выключен.",
      ephemeral: true,
    });
  }

  if (promo.maxUses && promo.usesCount >= promo.maxUses) {
    return interaction.reply({
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
    return interaction.reply({
      content: "Ты уже активировал этот промокод.",
      ephemeral: true,
    });
  }

  if (promo.type === "REFERRAL") {
    if (!promo.ownerUserId || !promo.owner) {
      return interaction.reply({
        content: "У этого реферального промокода не найден владелец.",
        ephemeral: true,
      });
    }

    if (promo.ownerUserId === user.id) {
      return interaction.reply({
        content: "Нельзя активировать свой собственный реферальный промокод.",
        ephemeral: true,
      });
    }

    if (user.referredByUserId && user.referredByUserId !== promo.ownerUserId) {
      return interaction.reply({
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

  return interaction.reply({
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
  const user = await userOf(interaction.user);

  const activeCount = await prisma.lotteryTicket.count({
    where: {
      userId: user.id,
      status: "ACTIVE",
    },
  });

  if (activeCount >= LOTTERY_MAX_TICKETS_PER_DRAW) {
    return interaction.reply({
      content: `⛔ У тебя уже максимум активных билетов: **${LOTTERY_MAX_TICKETS_PER_DRAW}**.`,
      ephemeral: true,
    });
  }

  if (user.balance < LOTTERY_TICKET_PRICE) {
    return interaction.reply({
      content: `Недостаточно средств. Твой баланс: **${money(user.balance)}**.`,
      ephemeral: true,
    });
  }

  const ticket = await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: {
        id: user.id,
      },
      data: {
        balance: {
          decrement: LOTTERY_TICKET_PRICE,
        },
      },
    });

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

    return createdTicket;
  });

  return interaction.reply({
    content:
      `✅ **Билет куплен**\n\n` +
      `Билет: **#${ticket.id}**\n` +
      `Числа: ${formatLotteryNumbers(numbers)}\n` +
      `Цена: **${money(LOTTERY_TICKET_PRICE)}**\n\n` +
      `Ожидай ближайший розыгрыш.`,
    ephemeral: true,
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
    return interaction.reply({
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

  return interaction.reply({
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
    return interaction.reply({
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

  return interaction.reply({
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
    return interaction.reply({
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

  return interaction.reply({
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
    return interaction.reply({
      content: "Активных билетов для розыгрыша нет.",
      ephemeral: true,
    });
  }

  const resultNumbers = generateLotteryNumbers();
  const resultNumbersString = numbersToString(resultNumbers);

  let winnersCount = 0;
  let totalPaid = 0;

  const draw = await prisma.$transaction(async (tx) => {
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

  return interaction.reply({
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

  setInterval(async () => {
    try {
      await closeExpiredEvents();
    } catch (error) {
      console.error("Ошибка авто-закрытия событий:", error);
    }
  }, 60 * 1000);
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
      await message.reply("📎 Прикрепи скриншот перевода файлом или картинкой.");
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
  } catch (error) {
    console.error("Ошибка обработки скриншота:", error);
  }
});

client.on(Events.InteractionCreate, async (interaction) => {
  try {
    if (interaction.isChatInputCommand()) {
      if (interaction.commandName === "panel") {
        if (await adminOnly(interaction)) return;
        return interaction.reply(mainPanel());
      }

      if (interaction.commandName === "admin_panel") {
        if (await adminOnly(interaction)) return;
        return interaction.reply(adminPanel());
      }

      if (interaction.commandName === "user_info") {
        if (await adminOnly(interaction)) return;

        await interaction.deferReply({
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
          return interaction.reply({
            content: `⛔ Создавать RP-события можно только в канале <#${EVENT_CHANNEL_ID}>.`,
            ephemeral: true,
          });
        }

        const title = interaction.options.getString("title");
        const description = interaction.options.getString("description");
        const option1 = interaction.options.getString("option1");
        const odds1 = interaction.options.getNumber("odds1");
        const image1 = interaction.options.getAttachment("image1");
        const option2 = interaction.options.getString("option2");
        const odds2 = interaction.options.getNumber("odds2");
        const image2 = interaction.options.getAttachment("image2");
        const minutes = interaction.options.getInteger("minutes");

        if (odds1 <= 1 || odds2 <= 1) {
          return interaction.reply({
            content: "Коэффициент должен быть больше 1.00.",
            ephemeral: true,
          });
        }

        if (minutes <= 0) {
          return interaction.reply({
            content: "Время закрытия ставок должно быть больше 0 минут.",
            ephemeral: true,
          });
        }

        const eventChannel = await client.channels.fetch(EVENT_CHANNEL_ID);

        if (!eventChannel || !eventChannel.isTextBased()) {
          return interaction.reply({
            content:
              "⛔ Канал для публикации RP-событий не найден или бот не может туда писать.",
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
                {
                  title: option1,
                  odds: odds1,
                  imageUrl: image1.url,
                },
                {
                  title: option2,
                  odds: odds2,
                  imageUrl: image2.url,
                },
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

        return interaction.reply({
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

      if (interaction.commandName === "add_balance") {
        if (await adminOnly(interaction)) return;

        const targetDiscordUser = interaction.options.getUser("user");
        const amount = interaction.options.getInteger("amount");

        if (!amount || amount <= 0) {
          return interaction.reply({
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

        return interaction.reply({
          content: `✅ <@${targetDiscordUser.id}> начислено **${money(amount)}**.`,
        });
      }
    }

    if (interaction.isButton()) {
      if (interaction.customId === "admin_events") {
        return showAdminEvents(interaction);
      }

      if (interaction.customId === "admin_topups") {
        return showAdminTopUps(interaction);
      }

      if (interaction.customId === "admin_withdraws") {
        return showAdminWithdraws(interaction);
      }

      if (interaction.customId === "admin_promos") {
        if (await adminOnly(interaction)) return;
        return interaction.reply(adminPromoPanel());
      }

      if (interaction.customId === "admin_lottery") {
        if (await adminOnly(interaction)) return;
        return interaction.reply(adminLotteryPanel());
      }

      if (interaction.customId === "admin_public_panel") {
        if (await adminOnly(interaction)) return;

        await interaction.channel.send(mainPanel());

        return interaction.reply({
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

        return interaction.reply({
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

      if (interaction.customId === "panel_profile") {
        return showProfile(interaction);
      }

      if (interaction.customId === "panel_events") {
        return showEvents(interaction);
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
          return interaction.reply({
            content: `🪙 Coinflip доступен только в канале <#${COINFLIP_CHANNEL_ID}>.`,
            ephemeral: true,
          });
        }

        return interaction.reply(coinflipPanel());
      }

      if (interaction.customId === "panel_lottery") {
        return interaction.reply(lotteryPanel());
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

        const event = await prisma.rpEvent.findUnique({
          where: {
            id: eventId,
          },
          include: {
            options: true,
          },
        });

        if (!event) {
          return interaction.reply({
            content: "Событие не найдено.",
            ephemeral: true,
          });
        }

        if (event.status !== "OPEN" || isEventClosed(event)) {
          await closeExpiredEvents();

          return interaction.reply({
            content: "Ставки на это событие уже закрыты.",
            ephemeral: true,
          });
        }

        const option = event.options.find((item) => item.id === optionId);

        if (!option) {
          return interaction.reply({
            content: "Исход не найден.",
            ephemeral: true,
          });
        }

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
        const raw = interaction.fields.getTextInputValue("numbers");
        const parsed = parseLotteryNumbers(raw);

        if (!parsed.ok) {
          return interaction.reply({
            content: `❌ ${parsed.error}`,
            ephemeral: true,
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
          return interaction.reply({
            content: "Введи корректную сумму пополнения.",
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

      if (!interaction.customId.startsWith("bet_modal:")) return;

      const [, eventIdRaw, optionIdRaw] = interaction.customId.split(":");

      const eventId = Number(eventIdRaw);
      const optionId = Number(optionIdRaw);
      const amount = Number(interaction.fields.getTextInputValue("amount"));

      if (!Number.isInteger(amount) || amount <= 0) {
        return interaction.reply({
          content: "Введи корректную сумму ставки.",
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
        return interaction.reply({
          content: "Событие не найдено.",
          ephemeral: true,
        });
      }

      if (event.status !== "OPEN" || isEventClosed(event)) {
        await closeExpiredEvents();

        return interaction.reply({
          content: "Ставки на это событие уже закрыты.",
          ephemeral: true,
        });
      }

      const option = event.options.find((item) => item.id === optionId);

      if (!option) {
        return interaction.reply({
          content: "Исход не найден.",
          ephemeral: true,
        });
      }

      if (user.balance < amount) {
        return interaction.reply({
          content: `Недостаточно средств. Твой баланс: **${money(
            user.balance
          )}**.`,
          ephemeral: true,
        });
      }

      const potentialWin = Math.floor(amount * option.odds);

      await prisma.$transaction([
        prisma.user.update({
          where: {
            id: user.id,
          },
          data: {
            balance: {
              decrement: amount,
            },
          },
        }),

        prisma.bet.create({
          data: {
            userId: user.id,
            eventId,
            optionId,
            amount,
            potentialWin,
            status: "ACTIVE",
          },
        }),

        prisma.transaction.create({
          data: {
            userId: user.id,
            amount: -amount,
            type: "EVENT_BET",
            comment: `Ставка на событие "${event.title}". Исход: ${
              option.title
            }. Возможный выигрыш: ${money(potentialWin)}`,
          },
        }),
      ]);

      await updateEventMessage(eventId);

      return interaction.reply({
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
    console.error(error);

    if (interaction.replied || interaction.deferred) {
      return interaction.followUp({
        content: "Произошла ошибка. Посмотри консоль.",
        ephemeral: true,
      });
    }

    return interaction.reply({
      content: "Произошла ошибка. Посмотри консоль.",
      ephemeral: true,
    });
  }
});

client.login(process.env.DISCORD_TOKEN);