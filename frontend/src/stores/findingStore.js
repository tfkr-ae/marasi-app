import { writable } from 'svelte/store';
import { CreateDraftFinding, DeleteArtifact, DeleteFinding, LinkRequestToFinding, ListFindings, SaveArtifactToFinding, SaveFinding, UnlinkRequestFromFinding } from '../lib/wailsjs/go/main/App';

function createFindingStore() {
	const { subscribe, set, update } = writable([]);
	return {
		subscribe,
		update,
		populate: async () => {
			const findings = await ListFindings();
			set(findings || []);
		},
		clear: () => set([]),
		create: async (requestIds, testCaseUUID = null) => {
			const finding = await CreateDraftFinding(requestIds, testCaseUUID);
			update(findings => [finding, ...findings])
			return finding
		},
		save: async (finding) => {
			try {
				console.log(finding);
				await SaveFinding({ ...finding, Artifacts: undefined });
				update(findings => findings.map(fnd =>
					fnd.ID === finding.ID ? finding : fnd
				));
				return true
			} catch (err) {
				console.error("Store sync blocked: Database save failed", err);
				throw err;
			}
		},
		delete: async (id) => {
			try {
				await DeleteFinding(id);

				update((findings) => findings.filter((fnd) => fnd.ID !== id));

				return true;
			} catch (err) {
				console.error(`Failed to delete Finding ${id}:`, err);
				throw err;
			}
		},
		uploadArtifact: async (findingID, file) => {
			const uploadID = `temp-${Date.now()}-${Math.random()}`;
			update(findings => findings.map(finding => {
				if (finding.ID === findingID) {
					const newArt = {
						ID: uploadID,
						Filename: file.name,
						MimeType: file.type,
						Size: file.size,
						Status: "uploading",
					};
					return { ...finding, Artifacts: [...(finding.Artifacts || []), newArt] };
				}
				return finding;
			}));

			try {
				const buffer = await file.arrayBuffer();
				const data = new Uint8Array(buffer);
				const result = await SaveArtifactToFinding(
					findingID,
					file.name,
					file.type,
					file.size,
					Array.from(data),
				);

				update(findings => findings.map(finding => {
					if (finding.ID === findingID) {
						const updatedArtifacts = finding.Artifacts.map(art =>
							art.ID === uploadID ? { ...result, Status: "uploaded" } : art
						);
						return { ...finding, Artifacts: updatedArtifacts };
					}
					return finding;
				}));
			} catch (err) {
				update(findings => findings.map(finding => {
					if (finding.ID === findingID) {
						return { ...finding, Artifacts: finding.Artifacts.filter(art => art.ID !== uploadID) };
					}
					return finding;
				}));
				throw err;
			}
		},
		deleteArtifact: async (findingID, artifactId) => {
			try {
				await DeleteArtifact(artifactId);
				update(findings => findings.map(finding => {
					if (finding.ID === findingID) {
						return { ...finding, Artifacts: finding.Artifacts.filter(art => art.ID !== artifactId) };
					}
					return finding;
				}));
			} catch (err) {
				throw err;
			}
		},
		unlinkRequest: async (findingId, requestId) => {
			try {
				await UnlinkRequestFromFinding(findingId, requestId);

				update(findings => findings.map(fnd => {
					if (fnd.ID === findingId) {
						return {
							...fnd,
							Requests: (fnd.Requests || []).filter(id => id !== requestId)
						};
					}
					return fnd;
				}));

				return true;
			} catch (err) {
				console.error(`Failed to unlink request ${requestId} from Finding ${findingId}:`, err);
				throw err;
			}
		},
		linkRequest: async (findingId, requestId) => {
			try {
				await LinkRequestToFinding(findingId, requestId);
				update(findings => findings.map(fnd => {
					if (fnd.ID === findingId) {
						const exists = fnd.Requests?.includes(requestId);
						return {
							...fnd,
							Requests: exists ? fnd.Requests : [...(fnd.Requests || []), requestId]
						};
					}
					return fnd;
				}));

				return true;
			} catch (err) {
				console.error(`Failed to link request ${requestId} to Finding ${findingId}:`, err);
				throw err;
			}
		},

	}
}

export const findingStore = createFindingStore();
