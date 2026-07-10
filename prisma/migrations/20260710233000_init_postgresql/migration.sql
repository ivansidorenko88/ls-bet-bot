-- LS BET initial PostgreSQL schema
CREATE TABLE "User" (
    "id" SERIAL NOT NULL,
    "discordId" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "balance" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "registrationStatus" TEXT,
    "registeredFullName" TEXT,
    "registeredPhone" TEXT,
    "registeredAge" INTEGER,
    "registeredAt" TIMESTAMP(3),
    "referredByUserId" INTEGER,
    "refPercent" INTEGER,
    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "RegistrationRequest" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "fullName" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "age" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "ticketChannelId" TEXT,
    "processedBy" TEXT,
    "processedAt" TIMESTAMP(3),
    "rejectReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "RegistrationRequest_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "RpEvent" (
    "id" SERIAL NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "closesAt" TIMESTAMP(3) NOT NULL,
    "createdBy" TEXT,
    "messageId" TEXT,
    "channelId" TEXT,
    "facebrowserPostId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "RpEvent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "EventOption" (
    "id" SERIAL NOT NULL,
    "eventId" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "odds" DOUBLE PRECISION NOT NULL,
    "imageUrl" TEXT,
    "isWinner" BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "EventOption_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Bet" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "eventId" INTEGER NOT NULL,
    "optionId" INTEGER NOT NULL,
    "amount" INTEGER NOT NULL,
    "potentialWin" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Bet_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Transaction" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "amount" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "comment" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Transaction_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TopUpRequest" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "login" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "comment" TEXT,
    "screenshotUrl" TEXT,
    "ticketChannelId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "processedBy" TEXT,
    "processedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TopUpRequest_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "WithdrawRequest" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "login" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "commission" INTEGER NOT NULL,
    "payoutAmount" INTEGER NOT NULL,
    "details" TEXT NOT NULL,
    "comment" TEXT,
    "ticketChannelId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "processedBy" TEXT,
    "processedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "WithdrawRequest_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "BotLog" (
    "id" SERIAL NOT NULL,
    "type" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "userId" TEXT,
    "channelId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "BotLog_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CoinflipGame" (
    "id" SERIAL NOT NULL,
    "creatorUserId" INTEGER NOT NULL,
    "opponentUserId" INTEGER,
    "winnerUserId" INTEGER,
    "amount" INTEGER NOT NULL,
    "creatorSide" TEXT NOT NULL,
    "opponentSide" TEXT,
    "resultSide" TEXT,
    "status" TEXT NOT NULL DEFAULT 'WAITING',
    "messageId" TEXT,
    "channelId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    CONSTRAINT "CoinflipGame_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PromoCode" (
    "id" SERIAL NOT NULL,
    "code" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "maxUses" INTEGER,
    "usesCount" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "type" TEXT NOT NULL DEFAULT 'BONUS',
    "ownerUserId" INTEGER,
    "refPercent" INTEGER,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PromoCode_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PromoActivation" (
    "id" SERIAL NOT NULL,
    "promoCodeId" INTEGER NOT NULL,
    "userId" INTEGER NOT NULL,
    "amount" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PromoActivation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ReferralReward" (
    "id" SERIAL NOT NULL,
    "referrerId" INTEGER NOT NULL,
    "referredId" INTEGER NOT NULL,
    "topUpId" INTEGER,
    "amount" INTEGER NOT NULL,
    "percent" INTEGER NOT NULL,
    "sourceAmount" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ReferralReward_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "LotteryDraw" (
    "id" SERIAL NOT NULL,
    "numbers" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "LotteryDraw_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "LotteryTicket" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "numbers" TEXT NOT NULL,
    "price" INTEGER NOT NULL DEFAULT 1000,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "prize" INTEGER NOT NULL DEFAULT 0,
    "matches" INTEGER NOT NULL DEFAULT 0,
    "drawId" INTEGER,
    "resultNumbers" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "LotteryTicket_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "JackpotWar" (
    "id" SERIAL NOT NULL,
    "currentPool" INTEGER NOT NULL DEFAULT 0,
    "targetPool" INTEGER NOT NULL DEFAULT 500000,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "winnerId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),
    CONSTRAINT "JackpotWar_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "JackpotContribution" (
    "id" SERIAL NOT NULL,
    "roundId" INTEGER NOT NULL,
    "userId" INTEGER NOT NULL,
    "amount" INTEGER NOT NULL,
    "source" TEXT NOT NULL,
    "sourceId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "JackpotContribution_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CrashRound" (
    "id" SERIAL NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'BETTING',
    "crashPoint" DOUBLE PRECISION NOT NULL,
    "messageId" TEXT,
    "channelId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    CONSTRAINT "CrashRound_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CrashBet" (
    "id" SERIAL NOT NULL,
    "roundId" INTEGER NOT NULL,
    "userId" INTEGER NOT NULL,
    "amount" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "autoCashoutMultiplier" DOUBLE PRECISION,
    "cashoutMultiplier" DOUBLE PRECISION,
    "payout" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cashedOutAt" TIMESTAMP(3),
    CONSTRAINT "CrashBet_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "User_discordId_key" ON "User"("discordId");
CREATE UNIQUE INDEX "PromoCode_code_key" ON "PromoCode"("code");
CREATE UNIQUE INDEX "PromoActivation_promoCodeId_userId_key" ON "PromoActivation"("promoCodeId", "userId");

ALTER TABLE "User" ADD CONSTRAINT "User_referredByUserId_fkey" FOREIGN KEY ("referredByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "RegistrationRequest" ADD CONSTRAINT "RegistrationRequest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "EventOption" ADD CONSTRAINT "EventOption_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "RpEvent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Bet" ADD CONSTRAINT "Bet_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Bet" ADD CONSTRAINT "Bet_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "RpEvent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Bet" ADD CONSTRAINT "Bet_optionId_fkey" FOREIGN KEY ("optionId") REFERENCES "EventOption"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TopUpRequest" ADD CONSTRAINT "TopUpRequest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "WithdrawRequest" ADD CONSTRAINT "WithdrawRequest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CoinflipGame" ADD CONSTRAINT "CoinflipGame_creatorUserId_fkey" FOREIGN KEY ("creatorUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CoinflipGame" ADD CONSTRAINT "CoinflipGame_opponentUserId_fkey" FOREIGN KEY ("opponentUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "CoinflipGame" ADD CONSTRAINT "CoinflipGame_winnerUserId_fkey" FOREIGN KEY ("winnerUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PromoCode" ADD CONSTRAINT "PromoCode_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PromoActivation" ADD CONSTRAINT "PromoActivation_promoCodeId_fkey" FOREIGN KEY ("promoCodeId") REFERENCES "PromoCode"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PromoActivation" ADD CONSTRAINT "PromoActivation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ReferralReward" ADD CONSTRAINT "ReferralReward_referrerId_fkey" FOREIGN KEY ("referrerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ReferralReward" ADD CONSTRAINT "ReferralReward_referredId_fkey" FOREIGN KEY ("referredId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ReferralReward" ADD CONSTRAINT "ReferralReward_topUpId_fkey" FOREIGN KEY ("topUpId") REFERENCES "TopUpRequest"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "LotteryTicket" ADD CONSTRAINT "LotteryTicket_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "LotteryTicket" ADD CONSTRAINT "LotteryTicket_drawId_fkey" FOREIGN KEY ("drawId") REFERENCES "LotteryDraw"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "JackpotContribution" ADD CONSTRAINT "JackpotContribution_roundId_fkey" FOREIGN KEY ("roundId") REFERENCES "JackpotWar"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "JackpotContribution" ADD CONSTRAINT "JackpotContribution_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CrashBet" ADD CONSTRAINT "CrashBet_roundId_fkey" FOREIGN KEY ("roundId") REFERENCES "CrashRound"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CrashBet" ADD CONSTRAINT "CrashBet_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
