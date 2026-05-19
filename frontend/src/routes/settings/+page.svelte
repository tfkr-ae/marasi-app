<script>
	import { Pencil, X } from "lucide-svelte";
	import {
		CreateWaypoint,
		DeleteWaypoint,
		SetFlag,
		ToggleFlag,
		GetChromePaths,
		AddChromePath,
		DeleteChromePath,
		GetChromeProfiles,
		AddChromeProfile,
		DeleteChromeProfile,
	} from "../../lib/wailsjs/go/main/App";
	import {
		marasiConfig,
		populateWaypoints,
		waypoints,
	} from "../../stores";
	import { getToastStore, SlideToggle } from "@skeletonlabs/skeleton";
	import { onMount } from "svelte";
	const toastStore = getToastStore();

	let targetHost = "";
	let override = "";
	let selected = "";
	let selectedOS = "";
	let selectedPath = "";
	let selectedProfile = "";
	let chromePaths = [];
	let chromeProfiles = [];
	function handleSyntaxModeChange(event) {
		const value = event?.target?.value;
		switch (value) {
			case "enabled":
				SetFlag("syntax_mode", "enabled").then(
					(config) => {
						marasiConfig.set(config);
					},
				);
				break;
			case "auto":
				SetFlag("syntax_mode", "auto").then(
					(config) => {
						marasiConfig.set(config);
					},
				);
				break;
			case "disabled":
				SetFlag("syntax_mode", "disabled").then(
					(config) => {
						marasiConfig.set(config);
					},
				);
				break;
		}
	}
	onMount(() => {
		GetChromePaths().then((paths) => {
			chromePaths = paths;
		});
		GetChromeProfiles().then((profiles) => {
			console.log(profiles);
			chromeProfiles = profiles;
		});
	});
</script>

