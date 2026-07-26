frappe.provide("nexlify_reports");

nexlify_reports.measure_text_width = function (text, font) {
	nexlify_reports._canvas = nexlify_reports._canvas || document.createElement("canvas");
	const context = nexlify_reports._canvas.getContext("2d");
	context.font = font;
	return context.measureText(text || "").width;
};

nexlify_reports.get_report_key = function () {
	if (frappe.query_report && frappe.query_report.report_name) {
		return "query_report:" + frappe.query_report.report_name;
	}
	if (cur_list && cur_list.doctype) {
		return "list_report:" + cur_list.doctype;
	}
	return "unknown";
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

nexlify_reports.autofit_columns = function (datatable, opts) {
	opts = opts || {};
	if (!datatable || !datatable.datamanager) return;

	const columns = datatable.datamanager.getColumns();
	const $wrapper = $(datatable.wrapper);
	const key = nexlify_reports.get_report_key();

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

		const finalWidth = maxWidth + 32;
		widths[colIndex] = finalWidth;

		datatable.columnmanager.setColumnWidth(colIndex, finalWidth);
		$wrapper.find(`.dt-cell__content--header-${colIndex}`).css("width", finalWidth + "px");
	});

	if (!opts.skipSave) {
		nexlify_reports.save_widths(key, widths);
	}

	nexlify_reports.highlight_negative_numbers(datatable);
};

nexlify_reports.reset_columns = function (datatable) {
	if (!datatable || !datatable.__nexlify_original_widths) return;
	const $wrapper = $(datatable.wrapper);
	const original = datatable.__nexlify_original_widths;

	Object.keys(original).forEach((colIndex) => {
		const w = original[colIndex];
		datatable.columnmanager.setColumnWidth(Number(colIndex), w);
		$wrapper.find(`.dt-cell__content--header-${colIndex}`).css("width", w + "px");
	});

	const key = nexlify_reports.get_report_key();
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

nexlify_reports.setup_report = function () {
	if (frappe.query_report && frappe.query_report.page && !frappe.query_report.__nexlify_autofit_added) {
		frappe.query_report.page.add_inner_button(__("Autofit"), () => {
			nexlify_reports.autofit_columns(frappe.query_report.datatable);
		});
		frappe.query_report.page.add_inner_button(__("Reset columns"), () => {
			nexlify_reports.reset_columns(frappe.query_report.datatable);
		});
		frappe.query_report.__nexlify_autofit_added = true;
	}

	if (cur_list && cur_list.datatable && cur_list.page && !cur_list.__nexlify_autofit_added) {
		cur_list.page.add_inner_button(__("Autofit"), () => {
			nexlify_reports.autofit_columns(cur_list.datatable);
		});
		cur_list.page.add_inner_button(__("Reset columns"), () => {
			nexlify_reports.reset_columns(cur_list.datatable);
		});
		cur_list.__nexlify_autofit_added = true;
	}
};

nexlify_reports.observe_datatable = function (datatable) {
	if (!datatable || datatable.__nexlify_observed) return;
	datatable.__nexlify_observed = true;

	nexlify_reports.capture_original_widths(datatable);

	setTimeout(() => {
		const key = nexlify_reports.get_report_key();
		const saved = nexlify_reports.load_widths(key);

		if (saved) {
			const $wrapper = $(datatable.wrapper);
			Object.keys(saved).forEach((colIndex) => {
				const w = saved[colIndex];
				datatable.columnmanager.setColumnWidth(Number(colIndex), w);
				$wrapper.find(`.dt-cell__content--header-${colIndex}`).css("width", w + "px");
			});
			nexlify_reports.highlight_negative_numbers(datatable);
		} else {
			nexlify_reports.autofit_columns(datatable);
		}
	}, 150);

	const bodyEl = $(datatable.wrapper).find(".dt-scrollable")[0];
	if (!bodyEl) return;

	let debounceTimer = null;
	const observer = new MutationObserver(() => {
		if (datatable.__nexlify_applying) return;
		clearTimeout(debounceTimer);
		debounceTimer = setTimeout(() => {
			datatable.__nexlify_applying = true;
			nexlify_reports.autofit_columns(datatable);
			setTimeout(() => {
				datatable.__nexlify_applying = false;
			}, 200);
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
