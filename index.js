require("dotenv").config();

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

const EVENT_CHANNEL_ID =
  process.env.EVENT_CHANNEL_ID || "1510916382395600936";

const RESULT_CHANNEL_ID =
  process.env.RESULT_CHANNEL_ID || "1510928118527950888";

const COINFLIP_CHANNEL_ID =
  process.env.COINFLIP_CHANNEL_ID || "1511707250668863578";

const PROMO_NEW_USER_DAYS = Number(process.env.PROMO_NEW_USER_DAYS || 3);

const LS_THEME = {
  green: 0x18d875,
  darkGreen: 0x0f8f4d,
  gold: 0xf4c542,
  red: 0xff3333,
  blue: 0x60a5fa,
  black: 0x111111,
};

const LS_TEXT = {
  footer: "LS Bet • Events • Live Bets • Coinflip",
  line: "━━━━━━━━━━━━━━━━━━━━",
};

function createBaseEmbed(color = LS_THEME.green) {
  return new EmbedBuilder()
    .setColor(color)
    .setTimestamp()
    .setFooter({
      text: LS_TEXT.footer,
    });
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
    where: {
      discordId: discordUser.id,
    },
    update: {
      username: discordUser.username,
    },
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

    await channel.send({
      embeds: [embed],
    });
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
    where: {
      id: eventId,
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
        "Здесь ты можешь участвовать в событиях, делать ставки, играть в Coinflip, активировать промокоды и следить за рейтингом победителей.",
        "",
        LS_TEXT.line,
      ].join("\n")
    )
    .addFields(
      {
        name: "🎰 Cобытия",
        value: "Афиши, коэффициенты, LIVE-ставки и результаты.",
        inline: true,
      },
      {
        name: "🪙 Coinflip",
        value: "Быстрая дуэль между двумя игроками. Победитель забирает банк.",
        inline: true,
      },
      {
        name: "💰 Баланс",
        value: "Пополнение через ticket, история операций и профиль.",
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
      .setStyle(ButtonStyle.Secondary),

    new ButtonBuilder()
      .setCustomId("panel_topup")
      .setLabel("💰 Пополнить")
      .setStyle(ButtonStyle.Success)
  );

  return {
    embeds: [embed],
    components: [row1, row2],
  };
}

