/**
 * Vault validator — comprehensive JD system health checks.
 *
 * Each check is a pure function: (app, jdex?) -> ValidationIssue[].
 * The engine runs all checks and collates results by severity.
 * Never modifies files — report only.
 */

import { type App, TFile, TFolder } from "obsidian";
import type { JDex } from "./jdex";
import { flatEntries } from "./jdex";

// ── Types ────────────────────────────────────────────────────────

export type Severity = "error" | "warning" | "info";

export interface ValidationIssue {
	check: string;
	severity: Severity;
	path: string;
	message: string;
	suggestion?: string;
}

export interface ValidationReport {
	timestamp: string;
	issues: ValidationIssue[];
	summary: Record<Severity, number>;
	filesScanned: number;
}

// ── Patterns ─────────────────────────────────────────────────────

const ID_RE = /^(\d{2}\.\d{2})\s+(.+)$/;
const README_RE = /^(\d{2}\.\d{2})\+README$/;
const AREA_RE = /^(\d{2})-(\d{2})\s+(.+)$/;
const CATEGORY_RE = /^(\d{2})\s+(.+)$/;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}/;

// ── Individual checks ────────────────────────────────────────────

function checkRequiredFields(app: App): ValidationIssue[] {
	const issues: ValidationIssue[] = [];
	const required = ["jd-id", "jd-title", "jd-type"];

	for (const file of app.vault.getMarkdownFiles()) {
		const match = ID_RE.exec(file.basename);
		const isReadme = README_RE.test(file.basename);
		if (!match && !isReadme) continue;

		const cache = app.metadataCache.getFileCache(file);
		const fm = cache?.frontmatter;

		for (const field of required) {
			if (!fm || !fm[field]) {
				issues.push({
					check: "required-fields",
					severity: "error",
					path: file.path,
					message: `Missing required field: ${field}`,
					suggestion: `Add ${field} to frontmatter`,
				});
			}
		}
	}

	return issues;
}

function checkDateFormats(app: App): ValidationIssue[] {
	const issues: ValidationIssue[] = [];
	const dateFields = ["created", "modified", "surveyed"];

	for (const file of app.vault.getMarkdownFiles()) {
		const cache = app.metadataCache.getFileCache(file);
		const fm = cache?.frontmatter;
		if (!fm) continue;

		for (const field of dateFields) {
			const val = fm[field];
			if (val === undefined || val === null || val === "") continue;

			const str = String(val);
			if (!ISO_DATE_RE.test(str)) {
				issues.push({
					check: "date-format",
					severity: "warning",
					path: file.path,
					message: `Invalid date format in ${field}: "${str}"`,
					suggestion: `Use ISO 8601 format: YYYY-MM-DD`,
				});
			}
		}
	}

	return issues;
}

function checkValidCategories(app: App): ValidationIssue[] {
	const issues: ValidationIssue[] = [];

	const knownCategories = new Set<string>();
	const root = app.vault.getRoot();
	for (const areaChild of root.children) {
		if (!(areaChild instanceof TFolder)) continue;
		if (!AREA_RE.test(areaChild.name)) continue;
		for (const catChild of areaChild.children) {
			if (!(catChild instanceof TFolder)) continue;
			const m = CATEGORY_RE.exec(catChild.name);
			if (m) knownCategories.add(m[1]);
		}
	}

	for (const file of app.vault.getMarkdownFiles()) {
		const cache = app.metadataCache.getFileCache(file);
		const fm = cache?.frontmatter;
		if (!fm?.["jd-id"]) continue;

		const jdId = String(fm["jd-id"]).replace(/\+.*$/, "");
		const catNum = jdId.split(".")[0];
		if (catNum && !knownCategories.has(catNum)) {
			issues.push({
				check: "valid-category",
				severity: "error",
				path: file.path,
				message: `jd-id ${fm["jd-id"]} references unknown category ${catNum}`,
				suggestion: `Verify category ${catNum} exists in the vault`,
			});
		}
	}

	return issues;
}

function checkDuplicateIds(app: App): ValidationIssue[] {
	const issues: ValidationIssue[] = [];
	const seen = new Map<string, string[]>();

	for (const file of app.vault.getMarkdownFiles()) {
		const cache = app.metadataCache.getFileCache(file);
		const fm = cache?.frontmatter;
		if (!fm?.["jd-id"]) continue;

		const id = String(fm["jd-id"]);
		const list = seen.get(id) ?? [];
		list.push(file.path);
		seen.set(id, list);
	}

	for (const [id, paths] of seen) {
		if (paths.length > 1) {
			for (const path of paths) {
				issues.push({
					check: "duplicate-id",
					severity: "error",
					path,
					message: `Duplicate jd-id '${id}' (${paths.length} notes)`,
					suggestion: `Other files: ${paths.filter((p) => p !== path).join(", ")}`,
				});
			}
		}
	}

	return issues;
}

