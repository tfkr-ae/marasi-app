import { writable } from 'svelte/store';
import {
	CreateDraftTestCase,
	SaveArtifactToTestCase,
	DeleteArtifact
} from '$lib/wailsjs/go/main/App';
import { DeleteTestCase, LinkRequestToTestCase, ListTestCases, SaveTestCase, UnlinkRequestFromTestCase } from '../lib/wailsjs/go/main/App';
import { findingStore } from './findingStore';

function createTestCaseStore() {
	const { subscribe, set, update } = writable([]);

	return {
		subscribe,
		populate: async () => {
			const cases = await ListTestCases();
			set(cases || []);
		},
		create: async (requestIds) => {
			const newCase = await CreateDraftTestCase(requestIds);
			update(cases => [newCase, ...cases]);
			return newCase
		},
		save: async (testCase) => {
			try {
				console.log(testCase);
				await SaveTestCase({ ...testCase, Artifacts: undefined });
				update(cases => cases.map(tc =>
					tc.ID === testCase.ID ? testCase : tc
				));
				return true
			} catch (err) {
				console.error("Store sync blocked: Database save failed", err);
				throw err;
			}
		},
		delete: async (id) => {
			try {

				await DeleteTestCase(id);

				update((cases) => cases.filter((tc) => tc.ID !== id));
				findingStore.update((currentFindings) => {
					return currentFindings.map((finding) => {
						if (finding.TestCaseID === id) {
							return { ...finding, TestCaseID: undefined };
						}
						return finding;
					});
				});

				return true;
			} catch (err) {
				console.error(`Failed to delete Test Case ${id}:`, err);
				throw err;
			}
		},
		uploadArtifact: async (tcId, file) => {
			const uploadID = `temp-${Date.now()}-${Math.random()}`;
			update(cases => cases.map(tc => {
				if (tc.ID === tcId) {
					const newArt = {
						ID: uploadID,
						Filename: file.name,
						MimeType: file.type,
						Size: file.size,
						Status: "uploading",
					};
					return { ...tc, Artifacts: [...(tc.Artifacts || []), newArt] };
				}
				return tc;
			}));

			try {
				const buffer = await file.arrayBuffer();
				const data = new Uint8Array(buffer);
				const result = await SaveArtifactToTestCase(
					tcId,
					file.name,
					file.type,
					file.size,
					Array.from(data),
				);

				update(cases => cases.map(tc => {
					if (tc.ID === tcId) {
						const updatedArtifacts = tc.Artifacts.map(art =>
							art.ID === uploadID ? { ...result, Status: "uploaded" } : art
						);
						return { ...tc, Artifacts: updatedArtifacts };
					}
					return tc;
				}));
			} catch (err) {
				update(cases => cases.map(tc => {
					if (tc.ID === tcId) {
						return { ...tc, Artifacts: tc.Artifacts.filter(art => art.ID !== uploadID) };
					}
					return tc;
				}));
				throw err;
			}
		},
		deleteArtifact: async (tcId, artifactId) => {
			try {
				await DeleteArtifact(artifactId);
				update(cases => cases.map(tc => {
					if (tc.ID === tcId) {
						return { ...tc, Artifacts: tc.Artifacts.filter(art => art.ID !== artifactId) };
					}
					return tc;
				}));
			} catch (err) {
				throw err;
			}
		},
		unlinkRequest: async (tcId, requestId) => {
			try {
				await UnlinkRequestFromTestCase(tcId, requestId);

				update(cases => cases.map(tc => {
					if (tc.ID === tcId) {
						return {
							...tc,
							Requests: (tc.Requests || []).filter(id => id !== requestId)
						};
					}
					return tc;
				}));

				return true;
			} catch (err) {
				console.error(`Failed to unlink request ${requestId} from TC ${tcId}:`, err);
				throw err;
			}
		},
		linkRequest: async (tcId, requestId) => {
			try {
				await LinkRequestToTestCase(tcId, requestId);
				update(cases => cases.map(tc => {
					if (tc.ID === tcId) {
						const exists = tc.Requests?.includes(requestId);
						return {
							...tc,
							Requests: exists ? tc.Requests : [...(tc.Requests || []), requestId]
						};
					}
					return tc;
				}));

				return true;
			} catch (err) {
				console.error(`Failed to link request ${requestId} to TC ${tcId}:`, err);
				throw err;
			}
		},
		clear: () => set([]),
	};
}

export const testCaseStore = createTestCaseStore();
