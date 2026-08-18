frappe.provide("nexlify_reports");

// ============================================================
// Low-level helpers
// ============================================================

nexlify_reports.measure_text_width = function (text, font) {
	nexlify_reports._canvas = nexlify_reports._canvas || document.createElement("canvas");
	const context = nexlify_reports._canvas.getContext("2d");
	context.font = font;
	return context.measureText(text || "").width;
};

nexlify_reports.get_instance_class = function (wrapperEl) {
	const match = (wrapperEl.className || "").match(/dt-instance-\d+/);
	return match ? match[0] : null;
};

nexlify_reports.get_or_create_style_tag = function (instanceClass) {
	const id = "nexlify-autofit-style-" + instanceClass;
	let styleEl = document.getElementById(id);
	if (!styleEl) {
		styleEl = document.createElement("style");
		styleEl.id = id;
		document.head.appendChild(styleEl);
	}
	return styleEl;
};

// Single place that ever writes column-width CSS. Every code path below
// (initial autofit, buttons, resize, double-click) funnels through this.
nexlify_reports.write_width_rules = function (wrapperEl, widths) {
	const instanceClass = nexlify_reports.get_instance_class(wrapperEl);
	if (!instanceClass) return;
	const rules = [];
	Object.keys(widths).forEach((colIndex) => {
		const w = widths[colIndex];
		rules.push(`.${instanceClass} .dt-cell[data-col-index="${colIndex}"] { width: ${w}px !important; }`);
		rules.push(`.${instanceClass} .dt-cell__content--header-${colIndex}, .${instanceClass} .dt-cell__content--col-${colIndex} { width: ${w}px !important; }`);
	});
	const styleEl = nexlify_reports.get_or_create_style_tag(instanceClass);
	styleEl.textContent = rules.join("\n");
};

// Remove just one column's rule (used while a manual resize or the
// library's own native double-click-autofit is in progress, so our
// permanent !important rule doesn't block it).
nexlify_reports.remove_width_rule_for_column = function (wrapperEl, colIndex) {
	const instanceClass = nexlify_reports.get_instance_class(wrapperEl);
	if (!instanceClass) return;
	const s = document.getElementById("nexlify-autofit-style-" + instanceClass);
	if (!s) return;
	const esc = String(colIndex).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	const headerRe = new RegExp("header-" + esc + "(?!\\d)");
	const colRe = new RegExp("col-" + esc + "(?!\\d)");
	const dataAttrRe = new RegExp('data-col-index="' + esc + '"');
	s.textContent = s.textContent
		.split("\n")
		.filter((line) => !(dataAttrRe.test(line) || headerRe.test(line) || colRe.test(line)))
		.join("\n");
};

// Measures the widest rendered content per column (canvas text metrics).
nexlify_reports.compute_content_widths = function (wrapperEl) {
	const $wrapper = $(wrapperEl);
	const colIndices = new Set();
	$wrapper.find("[data-col-index]").each(function () {
		colIndices.add(this.getAttribute("data-col-index"));
	});
	if (!colIndices.size) return null;

	const sampleContent = $wrapper.find(".dt-cell__content").get(0);
	let font = "12px sans-serif";
	if (sampleContent) {
		const cs = getComputedStyle(sampleContent);
		font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
	}

	const widths = {};
	colIndices.forEach((colIndex) => {
		let maxWidth = 40;
		$wrapper.find(`[data-col-index="${colIndex}"] .dt-cell__content`).each(function () {
			const text = this.getAttribute("title") || this.textContent || "";
			const w = nexlify_reports.measure_text_width(text.trim(), font);
			if (w > maxWidth) maxWidth = w;
		});
		widths[colIndex] = maxWidth + 32;
	});
	return widths;
};

// ============================================================
// Persistence (Report View / List View / any table remembers its
// own column widths across visits, keyed by report/route/dialog)
// ============================================================

nexlify_reports.get_report_base_key = function () {
	if (frappe.query_report && frappe.query_report.report_name) {
		return "query_report:" + frappe.query_report.report_name;
	}
	if (window.cur_list && cur_list.doctype) {
		return "list_report:" + cur_list.doctype;
	}
	if (window.cur_dialog && cur_dialog.title) {
		return "dialog:" + cur_dialog.title;
	}
	return "generic:" + (frappe.get_route_str ? frappe.get_route_str() : window.location.pathname);
};

nexlify_reports.get_column_signature = function (datatable) {
	const columns = datatable.datamanager.getColumns();
	return columns.map((c) => c.id || c.name || "").join("|");
};

nexlify_reports.get_report_key = function (datatable) {
	// ":v3" invalidates any widths saved by earlier versions of this
	// engine (including the floor-only stretch math that lost pixels to
	// rounding), so the current, verified-correct calculation always
	// runs at least once instead of an old cached result being reused.
	return nexlify_reports.get_report_base_key() + ":" + nexlify_reports.get_column_signature(datatable) + ":v7";
};

