require("dotenv").config();

const { execSync } = require("child_process");

try {
  console.log("🔧 Prisma generate...");
  execSync("npx prisma generate --schema=prisma/schema.prisma", {
    stdio: "inherit",
  });

  console.log("🔧 Prisma db push...");
  execSync("npx prisma db push --schema=prisma/schema.prisma", {
    stdio: "inherit",
  });

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

const START_BALANCE = Number(process.env.START_BALANCE || 1000);
const EVENT_CHANNEL_ID = process.env.EVENT_CHANNEL_ID || "1510916382395600936";
const RESULT_CHANNEL_ID =
  process.env.RESULT_CHANNEL_ID || "1510928118527950888";
const COINFLIP_CHANNEL_ID =
  process.env.COINFLIP_CHANNEL_ID || "1511707250668863578";
const PROMO_NEW_USER_DAYS = Number(process.env.PROMO_NEW_USER_DAYS || 3);
const WITHDRAW_COMMISSION_PERCENT = Number(
  process.env.WITHDRAW_COMMISSION_PERCENT || 5
);

const LS_THEME = {
  green: 0x18d875,
  gold: 0xf4c542,
  red: 0xff3333,
  blue: 0x60a5fa,
};

const LS_TEXT = {
  footer: "LS Bet • Events • Live Bets • Coinflip",
  line: "━━━━━━━━━━━━━━━━━━━━",
};

function createBaseEmbed(color = LS_THEME.green) {
  return new EmbedBuilder()
    .setColor(color)
    .setTimestamp()
    .setFooter({ text: LS_TEXT.footer });
}

function formatMoney(amount) {
  return `$${Number(amount || 0).toLocaleString("en-US")}`;
}

function getUnixTime(date) {
  return Math.floor(new Date(date).getTime() / 1000);
}

function getModRoleId() {
  return process.env.MOD_ROLE_ID || process.env.ADMIN_ROLE_ID || null;
}

function getStatusName(status) {
  if (status === "OPEN") return "🟢 OPEN";
  if (status === "LIVE") return "🔴 LIVE";
  if (status === "FINISHED") return "🏁 FINISHED";
  return status;
}

function getBetStatusName(status) {
  if (status === "ACTIVE") return "🟢 Активна";
  if (status === "WON") return "✅ Выиграла";
  if (status === "LOST") return "❌ Проиграла";
  return status;
}

function getTopUpStatusName(status) {
  if (status === "WAITING_SCREENSHOT") return "📎 Ожидает скриншот";
  if (status === "PENDING") return "⏳ На проверке";
  if (status === "APPROVED") return "✅ Одобрено";
  if (status === "REJECTED") return "❌ Отклонено";
  return status;
}

function getWithdrawStatusName(status) {
  if (status === "PENDING") return "⏳ На проверке";
  if (status === "APPROVED") return "✅ Одобрено";
  if (status === "REJECTED") return "❌ Отклонено";
  return status;
}

function transactionTypeName(type) {
  if (type === "EVENT_BET") return "Ставка";
  if (type === "EVENT_WIN") return "Выигрыш";
  if (type === "ADMIN_ADD") return "Начисление админа";
  if (type === "TOPUP_APPROVED") return "Пополнение";
  if (type === "COINFLIP_CREATE") return "Coinflip создан";
  if (type === "COINFLIP_ACCEPT") return "Coinflip принят";
  if (type === "COINFLIP_WIN") return "Coinflip выигрыш";
  if (type === "COINFLIP_REFUND") return "Coinflip возврат";
  if (type === "PROMO_ACTIVATED") return "Промокод";
  if (type === "REFERRAL_BONUS") return "Реферальный бонус";
  if (type === "WITHDRAW_REQUEST") return "Заявка на вывод";
  if (type === "WITHDRAW_APPROVED") return "Вывод одобрен";
  if (type === "WITHDRAW_REJECTED") return "Вывод отклонён";
  if (type === "WITHDRAW_REFUND") return "Возврат вывода";
  return type;
}

function isEventClosed(event) {
  return new Date(event.closesAt).getTime() <= Date.now();
}

function isAdmin(interaction) {
  if (interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
    return true;
  }

  const adminRoleId = process.env.ADMIN_ROLE_ID;
  const modRoleId = process.env.MOD_ROLE_ID;

  if (adminRoleId && interaction.member?.roles?.cache?.has(adminRoleId)) {
    return true;
  }

  if (modRoleId && interaction.member?.roles?.cache?.has(modRoleId)) {
    return true;
  }

  return false;
}

async function adminOnly(interaction) {
  if (isAdmin(interaction)) return false;

  await interaction.reply({
    content: "⛔ Эта команда доступна только администрации.",
    ephemeral: true,
  });

  return true;
}

async function getOrCreateUser(discordUser) {
  return prisma.user.upsert({
    where: { discordId: discordUser.id },
    update: { username: discordUser.username },
    create: {
      discordId: discordUser.id,
      username: discordUser.username,
      balance: START_BALANCE,
    },
  });
}

async function sendLog(type, title, description, fields = []) {
  try {
    await prisma.botLog.create({
      data: {
        type,
        message: `${title}\n${description || ""}`,
      },
    });
  } catch (error) {
    console.error("Ошибка записи BotLog:", error.message);
  }

  const logChannelId = process.env.LOG_CHANNEL_ID;
  if (!logChannelId) return;

  try {
    const channel = await client.channels.fetch(logChannelId);
    if (!channel) return;

    const embed = createBaseEmbed(LS_THEME.green)
      .setTitle(title)
      .setDescription(description || "Без описания");

    if (fields.length > 0) embed.addFields(fields);

    await channel.send({ embeds: [embed] });
  } catch (error) {
    console.error("Не смог отправить лог:", error.message);
  }
}

function getOptionBetTotal(option) {
  if (!option.bets) return 0;

  return option.bets
    .filter((bet) => bet.status === "ACTIVE")
    .reduce((sum, bet) => sum + bet.amount, 0);
}

function getEventBank(event) {
  if (!event.options) return 0;

  return event.options.reduce((sum, option) => {
    return sum + getOptionBetTotal(option);
  }, 0);
}

async function getFullEvent(eventId) {
  return prisma.rpEvent.findUnique({
    where: { id: eventId },
    include: {
      options: {
        orderBy: { id: "asc" },
        include: { bets: true },
      },
    },
  });
}

function buildMainPanel() {
  const embed = createBaseEmbed(LS_THEME.green)
    .setTitle("💚 LS Bet — Главное меню")
    .setDescription(
      [
        "```",
        "LS BET PLATFORM",
        "EVENTS • LIVE BETS • COINFLIP • PROMO",
        "```",
        "**Добро пожаловать в LS Bet.**",
        "",
        "Здесь ты можешь участвовать в RP-событиях, делать ставки, играть в Coinflip, активировать промокоды, пополнять и выводить баланс.",
        "",
        LS_TEXT.line,
      ].join("\n")
    )
    .addFields(
      {
        name: "🎰 RP-события",
        value: "Афиши, коэффициенты, LIVE-ставки и результаты.",
        inline: true,
      },
      {
        name: "🪙 Coinflip",
        value: "Быстрая дуэль между двумя игроками.",
        inline: true,
      },
      {
        name: "💰 Баланс",
        value: "Пополнение, вывод, история операций и профиль.",
        inline: true,
      }
    );

  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("panel_profile")
      .setLabel("👤 Профиль")
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId("panel_events")
      .setLabel("🎰 RP-события")
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId("panel_mybets")
      .setLabel("🧾 Мои ставки")
      .setStyle(ButtonStyle.Secondary)
  );

  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("panel_coinflip")
      .setLabel("🪙 Coinflip")
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId("panel_promo")
      .setLabel("🎟️ Промокод")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId("panel_top")
      .setLabel("🏆 Top")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId("panel_history")
      .setLabel("📜 История")
      .setStyle(ButtonStyle.Secondary)
  );

  const row3 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("panel_topup")
      .setLabel("💰 Пополнить")
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId("panel_withdraw")
      .setLabel("💸 Вывести")
      .setStyle(ButtonStyle.Danger)
  );

  return { embeds: [embed], components: [row1, row2, row3] };
}

