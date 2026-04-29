/**
 * Plugin settings — configures paths, frontmatter keys, and normalizer behavior.
 */

import { type App, PluginSettingTab, Setting } from "obsidian";
import type JDDashboardPlugin from "./main";

export interface JDSettings {
	// ── Paths ────────────────────────────────────────────────────
	/** Absolute path to JD root on filesystem (e.g. ~/Documents) */
	jdRoot: string;
	/** Absolute path to jd-index.yaml */
	jdexPath: string;
	/** Absolute path to jd.yaml (config — expanded areas, etc.) */
	jdConfigPath: string;

	// ── Dashboard ────────────────────────────────────────────────
	/** Show inbox items with count 0 */
	showEmptyInboxes: boolean;

	// ── Audit ────────────────────────────────────────────────────
	/** Days before a surveyed date is considered stale */
	staleDays: number;
	/** Run vault audit on Obsidian startup */
	auditOnStartup: boolean;

	// ── Frontmatter keys (configurable) ──────────────────────────
	titleKey: string;
	idKey: string;
	typeKey: string;
	ignoreKey: string;

	// ── Normalizer toggles ───────────────────────────────────────
	/** Master switch — when off, no on-save normalization runs */
	normalizeEnabled: boolean;
	/** Wrap unquoted ID values in single quotes (e.g. 06.12 → '06.12') */
	normalizeQuoteId: boolean;
	/** Add inferred `<typeKey>` when missing */
	normalizeInferType: boolean;
	/** Reorder frontmatter keys into canonical order */
	normalizeSortKeys: boolean;
	/** Strip the JD ID prefix from H1 headings (`# 06.12 Foo` → `# Foo`) */
	normalizeStripHeadingId: boolean;

	// ── Type as tag ──────────────────────────────────────────────
	/** Express type as a tag instead of a frontmatter key */
	typeAsTag: boolean;
	/** Prefix prepended to the type value when generating a tag (e.g. "jd/") */
	typeTagPrefix: string;
	/** Per-type override map: typeValue → exact tag (no prefix added) */
	typeTagMap: Record<string, string>;

	// ── Generic-id behavior ──────────────────────────────────────
	/** Whether to persist type when the inferred value is the generic `id` */
	writeTypeForGenericIds: boolean;

	// ── Expanded-area inference ──────────────────────────────────
	/**
	 * When true, the normalizer infers types for 5-digit expanded-area IDs
	 * (e.g. 92001, 27001) and their sub-IDs (92001.11). Default off because
	 * 5-digit IDs cover disparate kinds across areas (projects in 90-99,
	 * people in 27, etc.) — the user manages tags directly.
	 */
	inferTypeForExpandedIds: boolean;
}

export const DEFAULT_SETTINGS: JDSettings = {
	jdRoot: "~/Documents",
	jdexPath: "~/.local/share/jd/jd-index.yaml",
	jdConfigPath: "~/.config/jd/jd.yaml",
	showEmptyInboxes: false,
	staleDays: 90,
	auditOnStartup: false,

	titleKey: "jd-title",
	idKey: "jd-id",
	typeKey: "jd-type",
	ignoreKey: "jd-ignore",

	normalizeEnabled: true,
	normalizeQuoteId: true,
	normalizeInferType: true,
	normalizeSortKeys: true,
	normalizeStripHeadingId: true,

	typeAsTag: false,
	typeTagPrefix: "jd/",
	typeTagMap: {},

	writeTypeForGenericIds: true,

	inferTypeForExpandedIds: false,
};

// ── Tag-map serialization ────────────────────────────────────────

function tagMapToText(map: Record<string, string>): string {
	return Object.entries(map)
		.map(([k, v]) => `${k}: ${v}`)
		.join("\n");
}

function tagMapFromText(text: string): Record<string, string> {
	const out: Record<string, string> = {};
	for (const line of text.split("\n")) {
		const trimmed = line.trim();
		if (!trimmed) continue;
		const idx = trimmed.indexOf(":");
		if (idx === -1) continue;
		const k = trimmed.slice(0, idx).trim();
		const v = trimmed.slice(idx + 1).trim();
		if (k && v) out[k] = v;
	}
	return out;
}

