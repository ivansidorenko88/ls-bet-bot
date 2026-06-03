require("dotenv").config();

const {
  REST,
  Routes,
  SlashCommandBuilder,
  PermissionFlagsBits,
} = require("discord.js");

const commands = [
  new SlashCommandBuilder()
    .setName("panel")
    .setDescription("Опубликовать главное меню LS Bet")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  new SlashCommandBuilder()
    .setName("admin_panel")
    .setDescription("Открыть админ-панель LS Bet")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  new SlashCommandBuilder()
    .setName("event_create")
    .setDescription("Создать RP-событие LS Bet")
    .addStringOption((option) =>
      option
        .setName("title")
        .setDescription("Название события")
        .setRequired(true)
    )
    .addStringOption((option) =>
      option
        .setName("description")
        .setDescription("Описание события")
        .setRequired(true)
    )
    .addStringOption((option) =>
      option
        .setName("option1")
        .setDescription("Первый исход")
        .setRequired(true)
    )
    .addNumberOption((option) =>
      option
        .setName("odds1")
        .setDescription("Коэффициент первого исхода")
        .setRequired(true)
    )
    .addAttachmentOption((option) =>
      option
        .setName("image1")
        .setDescription("Картинка первого исхода")
        .setRequired(true)
    )
    .addStringOption((option) =>
      option
        .setName("option2")
        .setDescription("Второй исход")
        .setRequired(true)
    )
    .addNumberOption((option) =>
      option
        .setName("odds2")
        .setDescription("Коэффициент второго исхода")
        .setRequired(true)
    )
    .addAttachmentOption((option) =>
      option
        .setName("image2")
        .setDescription("Картинка второго исхода")
        .setRequired(true)
    )
    .addIntegerOption((option) =>
      option
        .setName("minutes")
        .setDescription("Через сколько минут закрыть ставки")
        .setRequired(true)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  new SlashCommandBuilder()
    .setName("finish_event")
    .setDescription("Завершить событие и выбрать победителя")
    .addIntegerOption((option) =>
      option
        .setName("event_id")
        .setDescription("ID события")
        .setRequired(true)
    )
    .addIntegerOption((option) =>
      option
        .setName("winner")
        .setDescription("Победный исход")
        .setRequired(true)
        .addChoices(
          { name: "Исход 1", value: 1 },
          { name: "Исход 2", value: 2 }
        )
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  new SlashCommandBuilder()
    .setName("add_balance")
    .setDescription("Начислить баланс игроку")
    .addUserOption((option) =>
      option
        .setName("user")
        .setDescription("Игрок")
        .setRequired(true)
    )
    .addIntegerOption((option) =>
      option
        .setName("amount")
        .setDescription("Сумма в $")
        .setRequired(true)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
].map((command) => command.toJSON());

const rest = new REST({ version: "10" }).setToken(process.env.DISCORD_TOKEN);

async function main() {
  try {
    console.log("Регистрирую команды LS Bet...");

    await rest.put(
      Routes.applicationGuildCommands(
        process.env.CLIENT_ID,
        process.env.GUILD_ID
      ),
      {
        body: commands,
      }
    );

    console.log("Команды зарегистрированы.");
  } catch (error) {
    console.error(error);
  }
}

main();