function buildAdminPanel() {
  const embed = createBaseEmbed(LS_THEME.gold)
    .setTitle("🛠️ LS Bet — Admin Panel")
    .setDescription(
      [
        "```",
        "ADMIN CONTROL CENTER",
        "EVENTS • TOPUPS • WITHDRAWS • PROMOS",
        "```",
        "**Панель управления LS Bet.**",
        "",
        LS_TEXT.line,
      ].join("\n")
    )
    .addFields(
      {
        name: "📢 События",
        value: "LIVE, завершение, обновление афиш.",
        inline: true,
      },
      {
        name: "💰 Заявки",
        value: "Проверка пополнений и выводов.",
        inline: true,
      },
      {
        name: "🎟️ Промокоды",
        value: "Обычные и реферальные промокоды.",
        inline: true,
      }
    );

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("admin_events")
      .setLabel("📢 События")
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId("admin_topups")
      .setLabel("💰 Заявки")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId("admin_withdraws")
      .setLabel("💸 Выводы")
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId("admin_promos")
      .setLabel("🎟️ Промокоды")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId("admin_public_panel")
      .setLabel("📌 Меню")
      .setStyle(ButtonStyle.Success)
  );

  return { embeds: [embed], components: [row], ephemeral: true };
}

function buildEventPoster(event) {
  const closesUnix = getUnixTime(event.closesAt);
  const eventBank = getEventBank(event);
  const isClosed = event.status !== "OPEN" || isEventClosed(event);

  const statusText = getStatusName(
    isClosed && event.status === "OPEN" ? "LIVE" : event.status
  );

  const mainEmbed = createBaseEmbed(
    event.status === "OPEN"
      ? LS_THEME.green
      : event.status === "LIVE"
      ? LS_THEME.red
      : LS_THEME.gold
  )
    .setTitle(`🎰 LS BET EVENT #${event.id}`)
    .setDescription(
      [
        `# ${event.title}`,
        "",
        event.description || "Описание события не указано.",
        "",
        LS_TEXT.line,
        `**Статус:** ${statusText}`,
        `**Закрытие ставок:** <t:${closesUnix}:R>`,
        `**Точное время:** <t:${closesUnix}:f>`,
        `**Банк события:** ${formatMoney(eventBank)}`,
        LS_TEXT.line,
      ].join("\n")
    );

  const optionEmbeds = event.options.map((option, index) => {
    const optionBank = getOptionBetTotal(option);

    const embed = createBaseEmbed(index === 0 ? LS_THEME.green : LS_THEME.gold)
      .setTitle(`${index === 0 ? "1️⃣" : "2️⃣"} ${option.title}`)
      .setDescription(
        [
          `**Коэффициент:** x${option.odds}`,
          `**Поставлено:** ${formatMoney(optionBank)}`,
        ].join("\n")
      );

    if (option.imageUrl) embed.setImage(option.imageUrl);

    return embed;
  });

  return [mainEmbed, ...optionEmbeds];
}

