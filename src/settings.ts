/**
 * Plugin settings — configures paths and behavior.
 */

import { type App, PluginSettingTab, Setting, normalizePath } from "obsidian";
import type JDDashboardPlugin from "./main";

export interface JDSettings {
	/** Absolute path to JD root on filesystem (e.g. ~/Documents) */
	jdRoot: string;
	/** Absolute path to jd-index.yaml */
	jdexPath: string;
	/** Show inbox items with count 0 */
	showEmptyInboxes: boolean;
}

export const DEFAULT_SETTINGS: JDSettings = {
	jdRoot: "~/Documents",
	jdexPath: "~/.local/share/jd/jd-index.yaml",
	showEmptyInboxes: false,
};

export class JDSettingsTab extends PluginSettingTab {
	plugin: JDDashboardPlugin;

	constructor(app: App, plugin: JDDashboardPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

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
	}
}