function checkOrphanedFiles(app: App): ValidationIssue[] {
	const issues: ValidationIssue[] = [];

	const linkedPaths = new Set<string>();
	for (const file of app.vault.getMarkdownFiles()) {
		const cache = app.metadataCache.getFileCache(file);
		if (cache?.links) {
			for (const link of cache.links) {
				const resolved = app.metadataCache.getFirstLinkpathDest(
					link.link,
					file.path
				);
				if (resolved) linkedPaths.add(resolved.path);
			}
		}
		if (cache?.embeds) {
			for (const embed of cache.embeds) {
				const resolved = app.metadataCache.getFirstLinkpathDest(
					embed.link,
					file.path
				);
				if (resolved) linkedPaths.add(resolved.path);
			}
		}
	}

	for (const file of app.vault.getMarkdownFiles()) {
		const match = ID_RE.exec(file.basename);
		const isReadme = README_RE.test(file.basename);
		if (!match && !isReadme) continue;

		const cache = app.metadataCache.getFileCache(file);
		const fm = cache?.frontmatter;
		if (fm?.["jd-type"] === "index") continue;

		if (!linkedPaths.has(file.path)) {
			issues.push({
				check: "orphaned-file",
				severity: "warning",
				path: file.path,
				message: `Not linked from any other note`,
				suggestion: `Add a link from the category index or a related note`,
			});
		}
	}

	return issues;
}

function checkBrokenWikilinks(app: App): ValidationIssue[] {
	const issues: ValidationIssue[] = [];

	for (const file of app.vault.getMarkdownFiles()) {
		const cache = app.metadataCache.getFileCache(file);
		if (!cache?.links) continue;

		for (const link of cache.links) {
			const resolved = app.metadataCache.getFirstLinkpathDest(
				link.link,
				file.path
			);
			if (!resolved) {
				issues.push({
					check: "broken-wikilink",
					severity: "info",
					path: file.path,
					message: `Broken link: [[${link.link}]]`,
					suggestion: `Target does not exist`,
				});
			}
		}
	}

	return issues;
}

function checkEmptyNotes(app: App): ValidationIssue[] {
	const issues: ValidationIssue[] = [];

	for (const file of app.vault.getMarkdownFiles()) {
		const match = ID_RE.exec(file.basename);
		const isReadme = README_RE.test(file.basename);
		if (!match && !isReadme) continue;

		const cache = app.metadataCache.getFileCache(file);
		if (!cache) continue;

		const sections = cache.sections ?? [];
		const nonFmSections = sections.filter((s) => s.type !== "yaml");
		const hasContent = nonFmSections.some(
			(s) => s.type !== "heading" && s.type !== "yaml"
		);

		if (!hasContent) {
			issues.push({
				check: "empty-note",
				severity: "info",
				path: file.path,
				message: `No content beyond frontmatter and heading`,
				suggestion: `Add a description or ## Contents section`,
			});
		}
	}

	return issues;
}

function checkStaleSurveyed(app: App, staleDays: number): ValidationIssue[] {
	const issues: ValidationIssue[] = [];
	const cutoff = new Date();
	cutoff.setDate(cutoff.getDate() - staleDays);

	for (const file of app.vault.getMarkdownFiles()) {
		const cache = app.metadataCache.getFileCache(file);
		const fm = cache?.frontmatter;
		if (!fm?.surveyed) continue;

		const surveyed = new Date(String(fm.surveyed));
		if (isNaN(surveyed.getTime())) continue;

		if (surveyed < cutoff) {
			const daysAgo = Math.floor(
				(Date.now() - surveyed.getTime()) / (1000 * 60 * 60 * 24)
			);
			issues.push({
				check: "stale-surveyed",
				severity: "info",
				path: file.path,
				message: `Last surveyed ${daysAgo} days ago (${fm.surveyed})`,
				suggestion: `Review and update the surveyed date`,
			});
		}
	}

	return issues;
}

