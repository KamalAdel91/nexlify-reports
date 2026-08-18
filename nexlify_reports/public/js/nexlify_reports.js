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


nexlify_reports.ZERO_CURRENCY_RE = /^[A-Za-z]{2,5}\s+0(\.0+)?$/;

nexlify_reports.apply_zero_dash = function (wrapperEl) {
	$(wrapperEl)
		.find(".dt-row[data-row-index] .dt-cell__content")
		.each(function () {
			// Always test against the ORIGINAL value (title attribute, set
			// by the library) rather than our own previous replacement, so
			// this stays correct even after recycled rows get new data.
			const original = this.getAttribute("title") || this.textContent || "";
			const isZeroCurrency = nexlify_reports.ZERO_CURRENCY_RE.test(original.trim());
			if (isZeroCurrency) {
				if (this.textContent.trim() !== "-") this.textContent = "-";
			} else if (this.textContent.trim() === "-" && original.trim() !== "-" && original.trim() !== "") {
				// A recycled cell that used to show "-" now holds different,
				// non-zero data - restore its real value.
				this.textContent = original;
			}
		});
};

nexlify_reports.highlight_negative_numbers = function (datatable) {
	const $wrapper = $(datatable.wrapper);
	$wrapper.find(".dt-row:not(.dt-row-header) .dt-cell__content").each(function () {
		const text = (this.textContent || "").trim();
		const isNegativeNumber = /^-[\d.,]+$/.test(text.replace(/[A-Za-z]/g, "").trim());
		$(this).toggleClass("nexlify-negative", isNegativeNumber);
	});
	nexlify_reports.apply_zero_dash(datatable.wrapper);
};

