frappe.provide("nexlify_reports.list_columns");

(function () {
	const HIDE_KEY = "nexlify_hidden_cols";

	function load_hidden(doctype) {
		try {
			const settings = frappe.model.user_settings[doctype];
			return (settings && settings.List && settings.List[HIDE_KEY]) || [];
		} catch (e) {
			return [];
		}
	}

	function save_hidden(doctype, hidden) {
		try {
			frappe.model.user_settings.save(doctype, "List", { [HIDE_KEY]: hidden });
		} catch (e) {}
	}

	function get_style_tag(doctype) {
		const id = "nexlify-list-hidden-cols-" + doctype.replace(/\s+/g, "_");
		let el = document.getElementById(id);
		if (!el) {
			el = document.createElement("style");
			el.id = id;
			document.head.appendChild(el);
		}
		return el;
	}

	function apply_hidden(doctype, hidden) {
		const styleEl = get_style_tag(doctype);
		let css = "";
		hidden.forEach(function (idx) {
			css += ".list-row-container .level-left > .list-row-col:nth-child(" + idx + ") { display: none !important; }\n";
		});
		styleEl.textContent = css;
	}

	function get_header_columns() {
		return document.querySelectorAll(".list-row-head .list-header-subject > .list-row-col");
	}

	function get_columns_info() {
		const cols = get_header_columns();
		return Array.from(cols).map(function (col, i) {
			const fieldname = col.dataset.fieldname || ("col_" + (i + 1));
			const span = col.querySelector("[data-sort-by]") || col.querySelector("span");
			const label = span ? span.textContent.trim() : fieldname;
			return { idx: i + 1, fieldname: fieldname, label: label || fieldname };
		});
	}

	function show_columns_dialog(doctype) {
		const cols = get_columns_info();
		const hidden = load_hidden(doctype);

		const fields = cols.map(function (c) {
			return {
				fieldtype: "Check",
				fieldname: "col_" + c.idx,
				label: c.label,
				default: hidden.includes(c.idx) ? 0 : 1
			};
		});

		const d = new frappe.ui.Dialog({
			title: __("Edit Columns"),
			fields: fields,
			primary_action_label: __("Apply"),
			primary_action: function (values) {
				const new_hidden = cols
					.filter(function (c) { return !values["col_" + c.idx]; })
					.map(function (c) { return c.idx; });
				save_hidden(doctype, new_hidden);
				apply_hidden(doctype, new_hidden);
				d.hide();
			}
		});
		d.show();
	}

	function ensure_button(doctype) {
		if (!(window.cur_list && cur_list.page)) return;
		const $wrapper = $(cur_list.page.wrapper);
		if ($wrapper.find(".nexlify-columns-btn").length) return;
		cur_list.page.add_inner_button(__("Columns"), function () {
			show_columns_dialog(doctype);
		}).addClass("nexlify-columns-btn");
	}

	function setup() {
		if (!(window.cur_list && cur_list.doctype)) return;
		const doctype = cur_list.doctype;

		const check = setInterval(function () {
			if (get_header_columns().length) {
				clearInterval(check);
				apply_hidden(doctype, load_hidden(doctype));
				ensure_button(doctype);
			}
		}, 150);
		setTimeout(function () { clearInterval(check); }, 5000);
	}

	frappe.router.on("change", function () {
		if (frappe.get_route()[0] === "List") {
			setTimeout(setup, 300);
		}
	});
})();
