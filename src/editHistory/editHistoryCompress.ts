import { deflateSync, inflateSync, strToU8, strFromU8 } from "fflate";

export interface EncodedContent {
	content: string;
	contentEnc?: "dfb64";
}

const COMPRESSION_THRESHOLD = 512;

export function encodeContent(raw: string): EncodedContent {
	if (raw.length < COMPRESSION_THRESHOLD) return { content: raw };
	const compressed = deflateSync(strToU8(raw));
	const b64 = u8ToB64(compressed);
	if (b64.length >= raw.length) return { content: raw };
	return { content: b64, contentEnc: "dfb64" };
}

export function decodeContent(content: string, enc: "dfb64" | undefined): string {
	if (enc === undefined) return content;
	if (enc === "dfb64") return strFromU8(inflateSync(b64ToU8(content)));
	throw new Error(`editHistoryCompress: unknown encoding "${enc}"`);
}

// Chunked base64 encode/decode to avoid call-stack overflow on large inputs.
function u8ToB64(u8: Uint8Array): string {
	const CHUNK = 0x8000;
	let result = "";
	for (let i = 0; i < u8.length; i += CHUNK) {
		const slice = u8.subarray(i, Math.min(i + CHUNK, u8.length));
		result += String.fromCharCode(...slice);
	}
	return btoa(result);
}

function b64ToU8(b64: string): Uint8Array {
	const bin = atob(b64);
	const u8 = new Uint8Array(bin.length);
	for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
	return u8;
}
