#!/usr/bin/env node
"use strict";

const path = require("path");
require("dotenv").config();

const sqlitePath = path.resolve(__dirname, "../prisma/dev.db");
if (!process.env.SQLITE_DATABASE_URL) {
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

const checks = [
  { client: "user", table: "User", sums: ["balance"] },
  { client: "registrationRequest", table: "RegistrationRequest", sums: [] },
  { client: "rpEvent", table: "RpEvent", sums: [] },
  { client: "eventOption", table: "EventOption", sums: [] },
  { client: "bet", table: "Bet", sums: ["amount", "potentialWin"] },
  { client: "transaction", table: "Transaction", sums: ["amount"] },
  { client: "topUpRequest", table: "TopUpRequest", sums: ["amount"] },
  { client: "withdrawRequest", table: "WithdrawRequest", sums: ["amount", "commission", "payoutAmount"] },
  { client: "botLog", table: "BotLog", sums: [] },
  { client: "coinflipGame", table: "CoinflipGame", sums: ["amount"] },
  { client: "promoCode", table: "PromoCode", sums: ["amount", "usesCount"] },
  { client: "promoActivation", table: "PromoActivation", sums: ["amount"] },
  { client: "referralReward", table: "ReferralReward", sums: ["amount", "sourceAmount"] },
  { client: "lotteryDraw", table: "LotteryDraw", sums: [] },
  { client: "lotteryTicket", table: "LotteryTicket", sums: ["price", "prize"] },
  { client: "jackpotWar", table: "JackpotWar", sums: ["currentPool", "targetPool"] },
  { client: "jackpotContribution", table: "JackpotContribution", sums: ["amount"] },
  { client: "crashRound", table: "CrashRound", sums: [] },
  { client: "crashBet", table: "CrashBet", sums: ["amount", "payout"] },
];

async function snapshot(client, check) {
  const count = await client[check.client].count();
  const result = { count };
  if (check.sums.length) {
    const aggregate = await client[check.client].aggregate({
      _sum: Object.fromEntries(check.sums.map((field) => [field, true])),
    });
    for (const field of check.sums) result[`sum_${field}`] = aggregate._sum[field] ?? 0;
  }
  return result;
}

async function main() {
  await sqlite.$connect();
  await postgres.$connect();

  let failed = false;
  console.log("🔍 Verifying SQLite and PostgreSQL...");
  for (const check of checks) {
    const source = await snapshot(sqlite, check);
    const target = await snapshot(postgres, check);
    const ok = JSON.stringify(source) === JSON.stringify(target);
    if (!ok) failed = true;
    console.log(`${ok ? "✅" : "❌"} ${check.table}`);
    console.log(`   SQLite:    ${JSON.stringify(source)}`);
    console.log(`   PostgreSQL:${JSON.stringify(target)}`);
  }

  if (failed) {
    console.error("\n❌ Verification found differences. Do not start the bot on PostgreSQL yet.");
    process.exitCode = 1;
  } else {
    console.log("\n✅ All counts and financial totals match.");
  }
}

main()
  .catch((error) => {
    console.error("❌ Verification failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await Promise.allSettled([sqlite.$disconnect(), postgres.$disconnect()]);
  });
