import { DurableObject } from "cloudflare:workers";
import { handleDiscordInteraction } from "./discord";

const SIZE = 64;

/** A Durable Object's behavior is defined in an exported Javascript class */
export class PixelCanvas extends DurableObject<Env> {
	pixels: (string | null)[][] | null = null;

	async init() {
		if (this.pixels) return;
		this.pixels = await this.ctx.storage.get("pixels") 
		?? Array(SIZE).fill(null).map(() => Array(SIZE).fill(null));
	}

	async getCanvas(): Promise<(string | null)[][]> {
		await this.init();
		return this.pixels!;
	}

	async setPixel(x: number, y: number, color: string) {
		await this.init();
		if (x < 0 || x >= SIZE || y < 0 || y >= SIZE) return false;
		this.pixels![y][x] = color;
		await this.ctx.storage.put("pixels", this.pixels);
		return true;
	}
}

export default {
	async fetch(request, env, ctx): Promise<Response> {
		const url = new URL(request.url);
		const stub = env.PIXEL_CANVAS.getByName("main") as unknown as PixelCanvas;

		// Discord interactions endpoint
		if (url.pathname === "/discord" && request.method === "POST") {
			return handleDiscordInteraction(request, env, 
				() => stub.getCanvas(),
				(x, y, color) => stub.setPixel(x, y, color),
			);
		}

		if (url.pathname === "/canvas" && request.method === "GET") {
			return Response.json(await stub.getCanvas());
		}

		if (url.pathname === "/pixel" && request.method === "PUT") {
			const body = await request.json() as { x: number; y: number; color: string };
			const ok = await stub.setPixel(body.x, body.y, body.color);
			return ok ? new Response("ok") : new Response("invalid", { status: 400 });
		}

		return new Response("not found", { status: 404 });
	},
} satisfies ExportedHandler<Env>;
