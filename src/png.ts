/**
 * Minimal PNG encoder for the Tinyplace canvas.
 *
 * Encodes a 64×64 grid of hex color strings (or null) into a PNG image.
 * Uses only built-in Worker APIs — CompressionStream for deflate.
 */

// PNG signature byte sequence
const PNG_SIGNATURE = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);

// Pre-computed CRC-32 table (IEEE polynomial)
const CRC_TABLE = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
	let c = i;
	for (let j = 0; j < 8; j++) {
		c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
	}
	CRC_TABLE[i] = c;
}

function crc32(data: Uint8Array): number {
	let c = 0xFFFFFFFF;
	for (let i = 0; i < data.length; i++) {
		c = CRC_TABLE[(c ^ data[i]) & 0xFF] ^ (c >>> 8);
	}
	return c ^ 0xFFFFFFFF;
}

/** Write a 32-bit unsigned integer as big-endian bytes */
function u32be(v: number): Uint8Array {
	return new Uint8Array([
		(v >>> 24) & 0xFF,
		(v >>> 16) & 0xFF,
		(v >>> 8) & 0xFF,
		v & 0xFF,
	]);
}

/**
 * Build a PNG chunk: length (4 bytes), type (4 bytes), data, CRC (4 bytes)
 * CRC covers type + data
 */
function makeChunk(type: string, data: Uint8Array): Uint8Array {
	const typeBytes = new TextEncoder().encode(type);
	const crcInput = new Uint8Array(typeBytes.length + data.length);
	crcInput.set(typeBytes, 0);
	crcInput.set(data, typeBytes.length);

	const length = u32be(data.length);
	const crc = u32be(crc32(crcInput));

	const chunk = new Uint8Array(4 + 4 + data.length + 4);
	chunk.set(length, 0);
	chunk.set(typeBytes, 4);
	chunk.set(data, 8);
	chunk.set(crc, 8 + data.length);
	return chunk;
}

/** Build the IHDR chunk: 13 bytes */
function makeIHDR(width: number, height: number): Uint8Array {
	const data = new Uint8Array(13);
	// Width (4 bytes, big-endian)
	data[0] = (width >>> 24) & 0xFF;
	data[1] = (width >>> 16) & 0xFF;
	data[2] = (width >>> 8) & 0xFF;
	data[3] = width & 0xFF;
	// Height (4 bytes, big-endian)
	data[4] = (height >>> 24) & 0xFF;
	data[5] = (height >>> 16) & 0xFF;
	data[6] = (height >>> 8) & 0xFF;
	data[7] = height & 0xFF;
	// Bit depth: 8
	data[8] = 8;
	// Color type: 6 (RGBA)
	data[9] = 6;
	// Compression method: 0 (deflate)
	data[10] = 0;
	// Filter method: 0 (adaptive)
	data[11] = 0;
	// Interlace method: 0 (none)
	data[12] = 0;
	return makeChunk("IHDR", data);
}

/** Convert a hex color string (e.g. "#FF5733") to RGBA bytes. Null becomes transparent (0,0,0,0). */
function hexToRGBA(hex: string | null): [number, number, number, number] {
	if (!hex || hex.length < 7) return [0, 0, 0, 0];
	const r = parseInt(hex.slice(1, 3), 16);
	const g = parseInt(hex.slice(3, 5), 16);
	const b = parseInt(hex.slice(5, 7), 16);
	return [r, g, b, 255];
}

/**
 * Build the filtered raw pixel data for deflate compression.
 *
 * Each scanline starts with a filter byte (0 = None),
 * followed by RGBA bytes for each pixel.
 */
function buildFilteredData(
	pixels: (string | null)[][],
	width: number,
	height: number,
): Uint8Array {
	const bytesPerPixel = 4; // RGBA
	const scanlineBytes = 1 + width * bytesPerPixel; // filter byte + pixels
	const data = new Uint8Array(height * scanlineBytes);

	for (let y = 0; y < height; y++) {
		const row = pixels[y] ?? [];
		const offset = y * scanlineBytes;

		// Filter byte: 0 (None) for each scanline
		data[offset] = 0;

		for (let x = 0; x < width; x++) {
			const [r, g, b, a] = hexToRGBA(row[x] ?? null);
			const pxOffset = offset + 1 + x * bytesPerPixel;
			data[pxOffset] = r;
			data[pxOffset + 1] = g;
			data[pxOffset + 2] = b;
			data[pxOffset + 3] = a;
		}
	}

	return data;
}

/** Compress data using deflate (zlib format) via CompressionStream */
async function deflate(data: Uint8Array): Promise<Uint8Array> {
	const cs = new CompressionStream("deflate");
	const writer = cs.writable.getWriter();
	writer.write(data);
	writer.close();

	const reader = cs.readable.getReader();
	const chunks: Uint8Array[] = [];
	while (true) {
		const { done, value } = await reader.read();
		if (done) break;
		chunks.push(value);
	}

	const total = chunks.reduce((sum, c) => sum + c.length, 0);
	const result = new Uint8Array(total);
	let offset = 0;
	for (const chunk of chunks) {
		result.set(chunk, offset);
		offset += chunk.length;
	}
	return result;
}

/**
 * Encode a pixel grid into a PNG image.
 *
 * @param pixels 2D array of hex color strings (e.g. "#FF5733") or null (empty)
 * @param width Width of the canvas (default 64)
 * @param height Height of the canvas (default 64)
 * @returns Uint8Array containing the complete PNG file
 */
export async function encodeCanvas(
	pixels: (string | null)[][],
	width: number = 64,
	height: number = 64,
): Promise<Uint8Array> {
	const filteredData = buildFilteredData(pixels, width, height);
	const compressed = await deflate(filteredData);

	// Assemble PNG
	const ihdr = makeIHDR(width, height);
	const idat = makeChunk("IDAT", compressed);
	const iend = makeChunk("IEND", new Uint8Array(0));

	const total = PNG_SIGNATURE.length + ihdr.length + idat.length + iend.length;
	const png = new Uint8Array(total);
	let offset = 0;

	png.set(PNG_SIGNATURE, offset);
	offset += PNG_SIGNATURE.length;

	png.set(ihdr, offset);
	offset += ihdr.length;

	png.set(idat, offset);
	offset += idat.length;

	png.set(iend, offset);
	return png;
}