nexlify_reports.save_widths = function (key, widths) {
	try {
		localStorage.setItem("nexlify_col_widths:" + key, JSON.stringify(widths));
	} catch (e) {}
};

nexlify_reports.load_widths = function (key) {
	try {
		const raw = localStorage.getItem("nexlify_col_widths:" + key);
		return raw ? JSON.parse(raw) : null;
	} catch (e) {
		return null;
	}
};

// ============================================================
// Cell formatting: negative numbers in red, zero amounts as "-"
// ============================================================

nexlify_reports.ZERO_CURRENCY_RE = /^([A-Za-z]{2,5}\s+)?0(\.0+)?$/;

nexlify_reports.apply_zero_dash = function (wrapperEl) {
	$(wrapperEl)
		.find(".dt-row[data-row-index] .dt-cell__content")
		.each(function () {
			const original = this.getAttribute("title") || this.textContent || "";
			const isZeroCurrency = nexlify_reports.ZERO_CURRENCY_RE.test(original.trim());
			if (isZeroCurrency) {
				if (this.textContent.trim() !== "-") this.textContent = "-";
			} else if (this.textContent.trim() === "-" && original.trim() !== "-" && original.trim() !== "") {
				this.textContent = original;
			}
		});
};

nexlify_reports.highlight_negative_numbers_dom = function (wrapperEl) {
	$(wrapperEl)
		.find(".dt-row[data-row-index] .dt-cell__content")
		.each(function () {
			const text = (this.textContent || "").trim();
			const isNegativeNumber = /^-[\d.,]+$/.test(text.replace(/[A-Za-z]/g, "").trim());
			$(this).toggleClass("nexlify-negative", isNegativeNumber);
		});
	nexlify_reports.apply_zero_dash(wrapperEl);
};

// If the columns' total width is narrower than the available container,
// stretch every column proportionally to fill it. Math.floor on each
// column individually loses up to ~1px per column to rounding, so the
// leftover pixels are distributed back across the columns afterward
// instead of being dropped - the final total then matches the
// container width exactly (verified: zero gap).
nexlify_reports.stretch_widths_to_fill = function (wrapperEl, widths) {
	const total = Object.values(widths).reduce((a, b) => a + b, 0);
	// Measure .datatable's immediate parent, not .datatable itself or
	// .dt-scrollable inside it. .dt-scrollable's width is circularly
	// determined by the column widths we're setting, and .datatable
	// itself can carry its own padding/margin that shrinks it below the
	// true available width in some contexts (Report View) while being
	// flush with it in others (custom pages) - the parent is the one
	// consistent, non-circular reference in both cases.
	const measureEl = wrapperEl.parentElement || wrapperEl;
	const containerWidth = measureEl.getBoundingClientRect().width;
	if (!(containerWidth > 0 && total > 0)) return widths;

	const scale = containerWidth / total;

	// Only shrink when the container is moderately narrower than the
	// content (e.g. the window got smaller after the table had already
	// stretched to fit a wider one). A table that genuinely needs far
	// more room than any viewport (many-column reports like General
	// Ledger) should keep its natural content widths and scroll
	// horizontally, not get crushed down to the minimum floor.
	if (scale < 0.7) {
		return widths;
	}

	// Grow columns when there's extra space, and shrink them back down
	// (within the 0.7+ range above) when the container got moderately
	// narrower - only stretching upward left already-wide columns
	// permanently oversized after the window later shrank, which is
	// what caused the "gap only closes one direction" bug.
	const MIN_COL_WIDTH = 40;
	const keys = Object.keys(widths);
	const scaled = {};
	let scaledTotal = 0;
	keys.forEach((colIndex) => {
		const w = Math.max(MIN_COL_WIDTH, Math.floor(widths[colIndex] * scale));
		scaled[colIndex] = w;
		scaledTotal += w;
	});

	let remainder = Math.round(containerWidth - scaledTotal);
	for (let i = 0; i < keys.length && remainder > 0; i++, remainder--) {
		scaled[keys[i]] += 1;
	}

	return scaled;
};

// Watches the table's real container for ANY size change (window
// resize, DevTools opening/closing, sidebar collapsing, browser zoom,
// etc.) and re-fits the columns to match - so the layout always adapts
// to whatever the actual current size is, instead of being locked to
// whatever it happened to be at the first measurement.
nexlify_reports.watch_container_resize = function (wrapperEl) {
	if (wrapperEl.__nexlify_resize_watched) return;
	wrapperEl.__nexlify_resize_watched = true;

	if (!window.ResizeObserver) return;

	const measureEl = wrapperEl.parentElement || wrapperEl;

	// Wait for the initial fit_columns/apply_saved_widths sequence
	// (setTimeout 150 + two animation frames) to fully settle before we
	// start observing. Attaching immediately caused a race where the
	// observer's own forced first callback would re-fit using a
	// transitional, not-yet-final width and override the correct result.
	setTimeout(() => {
		let resizeTimer = null;
		let lastWidth = measureEl.getBoundingClientRect().width;

		const ro = new ResizeObserver((entries) => {
			if (nexlifyResizing) return;
			const newWidth = entries[0].contentRect.width;
			if (newWidth <= 0) return;
			if (Math.abs(newWidth - lastWidth) < 3) return;
			lastWidth = newWidth;

			clearTimeout(resizeTimer);
			resizeTimer = setTimeout(() => {
				nexlify_reports.sync_widths_from_header(wrapperEl);
			}, 150);
		});
		ro.observe(measureEl);
	}, 600);
};