export class JDSettingsTab extends PluginSettingTab {
	plugin: JDDashboardPlugin;

	constructor(app: App, plugin: JDDashboardPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		// ── Paths ────────────────────────────────────────────────
		new Setting(containerEl).setName("Paths").setHeading();

		new Setting(containerEl)
			.setName("JD root")
			.setDesc("Filesystem root of your Johnny Decimal tree (e.g. ~/Documents)")
			.addText((text) =>
				text
					.setPlaceholder("~/Documents")
					.setValue(this.plugin.settings.jdRoot)
					.onChange(async (value) => {
						this.plugin.settings.jdRoot = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("JDex path")
			.setDesc("Path to jd-index.yaml")
			.addText((text) =>
				text
					.setPlaceholder("~/.local/share/jd/jd-index.yaml")
					.setValue(this.plugin.settings.jdexPath)
					.onChange(async (value) => {
						this.plugin.settings.jdexPath = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("JD config path")
			.setDesc("Path to jd.yaml — declares expanded areas and other config")
			.addText((text) =>
				text
					.setPlaceholder("~/.config/jd/jd.yaml")
					.setValue(this.plugin.settings.jdConfigPath)
					.onChange(async (value) => {
						this.plugin.settings.jdConfigPath = value;
						await this.plugin.saveSettings();
					})
			);

		// ── Dashboard ────────────────────────────────────────────
		new Setting(containerEl).setName("Dashboard").setHeading();

		new Setting(containerEl)
			.setName("Show empty inboxes")
			.setDesc("Show inbox folders even when they have no items")
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.showEmptyInboxes)
					.onChange(async (value) => {
						this.plugin.settings.showEmptyInboxes = value;
						await this.plugin.saveSettings();
					})
			);

		// ── Audit ────────────────────────────────────────────────
		new Setting(containerEl).setName("Audit").setHeading();

		new Setting(containerEl)
			.setName("Stale surveyed threshold")
			.setDesc("Days before a surveyed date is flagged as stale")
			.addSlider((slider) =>
				slider
					.setLimits(30, 365, 30)
					.setValue(this.plugin.settings.staleDays)
					.setDynamicTooltip()
					.onChange(async (value) => {
						this.plugin.settings.staleDays = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Audit on startup")
			.setDesc("Run vault audit automatically when Obsidian opens")
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.auditOnStartup)
					.onChange(async (value) => {
						this.plugin.settings.auditOnStartup = value;
						await this.plugin.saveSettings();
					})
			);

		// ── Frontmatter keys ─────────────────────────────────────
		new Setting(containerEl).setName("Frontmatter keys").setHeading();
		containerEl.createEl("p", {
			cls: "setting-item-description",
			text: "Names used for the JD title, ID, and type fields in note frontmatter. Existing notes will not be migrated automatically.",
		});

		new Setting(containerEl)
			.setName("Title key")
			.setDesc("Frontmatter key for the JD title")
			.addText((text) =>
				text
					.setPlaceholder("jd-title")
					.setValue(this.plugin.settings.titleKey)
					.onChange(async (value) => {
						this.plugin.settings.titleKey = value || "jd-title";
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("ID key")
			.setDesc("Frontmatter key for the JD ID")
			.addText((text) =>
				text
					.setPlaceholder("jd-id")
					.setValue(this.plugin.settings.idKey)
					.onChange(async (value) => {
						this.plugin.settings.idKey = value || "jd-id";
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Type key")
			.setDesc("Frontmatter key for the JD type (ignored when 'Type as tag' is on)")
			.addText((text) =>
				text
					.setPlaceholder("jd-type")
					.setValue(this.plugin.settings.typeKey)
					.onChange(async (value) => {
						this.plugin.settings.typeKey = value || "jd-type";
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Ignore key")
			.setDesc(
				"Frontmatter key that opts notes out of drift/audit checks. Accepts true (silence all) or a list of check names."
			)
			.addText((text) =>
				text
					.setPlaceholder("jd-ignore")
					.setValue(this.plugin.settings.ignoreKey)
					.onChange(async (value) => {
						this.plugin.settings.ignoreKey = value || "jd-ignore";
						await this.plugin.saveSettings();
					})
			);

		// ── Normalizer toggles ───────────────────────────────────
		new Setting(containerEl).setName("Frontmatter normalizer").setHeading();
		containerEl.createEl("p", {
			cls: "setting-item-description",
			text: "Auto-corrections applied to JD note frontmatter on save.",
		});

		new Setting(containerEl)
			.setName("Enable normalizer")
			.setDesc("Master switch for all on-save normalization")
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.normalizeEnabled)
					.onChange(async (value) => {
						this.plugin.settings.normalizeEnabled = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Quote ID values")
			.setDesc("Wrap unquoted IDs in single quotes (YAML reads 06.12 as a number otherwise)")
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.normalizeQuoteId)
					.onChange(async (value) => {
						this.plugin.settings.normalizeQuoteId = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Infer type when missing")
			.setDesc("Set the type field automatically based on the ID pattern")
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.normalizeInferType)
					.onChange(async (value) => {
						this.plugin.settings.normalizeInferType = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Sort frontmatter keys")
			.setDesc("Reorder keys into canonical order on save")
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.normalizeSortKeys)
					.onChange(async (value) => {
						this.plugin.settings.normalizeSortKeys = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Strip ID from H1 heading")
			.setDesc("Rewrite '# 06.12 Foo' as '# Foo'")
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.normalizeStripHeadingId)
					.onChange(async (value) => {
						this.plugin.settings.normalizeStripHeadingId = value;
						await this.plugin.saveSettings();
					})
			);

		// ── Type as tag ──────────────────────────────────────────
		new Setting(containerEl).setName("Type representation").setHeading();

		new Setting(containerEl)
			.setName("Type as tag")
			.setDesc("Express the JD type as a tag instead of a frontmatter key")
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.typeAsTag)
					.onChange(async (value) => {
						this.plugin.settings.typeAsTag = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Type tag prefix")
			.setDesc("Prefix prepended to the type value when generating a tag (e.g. 'jd/' produces 'jd/inbox')")
			.addText((text) =>
				text
					.setPlaceholder("jd/")
					.setValue(this.plugin.settings.typeTagPrefix)
					.onChange(async (value) => {
						this.plugin.settings.typeTagPrefix = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Type tag overrides")
			.setDesc(
				"One per line as 'type: tag'. Overrides the prefix-based tag for that type. Example: 'knowledge-base: kb' produces the tag 'kb' instead of 'jd/knowledge-base'."
			)
			.addTextArea((text) => {
				text.inputEl.rows = 5;
				text.inputEl.style.fontFamily = "var(--font-monospace)";
				text
					.setPlaceholder("knowledge-base: kb\ninbox: in")
					.setValue(tagMapToText(this.plugin.settings.typeTagMap))
					.onChange(async (value) => {
						this.plugin.settings.typeTagMap = tagMapFromText(value);
						await this.plugin.saveSettings();
					});
			});

		new Setting(containerEl)
			.setName("Persist generic 'id' type")
			.setDesc(
				"Off: don't write a type when the inferred value is the generic 'id'. On: always write it (current default)."
			)
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.writeTypeForGenericIds)
					.onChange(async (value) => {
						this.plugin.settings.writeTypeForGenericIds = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Infer type for expanded-area IDs")
			.setDesc(
				"On: 5-digit IDs (e.g. 92001 projects, 27001 people) and their sub-IDs (92001.11) get auto-inferred types. Off (default): user manages tags manually for these — they cover disparate kinds across areas."
			)
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.inferTypeForExpandedIds)
					.onChange(async (value) => {
						this.plugin.settings.inferTypeForExpandedIds = value;
						await this.plugin.saveSettings();
					})
			);
	}
}
