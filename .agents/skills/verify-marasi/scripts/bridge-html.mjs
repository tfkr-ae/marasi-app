// Wails v2 injects these scripts at / even when app.html supplies them.
export function deduplicateBridgeHTML(html) {
	const counts = { "/wails/ipc.js": 0, "/wails/runtime.js": 0 };
	const body = html.replace(/<script\b[^>]*\bsrc\s*=\s*(["'])(\/wails\/(?:ipc|runtime)\.js)\1[^>]*>\s*<\/script\s*>/gi, (tag, quote, src) => {
		counts[src] += 1;
		return counts[src] === 1 ? tag : "";
	});
	for (const [src, count] of Object.entries(counts)) {
		if (count === 0) throw new Error(`Root document is missing ${src}`);
	}
	return { body, counts };
}
