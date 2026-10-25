#!/usr/bin/env node
const VERSION = '0.0.0';
const arg = process.argv[2];

if (arg === '--version' || arg === '-v') {
  console.log(VERSION);
} else {
  console.log(
    `keepalive ${VERSION}\nNo commands are implemented yet. See docs/architecture.md.`,
  );
}