function buildEventButtons(event) {
  const disabled = event.status !== "OPEN" || isEventClosed(event);
  const betRow = new ActionRowBuilder();

  for (const option of event.options.slice(0, 2)) {
    betRow.addComponents(
      new ButtonBuilder()
        .setCustomId(`bet:${event.id}:${option.id}`)
        .setLabel(`💵 Поставить на ${option.title}`)
        .setStyle(ButtonStyle.Success)
        .setDisabled(disabled)
    );
  }

  const infoRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`event_stats:${event.id}`)
      .setLabel("📊 Статистика")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId("panel_profile")
      .setLabel("👤 Профиль")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId("panel_top")
      .setLabel("🏆 Top Winners")
      .setStyle(ButtonStyle.Secondary)
  );

  return [betRow, infoRow];
}

function buildCloseTicketRow(requestId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`ticket_close:${requestId}`)
      .setLabel("🔒 Закрыть тикет")
      .setStyle(ButtonStyle.Secondary)
  );
}

function buildCloseWithdrawTicketRow(requestId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`withdraw_ticket_close:${requestId}`)
      .setLabel("🔒 Закрыть тикет")
      .setStyle(ButtonStyle.Secondary)
  );
}

async function updateEventMessage(eventId) {
  const event = await getFullEvent(eventId);
  if (!event || !event.messageId || !event.channelId) return;

  try {
    const channel = await client.channels.fetch(event.channelId);
    const message = await channel.messages.fetch(event.messageId);

    await message.edit({
      content: "📢 **LS Bet афиша события**",
      embeds: buildEventPoster(event),
      components: buildEventButtons(event),
    });
  } catch (error) {
    console.error("Не смог обновить афишу:", error.message);
  }
}

