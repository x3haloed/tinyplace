import { DurableObject } from "cloudflare:workers";

/**
 * Welcome to Cloudflare Workers! This is your first Durable Objects application.
 *
 * - Run `npm run dev` in your terminal to start a development server
 * - Open a browser tab at http://localhost:8787/ to see your Durable Object in action
 * - Run `npm run deploy` to publish your application
 *
 * Bind resources to your worker in `wrangler.jsonc`. After adding bindings, a type definition for the
 * `Env` object can be regenerated with `npm run cf-typegen`.
 *
 * Learn more at https://developers.cloudflare.com/durable-objects
 */

const SIZE = 64;

/** A Durable Object's behavior is defined in an exported Javascript class */
export class PixelCanvas extends DurableObject<Env> {
	pixels: (string | null)[][] | null = null;

	async init() {
		if (this.pixels) return;
		// Load from storage or create empty grid
		this.pixels = await this.ctx.storage.get("pixels") 
		?? Array(SIZE).fill(null).map(() => Array(SIZE).fill(null));
	}

	async getCanvas() {
		await this.init();
		return this.pixels;
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
	/**
	 * This is the standard fetch handler for a Cloudflare Worker
	 *
	 * @param request - The request submitted to the Worker from the client
	 * @param env - The interface to reference bindings declared in wrangler.jsonc
	 * @param ctx - The execution context of the Worker
	 * @returns The response to be sent back to the client
	 */
	async fetch(request, env, ctx): Promise<Response> {
		// Create a stub to open a communication channel with the Durable Object
		// instance named "foo".
		//
		// Requests from all Workers to the Durable Object instance named "foo"
		// will go to a single remote Durable Object instance.
		const url = new URL(request.url);
    	const stub = env.PIXEL_CANVAS.getByName("main");

		if (url.pathname === "/canvas" && request.method === "GET") {
			return Response.json(await stub.getCanvas());
		}

		if (url.pathname === "/pixel" && request.method === "PUT") {
			const { x, y, color } = await request.json();
			const ok = await stub.setPixel(x, y, color);
			return ok ? new Response("ok") : new Response("invalid", { status: 400 });
		}

		return new Response("not found", { status: 404 });
	},
} satisfies ExportedHandler<Env>;
