frappe.provide("nexlify_reports");

// ============================================================
// Kill-switch: Nexlify Reports Settings.enabled (Single DocType)
// ============================================================
// boot_session injects frappe.boot.nexlify_reports_enabled (0/1).
// Missing key => enabled (fail-open for fresh installs).
if (frappe.boot && frappe.boot.nexlify_reports_enabled === 0) {
	// Fully stand down: strip our stylesheet so visuals switch off too.
	try {
		document.querySelectorAll('link[rel="stylesheet"][href*="/assets/nexlify_reports/css/"]').forEach(function (l) {
			l.disabled = true;
			if (l.parentNode) l.parentNode.removeChild(l);
		});
	} catch (e) {}
} else {

// Enable the layout fixes but keep them non-intrusive: column widths are
// measured once per report and applied as stable CSS rules, so they do NOT
// reflow while the user scrolls. The only case that re-measures is an
// explicit "Autofit"/"Reset" click (or a column-set change).
nexlify_reports.ENABLE_AUTO_LAYOUT_FIXES = true;

// ============================================================
// Constants
// ============================================================

const NEXLIFY_CACHE_VERSION = "v9"; // bump this if the persisted width schema changes

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

// ============================================================
// Content width calculation (smarter minimums for headers)
// ============================================================
// NOTE: single pass over `.dt-cell[data-col-index]` instead of two
// separate `.find()` calls per column (one for header, one for body).
// For an N-column table this turns ~2N DOM queries into 1.

nexlify_reports.compute_content_widths = function (wrapperEl) {
	const $wrapper = $(wrapperEl);
	const $cells = $wrapper.find(".dt-cell[data-col-index]");
	if (!$cells.length) return null;

	let sampleContent = $wrapper.find(".dt-row:not(.dt-row-header) .dt-cell__content").get(0)
		|| $wrapper.find(".dt-cell__content").get(0);

	let font = "12px sans-serif";
	if (sampleContent) {
		const cs = getComputedStyle(sampleContent);
		font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
	}

	const headerSample = $wrapper.find(".dt-row-header .dt-cell__content").get(0);
	let headerFont = font;
	if (headerSample) {
		const hcs = getComputedStyle(headerSample);
		headerFont = `${hcs.fontWeight} ${hcs.fontSize} ${hcs.fontFamily}`;
	}

	const widths = {};

	$cells.each(function () {
		const colIndex = this.getAttribute("data-col-index");
		const contentEl = this.querySelector(".dt-cell__content");
		if (!contentEl) return;

		if (!(colIndex in widths)) widths[colIndex] = 60; // minimum comfortable width

		const isHeader = !!this.closest(".dt-row-header");
		const text = contentEl.getAttribute("title") || contentEl.textContent || "";
		const w = nexlify_reports.measure_text_width(text.trim(), isHeader ? headerFont : font);

		if (w > widths[colIndex]) widths[colIndex] = w;
	});

	Object.keys(widths).forEach((colIndex) => {
		// padding + sort/filter icons
		widths[colIndex] = Math.ceil(widths[colIndex] + 36);
	});

	return widths;
};

// ============================================================
// Persistence
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
	return nexlify_reports.get_report_base_key() + ":" + nexlify_reports.get_column_signature(datatable) + ":" + NEXLIFY_CACHE_VERSION;
};

nexlify_reports.save_widths = function (key, widths) {
	try {
		localStorage.setItem("nexlify_col_widths:" + key, JSON.stringify(widths));
	} catch (e) {
		console.warn("[Nexlify] Failed to save column widths:", e);
	}
};

nexlify_reports.load_widths = function (key) {
	try {
		const raw = localStorage.getItem("nexlify_col_widths:" + key);
		return raw ? JSON.parse(raw) : null;
	} catch (e) {
		console.warn("[Nexlify] Failed to load column widths:", e);
		return null;
	}
};

// ============================================================
// Cell formatting
// ============================================================
// Numeric parsing best-effort: handles both "1,234.56" (comma = thousands)
// and "1.234,56" (comma = decimal, dot = thousands) locale styles.