async function closeExpiredEvents() {
  const expiredEvents = await prisma.rpEvent.findMany({
    where: {
      status: "OPEN",
      closesAt: { lte: new Date() },
    },
  });

  for (const event of expiredEvents) {
    await prisma.rpEvent.update({
      where: { id: event.id },
      data: { status: "LIVE" },
    });

    await updateEventMessage(event.id);

    await sendLog(
      "EVENT_AUTO_LIVE",
      "🔴 Событие автоматически переведено в LIVE",
      `Событие **#${event.id} ${event.title}** автоматически закрыто по таймеру.`
    );
  }
}

async function publishRpEventResult(event, winnerOption, winnersCount, totalPaid) {
  try {
    const resultChannel = await client.channels.fetch(RESULT_CHANNEL_ID);

    if (!resultChannel || !resultChannel.isTextBased()) {
      console.error("Канал результатов RP-событий не найден.");
      return;
    }

    const embed = createBaseEmbed(LS_THEME.gold)
      .setTitle("🏁 LS BET RESULT")
      .setDescription(
        [
          "```",
          "EVENT FINISHED",
          "```",
          `# ${event.title}`,
          "",
          LS_TEXT.line,
          `**ID события:** #${event.id}`,
          `**Победный исход:** ${winnerOption.title}`,
          `**Победителей:** ${winnersCount}`,
          `**Выплачено:** ${formatMoney(totalPaid)}`,
          LS_TEXT.line,
          "",
          "Спасибо за участие в LS Bet 💚",
        ].join("\n")
      );

    if (winnerOption.imageUrl) embed.setImage(winnerOption.imageUrl);

    await resultChannel.send({
      content: "🏁 **Итоги RP-события**",
      embeds: [embed],
    });
  } catch (error) {
    console.error("Не смог опубликовать результат:", error.message);
  }
}