// ============================================================
// The one entry point for computing + applying column widths.
// Used by: initial load, Autofit button/toolbar, Reset columns.
// ============================================================

nexlify_reports.fit_columns = function (wrapperEl, opts) {
	opts = opts || {};
	const widths = nexlify_reports.compute_content_widths(wrapperEl);
	if (!widths) return;

	// Apply immediately so the table isn't left unstyled while we wait a
	// couple of frames for the surrounding page layout to settle before
	// measuring the real container width.
	nexlify_reports.write_width_rules(wrapperEl, widths);
	nexlify_reports.highlight_negative_numbers_dom(wrapperEl);

	requestAnimationFrame(() => {
		requestAnimationFrame(() => {
			const finalWidths = nexlify_reports.stretch_widths_to_fill(wrapperEl, widths);
			nexlify_reports.write_width_rules(wrapperEl, finalWidths);
			if (opts.persistKey) nexlify_reports.save_widths(opts.persistKey, finalWidths);
		});
	});
};

// Re-apply previously saved widths, but still re-stretch them to fill the
// CURRENT container width, since it may differ from when they were saved
// (sidebar collapsed, window resized, etc).
nexlify_reports.apply_saved_widths = function (wrapperEl, widths) {
	nexlify_reports.highlight_negative_numbers_dom(wrapperEl);
	nexlify_reports.write_width_rules(wrapperEl, widths);
	requestAnimationFrame(() => {
		requestAnimationFrame(() => {
			const finalWidths = nexlify_reports.stretch_widths_to_fill(wrapperEl, widths);
			nexlify_reports.write_width_rules(wrapperEl, finalWidths);
		});
	});
};

nexlify_reports.apply_saved_or_autofit = function (datatable, wrapperEl) {
	datatable.__nexlify_last_signature = nexlify_reports.get_column_signature(datatable);
	const key = nexlify_reports.get_report_key(datatable);
	wrapperEl.__nexlify_persist_key = key;

	const saved = nexlify_reports.load_widths(key);
	if (saved) {
		nexlify_reports.apply_saved_widths(wrapperEl, saved);
	} else {
		nexlify_reports.fit_columns(wrapperEl, { persistKey: key });
	}
};

// Kept as a thin, explicit-name alias since the floating toolbar and a
// few other call sites refer to "autofit" - it's the same engine either
// way, with or without persistence.
nexlify_reports.autofit_columns_dom = function (wrapperEl) {
	nexlify_reports.fit_columns(wrapperEl, { persistKey: wrapperEl.__nexlify_persist_key || null });
};

// ============================================================
// Floating Autofit / Reset toolbar for tables outside Report View /
// List View (dialogs, custom pages like Bank Reconciliation Tool).
// ============================================================

nexlify_reports.ensure_floating_toolbar = function (wrapperEl) {
	if (wrapperEl.__nexlify_toolbar_added) return;
	wrapperEl.__nexlify_toolbar_added = true;

	const $bar = $(
		'<div class="nexlify-floating-toolbar">' +
			'<button type="button" class="btn btn-xs btn-default nexlify-floating-autofit">' + __("Autofit") + '</button>' +
			'<button type="button" class="btn btn-xs btn-default nexlify-floating-reset">' + __("Reset columns") + '</button>' +
		'</div>'
	);

	$bar.find(".nexlify-floating-autofit").on("click", function () {
		nexlify_reports.fit_columns(wrapperEl, { persistKey: wrapperEl.__nexlify_persist_key || null });
	});

	$bar.find(".nexlify-floating-reset").on("click", function () {
		const ic = nexlify_reports.get_instance_class(wrapperEl);
		if (ic) {
			const s = document.getElementById("nexlify-autofit-style-" + ic);
			if (s) s.remove();
		}
		if (wrapperEl.__nexlify_persist_key) {
			try { localStorage.removeItem("nexlify_col_widths:" + wrapperEl.__nexlify_persist_key); } catch (e) {}
		}
		nexlify_reports.fit_columns(wrapperEl, { persistKey: wrapperEl.__nexlify_persist_key || null });
	});

	$(wrapperEl).before($bar);
};

