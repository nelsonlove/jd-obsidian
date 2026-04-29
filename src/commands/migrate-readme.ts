/**
 * Migration: +README cover notes → folder-named cover notes.
 *
 * Old: `06.12 Foo/06.12+README.md`
 *      jd-id: '06.12+README'
 *      aliases:
 *          - 06.12 Foo
 *
 * New: `06.12 Foo/06.12 Foo.md`
 *      jd-id: '06.12'
 *      (alias dropped — bare filename already resolves)
 *
 * Reads each `*+README.md`, rewrites the frontmatter, then renames via
 * the vault API (which updates wikilinks in other notes).
 */

import { type App, Notice, TFile } from "obsidian";
import type { JDKeys } from "../keys";

/**
 * Matches both naming conventions seen in the wild:
 *   - ID-form:   `06.06+README.md`
 *   - bare-form: `+README Knowledge base for category 06.md`
 * Either way the file gets renamed to its parent folder's name.
 */
const README_FILENAME_RE = /^(\d{2}\.\d{2}\+README\.md|\+README .+\.md)$/;

interface MigrateResult {
	scanned: number;
	migrated: number;
	skipped: { path: string; reason: string }[];
}

export async function migrateReadmeFiles(
	app: App,
	keys: JDKeys
): Promise<MigrateResult> {
	const result: MigrateResult = { scanned: 0, migrated: 0, skipped: [] };

	const targets: TFile[] = [];
	for (const file of app.vault.getMarkdownFiles()) {
		if (README_FILENAME_RE.test(file.name)) targets.push(file);
	}
	result.scanned = targets.length;

	for (const file of targets) {
		const skip = (reason: string) =>
			result.skipped.push({ path: file.path, reason });

		const parent = file.parent;
		if (!parent) {
			skip("no parent folder");
			continue;
		}

		const newBasename = parent.name;
		const newPath = `${parent.path}/${newBasename}.md`;

		// Don't clobber an existing file at the destination
		const existing = app.vault.getAbstractFileByPath(newPath);
		if (existing && existing.path !== file.path) {
			skip(`destination exists: ${newPath}`);
			continue;
		}

		try {
			const content = await app.vault.read(file);
			const rewritten = rewriteFrontmatter(content, keys);
			if (rewritten !== content) {
				await app.vault.modify(file, rewritten);
			}
			await app.fileManager.renameFile(file, newPath);
			result.migrated++;
		} catch (e) {
			skip(`error: ${(e as Error).message}`);
		}
	}

	new Notice(
		`Migrated ${result.migrated}/${result.scanned} +README files. Skipped: ${result.skipped.length}.`
	);
	if (result.skipped.length > 0) {
		console.group("README migration — skipped files");
		for (const s of result.skipped) {
			console.log(`${s.path}: ${s.reason}`);
		}
		console.groupEnd();
	}

	return result;
}

/**
 * Rewrite the frontmatter:
 *   - strip "+README" suffix from the ID value
 *   - drop the auto-generated `aliases:` block (a bare list of one alias
 *     equal to the parent folder name)
 */
function rewriteFrontmatter(content: string, keys: JDKeys): string {
	if (!content.startsWith("---\n")) return content;
	const close = content.indexOf("\n---\n", 4);
	if (close === -1) return content;

	const fmText = content.slice(4, close + 1);
	const body = content.slice(close + 5);

	const lines = fmText.split("\n");
	// Fixed regex captures any YAML scalar key; the key name is then
	// compared as a string. Avoids constructing RegExp from settings input
	// (which the linter flags as a ReDoS risk surface).
	const KEY_LINE_RE = /^([a-zA-Z][\w-]*):\s*(.*)$/;

	const out: string[] = [];
	let i = 0;
	while (i < lines.length) {
		const line = lines[i];
		const m = line.match(KEY_LINE_RE);

		if (m && m[1] === keys.id) {
			const value = m[2].trim().replace(/^['"]|['"]$/g, "");
			if (value.endsWith("+README")) {
				const stripped = value.slice(0, -"+README".length);
				out.push(`${keys.id}: '${stripped}'`);
				i++;
				continue;
			}
		}

		// Skip aliases block (key + indented children)
		if (m && m[1] === "aliases") {
			i++;
			while (i < lines.length && /^\s+-\s/.test(lines[i])) i++;
			continue;
		}

		out.push(line);
		i++;
	}

	return `---\n${out.join("\n")}---\n${body}`;
}