async function showProfile(interaction) {
  const user = await getOrCreateUser(interaction.user);

  const totalBets = await prisma.bet.count({ where: { userId: user.id } });
  const activeBets = await prisma.bet.count({
    where: { userId: user.id, status: "ACTIVE" },
  });
  const wonBets = await prisma.bet.count({
    where: { userId: user.id, status: "WON" },
  });
  const lostBets = await prisma.bet.count({
    where: { userId: user.id, status: "LOST" },
  });
  const coinflipWins = await prisma.coinflipGame.count({
    where: { winnerUserId: user.id },
  });
  const referralsCount = await prisma.user.count({
    where: { referredByUserId: user.id },
  });
  const referralEarned = await prisma.referralReward.aggregate({
    where: { referrerId: user.id },
    _sum: { amount: true },
  });

  const winPercent =
    wonBets + lostBets > 0
      ? ((wonBets / (wonBets + lostBets)) * 100).toFixed(1)
      : "0.0";

  const embed = createBaseEmbed(LS_THEME.green)
    .setTitle("👤 LS Bet — Профиль игрока")
    .setThumbnail(interaction.user.displayAvatarURL())
    .setDescription(
      [
        "```",
        "PLAYER PROFILE",
        "```",
        `Игрок: <@${interaction.user.id}>`,
        LS_TEXT.line,
      ].join("\n")
    )
    .addFields(
      { name: "Баланс", value: formatMoney(user.balance), inline: true },
      { name: "Всего ставок", value: String(totalBets), inline: true },
      { name: "Активные ставки", value: String(activeBets), inline: true },
      { name: "Выиграно ставок", value: String(wonBets), inline: true },
      { name: "Coinflip побед", value: String(coinflipWins), inline: true },
      { name: "Процент побед", value: `${winPercent}%`, inline: true },
      { name: "Рефералов", value: String(referralsCount), inline: true },
      {
        name: "Заработано с рефералов",
        value: formatMoney(referralEarned._sum.amount || 0),
        inline: true,
      }
    );

  return interaction.reply({ embeds: [embed], ephemeral: true });
}

async function showHistory(interaction) {
  const user = await getOrCreateUser(interaction.user);

  const transactions = await prisma.transaction.findMany({
    where: { userId: user.id },
    orderBy: { id: "desc" },
    take: 8,
  });

  const topUps = await prisma.topUpRequest.findMany({
    where: { userId: user.id },
    orderBy: { id: "desc" },
    take: 5,
  });

  const withdraws = await prisma.withdrawRequest.findMany({
    where: { userId: user.id },
    orderBy: { id: "desc" },
    take: 5,
  });

  const transactionText =
    transactions.length === 0
      ? "Операций пока нет."
      : transactions
          .map((transaction) => {
            const sign = transaction.amount > 0 ? "+" : "";
            return [
              `**#${transaction.id} — ${transactionTypeName(
                transaction.type
              )}**`,
              `Сумма: ${sign}${formatMoney(transaction.amount)}`,
              `Комментарий: ${transaction.comment || "Без комментария"}`,
              `Дата: <t:${getUnixTime(transaction.createdAt)}:R>`,
            ].join("\n");
          })
          .join("\n\n");

  const topUpText =
    topUps.length === 0
      ? "Заявок на пополнение пока нет."
      : topUps
          .map((request) => {
            return [
              `**#${request.id} — ${getTopUpStatusName(request.status)}**`,
              `Логин: ${request.login}`,
              `Сумма: ${formatMoney(request.amount)}`,
              `Дата: <t:${getUnixTime(request.createdAt)}:R>`,
            ].join("\n");
          })
          .join("\n\n");

  const withdrawText =
    withdraws.length === 0
      ? "Заявок на вывод пока нет."
      : withdraws
          .map((request) => {
            return [
              `**#${request.id} — ${getWithdrawStatusName(request.status)}**`,
              `Сумма вывода: ${formatMoney(request.amount)}`,
              `Комиссия: ${formatMoney(request.commission)}`,
              `К получению: ${formatMoney(request.payoutAmount)}`,
              `Дата: <t:${getUnixTime(request.createdAt)}:R>`,
            ].join("\n");
          })
          .join("\n\n");

  const transactionsEmbed = createBaseEmbed(LS_THEME.green)
    .setTitle("📜 История операций")
    .setDescription(transactionText);

  const topUpsEmbed = createBaseEmbed(LS_THEME.gold)
    .setTitle("💰 История пополнений")
    .setDescription(topUpText);

  const withdrawEmbed = createBaseEmbed(LS_THEME.red)
    .setTitle("💸 История выводов")
    .setDescription(withdrawText);

  return interaction.reply({
    embeds: [transactionsEmbed, topUpsEmbed, withdrawEmbed],
    ephemeral: true,
  });
}

