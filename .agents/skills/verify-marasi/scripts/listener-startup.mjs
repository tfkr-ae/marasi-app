export function normalizeListenerStartup(body) {
	const startup = /StartProxy\(\s*\$marasiConfig\.DefaultAddress,\s*\$marasiConfig\.DefaultPort\s*\)/g;
	const matches = Array.from(body.matchAll(startup));
	if (matches.length !== 1 || !body.includes("const StartupRoutine2 = new Promise")) {
		throw new Error(`Expected exactly one configured listener startup call, found ${matches.length}`);
	}
	return {
		body: body.replace(startup, `$&.catch(async (error) => {
			if (error !== "listener already active") throw error;
			await window.go.main.App.UpdateProxy($marasiConfig.DefaultAddress, $marasiConfig.DefaultPort);
			console.info("Marasi verification: reconciled already-active startup listener");
		})`),
	};
}