function buildAdminPanel() {
  const embed = createBaseEmbed(LS_THEME.gold)
    .setTitle("🛠️ LS Bet — Admin Panel")
    .setDescription(
      [
        "```",
        "ADMIN CONTROL CENTER",
        "EVENTS • TOPUPS • PROMOS • LOGS",
        "```",
        "**Панель управления LS Bet.**",
        "",
        "Здесь можно управлять событиями, заявками на пополнение, промокодами и публикацией главного меню.",
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
        value: "Проверка пополнений и тикетов.",
        inline: true,
      },
      {
        name: "🎟️ Промокоды",
        value: "Создание и статистика.",
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
      .setCustomId("admin_promos")
      .setLabel("🎟️ Промокоды")
      .setStyle(ButtonStyle.Secondary),

    new ButtonBuilder()
      .setCustomId("admin_public_panel")
      .setLabel("📌 Опубликовать меню")
      .setStyle(ButtonStyle.Success)
  );

  return {
    embeds: [embed],
    components: [row],
    ephemeral: true,
  };
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
      )
      .addFields({
        name: "Возможность",
        value: "Нажми кнопку ниже, чтобы сделать ставку.",
        inline: false,
      });

    if (option.imageUrl) {
      embed.setImage(option.imageUrl);
    }

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
      closesAt: {
        lte: new Date(),
      },
    },
  });

  for (const event of expiredEvents) {
    await prisma.rpEvent.update({
      where: {
        id: event.id,
      },
      data: {
        status: "LIVE",
      },
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
      console.error("Канал результатов событий не найден или бот не может туда писать.");
      return;
    }

    const embed = createBaseEmbed(LS_THEME.gold)
      .setTitle("🏁 LS BET RESULT")
      .setDescription(
        [
          "```",
          "RP EVENT FINISHED",
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

    if (winnerOption.imageUrl) {
      embed.setImage(winnerOption.imageUrl);
    }

    await resultChannel.send({
      content: "🏁 **Итоги события**",
      embeds: [embed],
    });
  } catch (error) {
    console.error("Не смог опубликовать результат события:", error.message);
  }
}

async function showProfile(interaction) {
  const user = await getOrCreateUser(interaction.user);

  const totalBets = await prisma.bet.count({
    where: { userId: user.id },
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

  const coinflipWins = await prisma.coinflipGame.count({
    where: {
      winnerUserId: user.id,
    },
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
      {
        name: "Баланс",
        value: formatMoney(user.balance),
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
        name: "Coinflip побед",
        value: String(coinflipWins),
        inline: true,
      },
      {
        name: "Процент побед",
        value: `${winPercent}%`,
        inline: true,
      }
    );

  return interaction.reply({
    embeds: [embed],
    ephemeral: true,
  });
}

async function showHistory(interaction) {
  const user = await getOrCreateUser(interaction.user);

  const transactions = await prisma.transaction.findMany({
    where: {
      userId: user.id,
    },
    orderBy: {
      id: "desc",
    },
    take: 8,
  });

  const topUps = await prisma.topUpRequest.findMany({
    where: {
      userId: user.id,
    },
    orderBy: {
      id: "desc",
    },
    take: 5,
  });

  const transactionText =
    transactions.length === 0
      ? "Операций пока нет."
      : transactions
          .map((transaction) => {
            const sign = transaction.amount > 0 ? "+" : "";
            const amount = `${sign}${formatMoney(transaction.amount)}`;

            return [
              `**#${transaction.id} — ${transactionTypeName(transaction.type)}**`,
              `Сумма: ${amount}`,
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

  const transactionsEmbed = createBaseEmbed(LS_THEME.green)
    .setTitle("📜 История операций")
    .setDescription(transactionText);

  const topUpsEmbed = createBaseEmbed(LS_THEME.gold)
    .setTitle("💰 История пополнений")
    .setDescription(topUpText);

  return interaction.reply({
    embeds: [transactionsEmbed, topUpsEmbed],
    ephemeral: true,
  });
}
async function showTop(interaction) {
  const users = await prisma.user.findMany({
    orderBy: {
      balance: "desc",
    },
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
      return `${medal} <@${user.discordId}> — **${formatMoney(user.balance)}**`;
    })
    .join("\n");

  const embed = createBaseEmbed(LS_THEME.gold)
    .setTitle("🏆 LS Bet Top Winners")
    .setDescription(
      [
        "```",
        "LEADERBOARD",
        "TOP BALANCE PLAYERS",
        "```",
        text,
      ].join("\n")
    );

  return interaction.reply({
    embeds: [embed],
    ephemeral: true,
  });
}

async function showMyBets(interaction) {
  const user = await getOrCreateUser(interaction.user);

  const bets = await prisma.bet.findMany({
    where: {
      userId: user.id,
    },
    orderBy: {
      id: "desc",
    },
    take: 10,
    include: {
      event: true,
      option: true,
    },
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

  return interaction.reply({
    embeds: [embed],
    ephemeral: true,
  });
}

async function showEvents(interaction) {
  await closeExpiredEvents();
  await getOrCreateUser(interaction.user);

  const events = await prisma.rpEvent.findMany({
    where: {
      status: {
        in: ["OPEN", "LIVE"],
      },
    },
    orderBy: {
      id: "desc",
    },
    take: 3,
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

  return interaction.reply({
    embeds,
    components,
    ephemeral: true,
  });
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
    {
      id: guild.id,
      deny: [PermissionFlagsBits.ViewChannel],
    },
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
    where: {
      id: request.id,
    },
    data: {
      ticketChannelId: ticketChannel.id,
    },
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
      {
        name: "Логин",
        value: login,
        inline: true,
      },
      {
        name: "Сумма",
        value: formatMoney(amount),
        inline: true,
      },
      {
        name: "Комментарий",
        value: comment || "Не указан",
        inline: false,
      }
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
      {
        name: "Логин",
        value: login,
        inline: true,
      },
      {
        name: "Сумма",
        value: formatMoney(amount),
        inline: true,
      },
      {
        name: "Ticket",
        value: `<#${ticketChannel.id}>`,
        inline: true,
      },
    ]
  );

  return interaction.reply({
    content: `✅ Заявка создана: <#${ticketChannel.id}>. Загрузи туда скриншот перевода.`,
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

  const channel = await client.channels.fetch(logChannelId);
  if (!channel) return;

  const embed = createBaseEmbed(LS_THEME.gold)
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
        value: formatMoney(request.amount),
        inline: true,
      },
      {
        name: "Комментарий",
        value: request.comment || "Не указан",
        inline: false,
      },
      {
        name: "Ticket",
        value: request.ticketChannelId
          ? `<#${request.ticketChannelId}>`
          : "Не найден",
        inline: true,
      }
    );

  if (request.screenshotUrl) embed.setImage(request.screenshotUrl);

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
    embeds: [embed],
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
      user: true,
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

  await prisma.$transaction([
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

    prisma.topUpRequest.update({
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
        amount: request.amount,
        type: "TOPUP_APPROVED",
        comment: `Пополнение через ticket #${request.id}. Одобрил ${interaction.user.username}`,
      },
    }),
  ]);

  if (request.ticketChannelId) {
    try {
      const ticketChannel = await client.channels.fetch(request.ticketChannelId);

      await ticketChannel.send({
        content:
          `✅ <@${request.user.discordId}>, заявка **#${request.id}** одобрена.\n` +
          `На баланс начислено **${formatMoney(request.amount)}**.`,
        components: [buildCloseTicketRow(request.id)],
      });
    } catch (error) {
      console.error("Не смог написать в тикет:", error.message);
    }
  }

  await sendLog(
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
        value: formatMoney(request.amount),
        inline: true,
      },
      {
        name: "Логин",
        value: request.login,
        inline: true,
      },
    ]
  );

  return interaction.reply({
    content: `✅ Заявка #${request.id} одобрена. Игроку начислено ${formatMoney(
      request.amount
    )}.`,
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
    try {
      const ticketChannel = await client.channels.fetch(request.ticketChannelId);

      await ticketChannel.send({
        content:
          `❌ <@${request.user.discordId}>, заявка **#${request.id}** отклонена.\n` +
          `Если это ошибка — свяжись с модератором.`,
        components: [buildCloseTicketRow(request.id)],
      });
    } catch (error) {
      console.error("Не смог написать в тикет:", error.message);
    }
  }

  await sendLog(
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
        value: formatMoney(request.amount),
        inline: true,
      },
      {
        name: "Логин",
        value: request.login,
        inline: true,
      },
    ]
  );

  return interaction.reply({
    content: `❌ Заявка #${request.id} отклонена.`,
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

  await sendLog(
    "TICKET_CLOSED",
    "🔒 Тикет закрыт",
    `Пользователь <@${interaction.user.id}> закрыл тикет по заявке #${request.id}.`,
    [
      {
        name: "Заявка",
        value: `#${request.id}`,
        inline: true,
      },
      {
        name: "Игрок",
        value: `<@${request.user.discordId}>`,
        inline: true,
      },
      {
        name: "Сумма",
        value: formatMoney(request.amount),
        inline: true,
      },
    ]
  );

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
    const embed = createBaseEmbed(
      request.status === "PENDING" ? LS_THEME.gold : LS_THEME.blue
    )
      .setTitle(`💰 Заявка #${request.id}`)
      .setDescription(
        [
          `**Статус:** ${getTopUpStatusName(request.status)}`,
          `**Игрок:** <@${request.user.discordId}>`,
          `**Логин:** ${request.login}`,
          `**Сумма:** ${formatMoney(request.amount)}`,
          `**Комментарий:** ${request.comment || "Не указан"}`,
          `**Ticket:** ${
            request.ticketChannelId
              ? `<#${request.ticketChannelId}>`
              : "Не создан"
          }`,
          `**Создана:** <t:${getUnixTime(request.createdAt)}:R>`,
        ].join("\n")
      );

    if (request.screenshotUrl) embed.setImage(request.screenshotUrl);

    embeds.push(embed);

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

async function showEventStats(interaction, eventId) {
  const event = await getFullEvent(eventId);

  if (!event) {
    return interaction.reply({
      content: "Событие не найдено.",
      ephemeral: true,
    });
  }

  const lines = event.options.map((option) => {
    const total = getOptionBetTotal(option);
    const count = option.bets.filter((bet) => bet.status === "ACTIVE").length;

    return `**${option.title}** — ${formatMoney(total)} / ставок: ${count}`;
  });

  const embed = createBaseEmbed(LS_THEME.green)
    .setTitle(`📊 Статистика события #${event.id}`)
    .setDescription(
      [
        `**${event.title}**`,
        "",
        `Банк события: **${formatMoney(getEventBank(event))}**`,
        "",
        ...lines,
      ].join("\n")
    );

  return interaction.reply({
    embeds: [embed],
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

    const embed = createBaseEmbed(event.status === "OPEN" ? LS_THEME.green : LS_THEME.red)
      .setTitle(`Событие #${event.id}: ${event.title}`)
      .setDescription(
        [
          `**Статус:** ${getStatusName(event.status)}`,
          `**Банк:** ${formatMoney(getEventBank(event))}`,
          `**Закрытие ставок:** <t:${getUnixTime(event.closesAt)}:R>`,
          "",
          `1️⃣ ${option1 ? option1.title : "Исход 1"}`,
          `2️⃣ ${option2 ? option2.title : "Исход 2"}`,
        ].join("\n")
      );

    embeds.push(embed);

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

  await sendLog(
    "EVENT_LIVE",
    "🔴 Событие переведено в LIVE",
    `Модератор <@${interaction.user.id}> перевёл событие **#${event.id} ${event.title}** в LIVE.`
  );

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

  await publishRpEventResult(event, winnerOption, winnersCount, totalPaid);

  await sendLog(
    "EVENT_FINISHED",
    "🏁 Событие завершено",
    `Модератор <@${interaction.user.id}> завершил событие **#${event.id} ${event.title}**.`,
    [
      {
        name: "Победный исход",
        value: winnerOption.title,
        inline: true,
      },
      {
        name: "Победителей",
        value: String(winnersCount),
        inline: true,
      },
      {
        name: "Выплачено",
        value: formatMoney(totalPaid),
        inline: true,
      },
      {
        name: "Канал результатов",
        value: `<#${RESULT_CHANNEL_ID}>`,
        inline: true,
      },
    ]
  );

  return interaction.reply({
    content:
      `✅ **Событие завершено**\n` +
      `Событие: **${event.title}**\n` +
      `Победный исход: **${winnerOption.title}**\n` +
      `Победителей: **${winnersCount}**\n` +
      `Выплачено: **${formatMoney(totalPaid)}**\n` +
      `Итоги опубликованы в <#${RESULT_CHANNEL_ID}>`,
    ephemeral: true,
  });
}

function buildCoinflipStartPanel() {
  const embed = createBaseEmbed(LS_THEME.gold)
    .setTitle("🪙 LS Bet Coinflip")
    .setDescription(
      [
        "```",
        "COINFLIP DUEL",
        "1 VS 1 • DOUBLE OR NOTHING",
        "```",
        "**Создай игру и выбери сторону монеты.**",
        "",
        "После создания второй игрок сможет принять игру кнопкой.",
        "Победитель забирает весь банк **x2**.",
        "",
        LS_TEXT.line,
      ].join("\n")
    )
    .addFields(
      {
        name: "🦅 Орёл",
        value: "Выбрать сторону Орёл.",
        inline: true,
      },
      {
        name: "🪙 Решка",
        value: "Выбрать сторону Решка.",
        inline: true,
      }
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
    embeds: [embed],
    components: [row],
    ephemeral: true,
  };
}

function coinSideName(side) {
  if (side === "HEADS") return "Орёл";
  if (side === "TAILS") return "Решка";
  return side;
}

function oppositeSide(side) {
  return side === "HEADS" ? "TAILS" : "HEADS";
}

function buildCoinflipAmountModal(side) {
  const modal = new ModalBuilder()
    .setCustomId(`coinflip_modal:${side}`)
    .setTitle(`Coinflip — ${coinSideName(side)}`);

  const amountInput = new TextInputBuilder()
    .setCustomId("amount")
    .setLabel("Сумма игры в $")
    .setPlaceholder("Например: 500")
    .setRequired(true)
    .setStyle(TextInputStyle.Short);

  modal.addComponents(new ActionRowBuilder().addComponents(amountInput));

  return modal;
}

function buildCoinflipEmbed(game) {
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

  const embed = createBaseEmbed(color)
    .setTitle(`🪙 COINFLIP #${game.id}`)
    .setDescription(
      [
        "```",
        "DOUBLE OR NOTHING",
        "```",
        `**Создатель:** <@${game.creator.discordId}>`,
        `**Ставка:** ${formatMoney(game.amount)}`,
        `**Банк:** ${formatMoney(game.amount * 2)}`,
        `**Сторона создателя:** ${coinSideName(game.creatorSide)}`,
        `**Статус:** ${statusText}`,
        "",
        LS_TEXT.line,
      ].join("\n")
    );

  if (game.status === "FINISHED") {
    embed.addFields(
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
        value: formatMoney(game.amount * 2),
        inline: true,
      }
    );
  }

  return embed;
}

function buildCoinflipButtons(game) {
  const row = new ActionRowBuilder().addComponents(
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
  );

  return [row];
}async function getCoinflipGame(gameId) {
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

  const user = await getOrCreateUser(interaction.user);

  if (user.balance < amount) {
    return interaction.reply({
      content: `Недостаточно средств. Твой баланс: **${formatMoney(user.balance)}**.`,
      ephemeral: true,
    });
  }

  const game = await prisma.$transaction(async (tx) => {
    const updatedUser = await tx.user.update({
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
        creatorUserId: updatedUser.id,
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
    embeds: [buildCoinflipEmbed(game)],
    components: buildCoinflipButtons(game),
  });

  await prisma.coinflipGame.update({
    where: {
      id: game.id,
    },
    data: {
      messageId: message.id,
    },
  });

  await sendLog(
    "COINFLIP_CREATED",
    "🪙 Coinflip создан",
    `Игрок <@${interaction.user.id}> создал Coinflip #${game.id}.`,
    [
      {
        name: "Сумма",
        value: formatMoney(amount),
        inline: true,
      },
      {
        name: "Сторона",
        value: coinSideName(side),
        inline: true,
      },
      {
        name: "Канал",
        value: `<#${COINFLIP_CHANNEL_ID}>`,
        inline: true,
      },
    ]
  );

  return interaction.reply({
    content: `✅ Coinflip создан на сумму **${formatMoney(amount)}**.`,
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
      embeds: [buildCoinflipEmbed(game)],
      components: game.status === "WAITING" ? buildCoinflipButtons(game) : [],
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

  const opponent = await getOrCreateUser(interaction.user);

  if (opponent.balance < game.amount) {
    return interaction.reply({
      content: `Недостаточно средств. Твой баланс: **${formatMoney(opponent.balance)}**.`,
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
        comment: `Победа в Coinflip #${game.id}. Выпало: ${coinSideName(resultSide)}`,
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

  await interaction.reply({
    content:
      `🏁 **Coinflip завершён**\n` +
      `Выпало: **${coinSideName(resultSide)}**\n` +
      `Победитель: <@${winnerDiscordId}>\n` +
      `Выигрыш: **${formatMoney(bank)}**`,
  });

  await sendLog(
    "COINFLIP_FINISHED",
    "🏁 Coinflip завершён",
    `Coinflip #${game.id} завершён.`,
    [
      {
        name: "Выпало",
        value: coinSideName(resultSide),
        inline: true,
      },
      {
        name: "Победитель",
        value: `<@${winnerDiscordId}>`,
        inline: true,
      },
      {
        name: "Банк",
        value: formatMoney(bank),
        inline: true,
      },
    ]
  );
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

  await sendLog(
    "COINFLIP_CANCELLED",
    "❌ Coinflip отменён",
    `Coinflip #${game.id} отменил <@${interaction.user.id}>.`,
    [
      {
        name: "Возврат",
        value: formatMoney(game.amount),
        inline: true,
      },
    ]
  );

  return interaction.reply({
    content: `❌ Coinflip #${game.id} отменён. Создателю возвращено ${formatMoney(
      game.amount
    )}.`,
    ephemeral: true,
  });
}
function buildPromoModal() {
  const modal = new ModalBuilder()
    .setCustomId("promo_activate_modal")
    .setTitle("LS Bet — активация промокода");

  const codeInput = new TextInputBuilder()
    .setCustomId("code")
    .setLabel("Промокод")
    .setPlaceholder("Например: WELCOME1000")
    .setRequired(true)
    .setStyle(TextInputStyle.Short);

  modal.addComponents(new ActionRowBuilder().addComponents(codeInput));

  return modal;
}

function buildPromoCreateModal() {
  const modal = new ModalBuilder()
    .setCustomId("promo_create_modal")
    .setTitle("LS Bet — создать промокод");

  const codeInput = new TextInputBuilder()
    .setCustomId("code")
    .setLabel("Код")
    .setPlaceholder("Например: WELCOME1000")
    .setRequired(true)
    .setStyle(TextInputStyle.Short);

  const amountInput = new TextInputBuilder()
    .setCustomId("amount")
    .setLabel("Сумма выдачи в $")
    .setPlaceholder("Например: 1000")
    .setRequired(true)
    .setStyle(TextInputStyle.Short);

  const maxUsesInput = new TextInputBuilder()
    .setCustomId("maxUses")
    .setLabel("Лимит активаций")
    .setPlaceholder("Например: 50. Можно оставить пустым.")
    .setRequired(false)
    .setStyle(TextInputStyle.Short);

  modal.addComponents(
    new ActionRowBuilder().addComponents(codeInput),
    new ActionRowBuilder().addComponents(amountInput),
    new ActionRowBuilder().addComponents(maxUsesInput)
  );

  return modal;
}

function buildAdminPromoPanel() {
  const embed = createBaseEmbed(LS_THEME.gold)
    .setTitle("🎟️ LS Bet — Промокоды")
    .setDescription(
      [
        "```",
        "PROMO CONTROL",
        "CREATE • STATS • NEW USERS ONLY",
        "```",
        "Здесь можно создать промокод и посмотреть статистику.",
        "",
        `Промокод может активировать только пользователь, который зашёл на сервер за последние **${PROMO_NEW_USER_DAYS} дня**.`,
        "",
        LS_TEXT.line,
      ].join("\n")
    );

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("promo_create")
      .setLabel("➕ Создать")
      .setStyle(ButtonStyle.Success),

    new ButtonBuilder()
      .setCustomId("promo_stats")
      .setLabel("📊 Статистика")
      .setStyle(ButtonStyle.Secondary)
  );

  return {
    embeds: [embed],
    components: [row],
    ephemeral: true,
  };
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
      },
    });

    await sendLog(
      "PROMO_CREATED",
      "🎟️ Промокод создан",
      `Модератор <@${interaction.user.id}> создал промокод **${promo.code}**.`,
      [
        {
          name: "Сумма",
          value: formatMoney(amount),
          inline: true,
        },
        {
          name: "Лимит",
          value: maxUses ? String(maxUses) : "Без лимита",
          inline: true,
        },
      ]
    );

    return interaction.reply({
      content: `✅ Промокод **${promo.code}** создан. Сумма: **${formatMoney(
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

async function showPromoStats(interaction) {
  if (await adminOnly(interaction)) return;

  const promos = await prisma.promoCode.findMany({
    orderBy: {
      id: "desc",
    },
    take: 10,
    include: {
      activations: true,
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
        `🎟️ **${promo.code}**`,
        `Сумма: **${formatMoney(promo.amount)}**`,
        `Использований: **${promo.usesCount}${
          promo.maxUses ? ` / ${promo.maxUses}` : ""
        }**`,
        `Выдано всего: **${formatMoney(totalIssued)}**`,
        `Статус: **${promo.isActive ? "Активен" : "Выключен"}**`,
      ].join("\n");
    })
    .join("\n\n");

  const embed = createBaseEmbed(LS_THEME.gold)
    .setTitle("📊 Статистика промокодов")
    .setDescription(text);

  return interaction.reply({
    embeds: [embed],
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
  const user = await getOrCreateUser(interaction.user);

  const promo = await prisma.promoCode.findUnique({
    where: {
      code,
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

  await prisma.$transaction([
    prisma.user.update({
      where: {
        id: user.id,
      },
      data: {
        balance: {
          increment: promo.amount,
        },
      },
    }),

    prisma.promoCode.update({
      where: {
        id: promo.id,
      },
      data: {
        usesCount: {
          increment: 1,
        },
      },
    }),

    prisma.promoActivation.create({
      data: {
        promoCodeId: promo.id,
        userId: user.id,
        amount: promo.amount,
      },
    }),

    prisma.transaction.create({
      data: {
        userId: user.id,
        amount: promo.amount,
        type: "PROMO_ACTIVATED",
        comment: `Активация промокода ${promo.code}`,
      },
    }),
  ]);

  await sendLog(
    "PROMO_ACTIVATED",
    "🎟️ Промокод активирован",
    `Игрок <@${interaction.user.id}> активировал промокод **${promo.code}**.`,
    [
      {
        name: "Сумма",
        value: formatMoney(promo.amount),
        inline: true,
      },
      {
        name: "Код",
        value: promo.code,
        inline: true,
      },
    ]
  );

  return interaction.reply({
    content: `✅ Промокод **${promo.code}** активирован. Начислено **${formatMoney(
      promo.amount
    )}**.`,
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

    await sendLog(
      "TOPUP_SCREENSHOT",
      "📎 Скриншот пополнения загружен",
      `Игрок <@${request.user.discordId}> загрузил скриншот для заявки #${request.id}.`,
      [
        {
          name: "Сумма",
          value: formatMoney(request.amount),
          inline: true,
        },
        {
          name: "Логин",
          value: request.login,
          inline: true,
        },
        {
          name: "Ticket",
          value: `<#${message.channelId}>`,
          inline: true,
        },
      ]
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

        return interaction.reply(buildMainPanel());
      }

      if (interaction.commandName === "admin_panel") {
        if (await adminOnly(interaction)) return;

        return interaction.reply(buildAdminPanel());
      }

      if (interaction.commandName === "event_create") {
        if (await adminOnly(interaction)) return;

        if (interaction.channelId !== EVENT_CHANNEL_ID) {
          return interaction.reply({
            content: `⛔ Создавать cобытия можно только в канале <#${EVENT_CHANNEL_ID}>.`,
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
              "⛔ Канал для публикации cобытий не найден или бот не может туда писать.",
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
          embeds: buildEventPoster(event),
          components: buildEventButtons(event),
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

        await sendLog(
          "EVENT_CREATED",
          "📢 Создано событие LS Bet",
          `Модератор <@${interaction.user.id}> создал событие **#${event.id} ${event.title}**.`,
          [
            {
              name: "Исход 1",
              value: `${option1} x${odds1}`,
              inline: true,
            },
            {
              name: "Исход 2",
              value: `${option2} x${odds2}`,
              inline: true,
            },
            {
              name: "Закрытие ставок",
              value: `<t:${getUnixTime(closesAt)}:R>`,
              inline: true,
            },
            {
              name: "Канал публикации",
              value: `<#${EVENT_CHANNEL_ID}>`,
              inline: true,
            },
          ]
        );

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

        const targetUser = await getOrCreateUser(targetDiscordUser);

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

        await sendLog(
          "ADMIN_ADD_BALANCE",
          "💵 Ручное начисление баланса",
          `Модератор <@${interaction.user.id}> начислил баланс игроку <@${targetDiscordUser.id}>.`,
          [
            {
              name: "Сумма",
              value: formatMoney(amount),
              inline: true,
            },
          ]
        );

        return interaction.reply({
          content: `✅ <@${targetDiscordUser.id}> начислено **${formatMoney(amount)}**.`,
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

      if (interaction.customId === "admin_promos") {
        if (await adminOnly(interaction)) return;

        return interaction.reply(buildAdminPromoPanel());
      }

      if (interaction.customId === "promo_create") {
        if (await adminOnly(interaction)) return;

        return interaction.showModal(buildPromoCreateModal());
      }

      if (interaction.customId === "promo_stats") {
        return showPromoStats(interaction);
      }

      if (interaction.customId === "admin_public_panel") {
        if (await adminOnly(interaction)) return;

        await interaction.channel.send(buildMainPanel());

        return interaction.reply({
          content: "✅ Главное меню опубликовано.",
          ephemeral: true,
        });
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
        return interaction.showModal(buildPromoModal());
      }

      if (interaction.customId === "panel_coinflip") {
        if (interaction.channelId !== COINFLIP_CHANNEL_ID) {
          return interaction.reply({
            content: `🪙 Coinflip доступен только в канале <#${COINFLIP_CHANNEL_ID}>.`,
            ephemeral: true,
          });
        }

        return interaction.reply(buildCoinflipStartPanel());
      }

      if (interaction.customId.startsWith("coinflip_side:")) {
        const [, side] = interaction.customId.split(":");

        return interaction.showModal(buildCoinflipAmountModal(side));
      }

      if (interaction.customId.startsWith("coinflip_accept:")) {
        const [, gameIdRaw] = interaction.customId.split(":");

        return acceptCoinflip(interaction, Number(gameIdRaw));
      }

      if (interaction.customId.startsWith("coinflip_cancel:")) {
        const [, gameIdRaw] = interaction.customId.split(":");

        return cancelCoinflip(interaction, Number(gameIdRaw));
      }

      if (interaction.customId === "panel_topup") {
        return interaction.showModal(buildTopUpModal());
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

        const amountInput = new TextInputBuilder()
          .setCustomId("amount")
          .setLabel("Сумма ставки в $")
          .setPlaceholder("Например: 500")
          .setRequired(true)
          .setStyle(TextInputStyle.Short);

        modal.addComponents(new ActionRowBuilder().addComponents(amountInput));

        return interaction.showModal(modal);
      }
    }

    if (interaction.isModalSubmit()) {
      if (interaction.customId.startsWith("coinflip_modal:")) {
        const [, side] = interaction.customId.split(":");
        const amount = Number(interaction.fields.getTextInputValue("amount"));

        return createCoinflipGame(interaction, side, amount);
      }

      if (interaction.customId === "promo_create_modal") {
        const code = interaction.fields.getTextInputValue("code");
        const amount = Number(interaction.fields.getTextInputValue("amount"));
        const maxUses = interaction.fields.getTextInputValue("maxUses");

        return createPromoCode(interaction, code, amount, maxUses);
      }

      if (interaction.customId === "promo_activate_modal") {
        const code = interaction.fields.getTextInputValue("code");

        return activatePromoCode(interaction, code);
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

      const user = await getOrCreateUser(interaction.user);

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
          content: `Недостаточно средств. Твой баланс: **${formatMoney(user.balance)}**.`,
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
            comment: `Ставка на событие "${event.title}". Исход: ${option.title}. Возможный выигрыш: ${formatMoney(
              potentialWin
            )}`,
          },
        }),
      ]);

      await updateEventMessage(eventId);

      await sendLog(
        "BET_CREATED",
        "💵 Новая ставка",
        `Игрок <@${interaction.user.id}> сделал ставку.`,
        [
          {
            name: "Событие",
            value: event.title,
            inline: true,
          },
          {
            name: "Исход",
            value: option.title,
            inline: true,
          },
          {
            name: "Сумма",
            value: formatMoney(amount),
            inline: true,
          },
          {
            name: "Возможный выигрыш",
            value: formatMoney(potentialWin),
            inline: true,
          },
        ]
      );

      return interaction.reply({
        content:
          `✅ **Ставка принята**\n` +
          `Событие: **${event.title}**\n` +
          `Исход: **${option.title}**\n` +
          `Сумма: **${formatMoney(amount)}**\n` +
          `Коэффициент: **x${option.odds}**\n` +
          `Возможный выигрыш: **${formatMoney(potentialWin)}**`,
        ephemeral: true,
      });
    }
  } catch (error) {
    console.error(error);

    await sendLog(
      "BOT_ERROR",
      "⚠️ Ошибка бота",
      `\`\`\`${String(error.message || error).slice(0, 1500)}\`\`\``
    );

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