// ============================================================
// Page-level Autofit / Reset buttons for Report View / List View
// ============================================================

nexlify_reports.ensure_buttons = function (pageObj, datatableGetter) {
	if (!pageObj || !pageObj.page) return;
	try {
		const $wrapper = $(pageObj.page.wrapper);
		if ($wrapper.find(".nexlify-autofit-btn").length) return;

		pageObj.page.add_inner_button(__("Autofit"), function () {
			try {
				const dt = datatableGetter();
				if (dt && dt.wrapper) {
					const wrapperEl = $(dt.wrapper).find(".datatable")[0];
					const key = nexlify_reports.get_report_key(dt);
					nexlify_reports.fit_columns(wrapperEl, { persistKey: key });
					frappe.show_alert({ message: __("Columns autofitted"), indicator: "green" });
				} else {
					console.warn("[Nexlify] Autofit: no datatable found");
				}
			} catch (e) {
				console.error("[Nexlify] Autofit error:", e);
			}
		}).addClass("nexlify-autofit-btn");

		pageObj.page.add_inner_button(__("Reset Columns"), function () {
			try {
				const dt = datatableGetter();
				if (dt && dt.wrapper) {
					const wrapperEl = $(dt.wrapper).find(".datatable")[0];
					const key = nexlify_reports.get_report_key(dt);
					try { localStorage.removeItem("nexlify_col_widths:" + key); } catch (e) {}
					nexlify_reports.fit_columns(wrapperEl, { persistKey: key });
					frappe.show_alert({ message: __("Columns reset to default"), indicator: "green" });
				} else {
					console.warn("[Nexlify] Reset: no datatable found");
				}
			} catch (e) {
				console.error("[Nexlify] Reset error:", e);
			}
		}).addClass("nexlify-reset-btn");
	} catch (e) {
		console.error("[Nexlify] ensure_buttons error:", e);
	}
};

nexlify_reports.setup_report = function () {
	if (frappe.query_report && frappe.query_report.page) {
		nexlify_reports.ensure_buttons(frappe.query_report, () => frappe.query_report.datatable);
	}
	if (window.cur_list && cur_list.datatable && cur_list.page) {
		nexlify_reports.ensure_buttons(cur_list, () => cur_list.datatable);
	}
};

// ============================================================
// Watching a single table instance: initial fit + re-fit on real
// data changes (not on every virtual-scroll re-render).
// ============================================================

nexlify_reports.observe_datatable = function (datatable) {
	if (!datatable || datatable.__nexlify_observed) return;
	datatable.__nexlify_observed = true;

	const wrapperEl = $(datatable.wrapper).find(".datatable")[0];
	if (!wrapperEl) return;

	const isReportOrList =
		(frappe.query_report && frappe.query_report.datatable === datatable) ||
		(window.cur_list && cur_list.datatable === datatable);

	// Report View / List View get page-toolbar buttons via setup_report;
	// everything else (dialogs, custom pages) gets a small floating
	// toolbar directly above the table instead.
	if (!isReportOrList) {
		nexlify_reports.ensure_floating_toolbar(wrapperEl);
	}

	nexlify_reports.watch_container_resize(wrapperEl);

	setTimeout(() => {
		nexlify_reports.apply_saved_or_autofit(datatable, wrapperEl);
	}, 150);

	const bodyEl = $(datatable.wrapper).find(".dt-scrollable")[0];
	if (!bodyEl) return;

	let debounceTimer = null;
	let sawEmpty = false;
	let rafPending = false;

	// All work below runs at most once per animation frame - not once per
	// raw MutationObserver callback, which can fire many times per frame
	// during fast/virtualized scrolling and would otherwise cause jank.
	const observer = new MutationObserver(() => {
		if (rafPending) return;
		rafPending = true;

		requestAnimationFrame(() => {
			rafPending = false;

			const rowCount = $(datatable.wrapper).find(".dt-row[data-row-index]").length;
			if (rowCount <= 1) {
				sawEmpty = true;
				return;
			}

			// Re-apply negative/zero formatting on every re-render, even a
			// plain scroll - frappe-datatable recycles row DOM nodes, so
			// newly-shown rows need this re-applied. Cheap, safe to repeat.
			nexlify_reports.highlight_negative_numbers_dom(wrapperEl);

			const currentSignature = nexlify_reports.get_column_signature(datatable);
			const columnsChanged = datatable.__nexlify_last_signature !== undefined
				&& currentSignature !== datatable.__nexlify_last_signature;

			if (!sawEmpty && !columnsChanged) return;

			clearTimeout(debounceTimer);
			debounceTimer = setTimeout(() => {
				sawEmpty = false;
				nexlify_reports.apply_saved_or_autofit(datatable, wrapperEl);
			}, 250);
		});
	});

	observer.observe(bodyEl, { childList: true, subtree: true });
};