async function showTop(interaction) {
  const users = await prisma.user.findMany({
    orderBy: { balance: "desc" },
    take: 10,
  });

  if (users.length === 0) {
    return interaction.reply({
      content: "Рейтинг пока пуст.",
      ephemeral: true,
    });
  }

  const medals = ["🥇", "🥈", "🥉"];

  const text = users
    .map((user, index) => {
      const medal = medals[index] || `#${index + 1}`;
      return `${medal} <@${user.discordId}> — **${formatMoney(
        user.balance
      )}**`;
    })
    .join("\n");

  const embed = createBaseEmbed(LS_THEME.gold)
    .setTitle("🏆 LS Bet Top Winners")
    .setDescription(["```", "LEADERBOARD", "```", text].join("\n"));

  return interaction.reply({ embeds: [embed], ephemeral: true });
}

async function showMyBets(interaction) {
  const user = await getOrCreateUser(interaction.user);

  const bets = await prisma.bet.findMany({
    where: { userId: user.id },
    orderBy: { id: "desc" },
    take: 10,
    include: { event: true, option: true },
  });

  if (bets.length === 0) {
    return interaction.reply({
      content: "У тебя пока нет ставок.",
      ephemeral: true,
    });
  }

  const text = bets
    .map((bet) => {
      return [
        `**#${bet.id} — ${bet.event.title}**`,
        `Исход: ${bet.option.title}`,
        `Сумма: ${formatMoney(bet.amount)}`,
        `Возможный выигрыш: ${formatMoney(bet.potentialWin)}`,
        `Статус: ${getBetStatusName(bet.status)}`,
      ].join("\n");
    })
    .join("\n\n");

  const embed = createBaseEmbed(LS_THEME.green)
    .setTitle("🧾 Мои ставки")
    .setDescription(text);

  return interaction.reply({ embeds: [embed], ephemeral: true });
}

async function showEvents(interaction) {
  await closeExpiredEvents();
  await getOrCreateUser(interaction.user);

  const events = await prisma.rpEvent.findMany({
    where: { status: { in: ["OPEN", "LIVE"] } },
    orderBy: { id: "desc" },
    take: 3,
    include: {
      options: {
        orderBy: { id: "asc" },
        include: { bets: true },
      },
    },
  });

  if (events.length === 0) {
    return interaction.reply({
      content: "Сейчас нет активных событий LS Bet.",
      ephemeral: true,
    });
  }

  const embeds = [];
  const components = [];

  for (const event of events) {
    embeds.push(buildEventPoster(event)[0]);
    components.push(buildEventButtons(event)[0]);
  }

  return interaction.reply({ embeds, components, ephemeral: true });
}

function buildTopUpModal() {
  const modal = new ModalBuilder()
    .setCustomId("topup_modal")
    .setTitle("LS Bet — пополнение баланса");

  const loginInput = new TextInputBuilder()
    .setCustomId("login")
    .setLabel("Логин / ник на сервере")
    .setPlaceholder("Например: NICK")
    .setRequired(true)
    .setStyle(TextInputStyle.Short);

  const amountInput = new TextInputBuilder()
    .setCustomId("amount")
    .setLabel("Сумма пополнения в $")
    .setPlaceholder("Например: 5000")
    .setRequired(true)
    .setStyle(TextInputStyle.Short);

  const commentInput = new TextInputBuilder()
    .setCustomId("comment")
    .setLabel("Комментарий")
    .setPlaceholder("После создания тикета приложи скриншот перевода.")
    .setRequired(false)
    .setStyle(TextInputStyle.Paragraph);

  modal.addComponents(
    new ActionRowBuilder().addComponents(loginInput),
    new ActionRowBuilder().addComponents(amountInput),
    new ActionRowBuilder().addComponents(commentInput)
  );

  return modal;
}

