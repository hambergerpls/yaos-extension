export interface EncodedContent {
	content: string;
	contentEnc?: "dfb64";
}

export function encodeContent(_raw: string): EncodedContent {
	throw new Error("not implemented");
}

export function decodeContent(_content: string, _enc: "dfb64" | undefined): string {
	throw new Error("not implemented");
}