nexlify_reports.watch_and_bind = function () {
	setInterval(() => {
		if (frappe.query_report && frappe.query_report.datatable) {
			nexlify_reports.observe_datatable(frappe.query_report.datatable);
			nexlify_reports.bind_search_boxes(frappe.query_report.datatable);
		}
		if (window.cur_list && cur_list.datatable) {
			nexlify_reports.observe_datatable(cur_list.datatable);
			nexlify_reports.bind_search_boxes(cur_list.datatable);
		}
		nexlify_reports.setup_report();
	}, 800);
};

$(document).on("page-change", function () {
	frappe.after_ajax(() => {
		setTimeout(nexlify_reports.setup_report, 300);
		nexlify_reports.close_value_popup();
	});
});

// ============================================================
// Global hook: every frappe-datatable created anywhere on the desk
// (Report View, List View, dialogs, custom pages) goes through here.
// ============================================================

nexlify_reports.hook_datatable_constructor = function () {
	if (window.__nexlify_datatable_hooked) return;
	window.__nexlify_datatable_hooked = true;

	let patchedConstructor = window.DataTable;

	const wrap_datatable_class = function (OriginalDataTable) {
		if (!OriginalDataTable || OriginalDataTable.__nexlify_wrapped) {
			return OriginalDataTable;
		}
		const Wrapped = function (wrapper, options) {
			options = options || {};
			// "fluid" layout keeps total table width constant, so resizing
			// one column silently shrinks/grows the others to compensate.
			// "fixed" makes every column independent. Our own width engine
			// already handles filling the container, so we don't lose that
			// behavior by switching this.
			options.layout = "fixed";
			const instance = new OriginalDataTable(wrapper, options);
			setTimeout(() => {
				nexlify_reports.observe_datatable(instance);
				nexlify_reports.bind_search_boxes(instance);
			}, 0);
			return instance;
		};
		Wrapped.prototype = OriginalDataTable.prototype;
		Object.setPrototypeOf(Wrapped, OriginalDataTable);
		Wrapped.__nexlify_wrapped = true;
		return Wrapped;
	};

	Object.defineProperty(window, "DataTable", {
		configurable: true,
		enumerable: true,
		get: function () {
			return patchedConstructor;
		},
		set: function (value) {
			patchedConstructor = wrap_datatable_class(value);
		},
	});

	if (patchedConstructor) {
		window.DataTable = patchedConstructor;
	}
};

// ============================================================
// Column resize (drag) and native double-click autofit passthrough
// ============================================================

let nexlifyResizing = false;
const NEXLIFY_RESIZE_EDGE_PX = 6;

nexlify_reports.sync_widths_from_header = function (wrapperEl) {
	const $wrapper = $(wrapperEl);
	const widths = {};
	$wrapper.find(".dt-row-header .dt-cell[data-col-index]").each(function () {
		const colIndex = this.getAttribute("data-col-index");
		const width = Math.round(this.getBoundingClientRect().width);
		if (width) widths[colIndex] = width;
	});
	if (!Object.keys(widths).length) return;

	const finalWidths = nexlify_reports.stretch_widths_to_fill(wrapperEl, widths);
	nexlify_reports.write_width_rules(wrapperEl, finalWidths);

	if (wrapperEl.__nexlify_persist_key) {
		nexlify_reports.save_widths(wrapperEl.__nexlify_persist_key, finalWidths);
	}
};

// frappe-datatable detects a resize drag by cursor proximity to the
// column edge, not via a dedicated handle element - so we do the same
// check here instead of depending on an internal class name.
$(document).on("mousedown", ".datatable .dt-row-header .dt-cell", function (e) {
	const rect = this.getBoundingClientRect();
	const nearRightEdge = rect.right - e.clientX <= NEXLIFY_RESIZE_EDGE_PX;
	const nearLeftEdge = e.clientX - rect.left <= NEXLIFY_RESIZE_EDGE_PX;
	if (!nearRightEdge && !nearLeftEdge) return;

	const wrapperEl = $(this).closest(".datatable")[0];
	if (!wrapperEl) return;

	const draggedColIndex = this.getAttribute("data-col-index");
	const startX = e.clientX;
	let armed = false;

	// Do NOT touch the stylesheet yet - a mousedown alone (a plain click
	// with no movement) must leave every column exactly as it is. Only
	// once the mouse actually moves a few pixels do we treat this as a
	// real resize drag and free the dragged column's own rule so the
	// library can control it.
	const onFirstMove = function (moveEvt) {
		if (armed) return;
		if (Math.abs(moveEvt.clientX - startX) < 2) return;
		armed = true;
		nexlifyResizing = true;
		nexlify_reports.remove_width_rule_for_column(wrapperEl, draggedColIndex);
	};

	const onUp = function () {
		document.removeEventListener("mousemove", onFirstMove);
		document.removeEventListener("mouseup", onUp);
	};

	document.addEventListener("mousemove", onFirstMove);
	document.addEventListener("mouseup", onUp);
});

