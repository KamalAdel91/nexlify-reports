frappe.provide("nexlify_reports");

nexlify_reports.measure_text_width = function (text, font) {
	nexlify_reports._canvas = nexlify_reports._canvas || document.createElement("canvas");
	const context = nexlify_reports._canvas.getContext("2d");
	context.font = font;
	return context.measureText(text || "").width;
};

nexlify_reports.get_report_base_key = function () {
	if (frappe.query_report && frappe.query_report.report_name) {
		return "query_report:" + frappe.query_report.report_name;
	}
	if (cur_list && cur_list.doctype) {
		return "list_report:" + cur_list.doctype;
	}
	return "unknown";
};

nexlify_reports.get_column_signature = function (datatable) {
	const columns = datatable.datamanager.getColumns();
	return columns.map((c) => c.id || c.name || "").join("|");
};

nexlify_reports.get_report_key = function (datatable) {
	return nexlify_reports.get_report_base_key() + ":" + nexlify_reports.get_column_signature(datatable);
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

nexlify_reports.highlight_negative_numbers = function (datatable) {
	const $wrapper = $(datatable.wrapper);
	$wrapper.find(".dt-row:not(.dt-row-header) .dt-cell__content").each(function () {
		const text = (this.textContent || "").trim();
		const isNegativeNumber = /^-[\d.,]+$/.test(text.replace(/[A-Za-z]/g, "").trim());
		$(this).toggleClass("nexlify-negative", isNegativeNumber);
	});
};

nexlify_reports.apply_widths = function (datatable, widths) {
	const $wrapper = $(datatable.wrapper);
	Object.keys(widths).forEach((colIndex) => {
		const w = widths[colIndex];
		datatable.columnmanager.setColumnWidth(Number(colIndex), w);
		$wrapper.find(`.dt-cell__content--header-${colIndex}`).css("width", w + "px");
	});
};

nexlify_reports.compute_content_widths = function (datatable) {
	const columns = datatable.datamanager.getColumns();
	const $wrapper = $(datatable.wrapper);

	const sampleCell = $wrapper.find(".dt-cell__content").get(0);
	let font = "12px sans-serif";
	if (sampleCell) {
		const cs = getComputedStyle(sampleCell);
		font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
	}

	const widths = {};

	columns.forEach((col, colIndex) => {
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

nexlify_reports.stretch_to_fill = function (datatable, widths, key, opts) {
	requestAnimationFrame(() => {
		requestAnimationFrame(() => {
			const $wrapper = $(datatable.wrapper);
			const scrollEl = $wrapper.find(".dt-scrollable")[0];
			const headerRowEl = $wrapper.find(".dt-row-header")[0];

			if (!scrollEl || !headerRowEl) {
				if (!opts.skipSave) nexlify_reports.save_widths(key, widths);
				return;
			}

			const containerWidth = scrollEl.getBoundingClientRect().width;
			const renderedWidth = headerRowEl.getBoundingClientRect().width;

			if (renderedWidth > 0 && containerWidth - renderedWidth > 4) {
				const ratio = containerWidth / renderedWidth;
				const scaledWidths = {};
				Object.keys(widths).forEach((colIndex) => {
					scaledWidths[colIndex] = Math.floor(widths[colIndex] * ratio);
				});
				nexlify_reports.apply_widths(datatable, scaledWidths);
				if (!opts.skipSave) nexlify_reports.save_widths(key, scaledWidths);
			} else {
				if (!opts.skipSave) nexlify_reports.save_widths(key, widths);
			}
		});
	});
};

nexlify_reports.autofit_columns = function (datatable, opts) {
	opts = opts || {};
	if (!datatable || !datatable.datamanager) return;

	const key = nexlify_reports.get_report_key(datatable);
	const widths = nexlify_reports.compute_content_widths(datatable);

	nexlify_reports.apply_widths(datatable, widths);

	datatable.__nexlify_last_signature = nexlify_reports.get_column_signature(datatable);
	nexlify_reports.highlight_negative_numbers(datatable);

	nexlify_reports.stretch_to_fill(datatable, widths, key, opts);
};

nexlify_reports.reset_columns = function (datatable) {
	if (!datatable || !datatable.__nexlify_original_widths) return;
	nexlify_reports.apply_widths(datatable, datatable.__nexlify_original_widths);

	const key = nexlify_reports.get_report_key(datatable);
	try {
		localStorage.removeItem("nexlify_col_widths:" + key);
	} catch (e) {}
};

nexlify_reports.capture_original_widths = function (datatable) {
	if (!datatable || datatable.__nexlify_original_widths) return;
	const columns = datatable.datamanager.getColumns();
	const original = {};
	columns.forEach((col, colIndex) => {
		original[colIndex] = col.width || 100;
	});
	datatable.__nexlify_original_widths = original;
};

nexlify_reports.ensure_buttons = function (pageObj, datatableGetter) {
	if (!pageObj || !pageObj.page) return;
	const $toolbar = pageObj.page.inner_toolbar;
	if ($toolbar && $toolbar.find(".nexlify-autofit-btn").length) {
		return;
	}

	pageObj.page
		.add_inner_button(__("Autofit"), () => {
			nexlify_reports.autofit_columns(datatableGetter());
		})
		.addClass("nexlify-autofit-btn");

	pageObj.page
		.add_inner_button(__("Reset columns"), () => {
			nexlify_reports.reset_columns(datatableGetter());
		})
		.addClass("nexlify-reset-btn");
};

nexlify_reports.setup_report = function () {
	if (frappe.query_report && frappe.query_report.page) {
		nexlify_reports.ensure_buttons(frappe.query_report, () => frappe.query_report.datatable);
	}

	if (cur_list && cur_list.datatable && cur_list.page) {
		nexlify_reports.ensure_buttons(cur_list, () => cur_list.datatable);
	}
};

nexlify_reports.apply_saved_or_autofit = function (datatable) {
	const key = nexlify_reports.get_report_key(datatable);
	const saved = nexlify_reports.load_widths(key);

	if (saved) {
		nexlify_reports.apply_widths(datatable, saved);
		datatable.__nexlify_last_signature = nexlify_reports.get_column_signature(datatable);
		nexlify_reports.highlight_negative_numbers(datatable);
	} else {
		nexlify_reports.autofit_columns(datatable);
	}
};

nexlify_reports.observe_datatable = function (datatable) {
	if (!datatable || datatable.__nexlify_observed) return;
	datatable.__nexlify_observed = true;

	nexlify_reports.capture_original_widths(datatable);

	setTimeout(() => {
		nexlify_reports.apply_saved_or_autofit(datatable);
	}, 150);

	const bodyEl = $(datatable.wrapper).find(".dt-scrollable")[0];
	if (!bodyEl) return;

	let debounceTimer = null;
	let sawEmpty = false;

	const observer = new MutationObserver(() => {
		const rowCount = $(datatable.wrapper).find(".dt-row[data-row-index]").length;

		if (rowCount <= 1) {
			sawEmpty = true;
			return;
		}

		const currentSignature = nexlify_reports.get_column_signature(datatable);
		const columnsChanged = datatable.__nexlify_last_signature !== undefined
			&& currentSignature !== datatable.__nexlify_last_signature;

		if (!sawEmpty && !columnsChanged) return;

		clearTimeout(debounceTimer);
		debounceTimer = setTimeout(() => {
			sawEmpty = false;
			nexlify_reports.apply_saved_or_autofit(datatable);
		}, 250);
	});

	observer.observe(bodyEl, { childList: true, subtree: true });
};

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
	let leftPos = rect.left + window.scrollX;
	const maxLeft = window.scrollX + document.documentElement.clientWidth - popupWidth - 8;
	if (leftPos > maxLeft) {
		leftPos = Math.max(maxLeft, 8);
	}

	$popup.css({
		top: rect.bottom + window.scrollY + 2 + "px",
		left: leftPos + "px",
	});

	$("body").append($popup);

	let visibleValues = nexlify_reports.render_popup_list($popup, allValues, checkedSet, inputEl.value);

	$(inputEl).on("input.nexlifypopup", function () {
		const searchText = this.value;

		// Snapshot the selection as it was the moment a search begins, so it
		// can be restored/merged later - never destroyed by typing itself.
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
		// Ignore scrolling that happens inside the popup itself (e.g. the
		// value list's own internal scrollbar) - only close on scrolling
		// of the underlying table/page, which would move the field away
		// from the popup's fixed position.
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

nexlify_reports.watch_and_bind = function () {
	setInterval(() => {
		if (frappe.query_report && frappe.query_report.datatable) {
			nexlify_reports.observe_datatable(frappe.query_report.datatable);
			nexlify_reports.bind_search_boxes(frappe.query_report.datatable);
		}
		if (cur_list && cur_list.datatable) {
			nexlify_reports.observe_datatable(cur_list.datatable);
			nexlify_reports.bind_search_boxes(cur_list.datatable);
		}
		nexlify_reports.setup_report();
	}, 800);
};

$(document).on("page-change", function () {
	frappe.after_ajax(() => {
		setTimeout(nexlify_reports.setup_report, 300);
	});
});

$(document).ready(function () {
	nexlify_reports.watch_and_bind();
});