nexlify_reports.normalize_numeric_string = function (rawText) {
	let t = (rawText || "").trim().replace(/[A-Za-z\s]/g, "");
	const hasComma = t.indexOf(",") !== -1;
	const hasDot = t.indexOf(".") !== -1;

	if (hasComma && hasDot) {
		// whichever separator appears last is the decimal separator
		const lastComma = t.lastIndexOf(",");
		const lastDot = t.lastIndexOf(".");
		if (lastComma > lastDot) {
			// comma is decimal → strip dots (thousands), replace comma with dot
			t = t.replace(/\./g, "").replace(",", ".");
		} else {
			// dot is decimal → strip commas (thousands)
			t = t.replace(/,/g, "");
		}
	} else if (hasComma) {
		// only comma present: treat as decimal separator if followed by 1-2 digits
		// at the end, otherwise treat as thousands grouping
		if (/,\d{1,2}$/.test(t)) {
			t = t.replace(",", ".");
		} else {
			t = t.replace(/,/g, "");
		}
	}
	return t;
};

nexlify_reports.is_zero_value = function (text) {
	const t = (text || "").trim();
	if (!t || t === "-") return true;
	const cleaned = nexlify_reports.normalize_numeric_string(t);
	const num = parseFloat(cleaned);
	return !isNaN(num) && num === 0;
};

nexlify_reports.is_negative_value = function (text) {
	const t = (text || "").trim();
	if (!t) return false;
	// accounting format (123.45)
	if (/^\([\d.,\s]+\)$/.test(t.replace(/[A-Za-z]/g, ""))) return true;
	const cleaned = nexlify_reports.normalize_numeric_string(t);
	if (cleaned.startsWith("-")) {
		const num = parseFloat(cleaned);
		return !isNaN(num) && num < 0;
	}
	return false;
};