$(document).on("mouseup", function () {
	if (!nexlifyResizing) return;
	nexlifyResizing = false;

	// The library has now committed its own final widths for every
	// column. Read that ground truth from the DOM and write it into our
	// own stylesheet (stretched to fill) as the new authoritative record.
	$(".datatable").each(function () {
		nexlify_reports.sync_widths_from_header(this);
	});
});

// Double-click near a column edge triggers the library's own native
// column autofit. Clear just that column's rule first, let the library
// do its thing, then capture the real result back afterwards - same
// pattern used for manual drag-resize above.
$(document).on("dblclick", ".datatable .dt-row-header .dt-cell", function (e) {
	const rect = this.getBoundingClientRect();
	const nearRightEdge = rect.right - e.clientX <= NEXLIFY_RESIZE_EDGE_PX;
	const nearLeftEdge = e.clientX - rect.left <= NEXLIFY_RESIZE_EDGE_PX;
	if (!nearRightEdge && !nearLeftEdge) return;

	const wrapperEl = $(this).closest(".datatable")[0];
	if (!wrapperEl) return;

	const colIndex = this.getAttribute("data-col-index");
	nexlify_reports.remove_width_rule_for_column(wrapperEl, colIndex);

	setTimeout(() => {
		nexlify_reports.sync_widths_from_header(wrapperEl);
	}, 50);
});

// ============================================================
// Excel-style column value filter (search box popup)
// ============================================================

nexlify_reports.esc_html = function (text) {
	return $("<div>").text(text).html();
};

nexlify_reports.get_unique_values = function (datatable, colIndex) {
	const rows = datatable.datamanager.rows;
	const values = new Set();
	rows.forEach((row) => {
		const cell = row[colIndex];
		if (cell) {
			const text = cell.content !== undefined && cell.content !== null ? String(cell.content).trim() : "";
			values.add(text);
		}
	});
	return Array.from(values).sort((a, b) => a.localeCompare(b));
};

nexlify_reports.apply_combined_filter = function (datatable, rows, textFilters, dm) {
	const valueFilters = datatable.__nexlify_value_filters || {};
	const allIndices = rows.map((r, i) => i);

	if (Object.keys(valueFilters).length === 0) {
		return Promise.resolve(allIndices);
	}

	return Promise.resolve(
		allIndices.filter((rowIndex) => {
			return Object.keys(valueFilters).every((colIndex) => {
				const allowedSet = valueFilters[colIndex];
				const cell = rows[rowIndex][colIndex];
				const text = cell && cell.content !== undefined && cell.content !== null ? String(cell.content).trim() : "";
				return allowedSet.has(text);
			});
		})
	);
};

nexlify_reports.ensure_filter_override = function (datatable) {
	if (!datatable || datatable.__nexlify_filter_override_added) return;
	datatable.__nexlify_filter_override_added = true;
	datatable.__nexlify_value_filters = {};

	datatable.datamanager.options.filterRows = function (rows, filters, dm) {
		return nexlify_reports.apply_combined_filter(datatable, rows, filters, dm);
	};
};

nexlify_reports.trigger_refilter = function (datatable) {
	if (datatable.columnmanager && datatable.columnmanager.applyFilter) {
		datatable.columnmanager.applyFilter(datatable.columnmanager.getAppliedFilters());
	}
};

nexlify_reports.update_filter_summary = function (datatable, colIndex, inputEl) {
	const filterSet = datatable.__nexlify_value_filters[colIndex];
	if (!filterSet) {
		inputEl.value = "";
		return;
	}
	if (filterSet.size === 1) {
		const only = Array.from(filterSet)[0];
		inputEl.value = only === "" ? __("(blank)") : only;
	} else {
		inputEl.value = __("Multiple select") + " (" + filterSet.size + ")";
	}
};

nexlify_reports.close_value_popup = function () {
	$(".nexlify-filter-popup").remove();
	$(document).off("click.nexlify-filter-close");
};

nexlify_reports.mark_filter_active = function (datatable, colIndex, inputEl) {
	const isActive = !!datatable.__nexlify_value_filters[colIndex];
	$(inputEl).toggleClass("nexlify-filter-active", isActive);
};

nexlify_reports.render_popup_list = function ($popup, allValues, checkedSet, searchText) {
	const $list = $popup.find(".nexlify-filter-list");
	$list.empty();

	const visibleValues = allValues.filter(
		(v) => !searchText || v.toLowerCase().includes(searchText.toLowerCase())
	);

	visibleValues.forEach((v) => {
		const checked = checkedSet.has(v) ? "checked" : "";
		const label = v === "" ? __("(blank)") : nexlify_reports.esc_html(v);
		const titleAttr = v === "" ? "" : nexlify_reports.esc_html(v);
		$list.append(
			`<label><input type="checkbox" class="nexlify-value-cb" value="${nexlify_reports.esc_html(v)}" ${checked}> <span title="${titleAttr}">${label}</span></label>`
		);
	});

	const allVisibleChecked = visibleValues.length > 0 && visibleValues.every((v) => checkedSet.has(v));
	$popup.find(".nexlify-select-all").prop("checked", allVisibleChecked);

	return visibleValues;
};

