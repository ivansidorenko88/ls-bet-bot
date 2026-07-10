require("dotenv").config();

const { REST, Routes, SlashCommandBuilder } = require("discord.js");

const token = process.env.DISCORD_TOKEN;
const clientId = process.env.CLIENT_ID || process.env.DISCORD_CLIENT_ID;
const guildId = process.env.GUILD_ID || process.env.DISCORD_GUILD_ID;

if (!token || !clientId || !guildId) {
  console.error("❌ Нужны DISCORD_TOKEN, CLIENT_ID и GUILD_ID в .env");
  process.exit(1);
}

const commands = [
  new SlashCommandBuilder()
    .setName("panel")
    .setDescription("Опубликовать главное меню LS Bet"),

  new SlashCommandBuilder()
    .setName("admin_panel")
    .setDescription("Открыть админ-панель LS Bet"),

  new SlashCommandBuilder()
<<<<<<< HEAD
    .setName("registration_panel")
    .setDescription("Опубликовать панель регистрации LS Bet"),

  new SlashCommandBuilder()
    .setName("event_create")
    .setDescription("Создать событие LS Bet")
=======
    .setName("event_create")
    .setDescription("Создать RP-событие LS Bet")
>>>>>>> 417a04767142838813b515bcc8f2fc38da4228e9
    .addStringOption((option) =>
      option.setName("title").setDescription("Название события").setRequired(true)
    )
    .addStringOption((option) =>
      option.setName("description").setDescription("Описание события").setRequired(true)
    )
    .addStringOption((option) =>
<<<<<<< HEAD
      option.setName("option1").setDescription("Исход 1 / П1").setRequired(true)
=======
      option.setName("option1").setDescription("Исход 1").setRequired(true)
>>>>>>> 417a04767142838813b515bcc8f2fc38da4228e9
    )
    .addNumberOption((option) =>
      option.setName("odds1").setDescription("Коэффициент исхода 1").setRequired(true)
    )
<<<<<<< HEAD
    .addStringOption((option) =>
      option.setName("option2").setDescription("Исход 2 / X").setRequired(true)
=======
    .addAttachmentOption((option) =>
      option.setName("image1").setDescription("Картинка исхода 1").setRequired(true)
    )
    .addStringOption((option) =>
      option.setName("option2").setDescription("Исход 2").setRequired(true)
>>>>>>> 417a04767142838813b515bcc8f2fc38da4228e9
    )
    .addNumberOption((option) =>
      option.setName("odds2").setDescription("Коэффициент исхода 2").setRequired(true)
    )
<<<<<<< HEAD
    .addIntegerOption((option) =>
      option.setName("minutes").setDescription("Через сколько минут закрыть ставки").setRequired(true)
    )
    .addAttachmentOption((option) =>
      option.setName("banner").setDescription("Общая афиша / баннер события").setRequired(true)
    )
    .addStringOption((option) =>
      option.setName("option3").setDescription("Исход 3 / П2").setRequired(false)
    )
    .addNumberOption((option) =>
      option.setName("odds3").setDescription("Коэффициент исхода 3").setRequired(false)
=======
    .addAttachmentOption((option) =>
      option.setName("image2").setDescription("Картинка исхода 2").setRequired(true)
    )
    .addIntegerOption((option) =>
      option.setName("minutes").setDescription("Через сколько минут закрыть ставки").setRequired(true)
>>>>>>> 417a04767142838813b515bcc8f2fc38da4228e9
    ),

  new SlashCommandBuilder()
    .setName("finish_event")
<<<<<<< HEAD
    .setDescription("Завершить cобытие и выбрать победный исход")
=======
    .setDescription("Завершить RP-событие и выбрать победный исход")
>>>>>>> 417a04767142838813b515bcc8f2fc38da4228e9
    .addIntegerOption((option) =>
      option.setName("event_id").setDescription("ID события").setRequired(true)
    )
    .addIntegerOption((option) =>
      option
        .setName("winner")
        .setDescription("Победный исход")
        .setRequired(true)
<<<<<<< HEAD
        .addChoices({ name: "Исход 1", value: 1 }, { name: "Исход 2", value: 2 }, { name: "Исход 3", value: 3 })
    ),

  new SlashCommandBuilder()
    .setName("event_cancel")
    .setDescription("Отменить событие и вернуть все активные ставки")
    .addIntegerOption((option) =>
      option.setName("event_id").setDescription("ID события").setRequired(true)
    )
    .addStringOption((option) =>
      option.setName("reason").setDescription("Причина отмены").setRequired(false)
=======
        .addChoices({ name: "Исход 1", value: 1 }, { name: "Исход 2", value: 2 })
>>>>>>> 417a04767142838813b515bcc8f2fc38da4228e9
    ),

  new SlashCommandBuilder()
    .setName("add_balance")
    .setDescription("Начислить баланс игроку")
    .addUserOption((option) =>
      option.setName("user").setDescription("Игрок").setRequired(true)
    )
    .addIntegerOption((option) =>
      option.setName("amount").setDescription("Сумма").setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("user_info")
    .setDescription("Посмотреть баланс и статистику игрока")
    .addUserOption((option) =>
      option.setName("user").setDescription("Игрок").setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("set_balance")
    .setDescription("Установить баланс игроку")
    .addUserOption((option) =>
      option.setName("user").setDescription("Игрок").setRequired(true)
    )
    .addIntegerOption((option) =>
      option.setName("amount").setDescription("Новый баланс").setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("remove_balance")
    .setDescription("Списать баланс у игрока")
    .addUserOption((option) =>
      option.setName("user").setDescription("Игрок").setRequired(true)
    )
    .addIntegerOption((option) =>
      option.setName("amount").setDescription("Сумма списания").setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("admin_users")
    .setDescription("Топ/список игроков LS Bet"),
].map((command) => command.toJSON());

const rest = new REST({ version: "10" }).setToken(token);

(async () => {
  try {
    console.log("🔄 Обновляю slash-команды...");

    await rest.put(Routes.applicationGuildCommands(clientId, guildId), {
      body: commands,
    });

    console.log("✅ Slash-команды обновлены");
  } catch (error) {
    console.error("❌ Ошибка обновления команд:", error);
    process.exit(1);
  }
})();