nexlify_reports.apply_zero_dash = function (wrapperEl) {
	$(wrapperEl)
		.find(".dt-row[data-row-index] .dt-cell__content")
		.each(function () {
			const original = this.getAttribute("title") || this.textContent || "";
			if (nexlify_reports.is_zero_value(original)) {
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
			$(this).toggleClass("nexlify-negative", nexlify_reports.is_negative_value(text));
		});
	nexlify_reports.apply_zero_dash(wrapperEl);
};

// Coalesces repeated highlight requests (e.g. many mutation records fired
// during virtual-scroll row swapping) into a single rAF-scheduled pass per
// wrapper, instead of running the full DOM sweep once per mutation.
nexlify_reports._highlight_scheduled = new WeakSet();

nexlify_reports.schedule_highlight = function (wrapperEl) {
	if (nexlify_reports._highlight_scheduled.has(wrapperEl)) return;
	nexlify_reports._highlight_scheduled.add(wrapperEl);
	requestAnimationFrame(() => {
		nexlify_reports._highlight_scheduled.delete(wrapperEl);
		nexlify_reports.highlight_negative_numbers_dom(wrapperEl);
	});
};

// ============================================================
// Smart stretch – never force expand
// ============================================================

nexlify_reports.stretch_widths_to_fill = function (wrapperEl, widths) {
	// no forced stretching and no forced shrinking:
	// wide tables stay wide and scroll horizontally instead
	return widths;
};

// ============================================================
// Detect big resolution / window change → invalidate cache
// ============================================================

nexlify_reports.check_and_invalidate_on_resize = function (wrapperEl) {
	const scrollable = wrapperEl.querySelector(".dt-scrollable") || wrapperEl;
	const currentWidth = scrollable.clientWidth || scrollable.getBoundingClientRect().width;
	if (!(currentWidth > 0)) return;

	const lastWidth = wrapperEl.__nexlify_last_container_width;

	// NOTE: We deliberately do NOT re-measure/refit column widths when the
	// container resizes. That observed re-measure on a >18% width swing was
	// the source of the "table reflows while the user scrolls" jitter.
	// Widths stay stable exactly as they were measured; the user can trigger
	// a fresh measure via the "Autofit" button if they truly want one.
	// (Win-dow size changes simply update our bookkeeping, nothing else.)

	wrapperEl.__nexlify_last_container_width = currentWidth;
};

// ============================================================
// Resize observer
// ============================================================

nexlify_reports.watch_container_resize = function (wrapperEl) {
	if (wrapperEl.__nexlify_resize_watched) return;
	wrapperEl.__nexlify_resize_watched = true;

	if (!window.ResizeObserver) return;

	const measureEl = wrapperEl.querySelector(".dt-scrollable") || wrapperEl.parentElement || wrapperEl;

	setTimeout(() => {
		let resizeTimer = null;
		let lastWidth = measureEl.clientWidth || measureEl.getBoundingClientRect().width;
		wrapperEl.__nexlify_last_container_width = lastWidth;

		const ro = new ResizeObserver((entries) => {
			if (nexlifyResizing) return;
			const newWidth = entries[0].contentRect.width;
			if (newWidth <= 0) return;
			if (Math.abs(newWidth - lastWidth) < 3) return;
			lastWidth = newWidth;

			clearTimeout(resizeTimer);
			resizeTimer = setTimeout(() => {
				nexlify_reports.check_and_invalidate_on_resize(wrapperEl);
				nexlify_reports.sync_widths_from_header(wrapperEl);
			}, 180);
		});
		ro.observe(measureEl);
		wrapperEl.__nexlify_ro = ro;
	}, 600);
};

// ============================================================
// Core fit / apply
// ============================================================

nexlify_reports.fit_columns = function (wrapperEl, opts) {
	opts = opts || {};
	const widths = nexlify_reports.compute_content_widths(wrapperEl);
	if (!widths) return;

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

nexlify_reports.autofit_columns_dom = function (wrapperEl) {
	nexlify_reports.fit_columns(wrapperEl, {
		persistKey: wrapperEl.__nexlify_persist_key || null
	});
};

// ============================================================
// Floating toolbar
// ============================================================

nexlify_reports.ensure_floating_toolbar = function (wrapperEl) {
	if (wrapperEl.__nexlify_toolbar_added) return;
	wrapperEl.__nexlify_toolbar_added = true;

	const $bar = $(
		'<div class="nexlify-floating-toolbar">' +
			'<button type="button" class="btn btn-xs btn-default nexlify-floating-autofit" title="' + __("Autofit columns") + '" aria-label="' + __("Autofit columns") + '">' + __("Autofit") + '</button>' +
			'<button type="button" class="btn btn-xs btn-default nexlify-floating-reset" title="' + __("Reset columns to default") + '" aria-label="' + __("Reset columns to default") + '">' + __("Reset columns") + '</button>' +
		'</div>'
	);

	$bar.find(".nexlify-floating-autofit").on("click", function () {
		nexlify_reports.fit_columns(wrapperEl, {
			persistKey: wrapperEl.__nexlify_persist_key || null
		});
	});

	$bar.find(".nexlify-floating-reset").on("click", function () {
		const ic = nexlify_reports.get_instance_class(wrapperEl);
		if (ic) {
			const s = document.getElementById("nexlify-autofit-style-" + ic);
			if (s) s.remove();
		}
		if (wrapperEl.__nexlify_persist_key) {
			try {
				localStorage.removeItem("nexlify_col_widths:" + wrapperEl.__nexlify_persist_key);
			} catch (e) {
				console.warn("[Nexlify] Failed to clear cached widths:", e);
			}
		}
		nexlify_reports.fit_columns(wrapperEl, {
			persistKey: wrapperEl.__nexlify_persist_key || null
		});
	});

	$(wrapperEl).before($bar);
};

// ============================================================
// Page-level buttons
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
					try {
						localStorage.removeItem("nexlify_col_widths:" + key);
					} catch (e) {
						console.warn("[Nexlify] Failed to clear cached widths:", e);
					}
					nexlify_reports.fit_columns(wrapperEl, { persistKey: key });
					frappe.show_alert({ message: __("Columns reset to default"), indicator: "green" });
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
// Observe datatable
// ============================================================

nexlify_reports.observe_datatable = function (datatable) {
	if (!datatable || datatable.__nexlify_observed) return;
	datatable.__nexlify_observed = true;

	const wrapperEl = $(datatable.wrapper).find(".datatable")[0];
	if (!wrapperEl) return;

	// mark the element itself (not just the datatable object) so the
	// body-level fallback observer can recognize it's already covered
	wrapperEl.__nexlify_observed = true;
	nexlify_reports._tracked_wrappers.add(wrapperEl);

	const isReportOrList =
		(frappe.query_report && frappe.query_report.datatable === datatable) ||
		(window.cur_list && cur_list.datatable === datatable);

	if (!isReportOrList) {
		nexlify_reports.ensure_floating_toolbar(wrapperEl);
	}

	nexlify_reports.watch_container_resize(wrapperEl);

	setTimeout(() => {
		nexlify_reports.apply_saved_or_autofit(datatable, wrapperEl);
	}, 150);

	const bodyEl = $(datatable.wrapper).find(".dt-scrollable")[0];
	if (!bodyEl) return;

	let sawEmpty = false;
	let rafPending = false;

	const observer = new MutationObserver((mutations) => {
		// debug: collect mutation metadata when enabled
		if (nexlify_reports._debug_enabled) {
			try {
				const now = Date.now();
				const entry = {
					ts: now,
					mutations: mutations.length,
					types: mutations.reduce((acc, m) => {
						acc[m.type] = (acc[m.type] || 0) + 1; return acc;
					}, {}),
					rowCount: $(datatable.wrapper).find(".dt-row[data-row-index]").length
				};
				try {
					const key = 'nexlify_reports_debug';
					const raw = localStorage.getItem(key);
					const arr = raw ? JSON.parse(raw) : [];
					arr.push(entry);
					if (arr.length > 200) arr.shift();
					localStorage.setItem(key, JSON.stringify(arr));
				} catch (e) {
					console.warn('nexlify_reports: failed to persist debug entry', e);
				}
				console.info('[nexlify debug] mutations=', mutations.length, 'rowCount=', entry.rowCount, entry.types);
			} catch (e) {
				console.warn('nexlify_reports: debug observer threw', e);
			}
		}

		if (rafPending) return;
		rafPending = true;

		requestAnimationFrame(() => {
			rafPending = false;

			const rowCount = $(datatable.wrapper).find(".dt-row[data-row-index]").length;

			// Virtual scroll constantly swaps rows while the user scrolls, firing
			// this observer many times. Re-fitting (or sweeping every cell) per
			// swap is exactly what caused the jitter on large reports.
			//
			// 1) Highlight negative/zero cells only ONCE, on the first real data
			//    fill (empty -> full), not on every subsequent row swap.
			// 2) Never refit from here: saved widths stay stable for the row's
			//    lifetime; a manual "Autofit"/"Reset" is the only re-measure.
			//
			if (rowCount <= 1) {
				sawEmpty = true; // still empty -> wait for the first real fill
				return;
			}

			if (sawEmpty) {
				sawEmpty = false;
				nexlify_reports.highlight_negative_numbers_dom(wrapperEl);
				// First fill handled. Widths are stable CSS rules and cell
				// styling is applied at render time through the format
				// wrapper, so this observer has nothing left to do.
				// Disconnect it so fast scrolling never pays per-frame
				// observer/mutation overhead again.
				if (wrapperEl.__nexlify_mo) {
					try { wrapperEl.__nexlify_mo.disconnect(); } catch (e) {}
					wrapperEl.__nexlify_mo = null;
				}
			}
		});
	});

	// observe mutations (basic)
	observer.observe(bodyEl, { childList: true, subtree: true });

	wrapperEl.__nexlify_mo = observer;
};

// ============================================================
// Polling + cleanup
// ============================================================

nexlify_reports.watch_and_bind = function () {
	if (!nexlify_reports.ENABLE_AUTO_LAYOUT_FIXES) return;
	setInterval(() => {
		if (frappe.query_report && frappe.query_report.datatable) {
			nexlify_reports.observe_datatable(frappe.query_report.datatable);
		}
		if (window.cur_list && cur_list.datatable) {
			nexlify_reports.observe_datatable(cur_list.datatable);
		}
		nexlify_reports.sweep_toolbars();
		nexlify_reports.setup_report();
	}, 1200);
	// NOTE: this interval keeps running for the lifetime of the page even
	// when no report/list is present. The checks above are cheap, but a
	// fuller fix would hook frappe's own render-complete/page-change
	// events instead of polling. Left as-is here since that requires
	// confirming which events are reliably fired across report/list/dialog
	// contexts in your frappe version.
};

nexlify_reports.cleanup_orphaned_styles = function () {
	document.querySelectorAll("style[id^='nexlify-autofit-style-']").forEach((styleEl) => {
		const id = styleEl.id.replace("nexlify-autofit-style-", "");
		if (!document.querySelector("." + id)) {
			styleEl.remove();
		}
	});
};

// Disconnects ResizeObserver/MutationObserver instances for wrapper
// elements that have been removed from the DOM (e.g. after navigating
// away from a report), so they don't keep firing/leaking memory.
nexlify_reports._tracked_wrappers = new Set();

nexlify_reports.cleanup_detached_observers = function () {
	nexlify_reports._tracked_wrappers.forEach((wrapperEl) => {
		if (!document.body.contains(wrapperEl)) {
			if (wrapperEl.__nexlify_ro) {
				try {
					wrapperEl.__nexlify_ro.disconnect();
				} catch (e) {
					console.warn("[Nexlify] Failed to disconnect ResizeObserver:", e);
				}
			}
			if (wrapperEl.__nexlify_mo) {
				try {
					wrapperEl.__nexlify_mo.disconnect();
				} catch (e) {
					console.warn("[Nexlify] Failed to disconnect MutationObserver:", e);
				}
			}
			nexlify_reports._tracked_wrappers.delete(wrapperEl);
		}
	});
};

$(document).on("page-change", function () {
	frappe.after_ajax(() => {
		setTimeout(nexlify_reports.setup_report, 300);
		nexlify_reports.cleanup_orphaned_styles();
		nexlify_reports.cleanup_detached_observers();
	});
});

// ============================================================
// DataTable constructor hook
// ============================================================

nexlify_reports.hook_datatable_constructor = function () {
	if (!nexlify_reports.ENABLE_AUTO_LAYOUT_FIXES) return;
	if (window.__nexlify_datatable_hooked) return;
	window.__nexlify_datatable_hooked = true;

	let patchedConstructor = window.DataTable;

	const wrap_datatable_class = function (OriginalDataTable) {
		if (!OriginalDataTable || OriginalDataTable.__nexlify_wrapped) {
			return OriginalDataTable;
		}

		// Helper: wrap columns formats in-place (idempotent)
		function wrapColumnsFormats(cols) {
			if (!Array.isArray(cols)) return;
			cols.forEach(col => {
				if (!col || typeof col === 'string') return; // ignore shorthand or falsy
				if (col.__nexlify_format_wrapped) return;

				const origFmt = typeof col.format === 'function' ? col.format : null;

				col.format = function (value, row, column, data) {
					// coerce to string for trim/inspect helpers
					const raw = value === null || value === undefined ? "" : String(value);

					let formatted;
					try {
						formatted = origFmt ? origFmt.call(this, value, row, column, data) : value;
					} catch (e) {
						console.warn('nexlify_reports: original column.format threw', e);
						formatted = value;
					}

					let isZero = false;
					let isNeg = false;
					try {
						if (window && window.nexlify_reports && typeof window.nexlify_reports.is_zero_value === 'function') {
							isZero = !!window.nexlify_reports.is_zero_value(raw);
						}
					} catch (e) {
						console.warn('nexlify_reports: is_zero_value threw', e);
					}
					try {
						if (window && window.nexlify_reports && typeof window.nexlify_reports.is_negative_value === 'function') {
							isNeg = !!window.nexlify_reports.is_negative_value(raw);
						}
					} catch (e) {
						console.warn('nexlify_reports: is_negative_value threw', e);
					}

					if (isZero) return '-';

					// The formatted value from a Report column is already HTML
				// (e.g. `<div style="text-align: right">SAR -40,404.00</div>`). We
				// sanitize it (keep layout markup, drop executable/event markup)
				// and wrap it with the negative class — escaping the whole value
				// here would print the raw `<div>` text into the cell instead of
				// rendering it. Sanitize (not escape) is what keeps the display
				// correct while still blocking active content like script/on*.
				if (isNeg) return `<span class="nexlify-negative">${nexlify_reports.sanitize_html(formatted)}</span>`;
					return formatted;
				};

				col.__nexlify_format_wrapped = true;
			});
		}

		// Patch refresh on prototype once so future refresh(data, columns) calls get wrapped
		if (!OriginalDataTable.__nexlify_refresh_patched) {
			OriginalDataTable.__nexlify_refresh_patched = true;
			const origRefresh = OriginalDataTable.prototype.refresh;
			OriginalDataTable.prototype.refresh = function (data, columns) {
				try {
					if (Array.isArray(columns)) {
						wrapColumnsFormats(columns);
					} else if (this && this.options && Array.isArray(this.options.columns)) {
						wrapColumnsFormats(this.options.columns);
					}
				} catch (e) {
					console.warn('nexlify_reports: error wrapping columns on refresh', e);
				}
				return origRefresh.call(this, data, columns);
			};
		}

		const Wrapped = function (wrapper, options) {
			options = options || {};
			options.layout = "fixed";

			// Wrap initial options.columns before constructing the datatable
			try {
				wrapColumnsFormats(options.columns);
			} catch (e) {
				console.warn('nexlify_reports: error wrapping initial options.columns', e);
			}

			const instance = new OriginalDataTable(wrapper, options);

			// Re-attach per-instance setup so EVERY datatable gets covered:
			// Report View, List View, dialog grids (the Action popup),
			// Bank Reconciliation, etc. observe_datatable is idempotent
			// (guarded by __nexlify_observed) and it re-installs the
			// floating Autofit / Reset toolbar outside Report & List views.
			setTimeout(() => {
				try {
					if (window.nexlify_reports && typeof window.nexlify_reports.observe_datatable === 'function') {
						window.nexlify_reports.observe_datatable(instance);
					}
				} catch (e) {
					console.error('nexlify_reports.observe_datatable error', e);
				}
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
// Resize + double-click passthrough
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

	$(".datatable").each(function () {
		nexlify_reports.sync_widths_from_header(this);
	});
});

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
// Excel-style value filter
// ============================================================

nexlify_reports.esc_html = function (text) {
	return $("<div>").text(text).html();
};

// Renders a value that is ALREADY an HTML string (as produced by an original
// Report column.format, e.g. `<div style="text-align: right">SAR -40,404.00</div>`)
// safely: it KEEPS benign layout markup (div/span/style/tables/bold/etc.) so the
// report reads as Frappe intended, but removes anything that could execute or
// leak: script/iframe/object/embed/link/meta tags, all on* event attributes and
// javascript: URLs. This is the correct choice for the negative-number branch,
// where blindly escaping the whole value made the `<div>` show up as raw text.
nexlify_reports.sanitize_html = function (html) {
	if (html === null || html === undefined) return "";
	return String(html)
		.replace(/<\s*(script|iframe|object|embed|meta|link|style)[^>]*>/gi, "")
		.replace(/<\s*\/\s*(script|iframe|object|embed|meta|link)\s*>/gi, "")
		.replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
		.replace(/(\s*href\s*=\s*|src\s*=\s*)("|'|)\s*javascript:[^"'>]*("|'|)(?=\s|>)/gi, "")
		.replace(/<\s*\/?\s*style\s*>/gi, ""); // discard embedded <style> blocks too
};


// ============================================================
// Safety net
// ============================================================

nexlify_reports.ensure_table_covered = function (wrapperEl) {
	if (wrapperEl.__nexlify_persist_key) return;

	const isReportOrList =
		(frappe.query_report && frappe.query_report.datatable
			&& $(frappe.query_report.datatable.wrapper).find(".datatable")[0] === wrapperEl) ||
		(window.cur_list && cur_list.datatable
			&& $(cur_list.datatable.wrapper).find(".datatable")[0] === wrapperEl);

	if (isReportOrList) return;

	if (!wrapperEl.__nexlify_toolbar_added) {
		nexlify_reports.ensure_floating_toolbar(wrapperEl);
	}

	nexlify_reports.watch_container_resize(wrapperEl);
	nexlify_reports._tracked_wrappers.add(wrapperEl);

	const key = nexlify_reports.get_report_base_key() + ":dom-fallback:" + NEXLIFY_CACHE_VERSION;
	wrapperEl.__nexlify_persist_key = key;

	const saved = nexlify_reports.load_widths(key);
	if (saved) {
		nexlify_reports.apply_saved_widths(wrapperEl, saved);
	} else {
		nexlify_reports.fit_columns(wrapperEl, { persistKey: key });
	}
};

nexlify_reports.sweep_toolbars = function () {
	// Cheap safety net replacing the old document.body MutationObserver.
	// One bounded query per poll tick (1.2s) covers datatables that were
	// NOT constructed through the window.DataTable hook (bundles that
	// import DataTable directly - e.g. Bank Reconciliation and the
	// Action dialog grid), giving them the floating Autofit / Reset
	// toolbar and width handling with zero per-scroll-frame cost.
	var tables = document.querySelectorAll(".datatable");
	for (var i = 0; i < tables.length; i++) {
		var el = tables[i];
		// NOTE: class is dt-instance-N (numbered), so filter by regex
		// instead of a .dt-instance selector which can never match.
		if (!nexlify_reports.get_instance_class(el)) continue;
		if (el.__nexlify_observed) continue;
		if (el.querySelector(".nexlify-floating-toolbar")) continue;
		if (!el.querySelector(".dt-row[data-row-index]")) continue;
		nexlify_reports.ensure_table_covered(el);
	}
};

nexlify_reports.init_scroll_hover_suppression = function () {
	// Rows sliding under a stationary cursor retrigger :hover every frame
	// during fast scrolling - a real micro-jank source. While scrolling we
	// add body.nexlify-is-scrolling which disables the hover rule (see
	// CSS), restoring it 150ms after scrolling stops.
	if (window.__nexlify_scroll_hover_wired) return;
	window.__nexlify_scroll_hover_wired = true;
	var t = null;
	document.addEventListener(
		"scroll",
		function (e) {
			var el = e.target;
			if (!(el && el.classList && el.classList.contains("dt-scrollable"))) return;
			document.body.classList.add("nexlify-is-scrolling");
			clearTimeout(t);
			t = setTimeout(function () {
				document.body.classList.remove("nexlify-is-scrolling");
			}, 150);
		},
		{ capture: true, passive: true }
	);
};

// ============================================================
// Boot
// ============================================================

// Debug helpers: enable to collect mutation/charData logs into localStorage under key 'nexlify_reports_debug'
// Usage from Console: nexlify_reports._debug_enabled = true; // to enable
// After reproducing: nexlify_reports.dump_debug_logs(); // prints logs
// Clear: nexlify_reports.clear_debug_logs();

nexlify_reports._debug_enabled = false;

nexlify_reports.dump_debug_logs = function () {
	try {
		const raw = localStorage.getItem('nexlify_reports_debug');
		const arr = raw ? JSON.parse(raw) : [];
		console.log('nexlify_reports debug log entries:', arr.length);
		console.table(arr.slice(-50));
		return arr;
	} catch (e) {
		console.warn('nexlify_reports: failed to dump debug logs', e);
		return null;
	}
};

nexlify_reports.clear_debug_logs = function () {
	try {
		localStorage.removeItem('nexlify_reports_debug');
		console.info('nexlify_reports: debug logs cleared');
	} catch (e) {
		console.warn('nexlify_reports: failed to clear debug logs', e);
	}
};

$(document).ready(function () {
	nexlify_reports.hook_datatable_constructor();
	nexlify_reports.init_scroll_hover_suppression();
	nexlify_reports.watch_and_bind();
});
}
