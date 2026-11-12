// The Android app's pairing QR scanner: a full-screen camera view the app
// opens (MainActivity's MarasiAndroid.scanQr), which answers with a
// "marasi-qr" window event. Resolves to the code's text, or null when the
// researcher backed out; rejects when the app has no scanner.
export function scanOnAndroid(win = globalThis.window) {
	return new Promise((resolve, reject) => {
		const scanner = win?.MarasiAndroid;
		if (!scanner?.scanQr) {
			reject(new Error("no-camera"));
			return;
		}
		const answer = (event) => {
			win.removeEventListener("marasi-qr", answer);
			const detail = event.detail ?? {};
			resolve(detail.cancelled ? null : (detail.text ?? null));
		};
		win.addEventListener("marasi-qr", answer);
		try {
			scanner.scanQr();
		} catch (err) {
			win.removeEventListener("marasi-qr", answer);
			reject(err);
		}
	});
}