nexlify_reports.open_value_popup = function (datatable, colIndex, inputEl) {
	nexlify_reports.close_value_popup();

	const allValues = nexlify_reports.get_unique_values(datatable, colIndex);
	const existingFilter = datatable.__nexlify_value_filters[colIndex];
	let checkedSet = existingFilter ? new Set(existingFilter) : new Set(allValues);
	let preSearchSet = null;

	inputEl.value = "";

	const rect = inputEl.getBoundingClientRect();

	const $popup = $(`
		<div class="nexlify-filter-popup">
			<label class="nexlify-select-all-row">
				<input type="checkbox" class="nexlify-select-all" checked> <b class="nexlify-select-all-label">${__("Select All")}</b>
			</label>
			<label class="nexlify-add-selection-row" style="display:none;">
				<input type="checkbox" class="nexlify-add-selection"> ${__("Add current selection to filter")}
			</label>
			<div class="nexlify-filter-list"></div>
			<div class="nexlify-filter-actions">
				<button type="button" class="btn btn-default btn-xs nexlify-filter-clear">${__("Clear")}</button>
				<button type="button" class="btn btn-default btn-xs nexlify-filter-cancel">${__("Cancel")}</button>
				<button type="button" class="btn btn-primary btn-xs nexlify-filter-ok">${__("OK")}</button>
			</div>
		</div>
	`);

	const popupWidth = 230;
	let leftPos = rect.left;
	const maxLeft = window.innerWidth - popupWidth - 8;
	if (leftPos > maxLeft) {
		leftPos = Math.max(maxLeft, 8);
	}

	$popup.css({
		top: rect.bottom + 2 + "px",
		left: leftPos + "px",
	});

	$("body").append($popup);

	let visibleValues = nexlify_reports.render_popup_list($popup, allValues, checkedSet, inputEl.value);

	$(inputEl).on("input.nexlifypopup", function () {
		const searchText = this.value;

		if (searchText && preSearchSet === null) {
			preSearchSet = new Set(checkedSet);
		}
		if (!searchText && preSearchSet !== null) {
			checkedSet = new Set(preSearchSet);
			preSearchSet = null;
		}

		const newVisible = allValues.filter(
			(v) => !searchText || v.toLowerCase().includes(searchText.toLowerCase())
		);

		if (searchText) {
			checkedSet = new Set(newVisible);
		}

		$popup.find(".nexlify-select-all-label").text(searchText ? __("Select All Search Results") : __("Select All"));
		$popup.find(".nexlify-add-selection-row").toggle(!!searchText);
		visibleValues = nexlify_reports.render_popup_list($popup, allValues, checkedSet, searchText);
	});

	$popup.on("change", ".nexlify-value-cb", function () {
		if (this.checked) {
			checkedSet.add(this.value);
		} else {
			checkedSet.delete(this.value);
		}
		const allVisibleChecked = visibleValues.length > 0 && visibleValues.every((v) => checkedSet.has(v));
		$popup.find(".nexlify-select-all").prop("checked", allVisibleChecked);
	});

	$popup.on("change", ".nexlify-select-all", function () {
		if (this.checked) {
			visibleValues.forEach((v) => checkedSet.add(v));
		} else {
			visibleValues.forEach((v) => checkedSet.delete(v));
		}
		nexlify_reports.render_popup_list($popup, allValues, checkedSet, inputEl.value);
	});

	$popup.find(".nexlify-filter-clear").on("click", function () {
		checkedSet.clear();
		visibleValues = nexlify_reports.render_popup_list($popup, allValues, checkedSet, inputEl.value);
	});

	const finish = function () {
		$(inputEl).off("input.nexlifypopup");
		nexlify_reports.mark_filter_active(datatable, colIndex, inputEl);
		nexlify_reports.update_filter_summary(datatable, colIndex, inputEl);
		nexlify_reports.close_value_popup();
	};

	$popup.find(".nexlify-filter-cancel").on("click", function () {
		finish();
	});

	$popup.find(".nexlify-filter-ok").on("click", function () {
		const addMode = $popup.find(".nexlify-add-selection").is(":checked");
		let finalSet = checkedSet;
		if (preSearchSet !== null && addMode) {
			finalSet = new Set([...preSearchSet, ...checkedSet]);
		}

		if (finalSet.size === 0 || finalSet.size === allValues.length) {
			delete datatable.__nexlify_value_filters[colIndex];
		} else {
			datatable.__nexlify_value_filters[colIndex] = new Set(finalSet);
		}
		nexlify_reports.trigger_refilter(datatable);
		finish();
	});

	$popup.on("click", function (e) {
		e.stopPropagation();
	});

	const scrollEl = $(datatable.wrapper).find(".dt-scrollable")[0];
	const closeOnScroll = function (e) {
		if (e && e.target && $popup.get(0).contains(e.target)) return;
		finish();
	};
	if (scrollEl) {
		scrollEl.addEventListener("scroll", closeOnScroll, { once: true });
	}
	window.addEventListener("scroll", closeOnScroll, { once: true });

	setTimeout(() => {
		$(document).on("click.nexlify-filter-close", function (e) {
			if (!$(e.target).closest(".nexlify-filter-popup").length && e.target !== inputEl) {
				finish();
			}
		});
	}, 0);
};