nexlify_reports.apply_widths = function (datatable, widths) {
	const $wrapper = $(datatable.wrapper);
	Object.keys(widths).forEach((colIndex) => {
		const w = widths[colIndex];
		try {
			if (datatable.columnmanager && datatable.columnmanager.setColumnWidth) {
				datatable.columnmanager.setColumnWidth(Number(colIndex), w);
			}
		} catch (e) {}
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
	try {
		var $wrapper = $(pageObj.page.wrapper);
		if ($wrapper.find(".nexlify-autofit-btn").length) return;

		pageObj.page.add_inner_button(__("Autofit"), function () {
			try {
				var dt = datatableGetter();
				if (dt && dt.wrapper) {
					var $dtEl = $(dt.wrapper).find(".datatable"); nexlify_reports.autofit_columns_dom($dtEl[0]);
					frappe.show_alert({message: __("Columns autofitted"), indicator: "green"});
				} else {
					console.warn("[Nexlify] Autofit: no datatable found");
				}
			} catch (e) {
				console.error("[Nexlify] Autofit error:", e);
			}
		}).addClass("nexlify-autofit-btn");

		pageObj.page.add_inner_button(__("Reset Columns"), function () {
			try {
				var dt = datatableGetter();
				if (dt && dt.wrapper) {
					var ic = nexlify_reports.get_instance_class($(dt.wrapper).find(".datatable")[0]);
					if (ic) {
						var s = document.getElementById("nexlify-autofit-style-" + ic);
						if (s) s.remove();
					}
					var key = nexlify_reports.get_report_key(dt);
					try { localStorage.removeItem("nexlify_col_widths:" + key); } catch (e) {}
					frappe.show_alert({message: __("Columns reset to default"), indicator: "green"});
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

	// Every piece of work below (row count, signature check, highlighting)
	// must run at most once per animation frame - not once per raw
	// MutationObserver callback, which can fire many times per frame
	// during fast/virtualized scrolling and was causing visible jank.
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

			nexlify_reports.highlight_negative_numbers(datatable);

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
		nexlify_reports.close_value_popup();
});
});

nexlify_reports.hook_datatable_constructor = function () {
	if (window.__nexlify_datatable_hooked) return;
	window.__nexlify_datatable_hooked = true;

	let patchedConstructor = window.DataTable;

	const wrap_datatable_class = function (OriginalDataTable) {
		if (!OriginalDataTable || OriginalDataTable.__nexlify_wrapped) {
			return OriginalDataTable;
		}
		const Wrapped = function (wrapper, options) {
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
		// re-trigger the setter so a DataTable already assigned
		// before this hook ran gets wrapped too
		window.DataTable = patchedConstructor;
	}
};


nexlify_reports.ensure_floating_toolbar = function (wrapperEl) {
	if (wrapperEl.__nexlify_toolbar_added) return;
	wrapperEl.__nexlify_toolbar_added = true;

	var $bar = $(
		'<div class="nexlify-floating-toolbar">' +
			'<button type="button" class="btn btn-xs btn-default nexlify-floating-autofit">' + __("Autofit") + '</button>' +
			'<button type="button" class="btn btn-xs btn-default nexlify-floating-reset">' + __("Reset columns") + '</button>' +
		'</div>'
	);

	$bar.find(".nexlify-floating-autofit").on("click", function () {
		nexlify_reports.autofit_columns_dom(wrapperEl);
	});

	$bar.find(".nexlify-floating-reset").on("click", function () {
		var ic = nexlify_reports.get_instance_class(wrapperEl);
		if (ic) {
			var s = document.getElementById("nexlify-autofit-style-" + ic);
			if (s) s.remove();
		}
	});

	$(wrapperEl).before($bar);
};

nexlify_reports.get_excluded_datatable_elements = function () {
	const excluded = [];
	if (frappe.query_report && frappe.query_report.datatable && frappe.query_report.datatable.wrapper) {
		const el = $(frappe.query_report.datatable.wrapper).find(".datatable")[0];
		if (el) excluded.push(el);
	}
	if (window.cur_list && cur_list.datatable && cur_list.datatable.wrapper) {
		const el = $(cur_list.datatable.wrapper).find(".datatable")[0];
		if (el) excluded.push(el);
	}
	return excluded;
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

nexlify_reports.autofit_columns_dom = function (wrapperEl) {
	const $wrapper = $(wrapperEl);
	const instanceClass = nexlify_reports.get_instance_class(wrapperEl);
	if (!instanceClass) return;

	const colIndices = new Set();
	$wrapper.find("[data-col-index]").each(function () {
		colIndices.add(this.getAttribute("data-col-index"));
	});
	if (!colIndices.size) return;

	const sampleContent = $wrapper.find(".dt-cell__content").get(0);
	let font = "12px sans-serif";
	if (sampleContent) {
		const cs = getComputedStyle(sampleContent);
		font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
	}

	const computedWidths = {};

	colIndices.forEach((colIndex) => {
		let maxWidth = 40;

		$wrapper.find(`[data-col-index="${colIndex}"] .dt-cell__content`).each(function () {
			const text = this.getAttribute("title") || this.textContent || "";
			const w = nexlify_reports.measure_text_width(text.trim(), font);
			if (w > maxWidth) maxWidth = w;
		});

		computedWidths[colIndex] = maxWidth + 32;
	});

	// Fixed layout means columns never auto-fill the container - if the
	// content-based total is narrower than the available space, stretch
	// every column proportionally so the table always reaches the full
	// width instead of leaving blank space on the side. Never shrink
	// below the computed content-based width.
	const scrollEl = $wrapper.find(".dt-scrollable")[0];
	const totalComputed = Object.values(computedWidths).reduce((a, b) => a + b, 0);
	const containerWidth = scrollEl ? scrollEl.getBoundingClientRect().width : 0;
	const scale = containerWidth > totalComputed && totalComputed > 0
		? containerWidth / totalComputed
		: 1;

	const rules = [];
	colIndices.forEach((colIndex) => {
		const finalWidth = Math.floor(computedWidths[colIndex] * scale);
		rules.push(`.${instanceClass} .dt-cell[data-col-index="${colIndex}"] { width: ${finalWidth}px !important; }`);
		rules.push(`.${instanceClass} .dt-cell__content--header-${colIndex}, .${instanceClass} .dt-cell__content--col-${colIndex} { width: ${finalWidth}px !important; }`);
	});

	const styleEl = nexlify_reports.get_or_create_style_tag(instanceClass);
	styleEl.textContent = rules.join("\n");

	nexlify_reports.highlight_negative_numbers_dom(wrapperEl);
};

nexlify_reports.sync_widths_from_header = function (wrapperEl) {
	const $wrapper = $(wrapperEl);
	const instanceClass = nexlify_reports.get_instance_class(wrapperEl);
	if (!instanceClass) return;

	const rules = [];
	$wrapper.find(".dt-row-header .dt-cell[data-col-index]").each(function () {
		const colIndex = this.getAttribute("data-col-index");
		const width = Math.round(this.getBoundingClientRect().width);
		if (!width) return;
		rules.push(`.${instanceClass} .dt-cell[data-col-index="${colIndex}"] { width: ${width}px !important; }`);
		rules.push(`.${instanceClass} .dt-cell__content--header-${colIndex}, .${instanceClass} .dt-cell__content--col-${colIndex} { width: ${width}px !important; }`);
	});
	if (!rules.length) return;

	const styleEl = nexlify_reports.get_or_create_style_tag(instanceClass);
	styleEl.textContent = rules.join("\n");
};

// Only disarm our autofit style for an ACTUAL column resize drag
// (mousedown specifically on the resize handle), never for a plain
// click/focus inside the header (e.g. typing in the search box).
let nexlifyResizing = false;
const NEXLIFY_RESIZE_EDGE_PX = 6;

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

		const ic = nexlify_reports.get_instance_class(wrapperEl);
		if (ic) {
			const s = document.getElementById("nexlify-autofit-style-" + ic);
			if (s) {
				const esc = draggedColIndex.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
				const headerRe = new RegExp("header-" + esc + "(?!\\d)");
				const colRe = new RegExp("col-" + esc + "(?!\\d)");
				const dataAttrRe = new RegExp('data-col-index="' + esc + '"');
				s.textContent = s.textContent
					.split("\n")
					.filter((line) => !(dataAttrRe.test(line) || headerRe.test(line) || colRe.test(line)))
					.join("\n");
			}
		}
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
	// column. Read that ground truth directly from the DOM and write it
	// into our own stylesheet as the single authoritative record.
	$(".datatable").each(function () {
		nexlify_reports.sync_widths_from_header(this);
	});
});

// Double-click near a column edge triggers the library's own native
// column autofit. Our permanent !important width rule for that column
// would otherwise block that change from ever being visible, so we
// clear just that one rule first, let the library do its thing, then
// capture the real result back into our stylesheet as the new record -
// exactly the same pattern used for manual drag-resize above.
$(document).on("dblclick", ".datatable .dt-row-header .dt-cell", function (e) {
	const rect = this.getBoundingClientRect();
	const nearRightEdge = rect.right - e.clientX <= NEXLIFY_RESIZE_EDGE_PX;
	const nearLeftEdge = e.clientX - rect.left <= NEXLIFY_RESIZE_EDGE_PX;
	if (!nearRightEdge && !nearLeftEdge) return;

	const wrapperEl = $(this).closest(".datatable")[0];
	if (!wrapperEl) return;

	const colIndex = this.getAttribute("data-col-index");
	const ic = nexlify_reports.get_instance_class(wrapperEl);
	if (ic) {
		const s = document.getElementById("nexlify-autofit-style-" + ic);
		if (s) {
			const esc = colIndex.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
			const headerRe = new RegExp("header-" + esc + "(?!\\d)");
			const colRe = new RegExp("col-" + esc + "(?!\\d)");
			const dataAttrRe = new RegExp('data-col-index="' + esc + '"');
			s.textContent = s.textContent
				.split("\n")
				.filter((line) => !(dataAttrRe.test(line) || headerRe.test(line) || colRe.test(line)))
				.join("\n");
		}
	}

	setTimeout(() => {
		nexlify_reports.sync_widths_from_header(wrapperEl);
	}, 50);
});

nexlify_reports.watch_all_datatables_dom = function () {
	if (window.__nexlify_dom_watcher_started) return;
	window.__nexlify_dom_watcher_started = true;

	const timers = new WeakMap();
	// Tables we've already autofitted once - never recompute again from
	// here, even if virtualized scrolling keeps re-rendering their rows.
	const autofitted = new WeakSet();

	const process_wrapper = (wrapperEl) => {
		if (nexlifyResizing) return;

		const excluded = nexlify_reports.get_excluded_datatable_elements();
		if (excluded.includes(wrapperEl)) return;

		const rowCount = wrapperEl.querySelectorAll(".dt-row[data-row-index]").length;
		if (rowCount < 1) return;

		nexlify_reports.ensure_floating_toolbar(wrapperEl);

		nexlify_reports.highlight_negative_numbers_dom(wrapperEl);

		if (autofitted.has(wrapperEl)) return;

		clearTimeout(timers.get(wrapperEl));
		const t = setTimeout(() => {
			if (autofitted.has(wrapperEl)) return;
			nexlify_reports.autofit_columns_dom(wrapperEl);
			autofitted.add(wrapperEl);
		}, 200);
		timers.set(wrapperEl, t);
	};

	// Only inspect the specific tables that actually changed (via each
	// mutation's own target), instead of re-querying every datatable on
	// the whole page on every single mutation - and skip immediately for
	// tables we've already handled, before doing any further DOM work.
	let bodyRafScheduled = false;
	let pendingTargets = new Set();

	const bodyObserver = new MutationObserver((mutations) => {
		mutations.forEach((m) => {
			const el = m.target.nodeType === 1 ? m.target : m.target.parentElement;
			if (!el) return;
			const wrapperEl = el.closest ? el.closest(".datatable") : null;
			if (wrapperEl && !autofitted.has(wrapperEl)) {
				pendingTargets.add(wrapperEl);
			}
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
	nexlify_reports.watch_all_datatables_dom();
});
