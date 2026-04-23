/**
 * Vault scanner — counts inbox items, detects drift, finds missing stubs.
 *
 * Works entirely through Obsidian's vault API (TAbstractFile, TFolder, TFile)
 * so it respects the vault's file index and doesn't hit the filesystem directly.
 */

import { type App, TFile, TFolder } from "obsidian";
import type { JDex, FlatEntry } from "./jdex";
import { flatEntries } from "./jdex";

// ── JD naming patterns ──────────────────────────────────────────

const AREA_RE = /^(\d{2})-(\d{2})\s+(.+)$/;
const CATEGORY_RE = /^(\d{2})\s+(.+)$/;
const ID_RE = /^(\d{2}\.\d{2})\s+(.+)$/;
const README_RE = /^(\d{2}\.\d{2})\+README$/;
const INBOX_SUFFIXES = ["Unsorted", "Inbox"];

// ── Inbox scanning ──────────────────────────────────────────────

export interface InboxItem {
	/** Category folder name, e.g. "26 Divorce" */
	category: string;
	/** The .01 folder name, e.g. "26.01 Unsorted" */
	inboxFolder: string;
	/** Full vault path to the inbox folder */
	path: string;
	/** Number of items (files + folders) in the inbox */
	count: number;
	/** Area name for grouping */
	area: string;
}

export function scanInboxes(app: App): InboxItem[] {
	const results: InboxItem[] = [];
	const root = app.vault.getRoot();

	for (const areaChild of root.children) {
		if (!(areaChild instanceof TFolder)) continue;
		const areaMatch = AREA_RE.exec(areaChild.name);
		if (!areaMatch) continue;

		for (const catChild of areaChild.children) {
			if (!(catChild instanceof TFolder)) continue;
			const catMatch = CATEGORY_RE.exec(catChild.name);
			if (!catMatch) continue;

			// Look for XX.01 Unsorted or XX.01 Inbox
			for (const idChild of catChild.children) {
				if (!(idChild instanceof TFolder)) continue;
				const idMatch = ID_RE.exec(idChild.name);
				if (!idMatch) continue;

				const idNum = idMatch[1];
				if (!idNum.endsWith(".01")) continue;

				const title = idMatch[2];
				if (!INBOX_SUFFIXES.some((s) => title.startsWith(s))) continue;

				// Count non-dot children, excluding +README
				const count = idChild.children.filter(
					(c) => !c.name.startsWith(".") && !c.name.includes("+README")
				).length;

				if (count > 0) {
					results.push({
						category: catChild.name,
						inboxFolder: idChild.name,
						path: idChild.path,
						count,
						area: areaChild.name,
					});
				}
			}
		}
	}

	// Sort busiest first
	results.sort((a, b) => b.count - a.count);
	return results;
}

// ── Drift detection ─────────────────────────────────────────────

export interface DriftItem {
	/** Vault path to the note */
	path: string;
	/** The jd-id from frontmatter */
	frontmatterId: string;
	/** The ID parsed from the filename */
	filenameId: string | null;
	/** What's wrong */
	issue: "id-mismatch" | "title-mismatch" | "wrong-folder" | "missing-frontmatter";
	detail: string;
}

export function scanDrift(app: App): DriftItem[] {
	const results: DriftItem[] = [];
	const files = app.vault.getMarkdownFiles();

	for (const file of files) {
		const cache = app.metadataCache.getFileCache(file);
		if (!cache) continue;

		const fm = cache.frontmatter;
		const filenameMatch = ID_RE.exec(file.basename);
		const readmeMatch = README_RE.exec(file.basename);

		// +README files use jd-id like "XX.YY+README" — extract base ID
		const filenameId = filenameMatch
			? filenameMatch[1]
			: readmeMatch
				? readmeMatch[1]
				: null;
		const fmId = fm?.["jd-id"] ? String(fm["jd-id"]) : null;
		// For +README files, the base ID for comparison
		const fmBaseId = fmId?.replace(/\+README$/, "") ?? null;

		if (!filenameId && !fmId) continue;

		// Skip +README files where the IDs match (XX.YY+README in fm, XX.YY in filename)
		if (readmeMatch && fmBaseId === filenameId) continue;

		if (filenameId && !fmId) {
			results.push({
				path: file.path,
				frontmatterId: "",
				filenameId,
				issue: "missing-frontmatter",
				detail: `File ${file.basename} has JD ID in name but no jd-id frontmatter`,
			});
			continue;
		}

		if (filenameId && fmBaseId && filenameId !== fmBaseId) {
			results.push({
				path: file.path,
				frontmatterId: fmId!,
				filenameId,
				issue: "id-mismatch",
				detail: `Filename says ${filenameId}, frontmatter says ${fmId}`,
			});
			continue;
		}

		// Check that the note is in the right category folder
		// For +README files, the category dir is the grandparent (file → ID dir → category)
		if (fmBaseId && filenameId) {
			const expectedCatNum = fmBaseId.split(".")[0];
			const catFolder = readmeMatch
				? file.parent?.parent
				: file.parent;
			if (catFolder) {
				const catMatch = CATEGORY_RE.exec(catFolder.name);
				if (catMatch && catMatch[1] !== expectedCatNum) {
					results.push({
						path: file.path,
						frontmatterId: fmId!,
						filenameId,
						issue: "wrong-folder",
						detail: `Note ${fmId} is in category ${catMatch[1]} but should be in ${expectedCatNum}`,
					});
				}
			}
		}
	}

	return results;
}

// ── Missing stub detection ──────────────────────────────────────

export interface MissingStub {
	id: string;
	title: string;
	expectedPath: string;
}

export function findMissingStubs(app: App, jdex: JDex): MissingStub[] {
	const allEntries = flatEntries(jdex);
	const existingIds = new Set<string>();

	// Collect all JD IDs that have notes (including +README files)
	for (const file of app.vault.getMarkdownFiles()) {
		const match = ID_RE.exec(file.basename);
		if (match) existingIds.add(match[1]);
		const rmMatch = README_RE.exec(file.basename);
		if (rmMatch) existingIds.add(rmMatch[1]);
	}

	const missing: MissingStub[] = [];
	for (const { entry, category, area } of allEntries) {
		if (existingIds.has(entry.id)) continue;
		const areaFolder = `${area.id} ${area.title}`;
		const catFolder = `${category.id} ${category.title}`;
		missing.push({
			id: entry.id,
			title: entry.title,
			expectedPath: `${areaFolder}/${catFolder}/${entry.id} ${entry.title}.md`,
		});
	}

	return missing;
}
