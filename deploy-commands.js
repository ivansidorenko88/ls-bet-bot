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
    .setName("event_create")
    .setDescription("Создать RP-событие LS Bet")
    .addStringOption((option) =>
      option.setName("title").setDescription("Название события").setRequired(true)
    )
    .addStringOption((option) =>
      option.setName("description").setDescription("Описание события").setRequired(true)
    )
    .addStringOption((option) =>
      option.setName("option1").setDescription("Исход 1").setRequired(true)
    )
    .addNumberOption((option) =>
      option.setName("odds1").setDescription("Коэффициент исхода 1").setRequired(true)
    )
    .addAttachmentOption((option) =>
      option.setName("image1").setDescription("Картинка исхода 1").setRequired(true)
    )
    .addStringOption((option) =>
      option.setName("option2").setDescription("Исход 2").setRequired(true)
    )
    .addNumberOption((option) =>
      option.setName("odds2").setDescription("Коэффициент исхода 2").setRequired(true)
    )
    .addAttachmentOption((option) =>
      option.setName("image2").setDescription("Картинка исхода 2").setRequired(true)
    )
    .addIntegerOption((option) =>
      option.setName("minutes").setDescription("Через сколько минут закрыть ставки").setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("finish_event")
    .setDescription("Завершить RP-событие и выбрать победный исход")
    .addIntegerOption((option) =>
      option.setName("event_id").setDescription("ID события").setRequired(true)
    )
    .addIntegerOption((option) =>
      option
        .setName("winner")
        .setDescription("Победный исход")
        .setRequired(true)
        .addChoices({ name: "Исход 1", value: 1 }, { name: "Исход 2", value: 2 })
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