frappe.provide("nexlify_reports");

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

	if (lastWidth && Math.abs(currentWidth - lastWidth) / lastWidth > 0.18) {
		// Significant change (>18%) → clear saved widths and re-fit
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
	}

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
			'<button type="button" class="btn btn-xs btn-default nexlify-floating-autofit">' + __("Autofit") + '</button>' +
			'<button type="button" class="btn btn-xs btn-default nexlify-floating-reset">' + __("Reset columns") + '</button>' +
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

	let debounceTimer = null;
	let sawEmpty = false;
	let rafPending = false;

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

			// throttled/coalesced pass instead of a synchronous full sweep
			// on every mutation batch (virtual scroll can fire many of these)
			nexlify_reports.schedule_highlight(wrapperEl);

			const currentSignature = nexlify_reports.get_column_signature(datatable);
			const columnsChanged =
				datatable.__nexlify_last_signature !== undefined &&
				currentSignature !== datatable.__nexlify_last_signature;

			if (!sawEmpty && !columnsChanged) return;

			clearTimeout(debounceTimer);
			debounceTimer = setTimeout(() => {
				sawEmpty = false;
				nexlify_reports.apply_saved_or_autofit(datatable, wrapperEl);
			}, 250);
		});
	});

	observer.observe(bodyEl, { childList: true, subtree: true });
	wrapperEl.__nexlify_mo = observer;
};

// ============================================================
// Polling + cleanup
// ============================================================

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
		nexlify_reports.close_value_popup();
		nexlify_reports.cleanup_orphaned_styles();
		nexlify_reports.cleanup_detached_observers();
	});
});

// ============================================================
// DataTable constructor hook
// ============================================================

nexlify_reports.hook_datatable_constructor = function () {
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
					if (isNeg) return `<span class="nexlify-negative">${formatted}</span>`;
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

			// preserve deferred setup (observe_datatable + bind_search_boxes)
			setTimeout(() => {
				try {
					if (window.nexlify_reports && typeof window.nexlify_reports.observe_datatable === 'function') {
						window.nexlify_reports.observe_datatable(instance);
					}
				} catch (e) {
					console.error('nexlify_reports.observe_datatable error', e);
				}
				try {
					if (window.nexlify_reports && typeof window.nexlify_reports.bind_search_boxes === 'function') {
						window.nexlify_reports.bind_search_boxes(instance);
					}
				} catch (e) {
					console.error('nexlify_reports.bind_search_boxes error', e);
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
	const isRTL =
		(document.documentElement.dir || "").toLowerCase() === "rtl" ||
		(document.body.dir || "").toLowerCase() === "rtl";

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
	let leftPos = isRTL ? rect.right - popupWidth : rect.left;
	const maxLeft = window.innerWidth - popupWidth - 8;
	if (leftPos > maxLeft) leftPos = Math.max(maxLeft, 8);
	if (leftPos < 8) leftPos = 8;

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

nexlify_reports.watch_uncovered_tables = function () {
	if (window.__nexlify_fallback_watcher_started) return;
	window.__nexlify_fallback_watcher_started = true;

	const timers = new WeakMap();

	const process_wrapper = (wrapperEl) => {
		if (nexlifyResizing) return;

		// already covered by its own dedicated MutationObserver/ResizeObserver
		// (set in observe_datatable) — skip to avoid doing the same DOM sweep
		// twice per scroll/mutation tick.
		if (wrapperEl.__nexlify_observed) return;

		if (wrapperEl.__nexlify_persist_key) {
			nexlify_reports.schedule_highlight(wrapperEl);
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

// ============================================================
// Boot
// ============================================================

$(document).ready(function () {
	nexlify_reports.hook_datatable_constructor();
	nexlify_reports.watch_and_bind();
	nexlify_reports.watch_uncovered_tables();
});