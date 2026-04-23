/**
 * JDex YAML reader — parses jd-index.yaml into typed structures.
 *
 * Reads the same file as jd-cli so there's no runtime dependency on
 * the Python tool. Also reads jd.yaml for config (standard zeros, etc).
 */

import { parse as parseYaml } from "yaml";

// ── Types ────────────────────────────────────────────────────────

export interface JDEntry {
	id: string;
	title: string;
	created?: string;
	description?: string;
	status?: string;
}

export interface JDCategory {
	id: string;
	title: string;
	entries: JDEntry[];
}

export interface JDArea {
	id: string;
	title: string;
	categories: JDCategory[];
}

export interface JDex {
	areas: JDArea[];
}

export interface JDConfig {
	jdex?: { backend?: string; path?: string };
	obsidian?: { vault_path?: string };
	expanded_areas?: Record<string, { name: string; scheme: string; range: number[] }>;
}

// ── Parsing ──────────────────────────────────────────────────────

export function parseJDex(raw: string): JDex {
	const data = parseYaml(raw);
	if (!data?.areas || !Array.isArray(data.areas)) {
		return { areas: [] };
	}
	return {
		areas: data.areas.map((a: Record<string, unknown>) => ({
			id: String(a.id ?? ""),
			title: String(a.title ?? ""),
			categories: (a.categories as Record<string, unknown>[] ?? []).map(
				(c: Record<string, unknown>) => ({
					id: String(c.id ?? ""),
					title: String(c.title ?? ""),
					entries: (c.entries as Record<string, unknown>[] ?? []).map(
						(e: Record<string, unknown>) => ({
							id: String(e.id ?? ""),
							title: String(e.title ?? ""),
							created: e.created ? String(e.created) : undefined,
							description: e.description ? String(e.description) : undefined,
							status: e.status ? String(e.status) : undefined,
						})
					),
				})
			),
		})),
	};
}

export function parseJDConfig(raw: string): JDConfig {
	return parseYaml(raw) ?? {};
}

// ── Lookup helpers ───────────────────────────────────────────────

export function findEntry(jdex: JDex, id: string): JDEntry | undefined {
	for (const area of jdex.areas) {
		for (const cat of area.categories) {
			const entry = cat.entries.find((e) => e.id === id);
			if (entry) return entry;
		}
	}
	return undefined;
}

export function findCategory(jdex: JDex, id: string): JDCategory | undefined {
	for (const area of jdex.areas) {
		const cat = area.categories.find((c) => c.id === id);
		if (cat) return cat;
	}
	return undefined;
}

export function findArea(jdex: JDex, areaId: string): JDArea | undefined {
	return jdex.areas.find((a) => a.id === areaId);
}

/** Build a flat list of all entries with their area/category context. */
export interface FlatEntry {
	entry: JDEntry;
	category: JDCategory;
	area: JDArea;
}

export function flatEntries(jdex: JDex): FlatEntry[] {
	const result: FlatEntry[] = [];
	for (const area of jdex.areas) {
		for (const cat of area.categories) {
			for (const entry of cat.entries) {
				result.push({ entry, category: cat, area });
			}
		}
	}
	return result;
}