function buildWithdrawModal() {
  const modal = new ModalBuilder()
    .setCustomId("withdraw_modal")
    .setTitle("LS Bet — вывод средств");

  const loginInput = new TextInputBuilder()
    .setCustomId("login")
    .setLabel("Логин / ник на сервере")
    .setPlaceholder("Например: NICK")
    .setRequired(true)
    .setStyle(TextInputStyle.Short);

  const amountInput = new TextInputBuilder()
    .setCustomId("amount")
    .setLabel("Сумма вывода в $")
    .setPlaceholder("Например: 5000")
    .setRequired(true)
    .setStyle(TextInputStyle.Short);

  const detailsInput = new TextInputBuilder()
    .setCustomId("details")
    .setLabel("Реквизиты / способ получения")
    .setPlaceholder("Куда отправить выплату")
    .setRequired(true)
    .setStyle(TextInputStyle.Paragraph);

  const commentInput = new TextInputBuilder()
    .setCustomId("comment")
    .setLabel("Комментарий")
    .setPlaceholder("Можно оставить пустым")
    .setRequired(false)
    .setStyle(TextInputStyle.Paragraph);

  modal.addComponents(
    new ActionRowBuilder().addComponents(loginInput),
    new ActionRowBuilder().addComponents(amountInput),
    new ActionRowBuilder().addComponents(detailsInput),
    new ActionRowBuilder().addComponents(commentInput)
  );

  return modal;
}

async function createTopUpTicket(interaction, login, amount, comment) {
  const user = await getOrCreateUser(interaction.user);
  const guild = interaction.guild;
  const modRoleId = getModRoleId();

  const request = await prisma.topUpRequest.create({
    data: {
      userId: user.id,
      login,
      amount,
      comment: comment || null,
      status: "WAITING_SCREENSHOT",
    },
  });

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

  const safeUsername = interaction.user.username
    .toLowerCase()
    .replace(/[^a-z0-9а-яё-]/gi, "-")
    .slice(0, 40);

  const channelOptions = {
    name: `topup-${request.id}-${safeUsername}`,
    type: ChannelType.GuildText,
    permissionOverwrites,
  };

  if (process.env.TOPUP_CATEGORY_ID) {
    channelOptions.parent = process.env.TOPUP_CATEGORY_ID;
  }

  const ticketChannel = await guild.channels.create(channelOptions);

  await prisma.topUpRequest.update({
    where: { id: request.id },
    data: { ticketChannelId: ticketChannel.id },
  });

  const embed = createBaseEmbed(LS_THEME.green)
    .setTitle(`💰 Заявка на пополнение #${request.id}`)
    .setDescription(
      [
        `<@${interaction.user.id}>, заявка создана.`,
        "",
        "**Теперь отправь в этот канал скриншот перевода.**",
        "",
        "После загрузки скриншота заявка уйдёт модераторам на проверку.",
      ].join("\n")
    )
    .addFields(
      { name: "Логин", value: login, inline: true },
      { name: "Сумма", value: formatMoney(amount), inline: true },
      { name: "Комментарий", value: comment || "Не указан", inline: false }
    );

  await ticketChannel.send({
    content: `<@${interaction.user.id}>`,
    embeds: [embed],
  });

  await sendLog(
    "TOPUP_CREATED",
    "💰 Создана заявка на пополнение",
    `Игрок <@${interaction.user.id}> создал заявку #${request.id}.`,
    [
      { name: "Логин", value: login, inline: true },
      { name: "Сумма", value: formatMoney(amount), inline: true },
      { name: "Ticket", value: `<#${ticketChannel.id}>`, inline: true },
    ]
  );

  return interaction.reply({
    content: `✅ Заявка создана: <#${ticketChannel.id}>. Загрузи туда скриншот перевода.`,
    ephemeral: true,
  });
}

