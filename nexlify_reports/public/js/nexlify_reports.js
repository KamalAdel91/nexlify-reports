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

nexlify_reports.watch_and_bind = function () {
	setInterval(() => {
		if (frappe.query_report && frappe.query_report.datatable) {
			nexlify_reports.observe_datatable(frappe.query_report.datatable);
		}
		if (cur_list && cur_list.datatable) {
			nexlify_reports.observe_datatable(cur_list.datatable);
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
