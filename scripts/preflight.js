#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const root = path.resolve(__dirname, "..");
const ignoredDirectories = new Set(["node_modules", ".git", "generated"]);
const conflictPattern = /^(<<<<<<<|=======|>>>>>>>)/m;
const textExtensions = new Set([".js", ".json", ".prisma", ".md", ".toml", ".example"]);
const errors = [];

function walk(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && ignoredDirectories.has(entry.name)) continue;
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      walk(fullPath);
      continue;
    }

    const extension = path.extname(entry.name);
    if (!textExtensions.has(extension) && entry.name !== ".gitignore") continue;

    const content = fs.readFileSync(fullPath, "utf8");
    if (conflictPattern.test(content)) {
      errors.push(`Git conflict markers: ${path.relative(root, fullPath)}`);
    }
  }
}

function checkJson(file) {
  try {
    JSON.parse(fs.readFileSync(path.join(root, file), "utf8"));
  } catch (error) {
    errors.push(`Invalid JSON in ${file}: ${error.message}`);
  }
}

function checkSyntax(file) {
  try {
    execFileSync(process.execPath, ["--check", path.join(root, file)], { stdio: "pipe" });
  } catch (error) {
    errors.push(`JavaScript syntax error in ${file}: ${String(error.stderr || error.message).trim()}`);
  }
}

function parseEnvKeys(content) {
  const counts = new Map();
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#") || !line.includes("=")) continue;
    const key = line.slice(0, line.indexOf("=")).trim();
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return counts;
}

walk(root);
checkJson("package.json");
checkJson("package-lock.json");

for (const file of [
  "index.js",
  "deploy-commands.js",
  "scripts/migrate-sqlite-to-postgres.js",
  "scripts/verify-postgres-migration.js",
]) {
  checkSyntax(file);
}

const postgresSchema = fs.readFileSync(path.join(root, "prisma/schema.prisma"), "utf8");
if (!/provider\s*=\s*"postgresql"/.test(postgresSchema)) {
  errors.push('prisma/schema.prisma must use provider = "postgresql"');
}

const sqliteSchema = fs.readFileSync(path.join(root, "prisma/sqlite.schema.prisma"), "utf8");
if (!/provider\s*=\s*"sqlite"/.test(sqliteSchema)) {
  errors.push('prisma/sqlite.schema.prisma must use provider = "sqlite"');
}

const envPath = path.join(root, ".env");
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, "utf8");
  const counts = parseEnvKeys(envContent);
  for (const [key, count] of counts) {
    if (count > 1) errors.push(`Duplicate .env key: ${key} (${count} times)`);
  }

  const databaseLine = envContent
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith("DATABASE_URL="))
    .at(-1);

  if (databaseLine && !/^DATABASE_URL\s*=\s*["']?postgres(?:ql)?:\/\//i.test(databaseLine)) {
    errors.push("DATABASE_URL in .env must point to PostgreSQL");
  }
}

if (errors.length) {
  console.error("❌ Preflight failed:");
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log("✅ Preflight passed: conflicts, JSON, JavaScript syntax, and database providers are valid.");