async function createWithdrawTicket(interaction, login, amount, details, comment) {
  const user = await getOrCreateUser(interaction.user);

  if (!Number.isInteger(amount) || amount <= 0) {
    return interaction.reply({
      content: "Введи корректную сумму вывода.",
      ephemeral: true,
    });
  }

  if (user.balance < amount) {
    return interaction.reply({
      content: `Недостаточно средств. Твой баланс: **${formatMoney(
        user.balance
      )}**.`,
      ephemeral: true,
    });
  }

  const commission = Math.floor((amount * WITHDRAW_COMMISSION_PERCENT) / 100);
  const payoutAmount = amount - commission;

  if (payoutAmount <= 0) {
    return interaction.reply({
      content: "Сумма к получению после комиссии должна быть больше 0.",
      ephemeral: true,
    });
  }

  const guild = interaction.guild;
  const modRoleId = getModRoleId();

  const request = await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: user.id },
      data: { balance: { decrement: amount } },
    });

    const createdRequest = await tx.withdrawRequest.create({
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
        comment: `Заявка на вывод #${createdRequest.id}. Комиссия ${WITHDRAW_COMMISSION_PERCENT}%: ${formatMoney(
          commission
        )}. К получению: ${formatMoney(payoutAmount)}`,
      },
    });

    return createdRequest;
  });

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

  const safeUsername = interaction.user.username
    .toLowerCase()
    .replace(/[^a-z0-9а-яё-]/gi, "-")
    .slice(0, 40);

  const channelOptions = {
    name: `withdraw-${request.id}-${safeUsername}`,
    type: ChannelType.GuildText,
    permissionOverwrites,
  };

  if (process.env.WITHDRAW_CATEGORY_ID) {
    channelOptions.parent = process.env.WITHDRAW_CATEGORY_ID;
  } else if (process.env.TOPUP_CATEGORY_ID) {
    channelOptions.parent = process.env.TOPUP_CATEGORY_ID;
  }

  const ticketChannel = await guild.channels.create(channelOptions);

  await prisma.withdrawRequest.update({
    where: { id: request.id },
    data: { ticketChannelId: ticketChannel.id },
  });

  const embed = createBaseEmbed(LS_THEME.red)
    .setTitle(`💸 Заявка на вывод #${request.id}`)
    .setDescription(
      [
        `<@${interaction.user.id}>, заявка на вывод создана.`,
        "",
        `**Сумма вывода:** ${formatMoney(amount)}`,
        `**Комиссия LS Bet ${WITHDRAW_COMMISSION_PERCENT}%:** ${formatMoney(
          commission
        )}`,
        `**К получению:** ${formatMoney(payoutAmount)}`,
        "",
        "Сумма вывода уже списана с твоего баланса до решения администрации.",
        "Если заявку отклонят — сумма вернётся на баланс.",
      ].join("\n")
    )
    .addFields(
      { name: "Логин", value: login, inline: true },
      { name: "Реквизиты", value: details, inline: false },
      { name: "Комментарий", value: comment || "Не указан", inline: false }
    );

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`withdraw_approve:${request.id}`)
      .setLabel("✅ Одобрить")
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`withdraw_reject:${request.id}`)
      .setLabel("❌ Отклонить")
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId(`withdraw_ticket_close:${request.id}`)
      .setLabel("🔒 Закрыть тикет")
      .setStyle(ButtonStyle.Secondary)
  );

  await ticketChannel.send({
    content: `<@${interaction.user.id}>`,
    embeds: [embed],
    components: [row],
  });

  await sendLog(
    "WITHDRAW_CREATED",
    "💸 Создана заявка на вывод",
    `Игрок <@${interaction.user.id}> создал заявку на вывод #${request.id}.`,
    [
      { name: "Сумма вывода", value: formatMoney(amount), inline: true },
      { name: "Комиссия", value: formatMoney(commission), inline: true },
      { name: "К получению", value: formatMoney(payoutAmount), inline: true },
      { name: "Ticket", value: `<#${ticketChannel.id}>`, inline: true },
    ]
  );

  return interaction.reply({
    content:
      `✅ Заявка на вывод создана: <#${ticketChannel.id}>.\n` +
      `Сумма: **${formatMoney(amount)}**\n` +
      `Комиссия: **${formatMoney(commission)}**\n` +
      `К получению: **${formatMoney(payoutAmount)}**`,
    ephemeral: true,
  });
}