nexlify_reports.bind_search_boxes = function (datatable) {
	nexlify_reports.ensure_filter_override(datatable);

	const $wrapper = $(datatable.wrapper);

	$wrapper.find(".dt-filter").each(function () {
		if ($(this).data("nexlify-bound")) return;
		$(this).data("nexlify-bound", true);

		const colIndex = this.dataset.colIndex;

		$(this).on("focus", function () {
			nexlify_reports.open_value_popup(datatable, colIndex, this);
		});

		nexlify_reports.mark_filter_active(datatable, colIndex, this);
		nexlify_reports.update_filter_summary(datatable, colIndex, this);
	});
};

// ============================================================
// Safety net: catch any .datatable element that, for whatever reason,
// didn't go through observe_datatable() via the constructor hook above
// (e.g. an instance created before the hook installed, or a bundle
// context we haven't accounted for). This does NOT duplicate any width
// math - it only calls the exact same fit_columns/ensure_floating_toolbar
// functions used everywhere else, just from a different trigger.
// ============================================================

nexlify_reports.ensure_table_covered = function (wrapperEl) {
	if (wrapperEl.__nexlify_persist_key) return; // already handled by observe_datatable

	const isReportOrList =
		(frappe.query_report && frappe.query_report.datatable
			&& $(frappe.query_report.datatable.wrapper).find(".datatable")[0] === wrapperEl) ||
		(window.cur_list && cur_list.datatable
			&& $(cur_list.datatable.wrapper).find(".datatable")[0] === wrapperEl);

	if (isReportOrList) return; // these are covered by watch_and_bind's polling instead

	if (!wrapperEl.__nexlify_toolbar_added) {
		nexlify_reports.ensure_floating_toolbar(wrapperEl);
	}

	nexlify_reports.watch_container_resize(wrapperEl);

	const key = nexlify_reports.get_report_base_key() + ":dom-fallback:v7";
	wrapperEl.__nexlify_persist_key = key;

	const saved = nexlify_reports.load_widths(key);
	if (saved) {
		nexlify_reports.apply_saved_widths(wrapperEl, saved);
	} else {
		nexlify_reports.fit_columns(wrapperEl, { persistKey: key });
	}
};

nexlify_reports.watch_uncovered_tables = function () {
	if (window.__nexlify_fallback_watcher_started) return;
	window.__nexlify_fallback_watcher_started = true;

	const timers = new WeakMap();

	const process_wrapper = (wrapperEl) => {
		if (nexlifyResizing) return;
		if (wrapperEl.__nexlify_persist_key) {
			// Already covered - still keep negative/zero formatting fresh
			// on scroll-recycled rows, cheaply.
			nexlify_reports.highlight_negative_numbers_dom(wrapperEl);
			return;
		}

		const rowCount = wrapperEl.querySelectorAll(".dt-row[data-row-index]").length;
		if (rowCount < 1) return;

		clearTimeout(timers.get(wrapperEl));
		const t = setTimeout(() => {
			nexlify_reports.ensure_table_covered(wrapperEl);
		}, 200);
		timers.set(wrapperEl, t);
	};

	let bodyRafScheduled = false;
	let pendingTargets = new Set();

	const bodyObserver = new MutationObserver((mutations) => {
		mutations.forEach((m) => {
			const el = m.target.nodeType === 1 ? m.target : m.target.parentElement;
			if (!el) return;
			const wrapperEl = el.closest ? el.closest(".datatable") : null;
			if (wrapperEl) pendingTargets.add(wrapperEl);
		});

		if (!pendingTargets.size || bodyRafScheduled) return;
		bodyRafScheduled = true;

		requestAnimationFrame(() => {
			bodyRafScheduled = false;
			const targets = Array.from(pendingTargets);
			pendingTargets = new Set();
			targets.forEach(process_wrapper);
		});
	});

	bodyObserver.observe(document.body, { childList: true, subtree: true });
};

$(document).ready(function () {
	nexlify_reports.hook_datatable_constructor();
	nexlify_reports.watch_and_bind();
	nexlify_reports.watch_uncovered_tables();
});