/**
 * Frontmatter normalizer — auto-corrects JD note frontmatter on save.
 *
 * Runs on vault "modify" events for JD notes. Applies:
 *   1. Key ordering: jd-title, jd-id, jd-type, jd-location, created,
 *      modified, surveyed, aliases, tags, then rest alphabetically
 *   2. jd-id quoting: ensures value is quoted (YAML treats 06.12 as number)
 *   3. jd-type inference: sets type from ID pattern if missing
 *   4. H1 heading cleanup: strips "# XX.YY Title" to "# Title"
 *
 * Uses a write guard to prevent re-triggering from its own modifications.
 */

import { type App, TFile } from "obsidian";

// ── Key order ────────────────────────────────────────────────────

const KEY_ORDER: Record<string, number> = {
	"jd-title": 0,
	"jd-id": 1,
	"jd-type": 2,
	"jd-location": 3,
	"created": 4,
	"modified": 5,
	"surveyed": 6,
	"aliases": 7,
	"tags": 8,
};

function sortKey(key: string): [number, string] {
	return [KEY_ORDER[key] ?? 100, key];
}

// ── Type inference ───────────────────────────────────────────────

const ZERO_TYPES: Record<string, string> = {
	"00": "index",
	"01": "inbox",
	"02": "tasks",
	"03": "templates",
	"04": "links",
	"06": "knowledge-base",
	"08": "someday",
	"09": "archive",
};

const SUBID_TYPES: Record<string, string> = {
	"+REPORT": "report",
	"+AUDIT": "audit",
};

function inferType(jdId: string): string | null {
	for (const [suffix, type] of Object.entries(SUBID_TYPES)) {
		if (jdId.toUpperCase().includes(suffix)) return type;
	}
	if (jdId.includes("+README")) {
		const base = jdId.split("+")[0];
		const parts = base.split(".");
		if (parts.length === 2) return ZERO_TYPES[parts[1]] ?? null;
		return null;
	}
	if (jdId.includes("+")) return "meta";
	const parts = jdId.split(".");
	if (parts.length === 2) return ZERO_TYPES[parts[1]] ?? "id";
	return null;
}

// ── Frontmatter parsing ─────────────────────────────────────────

interface FmEntry {
	key: string;
	text: string;
}

function parseFrontmatter(fmText: string): FmEntry[] {
	const entries: FmEntry[] = [];
	const lines = fmText.split("\n");
	let i = 0;

	while (i < lines.length) {
		const line = lines[i];
		if (!line.trim()) {
			i++;
			continue;
		}

		const m = line.match(/^([a-zA-Z][\w-]*):\s*(.*)/);
		if (m) {
			const key = m[1];
			const fullLines = [line];
			i++;
			while (i < lines.length) {
				const next = lines[i];
				if (next && (next[0] === " " || next[0] === "\t")) {
					fullLines.push(next);
					i++;
				} else {
					break;
				}
			}
			entries.push({ key, text: fullLines.join("\n") });
		} else {
			i++;
		}
	}

	return entries;
}

function sortEntries(entries: FmEntry[]): FmEntry[] {
	return [...entries].sort((a, b) => {
		const [aOrd, aKey] = sortKey(a.key);
		const [bOrd, bKey] = sortKey(b.key);
		if (aOrd !== bOrd) return aOrd - bOrd;
		return aKey.localeCompare(bKey);
	});
}

// ── Normalizer ──────────────────────────────────────────────────

const ID_RE = /^(\d{2}\.\d{2})\s+(.+)$/;
const HEADING_ID_RE = /^# \d{2}\.\d{2}\+?\s+(.+)$/m;

export class FrontmatterNormalizer {
	private app: App;
	private writeGuard = new Set<string>();

	constructor(app: App) {
		this.app = app;
	}

	isGuarded(path: string): boolean {
		return this.writeGuard.has(path);
	}

	async normalize(file: TFile): Promise<boolean> {
		const match = ID_RE.exec(file.basename);
		const isReadme = /^\d{2}\.\d{2}\+README$/.test(file.basename);
		if (!match && !isReadme) return false;

		const content = await this.app.vault.read(file);
		if (!content.startsWith("---\n")) return false;

		const firstClose = content.indexOf("\n---\n", 4);
		if (firstClose === -1) return false;

		const fmText = content.slice(4, firstClose + 1);
		const body = content.slice(firstClose + 5);

		let entries = parseFrontmatter(fmText);
		let changed = false;

		// 1. Quote jd-id if unquoted
		const jdIdEntry = entries.find((e) => e.key === "jd-id");
		if (jdIdEntry) {
			const m = jdIdEntry.text.match(/^jd-id:\s*(\S+)$/);
			if (m && !m[1].startsWith("'") && !m[1].startsWith('"')) {
				jdIdEntry.text = `jd-id: '${m[1]}'`;
				changed = true;
			}
		}

		// 2. Infer jd-type if missing
		if (!entries.find((e) => e.key === "jd-type") && jdIdEntry) {
			const idVal = jdIdEntry.text
				.replace(/^jd-id:\s*/, "")
				.replace(/['"]/g, "");
			const type = inferType(idVal);
			if (type) {
				entries.push({ key: "jd-type", text: `jd-type: ${type}` });
				changed = true;
			}
		}

		// 3. Sort keys
		const sorted = sortEntries(entries);
		const keysChanged =
			sorted.map((e) => e.key).join(",") !==
			entries.map((e) => e.key).join(",");
		if (keysChanged) {
			entries = sorted;
			changed = true;
		}

		// 4. Strip ID from H1 heading
		let newBody = body;
		const headingMatch = HEADING_ID_RE.exec(body);
		if (headingMatch) {
			newBody = body.replace(HEADING_ID_RE, `# ${headingMatch[1]}`);
			if (newBody !== body) changed = true;
		}

		if (!changed) return false;

		const newFm = entries.map((e) => e.text).join("\n") + "\n";
		const newContent = `---\n${newFm}---\n${newBody}`;

		this.writeGuard.add(file.path);
		await this.app.vault.modify(file, newContent);

		setTimeout(() => {
			this.writeGuard.delete(file.path);
		}, 1000);

		return true;
	}
}
