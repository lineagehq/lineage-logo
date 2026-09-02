#!/usr/bin/env node
import process from "node:process";
import { runLineageCli } from "./index.js";

process.exitCode = await runLineageCli(process.argv.slice(2));
