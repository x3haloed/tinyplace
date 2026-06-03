/**
 * Discord interactions handler for Tinyplace pixel canvas.
 * 
 * Slash commands:
 *   /pixel <x> <y> <color> — Place a pixel
 *   /canvas — View the current canvas state
 * 
 * Environment secrets:
 *   DISCORD_PUBLIC_KEY — Discord application public key (hex)
 *   DISCORD_APPLICATION_ID — Discord application ID (for followup messages)
 *   DISCORD_BOT_TOKEN — Discord bot token (for followup messages)
 */

const SIZE = 64;

// Hex to Uint8Array
function hexToBytes(hex: string): Uint8Array {
	const bytes = new Uint8Array(hex.length / 2);
	for (let i = 0; i < hex.length; i += 2) {
		bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
	}
	return bytes;
}

// Ed25519 verification using Web Crypto
async function verifyDiscordRequest(
	publicKeyHex: string,
	signatureHex: string,
	timestamp: string,
	body: string,
): Promise<boolean> {
	const publicKeyBytes = hexToBytes(publicKeyHex);
	const signatureBytes = hexToBytes(signatureHex);
	const messageBytes = new TextEncoder().encode(timestamp + body);

	try {
		const key = await crypto.subtle.importKey(
			"raw",
			publicKeyBytes,
			{ name: "Ed25519" } as any,
			false,
			["verify"],
		);

		return await crypto.subtle.verify(
			{ name: "Ed25519" } as any,
			key,
			signatureBytes,
			messageBytes,
		);
	} catch {
		return false;
	}
}

// Format a 64×64 grid into a text representation for Discord embed
function formatCanvasGrid(pixels: (string | null)[][]): string {
	let result = "";
	for (let y = 0; y < Math.min(SIZE, 16); y++) {
		for (let x = 0; x < Math.min(SIZE, 32); x++) {
			const color = pixels[y]?.[x];
			result += color ? "█" : "·";
		}
		result += "\n";
	}
	return result || "(empty canvas)";
}

// Build a hex color-based emoji representation
function pixelToEmoji(color: string | null): string {
	if (!color) return "⬛";
	const r = parseInt(color.slice(1, 3), 16);
	const g = parseInt(color.slice(3, 5), 16);
	const b = parseInt(color.slice(5, 7), 16);
	// Simple palette mapping
	if (r > 200 && g < 100 && b < 100) return "🔴";
	if (r < 100 && g > 200 && b < 100) return "🟢";
	if (r < 100 && g < 100 && b > 200) return "🔵";
	if (r > 200 && g > 200 && b < 100) return "🟡";
	if (r > 200 && g < 100 && b > 200) return "🟣";
	if (r < 100 && g > 200 && b > 200) return "🩵";
	if (r > 200 && g > 200 && b > 200) return "⬜";
	if (r < 50 && g < 50 && b < 50) return "⬛";
	return "🟧";
}

// Create a canvas preview string (emoji-based, 64×64 is too large for a single message)
function formatCanvasPreview(pixels: (string | null)[][]): string {
	// Show a 8×8 center crop as an emoji grid
	const cx = Math.floor(SIZE / 2);
	const cy = Math.floor(SIZE / 2);
	const preview = 8;
	let result = "";
	for (let y = cy - preview / 2; y < cy + preview / 2; y++) {
		for (let x = cx - preview / 2; x < cx + preview / 2; x++) {
			result += pixelToEmoji(pixels[y]?.[x] ?? null);
		}
		result += "\n";
	}
	return result;
}

export interface DiscordEnv {
	DISCORD_PUBLIC_KEY?: string;
	DISCORD_APPLICATION_ID?: string;
	DISCORD_BOT_TOKEN?: string;
}

// Interaction types
const InteractionType = {
	PING: 1,
	APPLICATION_COMMAND: 2,
	MESSAGE_COMPONENT: 3,
	APPLICATION_COMMAND_AUTOCOMPLETE: 4,
	MODAL_SUBMIT: 5,
} as const;

// Interaction response types
const InteractionResponseType = {
	PONG: 1,
	CHANNEL_MESSAGE_WITH_SOURCE: 4,
	DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE: 5,
	DEFERRED_UPDATE_MESSAGE: 6,
	UPDATE_MESSAGE: 7,
	APPLICATION_COMMAND_AUTOCOMPLETE_RESULT: 8,
	MODAL: 9,
} as const;

export async function handleDiscordInteraction(
	request: Request,
	env: DiscordEnv,
	getCanvas: () => Promise<(string | null)[][]>,
	setPixel: (x: number, y: number, color: string) => Promise<boolean>,
): Promise<Response> {
	const publicKey = env.DISCORD_PUBLIC_KEY;
	if (!publicKey) {
		return new Response("Discord not configured", { status: 500 });
	}

	// Verify signature
	const signature = request.headers.get("X-Signature-Ed25519");
	const timestamp = request.headers.get("X-Signature-Timestamp");
	if (!signature || !timestamp) {
		return new Response("Bad request signature", { status: 401 });
	}

	const body = await request.clone().text();
	const isValid = await verifyDiscordRequest(publicKey, signature, timestamp, body);
	if (!isValid) {
		return new Response("Invalid request signature", { status: 401 });
	}

	const interaction = JSON.parse(body);

	// Handle PING
	if (interaction.type === InteractionType.PING) {
		return Response.json({ type: InteractionResponseType.PONG });
	}

	// Handle slash commands
	if (interaction.type === InteractionType.APPLICATION_COMMAND) {
		const commandName = interaction.data.name.toLowerCase();

		switch (commandName) {
			case "pixel": {
				const x = interaction.data.options?.find((o: any) => o.name === "x")?.value;
				const y = interaction.data.options?.find((o: any) => o.name === "y")?.value;
				const color = interaction.data.options?.find((o: any) => o.name === "color")?.value;

				if (x === undefined || y === undefined || !color) {
					return Response.json({
						type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
						data: { content: "Usage: /pixel x:<number> y:<number> color:<hexcolor>", flags: 64 },
					});
				}

				if (typeof x !== "number" || typeof y !== "number" || x < 0 || x >= SIZE || y < 0 || y >= SIZE) {
					return Response.json({
						type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
						data: { content: `Coordinates must be 0-${SIZE - 1}.`, flags: 64 },
					});
				}

				// Basic hex color validation
				if (!/^#[0-9a-fA-F]{6}$/.test(color)) {
					return Response.json({
						type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
						data: { content: "Color must be a hex code like #FF5733.", flags: 64 },
					});
				}

				const ok = await setPixel(x, y, color);
				if (!ok) {
					return Response.json({
						type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
						data: { content: "Failed to place pixel. Try again.", flags: 64 },
					});
				}

				const emoji = pixelToEmoji(color);
				return Response.json({
					type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
					data: {
						content: `${emoji} Pixel placed at (${x}, ${y}) — ${color}`,
					},
				});
			}

			case "canvas": {
				const canvas = await getCanvas();
				const preview = formatCanvasPreview(canvas);
				const filled = canvas.flat().filter(c => c !== null).length;
				const total = SIZE * SIZE;

				return Response.json({
					type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
					data: {
						content: `**Tinyplace Canvas** (${filled}/${total} pixels filled)\n\`\`\`\n${preview}\`\`\`\nPlace a pixel: \`/pixel x: y: color:\``,
					},
				});
			}

			default:
				return Response.json({
					type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
					data: { content: `Unknown command: ${commandName}`, flags: 64 },
				});
		}
	}

	return Response.json({ type: InteractionResponseType.PONG });
}
