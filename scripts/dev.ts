import process from "node:process";
import { runLineageCli } from "../src/cli/index.js";

process.exitCode = await runLineageCli(["launch", "--development", ...process.argv.slice(2)]);
