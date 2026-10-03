import {
	Box,
	type Component,
	Container,
	type SelectItem,
	SelectList,
	type SelectListLayoutOptions,
	Spacer,
	Text,
	truncateToWidth,
} from "@earendil-works/pi-tui";
import { getAvailableThemes, getSelectListTheme, theme } from "../theme/theme.ts";
import { DynamicBorder } from "./dynamic-border.ts";

const THEME_SELECT_LIST_LAYOUT: SelectListLayoutOptions = {
	minPrimaryColumnWidth: 12,
	maxPrimaryColumnWidth: 32,
};

class ThemePreviewComponent implements Component {
	private readonly getSelectedTheme: () => string;

	constructor(getSelectedTheme: () => string) {
		this.getSelectedTheme = getSelectedTheme;
	}

	invalidate(): void {}

	render(width: number): string[] {
		const lines: string[] = [];
		const push = (line = "") => lines.push(truncateToWidth(line, width, ""));

		push(` ${theme.fg("mdHeading", theme.bold("Preview"))} ${theme.fg("dim", `(${this.getSelectedTheme()})`)}`);
		push();

		const userBox = new Box(1, 1, (text: string) => theme.bg("userMessageBg", text));
		userBox.addChild(new Text(theme.fg("userMessageText", "Fix the config parser regression."), 0, 0));
		lines.push(...userBox.render(width));

		push();
		push(" I found the issue and will patch it.");
		push();

		const toolBox = new Box(1, 1, (text: string) => theme.bg("toolSuccessBg", text));
		toolBox.addChild(
			new Text(`${theme.fg("toolTitle", theme.bold("edit"))} ${theme.fg("accent", "src/config.ts")}`, 0, 0),
		);
		toolBox.addChild(new Spacer(1));
		toolBox.addChild(
			new Text(
				[
					theme.fg("toolDiffContext", "      ..."),
					theme.fg("toolDiffContext", "  41 const raw = readConfig();"),
					theme.fg("toolDiffRemoved", "- 42 if (!value) return defaultValue;"),
					theme.fg("toolDiffAdded", "+ 42 if (value === undefined) return defaultValue;"),
					theme.fg("toolDiffContext", "  43 return value;"),
					theme.fg("toolDiffContext", "      ..."),
				].join("\n"),
				0,
				0,
			),
		);
		lines.push(...toolBox.render(width));

		push();
		push(" Fixed. Empty strings are preserved.");
		return lines;
	}
}

/**
 * Component that renders a theme selector.
 * The list, borders, and preview/select/cancel callbacks stay; a live preview sits above the list.
 */
export class ThemeSelectorComponent extends Container {
	private selectList: SelectList;
	private onPreview: (themeName: string) => void;
	private selectedTheme: string;

	constructor(
		currentTheme: string,
		onSelect: (themeName: string) => void,
		onCancel: () => void,
		onPreview: (themeName: string) => void,
	) {
		super();
		this.onPreview = onPreview;
		this.selectedTheme = currentTheme;

		const themes = getAvailableThemes();
		const themeItems: SelectItem[] = themes.map((name) => ({
			value: name,
			label: name,
			description: name === currentTheme ? "(current)" : undefined,
		}));

		this.addChild(new DynamicBorder());
		this.addChild(new ThemePreviewComponent(() => this.selectedTheme));

		this.selectList = new SelectList(themeItems, 10, getSelectListTheme(), THEME_SELECT_LIST_LAYOUT);

		const currentIndex = themes.indexOf(currentTheme);
		if (currentIndex !== -1) {
			this.selectList.setSelectedIndex(currentIndex);
		}

		this.selectList.onSelect = (item) => {
			onSelect(item.value);
		};

		this.selectList.onCancel = () => {
			onCancel();
		};

		this.selectList.onSelectionChange = (item) => {
			this.selectedTheme = item.value;
			this.onPreview(item.value);
		};

		this.addChild(this.selectList);
		this.addChild(new DynamicBorder());
	}

	getSelectList(): SelectList {
		return this.selectList;
	}
}