function checkMissingAliases(app: App): ValidationIssue[] {
	const issues: ValidationIssue[] = [];

	for (const file of app.vault.getMarkdownFiles()) {
		if (!README_RE.test(file.basename)) continue;

		const cache = app.metadataCache.getFileCache(file);
		const fm = cache?.frontmatter;
		if (!fm) continue;

		const aliases: string[] = fm.aliases ?? [];
		const idBase = file.basename.replace("+README", "");
		const title = fm["jd-title"] ?? "";
		const expectedAlias = `${idBase} ${title}`;

		const hasAlias = aliases.some((a: string) => a.startsWith(idBase));
		if (!hasAlias) {
			issues.push({
				check: "missing-alias",
				severity: "warning",
				path: file.path,
				message: `+README missing alias for base ID`,
				suggestion: `Add alias: "${expectedAlias}"`,
			});
		}
	}

	return issues;
}

function checkTitleMismatch(app: App): ValidationIssue[] {
	const issues: ValidationIssue[] = [];

	for (const file of app.vault.getMarkdownFiles()) {
		const match = ID_RE.exec(file.basename);
		if (!match) continue;

		const filenameTitle = match[2];
		const cache = app.metadataCache.getFileCache(file);
		const fm = cache?.frontmatter;
		if (!fm?.["jd-title"]) continue;

		const fmTitle = String(fm["jd-title"]);
		if (fmTitle !== filenameTitle) {
			issues.push({
				check: "title-mismatch",
				severity: "warning",
				path: file.path,
				message: `jd-title "${fmTitle}" doesn't match filename "${filenameTitle}"`,
				suggestion: `Update jd-title or rename the file`,
			});
		}
	}

	return issues;
}

function checkMissingStubs(app: App, jdex: JDex): ValidationIssue[] {
	const issues: ValidationIssue[] = [];
	const allEntries = flatEntries(jdex);
	const existingIds = new Set<string>();

	for (const file of app.vault.getMarkdownFiles()) {
		const match = ID_RE.exec(file.basename);
		if (match) existingIds.add(match[1]);
		const rmMatch = README_RE.exec(file.basename);
		if (rmMatch) existingIds.add(rmMatch[1]);
	}

	for (const { entry, category, area } of allEntries) {
		if (existingIds.has(entry.id)) continue;
		issues.push({
			check: "missing-stub",
			severity: "warning",
			path: `${area.id} ${area.title}/${category.id} ${category.title}/`,
			message: `JDex entry ${entry.id} "${entry.title}" has no note`,
			suggestion: `Create stub: ${entry.id} ${entry.title}.md`,
		});
	}

	return issues;
}

// ── Engine ───────────────────────────────────────────────────────

export interface ValidatorOptions {
	staleDays?: number;
	skipChecks?: string[];
}

export function runValidation(
	app: App,
	jdex: JDex | null,
	options: ValidatorOptions = {}
): ValidationReport {
	const { staleDays = 90, skipChecks = [] } = options;
	const skip = new Set(skipChecks);

	const allIssues: ValidationIssue[] = [];

	const checks: [string, () => ValidationIssue[]][] = [
		["required-fields", () => checkRequiredFields(app)],
		["date-format", () => checkDateFormats(app)],
		["valid-category", () => checkValidCategories(app)],
		["duplicate-id", () => checkDuplicateIds(app)],
		["orphaned-file", () => checkOrphanedFiles(app)],
		["broken-wikilink", () => checkBrokenWikilinks(app)],
		["empty-note", () => checkEmptyNotes(app)],
		["stale-surveyed", () => checkStaleSurveyed(app, staleDays)],
		["missing-alias", () => checkMissingAliases(app)],
		["title-mismatch", () => checkTitleMismatch(app)],
	];

	if (jdex) {
		checks.push(["missing-stub", () => checkMissingStubs(app, jdex)]);
	}

	for (const [name, fn] of checks) {
		if (skip.has(name)) continue;
		allIssues.push(...fn());
	}

	const severityOrder: Record<Severity, number> = {
		error: 0,
		warning: 1,
		info: 2,
	};
	allIssues.sort(
		(a, b) => severityOrder[a.severity] - severityOrder[b.severity]
	);

	const summary: Record<Severity, number> = { error: 0, warning: 0, info: 0 };
	for (const issue of allIssues) {
		summary[issue.severity]++;
	}

	return {
		timestamp: new Date().toISOString(),
		issues: allIssues,
		summary,
		filesScanned: app.vault.getMarkdownFiles().length,
	};
}