<div class="no-select p-4 space-y-2">
	<h2 class="text-2xl font-bold mb-6">Marasi Settings</h2>
	<SlideToggle
		name="slider-label"
		active="bg-primary-500"
		on:change={(event) => {
			ToggleFlag("vim_enabled").then((config) => {
				marasiConfig.set(config);
			});
		}}
		bind:checked={$marasiConfig.VimEnabled}>Vim Enabled</SlideToggle
	>
	<label class="label">
		<span>Syntax Mode:</span>
		<div class="space-y-2">
			<label class="flex items-center space-x-2">
				<input
					class="radio"
					type="radio"
					name="radio-direct"
					value="disabled"
					bind:group={$marasiConfig.SyntaxMode}
					on:change={handleSyntaxModeChange}
				/>
				<p>Disabled</p>
			</label>
			<label class="flex items-center space-x-2">
				<input
					class="radio"
					type="radio"
					name="radio-direct"
					value="auto"
					bind:group={$marasiConfig.SyntaxMode}
					on:change={handleSyntaxModeChange}
				/>
				<p>Auto</p>
			</label>
			<label class="flex items-center space-x-2">
				<input
					class="radio"
					type="radio"
					name="radio-direct"
					value="enabled"
					bind:group={$marasiConfig.SyntaxMode}
					on:change={handleSyntaxModeChange}
				/>
				<p>Enabled</p>
			</label>
		</div>
	</label>
	<label class="label">
		<span>Default Interface</span>
		<input
			on:change={(event) => {
				console.log(event.target.value);
				SetFlag(
					"default_address",
					event?.target?.value,
				).then((config) => {
					marasiConfig.set(config);
				});
			}}
			bind:value={$marasiConfig.DefaultAddress}
			class="input"
			title="Input (text)"
			type="text"
			placeholder="Listener"
		/>
	</label>
	<label class="label">
		<span>Default Port</span>
		<input
			on:change={(event) => {
				SetFlag(
					"default_port",
					event?.target?.value,
				).then((config) => {
					marasiConfig.set(config);
				});
			}}
			bind:value={$marasiConfig.DefaultPort}
			class="input"
			title="Input (text)"
			type="text"
			placeholder="Listener"
		/>
	</label>
	<label class="label">
		<span>Waypoints</span>
		<div class="table-container">
			<table class="table table-hover">
				<thead>
					<tr>
						<th class="text-center w-[40%]"
							>Host</th
						>
						<th class="text-center w-[40%]"
							>Override</th
						>
						<th
							class="bg-primar-500 w-[20%]"
						></th>
					</tr>
					<tr>
						<td>
							<input
								type="text"
								placeholder="Enter host (host:port)"
								class="input w-full variant-filled-secondary"
								bind:value={
									targetHost
								}
							/>
						</td>
						<td>
							<input
								type="text"
								placeholder="Enter override (host:port)"
								class="input w-full variant-filled-secondary"
								bind:value={
									override
								}
							/>
						</td>
						<td>
							<button
								disabled={targetHost ===
									"" ||
									override ===
										"" ||
									(targetHost in
										$waypoints &&
										selected !==
											targetHost)}
								type="button"
								class="btn variant-filled-primary block mx-auto w-full"
								on:click={() => {
									CreateWaypoint(
										targetHost,
										override,
									)
										.then(
											() => {
												console.log(
													"Addedd",
												);
												targetHost =
													"";
												override =
													"";
												selected =
													"";
												populateWaypoints();
											},
										)
										.catch(
											(
												waypointErr,
											) => {
												console.log(
													waypointErr,
												);
											},
										);
								}}
								>{#if selected === targetHost && targetHost !== ""}Update
									Waypoint{:else}Add
									Waypoint{/if}</button
							>
						</td>
					</tr>
				</thead>
				<tbody>
					{#each Object.keys($waypoints) as host}
						<tr>
							<td>{host}</td>
							<td
								>{$waypoints[
									host
								]}</td
							>
							<td class="text-center">
								<div
									class="flex justify-center items-center space-x-2"
								>
									<button
										on:click={() => {
											DeleteWaypoint(
												host,
											)
												.then(
													() => {
														populateWaypoints();
													},
												)
												.catch(
													(
														deleteError,
													) => {
														console.log(
															deleteError,
														);
													},
												);
										}}
										type="button"
										class="btn-icon variant-filled-primary inline-flex items-center justify-center p-1 w-auto h-auto"
									>
										<X
											size={15}
										/>
									</button>
									<button
										on:click={() => {
											selected =
												host;
											targetHost =
												host;
											override =
												$waypoints[
													host
												];
										}}
										type="button"
										class="btn-icon variant-filled-primary inline-flex items-center justify-center p-1 w-auto h-auto"
									>
										<Pencil
											size={15}
										/>
									</button>
								</div>
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	</label>
	<label class="label">
		<span>Chrome Paths</span>
		<div class="table-container">
			<table class="table table-hover">
				<thead>
					<tr>
						<th class="text-center w-[40%]"
							>Path</th
						>
						<th class="text-center w-[40%]"
							>OS</th
						>
						<th class="bg-primary w-[20%]"
						></th>
					</tr>
					<tr>
						<td>
							<input
								type="text"
								placeholder="Enter Chrome Path (e.g. /usr/bin/google-chrome)"
								class="input w-full variant-filled-secondary"
								bind:value={
									selectedPath
								}
							/>
						</td>
						<td>
							<select
								class="input w-full variant-filled-secondary"
								bind:value={
									selectedOS
								}
							>
								<option
									class="varient-filled-primary"
									value=""
									>Select
									OS</option
								>
								<option
									value="windows"
									>windows</option
								>
								<option
									value="darwin"
									>darwin</option
								>
								<option
									value="linux"
									>linux</option
								>
							</select>
						</td>
						<td>
							<button
								disabled={selectedOS ===
									"" ||
									selectedPath ===
										""}
								type="button"
								class="btn variant-filled-primary block mx-auto w-full"
								on:click={() => {
									AddChromePath(
										selectedPath,
										selectedOS,
									).then(
										(
											paths,
										) => {
											chromePaths =
												paths;
										},
									);
								}}
								>Add Path</button
							>
						</td>
					</tr>
				</thead>
				<tbody>
					{#each chromePaths as path}
						<tr>
							<td>{path.Path}</td>
							<td>{path.OS}</td>
							<td class="text-center">
								<div
									class="flex justify-center items-center space-x-2"
								>
									<button
										on:click={() => {
											DeleteChromePath(
												path.Path,
												path.OS,
											).then(
												(
													paths,
												) => {
													chromePaths =
														paths;
												},
											);
										}}
										type="button"
										class="btn-icon variant-filled-primary inline-flex items-center justify-center p-1 w-auto h-auto"
									>
										<X
											size={15}
										/>
									</button>
								</div>
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	</label>
	<label class="label">
		<span>Chrome Profiles</span>
		<div class="table-container">
			<table class="table table-hover">
				<thead>
					<tr>
						<th class="text-center w-[80%]"
							>Profile Name</th
						>
						<th class="bg-primary w-[20%]"
						></th>
					</tr>
					<tr>
						<td>
							<input
								type="text"
								placeholder="Enter profile name"
								class="input w-full variant-filled-secondary"
								bind:value={
									selectedProfile
								}
							/>
						</td>
						<td>
							<button
								disabled={selectedProfile ===
									""}
								type="button"
								class="btn variant-filled-primary block mx-auto w-full"
								on:click={() => {
									AddChromeProfile(
										selectedProfile,
									)
										.then(
											(
												profiles,
											) => {
												chromeProfiles =
													profiles;
											},
										)
										.catch(
											(
												error,
											) => {
												const message =
													error.includes(
														"already exists",
													)
														? "Profile already exists"
														: "Error creating profile";
												const toastSettings =
													{
														message: message,
														background: "variant-filled-error",
													};
												toastStore.trigger(
													toastSettings,
												);
											},
										);
									selectedProfile =
										"";
								}}
								>Add Profile</button
							>
						</td>
					</tr>
				</thead>
				<tbody>
					{#each chromeProfiles as profile}
						<tr>
							<td>{profile}</td>
							<td
								class="text-center text-xl"
							>
								<div
									class="flex justify-center items-center space-x-2"
								>
									<button
										on:click={() => {
											DeleteChromeProfile(
												profile,
											)
												.then(
													(
														profiles,
													) => {
														chromeProfiles =
															profiles;
													},
												)
												.catch(
													(
														_,
													) => {
														const toastSettings =
															{
																message: "Error deleting profile",
																background: "variant-filled-error",
															};
														toastStore.trigger(
															toastSettings,
														);
													},
												);
										}}
										type="button"
										class="btn-icon variant-filled-primary inline-flex items-center justify-center p-1 w-auto h-auto"
									>
										<X
											size={15}
										/>
									</button>
								</div>
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	</label>
</div>
