#!/usr/bin/env node

/**
 * Register Discord slash commands for Tinyplace.
 *
 * Usage:
 *   node scripts/register-commands.mjs <bot-token>
 *
 * Or set DISCORD_BOT_TOKEN in the environment.
 */

const APPLICATION_ID = "1511586869362561205";

const commands = [
  {
    name: "pixel",
    description: "Place a pixel on the canvas",
    options: [
      {
        type: 4, // INTEGER
        name: "x",
        description: "X coordinate (0-63)",
        required: true,
        min_value: 0,
        max_value: 63,
      },
      {
        type: 4, // INTEGER
        name: "y",
        description: "Y coordinate (0-63)",
        required: true,
        min_value: 0,
        max_value: 63,
      },
      {
        type: 3, // STRING
        name: "color",
        description: "Hex color code (e.g. #FF5733)",
        required: true,
      },
    ],
  },
  {
    name: "canvas",
    description: "View the current canvas state",
  },
];

async function main() {
  const token = process.argv[2] || process.env.DISCORD_BOT_TOKEN;
  if (!token) {
    console.error("Error: Provide the bot token as an argument or set DISCORD_BOT_TOKEN");
    process.exit(1);
  }

  const url = `https://discord.com/api/v10/applications/${APPLICATION_ID}/commands`;

  for (const command of commands) {
    console.log(`Registering /${command.name}...`);
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Authorization": `Bot ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(command),
    });

    if (res.ok) {
      const data = await res.json();
      console.log(`  ✅ /${command.name} registered (id: ${data.id})`);
    } else {
      const text = await res.text();
      console.error(`  ❌ /${command.name} failed: ${res.status} ${text}`);
      process.exit(1);
    }
  }

  console.log("\nAll commands registered! Discord may take a few minutes to propagate.");
}

main();