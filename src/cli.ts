#!/usr/bin/env node

import { Command } from "commander";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { doctorCommand } from "./commands/doctor.js";
import { schemaCommand } from "./commands/schema.js";
import { updateCommand } from "./commands/update.js";
import { isObjectOrNull, isRuntimeString } from "./internal/runtime-type.js";

// Read version from package.json so it stays in sync with the published version.
const pkgPath = join(dirname(fileURLToPath(import.meta.url)), "..", "package.json");
const parsedPackage = JSON.parse(readFileSync(pkgPath, "utf8"));
if (
  !isObjectOrNull(parsedPackage) ||
  parsedPackage === null ||
  !("version" in parsedPackage) ||
  !isRuntimeString(parsedPackage.version)
) {
  throw new Error("package.json version is missing");
}
const VERSION = parsedPackage.version;

const program = new Command();

program
  .name("grits")
  .description("Typed, backend-independent Git repository API for filesystem and in-memory implementations.")
  .version(VERSION);

program
  .command("doctor")
  .description("Health check: verify environment and configuration")
  .option("--json", "Emit machine-readable JSON instead of human output")
  .action(doctorCommand);

program
  .command("schema [path...]")
  .description("Emit the machine-readable command catalog")
  .option("--summary", "Return only version, command count, and command paths")
  .action((pathArgs: string[] | undefined, opts: { summary?: boolean }) => schemaCommand(pathArgs ?? [], opts, VERSION));

program
  .command("update")
  .description("Self-update: git pull, npm install, and rebuild grits")
  .option("--json", "Emit machine-readable JSON instead of human output")
  .action(updateCommand);

// Add more commands here, e.g.:
//   import { helloCommand } from "./commands/hello.js";
//   program.command("hello").description("Say hello").action(helloCommand);

// Bare `grits` (no args) prints version + full help. Matches the
// rotunda/kash/reflux convention. No version banner before sub-commands
// so machine-parseable output stays clean.
if (process.argv.slice(2).length === 0) {
  process.stdout.write(`grits v${VERSION}\n\n`);
  program.outputHelp();
  process.exit(0);
}

program.parseAsync(process.argv).catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
