#!/usr/bin/env node
"use strict";

const path = require("path");
const fs = require("fs");
require("dotenv").config();

const sqlitePath = path.resolve(__dirname, "../prisma/dev.db");
if (!process.env.SQLITE_DATABASE_URL) {
  if (!fs.existsSync(sqlitePath)) {
    console.error(`❌ SQLite source not found: ${sqlitePath}`);
    process.exit(1);
  }
  process.env.SQLITE_DATABASE_URL = `file:${sqlitePath.replace(/\\/g, "/")}`;
}

if (!process.env.DATABASE_URL || !/^postgres(ql)?:\/\//i.test(process.env.DATABASE_URL)) {
  console.error("❌ DATABASE_URL must contain the Bothost PostgreSQL connection string.");
  process.exit(1);
}


const { PrismaClient: SqlitePrismaClient } = require("../generated/sqlite-client");
const { PrismaClient: PostgresPrismaClient } = require("@prisma/client");

const sqlite = new SqlitePrismaClient();
const postgres = new PostgresPrismaClient();

const BATCH_SIZE = 500;

const models = [
  { client: "user", table: "User" },
  { client: "registrationRequest", table: "RegistrationRequest" },
  { client: "rpEvent", table: "RpEvent" },
  { client: "eventOption", table: "EventOption" },
  { client: "bet", table: "Bet" },
  { client: "transaction", table: "Transaction" },
  { client: "topUpRequest", table: "TopUpRequest" },
  { client: "withdrawRequest", table: "WithdrawRequest" },
  { client: "botLog", table: "BotLog" },
  { client: "coinflipGame", table: "CoinflipGame" },
  { client: "promoCode", table: "PromoCode" },
  { client: "promoActivation", table: "PromoActivation" },
  { client: "referralReward", table: "ReferralReward" },
  { client: "lotteryDraw", table: "LotteryDraw" },
  { client: "lotteryTicket", table: "LotteryTicket" },
  { client: "jackpotWar", table: "JackpotWar" },
  { client: "jackpotContribution", table: "JackpotContribution" },
  { client: "crashRound", table: "CrashRound" },
  { client: "crashBet", table: "CrashBet" },
];

function chunks(items, size) {
  const out = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

async function targetRowCounts() {
  const result = {};
  for (const model of models) {
    result[model.table] = await postgres[model.client].count();
  }
  return result;
}

async function assertTargetIsSafe() {
  const counts = await targetRowCounts();
  const nonEmpty = Object.entries(counts).filter(([, count]) => count > 0);
  if (nonEmpty.length && process.env.MIGRATION_ALLOW_NONEMPTY !== "true") {
    console.error("❌ PostgreSQL target is not empty. Migration stopped to protect existing data.");
    for (const [table, count] of nonEmpty) console.error(`   ${table}: ${count}`);
    console.error("Use a new empty database, or set MIGRATION_ALLOW_NONEMPTY=true only when resuming the same migration.");
    process.exit(1);
  }
}

async function copyModel(clientName, tableName, transform = (row) => row) {
  const sourceRows = await sqlite[clientName].findMany({ orderBy: { id: "asc" } });
  if (!sourceRows.length) {
    console.log(`• ${tableName}: 0 rows`);
    return;
  }

  let inserted = 0;
  for (const batch of chunks(sourceRows.map(transform), BATCH_SIZE)) {
    const result = await postgres[clientName].createMany({
      data: batch,
      skipDuplicates: true,
    });
    inserted += result.count;
  }
  console.log(`✅ ${tableName}: source ${sourceRows.length}, inserted ${inserted}`);
}

async function resetSequence(tableName) {
  const escaped = tableName.replace(/"/g, '""');
  const sql = `
    SELECT setval(
      pg_get_serial_sequence('public."${escaped}"', 'id'),
      COALESCE(MAX("id"), 1),
      COUNT(*) > 0
    )
    FROM "${escaped}";
  `;
  await postgres.$queryRawUnsafe(sql);
}

async function main() {
  console.log("🚚 LS BET: SQLite → PostgreSQL migration");
  console.log(`Source: ${sqlitePath}`);
  console.log("Target: PostgreSQL from DATABASE_URL");
  console.log("");

  await sqlite.$connect();
  await postgres.$connect();
  await assertTargetIsSafe();

  // Users are imported without the self-reference first.
  const users = await sqlite.user.findMany({ orderBy: { id: "asc" } });
  for (const batch of chunks(users.map((row) => ({ ...row, referredByUserId: null })), BATCH_SIZE)) {
    await postgres.user.createMany({ data: batch, skipDuplicates: true });
  }
  for (const user of users) {
    if (user.referredByUserId !== null) {
      await postgres.user.update({
        where: { id: user.id },
        data: { referredByUserId: user.referredByUserId },
      });
    }
  }
  console.log(`✅ User: source ${users.length}`);

  await copyModel("registrationRequest", "RegistrationRequest");
  await copyModel("rpEvent", "RpEvent");
  await copyModel("eventOption", "EventOption");
  await copyModel("bet", "Bet");
  await copyModel("transaction", "Transaction");
  await copyModel("topUpRequest", "TopUpRequest");
  await copyModel("withdrawRequest", "WithdrawRequest");
  await copyModel("botLog", "BotLog");
  await copyModel("coinflipGame", "CoinflipGame");
  await copyModel("promoCode", "PromoCode");
  await copyModel("promoActivation", "PromoActivation");
  await copyModel("referralReward", "ReferralReward");
  await copyModel("lotteryDraw", "LotteryDraw");
  await copyModel("lotteryTicket", "LotteryTicket");
  await copyModel("jackpotWar", "JackpotWar");
  await copyModel("jackpotContribution", "JackpotContribution");
  await copyModel("crashRound", "CrashRound");
  await copyModel("crashBet", "CrashBet");

  console.log("");
  console.log("🔢 Synchronizing PostgreSQL sequences...");
  for (const model of models) {
    await resetSequence(model.table);
  }

  console.log("");
  console.log("✅ Migration finished. Run: npm run migration:verify");
}

main()
  .catch((error) => {
    console.error("❌ Migration failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await Promise.allSettled([sqlite.$disconnect(), postgres.$disconnect()]);
  });
